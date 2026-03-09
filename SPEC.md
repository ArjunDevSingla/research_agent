# PaperSwarm — SPEC.md
> This file is LOCKED. Do not change the objective during a run.
> Agents read this to understand the system's purpose and constraints.

## Objective
Given a seed research paper (arxiv URL), automatically synthesize:
1. A ranked list of similar papers and how they relate to the seed
2. A ranked list of open research gaps and future directions
3. A knowledge graph connecting all of the above
4. All outputs translated to the researcher's native language via Lingo.dev

## Core Constraint
The goal is to help non-English researchers understand the full landscape
of a paper in their native language. Lingo.dev is not an add-on — it is
the reason this product exists.

## Agent Roles

### Planner
- Parse seed paper metadata from Semantic Scholar
- Spawn exactly one SimilarityJob per related paper found
- Spawn exactly one FutureResearchJob with all abstracts
- Lock job_id and track expected worker counts
- NEVER modify the objective mid-run

### Similarity Workers
- Analyze ONE target paper per worker invocation
- Output structured JSON only — no free text
- Score must be evidence-based, not generic
- Push result to reconciler queue immediately on completion

### Future Research Workers  
- Analyze the full set of related abstracts holistically
- Output 4-6 concrete, specific research gaps
- Confidence must reflect evidence strength, not speculation
- Cross-paper gaps score higher than single-paper gaps

### Reconciler
- Wait for ALL expected workers before reconciling
- Cross-link gaps that appear across multiple papers (boost confidence)
- Build KnowledgeGraph with typed nodes and weighted edges
- Hand off to Lingo service before pushing to dashboard

### Lingo Service
- Translate all user-facing text fields
- Never translate paper titles (keep original for citation accuracy)
- Fall back gracefully — untranslated English is better than a crash

## Success Criteria
- Knowledge graph renders within 3 minutes of job submission
- At least 5 similar papers analyzed
- At least 4 research gaps identified
- Full output available in researcher's chosen language
- System survives individual worker crashes without full job failure

## What This System Is NOT
- Not a paper recommendation engine
- Not a citation manager  
- Not a summarization tool
- Not a replacement for reading the papers

## Tech Stack
- LLM: Groq (llama-3.3-70b) with Ollama fallback
- Queue: Redis
- Paper data: Semantic Scholar API + arxiv
- Translation: Lingo.dev SDK + CLI + Compiler
- Graph UI: React + Cytoscape.js
- Infra: Docker Compose on Windows (WSL2)
