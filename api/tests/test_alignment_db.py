"""Every clause the alignment pages cite resolves to an in-force section. Read-only.

    RUN_DB_TESTS=1 uv run pytest -q tests/test_alignment_db.py
"""

import os

import pytest

from app.alignment import controls, q9
from app.db import connect

pytestmark = pytest.mark.skipif(not os.environ.get("RUN_DB_TESTS"), reason="set RUN_DB_TESTS=1 to run")


def test_every_controls_reference_resolves():
    with connect() as conn:
        data = controls(conn)
    unresolved = [x["label"] for r in data["rows"] for x in [r["reg"], *r["company"]] if not x["resolved"]]
    assert unresolved == []


def test_every_q9_quote_is_in_the_guideline():
    with connect() as conn:
        data = q9(conn)
    assert all(p["ref"]["resolved"] for p in data["principles"]), [p["ref"]["label"] for p in data["principles"]]
