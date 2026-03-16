"""
pdf-translator/main.py

Translates research PDFs into a streaming HTML document served via gateway.

Cache keys (per-paper, not per-job):
  translated_html_parts:{job_id}:{arxiv_id}:{locale}  — Redis list of HTML fragments
  translated_html_done:{job_id}:{arxiv_id}:{locale}   — Redis string "1" when complete

Content preserved:
  • Translated prose paragraphs in correct reading order
  • 1-column and 2-column layouts detected automatically
    – 2-col: left column first (top→bottom), then right column (top→bottom)
    – Full-width blocks (abstract, headings, wide figures) interleaved at their y-position
  • Equations / notation blocks → pixmap of original PDF region (exact math fonts)
  • Tables                      → pixmap of original PDF region (exact borders)
  • Embedded figures            → base64 <img> with PDF-proportional sizing
  • Original references         → proper <p> blocks, not translated
"""

import asyncio
import base64
import html as _html
import json
import logging
import os
import re
from datetime import datetime

import fitz
import httpx
import redis as redis_lib
from lingodotdev import LingoDotDevEngine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [PDF-TRANSLATOR] %(levelname)s — %(message)s",
)
logger = logging.getLogger(__name__)

# ── Config ─────────────────────────────────────────────────────────────────────
REDIS_URL             = os.getenv("REDIS_URL",            "redis://redis:6379")
LINGO_API_KEY         = os.getenv("LINGODOTDEV_API_KEY",  "")
LINGO_API_URL         = "https://engine.lingo.dev"
QUEUE_PDF             = "pdf_translation_jobs"
QUEUE_EVENTS          = "ws_events"
HTML_TTL              = 86_400
TRANSLATE_CHUNK       = int(os.getenv("PDF_TRANSLATE_CHUNK",       "20"))
TRANSLATE_CONCURRENCY = int(os.getenv("PDF_TRANSLATE_CONCURRENCY", "5"))
IMG_MIN_PTS           = int(os.getenv("PDF_IMG_MIN_PTS", "60"))
HTML_CONTENT_WIDTH    = 800   # px  (body max-width 860 − 2×28 padding)

LANG_NAMES = {
    "hi": "Hindi",      "zh": "Chinese",    "ar": "Arabic",     "ja": "Japanese",
    "ko": "Korean",     "ru": "Russian",    "es": "Spanish",    "fr": "French",
    "de": "German",     "pt": "Portuguese", "it": "Italian",    "bn": "Bengali",
    "ur": "Urdu",       "th": "Thai",       "tr": "Turkish",    "vi": "Vietnamese",
    "uk": "Ukrainian",  "pl": "Polish",     "nl": "Dutch",      "sv": "Swedish",
    "da": "Danish",     "fi": "Finnish",    "no": "Norwegian",  "cs": "Czech",
    "ro": "Romanian",   "id": "Indonesian", "ms": "Malay",
}

RTL_LOCALES = {"ar", "ur", "he", "fa"}

REFERENCE_HEADERS = {
    "references", "bibliography", "works cited", "citations",
    "references and notes", "literature cited", "acknowledgements", "acknowledgments",
}


def get_redis_text():
    return redis_lib.from_url(REDIS_URL, decode_responses=True)


def get_redis_binary():
    return redis_lib.from_url(REDIS_URL, decode_responses=False)


def push_event(r, event: str, job_id: str, payload: dict = {}) -> None:
    r.rpush(QUEUE_EVENTS, json.dumps({
        "event":     event,
        "job_id":    job_id,
        "payload":   payload,
        "timestamp": datetime.utcnow().isoformat(),
    }))


def arxiv_id_from_url(url: str) -> str:
    m = re.search(r'arxiv\.org/(?:abs|pdf)/([^/?#\s]+)', url)
    if m:
        return m.group(1).split('v')[0]
    return url.rstrip('/').split('/')[-1]


# ── Lingo.dev ─────────────────────────────────────────────────────────────────

def _make_engine() -> LingoDotDevEngine:
    return LingoDotDevEngine({"api_key": LINGO_API_KEY, "api_url": LINGO_API_URL})


