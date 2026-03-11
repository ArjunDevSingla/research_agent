import json
import logging
import os
import time
from datetime import datetime

import redis
import httpx

from prompts import SYSTEM_PROMPT, build_user_prompt

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [SIMILARITY-WORKER] %(levelname)s — %(message)s"
)
logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")

QUEUE_SIMILARITY  = "similarity_jobs"
QUEUE_RECONCILER  = "reconciler_jobs"
QUEUE_EVENTS      = "ws_events"

STORE_SIMILARITY  = "similarity_results"
TRACKER_PREFIX    = "tracker:"

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
        "Content-Type": "application/json"
    }
    body = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt}
        ],
        "max_tokens":  800,
        "temperature": 0.2    # low temperature = consistent structured output
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
    with httpx.Client(timeout=120) as client:
        resp = client.post(f"{OLLAMA_URL}/api/chat", json=body)
        resp.raise_for_status()
        return resp.json()["message"]["content"].strip()
    
# Parsing LLM output

def parse_llm_output(raw: str, job: dict) -> dict:
    try:
        clean = raw.strip()
        if clean.startswith("```"):
            clean = clean.split("```")[1]
            if clean.startswith("json"):
                clean = clean[4:]
        clean = clean.strip()

        data = json.loads(clean)

        score = float(data.get("similarity_score", 0.5))
        score = max(0.0, min(1.0, score))

        # Validate similarity types
        valid_types = {"methodology", "results", "problem", "dataset", "theory"}
        raw_types   = data.get("similarity_type", ["methodology"])
        sim_types   = [t for t in raw_types if t in valid_types]
        if not sim_types:
            sim_types = ["methodology"]

        return {
            "job_id":           job["job_id"],
            "seed_title":       job["seed_title"],
            "target_paper_id":  job["target_paper_id"],
            "target_title":     job["target_title"],
            "similarity_score": score,
            "similarity_type":  sim_types,
            "explanation":      data.get("explanation", ""),
            "key_connections":  data.get("key_connections", []),
            "locale":           job.get("target_locale", "en")
        }

    except (json.JSONDecodeError, KeyError, ValueError) as e:
        logger.warning(f"LLM output parse failed: {e} — using fallback result")

        # Fallback — keep the worker alive even if LLM returns garbage
        return {
            "job_id":           job["job_id"],
            "seed_title":       job["seed_title"],
            "target_paper_id":  job["target_paper_id"],
            "target_title":     job["target_title"],
            "similarity_score": 0.5,
            "similarity_type":  ["methodology"],
            "explanation":      "Analysis could not be completed for this paper.",
            "key_connections":  [],
            "locale":           job.get("target_locale", "en")
        }
    
def push_event(r, event: str, job_id: str, payload: dict = {}) -> None:
    r.rpush(QUEUE_EVENTS, json.dumps({
        "event":     event,
        "job_id":    job_id,
        "payload":   payload,
        "timestamp": datetime.utcnow().isoformat()
    }))

def store_result(r, job_id: str, paper_id: str, result: dict) -> None:
    key = f"{STORE_SIMILARITY}:{job_id}"
    r.hset(key, paper_id, json.dumps(result))
    r.expire(key, 3600)

def increment_tracker(r, job_id: str) -> tuple:
    key = f"{TRACKER_PREFIX}{job_id}:similarity"
    raw = r.get(key)
    if not raw:
        return 0, 0
    data = json.loads(raw)
    data["completed"] += 1
    r.set(key, json.dumps(data))
    return data["completed"], data["total"]

def process_job(job: dict, r) -> None:
    job_id       = job["job_id"]
    target_title = job["target_title"]

    logger.info(f"Job {job_id} — analyzing: '{target_title}'")

    user_prompt = build_user_prompt(
        seed_title=job["seed_title"],
        seed_abstract=job["seed_abstract"],
        target_title=target_title,
        target_abstract=job["target_abstract"]
    )

    raw = call_llm(SYSTEM_PROMPT, user_prompt)
    result = parse_llm_output(raw, job)

    logger.info(
        f"Job {job_id} — '{target_title}' "
        f"score={result['similarity_score']:.2f} "
        f"type={result['similarity_type']}"
    )

    store_result(r, job_id, job["target_paper_id"], result)

    r.rpush(QUEUE_RECONCILER, json.dumps({
        "job_id": job_id,
        "worker_type": "similarity",
        "result": result
    }))

    completed, total = increment_tracker(r, job_id)

    push_event(r, "worker_complete", job_id, {
        "worker_type": "similarity",
        "paper_title": target_title,
        "similarity_score": result["similarity_score"],
        "similarity_type": result["similarity_type"],
        "explanation": result["explanation"],
        "key_connections": result["key_connections"],
        "completed": completed,
        "total": total
    })

    logger.info(f"Job {job_id} — similarity workers: {completed}/{total} done")


def main():
    r = get_redis()
    logger.info("Similarity worker started — listening on similarity_jobs queue")

    while True:
        try:
            result = r.blpop(QUEUE_SIMILARITY, timeout=2)

            if result:
                _, raw = result
                job    = json.loads(raw)

                try:
                    process_job(job, r)
                except Exception as e:
                    logger.exception(
                        f"Error processing job {job.get('job_id')} "
                        f"paper '{job.get('target_title')}': {e}"
                    )

        except redis.ConnectionError:
            logger.error("Redis connection lost — retrying in 5s")
            time.sleep(5)

        except Exception as e:
            logger.exception(f"Unexpected error: {e}")
            time.sleep(1)


if __name__ == "__main__":
    main()
