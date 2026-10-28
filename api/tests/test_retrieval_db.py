"""Retrieval permission tests against the real database. Every change is rolled back.

    RUN_DB_TESTS=1 uv run pytest -q tests/test_retrieval_db.py

Skipped by default: they need the database and load the embedding model.
"""

import os

import pytest

from app.db import connect
from app.retrieval import retrieve

pytestmark = pytest.mark.skipif(not os.environ.get("RUN_DB_TESTS"), reason="set RUN_DB_TESTS=1 to run")

QUESTION = "What is the shelf life and storage of the CRV-220 prefilled syringe?"


def test_another_clients_superseded_document_is_never_named():
    with connect() as conn:
        try:
            # Client B's specification becomes superseded (the trigger syncs its chunks).
            conn.execute("UPDATE documents SET status = 'superseded' WHERE code = 'SPEC-CRV-001'")
            superseded_and_hidden = conn.execute(
                "SELECT count(*) FROM chunks WHERE status = 'superseded' AND client_id = 'client-b'").fetchone()[0]
            assert superseded_and_hidden > 0

            result = retrieve(conn, "qa-analyst-a", QUESTION)  # client A only
            named = [x["document"] for x in result.excluded if x["document"]]
            hidden = [x["reason"] for x in result.excluded if x["document"] is None]
            assert not any("SPEC-CRV-001" in d for d in named), named
            assert hidden and "not authorised" in hidden[0]
            assert all(h.code != "SPEC-CRV-001" for h in result.hits)
        finally:
            conn.rollback()


def test_own_superseded_version_is_named():
    with connect() as conn:
        result = retrieve(conn, "qa-analyst-a", "Within how many working days must a critical deviation be recorded?")
        conn.rollback()
    assert {"document": "SOP-QA-012 v3.0", "reason": "superseded"} in result.excluded


def test_two_named_documents_both_reach_the_answer_step():
    with connect() as conn:
        result = retrieve(conn, "qa-analyst-a", "Compare SOP-QA-012 and SOP-QA-015 on timelines.")
        conn.rollback()
    assert {"SOP-QA-012", "SOP-QA-015"} <= {h.code for h in result.hits}


def test_a_late_section_of_a_long_named_document_is_not_cut_off():
    with connect() as conn:  # SOP-QA-012 has 12 chunks; "6 Records" is the 11th
        result = retrieve(conn, "qa-analyst-a", "What does SOP-QA-012 say about deviation records and their retention?")
        conn.rollback()
    assert "6 Records" in {h.section for h in result.hits if h.code == "SOP-QA-012"}
