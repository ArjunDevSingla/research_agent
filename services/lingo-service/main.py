import asyncio
import json
import logging
import os
import time
from datetime import datetime
 
import redis as redis_lib
from lingodotdev import LingoDotDevEngine
 
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [LINGO] %(levelname)s — %(message)s"
)
logger = logging.getLogger(__name__)
 
 
# ── Config ─────────────────────────────────────────────────────────────────────
REDIS_URL      = os.getenv("REDIS_URL", "redis://redis:6379")
LINGO_API_KEY  = os.getenv("LINGODOTDEV_API_KEY", "")
DEFAULT_SOURCE = "en"
POLL_INTERVAL  = 2
 
# ── Queue / key names ──────────────────────────────────────────────────────────
QUEUE_LINGO       = "lingo_jobs"
QUEUE_EVENTS      = "ws_events"
TRANSLATED_PREFIX = "translated_graph:"
GRAPH_PREFIX      = "graph:"
 
# ── ML / NLP / CS Glossary ─────────────────────────────────────────────────────
# These terms must never be translated — they are universal technical identifiers.
# Lingo.dev reference data preserves them exactly across all target languages.
RESEARCH_GLOSSARY = {
    # Model architectures
    "transformer":          "transformer",
    "attention":            "attention",
    "attention head":       "attention head",
    "self-attention":       "self-attention",
    "multi-head attention": "multi-head attention",
    "encoder":              "encoder",
    "decoder":              "decoder",
    "BERT":                 "BERT",
    "GPT":                  "GPT",
    "LLM":                  "LLM",
    "diffusion model":      "diffusion model",
    "GAN":                  "GAN",
    "CNN":                  "CNN",
    "RNN":                  "RNN",
    "LSTM":                 "LSTM",
    # Additional architectures
    "vision transformer":     "vision transformer",
    "ViT":                    "ViT",
    "mixture of experts":     "mixture of experts",
    "MoE":                    "MoE",
    "autoencoder":            "autoencoder",
    "variational autoencoder":"variational autoencoder",
    "VAE":                    "VAE",
    "perceiver":              "perceiver",
    "state space model":      "state space model",
    "SSM":                    "SSM",
    "Mamba":                  "Mamba",
    "graph neural network":   "graph neural network",
    "GNN":                    "GNN",
    "capsule network":        "capsule network",
    "neural radiance field":  "NeRF",
    "NeRF":                   "NeRF",
    # Training concepts
    "fine-tuning":          "fine-tuning",
    "fine-tune":            "fine-tune",
    "pre-training":         "pre-training",
    "pre-trained":          "pre-trained",
    "RLHF":                 "RLHF",
    "reinforcement learning": "reinforcement learning",
    "supervised learning":  "supervised learning",
    "unsupervised learning": "unsupervised learning",
    "zero-shot":            "zero-shot",
    "few-shot":             "few-shot",
    "prompt":               "prompt",
    "embedding":            "embedding",
    "tokenizer":            "tokenizer",
    "token":                "token",
    "softmax":              "softmax",
    "gradient":             "gradient",
    "backpropagation":      "backpropagation",
    "overfitting":          "overfitting",
    "dropout":              "dropout",
    "batch size":           "batch size",
    "learning rate":        "learning rate",
    # Transformer internals
    "query":                  "query",
    "key":                    "key",
    "value":                  "value",
    "qkv":                    "qkv",
    "positional encoding":    "positional encoding",
    "rotary embedding":       "rotary embedding",
    "RoPE":                   "RoPE",
    "attention score":        "attention score",
    "attention weight":       "attention weight",
    "causal attention":       "causal attention",
    "cross attention":        "cross attention",
    "masked attention":       "masked attention",
    "feed forward network":   "feed forward network",
    "FFN":                    "FFN",
    "layer normalization":    "layer normalization",
    "layer norm":             "layer norm",
    "residual connection":    "residual connection",
    "skip connection":        "skip connection",
    # Optimization
    "loss function":          "loss function",
    "objective function":     "objective function",
    "optimizer":              "optimizer",
    "SGD":                    "SGD",
    "Adam":                   "Adam",
    "AdamW":                  "AdamW",
    "momentum":               "momentum",
    "weight decay":           "weight decay",
    "gradient clipping":      "gradient clipping",
    "gradient descent":       "gradient descent",
    "stochastic gradient descent": "stochastic gradient descent",
    # RL
    "policy":                 "policy",
    "value function":         "value function",
    "reward":                 "reward",
    "reward model":           "reward model",
    "policy gradient":        "policy gradient",
    "actor critic":           "actor critic",
    "PPO":                    "PPO",
    "DQN":                    "DQN",
    "exploration":            "exploration",
    "exploitation":           "exploitation",
    "environment":            "environment",
    "episode":                "episode",
    "trajectory":             "trajectory",
    "return":                 "return",
    "discount factor":        "discount factor",
    "Q value":                "Q value",
    "state":                  "state",
    "action":                 "action",
    # LLM engineering
    "context window":         "context window",
    "context length":         "context length",
    "prompt engineering":     "prompt engineering",
    "chain of thought":       "chain of thought",
    "CoT":                    "CoT",
    "retrieval augmented generation": "retrieval augmented generation",
    "RAG":                    "RAG",
    "hallucination":          "hallucination",
    "alignment":              "alignment",
    "safety alignment":       "safety alignment",
    "instruction tuning":     "instruction tuning",
    "system prompt":          "system prompt",
    "tool use":               "tool use",
    "function calling":       "function calling",
    "agent":                  "agent",
    "memory":                 "memory",
    # Training tricks
    "curriculum learning":    "curriculum learning",
    "knowledge distillation": "knowledge distillation",
    "distillation":           "distillation",
    "teacher model":          "teacher model",
    "student model":          "student model",
    "label smoothing":        "label smoothing",
    "warmup":                 "warmup",
    "learning rate scheduler":"learning rate scheduler",
    "cosine decay":           "cosine decay",
    "early stopping":         "early stopping",
    "BLEU":                 "BLEU",
    "ROUGE":                "ROUGE",
    "F1 score":             "F1 score",
    "benchmark":            "benchmark",
    "baseline":             "baseline",
    "ablation":             "ablation",
    # Data
    "data augmentation":      "data augmentation",
    "data preprocessing":     "data preprocessing",
    "data cleaning":          "data cleaning",
    "train set":              "train set",
    "validation set":         "validation set",
    "test set":               "test set",
    "data leakage":           "data leakage",
    "class imbalance":        "class imbalance",
    "feature":                "feature",
    "feature engineering":    "feature engineering",
    # Research paper terms
    "abstract":             "abstract",
    "arxiv":                "arxiv",
    "dataset":              "dataset",
    "corpus":               "corpus",
    "hyperparameter":       "hyperparameter",
    "inference":            "inference",
    "latency":              "latency",
    "throughput":           "throughput",
    # Metrics
    "accuracy":               "accuracy",
    "precision":              "precision",
    "recall":                 "recall",
    "AUC":                    "AUC",
    "ROC":                    "ROC",
    "perplexity":             "perplexity",
    "log likelihood":         "log likelihood",
    "cross entropy":          "cross entropy",
    "mean squared error":     "mean squared error",
    "MSE":                    "MSE",
    "mean absolute error":    "MAE",
    "top-k accuracy":         "top-k accuracy",
    # Scaling & infra
    "scaling law":            "scaling law",
    "parameter count":        "parameter count",
    "model size":             "model size",
    "compute budget":         "compute budget",
    "FLOPs":                  "FLOPs",
    "quantization":           "quantization",
    "pruning":                "pruning",
    "sparsity":               "sparsity",
    "distilled model":        "distilled model",
    "checkpoint":             "checkpoint",
    "distributed training":   "distributed training",
    "data parallelism":       "data parallelism",
    "model parallelism":      "model parallelism",
    "pipeline parallelism":   "pipeline parallelism",
    # Paper vocabulary
    "state of the art":       "state of the art",
    "SOTA":                   "SOTA",
    "methodology":            "methodology",
    "experiment":             "experiment",
    "results":                "results",
    "discussion":             "discussion",
    "limitation":             "limitation",
    "future work":            "future work",
    "reproducibility":        "reproducibility",
}
 
 
# ── Engine factory ─────────────────────────────────────────────────────────────
 
