import json
import logging
import os
import time
from datetime import datetime
import httpx
import redis
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [RECONCILER] %(levelname)s — %(message)s"
)
logger = logging.getLogger(__name__)


REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")

QUEUE_RECONCILER = "reconciler_jobs"
QUEUE_LINGO      = "lingo_jobs"
QUEUE_EVENTS     = "ws_events"

STORE_SIMILARITY      = "similarity_results"
STORE_FUTURE_RESEARCH = "future_research_results"
TRACKER_PREFIX        = "tracker:"
GRAPH_PREFIX          = "graph:"

POLL_INTERVAL = 2   # seconds between tracker checks

LLM_PROVIDER    = os.getenv("LLM_PROVIDER", "groq")
GROQ_API_KEY    = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL      = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_API_URL    = "https://api.groq.com/openai/v1/chat/completions"
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL    = os.getenv("OLLAMA_MODEL", "llama3.1:8b")

def get_redis():
    return redis.from_url(REDIS_URL, decode_responses=True)

def push_event(r, event: str, job_id: str, payload: dict = {}) -> None:
    r.rpush(QUEUE_EVENTS, json.dumps({
        "event":     event,
        "job_id":    job_id,
        "payload":   payload,
        "timestamp": datetime.utcnow().isoformat()
    }))

def get_tracker(r, job_id: str, worker_type: str) -> tuple:
    key = f"{TRACKER_PREFIX}{job_id}:{worker_type}"
    raw = r.get(key)
    if not raw:
        return 0, 0
    data = json.loads(raw)
    return data.get("completed", 0), data.get("total", 0)

def all_workers_done(r, job_id: str) -> bool:
    sim_done, sim_total     = get_tracker(r, job_id, "similarity")
    fut_done, fut_total     = get_tracker(r, job_id, "future_research")

    if sim_total == 0 or fut_total == 0:
        return False

    return sim_done >= sim_total and fut_done >= fut_total


def read_similarity_results(r, job_id: str) -> list[dict]:
    key     = f"{STORE_SIMILARITY}:{job_id}"
    raw_map = r.hgetall(key)
    results = []
    for _, raw in raw_map.items():
        try:
            results.append(json.loads(raw))
        except json.JSONDecodeError:
            continue
    return results

def read_future_research_results(r, job_id: str) -> list[dict]:
    key     = f"{STORE_FUTURE_RESEARCH}:{job_id}"
    raw_map = r.hgetall(key)
    results = []
    for _, raw in raw_map.items():
        try:
            results.append(json.loads(raw))
        except json.JSONDecodeError:
            continue
    return results

def call_llm(prompt: str) -> str:
    if LLM_PROVIDER == "groq" and GROQ_API_KEY:
        try:
            resp = httpx.post(
                GROQ_API_URL,
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type":  "application/json"
                },
                json={
                    "model":       GROQ_MODEL,
                    "max_tokens":  2000,
                    "messages":    [{"role": "user", "content": prompt}]
                },
                timeout=30
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]
        except Exception as e:
            logger.warning(f"Groq call failed: {e} — falling back to Ollama")

    resp = httpx.post(
        f"{OLLAMA_BASE_URL}/api/generate",
        json={
            "model":  OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False
        },
        timeout=60
    )
    resp.raise_for_status()
    return resp.json()["response"]

def deduplicate_gaps(gaps: list[dict]) -> list[dict]:
    if len(gaps) <= 1:
        return gaps

    titles_block = "\n".join(
        f"{i+1}. {g['gap_title']}" for i, g in enumerate(gaps)
    )

    prompt = f"""You are a research analysis assistant. Below is a numbered list of research gaps extracted from papers.

Your task: identify groups of gap titles that describe the SAME underlying research problem, just worded differently.

Rules:
- Only group gaps that are genuinely about the same core problem
- If a gap is unique, list it alone
- Return ONLY a JSON array of groups. Each group is an array of integers (the gap numbers).
- No explanation. No markdown. Just the raw JSON array.

Example output format:
[[1, 4, 7], [2], [3, 5], [6]]

Gap titles:
{titles_block}

JSON:"""

    try:
        raw  = call_llm(prompt)
        raw  = raw.strip().replace("```json", "").replace("```", "").strip()
        groups: list[list[int]] = json.loads(raw)
    except Exception as e:
        logger.warning(f"Gap deduplication LLM call failed: {e} — skipping dedup")
        return gaps

    merged_gaps = []

    for group in groups:
        indices = [i - 1 for i in group if 0 < i <= len(gaps)]
        if not indices:
            continue

        canonical = max((gaps[i] for i in indices), key=lambda g: g["confidence"])

        if len(indices) > 1:
            all_supporting = set(canonical.get("supporting_papers", []))
            all_solved_by  = set(canonical.get("solved_by", []))
            all_working_on = set(canonical.get("working_on", []))

            for i in indices:
                g = gaps[i]
                all_supporting.update(g.get("supporting_papers", []))
                all_solved_by.update(g.get("solved_by", []))
                all_working_on.update(g.get("working_on", []))

            canonical["supporting_papers"] = list(all_supporting)
            canonical["solved_by"]         = list(all_solved_by)
            canonical["working_on"]        = list(all_working_on)
            canonical["deduplicated"]      = True
            canonical["merged_count"]      = len(indices)

            logger.info(
                f"Deduplication: merged {len(indices)} gaps into '{canonical['gap_title']}'"
            )

        merged_gaps.append(canonical)

    if len(merged_gaps) == 0:
        logger.warning("Deduplication returned empty list — using original gaps")
        return gaps

    logger.info(f"Deduplication: {len(gaps)} gaps → {len(merged_gaps)} after merge")
    return merged_gaps



