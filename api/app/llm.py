"""Model gateway: the only module that talks to an LLM provider.

Swapping provider (e.g. to an enterprise endpoint with zero data retention) means
changing this file, not the pipeline. The model version is pinned and recorded
with every answer. There is deliberately no fallback to a different model
(invariant 5): if the call fails, is cut off, or returns malformed output, it
raises and the pipeline refuses.

Rate limits are handled visibly: on HTTP 429 we wait for the provider's
`retry-after`, but never longer in total than `max_wait_s` (short for a person
waiting on an answer, long for offline evaluation runs).
"""

import json
import sys
import time
from functools import cache

from groq import Groq, RateLimitError

from app.config import settings

PROVIDER = "groq"
MODEL = "openai/gpt-oss-120b"
REQUEST_TIMEOUT_S = 60.0
INTERACTIVE_MAX_WAIT_S = 20.0


class ModelOutputError(Exception):
    """The model's output cannot be used (cut off or not valid JSON)."""


@cache
def _client() -> Groq:
    return Groq(api_key=settings.groq_api_key, max_retries=0, timeout=REQUEST_TIMEOUT_S)


def _rate_limit_details(error: RateLimitError) -> dict:
    """What the provider actually said: requested wait, which limit, and remaining budget."""
    h = error.response.headers
    try:
        message = error.response.json().get("error", {}).get("message", "")
    except ValueError:
        message = error.response.text
    return {
        "retry_after_s": float(h.get("retry-after", "10") or 10),
        "message": message[:300],
        "remaining_tokens": h.get("x-ratelimit-remaining-tokens"),
        "reset_tokens": h.get("x-ratelimit-reset-tokens"),
    }


def complete_json(system: str, user: str, schema: dict, name: str, *, max_output_tokens: int,
                  max_wait_s: float = INTERACTIVE_MAX_WAIT_S) -> tuple[dict, dict]:
    """Return (JSON constrained to `schema`, usage metadata). Raises on any unusable outcome."""
    waited = 0.0
    while True:
        try:
            response = _client().chat.completions.create(
                model=MODEL,
                temperature=0,
                max_completion_tokens=max_output_tokens,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                response_format={"type": "json_schema",
                                 "json_schema": {"name": name, "schema": schema, "strict": True}},
            )
            break
        except RateLimitError as e:
            info = _rate_limit_details(e)
            print(f"[llm] rate limited by {PROVIDER}: retry-after={info['retry_after_s']:.0f}s "
                  f"tokens_left={info['remaining_tokens']} (reset {info['reset_tokens']}) :: {info['message']}",
                  file=sys.stderr, flush=True)
            if waited + info["retry_after_s"] > max_wait_s:
                raise
            time.sleep(info["retry_after_s"])
            waited += info["retry_after_s"]

    choice = response.choices[0]
    if choice.finish_reason != "stop":  # e.g. "length": the JSON was cut off mid-way
        raise ModelOutputError(f"model output incomplete (finish_reason={choice.finish_reason})")
    try:
        data = json.loads(choice.message.content or "")
    except json.JSONDecodeError as e:
        raise ModelOutputError("model output is not valid JSON") from e
    usage = response.usage
    meta = {"provider": PROVIDER, "model": MODEL, "input_tokens": usage.prompt_tokens,
            "output_tokens": usage.completion_tokens, "rate_limit_wait_s": round(waited)}
    return data, meta
