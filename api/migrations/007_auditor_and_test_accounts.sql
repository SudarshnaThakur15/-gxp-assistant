-- Segregation of duties, and a separate identity for automated test runs.
--
--   auditor  sees every question, answer and audit entry for the clients they cover,
--            but can neither ask questions nor sign (read-only)
--   is_test  accounts used only by the automated evaluation, so a test run is never
--            attributed to a real person; they cannot be chosen in the persona switcher

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('qa_analyst', 'qa_manager', 'auditor'));
ALTER TABLE users ADD COLUMN is_test boolean NOT NULL DEFAULT false;

INSERT INTO users (id, name, title, role, tenant_id, client_ids, can_sign) VALUES
    ('qa-auditor', 'Taylor Brooks', 'Quality Auditor, read-only', 'auditor', 'northbridge', '{client-a,client-b}', false);

INSERT INTO users (id, name, title, role, tenant_id, client_ids, can_sign, is_test) VALUES
    ('test-analyst-a', 'Test account A', 'Automated evaluation, Aldermoor Biologics programme', 'qa_analyst',
     'northbridge', '{client-a}', false, true),
    ('test-analyst-b', 'Test account B', 'Automated evaluation, Corvane Therapeutics programme', 'qa_analyst',
     'northbridge', '{client-b}', false, true);
