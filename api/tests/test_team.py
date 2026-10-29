"""Who may see a team request. No database."""

from app.team import _visible


def viewer(role="qa_analyst", teams=(), clients=("client-a",), can_sign=False, id_="viewer"):
    return (id_, role, "northbridge", list(clients), list(teams), can_sign)


def visible(v, team="quality-control", requester="someone", clients=("client-a",), is_test=False, tenant="northbridge"):
    return _visible(v, requester, tenant, list(clients), is_test, team)


def test_requesters_see_their_own_and_teams_see_only_theirs():
    assert visible(viewer(id_="someone"))
    assert visible(viewer(role="team_member", teams=["quality-control"]))
    assert not visible(viewer(role="team_member", teams=["production"]))
    assert not visible(viewer())  # another analyst


def test_test_runs_reach_auditors_only_and_tenants_stay_apart():
    assert not visible(viewer(role="team_member", teams=["quality-control"]), is_test=True)
    assert visible(viewer(role="auditor"), is_test=True)
    assert not visible(viewer(role="auditor"), tenant="other-cdmo")


def test_qa_managers_see_the_programmes_they_cover():
    manager = viewer(role="qa_manager", can_sign=True, clients=["client-a", "client-b"])
    assert visible(manager, team="production", clients=["client-b"])
    assert not visible(viewer(role="qa_manager", can_sign=True, clients=["client-a"]), clients=["client-b"])