def boost_gap_confidence(gaps: list[dict], similarity_results: list[dict]) -> list[dict]:
    if not similarity_results:
        return gaps

    similar_titles  = {r["target_title"] for r in similarity_results}
    total_similar   = len(similar_titles)

    for gap in gaps:
        mentions  = gap.get("supporting_papers", [])
        confirmed = sum(1 for m in mentions if m in similar_titles)

        if confirmed > 0:
            mention_ratio              = confirmed / total_similar
            boost                      = mention_ratio * 0.30
            gap["confidence"]          = min(gap["confidence"] + boost, 0.95)
            gap["confidence_boosted"]  = True
            gap["mention_ratio"]       = round(mention_ratio, 3)
            gap["confirmed_mentions"]  = confirmed

    return gaps

def build_cross_links(gaps: list[dict], similarity_results: list[dict]) -> list[dict]:
    edges = []
    paper_id_map = {r["target_title"]: r["target_paper_id"] for r in similarity_results}

    for gap in gaps:
        gap_id = f"gap_{gap['gap_title'].lower().replace(' ', '_')[:30]}"

        for title in gap.get("solved_by", []):
            paper_id = paper_id_map.get(title)
            if paper_id:
                edges.append({
                    "source":    paper_id,
                    "target":    gap_id,
                    "weight":    1.0,
                    "label":     "solves",
                    "edge_type": "solves"
                })

        for title in gap.get("working_on", []):
            paper_id = paper_id_map.get(title)
            if paper_id:
                edges.append({
                    "source":    paper_id,
                    "target":    gap_id,
                    "weight":    0.6,
                    "label":     "working on",
                    "edge_type": "working_on"
                })

        already_linked = set(gap.get("solved_by", [])) | set(gap.get("working_on", []))
        for title in gap.get("supporting_papers", []):
            if title not in already_linked:
                paper_id = paper_id_map.get(title)
                if paper_id:
                    edges.append({
                        "source":    paper_id,
                        "target":    gap_id,
                        "weight":    0.3,
                        "label":     "mentions gap",
                        "edge_type": "mentions_gap"
                    })

    return edges

def build_knowledge_graph(
    job_id: str,
    seed_title: str,
    similarity_results: list[dict],
    gaps: list[dict],
    seed_meta: dict = {},
) -> dict:
    nodes = []
    edges = []

    seed_id = "seed"
    nodes.append({
        "id":    seed_id,
        "type":  "seed",
        "label": seed_title,
        "data":  {"title": seed_title}
    })

    for result in similarity_results:
        paper_id = result["target_paper_id"]

        nodes.append({
            "id":    paper_id,
            "type":  "similar_paper",
            "label": result["target_title"],
            "data":  result
        })

        edges.append({
            "source":    seed_id,
            "target":    paper_id,
            "weight":    result["similarity_score"],
            "label":     " · ".join(result.get("similarity_type", [])),
            "edge_type": "similar_to"
        })

    cross_edges = build_cross_links(gaps, similarity_results)

    for gap in gaps:
        gap_id = f"gap_{gap['gap_title'].lower().replace(' ', '_')[:30]}"

        gap_data = dict(gap)
        gap_data["source_paper"] = gap.get("compared_with") or seed_title

        nodes.append({
            "id":    gap_id,
            "type":  "future_gap",
            "label": gap["gap_title"],
            "data":  gap_data
        })

        edges.append({
            "source":    seed_id,
            "target":    gap_id,
            "weight":    gap["confidence"],
            "label":     gap["status"],
            "edge_type": "future_gap"
        })

    edges.extend(cross_edges)

    gaps_open    = sum(1 for g in gaps if g["status"] == "open")
    gaps_partial = sum(1 for g in gaps if g["status"] == "partially_solved")
    gaps_solved  = sum(1 for g in gaps if g["status"] == "solved")

    return {
        "job_id":                job_id,
        "seed_title":            seed_title,
        "nodes":                 nodes,
        "edges":                 edges,
        "total_papers_analyzed": len(similarity_results),
        "total_gaps_found":      len(gaps),
        "gaps_open":             gaps_open,
        "gaps_partial":          gaps_partial,
        "gaps_solved":           gaps_solved,
        "completed_at":          datetime.utcnow().isoformat()
    }

