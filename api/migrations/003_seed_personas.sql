-- Fictional organisation and demo personas.

INSERT INTO tenants (id, name, kind) VALUES
    ('northbridge', 'NorthBridge CDMO', 'cdmo'),
    ('public', 'Public regulatory library', 'public');

INSERT INTO clients (id, tenant_id, name) VALUES
    ('client-a', 'northbridge', 'Aldermoor Biologics'),
    ('client-b', 'northbridge', 'Corvane Therapeutics');

INSERT INTO users (id, name, title, role, tenant_id, client_ids, can_sign) VALUES
    ('qa-analyst-a', 'Alex Morgan', 'QA Analyst, Aldermoor Biologics programme', 'qa_analyst', 'northbridge', '{client-a}', false),
    ('qa-analyst-b', 'Sam Rivera', 'QA Analyst, Corvane Therapeutics programme', 'qa_analyst', 'northbridge', '{client-b}', false),
    ('qa-manager', 'Jordan Lee', 'QA Manager, reviewer and approver', 'qa_manager', 'northbridge', '{client-a,client-b}', true);
