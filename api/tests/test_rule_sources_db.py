"""Refusal sources against the real documents. Read-only.

    RUN_DB_TESTS=1 uv run pytest -q tests/test_rule_sources_db.py

Skipped by default: they need the database.
"""

import os

import pytest

from app.assurance import AI_SCREEN_SOURCES, SCREEN_RULES
from app.db import connect
from app.pipeline import _rule_sources

pytestmark = pytest.mark.skipif(not os.environ.get("RUN_DB_TESTS"), reason="set RUN_DB_TESTS=1 to run")


@pytest.mark.parametrize("rule_id", [*SCREEN_RULES, "AI"])
def test_every_quoted_source_is_in_the_effective_document(rule_id):
    sources = AI_SCREEN_SOURCES if rule_id == "AI" else SCREEN_RULES[rule_id]["sources"]
    with connect() as conn:
        cited = _rule_sources(conn, "qa-analyst-a", sources)
    quoted = [q for c in cited for q in c["quotes"]]
    assert quoted == list(dict.fromkeys(s["quote"] for s in sources)), "a source quote no longer matches its document"
    assert all(c["title"] and c["version"] for c in cited)
