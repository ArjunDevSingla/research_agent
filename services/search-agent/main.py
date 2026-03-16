import asyncio
import json
import logging
import os
import time
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
 
import httpx
import redis as redis_lib
from lingodotdev import LingoDotDevEngine

LLM_PROVIDER = os.getenv("LLM_PROVIDER",  "groq")
GROQ_KEY     = os.getenv("GROQ_API_KEY",  "")
GROQ_MODEL   = os.getenv("GROQ_MODEL",    "llama-3.3-70b-versatile")
OLLAMA_URL   = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL",  "llama3.2")

def call_llm(system_prompt: str, user_prompt: str, max_tokens: int = 400) -> str:
    if LLM_PROVIDER == "groq" and GROQ_KEY:
        try:
            return _call_groq(system_prompt, user_prompt, max_tokens)
        except Exception as e:
            logger.warning(f"Groq failed: {e} — falling back to Ollama")
    return _call_ollama(system_prompt, user_prompt)

def _call_groq(system_prompt: str, user_prompt: str, max_tokens: int) -> str:
    headers = {"Authorization": f"Bearer {GROQ_KEY}", "Content-Type": "application/json"}
    body = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt}
        ],
        "max_tokens":  max_tokens,
        "temperature": 0.4,
    }
    with httpx.Client(timeout=60) as client:
        resp = client.post("https://api.groq.com/openai/v1/chat/completions",
                           headers=headers, json=body)
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()
    
def _call_ollama(system_prompt: str, user_prompt: str) -> str:
    body = {
        "model":    OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt}
        ],
        "stream": False
    }
    headers = {
        "bypass-tunnel-reminder": os.getenv("OLLAMA_TUNNEL_PASSWORD", ""),
        "Content-Type": "application/json"
    }
    with httpx.Client(timeout=120) as client:
        resp = client.post(f"{OLLAMA_URL}/api/chat", headers=headers, json=body)
        resp.raise_for_status()
        return resp.json()["message"]["content"].strip()
    
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [SEARCH-AGENT] %(levelname)s — %(message)s"
)
logger = logging.getLogger(__name__)

REDIS_URL   = os.getenv("REDIS_URL", "redis://redis:6379")
LINGO_KEY   = os.getenv("LINGODOTDEV_API_KEY", "")
SS_API_KEY  = os.getenv("SEMANTIC_SCHOLAR_API_KEY", "")
NUM_QUERIES = int(os.getenv("SEARCH_NUM_QUERIES", "5"))
PAPERS_PER_QUERY = 2
 
QUEUE_SEARCH = "search_jobs"
QUEUE_EVENTS = "ws_events"
STORE_SEARCH = "search_results"
 
GRAPH_API    = "https://api.semanticscholar.org/graph/v1"
PAPER_FIELDS = "paperId,title,abstract,year,authors,externalIds,openAccessPdf"
SS_HEADERS   = {"x-api-key": SS_API_KEY} if SS_API_KEY else {}

def get_redis():
    return redis_lib.from_url(REDIS_URL, decode_responses=True)
 
def push_event(r, event: str, job_id: str, payload: dict = {}) -> None:
    r.rpush(QUEUE_EVENTS, json.dumps({
        "event":     event,
        "job_id":    job_id,
        "payload":   payload,
        "timestamp": datetime.utcnow().isoformat()
    }))

def make_lingo():
    return LingoDotDevEngine({"api_key": LINGO_KEY}) if LINGO_KEY else None

async def detect_language(engine, text: str) -> str:
    if not engine:
        return "en"
    try:
        locale = await engine.recognize_locale(text)
        return locale or "en"
    except Exception as e:
        logger.warning(f"Language detection failed: {e}")
        return "en"
    
async def translate_to_english(engine, text: str, source_locale: str) -> str:
    if not engine or source_locale == "en":
        return text
    try:
        result = await engine.localize_text(
            text,
            {"source_locale": source_locale, "target_locale": "en", "fast": True}
        )
        logger.info(f"Translated query '{text}' → '{result}'")
        return result or text
    except Exception as e:
        logger.warning(f"Query translation failed: {e}")
        return text
 
async def translate_results(engine, papers: list, target_locale: str) -> list:
    if not engine or target_locale == "en" or not papers:
        return papers
    try:
        fields = {}
        for i, p in enumerate(papers):
            fields[f"title_{i}"]    = p.get("title", "")
            fields[f"abstract_{i}"] = (p.get("abstract") or "")[:400]
 
        translated = await engine.localize_object(
            fields,
            {"source_locale": "en", "target_locale": target_locale, "fast": True}
        )
 
        for i, p in enumerate(papers):
            p["translated_title"]    = translated.get(f"title_{i}",    p["title"])
            p["translated_abstract"] = translated.get(f"abstract_{i}", p.get("abstract", ""))
 
        logger.info(f"Translated {len(papers)} results → {target_locale}")
        return papers
    except Exception as e:
        logger.warning(f"Results translation failed: {e} — returning English")
        return papers
    
