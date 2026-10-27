-- Processing fingerprint: file + parser + parse-affecting metadata + embedding model.
ALTER TABLE documents ADD COLUMN fingerprint text;

-- The database itself guarantees at most one effective version per document.
CREATE UNIQUE INDEX documents_one_effective_version ON documents (code) WHERE status = 'effective';
