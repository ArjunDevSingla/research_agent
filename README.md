<div align="center">

<img src="https://img.shields.io/badge/PaperSwarm-Multi--Agent%20Research%20Intelligence-0ea5e9?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMThjLTQuNDEgMC04LTMuNTktOC04czMuNTktOCA4LTggOCAzLjU5IDggOC0zLjU5IDgtOCA4eiIvPjwvc3ZnPg==" alt="PaperSwarm" />

# 🐝 PaperSwarm

### Multi-Agent Research Intelligence for Everyone

**Build living knowledge graphs from arXiv papers · Surface research gaps · Read in your native language**

<br/>

[![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=flat-square&logo=fastapi)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Next.js_14-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white)](https://redis.io)
[![Docker](https://img.shields.io/badge/Docker_Compose-2496ED?style=flat-square&logo=docker&logoColor=white)](https://docs.docker.com/compose)
[![Groq](https://img.shields.io/badge/Groq-F55036?style=flat-square)](https://groq.com)
[![Lingo.dev](https://img.shields.io/badge/Lingo.dev-8B5CF6?style=flat-square)](https://lingo.dev)
[![Semantic Scholar](https://img.shields.io/badge/Semantic_Scholar-1857B6?style=flat-square)](https://www.semanticscholar.org)

<br/>

<table>
<tr>
<td align="center"><b>20+</b><br/><sub>Languages</sub></td>
<td align="center"><b>50+</b><br/><sub>Papers per run</sub></td>
<td align="center"><b>&lt; 2 min</b><br/><sub>To first insight</sub></td>
<td align="center"><b>8</b><br/><sub>Microservices</sub></td>
<td align="center"><b>5</b><br/><sub>Parallel workers</sub></td>
</tr>
</table>

</div>

---

## What Is PaperSwarm?

PaperSwarm is a **multi-agent AI system** that turns a single natural-language query or arXiv ID into a fully-connected, interactive knowledge graph — translated into the researcher's native language in real time.

It was built specifically for **non-English researchers** who struggle to navigate the English-dominated academic landscape. Give it a topic in Hindi, Arabic, Chinese, or 17 other languages — it searches, analyzes, connects, and translates everything automatically.

```
Input:  "attention mechanisms in transformers"  (or paste an arXiv ID)
           ↓  < 2 minutes later >
Output: Interactive knowledge graph
        • Seed paper + 8–20 related papers
        • Research gaps (open / partially solved / solved)
        • Typed edges (solves, working_on, mentions)
        • Everything translated to your language
        • Full PDF translation, page by page
```

---

## Demo Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Open http://localhost:3000  →  Landing page                  │
│  2. Click "Launch App"          →  Dashboard                     │
│  3. Type a query or arXiv ID    →  Search agent runs             │
│  4. Confirm a paper             →  Swarm analysis starts         │
│  5. Watch the graph build live  →  WebSocket events stream in    │
│  6. Click any node              →  Detail panel opens            │
│  7. Switch language             →  Entire graph re-translates    │
│  8. Click PDF tab               →  Translated PDF appears        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Architecture

PaperSwarm runs as **10 Docker containers** orchestrated by a single `docker-compose.yml`.

```
                          ┌──────────────┐
                          │   Dashboard  │  Next.js 14 · port 3000
                          │  (React SPA) │
                          └──────┬───────┘
                   REST / WS     │
                          ┌──────▼───────┐
                          │   Gateway    │  FastAPI · port 8000
                          │  (FastAPI)   │  WebSocket broadcast
                          └──────┬───────┘
                                 │  Redis pub/sub
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
   ┌──────▼──────┐       ┌───────▼──────┐      ┌───────▼──────┐
   │ Search Agent│       │   Planner    │       │  Lingo Svc   │
   │             │       │              │       │ (Translator) │
   └─────────────┘       └──────┬───────┘       └─────────────┘
    NL query →                  │ spawn
    5 SS searches        ┌──────┴───────────┐
    deduplicate          │                  │
    translate            │×3                │×2
                  ┌──────▼──────┐   ┌───────▼──────┐
                  │ Similarity  │   │Future Research│
                  │  Worker     │   │    Worker     │
                  └──────┬──────┘   └───────┬───────┘
                         │                  │
                         └────────┬─────────┘
                                  │
                          ┌───────▼──────┐
                          │  Reconciler  │  Dedup · boost · build
                          └──────┬───────┘
                                 │
                          ┌──────▼───────┐
                          │PDF Translator│  Page-by-page streaming
                          └─────────────┘
```

### Service Responsibilities

| Service | Port | Replicas | What it does |
|---------|------|:--------:|--------------|
| **redis** | 6379 | 1 | Message queue & event bus |
| **gateway** | 8000 | 1 | REST API + WebSocket hub, streams events to dashboard |
| **search-agent** | — | 1 | Detects query language → translates → LLM expands → 5× parallel Semantic Scholar searches |
| **planner** | — | 1 | Fetches seed paper metadata, similar papers, spawns all workers |
| **similarity-worker** | — | **3** | Analyzes how each related paper connects to the seed (score + type + explanation) |
| **future-research-worker** | — | **2** | Downloads PDFs, extracts gaps (open / partially-solved / solved) with confidence scores |
| **reconciler** | — | 1 | Deduplicates gaps via LLM, boosts confidence, assembles final knowledge graph |
| **lingo-service** | — | 1 | Batch-translates all graph text via Lingo.dev, per-locale Redis cache |
| **pdf-translator** | — | 1 | Streams page-by-page HTML translation of full research PDFs |
| **dashboard** | 3000 | 1 | React SPA — graph visualization, PDF viewer, saved searches |

---

## Knowledge Graph

Nodes and edges are color-coded by type:

```
Nodes
  🔵  Seed paper      — the paper you analyzed
  🟣  Related paper   — discovered via Semantic Scholar
  🟢  Research gap    — open problem extracted by LLM

Edges
  ──── solves         — paper directly solves the gap          (green)
  ──── working_on     — paper makes partial progress           (yellow)
  ──── mentions_gap   — paper mentions but doesn't solve gap   (red)
  ──── similar_to     — papers share methodology / results     (blue)
```

---

## Quick Start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop) (includes Docker Compose)
- API keys (see below)

### 1. Clone

```bash
git clone https://github.com/ArjunDevSingla/research_agent.git
cd PaperSwarm
```

### 2. Configure API Keys

```bash
cp .env.example .env
```

Open `.env` and fill in:

| Variable | Where to get it | Required? |
|----------|----------------|:---------:|
| `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) — free tier | ✅ |
| `LINGODOTDEV_API_KEY` | [lingo.dev](https://lingo.dev) | ✅ |
| `SEMANTIC_SCHOLAR_API_KEY` | [semanticscholar.org/product/api](https://www.semanticscholar.org/product/api) — free | Optional (higher rate limits) |

### 3. Launch

```bash
docker compose up --build
```

First build takes ~3–5 minutes (downloads Python/Node images and installs dependencies). Subsequent starts are fast.

### 4. Open

| URL | What you'll see |
|-----|----------------|
| `http://localhost:3000` | Landing page |
| `http://localhost:3000/dashboard` | Research dashboard |
| `http://localhost:8000/docs` | Gateway API (Swagger UI) |

---

## Usage Guide

### Search by Query

1. Type a natural-language query in the search box (any language)
2. PaperSwarm detects your language and asks if you want results translated
3. A list of matching papers appears — click one to start full analysis

### Search by arXiv ID

Paste an arXiv ID directly (e.g. `2310.06825` or `https://arxiv.org/abs/2310.06825`) and hit Enter.

### Reading the Graph

- **Click any node** — opens the detail panel with abstract, similarity score, and gap analysis
- **Click a gap node** — shows which papers solve it, work on it, or just mention it
- **Drag to pan**, **scroll to zoom**
- **Double-click a paper node** — opens the PDF viewer

### PDF Translation

1. Select a paper node and click the **PDF** tab
2. Click **Translate PDF** and choose a language
3. Translation streams page by page — progress bar shows status
4. Click **Export PDF** to save via browser print dialog

### Language Switching

Use the language selector in the top bar to re-translate the entire knowledge graph into any supported language. Results are cached per locale — switching back is instant.

---

## Supported Languages

| Language | Code | | Language | Code | | Language | Code |
|----------|------|-|----------|------|-|----------|------|
| English | `en` | | Arabic | `ar` | | Korean | `ko` |
| Chinese | `zh` | | Hindi | `hi` | | Russian | `ru` |
| Spanish | `es` | | Japanese | `ja` | | Bengali | `bn` |
| French | `fr` | | German | `de` | | Urdu | `ur` |
| Portuguese | `pt` | | Turkish | `tr` | | Vietnamese | `vi` |
| Italian | `it` | | Polish | `pl` | | Indonesian | `id` |
| Dutch | `nl` | | Ukrainian | `uk` | | Thai | `th` |

> Technical terms (transformer, BERT, LLM, attention, ViT, RLHF, etc.) are **never translated** — they stay in their canonical English form so researchers can search for them.

---

## Project Structure

```
PaperSwarm/
├── .env.example                    ← Copy to .env, fill in keys
├── docker-compose.yml              ← Orchestrates all 10 services
│
├── shared/                         ← Shared Python modules
│   ├── models.py                   ← Pydantic schemas (all services)
│   ├── llm.py                      ← LLM wrapper (Groq + Ollama fallback)
│   └── queue.py                    ← Redis queue helpers
│
├── services/
│   ├── gateway/                    ← FastAPI entry point (port 8000)
│   ├── search-agent/               ← NL search + language detection
│   ├── planner/                    ← Job orchestrator + paper fetcher
│   ├── similarity-worker/          ← Paper relationship analysis (×3)
│   ├── future-research-worker/     ← Gap extraction from PDFs (×2)
│   ├── reconciler/                 ← Graph builder + deduplicator
│   ├── lingo-service/              ← Translation engine
│   ├── pdf-translator/             ← Full PDF page-by-page translation
│   └── dashboard/                  ← Next.js 14 frontend (port 3000)
│       └── src/app/
│           ├── page.jsx            ← Redirects → /landing
│           ├── landing/page.jsx    ← Marketing landing page
│           └── dashboard/page.jsx  ← Main research dashboard
│
└── infra/
    └── nginx/                      ← Nginx reverse proxy (optional)
```

---

## Data Flow

```
User query / arXiv ID
       │
       ▼
   [Gateway]  →  publishes job to Redis
       │
       ├──▶  [Search Agent]
       │        ├── Detect language (Lingo.dev)
       │        ├── Translate query → English
       │        ├── LLM generates 5 search variants
       │        ├── 5× parallel Semantic Scholar API calls
       │        └── Translate results back → user's language
       │
       └──▶  [Planner]  (after user confirms a paper)
                ├── Fetch seed paper metadata
                ├── Fetch 8 similar papers
                ├── Dispatch 3× Similarity Workers
                └── Dispatch 2× Future Research Workers
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
   [Similarity Worker]    [Future Research Worker]
    Per related paper:      Downloads seed PDF
    • similarity_score       Extracts: intro, conclusion,
    • similarity_type          limitations, future work
    • explanation            For each gap:
    • key_connections         • status (open/partial/solved)
                              • solved_by / working_on
                              • confidence score
              │                     │
              └──────────┬──────────┘
                         ▼
                    [Reconciler]
                    • Wait for all workers
                    • LLM deduplicates gaps
                    • Boost confidence scores
                    • Build typed knowledge graph
                         │
                         ▼
                  [Lingo Service]
                  • Extract all text fields
                  • Batch translate via Lingo.dev
                  • Cache per locale in Redis
                  • Push translated graph
                         │
                         ▼
                    [Gateway WS]
                    • Broadcast graph_translated event
                    • Dashboard fetches GET /graph/{job_id}
                    • Cytoscape renders the graph
                         │
                         ▼
                    [Dashboard]
                    • User clicks "Translate PDF"
                         │
                         ▼ POST /translate-pdf
                  [PDF Translator]
                  • Downloads PDF from arXiv
                  • Parses pages via PyMuPDF
                  • Translates page by page (Lingo.dev)
                  • Streams HTML fragments → Gateway
                  • Events: pdf_translation_progress
                            pdf_translation_done
                         │
                         ▼
                    [Gateway WS]
                    • Streams progress to Dashboard
                    • Dashboard renders translated HTML
                    • Export PDF via browser print dialog
```

---

## API Reference

The gateway exposes these endpoints (full Swagger at `http://localhost:8000/docs`):

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/search` | Start natural-language paper search |
| `POST` | `/confirm` | Confirm search result → begin analysis |
| `POST` | `/analyze` | Direct analysis by arXiv ID |
| `GET` | `/graph/{job_id}` | Fetch completed knowledge graph |
| `GET` | `/status/{job_id}` | Check pipeline progress |
| `POST` | `/translate` | Re-translate graph to new locale |
| `POST` | `/translate-ui` | Translate UI strings (landing page) |
| `POST` | `/translate-pdf` | Queue full PDF translation |
| `GET` | `/translated/{job}/{arxiv}/{locale}` | Streaming translated PDF HTML |
| `GET` | `/export/{job_id}` | Printable HTML report |
| `WS` | `/ws/{job_id}` | Real-time pipeline events |

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GROQ_API_KEY` | Groq API key for LLM calls | — |
| `GROQ_MODEL` | Groq model ID | `llama-3.3-70b-versatile` |
| `LLM_PROVIDER` | `groq` or `ollama` | `groq` |
| `OLLAMA_BASE_URL` | Ollama server URL (if using local LLM) | `http://localhost:11434` |
| `OLLAMA_MODEL` | Ollama model name | `llama3.1:8b` |
| `SEMANTIC_SCHOLAR_API_KEY` | Semantic Scholar API key | — |
| `LINGODOTDEV_API_KEY` | Lingo.dev API key | — |
| `REDIS_URL` | Redis connection string | `redis://redis:6379` |
| `DEFAULT_TARGET_LOCALE` | Default output language | `en` |
| `ALLOWED_ORIGINS` | CORS allowed origins | `http://localhost:3000` |

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **LLM** | [Groq](https://groq.com) (llama-3.3-70b) | Query expansion, gap deduplication, gap extraction |
| **LLM Fallback** | [Ollama](https://ollama.ai) (llama3.1:8b) | Local inference when Groq is unavailable |
| **Translation** | [Lingo.dev](https://lingo.dev) SDK | 20+ language real-time translation with glossary support |
| **Paper Data** | [Semantic Scholar](https://www.semanticscholar.org/product/api) API | Paper search, metadata, recommendations |
| **PDF Parsing** | PyMuPDF (fitz) | Extract key sections from research PDFs |
| **Backend** | FastAPI + Python 3.11 | REST API, WebSocket hub |
| **Queue** | Redis 7 | Job distribution, event bus, translation cache |
| **Frontend** | React 18 + Next.js 14 | SSR, streaming, API routes |
| **Graph Viz** | [Cytoscape.js](https://cytoscape.org) | Interactive knowledge graph rendering |
| **Styling** | Tailwind CSS v3 | Responsive, dark/light theme |
| **Containers** | Docker Compose | Orchestration of 10 microservices |

---

## Development

### Run a Single Service Locally

```bash
# Start only Redis + Gateway for backend dev
docker compose up redis gateway

# Start only the dashboard (talks to local gateway)
cd services/dashboard
npm install
npm run dev
```

### Rebuild After Code Changes

```bash
# Rebuild a specific service
docker compose up --build gateway

# Rebuild everything
docker compose up --build
```

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f reconciler
docker compose logs -f lingo-service
```

### Scaling Workers

```bash
# Run 5 similarity workers instead of 3
docker compose up --scale similarity-worker=5
```

---

## Shared Models

All services import from `shared/models.py` — Pydantic schemas that define the contract between services:

```python
AnalyzeRequest         # User's initial request
SimilarityJob          # Planner → Similarity Workers
FutureResearchJob      # Planner → Future Research Workers
SimilarityResult       # Worker output: score, type, connections
FutureResearchResult   # Gap output: status, confidence, papers
GraphNode              # Knowledge graph node
GraphEdge              # Knowledge graph edge (typed)
KnowledgeGraph         # Final reconciler output
```

---

## Troubleshooting

**Graph never appears**
- Check `docker compose logs reconciler` — it waits for all workers to finish
- Check `docker compose logs lingo-service` — translation failures silently skip
- Redis may have expired the job — restart the analysis

**Translation not working**
- Verify `LINGODOTDEV_API_KEY` is set in `.env`
- Check `docker compose logs lingo-service` for API errors

**Search returns no results**
- `SEMANTIC_SCHOLAR_API_KEY` missing → rate limited to 100 req/5 min (usually fine)
- Query too specific — try broader terms or use an arXiv ID directly

**Dashboard not loading**
- Ensure gateway is healthy: `curl http://localhost:8000/docs`
- Check `NEXT_PUBLIC_GATEWAY_URL` in `services/dashboard/.env.local`

**PDF translation hangs**
- PDF download from arXiv can be slow — wait 30s before retrying
- Check `docker compose logs pdf-translator`

---

## Roadmap

- [ ] Citation graph overlay (show which papers cite each other)
- [ ] Inline PDF text selection → instant translation tooltip
- [ ] Export knowledge graph as structured JSON / CSV
- [ ] User accounts + persistent graph library (cloud sync)
- [ ] Support for non-arXiv papers (DOI lookup via Unpaywall)
- [ ] Collaborative annotations on graph nodes
- [ ] LLM assistant for research doubts

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Open a pull request

Please keep services independent — they communicate only through Redis queues and the REST API.

---

<div align="center">

Built with ❤️ for researchers who think in languages other than English.

**[Launch App](http://localhost:3000) · [API Docs](http://localhost:8000/docs) · [GitHub](https://github.com/ArjunDevSingla/research_agent)**

</div>
