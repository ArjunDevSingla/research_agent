import json
import logging
import os
import time
from datetime import datetime

import redis
import httpx

from pdf_extractor import fetch_paper_sections
from prompts import SYSTEM_PROMPT, build_user_prompt

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [FUTURE-WORKER] %(levelname)s — %(message)s"
)
logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")

QUEUE_FUTURE_RESEARCH = "future_research_jobs"
QUEUE_RECONCILER      = "reconciler_jobs"
QUEUE_EVENTS          = "ws_events"

STORE_FUTURE_RESEARCH = "future_research_results"
TRACKER_PREFIX        = "tracker:"

GROQ_KEY     = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL   = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
OLLAMA_URL   = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "groq")

def get_redis():
    return redis.from_url(REDIS_URL, decode_responses=True)

def call_llm(system_prompt: str, user_prompt: str) -> str:
    if LLM_PROVIDER == "groq" and GROQ_KEY:
        try:
            return _call_groq(system_prompt, user_prompt)
        except Exception as e:
            logger.warning(f"Groq failed: {e} — falling back to Ollama")
    return _call_ollama(system_prompt, user_prompt)


def _call_groq(system_prompt: str, user_prompt: str) -> str:
    headers = {
        "Authorization": f"Bearer {GROQ_KEY}",
        "Content-Type":  "application/json"
    }
    body = {
        "model":    GROQ_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt}
        ],
        "max_tokens":  2000,
        "temperature": 0.3
    }
    with httpx.Client(timeout=60) as client:
        resp = client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers=headers,
            json=body
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()


def _call_ollama(system_prompt: str, user_prompt: str) -> str:
    body = {
        "model":   OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt}
        ],
        "stream": False
    }
    with httpx.Client(timeout=180) as client:
        resp = client.post(f"{OLLAMA_URL}/api/chat", json=body)
        resp.raise_for_status()
        return resp.json()["message"]["content"].strip()


def parse_llm_output(raw: str, job: dict) -> list[dict]:
    try:
        clean = raw.strip()
        if clean.startswith("```"):
            clean = clean.split("```")[1]
            if clean.startswith("json"):
                clean = clean[4:]
        clean = clean.strip()

        gaps = json.loads(clean)

        if isinstance(gaps, dict):
            gaps = gaps.get("gaps", [])

        results = []
        for gap in gaps:
            status = gap.get("status", "open")
            if status not in ["open", "partially_solved", "solved"]:
                status = "open"

            gap_source = gap.get("gap_source", "seed_text")
            if gap_source not in ["seed_text", "comparative"]:
                gap_source = "seed_text"

            results.append({
                "job_id":             job["job_id"],
                "seed_title":         job["seed_title"],
                "gap_title":          gap.get("gap_title", "Unknown Gap"),
                "gap_description":    gap.get("gap_description", ""),
                "gap_source":         gap_source,
                "compared_with":      gap.get("compared_with", ""),
                "confidence":         float(gap.get("confidence", 0.5)),
                "status":             status,
                "solved_by":          gap.get("solved_by", []),
                "working_on":         gap.get("working_on", []),
                "still_open_aspects": gap.get("still_open_aspects", []),
                "supporting_papers":  gap.get("supporting_papers", []),
                "research_questions": gap.get("research_questions", []),
                "locale":             job.get("target_locale", "en")
            })

        return results

    except (json.JSONDecodeError, KeyError, ValueError) as e:
        logger.warning(f"LLM parse failed: {e} — using fallback gap")
        return [{
            "job_id":             job["job_id"],
            "seed_title":         job["seed_title"],
            "gap_title":          "Analysis incomplete",
            "gap_description":    raw[:300],
            "gap_source":         "seed_text",
            "compared_with":      "",
            "confidence":         0.3,
            "status":             "open",
            "solved_by":          [],
            "working_on":         [],
            "still_open_aspects": [],
            "supporting_papers":  [],
            "research_questions": [],
            "locale":             job.get("target_locale", "en")
        }]
    
def push_event(r, event: str, job_id: str, payload: dict = {}) -> None:
    r.rpush(QUEUE_EVENTS, json.dumps({
        "event":     event,
        "job_id":    job_id,
        "payload":   payload,
        "timestamp": datetime.utcnow().isoformat()
    }))


def increment_tracker(r, job_id: str) -> tuple:
    key  = f"{TRACKER_PREFIX}{job_id}:future_research"
    raw  = r.get(key)
    if not raw:
        return 0, 0
    data              = json.loads(raw)
    data["completed"] += 1
    r.set(key, json.dumps(data))
    return data["completed"], data["total"]


def process_job(job: dict, r) -> None:
    job_id    = job["job_id"]
    seed_title = job["seed_title"]

    logger.info(f"Job {job_id} — extracting research gaps for: '{seed_title}'")

    push_event(r, "worker_started", job_id, {
        "worker_type": "future_research",
        "paper_title": seed_title
    })

    logger.info(f"Job {job_id} — downloading seed PDF")

    seed_sections = fetch_paper_sections(job.get("seed_pdf_url", ""))

    found_sections = [k for k, v in seed_sections.items() if v]
    logger.info(
        f"Job {job_id} — extracted sections: "
        f"{found_sections if found_sections else 'none — using abstract fallback'}"
    )

    user_prompt = build_user_prompt(
        seed_title=seed_title,
        seed_abstract=job["seed_abstract"],
        seed_sections=seed_sections,
        related_papers=job.get("related_papers", [])
    )

    logger.info(f"Job {job_id} — calling LLM for gap analysis")
    raw     = call_llm(SYSTEM_PROMPT, user_prompt)
    results = parse_llm_output(raw, job)

    n_open    = sum(1 for r_ in results if r_["status"] == "open")
    n_partial = sum(1 for r_ in results if r_["status"] == "partially_solved")
    n_solved  = sum(1 for r_ in results if r_["status"] == "solved")

    logger.info(
        f"Job {job_id} — found {len(results)} gaps: "
        f"{n_open} open, {n_partial} partial, {n_solved} solved"
    )

    key = f"{STORE_FUTURE_RESEARCH}:{job_id}"

    for i, result in enumerate(results):
        r.hset(key, f"gap_{i}", json.dumps(result))
        r.rpush(QUEUE_RECONCILER, json.dumps({
            "job_id":      job_id,
            "worker_type": "future_research",
            "result":      result
        }))

    r.expire(key, 3600)

    completed, total = increment_tracker(r, job_id)

    push_event(r, "worker_complete", job_id, {
        "worker_type":      "future_research",
        "gaps_found":       len(results),
        "gaps_open":        n_open,
        "gaps_partial":     n_partial,
        "gaps_solved":      n_solved,
        "sections_used":    found_sections,
        "completed":        completed,
        "total":            total
    })

def main():
    r = get_redis()
    logger.info("Future research worker started — listening on future_research_jobs queue")

    while True:
        try:
            result = r.blpop(QUEUE_FUTURE_RESEARCH, timeout=2)

            if result:
                _, raw = result
                job    = json.loads(raw)

                try:
                    process_job(job, r)
                except Exception as e:
                    logger.exception(
                        f"Error processing job {job.get('job_id')}: {e}"
                    )

        except redis.ConnectionError:
            logger.error("Redis connection lost — retrying in 5s")
            time.sleep(5)

        except Exception as e:
            logger.exception(f"Unexpected error: {e}")
            time.sleep(1)


if __name__ == "__main__":
    main()