"""Past-intake warm start (src/engine/datasource.py `incumbent_sizes` + src/planner/intake.py
`resolve_incumbent_sizes`): today's student body is rebuilt from the department's real past
intakes, padded with estimated older years. The baseline path (no incumbent_sizes) must stay
exactly as before, and the next cohort must be the *same students* across candidate intakes so
the sweep compares like with like.
"""
from __future__ import annotations

import pytest

from src.engine.datasource import SyntheticDataSource
from src.planner.intake import _config_for_intake, resolve_incumbent_sizes
from src.engine.utils import load_json


def _config(**overrides) -> dict:
    config = load_json("data/simulation_config.json")
    config.update(overrides)
    return config


def test_absent_incumbent_sizes_keeps_old_specs():
    config = _config(num_incumbent_cohorts=3)
    old = SyntheticDataSource(config).cohort_specs()
    same = SyntheticDataSource(config, incumbent_sizes=None).cohort_specs()
    assert old == same
    assert [s.size for s in old if s.cohort_id < 0] == [config["cohort_size"]] * 3


def test_incumbent_sizes_most_recent_first():
    config = _config(num_incumbent_cohorts=0)
    specs = SyntheticDataSource(config, incumbent_sizes=[50, 60, 70]).cohort_specs()
    by_id = {s.cohort_id: s for s in specs}
    assert by_id[-1].size == 50 and by_id[-2].size == 60 and by_id[-3].size == 70
    # Admission order is earliest first, and each incumbent enters a full year before the next.
    assert [s.cohort_id for s in specs[:3]] == [-3, -2, -1]
    assert by_id[-3].entry_term < by_id[-2].entry_term < by_id[-1].entry_term < 0


def test_incumbent_sizes_and_num_incumbents_are_exclusive():
    with pytest.raises(ValueError):
        SyntheticDataSource(_config(num_incumbent_cohorts=2), incumbent_sizes=[10, 10])


def test_next_cohort_is_nested_across_intakes():
    # Fixed past intakes => the next cohort's first N students are identical at every N.
    base = _config()
    sizes = [100, 90, 80]
    ids = {}
    for n in (60, 80):
        cfg = _config_for_intake(base, n, num_cohorts=2, num_incumbents=0, seed=42)
        source = SyntheticDataSource(cfg, incumbent_sizes=sizes)
        spec0 = next(s for s in source.cohort_specs() if s.cohort_id == 0)
        ids[n] = [st.student_id for st in source.create_students(spec0)]
    assert ids[80][:60] == ids[60]


def test_resolve_incumbent_sizes_pads_with_estimates():
    config = _config(current_students={"past_intakes": [{"size": 100}, {"size": 90}, {"size": 80}]})
    sizes = resolve_incumbent_sizes(config, min_history_years=8)
    assert len(sizes) == 8
    assert sizes[:3] == [(100, "entered"), (90, "entered"), (80, "entered")]
    assert all(src == "padded" and size == 90 for size, src in sizes[3:])


def test_resolve_incumbent_sizes_without_any_entered_uses_cohort_size():
    config = _config(current_students={"past_intakes": []}, cohort_size=70)
    assert resolve_incumbent_sizes(config, min_history_years=4) == [(70, "padded")] * 4
