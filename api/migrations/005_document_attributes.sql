-- Attributes needed once real-world sources (PDF, Word + DMS export) are ingested.

ALTER TABLE documents
    ADD COLUMN source_format      text NOT NULL DEFAULT 'markdown'
                                   CHECK (source_format IN ('markdown', 'pdf', 'docx')),
    ADD COLUMN regulatory_status  text,   -- regulator's status: in_force | ich_step4 | consultation_draft
    ADD COLUMN required_qualifier text,   -- sentence every answer citing this document must include
    ADD COLUMN record_state       text CHECK (record_state IN ('open', 'closed')),  -- deviations / CAPAs
    ADD COLUMN source_url         text,   -- where an external document was obtained
    ADD COLUMN parser             text;   -- parser and version, for traceability

ALTER TABLE chunks
    ADD COLUMN heading         text,      -- section title shown next to the citation
    ADD COLUMN page            int,       -- PDF page number, when known
    ADD COLUMN embedding_model text;      -- pinned model that produced the vector