async def translate_batch(texts: dict[str, str], locale: str, engine=None) -> dict[str, str]:
    if not texts or not LINGO_API_KEY or locale == "en":
        return texts

    async def _call(eng):
        result = await eng.localize_object(
            texts, {"source_locale": "en", "target_locale": locale, "fast": True},
        )
        translated = result if isinstance(result, dict) else {}
        return translated or texts

    try:
        if engine is not None:
            return await _call(engine)
        async with _make_engine() as eng:
            return await _call(eng)
    except Exception as e:
        logger.warning(f"Lingo translation failed ({locale}): {e} — keeping originals")
        return texts


# ── Reference-section Detection ────────────────────────────────────────────────

def find_reference_page(doc: fitz.Document) -> int:
    for pi in range(len(doc)):
        for block in doc[pi].get_text("dict")["blocks"]:
            if block["type"] != 0:
                continue
            for line in block["lines"]:
                for span in line["spans"]:
                    t = span["text"].strip().lower()
                    if t in REFERENCE_HEADERS and len(t) < 40 and span["size"] >= 8:
                        logger.info(f"References section found on page {pi + 1}")
                        return pi
    return len(doc)


# ── Column Detection ───────────────────────────────────────────────────────────

def detect_columns(doc: fitz.Document, ref_idx: int) -> int:
    """
    Detect 1-column vs 2-column layout by sampling body pages.

    Strategy: ignore full-width blocks (title, abstract, headers — wider than 55%
    of the page). Count remaining blocks by whether their x-centre falls in the
    left or right page half.  If both halves have ≥20% of those blocks, it's 2-col.
    """
    page_count = min(ref_idx, len(doc))
    if page_count == 0:
        return 1

    # Skip title page (index 0) — sample up to 3 body pages
    sample = list(range(1, min(4, page_count))) or [0]
    left_n = right_n = 0

    for pi in sample:
        page = doc[pi]
        pw   = page.rect.width
        mid  = pw / 2

        for block in page.get_text("dict")["blocks"]:
            if block["type"] != 0:
                continue
            x0, _, x1, _ = block["bbox"]
            if (x1 - x0) > pw * 0.55:   # full-width block — skip
                continue
            if (x0 + x1) / 2 < mid:
                left_n += 1
            else:
                right_n += 1

    total = left_n + right_n
    if total == 0:
        return 1

    ratio = min(left_n, right_n) / total
    num_cols = 2 if ratio > 0.20 else 1
    logger.info(
        f"Layout: {num_cols} column(s) "
        f"(left={left_n}, right={right_n}, balance={ratio:.2f})"
    )
    return num_cols


# ── Column Classification helper ──────────────────────────────────────────────

def _classify_col(x0: float, x1: float, page_width: float, num_cols: int) -> int:
    """
    Return 0 = full-width, 1 = left column, 2 = right column.
    Always returns 0 in 1-column mode.
    """
    if num_cols != 2:
        return 0
    mid = page_width / 2
    if (x1 - x0) > page_width * 0.55:
        return 0
    return 1 if (x0 + x1) / 2 < mid else 2


# ── 2-Column Reading-Order Sort ───────────────────────────────────────────────

def _order_for_reading(items: list[dict], num_cols: int) -> list[dict]:
    """
    Sort page items into reading order.

    1-column: simple y-sort.
    2-column:
      • full-width (col=0) and left-column (col=1) are interleaved by y-position
        → gives correct position for spanning figures/headers inside the left flow
      • right-column (col=2) blocks follow, sorted by y
    """
    if num_cols != 2:
        return sorted(items, key=lambda x: x["y"])

    full  = sorted([i for i in items if i.get("col", 0) == 0], key=lambda x: x["y"])
    left  = sorted([i for i in items if i.get("col", 0) == 1], key=lambda x: x["y"])
    right = sorted([i for i in items if i.get("col", 0) == 2], key=lambda x: x["y"])

    # Merge full-width into left column by y (two-pointer merge)
    merged: list[dict] = []
    fi = li = 0
    while fi < len(full) or li < len(left):
        take_full = fi < len(full) and (li >= len(left) or full[fi]["y"] <= left[li]["y"])
        if take_full:
            merged.append(full[fi]); fi += 1
        else:
            merged.append(left[li]); li += 1

    return merged + right


