"""
shared/models.py
Pydantic schemas shared across all PaperSwarm services.
Every service imports from this file — keeps data contracts consistent.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from datetime import datetime
import uuid


def make_id() -> str:
    return str(uuid.uuid4())[:8]


# ── INPUT ──────────────────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    """What the user sends to the gateway."""
    arxiv_url: str
    target_locale: str = "en"
    max_papers: int = 8


# ── JOB SCHEMAS (pushed onto Redis queues) ────────────────────────────────────

class SimilarityJob(BaseModel):
    """Planner → Similarity Worker"""
    job_id: str
    seed_title: str
    seed_abstract: str
    target_paper_id: str
    target_title: str
    target_abstract: str
    target_arxiv_url: Optional[str] = None
    target_locale: str = "en"


class FutureResearchJob(BaseModel):
    """Planner → Future Research Worker"""
    job_id: str
    seed_title: str
    seed_abstract: str
    related_papers: List[dict] = []    # List of { title, abstract } dicts
    target_locale: str = "en"


class ReconcilerJob(BaseModel):
    """Workers → Reconciler"""
    job_id: str
    worker_type: Literal["similarity", "future_research"]
    result: dict


# ── RESULT SCHEMAS (what workers produce) ─────────────────────────────────────

class SimilarityResult(BaseModel):
    """Output of one Similarity Worker run."""
    job_id: str
    seed_title: str
    target_paper_id: str
    target_title: str
    similarity_score: float
    similarity_type: List[Literal["methodology", "results", "problem", "dataset", "theory"]]
    explanation: str
    key_connections: List[str]
    translated: bool = False
    locale: str = "en"


class FutureResearchResult(BaseModel):
    """Output of one Future Research Worker run."""
    job_id: str
    seed_title: str
    gap_title: str
    gap_description: str
    gap_source: Literal["seed_text", "comparative"] = "seed_text"
    compared_with: str = ""     # related paper title for comparative gaps
    confidence: float

    # ── Gap status — the key differentiator ───────────────────────────
    # open           → none of the related papers address this gap
    # partially_solved → some papers make progress but aspects remain open
    # solved         → a related paper directly solves this gap
    status: Literal["open", "partially_solved", "solved"]

    solved_by: List[str] = []           # Paper titles that fully solve this gap
    working_on: List[str] = []          # Paper titles making progress on this gap
    still_open_aspects: List[str] = []  # Specific sub-problems still unsolved

    supporting_papers: List[str] = []   # All papers that mention this gap
    research_questions: List[str] = []  # Concrete open questions to answer

    translated: bool = False
    locale: str = "en"


# ── GRAPH SCHEMAS (Reconciler output) ─────────────────────────────────────────

class GraphNode(BaseModel):
    """A node in the final knowledge graph."""
    id: str
    type: Literal["seed", "similar_paper", "future_gap"]
    label: str
    data: dict                          # Full result payload


class GraphEdge(BaseModel):
    """An edge in the final knowledge graph."""
    source: str
    target: str
    weight: float
    label: str
    edge_type: Literal[
        "similar_to",       # seed → similar paper
        "future_direction", # seed → open gap
        "solves",           # similar paper → solved gap
        "working_on",       # similar paper → partially solved gap
        "mentions_gap"      # similar paper → open gap it mentions
    ] = "similar_to"


class KnowledgeGraph(BaseModel):
    """Final output of the Reconciler — sent to dashboard."""
    job_id: str
    seed_title: str
    nodes: List[GraphNode]
    edges: List[GraphEdge]
    total_papers_analyzed: int
    total_gaps_found: int
    gaps_open: int = 0
    gaps_partial: int = 0
    gaps_solved: int = 0
    completed_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())