import time
import logging
import re
from typing import Optional
import httpx

logger = logging.getLogger(__name__)

# ── API Base URLs ──────────────────────────────────────────────────────────────
GRAPH_API           = "https://api.semanticscholar.org/graph/v1"
RECOMMENDATIONS_API = "https://api.semanticscholar.org/recommendations/v1"

HEADERS = {}

# Research paper fields
PAPER_FIELDS = "paperId,title,abstract,year,authors,externalIds,openAccessPdf"

def extract_arxiv_id(url: str) -> Optional[str]:
    """
    Extract arxiv ID from any arxiv URL format.

    Handles:
      https://arxiv.org/abs/1706.03762
      https://arxiv.org/pdf/1706.03762
      1706.03762  (raw ID)
    """
    patterns = [
        r"arxiv\.org/abs/([0-9]+\.[0-9]+)",
        r"arxiv\.org/pdf/([0-9]+\.[0-9]+)",
        r"^([0-9]+\.[0-9]+)$"
    ]
    for pattern in patterns:
        match = re.search(pattern, url.strip())
        if match:
            return match.group(1)
    return None

def safe_get(url:str, params: dict = {}, retries: int = 3) -> Optional[dict]:
    for attempt in range(retries):
        try:
            with httpx.Client(timeout=30) as client:
                resp = client.get(url, headers=HEADERS, params=params)

                if resp.status_code == 429:
                    wait = 2 ** (attempt + 1)
                    logger.warning(f"Rate limited. Waiting {wait}s before retry {attempt + 1}/{retries}")
                    time.sleep(wait)
                    continue

                resp.raise_for_status()
                return resp.json()
            
        except httpx.TimeoutException:
            logger.warning(f"Timeout on attempt {attempt + 1}/{retries} for {url}")
            time.sleep(2 ** attempt)

        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error {e.response.status_code} for {url}")
            return None

        except Exception as e:
            logger.error(f"Unexpected error fetching {url}: {e}")
            return None

    logger.error(f"All {retries} attempts failed for {url}")
    return None

def fetch_paper_metadata(arxiv_url: str) -> Optional[dict]:
    arxiv_id = extract_arxiv_id(arxiv_url)
    if not arxiv_id:
        logger.error(f"Could not parse arxiv ID from URL: {arxiv_url}")
        return None

    logger.info(f"Fetching metadata for arxiv:{arxiv_id}")

    url  = f"{GRAPH_API}/paper/arXiv:{arxiv_id}"
    data = safe_get(url, params={"fields": PAPER_FIELDS})

    if not data:
        logger.error(f"No data returned for arxiv:{arxiv_id}")
        return None

    result = {
        "paper_id": data.get("paperId", ""),
        "title":    data.get("title", "Unknown Title"),
        "abstract": data.get("abstract", ""),
        "arxiv_id": arxiv_id,
        "year":     data.get("year"),
        "pdf_url":  (
            data.get("openAccessPdf", {}).get("url")
            or f"https://arxiv.org/pdf/{arxiv_id}"
        ),
        "authors":  [a["name"] for a in data.get("authors", [])]
    }

    logger.info(f"Fetched: '{result['title']}' ({result['year']})")
    time.sleep(1)
    return result


def fetch_similar_papers(paper_id: str, limit: int = 8) -> list[dict]:
    logger.info(f"Fetching similar papers for paper_id: {paper_id}")

    url  = f"{RECOMMENDATIONS_API}/papers/forpaper/{paper_id}"
    data = safe_get(url, params={
        "fields": PAPER_FIELDS,
        "limit":  limit
    })

    if data and "recommendedPapers" in data:
        papers = _parse_papers(data["recommendedPapers"], limit)
        if papers:
            logger.info(f"Got {len(papers)} recommendations")
            return papers

    logger.warning("Recommendations not available — falling back to citations + references")
    time.sleep(1)
    return _fetch_via_citations(paper_id, limit)

def _parse_papers(raw_papers: list, limit: int) -> list[dict]:
    papers = []

    for p in raw_papers:
        if not p.get("abstract"):
            continue

        arxiv_id = p.get("externalIds", {}).get("ArXiv")

        pdf_url = (
            p.get("openAccessPdf", {}).get("url")
            if p.get("openAccessPdf")
            else (f"https://arxiv.org/pdf/{arxiv_id}" if arxiv_id else None)
        )

        papers.append({
            "paper_id":  p.get("paperId", ""),
            "title":     p.get("title", "Unknown Title"),
            "abstract":  p.get("abstract", ""),
            "year":      p.get("year"),
            "arxiv_url": f"https://arxiv.org/abs/{arxiv_id}" if arxiv_id else None,
            "pdf_url":   pdf_url,
            "authors":   [a["name"] for a in p.get("authors", [])]
        })

        if len(papers) >= limit:
            break

    return papers


def _fetch_via_citations(paper_id: str, limit: int) -> list[dict]:
    combined = {}

    url  = f"{GRAPH_API}/paper/{paper_id}/citations"
    data = safe_get(url, params={
        "fields": PAPER_FIELDS,
        "limit":  limit * 2
    })

    if data:
        raw = [item.get("citingPaper", {}) for item in data.get("data", [])]
        for p in _parse_papers(raw, limit):
            combined[p["paper_id"]] = p

    logger.info(f"Citations strategy: {len(combined)} papers with abstracts")

    # Strategy 2 — references (fill up if citations weren't enough)
    if len(combined) < limit:
        time.sleep(1)
        url  = f"{GRAPH_API}/paper/{paper_id}/references"
        data = safe_get(url, params={
            "fields": PAPER_FIELDS,
            "limit":  limit * 2
        })

        if data:
            raw = [item.get("citedPaper", {}) for item in data.get("data", [])]
            for p in _parse_papers(raw, limit):
                if p["paper_id"] not in combined:
                    combined[p["paper_id"]] = p

    papers = list(combined.values())[:limit]
    logger.info(f"Got {len(papers)} papers via citations+references fallback")
    return papers