# ── Region Rendering (tables + equations → pixmap) ────────────────────────────

def render_region_as_image(
    page:       fitz.Page,
    bbox,
    page_width: float,
) -> dict | None:
    """
    Render a rectangular PDF region as a crisp PNG (2× retina resolution).
    Returns {"src", "css_w", "y", "x_center"} or None on failure.
    """
    try:
        rect = fitz.Rect(bbox)
        if rect.is_empty or rect.width < 4 or rect.height < 4:
            return None

        content_scale = HTML_CONTENT_WIDTH / page_width if page_width > 0 else 1.0
        css_w         = max(60, min(HTML_CONTENT_WIDTH, int(rect.width * content_scale)))

        # Render at 2× the CSS display width (retina), clamped to [96, 288] DPI
        dpi = max(96, min(288, int(css_w * 2 / rect.width * 72)))
        mat = fitz.Matrix(dpi / 72, dpi / 72)
        pix = page.get_pixmap(matrix=mat, clip=rect, colorspace=fitz.csRGB)
        b64 = base64.b64encode(pix.tobytes("png")).decode()

        return {
            "src":      f"data:image/png;base64,{b64}",
            "css_w":    css_w,
            "y":        rect.y0,
            "x_center": (rect.x0 + rect.x1) / 2,
        }
    except Exception as e:
        logger.debug(f"render_region_as_image failed: {e}")
        return None


# ── Table Detection + Rendering ───────────────────────────────────────────────

def extract_page_tables(
    page:       fitz.Page,
    page_width: float,
    num_cols:   int,
) -> tuple[list[fitz.Rect], list[dict]]:
    """
    Returns (occupied_rects, table_image_dicts).
    occupied_rects — used to skip text blocks inside table cells.
    """
    table_rects  = []
    table_images = []
    try:
        finder = page.find_tables()
        for tab in (finder.tables if finder.tables else []):
            rect = fitz.Rect(tab.bbox)
            table_rects.append(rect)
            img = render_region_as_image(page, tab.bbox, page_width)
            if img:
                img["col"] = _classify_col(rect.x0, rect.x1, page_width, num_cols)
                table_images.append(img)
    except Exception as e:
        logger.debug(f"Table detection unavailable (PyMuPDF < 1.23?): {e}")
    return table_rects, table_images


# ── Per-page Text Block Extraction ────────────────────────────────────────────

def extract_page_blocks(
    page:           fitz.Page,
    pi:             int,
    occupied_rects: list[fitz.Rect] | None,
    num_cols:       int,
) -> dict[str, dict]:
    """
    Extract text blocks from one page.

    Each block gets:
      verbatim — True for equation/symbol-heavy blocks (rendered as image, not translated)
      col      — 0=full-width, 1=left-col, 2=right-col  (used for reading-order sort)
      bbox, y  — position metadata
    """
    blocks_map = {}
    page_width = page.rect.width
    raw_blocks = page.get_text("dict")["blocks"]

    for bi, block in enumerate(raw_blocks):
        if block["type"] != 0:
            continue

        # Skip blocks that fall inside a table region
        if occupied_rects:
            br = fitz.Rect(block["bbox"])
            if any(br.intersects(tr) for tr in occupied_rects):
                continue

        parts = []
        for line in block["lines"]:
            for span in line["spans"]:
                t = span["text"].strip()
                if not t:
                    continue
                # Skip arXiv right-margin metadata strip
                if page_width > 0 and span["bbox"][0] > page_width * 0.85:
                    continue
                parts.append(t)

        text = " ".join(parts).strip()
        if len(text) < 10:
            continue

        alpha       = sum(1 for c in text if c.isalpha())
        alpha_ratio = alpha / len(text)
        verbatim    = alpha_ratio < 0.4   # equation / citation list

        x0, _, x1, _ = block["bbox"]
        col = _classify_col(x0, x1, page_width, num_cols)

        blocks_map[f"p{pi}b{bi}"] = {
            "text":     text,
            "verbatim": verbatim,
            "bbox":     block["bbox"],
            "y":        block["bbox"][1],
            "col":      col,
        }

    return blocks_map


# ── Per-page Embedded Figure Extraction ───────────────────────────────────────