SYSTEM_PROMPT = """You are a research librarian helping find academic papers.
Given a research topic or question, generate specific Semantic Scholar search queries
that together cover different angles of the topic.
 
Rules:
- Each query must be distinct — cover a different subtopic, method, or application angle
- Queries must be in English, 4-8 words, suitable for academic search
- Focus on concrete concepts, method names, and domain terms
- No generic queries like "machine learning survey" or "deep learning overview"
- Return ONLY a JSON array of strings, nothing else
 
Example input: "transformers for vision"
Example output: ["Vision Transformer ViT image classification", "DETR object detection transformer encoder decoder", "Swin Transformer hierarchical shifted window attention", "patch embedding self-attention image recognition", "cross-attention visual feature extraction backbone"]
"""

def generate_search_queries(english_query: str, n: int) -> list[str]:
    prompt = f"Topic: {english_query}\n\nGenerate exactly {n} search queries as a JSON array."
 
    try:
        raw = call_llm(SYSTEM_PROMPT, prompt, max_tokens=300)

        clean = raw.strip()
        if clean.startswith("```"):
            clean = clean.split("```")[1]
            if clean.startswith("json"):
                clean = clean[4:]
        clean = clean.strip()
 
        queries = json.loads(clean)
        if isinstance(queries, list) and all(isinstance(q, str) for q in queries):
            logger.info(f"LLM generated {len(queries)} queries: {queries}")
            return queries[:n]
 
        logger.warning(f"LLM returned unexpected format: {raw}")
        return [english_query]
 
    except Exception as e:
        logger.warning(f"LLM query generation failed: {e} — using raw query")
        return [english_query]
    
def search_one_query(query: str, limit: int = PAPERS_PER_QUERY) -> list:
    url = f"{GRAPH_API}/paper/search"
    params = {"query": query, "fields": PAPER_FIELDS, "limit": limit + 3}
 
    try:
        with httpx.Client(timeout=12) as client:
            resp = client.get(url, headers=SS_HEADERS, params=params)
 
            if resp.status_code == 429:
                logger.warning(f"Rate limited on query '{query}' — skipping")
                return []   # caller handles fallback
 
            resp.raise_for_status()
            data = resp.json()
 
    except Exception as e:
        logger.warning(f"SS search failed for '{query}': {e}")
        return []
 
    papers = []
    for p in data.get("data", []):
        arxiv_id = p.get("externalIds", {}).get("ArXiv")
        if not p.get("abstract") or not arxiv_id:
            continue
        pdf_url  = (
            (p.get("openAccessPdf") or {}).get("url")
            or (f"https://arxiv.org/pdf/{arxiv_id}" if arxiv_id else None)
        )
        papers.append({
            "paper_id":  p.get("paperId", ""),
            "title":     p.get("title", ""),
            "abstract":  p.get("abstract", ""),
            "year":      p.get("year"),
            "authors":   [a["name"] for a in p.get("authors", [])],
            "arxiv_url": f"https://arxiv.org/abs/{arxiv_id}" if arxiv_id else None,
            "pdf_url":   pdf_url,
        })
        if len(papers) >= limit:
            break
 
    return papers

def search_via_paper_lookup(query: str, limit: int = 5) -> list:
    """
    Fallback: find a seed paper by title match, then get its recommendations.
    Used when /paper/search returns 403.
    """
    # Step 1: find a paper matching the query
    url    = f"{GRAPH_API}/paper/search"
    params = {"query": query, "fields": "paperId,title", "limit": 1}
    try:
        with httpx.Client(timeout=12) as client:
            resp = client.get(url, headers=SS_HEADERS, params=params)
            if not resp.ok:
                return []
            hits = resp.json().get("data", [])
            if not hits:
                return []
            paper_id = hits[0]["paperId"]
    except Exception:
        return []
 
    # Step 2: get recommendations for that paper
    rec_url = f"https://api.semanticscholar.org/recommendations/v1/papers/forpaper/{paper_id}"
    params  = {"fields": PAPER_FIELDS, "limit": limit + 3}
    try:
        with httpx.Client(timeout=12) as client:
            resp = client.get(rec_url, headers=SS_HEADERS, params=params)
            if not resp.ok:
                return []
            data = resp.json()
    except Exception:
        return []
 
    papers = []
    for p in data.get("recommendedPapers", []):
        arxiv_id = p.get("externalIds", {}).get("ArXiv")
        if not p.get("abstract") or not arxiv_id:
            continue
        pdf_url  = (
            (p.get("openAccessPdf") or {}).get("url")
            or (f"https://arxiv.org/pdf/{arxiv_id}" if arxiv_id else None)
        )
        papers.append({
            "paper_id":  p.get("paperId", ""),
            "title":     p.get("title", ""),
            "abstract":  p.get("abstract", ""),
            "year":      p.get("year"),
            "authors":   [a["name"] for a in p.get("authors", [])],
            "arxiv_url": f"https://arxiv.org/abs/{arxiv_id}" if arxiv_id else None,
            "pdf_url":   pdf_url,
        })
        if len(papers) >= limit:
            break
    return papers

