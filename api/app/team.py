"""Team input: questions the approved documents cannot answer go to a named team.

When an answer is "not found", the person who asked can put the question to the team that
owns that kind of document. The request stays open until a member of that team answers.
Request and answer are audit-trail events (team_request, team_answer), hash-chained like
every other entry. A team's answer is a person's statement, not an approved document: it is
shown as such and never grounds an AI answer.
"""

import psycopg

from app.assurance import team_answer_problems
from app.audit import append_event

TEAMS = {"quality-assurance": "Quality Assurance", "quality-control": "Quality Control",
         "production": "Production", "engineering": "Engineering"}
MIN_TEXT, MAX_TEXT = 3, 1000

VIEWER_SQL = "SELECT id, role, tenant_id, client_ids, teams, can_sign FROM users WHERE id = %s"
REQUESTS_SQL = """
SELECT r.seq, r.recorded_at, r.payload, q.id, q.name, q.tenant_id, q.client_ids, q.is_test,
       ans.seq, ans.recorded_at, ans.payload, u.name
  FROM audit_log r
  JOIN users q ON q.id = r.payload ->> 'persona'
  LEFT JOIN audit_log ans ON ans.event_type = 'team_answer' AND (ans.payload ->> 'request_seq')::bigint = r.seq
  LEFT JOIN users u ON u.id = ans.payload ->> 'persona'
 WHERE r.event_type = 'team_request'
 ORDER BY r.seq DESC
"""
ASK_SQL = "SELECT payload FROM audit_log WHERE seq = %s AND event_type = 'ask'"


class TeamInputRefused(Exception):
    def __init__(self, status: int, message: str, recorded: bool = False):
        super().__init__(message)
        self.status = status
        self.recorded = recorded  # the refusal was written to the audit trail: the caller commits it


def _viewer(conn: psycopg.Connection, persona: str) -> tuple:
    v = conn.execute(VIEWER_SQL, (persona,)).fetchone()
    if v is None:
        raise TeamInputRefused(403, "Unknown user.")
    return v


def _visible(v: tuple, requester: str, tenant: str, clients: list[str], is_test: bool, team: str) -> bool:
    vid, role, v_tenant, v_clients, v_teams, can_sign = v
    if vid == requester:
        return True
    if tenant != v_tenant:
        return False
    if role == "auditor":
        return True                                    # read-only oversight, test requests labelled
    if is_test:
        return False                                   # automated test runs are not real work
    return team in v_teams or (can_sign and set(clients) <= set(v_clients))


def requests(conn: psycopg.Connection, persona: str) -> list[dict]:
    """Team requests this person may see, newest first."""
    v = _viewer(conn, persona)
    items = []
    for (seq, at, p, req_id, req_name, tenant, clients, is_test,
         ans_seq, ans_at, ans, ans_name) in conn.execute(REQUESTS_SQL).fetchall():
        if not _visible(v, req_id, tenant, clients, is_test, p["team"]):
            continue
        items.append({
            "seq": seq, "recorded_at": at, "ask_seq": p["ask_seq"], "chat_id": p.get("chat_id") or f"r{p['ask_seq']}",
            "team": {"id": p["team"], "name": TEAMS[p["team"]]}, "question": p["question"],
            "asked_by": {"id": req_id, "name": req_name}, "test": is_test,
            "status": "answered" if ans_seq else "waiting",
            "answer": None if not ans_seq else {"seq": ans_seq, "recorded_at": ans_at, "text": ans["answer"],
                                                 "by": {"id": ans["persona"], "name": ans_name}},
            "can_answer": not ans_seq and p["team"] in v[4] and v[0] != req_id,
        })
    return items


def waiting_count(conn: psycopg.Connection, persona: str) -> int:
    """Open requests this person can answer (the menu badge)."""
    return sum(1 for r in requests(conn, persona) if r["can_answer"])


def ask_team(conn: psycopg.Connection, persona: str, ask_seq: int, team: str, question: str) -> dict:
    """Put a question the documents could not answer to a team. Does not commit."""
    question = " ".join(question.split())
    if team not in TEAMS:
        raise TeamInputRefused(422, "Choose one of the teams.")
    if not MIN_TEXT <= len(question) <= MAX_TEXT:
        raise TeamInputRefused(422, f"The question must be {MIN_TEXT} to {MAX_TEXT} characters.")
    row = conn.execute(ASK_SQL, (ask_seq,)).fetchone()
    if row is None or row[0]["persona"] != persona:
        raise TeamInputRefused(404, "Only the person who asked can send this question to a team.")
    if row[0]["answer_type"] != "not_found":
        raise TeamInputRefused(409, "Only questions the documents could not answer go to a team.")
    if any(r["ask_seq"] == ask_seq for r in requests(conn, persona)):
        raise TeamInputRefused(409, "This question has already been sent to a team.")
    chat_id = (row[0].get("chat") or {}).get("id")
    entry = append_event(conn, f"user:{persona}"[:80], "team_request",
                         {"ask_seq": ask_seq, "chat_id": chat_id, "team": team, "question": question,
                          "persona": persona})
    return {"seq": entry["seq"], "ask_seq": ask_seq, "team": team}


def answer_request(conn: psycopg.Connection, persona: str, request_seq: int, answer: str) -> dict:
    """A team member answers an open request. Does not commit."""
    answer = answer.strip()
    if not MIN_TEXT <= len(answer) <= MAX_TEXT:
        raise TeamInputRefused(422, f"The answer must be {MIN_TEXT} to {MAX_TEXT} characters.")
    item = next((r for r in requests(conn, persona) if r["seq"] == request_seq), None)
    if item is None:
        raise TeamInputRefused(404, "No request with this number is visible to you.")
    if item["status"] == "answered":
        raise TeamInputRefused(409, "This request has already been answered.")
    if not item["can_answer"]:
        raise TeamInputRefused(403, f"Only a member of {item['team']['name']} can answer this request.")
    if problems := team_answer_problems(answer):  # a team answer may not carry a GMP decision either
        append_event(conn, f"user:{persona}"[:80], "team_answer_refused",
                     {"request_seq": request_seq, "ask_seq": item["ask_seq"], "persona": persona, "problems": problems})
        raise TeamInputRefused(422, "This answer reads as a decision (" + "; ".join(problems) + "). Team answers "
                               "cannot release batches, classify deviations, set root causes or CAPAs, or say a "
                               "result meets its specification. Please state the facts, or raise it with QA.",
                               recorded=True)
    entry = append_event(conn, f"user:{persona}"[:80], "team_answer",
                         {"request_seq": request_seq, "ask_seq": item["ask_seq"], "team": item["team"]["id"],
                          "answer": answer, "persona": persona})
    return {"seq": entry["seq"], "request_seq": request_seq}