def extract_page_figures(
    doc:       fitz.Document,
    page:      fitz.Page,
    num_cols:  int,
) -> list[dict]:
    """
    Extract embedded raster/vector images (actual figures, not table/equation renders).
    Skips images smaller than IMG_MIN_PTS in their rendered size.
    """
    page_width = page.rect.width
    result     = []
    seen       = set()

    for img_info in page.get_images(full=True):
        xref = img_info[0]
        if xref in seen:
            continue
        seen.add(xref)

        try:
            rects = page.get_image_rects(xref)
            if not rects:
                continue

            bbox_w = rects[0].width
            bbox_h = rects[0].height
            if bbox_w < IMG_MIN_PTS or bbox_h < IMG_MIN_PTS:
                continue

            img_data = doc.extract_image(xref)

            content_scale = HTML_CONTENT_WIDTH / page_width if page_width > 0 else 1.0
            css_w = max(60, min(HTML_CONTENT_WIDTH, int(bbox_w * content_scale)))

            b64 = base64.b64encode(img_data["image"]).decode()
            ext = img_data.get("ext", "png")

            x0, x1 = rects[0].x0, rects[0].x1
            col = _classify_col(x0, x1, page_width, num_cols)

            result.append({
                "src":      f"data:image/{ext};base64,{b64}",
                "css_w":    css_w,
                "y":        rects[0].y0,
                "x_center": (x0 + x1) / 2,
                "col":      col,
            })
        except Exception:
            pass

    result.sort(key=lambda x: x["y"])
    return result


# ── Reference Block Extraction ────────────────────────────────────────────────

def extract_reference_blocks(doc: fitz.Document, ref_idx: int) -> list[str]:
    """
    Extract individual reference entries as clean text strings.
    Uses get_text("dict") so each reference block becomes one string —
    much cleaner than raw text with newlines.
    """
    if ref_idx >= len(doc):
        return []

    ref_blocks = []
    for pi in range(ref_idx, len(doc)):
        page = doc[pi]
        for block in page.get_text("dict")["blocks"]:
            if block["type"] != 0:
                continue
            parts = []
            for line in block["lines"]:
                for span in line["spans"]:
                    t = span["text"].strip()
                    if t:
                        parts.append(t)
            text = " ".join(parts).strip()
            if len(text) >= 5:
                ref_blocks.append(text)

    return ref_blocks


# ── HTML Fragment Builders ─────────────────────────────────────────────────────

def build_page_fragment(
    pi:         int,
    blocks:     dict[str, dict],
    translated: dict[str, str],
    images:     list[dict],
    num_cols:   int,
) -> str:
    """
    Build one <section class="page"> fragment with correct reading order.
    Prose blocks and images are merged then sorted via _order_for_reading().
    """
    items: list[dict] = []

    for key, item in blocks.items():
        tr = translated.get(key, item["text"]).strip() or item["text"]
        items.append({
            "kind": "text",
            "y":    item["y"],
            "col":  item.get("col", 0),
            "text": tr,
        })

    for img in images:
        items.append({
            "kind":  "image",
            "y":     img["y"],
            "col":   img.get("col", 0),
            "src":   img["src"],
            "css_w": img["css_w"],
        })

    ordered = _order_for_reading(items, num_cols)

    inner = []
    for it in ordered:
        if it["kind"] == "text":
            inner.append(f'<p>{_html.escape(it["text"])}</p>')
        else:
            inner.append(
                f'<figure>'
                f'<img src="{it["src"]}" '
                f'style="width:{it["css_w"]}px;max-width:100%" alt="">'
                f'</figure>'
            )

    return (
        '<section class="page">'
        f'<div class="page-num">— Page {pi + 1} —</div>'
        + "".join(inner)
        + '</section>'
    )


def build_refs_fragment(ref_blocks: list[str]) -> str:
    """
    Render the references section as proper <p> elements — no translation,
    no line-break hacks. Each extracted text block becomes one paragraph.
    """
    paras = "".join(f'<p>{_html.escape(b)}</p>' for b in ref_blocks)
    return (
        '<section class="refs">'
        '<h2>References</h2>'
        f'<div class="refs-body">{paras}</div>'
        '</section>'
    )


