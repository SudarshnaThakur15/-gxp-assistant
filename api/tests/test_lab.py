"""The assurance lab shown in the UI must always pass against the current rules. No AI, no database.

    uv run pytest -q
"""

from app.assurance_info import run_lab


def test_every_lab_case_is_handled_as_expected():
    lab = run_lab()
    failing = [(c["id"], c["expected"], c["actual"], c["triggered"]) for c in lab["cases"] if not c["as_expected"]]
    assert not failing, failing
