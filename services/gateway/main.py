from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
import os
import asyncio
import json
import logging
import re
import threading
import uuid
from contextlib import asynccontextmanager
from datetime import datetime

import redis
from pydantic import BaseModel
try:
    from lingodotdev import LingoDotDevEngine as _LingoEngine
    _LINGO_AVAILABLE = True
except ImportError:
    _LINGO_AVAILABLE = False

_LINGO_API_KEY = os.getenv("LINGODOTDEV_API_KEY", "")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [GATEWAY] %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

REDIS_URL     = os.getenv("REDIS_URL", "redis://redis:6379")
QUEUE_PLANNER = "planner_jobs"
QUEUE_SEARCH  = "search_jobs"
QUEUE_EVENTS  = "ws_events"

_RTL_LOCALES = {"ar", "ur", "he", "fa"}

# CSS shared between the streaming shell HTML and the old static HTML path
_SHELL_CSS = """
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,"Segoe UI","Noto Sans","PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Hiragino Sans GB","Meiryo","Malgun Gothic","Noto Sans Arabic","Noto Sans Devanagari","Arial Unicode MS",sans-serif;font-size:15px;line-height:1.85;color:#111;background:#fff;max-width:860px;margin:0 auto;padding:36px 28px 80px}
  h1{font-size:1.35rem;font-weight:700;line-height:1.4;margin-bottom:8px;color:#0f0f0f}
  h2{font-size:1rem;font-weight:700;margin-bottom:12px;color:#333}
  .meta{font-size:12px;color:#888;margin-bottom:32px;padding-bottom:14px;border-bottom:1px solid #e8e8e8}
  .page{margin-bottom:32px;padding-bottom:32px;border-bottom:1px solid #f2f2f2}
  .page:last-child{border-bottom:none}
  .page-num{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#ccc;margin-bottom:14px}
  p{margin-bottom:12px}
  p:last-child{margin-bottom:0}
  pre.math{font-family:"SFMono-Regular","Consolas","Liberation Mono","Courier New",monospace;font-size:13px;line-height:1.6;background:#f7f7f9;border-left:3px solid #d0d0e0;padding:10px 14px;margin:14px 0;white-space:pre-wrap;word-break:break-word;color:#222;border-radius:4px}
  figure{margin:20px 0;text-align:center}
  figure img{display:inline-block;max-width:100%;height:auto;border:1px solid #eee;border-radius:4px}
  .refs{margin-top:40px;padding-top:28px;border-top:2px solid #e8e8e8}
  .refs-body{font-size:12px;line-height:1.7;color:#555;direction:ltr}
  .ps-loading{color:#bbb;font-size:14px;padding:60px 0;text-align:center}
"""


def get_redis():
    return redis.from_url(REDIS_URL, decode_responses=True)


def _arxiv_id_from_url(url: str) -> str:
    """Extract a stable paper ID from any arXiv URL variant."""
    m = re.search(r'arxiv\.org/(?:abs|pdf)/([^/?#\s]+)', url)
    if m:
        return m.group(1).split('v')[0]
    return url.rstrip('/').split('/')[-1]

active_connections: dict[str, list[WebSocket]] = {}

class SearchRequest(BaseModel):
    query:  str
    locale: str = "en"

class ConfirmRequest(BaseModel):
    job_id:        str
    arxiv_url:     str
    target_locale: str = "en"
    max_papers:    int = 8

class TranslateRequest(BaseModel):
    job_id:        str
    target_locale: str

class PdfTranslateRequest(BaseModel):
    job_id:        str
    arxiv_url:     str
    target_locale: str

class RestoreGraphRequest(BaseModel):
    job_id:        str
    graph:         dict
    target_locale: str = "en"

class AnnotateRequest(BaseModel):
    job_id:    str
    node_id:   str
    node_type: str
    text:      str

