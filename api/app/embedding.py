"""Local embedding model (runs on this machine; document text is never sent out to embed).

The model is pinned: every chunk records which model produced its vector, so a
model change is detectable and triggers re-ingestion.
"""

from functools import cache

from fastembed import TextEmbedding

from app.corpus import REPO_ROOT

EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"
DIMENSIONS = 384
CACHE_DIR = REPO_ROOT / ".cache" / "fastembed"


@cache
def _model() -> TextEmbedding:
    return TextEmbedding(model_name=EMBEDDING_MODEL, cache_dir=str(CACHE_DIR))


def embed_passages(texts: list[str]) -> list[list[float]]:
    return [vector.tolist() for vector in _model().passage_embed(texts)]


def embed_query(text: str) -> list[float]:
    return next(iter(_model().query_embed(text))).tolist()


def to_pgvector(vector: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in vector) + "]"