def search_parallel(queries: list[str]) -> list: 
    seen       = set()
    results    = []
    rate_hits  = 0
 
    with ThreadPoolExecutor(max_workers=min(len(queries), 5)) as pool:
        futures = {pool.submit(search_one_query, q): q for q in queries}
 
        for future in as_completed(futures):
            query   = futures[future]
            papers  = future.result()
 
            if not papers:
                rate_hits += 1
                logger.info(f"Query '{query}' returned 0 results")
                continue
 
            for p in papers:
                pid = p["paper_id"]
                if pid and pid not in seen:
                    seen.add(pid)
                    results.append(p)
 
    if rate_hits > len(queries) // 2:
        logger.warning(f"Rate limited on {rate_hits}/{len(queries)} queries")
 
    logger.info(f"Parallel search: {len(results)} unique papers from {len(queries)} queries")
    return results

async def process_job(job: dict, r) -> None:
    job_id         = job["job_id"]
    original_query = job["query"]
    given_locale   = job.get("locale", "")
 
    logger.info(f"Job {job_id} — query: '{original_query}'")
    push_event(r, "search_started", job_id, {"query": original_query})
 
    engine = make_lingo()
 
    detected_locale = await detect_language(engine, original_query)
    target_locale   = detected_locale if detected_locale and detected_locale != "en" else (given_locale or "en")
    logger.info(f"Job {job_id} — given_locale={given_locale} detected={detected_locale} using={target_locale}")
 
    english_query = await translate_to_english(engine, original_query, target_locale)
 
    push_event(r, "search_generating_queries", job_id, {
        "query": english_query, "locale": target_locale
    })
 
    queries = generate_search_queries(english_query, NUM_QUERIES)
 
    if not SS_API_KEY and len(queries) > 3:
        logger.info("No SS API key — reducing to 3 queries to avoid rate limits")
        queries = queries[:3]
 
    push_event(r, "search_querying_ss", job_id, {
        "queries": queries,
        "count":   len(queries)
    })
 
    papers = search_parallel(queries)
 
    if not papers:
        logger.warning(f"Job {job_id} — all queries rate-limited, trying single fallback")
        papers = search_one_query(english_query, limit=5)
 
    if not papers:
        push_event(r, "search_no_results", job_id, {
            "query":   english_query,
            "message": "No papers found. Try a different query."
        })
        return
 
    papers = await translate_results(engine, papers, target_locale)
 
    store_key = f"{STORE_SEARCH}:{job_id}"
    r.set(store_key, json.dumps({
        "job_id":        job_id,
        "query":         original_query,
        "english_query": english_query,
        "target_locale": target_locale,
        "queries_used":  queries,
        "papers":        papers
    }))
    r.expire(store_key, 3600)
 
    push_event(r, "search_results", job_id, {
        "query":           original_query,
        "detected_locale": detected_locale,
        "target_locale":   target_locale,
        "queries_used":    queries,
        "papers": [
            {
                "paper_id":           p["paper_id"],
                "title":              p["title"],
                "translated_title":   p.get("translated_title"),
                "abstract":           (p.get("abstract") or "")[:300],
                "translated_abstract":p.get("translated_abstract"),
                "year":               p.get("year"),
                "authors":            p.get("authors", [])[:3],
                "arxiv_url":          p.get("arxiv_url"),
            }
            for p in papers
        ]
    })
 
    logger.info(
        f"Job {job_id} — done. "
        f"{len(queries)} queries → {len(papers)} unique papers → locale={target_locale}"
    )

def main():
    r    = get_redis()
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
 
    logger.info(
        f"Search agent started — "
        f"LLM_PROVIDER={os.getenv('LLM_PROVIDER','groq')} "
        f"NUM_QUERIES={NUM_QUERIES} "
        f"SS_API_KEY={'set' if SS_API_KEY else 'not set'}"
    )
 
    while True:
        try:
            result = r.blpop(QUEUE_SEARCH, timeout=2)
            if result:
                _, raw = result
                job    = json.loads(raw)
                try:
                    loop.run_until_complete(process_job(job, r))
                except Exception as e:
                    job_id = job.get("job_id", "unknown")
                    logger.exception(f"Error on job {job_id}: {e}")
                    push_event(r, "search_error", job_id,
                               {"message": "Search failed. Please try again."})
 
        except redis_lib.ConnectionError:
            logger.error("Redis disconnected — retrying in 5s")
            time.sleep(5)
        except Exception as e:
            logger.exception(f"Unexpected error: {e}")
            time.sleep(1)
 
 
if __name__ == "__main__":
    main()