def reconcile(job_id: str, r) -> None:
    logger.info(f"Job {job_id} — starting reconciliation")

    push_event(r, "reconciler_started", job_id)

    similarity_results = read_similarity_results(r, job_id)
    gaps               = read_future_research_results(r, job_id)

    logger.info(
        f"Job {job_id} — "
        f"{len(similarity_results)} similarity results, "
        f"{len(gaps)} gaps"
    )

    if not similarity_results:
        logger.error(f"Job {job_id} — no similarity results found, aborting")
        push_event(r, "error", job_id, {"message": "No similarity results found."})
        return

    seed_title = similarity_results[0]["seed_title"]

    seed_meta_raw = r.get(f"seed_meta:{job_id}")
    seed_meta     = json.loads(seed_meta_raw) if seed_meta_raw else {}

    push_event(r, "deduplicating_gaps", job_id, {"gap_count": len(gaps)})
    gaps = deduplicate_gaps(gaps)

    gaps = boost_gap_confidence(gaps, similarity_results)

    gaps.sort(key=lambda g: g["confidence"], reverse=True)

    graph = build_knowledge_graph(job_id, seed_title, similarity_results, gaps, seed_meta=seed_meta)

    logger.info(
        f"Job {job_id} — graph built: "
        f"{len(graph['nodes'])} nodes, "
        f"{len(graph['edges'])} edges"
    )

    graph_key = f"{GRAPH_PREFIX}{job_id}"
    r.set(graph_key, json.dumps(graph))
    r.expire(graph_key, 3600)

    r.rpush(QUEUE_LINGO, json.dumps({
        "job_id":  job_id,
        "graph":   graph
    }))

    logger.info(f"Job {job_id} — pushed to lingo queue")

    push_event(r, "graph_ready", job_id, {
        "total_papers_analyzed": graph["total_papers_analyzed"],
        "total_gaps_found":      graph["total_gaps_found"],
        "gaps_open":             graph["gaps_open"],
        "gaps_partial":          graph["gaps_partial"],
        "gaps_solved":           graph["gaps_solved"],
        "node_count":            len(graph["nodes"]),
        "edge_count":            len(graph["edges"])
    })

    logger.info(f"Job {job_id} — reconciliation complete ✓")


pending_jobs: dict[str, float] = {}

JOB_TIMEOUT = 600


def process_incoming_jobs(r) -> None:
    while True:
        result = r.lpop(QUEUE_RECONCILER)
        if not result:
            break
        try:
            job    = json.loads(result)
            job_id = job.get("job_id")
            if job_id and job_id not in pending_jobs:
                pending_jobs[job_id] = time.time()
                logger.info(f"Job {job_id} — registered, waiting for all workers")
        except json.JSONDecodeError:
            continue


def check_pending_jobs(r) -> None:
    now        = time.time()
    completed  = []

    for job_id, first_seen in pending_jobs.items():
        if now - first_seen > JOB_TIMEOUT:
            logger.warning(f"Job {job_id} — timed out after {JOB_TIMEOUT}s, dropping")
            completed.append(job_id)
            push_event(r, "error", job_id, {
                "message": "Job timed out waiting for workers to complete."
            })
            continue

        sim_done, sim_total = get_tracker(r, job_id, "similarity")
        fut_done, fut_total = get_tracker(r, job_id, "future_research")
        if sim_done > 0 or fut_done > 0:
            push_event(r, "workers_progress", job_id, {
                "similarity_done":  sim_done,
                "similarity_total": sim_total,
                "future_done":      fut_done,
                "future_total":     fut_total,
            })

        if all_workers_done(r, job_id):
            try:
                reconcile(job_id, r)
            except Exception as e:
                logger.exception(f"Job {job_id} — reconciliation failed: {e}")
                push_event(r, "error", job_id, {"message": str(e)})
            completed.append(job_id)

    for job_id in completed:
        pending_jobs.pop(job_id, None)

def main():
    r = get_redis()
    logger.info("Reconciler started")

    while True:
        try:
            # Step 1: Pick up any new jobs from queue
            process_incoming_jobs(r)

            # Step 2: Check if any pending jobs are ready
            if pending_jobs:
                check_pending_jobs(r)

            time.sleep(POLL_INTERVAL)

        except redis.ConnectionError:
            logger.error("Redis connection lost — retrying in 5s")
            time.sleep(5)

        except Exception as e:
            logger.exception(f"Unexpected error: {e}")
            time.sleep(1)


if __name__ == "__main__":
    main()