def make_engine() -> LingoDotDevEngine:
    """Create a configured Lingo.dev engine instance."""
    return LingoDotDevEngine({
        "api_key": LINGO_API_KEY,
    })

def get_redis():
    return redis_lib.from_url(REDIS_URL, decode_responses=True)
 
 
def push_event(r, event: str, job_id: str, payload: dict = {}) -> None:
    r.rpush(QUEUE_EVENTS, json.dumps({
        "event":     event,
        "job_id":    job_id,
        "payload":   payload,
        "timestamp": datetime.utcnow().isoformat()
    }))

async def detect_language(text: str) -> str:
    if not text or not LINGO_API_KEY:
        return "en"
    try:
        async with make_engine() as engine:
            result = await engine.recognize_locale(text)
            locale = result.get("locale", "en")
            logger.info(f"Language detected: {locale}")
            return locale
    except Exception as e:
        logger.warning(f"Language detection failed: {e} — defaulting to 'en'")
        return "en"
    
def extract_node_fields(nodes: list[dict]) -> tuple[dict, dict, dict]:
    group_a = {}
    group_b = {}
 
    for node in nodes:
        nid = node["id"]
        data = node.get("data", {})
 
        title = node.get("label", "")
        if title:
            key = f"node_{nid}__display_title"
            if node["type"] in ("seed", "similar_paper"):
                group_a[key] = title
            else:
                group_b[key] = title
 
        if node["type"] == "similar_paper":
            for field in ("explanation", "connection_description"):
                if data.get(field):
                    group_a[f"node_{nid}__{field}"] = data[field]
 
        if node["type"] == "future_gap":
            if data.get("description"):
                group_b[f"node_{nid}__description"] = data["description"]
            if data.get("gap_title") and data["gap_title"] != node.get("label"):
                group_b[f"node_{nid}__gap_title"] = data["gap_title"]
            aspects = data.get("still_open_aspects", [])
            if aspects:
                group_b[f"node_{nid}__still_open_aspects"] = " ||| ".join(aspects)
 
    return group_a, group_b

