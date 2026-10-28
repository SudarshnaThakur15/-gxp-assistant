"""Unit tests for choosing the chunks of documents named in a question. No AI, no database.

    uv run pytest -q
"""

from app.retrieval import pick_named


def rows(code, n, relevant=()):
    return [{"code": code, "ordinal": i, "similarity": 0.9 if i in relevant else 0.5} for i in range(n)]


def test_named_documents_that_fit_come_in_whole_in_document_order():
    picked = pick_named(rows("DEV-2026-019", 6), ["DEV-2026-019"], budget=10)
    assert [r["ordinal"] for r in picked] == list(range(6))


def test_a_long_document_keeps_its_most_relevant_chunks_not_just_the_first_ones():
    picked = pick_named(rows("SOP-QA-012", 12, relevant={10, 11}), ["SOP-QA-012"], budget=10)
    assert {10, 11} <= {r["ordinal"] for r in picked} and len(picked) == 10


def test_two_named_documents_share_the_budget():
    picked = pick_named(rows("SOP-QA-012", 12) + rows("SOP-QA-015", 9), ["SOP-QA-012", "SOP-QA-015"], budget=10)
    by_code = [r["code"] for r in picked]
    assert by_code.count("SOP-QA-012") == 5 and by_code.count("SOP-QA-015") == 5
    assert by_code == sorted(by_code, key=["SOP-QA-012", "SOP-QA-015"].index)  # in the order the question names them


def test_a_short_named_document_leaves_its_unused_share_to_the_other():
    picked = pick_named(rows("CAPA-2026-007", 2) + rows("SOP-QA-012", 12), ["CAPA-2026-007", "SOP-QA-012"], budget=10)
    assert [r["code"] for r in picked].count("CAPA-2026-007") == 2 and len(picked) == 10
