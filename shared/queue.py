"""
shared/queue.py
Redis queue helpers used by every service.
All inter-service communication goes through these helpers.
"""

import redis
import json
import os
import logging
from typing import Optional, Any

logger = logging.getLogger(__name__)

# Queue names — single source of truth
QUEUE_PLANNER         = "planner_jobs"
QUEUE_DISCOVERY       = "discovery_jobs"
QUEUE_SIMILARITY      = "similarity_jobs"
QUEUE_FUTURE_RESEARCH = "future_research_jobs"
QUEUE_RECONCILER      = "reconciler_jobs"
QUEUE_LINGO           = "lingo_jobs"
QUEUE_EVENTS          = "ws_events"          # Gateway reads this to push WS events

# Result stores (Redis hashes keyed by job_id)
STORE_SIMILARITY      = "similarity_results"
STORE_FUTURE_RESEARCH = "future_research_results"
STORE_GRAPH           = "graph_results"

# Job tracking (how many workers expected vs completed)
TRACKER_PREFIX        = "tracker:"


def get_redis() -> redis.Redis:
    url = os.getenv("REDIS_URL", "redis://redis:6379")
    return redis.from_url(url, decode_responses=True)


def push(r: redis.Redis, queue: str, data: Any) -> None:
    """Push a job onto the right end of a queue."""
    r.rpush(queue, json.dumps(data if isinstance(data, dict) else data.dict()))
    logger.debug(f"Pushed to {queue}")


def pop(r: redis.Redis, queue: str, timeout: int = 2) -> Optional[dict]:
    """
    Blocking pop from queue. Returns parsed dict or None.
    timeout=2 means wait 2 seconds before returning None if queue empty.
    """
    result = r.blpop(queue, timeout=timeout)
    if result:
        _, raw = result
        return json.loads(raw)
    return None


def store_result(r: redis.Redis, store: str, job_id: str, field: str, data: Any) -> None:
    """Store a worker result in a Redis hash."""
    key = f"{store}:{job_id}"
    r.hset(key, field, json.dumps(data if isinstance(data, dict) else data.dict()))
    r.expire(key, 3600)              # Results expire after 1 hour


def get_results(r: redis.Redis, store: str, job_id: str) -> dict:
    """Get all results for a job from a Redis hash."""
    key = f"{store}:{job_id}"
    raw = r.hgetall(key)
    return {k: json.loads(v) for k, v in raw.items()}


def set_tracker(r: redis.Redis, job_id: str, worker_type: str, total: int) -> None:
    """Tell the reconciler how many workers to expect."""
    key = f"{TRACKER_PREFIX}{job_id}:{worker_type}"
    r.set(key, json.dumps({"total": total, "completed": 0}))
    r.expire(key, 3600)


def increment_tracker(r: redis.Redis, job_id: str, worker_type: str) -> tuple[int, int]:
    """Increment completed count. Returns (completed, total)."""
    key = f"{TRACKER_PREFIX}{job_id}:{worker_type}"
    raw = r.get(key)
    if not raw:
        return 0, 0
    data = json.loads(raw)
    data["completed"] += 1
    r.set(key, json.dumps(data))
    return data["completed"], data["total"]


def push_event(r: redis.Redis, event: str, job_id: str, payload: dict = {}) -> None:
    """Push a WebSocket event for the gateway to forward to the dashboard."""
    push(r, QUEUE_EVENTS, {
        "event": event,
        "job_id": job_id,
        "payload": payload
    })
