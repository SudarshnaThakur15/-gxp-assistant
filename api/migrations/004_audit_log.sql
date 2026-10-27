-- Tamper-evident audit trail.
--
-- Each entry stores the hash of the entry before it:
--     hash = sha256(prev_hash || ':' || seq || ':' || record_canonical)
-- Changing any stored entry breaks every hash from that point on, which
-- verification detects. Triggers make the table append-only for normal use.

CREATE TABLE audit_log (
    seq              bigint PRIMARY KEY,
    recorded_at      timestamptz NOT NULL,
    actor            text NOT NULL,
    event_type       text NOT NULL,
    payload          jsonb NOT NULL,
    record_canonical text NOT NULL,  -- the exact text that was hashed
    prev_hash        text NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
    hash             text NOT NULL UNIQUE CHECK (hash ~ '^[0-9a-f]{64}$')
);

CREATE FUNCTION audit_log_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP;
END $$;

CREATE TRIGGER audit_log_no_update_delete
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

CREATE TRIGGER audit_log_no_truncate
    BEFORE TRUNCATE ON audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION audit_log_block_mutation();

-- Append in one round trip. The advisory lock serialises writers so two
-- entries can never claim the same seq or the same prev_hash.
CREATE FUNCTION audit_append(
    p_recorded_at timestamptz,
    p_actor       text,
    p_event_type  text,
    p_payload     jsonb,
    p_canonical   text
) RETURNS TABLE (entry_seq bigint, entry_hash text)
LANGUAGE plpgsql AS $$
DECLARE
    v_prev_seq  bigint;
    v_prev_hash text;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('audit_log'));

    SELECT a.seq, a.hash INTO v_prev_seq, v_prev_hash
      FROM audit_log a
     ORDER BY a.seq DESC
     LIMIT 1;

    entry_seq := coalesce(v_prev_seq, 0) + 1;
    v_prev_hash := coalesce(v_prev_hash, repeat('0', 64));
    entry_hash := encode(sha256(convert_to(v_prev_hash || ':' || entry_seq || ':' || p_canonical, 'UTF8')), 'hex');

    INSERT INTO audit_log (seq, recorded_at, actor, event_type, payload, record_canonical, prev_hash, hash)
    VALUES (entry_seq, p_recorded_at, p_actor, p_event_type, p_payload, p_canonical, v_prev_hash, entry_hash);

    RETURN NEXT;
END $$;
