from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

app = FastAPI(title="PaperSwarm Gateway", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok", "service": "gateway"}

@app.post("/analyze")
def analyze(body: dict):
    # TODO: Day 2 — connect to Redis + planner
    return {
        "message": "received",
        "arxiv_url": body.get("arxiv_url"),
        "status": "planner not connected yet"
    }