-- Organisations, people and the controlled document estate.

CREATE TABLE tenants (
    id   text PRIMARY KEY,
    name text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('cdmo', 'biotech', 'public'))
);

-- A CDMO's clients. Documents tagged with a client are walled off from
-- users who do not work on that client's programme.
CREATE TABLE clients (
    id        text PRIMARY KEY,
    tenant_id text NOT NULL REFERENCES tenants (id),
    name      text NOT NULL
);

-- Demo personas (no real login). Signing password hash is set up with e-signatures.
CREATE TABLE users (
    id                    text PRIMARY KEY,
    name                  text NOT NULL,
    title                 text NOT NULL,
    role                  text NOT NULL CHECK (role IN ('qa_analyst', 'qa_manager')),
    tenant_id             text NOT NULL REFERENCES tenants (id),
    client_ids            text[] NOT NULL DEFAULT '{}',
    can_sign              boolean NOT NULL DEFAULT false,
    signing_password_hash text
);

-- One row per document version. Only 'effective' versions may ground answers.
CREATE TABLE documents (
    id              bigserial PRIMARY KEY,
    code            text NOT NULL,
    title           text NOT NULL,
    version         text NOT NULL,
    status          text NOT NULL CHECK (status IN ('draft', 'effective', 'superseded', 'withdrawn')),
    doc_type        text NOT NULL,
    effective_date  date,
    review_date     date,
    owner           text NOT NULL,
    tenant_id       text NOT NULL REFERENCES tenants (id),
    client_id       text REFERENCES clients (id),
    confidentiality text NOT NULL DEFAULT 'internal',
    source_path     text NOT NULL,
    content_hash    text NOT NULL,
    ingested_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (code, version)
);

-- Retrievable passages. Access fields are copied from the document so the
-- permission filter runs inside the same index query as the search.
CREATE TABLE chunks (
    id           bigserial PRIMARY KEY,
    document_id  bigint NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    ordinal      int NOT NULL,
    section_path text NOT NULL,
    text         text NOT NULL,
    embedding    vector(384),  -- bge-small-en-v1.5
    tsv          tsvector GENERATED ALWAYS AS (to_tsvector('english', section_path || ' ' || text)) STORED,
    tenant_id    text NOT NULL,
    client_id    text,
    status       text NOT NULL,
    UNIQUE (document_id, ordinal)
);

CREATE INDEX chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX chunks_tsv_idx ON chunks USING gin (tsv);
CREATE INDEX chunks_access_idx ON chunks (tenant_id, client_id, status);

-- Superseding or re-scoping a document must reach its chunks immediately,
-- otherwise retrieval could serve a superseded passage.
CREATE FUNCTION documents_sync_chunk_access() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE chunks
       SET status = NEW.status, tenant_id = NEW.tenant_id, client_id = NEW.client_id
     WHERE document_id = NEW.id;
    RETURN NEW;
END $$;

CREATE TRIGGER documents_access_sync
    AFTER UPDATE OF status, tenant_id, client_id ON documents
    FOR EACH ROW EXECUTE FUNCTION documents_sync_chunk_access();
