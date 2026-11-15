"""Sentinel's Claude brain (Anthropic API), tried before Groq when ANTHROPIC_API_KEY is set.

- Model: CLAUDE_MODEL, default Claude Sonnet 5.5: quick enough to talk to, and it keeps Sentinel's rules
  (brief, plain speech, no invented mission details) better than the free models.
- Thinking is off (between_tools) and effort is low: a spoken reply must start in about a second.
- The long instruction sheet is cached by the API, so later turns pay about a twentieth for it.
- A spending meter (data/claude_usage.json) stops Claude at CLAUDE_BUDGET_USD (default 4.50, under the $5 credit);
  after that, and whenever Claude fails or declines, Groq answers as before.
- Tests and offline runs (SENTINEL_NO_NETWORK=1) never call it.
"""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Iterator

DEFAULT_MODEL = "claude-sonnet-5-5"
# US dollars per million tokens: input, output, cache read, cache write (5-minute cache)
PRICES = {
    "claude-sonnet-5-5": (2.00, 10.00, 0.10, 2.50),
    "claude-haiku-5-5": (0.10, 0.50, 0.01, 0.125),
    "claude-opus-5-5": (4.00, 20.00, 0.20, 5.00),
}
USAGE_FILE = Path(__file__).resolve().parent.parent / "data" / "claude_usage.json"
_lock = threading.Lock()
_client = None
_down_until = 0.0          # after an outage or a refused key, Groq answers for a while without waiting on Claude
_last_error = ""


def key() -> str:
    return os.getenv("ANTHROPIC_API_KEY", "").strip()


def model() -> str:
    return os.getenv("CLAUDE_MODEL", "").strip() or DEFAULT_MODEL


def budget() -> float:
    try:
        return float(os.getenv("CLAUDE_BUDGET_USD", "") or 4.50)
    except ValueError:
        return 4.50


def _load() -> dict:
    try:
        return json.loads(USAGE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"usd": 0.0, "turns": 0, "input": 0, "output": 0, "cache_read": 0}


def usage() -> dict:
    u = _load()
    return {"model": model(), "spent_usd": round(u.get("usd", 0.0), 4), "budget_usd": budget(), "turns": u.get("turns", 0),
            "on": available(), "last_error": _last_error}


def _record(m: str, u) -> None:
    pin, pout, pread, pwrite = PRICES.get(m, PRICES[DEFAULT_MODEL])
    read = getattr(u, "cache_read_input_tokens", 0) or 0
    write = getattr(u, "cache_creation_input_tokens", 0) or 0
    fresh = getattr(u, "input_tokens", 0) or 0
    out = getattr(u, "output_tokens", 0) or 0
    cost = (fresh * pin + out * pout + read * pread + write * pwrite) / 1e6
    with _lock:
        d = _load()
        d["usd"] = d.get("usd", 0.0) + cost
        d["turns"] = d.get("turns", 0) + 1
        d["input"] = d.get("input", 0) + fresh + read + write
        d["output"] = d.get("output", 0) + out
        d["cache_read"] = d.get("cache_read", 0) + read
        try:
            USAGE_FILE.parent.mkdir(parents=True, exist_ok=True)
            USAGE_FILE.write_text(json.dumps(d), encoding="utf-8")
        except OSError:
            pass


def available() -> bool:
    if not key() or os.getenv("SENTINEL_NO_NETWORK") == "1":
        return False
    if time.monotonic() < _down_until:
        return False
    return _load().get("usd", 0.0) < budget()


def _get_client():
    global _client
    if _client is None:
        import anthropic
        # one quick try: if Claude is slow or down, Groq answers instead of the crew member waiting
        _client = anthropic.Anthropic(api_key=key(), max_retries=0, timeout=10.0)
    return _client


def _split(messages: list[dict]) -> tuple[list[dict], list[dict]]:
    """OpenAI-style messages -> (system blocks, Claude messages). The system sheet is marked for caching."""
    system = [m["content"] for m in messages if m["role"] == "system"]
    rest = [{"role": m["role"], "content": m["content"]} for m in messages if m["role"] in ("user", "assistant") and m.get("content")]
    while rest and rest[0]["role"] != "user":
        rest.pop(0)
    blocks = [{"type": "text", "text": "\n\n".join(system), "cache_control": {"type": "ephemeral"}}] if system else []
    return blocks, rest


def _fail(err: Exception) -> None:
    """Note why Claude did not answer; on a bad key or no credit stop trying for a while."""
    global _down_until, _last_error
    _last_error = f"{type(err).__name__}: {str(err)[:160]}"
    status = getattr(err, "status_code", 0) or 0
    pause = 1800 if status in (401, 402, 403) else 60 if status in (429, 529) or status >= 500 else 20
    _down_until = time.monotonic() + pause
    print(f"[sentinel brain] Claude unavailable ({_last_error}); Groq answers for {pause} s", flush=True)


class Declined(RuntimeError):
    """Claude declined this request (stop_reason refusal)."""


def stream(messages: list[dict], timeout: float = 10.0) -> Iterator[str]:
    """Yield the reply text as it streams. Raises before the first piece if Claude cannot answer."""
    m = model()
    system, msgs = _split(messages)
    try:
        with _get_client().with_options(timeout=timeout).messages.stream(
            model=m,
            max_tokens=700,
            system=system,
            messages=msgs,
            thinking={"type": "between_tools"},   # no thinking pause before speaking
            output_config={"effort": "low"},
        ) as s:
            for text in s.text_stream:
                yield text
            final = s.get_final_message()
    except Exception as e:
        _fail(e)
        raise
    _record(m, final.usage)
    if final.stop_reason == "refusal":
        raise Declined("declined")


def complete(messages: list[dict], timeout: float = 10.0) -> str:
    return "".join(stream(messages, timeout=timeout))