class AnalyzeRequest(BaseModel):
    arxiv_url:     str = ""
    arxiv_id:      str = ""
    target_locale: str = "en"
    max_papers:    int = 8

class AnalyzeResponse(BaseModel):
    job_id:  str
    status:  str
    ws_url:  str
    message: str


async def broadcast(job_id: str, event: dict) -> None:
    """Send event to every WebSocket client watching this job."""
    if job_id not in active_connections:
        return
    
    dead = []
    for ws in active_connections[job_id]:
        try:
            await ws.send_text(json.dumps(event))
        except Exception:
            dead.append(ws)

    for ws in dead:
        active_connections[job_id].remove(ws)


def start_event_poller():
    r    = get_redis()
    loop = asyncio.new_event_loop()
    logger.info("Event poller thread started")

    while True:
        try:
            result = r.blpop(QUEUE_EVENTS, timeout=2)
            if result:
                _, raw  = result
                event   = json.loads(raw)
                job_id  = event.get("job_id", "")
                if job_id:
                    loop.run_until_complete(broadcast(job_id, event))
        except Exception as e:
            logger.error(f"Event poller error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    poller = threading.Thread(target=start_event_poller, daemon=True)
    poller.start()
    logger.info("Gateway started")
    yield
    logger.info("Gateway shutting down")

app = FastAPI(title="PaperSwarm Gateway", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    try:
        r = get_redis()
        r.ping()
        redis_status = "ok"
    except Exception:
        redis_status = "unreachable"

    return {
        "status":    "ok",
        "service":   "gateway",
        "redis":     redis_status,
        "timestamp": datetime.utcnow().isoformat()
    }

@app.post("/search")
def search(req: SearchRequest):
    job_id = str(uuid.uuid4())[:8]

    search_job = {
        "job_id":     job_id,
        "query":      req.query,
        "locale":     req.locale,
        "created_at": datetime.utcnow().isoformat()
    }

    try:
        r = get_redis()
        r.rpush(QUEUE_SEARCH, json.dumps(search_job))
        logger.info(f"Search job {job_id} queued — query: '{req.query}' locale={req.locale}")
    except Exception as e:
        logger.error(f"Redis push failed: {e}")
        return {
            "job_id":  "",
            "status":  "error",
            "message": "Could not connect to queue. Is Redis running?"
        }

    return {
        "job_id":  job_id,
        "status":  "searching",
        "ws_url":  f"/ws/{job_id}",
        "message": "Search started. Connect to WebSocket for results."
    }

@app.post("/confirm")
def confirm(req: ConfirmRequest):
    try:
        r = get_redis()

        planner_job = {
            "job_id":        req.job_id,
            "arxiv_url":     req.arxiv_url,
            "target_locale": req.target_locale,
            "max_papers":    req.max_papers,
            "created_at":    datetime.utcnow().isoformat()
        }

        r.rpush(QUEUE_PLANNER, json.dumps(planner_job))
        r.set(f"locale:{req.job_id}", req.target_locale, ex=3600)

        r.rpush(QUEUE_EVENTS, json.dumps({
            "event":   "job_started",
            "job_id":  req.job_id,
            "payload": {
                "arxiv_url": req.arxiv_url,
                "locale":    req.target_locale
            },
            "timestamp": datetime.utcnow().isoformat()
        }))

        logger.info(f"Job {req.job_id} confirmed — starting analysis: {req.arxiv_url}")

    except Exception as e:
        logger.error(f"Confirm failed: {e}")
        return {"status": "error", "message": str(e)}

    return {
        "job_id":  req.job_id,
        "status":  "analyzing",
        "message": "Analysis started."
    }

@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    if not req.arxiv_url and req.arxiv_id:
        req.arxiv_url = f"https://arxiv.org/abs/{req.arxiv_id.strip()}"

    if not req.arxiv_url or "arxiv.org" not in req.arxiv_url:
        return {
            "job_id":  "",
            "status":  "error",
            "ws_url":  "",
            "message": "Please provide a valid arxiv URL or ID e.g. 1706.03762"
        }

    job_id = str(uuid.uuid4())[:8]

    try:
        r = get_redis()
        planner_job = {
            "job_id":        job_id,
            "arxiv_url":     req.arxiv_url,
            "target_locale": req.target_locale,
            "max_papers":    req.max_papers,
            "created_at":    datetime.utcnow().isoformat()
        }

        r.rpush(QUEUE_PLANNER, json.dumps(planner_job))
        r.set(f"locale:{job_id}", req.target_locale, ex=3600)

        r.rpush(QUEUE_EVENTS, json.dumps({
            "event":   "job_started",
            "job_id":  job_id,
            "payload": {
                "arxiv_url": req.arxiv_url,
                "locale":    req.target_locale
            },
            "timestamp": datetime.utcnow().isoformat()
        }))

        logger.info(f"Job {job_id} queued — {req.arxiv_url} locale={req.target_locale}")

    except Exception as e:
        logger.error(f"Redis push failed: {e}")
        return {
            "job_id":  "",
            "status":  "error",
            "ws_url":  "",
            "message": "Could not connect to queue. Is Redis running?"
        }

    return {
        "job_id":  job_id,
        "status":  "queued",
        "ws_url":  f"/ws/{job_id}",
        "message": "Job queued. Connect to WebSocket for live updates."
    }


@app.get("/graph/{job_id}")
def get_graph(job_id: str, locale: str = "en"):
    r = get_redis()

    if locale == "en":
        raw = r.get(f"graph:{job_id}")
    else:
        raw = r.get(f"translated_graph:{job_id}:{locale}")
        if not raw:
            raw = r.get(f"graph:{job_id}")  # fallback to English if not yet translated

    if not raw:
        raise HTTPException(
            status_code=404,
            detail=f"Graph not found for job {job_id}. Job may still be running."
        )

    return JSONResponse(content=json.loads(raw))


@app.get("/status/{job_id}")
def get_status(job_id: str):
    r = get_redis()

    def read_tracker(worker_type: str) -> dict:
        raw = r.get(f"tracker:{job_id}:{worker_type}")
        if not raw:
            return {"completed": 0, "total": 0}
        return json.loads(raw)

    sim = read_tracker("similarity")
    fut = read_tracker("future_research")

    graph_ready = bool(r.exists(f"graph:{job_id}"))
    translated  = bool(r.exists(f"translated_graph:{job_id}"))

    return {
        "job_id":            job_id,
        "similarity":        sim,
        "future_research":   fut,
        "graph_ready":       graph_ready,
        "translated":        translated,
        "complete":          graph_ready,
    }

@app.delete("/job/{job_id}")
def clear_job(job_id: str):
    """Clear all Redis keys for a completed job — called when user starts a new analysis."""
    r = get_redis()
    keys = r.keys(f"*{job_id}*")
    if keys:
        r.delete(*keys)
    return {"status": "cleared", "keys_deleted": len(keys)}

@app.post("/restore-graph")
def restore_graph(req: RestoreGraphRequest):
    """Re-store a saved graph snapshot in Redis so translation can be triggered on it."""
    r = get_redis()
    graph_key = f"graph:{req.job_id}"
    r.set(graph_key, json.dumps(req.graph), ex=3600)
    r.set(f"locale:{req.job_id}", req.target_locale, ex=3600)
    logger.info(f"Graph restored to Redis — job {req.job_id} locale={req.target_locale}")

    # If non-English locale requested, check cache then queue lingo job
    if req.target_locale != "en":
        cached = r.get(f"translated_graph:{req.job_id}:{req.target_locale}")
        if cached:
            r.rpush(QUEUE_EVENTS, json.dumps({
                "event":   "graph_translated",
                "job_id":  req.job_id,
                "payload": {"target_locale": req.target_locale, "translated": True, "cached": True},
                "timestamp": datetime.utcnow().isoformat()
            }))
            return {"status": "cached", "job_id": req.job_id, "locale": req.target_locale}

        lingo_job = {
            "job_id":        req.job_id,
            "target_locale": req.target_locale,
            "graph":         req.graph
        }
        r.rpush("lingo_jobs", json.dumps(lingo_job))
        logger.info(f"Translation queued after restore — job {req.job_id} → {req.target_locale}")
        return {"status": "queued", "job_id": req.job_id, "locale": req.target_locale}

    return {"status": "restored", "job_id": req.job_id}

@app.post("/translate")
def translate(req: TranslateRequest):
    r = get_redis()

    # Serve from per-locale cache instantly — no re-translation needed
    if req.target_locale != "en":
        cached = r.get(f"translated_graph:{req.job_id}:{req.target_locale}")
        if cached:
            logger.info(f"Cache hit — job {req.job_id} locale={req.target_locale}, broadcasting event")
            r.rpush(QUEUE_EVENTS, json.dumps({
                "event":   "graph_translated",
                "job_id":  req.job_id,
                "payload": {"target_locale": req.target_locale, "translated": True, "cached": True},
                "timestamp": datetime.utcnow().isoformat()
            }))
            return {"status": "cached", "job_id": req.job_id, "locale": req.target_locale}

    raw = r.get(f"graph:{req.job_id}")
    if not raw:
        raise HTTPException(status_code=404, detail="Graph not found")

    lingo_job = {
        "job_id":        req.job_id,
        "target_locale": req.target_locale,
        "graph":         json.loads(raw)
    }
    r.rpush("lingo_jobs", json.dumps(lingo_job))
    logger.info(f"Translation queued — job {req.job_id} → {req.target_locale}")
    return {"status": "queued", "job_id": req.job_id, "locale": req.target_locale}

class TranslateUiRequest(BaseModel):
    content: dict
    locale:  str = "en"

@app.post("/translate-ui")
async def translate_ui(req: TranslateUiRequest):
    """Synchronously translate a UI content dict via Lingo.dev for the landing page."""
    if req.locale == "en" or not req.content:
        return {"translated": req.content}
    if not _LINGO_AVAILABLE or not _LINGO_API_KEY:
        logger.warning("lingodotdev unavailable or API key missing — returning untranslated content")
        return {"translated": req.content}
    try:
        engine_cfg = {"api_key": _LINGO_API_KEY, "api_url": "https://engine.lingo.dev"}
        async with _LingoEngine(engine_cfg) as engine:
            result = await engine.localize_object(
                req.content,
                {"source_locale": "en", "target_locale": req.locale, "fast": True}
            )
        return {"translated": result if isinstance(result, dict) else req.content}
    except Exception as e:
        logger.error(f"translate-ui failed for locale={req.locale}: {e}")
        return {"translated": req.content, "error": str(e)}

@app.post("/annotate")
def annotate(req: AnnotateRequest):
    r = get_redis()
    key  = f"annotations:{req.job_id}:{req.node_id}"
    data = {
        "job_id":    req.job_id,
        "node_id":   req.node_id,
        "node_type": req.node_type,
        "text":      req.text,
        "saved_at":  datetime.utcnow().isoformat()
    }
    r.set(key, json.dumps(data))
    r.expire(key, 604800)  # 7 days
    return {"status": "saved"}

@app.get("/annotations/{job_id}")
def get_annotations(job_id: str):
    r = get_redis()
    keys = r.keys(f"annotations:{job_id}:*")
    annotations = []
    for key in keys:
        raw = r.get(key)
        if raw:
            annotations.append(json.loads(raw))
    return {"annotations": annotations}

@app.post("/translate-pdf")
def translate_pdf(req: PdfTranslateRequest):
    """Queue a PDF translation job — scoped per-paper (arxiv_id) not just per-job."""
    r         = get_redis()
    arxiv_id  = _arxiv_id_from_url(req.arxiv_url)
    html_url  = f"/translated/{req.job_id}/{arxiv_id}/{req.target_locale}"
    done_key  = f"translated_html_done:{req.job_id}:{arxiv_id}:{req.target_locale}"
    parts_key = f"translated_html_parts:{req.job_id}:{arxiv_id}:{req.target_locale}"

    if r.exists(done_key):
        # Fully cached — fire done event immediately
        r.rpush(QUEUE_EVENTS, json.dumps({
            "event":   "pdf_translation_done",
            "job_id":  req.job_id,
            "payload": {
                "target_locale": req.target_locale,
                "html_url":      html_url,
                "cached":        True,
            },
            "timestamp": datetime.utcnow().isoformat()
        }))
        logger.info(f"PDF cache hit — job {req.job_id} arxiv={arxiv_id} locale={req.target_locale}")
        return {"status": "cached", "html_url": html_url}

    if r.exists(parts_key):
        # Translation already in progress — reconnect frontend to the streaming shell
        r.rpush(QUEUE_EVENTS, json.dumps({
            "event":   "pdf_translation_started",
            "job_id":  req.job_id,
            "payload": {
                "target_locale": req.target_locale,
                "html_url":      html_url,
                "arxiv_url":     req.arxiv_url,
            },
            "timestamp": datetime.utcnow().isoformat()
        }))
        return {"status": "in_progress", "html_url": html_url}

    job = {
        "job_id":        req.job_id,
        "arxiv_url":     req.arxiv_url,
        "target_locale": req.target_locale,
        "created_at":    datetime.utcnow().isoformat(),
    }
    r.rpush("pdf_translation_jobs", json.dumps(job))
    logger.info(f"PDF translation queued — job {req.job_id} arxiv={arxiv_id} → {req.target_locale}")
    return {"status": "queued", "job_id": req.job_id, "locale": req.target_locale}


@app.get("/translated/{job_id}/{arxiv_id}/{locale}")
def get_translated_shell(job_id: str, arxiv_id: str, locale: str):
    """
    Serve a streaming shell HTML that polls /translated-parts/... and appends
    page fragments to the DOM as they arrive.  Returns immediately — the shell
    handles its own loading state via JS polling.
    """
    dir_attr = "rtl" if locale in _RTL_LOCALES else "ltr"
    parts_path = f"/translated-parts/{job_id}/{arxiv_id}/{locale}"

    shell = f"""<!DOCTYPE html>
<html lang="{locale}" dir="{dir_attr}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Translating…</title>
<style>{_SHELL_CSS}</style>
</head>
<body>
<div id="ps-root"><div class="ps-loading">Translating…</div></div>
<script>
(function(){{
  var offset=0;
  var printMode=new URLSearchParams(location.search).get('print')==='1';
  function poll(){{
    fetch('{parts_path}?offset='+offset)
      .then(function(r){{return r.json();}})
      .then(function(d){{
        var el=document.getElementById('ps-root');
        if(offset===0&&d.parts.length>0)el.innerHTML='';
        d.parts.forEach(function(p){{el.insertAdjacentHTML('beforeend',p);}});
        offset+=d.parts.length;
        if(!d.done){{setTimeout(poll,900);}}
        else if(printMode){{setTimeout(function(){{window.print();}},400);}}
      }})
      .catch(function(){{setTimeout(poll,2500);}});
  }}
  poll();
}})();
</script>
</body>
</html>"""

    return Response(content=shell, media_type="text/html; charset=utf-8", headers={
        "Cache-Control":               "no-cache",
        "Access-Control-Allow-Origin": "*",
        "Content-Security-Policy":     "frame-ancestors *",
    })


@app.get("/export-pdf/{job_id}/{arxiv_id}/{locale}")
def export_pdf(job_id: str, arxiv_id: str, locale: str):
    """
    Assemble all translated HTML parts into a single standalone page and auto-trigger
    the browser print dialog.  Used by the frontend Export PDF button.
    """
    r         = get_redis()
    done_key  = f"translated_html_done:{job_id}:{arxiv_id}:{locale}"
    parts_key = f"translated_html_parts:{job_id}:{arxiv_id}:{locale}"

    if not r.exists(done_key):
        raise HTTPException(status_code=404, detail="Translation not complete or expired")

    parts = r.lrange(parts_key, 0, -1) or []
    if not parts:
        raise HTTPException(status_code=404, detail="No translated content found")

    dir_attr  = "rtl" if locale in _RTL_LOCALES else "ltr"
    body_html = "".join(parts)

    full_html = f"""<!DOCTYPE html>
<html lang="{locale}" dir="{dir_attr}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PaperSwarm — Translated Paper</title>
<style>
{_SHELL_CSS}
@media print {{
  body {{ background:#fff !important; }}
  section {{ page-break-inside:avoid; }}
  img {{ max-width:100%; page-break-inside:avoid; }}
}}
</style>
</head>
<body>
{body_html}
<script>
window.addEventListener('load', function() {{
  setTimeout(function() {{ window.print(); }}, 350);
}});
</script>
</body>
</html>"""

    return Response(content=full_html, media_type="text/html; charset=utf-8", headers={
        "Cache-Control":               "no-cache",
        "Access-Control-Allow-Origin": "*",
        "Content-Security-Policy":     "frame-ancestors *",
    })

@app.get("/export/{job_id}")
def export_graph(job_id: str, locale: str = "en"):
    """
    Export the knowledge graph as a printable HTML report (opens print dialog).
    Tries the translated graph first, falls back to English.
    """
    r = get_redis()

    raw = None
    if locale != "en":
        raw = r.get(f"translated_graph:{job_id}:{locale}")
    if not raw:
        raw = r.get(f"graph:{job_id}")
    if not raw:
        raise HTTPException(status_code=404, detail="Graph not found")

    graph = json.loads(raw)
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])

    papers   = [n for n in nodes if n.get("type") != "future_gap"]
    gaps     = [n for n in nodes if n.get("type") == "future_gap"]
    dir_attr = "rtl" if locale in _RTL_LOCALES else "ltr"

    def node_card(n):
        title    = n.get("translated_title") or n.get("title") or n.get("id", "")
        authors  = ", ".join((n.get("authors") or [])[:3])
        year     = n.get("year", "")
        abstract = n.get("translated_abstract") or n.get("abstract") or ""
        url      = n.get("url", "")
        link     = f'<a href="{url}" style="color:#0ea5e9;font-size:11px">{url}</a>' if url else ""
        return f"""
        <div style="margin-bottom:18px;padding:14px 16px;border:1px solid #e8e8e8;border-radius:8px;page-break-inside:avoid">
          <div style="font-weight:700;font-size:14px;color:#111;margin-bottom:4px">{title}</div>
          <div style="font-size:11px;color:#888;margin-bottom:6px">{authors}{"  ·  " if authors and year else ""}{year}</div>
          <div style="font-size:12px;color:#555;line-height:1.7">{abstract[:400]}{"…" if len(abstract)>400 else ""}</div>
          {"<div style='margin-top:6px'>" + link + "</div>" if link else ""}
        </div>"""

    papers_html = "".join(node_card(n) for n in papers)
    gaps_html   = "".join(
        f'<div style="margin-bottom:10px;padding:10px 14px;background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;font-size:13px;color:#7c3aed">'
        f'{n.get("translated_title") or n.get("title") or n.get("id","")}</div>'
        for n in gaps
    )
    edges_html = "".join(
        f'<div style="font-size:12px;color:#555;padding:4px 0;border-bottom:1px solid #f5f5f5">'
        f'<span style="font-weight:600">{e.get("source","")}</span>'
        f' → <span style="color:#888">{e.get("label","")}</span>'
        f' → <span style="font-weight:600">{e.get("target","")}</span></div>'
        for e in edges[:40]
    ) or "<p style='color:#aaa;font-size:12px'>No edges</p>"

    html = f"""<!DOCTYPE html>
<html lang="{locale}" dir="{dir_attr}">
<head>
<meta charset="UTF-8">
<title>PaperSwarm Graph Report — {job_id}</title>
<style>
  *{{box-sizing:border-box;margin:0;padding:0}}
  body{{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:14px;
        line-height:1.6;color:#111;background:#fff;max-width:820px;margin:0 auto;padding:36px 28px 80px}}
  h1{{font-size:1.4rem;font-weight:800;margin-bottom:6px}}
  h2{{font-size:1rem;font-weight:700;margin:28px 0 12px;padding-bottom:6px;border-bottom:2px solid #f0f0f0}}
  .meta{{font-size:12px;color:#aaa;margin-bottom:32px}}
  @media print{{body{{background:#fff}}section{{page-break-inside:avoid}}}}
</style>
</head>
<body>
<h1>PaperSwarm — Knowledge Graph Report</h1>
<div class="meta">Job: {job_id}  ·  {len(papers)} papers  ·  {len(gaps)} future gaps  ·  {len(edges)} connections</div>

<h2>Papers ({len(papers)})</h2>
{papers_html or "<p style='color:#aaa'>No papers</p>"}

{"<h2>Future Research Gaps (" + str(len(gaps)) + ")</h2>" + gaps_html if gaps else ""}

<h2>Connections</h2>
{edges_html}

<script>window.addEventListener('load',function(){{setTimeout(function(){{window.print();}},300);}});</script>
</body>
</html>"""

    return Response(content=html, media_type="text/html; charset=utf-8", headers={
        "Cache-Control":               "no-cache",
        "Access-Control-Allow-Origin": "*",
        "Content-Security-Policy":     "frame-ancestors *",
    })


