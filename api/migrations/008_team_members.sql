-- Team input: questions the approved documents cannot answer go to a named team.
--
--   team_member  a subject-matter expert who answers questions put to their teams; cannot
--                ask questions or sign, and sees only the requests addressed to their teams
--   teams        the teams a user answers for (a QA Manager answers for Quality Assurance)
--
-- Requests and answers are audit-trail events (team_request, team_answer): no new table.

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('qa_analyst', 'qa_manager', 'auditor', 'team_member'));
ALTER TABLE users ADD COLUMN teams text[] NOT NULL DEFAULT '{}';

INSERT INTO users (id, name, title, role, tenant_id, client_ids, can_sign, teams) VALUES
    ('team-sme', 'Priya Shah', 'QC Manager, answers for Quality Control, Production and Engineering',
     'team_member', 'northbridge', '{client-a,client-b}', false, '{quality-control,production,engineering}');

UPDATE users SET teams = '{quality-assurance}' WHERE id = 'qa-manager';
