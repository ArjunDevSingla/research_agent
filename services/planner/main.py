import json
import logging
import os
import time
from datetime import datetime
import redis

from paper_fetcher import fetch_paper_metadata, fetch_similar_papers

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [PLANNER] %(levelname)s — %(message)s"
)
logger = logging.getLogger(__name__)


REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")

QUEUE_PLANNER         = "planner_jobs"
QUEUE_SIMILARITY      = "similarity_jobs"
QUEUE_FUTURE_RESEARCH = "future_research_jobs"
QUEUE_EVENTS          = "ws_events"

TRACKER_PREFIX        = "tracker:"

def get_redis():
    return redis.from_url(REDIS_URL, decode_responses=True)

def push_to_queue(r, queue: str, data: dict) -> None:
    r.rpush(queue, json.dumps(data))

def push_event(r, event: str, job_id: str, payload: dict = {}) -> None:
    r.rpush(QUEUE_EVENTS, json.dumps({
        "event":     event,
        "job_id":    job_id,
        "payload":   payload,
        "timestamp": datetime.utcnow().isoformat()
    }))

def set_tracker(r, job_id: str, worker_type: str, total: int) -> None:
    key = f"{TRACKER_PREFIX}{job_id}:{worker_type}"
    r.set(key, json.dumps({"total": total, "completed": 0}))
    r.expire(key, 3600)    # auto-cleanup after 1 hour
    logger.info(f"Tracker set — job {job_id} expects {total} {worker_type} worker(s)")


# ── Core planner logic ─────────────────────────────────────────────────────────

def run_planner(job: dict, r) -> None:
    """
    Process one job from the planner queue.

    job = {
      job_id, arxiv_url, target_locale, max_papers, created_at
    }
    """
    job_id       = job["job_id"]
    arxiv_url    = job["arxiv_url"]
    target_locale = job.get("target_locale", "en")
    max_papers   = job.get("max_papers", 8)

    logger.info(f"Job {job_id} — starting: {arxiv_url}")

    push_event(r, "job_started", job_id, {
        "arxiv_url":    arxiv_url,
        "target_locale": target_locale
    })

    logger.info(f"Job {job_id} — fetching seed paper metadata")

    seed = fetch_paper_metadata(arxiv_url)

    if not seed:
        logger.error(f"Job {job_id} — failed to fetch seed paper")
        push_event(r, "error", job_id, {
            "message": f"Could not fetch paper from: {arxiv_url}. "
                       f"Make sure it is a valid arxiv URL."
        })
        return

    logger.info(f"Job {job_id} — seed paper: '{seed['title']}' pdf={'yes' if seed.get('pdf_url') else 'no'}")

    r.set(f"seed_meta:{job_id}", json.dumps({
        "title":    seed["title"],
        "abstract": seed.get("abstract", ""),
        "authors":  seed.get("authors", []),
        "year":     seed.get("year"),
        "arxiv_url": seed.get("arxiv_url", ""),
        "pdf_url":  seed.get("pdf_url", ""),
    }), ex=3600)

    logger.info(f"Job {job_id} — fetching similar papers (max={max_papers})")

    similar_papers = fetch_similar_papers(
        paper_id=seed["paper_id"],
        limit=max_papers
    )

    if not similar_papers:
        logger.warning(f"Job {job_id} — no similar papers found")
        push_event(r, "error", job_id, {
            "message": "No similar papers found. Try a different paper."
        })
        return

    logger.info(f"Job {job_id} — found {len(similar_papers)} similar papers")

    push_event(r, "discovery_complete", job_id, {
        "seed_title":    seed["title"],
        "seed_year":     seed["year"],
        "seed_authors":  seed["authors"][:3],   # first 3 authors only
        "similar_count": len(similar_papers)
    })

    set_tracker(r, job_id, "similarity",      total=len(similar_papers))
    set_tracker(r, job_id, "future_research", total=1)

    logger.info(f"Job {job_id} — spawning {len(similar_papers)} similarity workers")

    for paper in similar_papers:
        similarity_job = {
            "job_id":           job_id,
            "seed_title":       seed["title"],
            "seed_abstract":    seed["abstract"],
            "target_paper_id":  paper["paper_id"],
            "target_title":     paper["title"],
            "target_abstract":  paper["abstract"],
            "target_arxiv_url": paper.get("arxiv_url"),
            "target_authors":   paper.get("authors", []),
            "target_year":      paper.get("year"),
            "target_pdf_url":   paper.get("pdf_url"),
            "target_locale":    target_locale
        }
        push_to_queue(r, QUEUE_SIMILARITY, similarity_job)

        push_event(r, "worker_started", job_id, {
            "worker_type":  "similarity",
            "paper_title":  paper["title"],
            "paper_year":   paper.get("year")
        })

        logger.info(f"Job {job_id} — queued similarity job for: '{paper['title']}'")

    logger.info(f"Job {job_id} — spawning future research worker")

    related_papers = [
        {
            "title":    p["title"],
            "abstract": p["abstract"],
            "pdf_url":  p.get("pdf_url")    # worker uses this to download + extract sections
        }
        for p in similar_papers
        if p.get("abstract")
    ]

    future_job = {
        "job_id":          job_id,
        "seed_title":      seed["title"],
        "seed_abstract":   seed["abstract"],
        "seed_pdf_url":    seed.get("pdf_url"),   # worker downloads this for section extraction
        "related_papers":  related_papers,
        "target_locale":   target_locale
    }
    push_to_queue(r, QUEUE_FUTURE_RESEARCH, future_job)

    push_event(r, "worker_started", job_id, {
        "worker_type":          "future_research",
        "paper_title":          seed["title"],
        "related_paper_count":  len(related_papers)
    })

    logger.info(
        f"Job {job_id} — done. "
        f"Spawned {len(similar_papers)} similarity workers "
        f"+ 1 future research worker"
    )

def main():
    r = get_redis()
    logger.info("Planner started — listening on planner_jobs queue")

    while True:
        try:
            result = r.blpop(QUEUE_PLANNER, timeout=2)

            if result:
                _, raw = result
                job    = json.loads(raw)
                logger.info(f"Received job: {job.get('job_id')}")

                try:
                    run_planner(job, r)
                except Exception as e:
                    logger.exception(f"Error processing job {job.get('job_id')}: {e}")

        except redis.ConnectionError:
            logger.error("Redis connection lost — retrying in 5 seconds")
            time.sleep(5)

        except Exception as e:
            logger.exception(f"Unexpected planner error: {e}")
            time.sleep(1)


if __name__ == "__main__":
    main()