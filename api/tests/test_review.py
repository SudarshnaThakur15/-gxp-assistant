"""Unit tests for QA review and electronic signature (app/review.py). No AI, no database.

    uv run pytest -q
"""

from app.review import (
    content_hash,
    hash_password,
    manifestation,
    signed_content,
    verify_password,
)

PAYLOAD = {
    "question": "Who approves a change to a master batch record?",
    "persona": "qa-analyst-a",
    "withheld_draft": "MBR changes need Production Manager, QA and client approval. [1] The QP is informed. [1]",
    "claims": [
        {"n": 1, "text": "MBR changes need Production Manager, QA and client approval.", "source_id": "c7",
         "quote": "require approval by the Production Manager, QA and the client"},
        {"n": 2, "text": "The QP is informed.", "source_id": "c7", "quote": "the Qualified Person is informed"},
    ],
    "retrieval": {"passages": [
        {"id": "c7", "doc": "SOP-QA-020", "version": "2.0", "section": "5.3 Approval", "page": None,
         "document_fingerprint": "abc"},
        {"id": "c9", "doc": "SOP-QA-030", "version": "1.0", "section": "6 Retention", "document_fingerprint": "def"},
    ]},
}


def test_password_hash_verifies_only_the_right_password():
    stored = hash_password("correct horse battery")
    assert verify_password("correct horse battery", stored)
    assert not verify_password("correct horse batterY", stored)
    assert hash_password("correct horse battery") != stored  # salted: same password, different hash
    assert "correct horse" not in stored


def test_malformed_or_missing_hash_never_verifies():
    for stored in (None, "", "plain-text", "md5$x$y", "scrypt$16384$8$1$not-base64!$x"):
        assert not verify_password("anything", stored)


def test_signed_content_is_bound_to_the_entry_and_numbered_like_the_answer():
    content = signed_content(42, "h" * 64, PAYLOAD)
    assert content["ask"] == {"seq": 42, "hash": "h" * 64}
    assert [c["n"] for c in content["citations"]] == [1]  # only cited passages, one marker per source
    assert content["citations"][0]["quotes"] == [c["quote"] for c in PAYLOAD["claims"]]


def test_any_change_to_the_signed_content_changes_its_hash():
    original = content_hash(signed_content(42, "h" * 64, PAYLOAD))
    edited = PAYLOAD | {"withheld_draft": PAYLOAD["withheld_draft"].replace("QA", "QC")}
    assert content_hash(signed_content(42, "h" * 64, edited)) != original
    assert content_hash(signed_content(43, "h" * 64, PAYLOAD)) != original  # cannot move to another entry


def test_signature_line_shows_name_title_meaning_and_time():
    line = manifestation({"signer": {"name": "Jordan Lee", "title": "QA Manager"},
                          "meaning": "Approved: reviewed against the cited sources and released for use",
                          "signed_at": "2026-10-28T14:05:09+00:00"})
    assert line == ("Jordan Lee, QA Manager. Approved: reviewed against the cited sources and released for use. "
                    "Signed 28 Oct 2026 14:05 UTC.")
