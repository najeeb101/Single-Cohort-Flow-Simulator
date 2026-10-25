# Per-term loop, block signals and scenarios

Reference split out of `CLAUDE.md`; read it when touching enrollment, seat allocation, the four block signals or scenarios.

## Per-Term Loop (three phases)

1. **Desired enrollment** — each active student (all cohorts) builds a priority-ordered list: retakes first, then `enrollment_priority_tiers` (config-defined category sets, each with an optional `min_ch` gate; QU CS default: cs_core/college_req > cs_elective at 60+ CH > math/science/english/gen_ed) subject to their load cap.
2. **Seat allocation** — sort requesters by `(registration_tier(completed_ch, config), tiebreak_token)`; grant first `effective_capacity`; record `capacity_block` for the rest. Seniors from older cohorts outrank freshmen automatically. The CH bands themselves are config data (`registration_tier_thresholds` in `simulation_config.json`), not hardcoded — a different institution's priority-registration policy is a config edit, not a code change. (The Settings/Plan-Builder editor card for these bands was removed as noise — the value still drives the engine, it's just no longer surfaced in the UI; edit it in the config/JSON.)
3. **Take courses** — resolve pass/fail via student RNG, sample grade tier, update GPA/probation/status.

Each term also records: per-cohort-per-course block counters (all four signals), per-course stats (capacity/registered/granted/denied/pass/fail/waiting/full), per-cohort stage node counts + flows, a cohort ledger row, and a timeline frame.

## Four Block Signals (never merged)

| Signal | Meaning |
|---|---|
| `fail_counts` | Student attempted and failed |
| `capacity_block_counts` | Requested seat but lost allocation |
| `offering_block_counts` | Eligible but course not taught this term |
| `prereq_block_counts` | Prerequisites not yet satisfied |

Each also has a `*_by_cohort` variant (`cohort_id -> {course -> count}`) powering per-cohort "where did they get stuck" post-mortems.

**The prereq signal's Bottlenecks *card* is hidden** (product decision — it's a passive whole-curriculum sweep that's noisier than the others). It's dropped from the frontend `SIGNAL_ORDER` (`web/src/lib/signalMeta.ts`), which also drops its legend-toggle pill on the Bottlenecks page — that list is the *only* consumer of `SIGNAL_ORDER`. Everything else still shows it: the Cohorts table's `top_prereq_block` column, the Student-Trace "waiting on prerequisites" count, the animated narrative, and the advisor's grounding. `SIGNAL_META.prereq`, the `BlockSignal` type, and the whole `flow_timeline` contract (`prereq_waiting` / `top_bottlenecks.prereq` / `top_prereq_block`) are all untouched. Re-add `"prereq"` to `SIGNAL_ORDER` to bring the card back.

## Scenarios (in simulation_config.json)

| Name | Change |
|---|---|
| baseline | Default (assumed) pass rates and capacity |

`capacity_multiplier`, `capacity_overrides`, `offering_overrides`, and `pass_rate_overrides` per-scenario hooks exist in the engine for what-if experiments. `run.py` simulates every scenario in this list and reports each in `simulation_summary.csv` + a `bottlenecks_<scenario>.png`; with a single scenario, `outputs/reports/flow_timeline.json` (the walkthrough/baseline data) comes from it directly. The scenario's name is recorded at `flow_timeline.json`'s `meta.scenario` so the dashboard can pick the matching `bottlenecks_<scenario>.png`. With more than one scenario, `save_all_figures` also writes `scenario_comparison.png` (graduation/on-time rate + avg time-to-degree, one bar group per scenario, single-seed only).

> The website's Scenarios page was removed; the `/scenarios` and `/runs` endpoints remain for API
> users. `py run.py` picks up any scenario added to `data/simulation_config.json`. The engine's
> `capacity_overrides` and `offering_overrides` are the hooks the Advisor's what-if **Test** uses, and
> `unlimited_seats` is the hook the intake analysis uses for its no-shortage reference.
