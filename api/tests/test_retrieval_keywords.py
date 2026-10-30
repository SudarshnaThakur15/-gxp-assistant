from app.retrieval import Hit, key_terms, keyword_match


def hit(text, similarity):
    return Hit(chunk_id=1, document_id=1, code="SPEC-ALD-001", version="2.0", title="T", doc_type="specification",
               record_state=None, fingerprint="f", section="4", page=None, text=text, similarity=similarity,
               score=0.03, regulatory_status=None, required_qualifier=None, is_named=False)


SPEC = "| Bacterial endotoxins | Ph. Eur. 2.6.14 | ≤ 0.5 EU/mg |"


def test_key_terms_drop_question_words():
    assert key_terms("What is the bacterial endotoxin limit?") == ["bacter", "endoto", "limit"]


def test_short_question_with_the_right_words_is_found():
    assert keyword_match("what is bacterial endotoxin limit?", [hit(SPEC, 0.65)])


def test_off_topic_question_is_not_rescued():
    assert not keyword_match("what is the weather in Paris today?", [hit(SPEC, 0.65)])
    assert not keyword_match("what is the visa policy for employees?", [hit("Quality policy for all staff", 0.6)])


def test_word_match_needs_a_minimum_similarity():
    assert not keyword_match("what is bacterial endotoxin limit?", [hit(SPEC, 0.45)])