def build_header_fragment(title: str, lang_name: str, ref_idx: int, num_cols: int) -> str:
    layout = "2-column" if num_cols == 2 else "1-column"
    return (
        f'<h1>{_html.escape(title)}</h1>'
        f'<div class="meta">'
        f'Translated to {_html.escape(lang_name)} by PaperSwarm'
        f' &nbsp;·&nbsp; {ref_idx} page{"s" if ref_idx != 1 else ""}'
        f' &nbsp;·&nbsp; {layout}'
        f' &nbsp;·&nbsp; equations, tables &amp; figures preserved'
        f'</div>'
    )


# ── Job Orchestrator ───────────────────────────────────────────────────────────

async def process_job(job: dict, r_text, r_bin) -> None:
    job_id  = job.get("job_id", "")
    arx_url = job.get("arxiv_url", "")
    locale  = job.get("target_locale", "en")

    if not job_id or not arx_url or locale == "en":
        return

    arxiv_id  = arxiv_id_from_url(arx_url)
    parts_key = f"translated_html_parts:{job_id}:{arxiv_id}:{locale}"
    done_key  = f"translated_html_done:{job_id}:{arxiv_id}:{locale}"
    html_url  = f"/translated/{job_id}/{arxiv_id}/{locale}"

    if r_text.exists(done_key):
        logger.info(f"Job {job_id} — cache hit locale={locale} arxiv_id={arxiv_id}")
        push_event(r_text, "pdf_translation_done", job_id, {
            "target_locale": locale, "html_url": html_url, "cached": True,
        })
        return

    r_text.delete(parts_key)

    # ── Download PDF ───────────────────────────────────────────────────────────
    pdf_url = arx_url.replace("arxiv.org/abs/", "arxiv.org/pdf/")
    try:
        async with httpx.AsyncClient(timeout=90, follow_redirects=True) as client:
            resp = await client.get(
                pdf_url, headers={"User-Agent": "PaperSwarm/1.0 (research tool)"}
            )
            resp.raise_for_status()
            pdf_bytes = resp.content
        logger.info(f"Job {job_id} — downloaded {len(pdf_bytes)//1024} KB")
    except Exception as e:
        logger.error(f"Job {job_id} — download failed: {e}")
        push_event(r_text, "pdf_translation_error", job_id, {"error": f"Download failed: {e}"})
        return

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:
        logger.error(f"Job {job_id} — PDF parse failed: {e}")
        push_event(r_text, "pdf_translation_error", job_id, {"error": f"Parse failed: {e}"})
        return

    total    = len(doc)
    ref_idx  = find_reference_page(doc)
    num_cols = detect_columns(doc, ref_idx)

    # Extract title
    title = doc.metadata.get("title", "").strip()
    if not title:
        for block in doc[0].get_text("dict")["blocks"]:
            if block["type"] != 0:
                continue
            for line in block["lines"]:
                for span in line["spans"]:
                    t = span["text"].strip()
                    if len(t) > 15 and span["size"] >= 10:
                        title = t[:120]
                        break
                if title:
                    break
            if title:
                break
    if not title:
        title = arx_url.split("/")[-1]

    lang_name = LANG_NAMES.get(locale, locale.upper())

    logger.info(
        f"Job {job_id} — {arxiv_id} → {locale} "
        f"({num_cols}-col, {ref_idx} content pages)"
    )

    # ── Open engine once for title + all pages ────────────────────────────────
    async with _make_engine() as engine:

        # Translate title first so the <h1> is in the target language
        title_result = await translate_batch({"t": title}, locale, engine)
        title_tr     = title_result.get("t", title)

        # Push header — iframe loads the streaming shell immediately
        r_text.rpush(parts_key, build_header_fragment(title_tr, lang_name, ref_idx, num_cols))
        r_text.expire(parts_key, HTML_TTL)

        push_event(r_text, "pdf_translation_started", job_id, {
            "target_locale": locale,
            "arxiv_url":     arx_url,
            "html_url":      html_url,
            "total_pages":   total,
        })

        # ── Process one page at a time ────────────────────────────────────────
        for pi in range(min(ref_idx, len(doc))):
            page       = doc[pi]
            page_width = page.rect.width

            # 1. Detect + render tables; get occupied rects to skip their text
            table_rects, table_images = extract_page_tables(page, page_width, num_cols)

            # 2. Extract text blocks (table areas excluded)
            page_blocks = extract_page_blocks(page, pi, table_rects, num_cols)

            # 3. Render verbatim (equation/notation) blocks as pixmaps
            eq_images = []
            for item in page_blocks.values():
                if item["verbatim"]:
                    img = render_region_as_image(page, item["bbox"], page_width)
                    if img:
                        img["col"] = item["col"]
                        eq_images.append(img)

            # 4. Translate prose-only blocks
            prose_blocks = {k: v for k, v in page_blocks.items() if not v["verbatim"]}
            translated_page: dict[str, str] = {}

            if prose_blocks:
                prose_texts = {k: v["text"] for k, v in prose_blocks.items()}
                keys        = list(prose_texts.keys())
                chunks      = [
                    {k: prose_texts[k] for k in keys[i : i + TRANSLATE_CHUNK]}
                    for i in range(0, len(keys), TRANSLATE_CHUNK)
                ]
                if len(chunks) == 1:
                    translated_page = await translate_batch(prose_texts, locale, engine)
                else:
                    sem = asyncio.Semaphore(TRANSLATE_CONCURRENCY)

                    async def _bounded(chunk, _eng=engine):
                        async with sem:
                            return await translate_batch(chunk, locale, _eng)

                    results = await asyncio.gather(
                        *[_bounded(c) for c in chunks], return_exceptions=True
                    )
                    for i, res in enumerate(results):
                        if isinstance(res, dict):
                            translated_page.update(res)
                        else:
                            translated_page.update(chunks[i])

            # 5. Extract embedded figures
            figure_images = extract_page_figures(doc, page, num_cols)

            # 6. Merge and push page fragment
            all_images = table_images + eq_images + figure_images
            if prose_blocks or all_images:
                fragment = build_page_fragment(
                    pi, prose_blocks, translated_page, all_images, num_cols
                )
                r_text.rpush(parts_key, fragment)
                r_text.expire(parts_key, HTML_TTL)

            push_event(r_text, "pdf_translation_progress", job_id, {
                "page": pi + 1, "total_pages": total, "status": "page_done",
            })
            logger.info(
                f"Job {job_id} — page {pi + 1}/{ref_idx}: "
                f"{len(prose_blocks)} prose, {len(table_images)} tables, "
                f"{len(eq_images)} eqs, {len(figure_images)} figs"
            )

    # ── References (outside engine — no translation needed) ───────────────────
    ref_blocks = extract_reference_blocks(doc, ref_idx)
    doc.close()

    if ref_blocks:
        r_text.rpush(parts_key, build_refs_fragment(ref_blocks))
        r_text.expire(parts_key, HTML_TTL)
        logger.info(f"Job {job_id} — {len(ref_blocks)} reference blocks appended")

    # ── Mark done ─────────────────────────────────────────────────────────────
    r_text.set(done_key, "1", ex=HTML_TTL)

    push_event(r_text, "pdf_translation_done", job_id, {
        "target_locale": locale, "total_pages": total,
        "translated_pages": ref_idx, "html_url": html_url,
    })
    logger.info(f"Job {job_id} — complete ✓  ({arxiv_id} → {locale})")


# ── Main Loop ──────────────────────────────────────────────────────────────────

async def main_async() -> None:
    r_text = get_redis_text()
    r_bin  = get_redis_binary()
    logger.info("PDF Translator started (streaming HTML, column-aware)")

    while True:
        try:
            raw = r_text.lpop(QUEUE_PDF)
            if raw:
                try:
                    job = json.loads(raw)
                    await process_job(job, r_text, r_bin)
                except json.JSONDecodeError as e:
                    logger.error(f"Bad job JSON: {e}")
                except Exception as e:
                    logger.exception(f"Job processing failed: {e}")
            else:
                await asyncio.sleep(2)

        except redis_lib.ConnectionError:
            logger.error("Redis connection lost — retrying in 5 s")
            await asyncio.sleep(5)
        except Exception as e:
            logger.exception(f"Loop error: {e}")
            await asyncio.sleep(1)


def main() -> None:
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
