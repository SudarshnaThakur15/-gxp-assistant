"""Unit tests for the document library (app/documents.py). No AI, no database.

    uv run pytest -q
"""

from app.documents import join_overlapping


def test_overlapping_chunks_are_joined_without_repeating_text():
    first = "Step 1. Quarantine the batch.\nStep 2. Notify QA within 24 hours."
    second = "Step 2. Notify QA within 24 hours.\nStep 3. Open a deviation."
    assert join_overlapping(first, second) == first + "\nStep 3. Open a deviation."
    assert join_overlapping("Alpha section text here.", "Completely different text.") == (
        "Alpha section text here.\nCompletely different text.")
