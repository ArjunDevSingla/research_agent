# 🔬 PaperSwarm

> Multi-agent research synthesis for non-English researchers.  
> Drop in any arxiv paper. Get the full research landscape in your language.

---

## Quick Start

### 1. Clone and configure
```bash
cp .env.example .env
# Fill in your API keys in .env
```

### 2. Start everything
```bash
docker compose up --build
```

### 3. Open the dashboard
```
http://localhost:3000
```

### 4. Paste any arxiv URL and hit Analyze
Example: `https://arxiv.org/abs/1706.03762` (Attention is All You Need)

---

## Architecture

```
User → Gateway → Planner → [Similarity Workers × N] → Reconciler → Graph UI
                          → [Future Research Workers × M] ↗         ↓
                                                              Lingo.dev Translation
```

Full architecture diagram: see `docs/architecture.html`

---

## Services

| Service | Port | Purpose |
|---|---|---|
| nginx | 80 | Reverse proxy |
| gateway | 8000 | API + WebSocket entry point |
| planner | — | Breaks job into tasks |
| similarity-worker | — | Analyzes paper relationships (3 replicas) |
| future-research-worker | — | Extracts research gaps (2 replicas) |
| reconciler | — | Cross-links and builds graph |
| lingo-service | — | Translates output |
| dashboard | 3000 | React UI |
| redis | 6379 | Message queue |

---

## API Keys Required

| Key | Get it at | Free? |
|---|---|---|
| `GROQ_API_KEY` | console.groq.com | ✅ Free tier |
| `LINGO_API_KEY` | lingo.dev/dashboard | ✅ Hackathon access |
| `SEMANTIC_SCHOLAR_API_KEY` | api.semanticscholar.org | ✅ Free |

---

## Scale workers on the fly
```bash
docker compose up --scale similarity-worker=5
```

## View logs for a specific service
```bash
docker compose logs -f planner
docker compose logs -f similarity-worker
docker compose logs -f reconciler
```

## Reset everything
```bash
docker compose down -v
docker compose up --build
```

---

## Week Plan

| Day | Goal |
|---|---|
| 1 | ✅ Scaffold + Docker setup |
| 2 | Gateway + Planner working |
| 3 | Similarity + Future Research workers |
| 4 | Reconciler + cross-linking |
| 5 | Knowledge graph UI |
| 6 | Lingo.dev full integration |
| 7 | Polish + demo recording |