def extract_edge_fields(edges: list[dict]) -> dict:
    skip = {"similar_to", "solves", "working_on", "mentions_gap",
            "future_gap", "open", "partially_solved", "solved"}
    fields = {}
    for idx, edge in enumerate(edges):
        label = edge.get("label", "")
        if label and label not in skip:
            fields[f"edge_{idx}__display_label"] = label
    return fields

async def translate_group(
    engine,
    fields: dict,
    source_locale: str,
    target_locale: str,
    label: str,
    job_id: str,
    r,
    progress_counter: list   # [done, total] — shared mutable across groups
) -> dict:
    if not fields:
        return {}
 
    accumulated = {}
 
    def on_batch_done(source_chunk: dict, translated_chunk: dict) -> None:
        accumulated.update(translated_chunk)
        progress_counter[0] += len(translated_chunk)

        push_event(r, "translation_progress", job_id, {
            "status":       "in_progress",
            "label":        label,
            "done_fields":  progress_counter[0],
            "total_fields": progress_counter[1],
            "pct":          round(progress_counter[0] / max(progress_counter[1], 1) * 100)
        })

        for key, original in source_chunk.items():
            translated = translated_chunk.get(key, "")
            for term in RESEARCH_GLOSSARY:
                if term.lower() in original.lower():
                    if term.lower() not in translated.lower():
                        logger.warning(
                            f"  [{label}] Glossary term '{term}' may have been "
                            f"altered in translation for key '{key}'"
                        )
 
        logger.info(
            f"  [{label}] batch done — "
            f"{progress_counter[0]}/{progress_counter[1]} fields translated"
        )

    try:
        await engine.localize_object(
            fields,
            {
                "source_locale":  source_locale,
                "target_locale":  target_locale,
                "fast":           True,
                "reference": RESEARCH_GLOSSARY,
                "progress_callback": on_batch_done,     # fires after each batch
            }
        )
        logger.info(f"  [{label}] complete — {len(accumulated)} fields translated")
        return accumulated
 
    except Exception as e:
        logger.warning(f"  [{label}] translation failed: {e} — using originals")
        return fields
    
