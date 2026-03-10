from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import os
import asyncio
import json
import logging
import threading
import uuid
from contextlib import asynccontextmanager
from datetime import datetime

import redis
from pydantic import BaseModel

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [GATEWAY] %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Redis
REDIS_URL = os.getenv("REDDIS_URL", "redis://redis:6379")
QUEUE_PLANNER = "planner_jobs"
QUEUE_EVENTS  = "ws_events"

def get_redis():
    return redis.from_url(REDIS_URL, decode_responses=True)

# Web socket connection store
active_connections: dict[str, list[WebSocket]] = {}

# Schemas

class AnalyzeRequest(BaseModel):
    arxiv_url: str
    target_locale: str = "en"
    max_papers: int = 8

class AnalyzeResponse(BaseModel):
    job_id: str
    status: str
    ws_url: str
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
    r = get_redis()
    loop = asyncio.new_event_loop()
    logger.info("Event poller thread started")

    while True:
        try:
            result = r.blpop(QUEUE_EVENTS, timeout=2)
            if result:
                _, raw = result
                event = json.loads(raw)
                job_id = event.get(job_id, "")
                if job_id:
                    loop.run_until_complete(broadcast(job_id, event))
        except Exception as e:
            logger.error(f"Event poller error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    poller = threading.Thread(target=start_event_poller, daemon=True)
    poller.start()
    logger.info("Gateway Started")
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
        "status": "ok",
        "service": "gateway",
        "redis": redis_status,
        "timestamp": datetime.utcnow().isoformat()
    }

@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    if "arxiv.org" not in req.arxiv_url:
        return AnalyzeResponse(
            job_id="",
            status="error",
            ws_url="",
            message="Please provide a valid arxiv URL e.g. https://arxiv.org/abs/1706.03762"
        )
    
    job_id = str(uuid.uuid4())[:8]

    job = {
        "job_id":        job_id,
        "arxiv_url":     req.arxiv_url,
        "target_locale": req.target_locale,
        "max_papers":    req.max_papers,
        "created_at":    datetime.utcnow().isoformat()
    }

    try:
        r = get_redis()
        r.rpush(QUEUE_PLANNER, json.dumps(job))
        logger.info(f"Job {job_id} queued — {req.arxiv_url} locale={req.target_locale}")
    except Exception as e:
        logger.error(f"Redis push failed: {e}")
        return AnalyzeResponse(
            job_id="",
            status="error",
            ws_url="",
            message="Could not connect to queue. Is Redis running?"
        )
    
    r.rpush(QUEUE_EVENTS, json.dumps({
        "event":     "job_started",
        "job_id":    job_id,
        "payload":   {"arxiv_url": req.arxiv_url, "locale": req.target_locale},
        "timestamp": datetime.utcnow().isoformat()
    }))

    return AnalyzeResponse(
        job_id=job_id,
        status="queued",
        ws_url=f"/ws/{job_id}",
        message="Job queued. Connect to WebSocket for live updates."
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