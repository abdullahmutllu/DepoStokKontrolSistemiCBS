"""OpenRouter chat client. Sync httpx; every failure raises AIUnavailableError
so routers can degrade gracefully — the app is fully functional without AI."""

import json
import logging

import httpx

from app.core.config import get_settings
from app.core.errors import AIUnavailableError

logger = logging.getLogger("depo.ai")


def chat_completion(messages: list[dict], *, json_mode: bool = True) -> str:
    """Single seam for all AI calls — tests monkeypatch this function."""
    settings = get_settings()
    if not settings.openrouter_api_key:
        raise AIUnavailableError("OPENROUTER_API_KEY tanımlı değil")

    payload: dict = {
        "model": settings.openrouter_model,
        "messages": messages,
        "max_tokens": settings.ai_max_tokens,
        "temperature": 0.1,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    try:
        response = httpx.post(
            f"{settings.openrouter_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.openrouter_api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=settings.ai_timeout_seconds,
        )
        response.raise_for_status()
        data = response.json()
        content = data["choices"][0]["message"]["content"]
        if not isinstance(content, str) or not content.strip():
            raise AIUnavailableError("AI boş yanıt döndürdü")
        return content
    except AIUnavailableError:
        raise
    except (httpx.HTTPError, KeyError, IndexError, json.JSONDecodeError) as exc:
        logger.warning("OpenRouter call failed: %s", exc)
        raise AIUnavailableError("AI servisine ulaşılamadı") from exc


def extract_json(content: str) -> dict:
    """Defensive JSON extraction: models sometimes wrap JSON in code fences."""
    text = content.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        text = text.removeprefix("json").strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("Yanıtta JSON nesnesi yok")
    return json.loads(text[start : end + 1])
