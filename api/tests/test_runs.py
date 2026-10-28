"""Unit tests for the UI read models (app/runs.py). No AI, no database.

    uv run pytest -q
"""

from app.runs import public_reason, public_reasons

RAW = ("generation failed: RateLimitError: Error code: 429 - {'error': {'message': 'Rate limit reached for model "
       "`openai/gpt-oss-120b` in organization `org_example123` service tier `on_demand`'}}")


def test_a_failed_ai_step_shows_its_error_type_only():
    assert public_reason(RAW) == "generation failed: RateLimitError"
    assert public_reason("screening failed: TimeoutError") == "screening failed: TimeoutError"
    assert "org_" not in " ".join(public_reasons({"reasons": [RAW, "R-HUMAN: SOP-QA-012 §5.2 requires a person"]}))


def test_other_reasons_are_unchanged():
    assert public_reason("S1: Release, shipment or disposition decision") == "S1: Release, shipment or disposition decision"
    assert public_reason(None) is None
