"""Gate 1, SCREEN (AI part, chats only): understand a follow-up.

A follow-up such as "where does it say that?" cannot be searched on its own, so the AI
rewrites it into one self-contained question from the earlier turns. The rewrite only
restates, it never answers. The rules then screen the message as typed, the rewrite and
the targets the chat named earlier (app.assurance), and every later gate works on the
rewrite, which the record keeps beside the typed text. The rewrite sees only what the
requester was shown: never a withheld draft. A failed call is a refusal (invariant 5).
"""

import hashlib

from app.assurance import plain
from app.llm import complete_json

PROMPT_VERSION = "followup/2"
MAX_TURNS = 4        # earlier turns the rewrite sees
MAX_SHOWN_CHARS = 700

SYSTEM = """You rewrite the latest message in a chat with a GMP document assistant into one
self-contained question that can be understood without the conversation.
- Resolve words such as "it", "this", "that", "they" or "the same" from the earlier turns.
- A question about the assistant's last reply ("where does it say that?", "why?") asks about the point
  that reply made: name that point.
- Keep the user's meaning and wording as far as possible. Never answer the question.
- Do not add facts, document codes, batch numbers or numbers that are not in the conversation.
- If the latest message is already self-contained, or starts a new topic, return it unchanged."""

SCHEMA = {
    "type": "object",
    "properties": {"question": {"type": "string"}},
    "required": ["question"],
    "additionalProperties": False,
}

PROMPT_FINGERPRINT = hashlib.sha256(SYSTEM.encode()).hexdigest()


def rewrite(message: str, history: list[dict], max_wait_s: float | None = None) -> tuple[str, dict]:
    """history: earlier turns, oldest first, as {"question": typed, "shown": what the requester saw}."""
    turns = [f"User: {t['question']}\nAssistant: {t['shown'][:MAX_SHOWN_CHARS]}" for t in history[-MAX_TURNS:]]
    user = "Conversation so far:\n" + "\n".join(turns) + f"\n\nLatest message: {message}"
    kwargs = {} if max_wait_s is None else {"max_wait_s": max_wait_s}
    data, meta = complete_json(SYSTEM, user, SCHEMA, "followup", max_output_tokens=1024, **kwargs)
    return " ".join(plain(data["question"]).split()), meta  # one dash style, so codes are recognised