def apply_translations(graph: dict, all_translations: dict) -> dict:
    import copy
    g = copy.deepcopy(graph)
 
    for node in g.get("nodes", []):
        nid  = node["id"]
        data = node.get("data", {})
 
        key = f"node_{nid}__display_title"
        if key in all_translations:
            node["display_label"]  = all_translations[key]
            node["original_label"] = node["label"]
 
        if node["type"] == "similar_paper":
            for field in ("explanation", "connection_description"):
                key = f"node_{nid}__{field}"
                if key in all_translations:
                    data[f"translated_{field}"] = all_translations[key]
 
        if node["type"] == "future_gap":
            for field in ("description", "gap_title"):
                key = f"node_{nid}__{field}"
                if key in all_translations:
                    data[f"translated_{field}"] = all_translations[key]
            key = f"node_{nid}__still_open_aspects"
            if key in all_translations:
                data["translated_still_open_aspects"] = [
                    s.strip()
                    for s in all_translations[key].split("|||")
                    if s.strip()
                ]
 
        node["data"] = data
 
    for idx, edge in enumerate(g.get("edges", [])):
        key = f"edge_{idx}__display_label"
        if key in all_translations:
            edge["display_label"]  = all_translations[key]
            edge["original_label"] = edge.get("label", "")
 
    return g

async def translate_graph(
    graph: dict,
    target_locale: str,
    job_id: str,
    r
) -> dict:
    if not LINGO_API_KEY:
        logger.warning("LINGODOTDEV_API_KEY not set — skipping translation")
        return graph
 
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
 
    group_a, group_b = extract_node_fields(nodes)
    group_c          = extract_edge_fields(edges)
 
    total_fields = len(group_a) + len(group_b) + len(group_c)
    if total_fields == 0:
        logger.info("No translatable fields found")
        return graph
 
    logger.info(
        f"Job {job_id} — translating {total_fields} fields "
        f"({len(group_a)} paper nodes, {len(group_b)} gap nodes, "
        f"{len(group_c)} edge labels) → {target_locale}"
    )

    progress_counter = [0, total_fields]
 
    push_event(r, "translation_progress", job_id, {
        "status": "started",
        "total_fields": total_fields,
        "done_fields": 0,
        "target_locale": target_locale
    })
 
    try:
        async with make_engine() as engine:
 
            results = await asyncio.gather(
                translate_group(engine, group_a, DEFAULT_SOURCE, target_locale,
                                "paper nodes", job_id, r, progress_counter),
                translate_group(engine, group_b, DEFAULT_SOURCE, target_locale,
                                "gap nodes",   job_id, r, progress_counter),
                translate_group(engine, group_c, DEFAULT_SOURCE, target_locale,
                                "edge labels", job_id, r, progress_counter),
                return_exceptions=False
            )
 
            translated_a, translated_b, translated_c = results
 
        all_translations = {**translated_a, **translated_b, **translated_c}
        done_fields      = len(all_translations)
 
        push_event(r, "translation_progress", job_id, {
            "status":        "complete",
            "total_fields":  total_fields,
            "done_fields":   done_fields,
            "target_locale": target_locale
        })
 
        translated_graph = apply_translations(graph, all_translations)
        translated_graph["translated"]        = True
        translated_graph["target_locale"]     = target_locale
        translated_graph["fields_translated"] = done_fields
        translated_graph["glossary_applied"]  = True
 
        logger.info(
            f"Job {job_id} — translation complete: "
            f"{done_fields}/{total_fields} fields translated"
        )
        return translated_graph
 
    except Exception as e:
        logger.error(f"Job {job_id} — translation failed: {e} — returning original graph")
        push_event(r, "translation_progress", job_id, {
            "status":      "failed",
            "error":       str(e),
            "total_fields": total_fields,
            "done_fields": 0
        })
        graph["translated"]    = False
        graph["target_locale"] = target_locale
        graph["lingo_error"]   = str(e)
        return graph
    
