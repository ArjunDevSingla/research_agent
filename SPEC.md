# PaperSwarm — SPEC.md
> This file is LOCKED. Do not change the objective during a run.
> Every agent reads this before processing any job.

## Objective
Make research accessible to everyone, in every language.

Given either:
- A natural language query in ANY language ("मैं ट्रांसफॉर्मर समझना चाहता हूं")
- A direct arxiv URL

PaperSwarm produces:
1. The most relevant seed paper (via search agent, if query given)
2. A ranked list of similar papers and HOW they relate to the seed
3. A ranked list of research gaps with their STATUS:
   - open         → nobody has solved this yet
   - partially_solved → some papers are working on it
   - solved       → a related paper already addresses it
4. A knowledge graph connecting all of the above
5. Everything translated to the researcher's native language via Lingo.dev
6. An inline PDF viewer where researchers can select text for translation

## Core Purpose
Every research tool today assumes you speak English.
PaperSwarm does not. A researcher in India, Brazil, or Japan
should be able to understand the full landscape of any research
topic without knowing English or knowing which paper to start from.
Lingo.dev is not an add-on — it is the reason this product exists.

## Agent Roles

### Search Agent (NEW)
- Receives natural language query in any language
- Uses Lingo.dev SDK to translate query to English
- Extracts search keywords via LLM
- Queries Semantic Scholar /paper/search
- Uses LLM to pick the most foundational/relevant paper
- Translates result back to user's language via Lingo.dev
- Pushes suggestion to dashboard for user confirmation
- NEVER starts analysis without user confirmation

### Planner
- Receives confirmed arxiv URL
- Fetches seed paper metadata from Semantic Scholar
  (includes openAccessPdf URL for PDF downloading)
- Fetches similar papers from Semantic Scholar recommendations API
- Spawns one SimilarityJob per similar paper
- Spawns one FutureResearchJob with all related papers
- Sets trackers so reconciler knows when all workers are done
- NEVER does any LLM analysis itself

### Similarity Workers (3 replicas)
- One worker per similar paper — run fully in parallel
- Analyzes HOW the target paper relates to the seed
- Outputs: similarity_score, similarity_type, explanation, key_connections
- Pushes result to reconciler immediately on completion
- NEVER communicates with other workers

### Future Research Worker (2 replicas)
- Downloads seed paper PDF
- Extracts key sections: introduction, conclusion, limitations, future work
- Analyzes gaps against all related papers
- For each gap outputs:
    - status: open / partially_solved / solved
    - solved_by: papers that fully address this gap
    - working_on: papers making progress on this gap
    - still_open_aspects: what specifically remains unsolved
- NEVER uses just the abstract — always uses full key sections

### Reconciler
- Waits until ALL expected workers have completed
- Cross-links similarity + future research tracks
- Boosts confidence of gaps appearing across multiple papers
- Builds typed KnowledgeGraph with colored edges:
    - solves → green edge (paper solves gap)
    - working_on → yellow edge (paper making progress)
    - mentions_gap → red edge (gap still open)
- Hands off to Lingo service

### Lingo Service
- Translates all user-facing text fields
- Uses Lingo.dev SDK for runtime translation
- Uses Lingo.dev CLI for final report.md translation
- NEVER translates paper titles (keep original for citation accuracy)
- Falls back gracefully — untranslated English better than a crash

## Lingo.dev Integration Points
1. Search query translation (SDK)        ← user types in any language
2. Search result translation (SDK)       ← results shown in user's language
3. Live agent output translation (SDK)   ← real-time events in user's language
4. Knowledge graph translation (SDK)     ← graph labels in user's language
5. Inline PDF translation (SDK+Compiler) ← select text, translate in place
6. Dashboard UI (Compiler)               ← full UI in user's language
7. Final report (CLI)                    ← report.md translated to N languages

## Success Criteria
- Search returns paper suggestion within 10 seconds
- Knowledge graph renders within 3 minutes of confirmation
- At least 5 similar papers analyzed
- At least 4 research gaps identified with status
- Full output available in researcher's chosen language
- System survives individual worker crashes

## What This System Is NOT
- Not a paper recommendation engine
- Not a citation manager
- Not a summarization tool
- Not a replacement for reading the papers

## Tech Stack
- LLM: Groq (llama-3.3-70b) with Ollama fallback
- Queue: Redis
- Paper data: Semantic Scholar API + arxiv PDF download
- PDF parsing: PyMuPDF (fitz)
- Translation: Lingo.dev SDK + CLI + Compiler
- Graph UI: React + Cytoscape.js
- Infra: Docker Compose