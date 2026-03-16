"""
shared/llm.py
Unified LLM client. Set LLM_PROVIDER=groq or LLM_PROVIDER=ollama in .env.
All agent services import call_llm() from here — never talk to APIs directly.
"""

import os
import logging
import httpx
from typing import Optional

logger = logging.getLogger(__name__)

PROVIDER    = os.getenv("LLM_PROVIDER", "groq")
GROQ_KEY    = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL  = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
OLLAMA_URL  = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")


def call_llm(system_prompt: str, user_prompt: str, max_tokens: int = 1024) -> str:
    """
    Call the configured LLM. Returns the response text.
    Falls back to Ollama if Groq fails.
    """
    if PROVIDER == "groq":
        try:
            return _call_groq(system_prompt, user_prompt, max_tokens)
        except Exception as e:
            logger.warning(f"Groq failed ({e}), falling back to Ollama")
            return _call_ollama(system_prompt, user_prompt)
    else:
        return _call_ollama(system_prompt, user_prompt)


def _call_groq(system_prompt: str, user_prompt: str, max_tokens: int) -> str:
    headers = {
        "Authorization": f"Bearer {GROQ_KEY}",
        "Content-Type": "application/json"
    }
    body = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt}
        ],
        "max_tokens": max_tokens,
        "temperature": 0.3           # Low temp = consistent structured outputs
    }
    with httpx.Client(timeout=60) as client:
        resp = client.post("https://api.groq.com/openai/v1/chat/completions",
                           headers=headers, json=body)
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()


def _call_ollama(system_prompt: str, user_prompt: str) -> str:
    body = {
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt}
        ],
        "stream": False
    }
    with httpx.Client(timeout=120) as client:
        resp = client.post(f"{OLLAMA_URL}/api/chat", json=body)
        resp.raise_for_status()
        return resp.json()["message"]["content"].strip()