async def translate_search_results(
    results: list[dict],
    target_locale: str
) -> list[dict]:
    if not LINGO_API_KEY or target_locale == "en" or not results:
        return results
 
    fields = {}
    for idx, result in enumerate(results):
        if result.get("title"):
            fields[f"result_{idx}__title"] = result["title"]
        if result.get("abstract"):
            fields[f"result_{idx}__abstract"] = result["abstract"]
 
    try:
        async with make_engine() as engine:
            translated = await engine.localize_object(
                fields,
                {
                    "source_locale":  DEFAULT_SOURCE,
                    "target_locale":  target_locale,
                    "fast":           True,
                    "reference": RESEARCH_GLOSSARY,
                }
            )
 
        import copy
        output = copy.deepcopy(results)
        for idx, result in enumerate(output):
            t_title = translated.get(f"result_{idx}__title")
            t_abstract = translated.get(f"result_{idx}__abstract")
            if t_title:
                result["translated_title"]    = t_title
            if t_abstract:
                result["translated_abstract"] = t_abstract
        return output
 
    except Exception as e:
        logger.warning(f"Search result translation failed: {e} — using originals")
        return results
    
async def process_job(job: dict, r) -> None:
    job_id = job.get("job_id")
    graph = job.get("graph", {})
    target_locale  = job.get("target_locale")
    original_query = job.get("original_query", "")
 
    if not job_id or not graph:
        logger.warning("Invalid lingo job — missing job_id or graph")
        return
 
    if not target_locale:
        logger.info(f"Job {job_id} — no locale in payload, detecting from query")
        target_locale = await detect_language(original_query)
 
    logger.info(f"Job {job_id} — target locale: {target_locale}")
    push_event(r, "translation_started", job_id, {"target_locale": target_locale})
 
    # Skip translation if target is English
    if target_locale == "en":
        logger.info(f"Job {job_id} — target is English, skipping translation")
        translated_graph = graph
        translated_graph["translated"]    = False
        translated_graph["target_locale"] = "en"
    else:
        translated_graph = await translate_graph(graph, target_locale, job_id, r)
 
    key = f"{TRANSLATED_PREFIX}{job_id}"
    r.set(key, json.dumps(translated_graph))
    r.expire(key, 3600)
 
    r.set(f"{GRAPH_PREFIX}{job_id}", json.dumps(translated_graph))
 
    push_event(r, "graph_translated", job_id, {
        "target_locale":     target_locale,
        "translated":        translated_graph.get("translated", False),
        "fields_translated": translated_graph.get("fields_translated", 0),
        "glossary_applied":  translated_graph.get("glossary_applied", False),
        "node_count":        len(translated_graph.get("nodes", [])),
        "edge_count":        len(translated_graph.get("edges", []))
    })
 
    logger.info(f"Job {job_id} — done ✓")

async def main_async():
    r = get_redis()
    logger.info("Lingo service started")
 
    while True:
        try:
            raw = r.lpop(QUEUE_LINGO)
            if raw:
                try:
                    job = json.loads(raw)
                    await process_job(job, r)
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse lingo job: {e}")
                except Exception as e:
                    logger.exception(f"Job processing failed: {e}")
            else:
                await asyncio.sleep(POLL_INTERVAL)
 
        except redis_lib.ConnectionError:
            logger.error("Redis connection lost — retrying in 5s")
            await asyncio.sleep(5)
 
        except Exception as e:
            logger.exception(f"Unexpected error: {e}")
            await asyncio.sleep(1)
 
 
def main():
    asyncio.run(main_async())
 
 
if __name__ == "__main__":
    main()