@app.get("/translated-parts/{job_id}/{arxiv_id}/{locale}")
def get_translated_parts(job_id: str, arxiv_id: str, locale: str, offset: int = Query(default=0)):
    """Return new HTML fragments since `offset` and whether translation is complete."""
    r         = get_redis()
    parts_key = f"translated_html_parts:{job_id}:{arxiv_id}:{locale}"
    done_key  = f"translated_html_done:{job_id}:{arxiv_id}:{locale}"

    parts = r.lrange(parts_key, offset, -1) or []
    done  = bool(r.exists(done_key))

    return JSONResponse(
        content={"parts": parts, "done": done},
        headers={"Access-Control-Allow-Origin": "*"},
    )


@app.websocket("/ws/{job_id}")
async def websocket_endpoint(websocket: WebSocket, job_id: str):
    await websocket.accept()

    if job_id not in active_connections:
        active_connections[job_id] = []
    active_connections[job_id].append(websocket)

    logger.info(f"WS connected — job {job_id} ({len(active_connections[job_id])} client(s))")

    await websocket.send_text(json.dumps({
        "event":     "connected",
        "job_id":    job_id,
        "message":   "Connected. Waiting for agent updates...",
        "timestamp": datetime.utcnow().isoformat()
    }))

    try:
        while True:
            # Keep alive — events arrive via broadcast() from poller thread
            await asyncio.sleep(30)
            await websocket.send_text(json.dumps({
                "event":  "ping",
                "job_id": job_id
            }))
    except WebSocketDisconnect:
        active_connections[job_id].remove(websocket)
        logger.info(f"WS disconnected — job {job_id}")
    except Exception as e:
        logger.error(f"WS error for job {job_id}: {e}")
        if websocket in active_connections.get(job_id, []):
            active_connections[job_id].remove(websocket)