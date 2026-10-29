"""The alignment pages' fixed content: every rule a risk measure names exists, and scores add up."""

import re

from app.alignment import CONTROLS, RISKS, rule_ids

RULE_LIKE = re.compile(r"^(?:S\d|V\d+|R-[A-Z-]+)$")


def test_every_rule_a_risk_measure_names_exists():
    for r in RISKS:
        for m in r["measures"]:
            if RULE_LIKE.match(m):
                assert m in rule_ids(), (r["id"], m)


def test_measures_never_raise_a_risk_and_severity_is_fixed():
    for r in RISKS:
        assert r["after"]["rpn"] <= r["before"]["rpn"], r["id"]
        assert r["before"]["rpn"] == r["severity"] * r["before"]["o"] * r["before"]["d"]


def test_every_gap_or_partial_control_explains_itself():
    for c in CONTROLS:
        assert c["status"] in ("covered", "partial", "gap", "by_design")
        if c["status"] in ("gap", "by_design") or (c["status"] == "partial" and not c["system"]):
            assert c["note"], c["reg"]
