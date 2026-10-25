# Term/season model

Reference split out of `CLAUDE.md`; read it when touching optional terms, `personal_semester`, capacity scaling or the mandatory-only bottleneck rankings.

## Term/Season Model

- The season cycle is config-driven (`src/models/semester.py`), defaulting to the legacy
  2-season Fall/Spring cycle (every season mandatory) when a config omits the new keys — every
  existing caller that doesn't pass `config` to `term_season`/`term_year`/`term_label` gets
  identical behavior to before this was generalized. `terms_per_year` (e.g.
  `["Fall", "Winter", "Spring", "Summer"]`) sets the cycle; `mandatory_terms` (e.g.
  `["Fall", "Spring"]`) marks which seasons advance a student's graduation clock.
- **`optional_terms_enabled` (default `false`) is the admin on/off switch** for the 4-season
  cycle, independent of whether `terms_per_year`/`mandatory_terms`/`optional_term_capacity_scale`
  are present in the config — they can sit there inert the whole time. The QU default plan
  (`data/simulation_config.json`) ships with all of that 4-season data already filled in *and*
  `optional_terms_enabled: false`, so Winter/Summer stay off (legacy 2-season behavior) until an
  admin flips it on via Settings → `PUT /config {"optional_terms_enabled": true}` (or `GET /meta`
  to read the current value) — no re-entry of the season data needed either way.
  Admission cadence survives the toggle automatically because it's driven by *which seasons
  admit* (`admission_terms`, see "Multi-Cohort Model"), not a term-count interval:
  `admission_seasons(config)` walks the calendar and admits only on the chosen (mandatory)
  seasons, so Fall-only stays exactly one year apart whether the cycle is 2, 3, or 4 terms long,
  in either toggle direction. A config dict that never sets `optional_terms_enabled` at all (e.g.
  hand-built test fixtures) defaults to the old, pre-flag behavior — presence of `terms_per_year`
  alone enables the multi-season cycle, unaffected by this flag's existence.
- **A course is only offered in an optional season if its own `offering` list says so** — same
  mechanism as Fall/Spring, no new concept. A new cohort is never admitted in an optional term:
  `admission_seasons` filters out any non-mandatory season, so even a stray `admission_terms`
  entry naming Summer/Winter is dropped (and rejected at the API with a 422). Admission seasons
  are the single source of cadence — there is no `admit_interval_terms` knob anymore.
- **`Student.personal_semester`** (`src/models/student.py`) is a stateful counter, incremented by
  `Simulator._run_term` once per *mandatory* term only (never during an optional term) for every
  non-terminal student. It replaces the old `term_idx - entry_term + 1` recomputation everywhere
  that mattered: the dropout-hazard early-cutoff check, the `max_terms`/`CENSORED`/`DELAYED`
  check, and `grad_semester`. This is *the* mechanism behind "Summer/Winter doesn't cost you a
  semester" — a student can take courses in an optional term (GPA/completed_ch/failed_attempts
  all update normally) without the clock ticking, and can still graduate immediately if an
  optional term happens to complete their last requirement.
- **`mandatory_horizon_end_term(entry_term, max_terms, config)`** replaces the old
  `entry_term + max_terms` formula for `Simulator.end_term` — that formula only gives the right
  calendar-term horizon when every season is mandatory; once optional seasons exist, it would
  truncate the simulation window before a student's real semester budget is exhausted. The same
  helper fixes the analogous bug in `src/analytics.py::_representative_cohort`'s "is this cohort
  finished" check. `_throughput_stability` reads the real calendar term of graduation from
  `OutcomeRecord.graduation_term` directly instead of reconstructing it from `entry_term +
  grad_semester`, since that reconstruction also drifts once `grad_semester` is mandatory-only.
- **Optional-term capacity is smaller/separate**: `Simulator._effective_capacity` takes an
  optional trailing `season` parameter (`None` = legacy/mandatory behavior, so the many existing
  callers that omit it are unaffected). On a non-mandatory season, capacity is
  `floor(course.capacity * optional_term_capacity_scale)` (default scale `0.3`) — a single knob,
  no per-course optional-term override map.
- **The four block signals stay mandatory-term-accurate**: `capacity_block_counts`/`fail_counts`
  only ever fire on a real enrollment attempt, so the raw counters are untouched and *do* still
  fire during optional terms (e.g. "even the bonus session is oversubscribed" is a real signal,
  visible per-term in the timeline frames + utilization heatmap). **But the three *structural*
  bottleneck rankings (capacity, offering, prereq) are mandatory-terms-only**: `Simulator` keeps
  `capacity_block_counts_mandatory` / `offering_block_counts_mandatory` /
  `prereq_block_counts_mandatory` (+ `*_mandatory_by_cohort`), incremented only on mandatory-season
  events, and `analytics` ranks `top_capacity_blocks`/`top_offering_blocks`/`top_prereq_blocks`,
  `top_bottlenecks.{capacity,offering,prereq}`, and the per-cohort `top_*_block` off *those*. This is
  because an optional term's seats are a deliberately small bonus pool (`optional_term_capacity_scale`):
  a Summer denial/wait doesn't block graduation (the student takes the course in a regular term) and
  can't be relieved by raising the course's regular capacity/offering, so counting it would make the
  ranking (and the Bottlenecks cards, the Capacity-recommendations table, and the advisor's grounding,
  all of which read it) point at Summer service courses that are scarce *by design* instead of the
  regular-term gateways that actually delay students. In practice **offering** blocks can't occur in
  an optional term at all (a swept course is by definition offered), so its mandatory counter equals
  the raw one; **capacity** and **prereq** have real optional-term components that the mandatory
  counters strip. **`fail_counts` is deliberately NOT filtered** — a fail is a real fail whenever it
  happens. `GET /meta.mandatory_terms` exposes the regular seasons so the frontend
  (Capacity-recommendations, advisor `course_stats`) filters identically. Covered by
  `tests/test_optional_terms.py`.
  `offering_block_counts`/`prereq_block_counts` also fire passively for every
  eligible-or-waiting student every term regardless of intent, so sweeping the *entire*
  curriculum during an optional term (where almost nothing is offered) would inflate both purely
  from adding extra calendar terms. `Simulator._record_blocks` is scoped accordingly: on a
  mandatory term it sweeps the whole curriculum (unchanged); on an optional term it sweeps only
  the courses actually offered that term, so `prereq_block` stays a precise, actionable signal
  ("this bonus-term course was open and you weren't eligible yet") instead of noise.
- **`scripts/size_capacity.py`**'s demand calibration filters to mandatory-season timeline
  frames before aggregating — optional-term frames carry much smaller, separately-modeled
  demand and would otherwise dilute the peak/percentile figures meant to size *regular*-term
  capacity.
- Not surfaced in `/meta` or the Data page yet — `terms_per_year`,
  `mandatory_terms`, and `optional_term_capacity_scale` are JSON-file-only knobs for now,
  alongside other config keys (`grade_tiers`, `ability_sd`) that aren't exposed there either.
