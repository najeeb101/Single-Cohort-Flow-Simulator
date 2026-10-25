# Parallel workloads and performance

Reference split out of `CLAUDE.md`; read it when touching parallelism, Monte Carlo, the eligibility cache or analysis runtime.

## Parallel Workloads

- A single simulation is cheap (~0.75s / ~10 MB for the 800-student baseline). What was slow was
  the workloads that run *many* independent sims.
- **Per-run hot path**: eligibility (`Student.is_eligible_for`) is called hundreds of thousands of
  times per run (active student × candidate course × term, from both `get_desired_courses` and
  `_record_blocks`). It caches a *True* result in `Student._eligible_codes` (wiped in
  `_reset_rng_and_state`). This is behavior-preserving because eligibility is **monotonic** —
  `rule_expr` (`src/rules.py`) is only AND/OR of `has_passed`/`min_ch`, with no negation or upper
  bound, and passed grades / `completed_ch` never decrease — so a course that's eligible stays
  eligible. Verified byte-identical (same flow_timeline + block-count fingerprint before/after);
  ~20% faster per run. A False is never cached. **Don't add a non-monotonic gate (e.g. an upper CH
  bound, or a "not passed X") to the rule grammar without invalidating this cache.**
- **`src/parallel.py::ordered_map(fn, items, workers=...)`** fans independent sims across a
  `ProcessPoolExecutor`. Two properties callers rely on: **order-preserving** (results come back in
  input order, so aggregates are byte-identical to a serial loop) and a **serial fallback** on any
  pool/spawn failure (a genuine bug in `fn` re-raises from the serial path — only environmental pool
  problems are silently recovered). `fn` must be a module-level function (spawn-picklable); below 3
  items or `workers<=1` it just runs serial.
- **Monte Carlo** (`run_monte_carlo(..., workers=None)`) parallelizes across its **spaced** seeds (`spaced_seeds`, see Intake Planner) — **~7x faster on a 20-core box (27.7s → 4.0s for 30 seeds), result byte-identical.** Worker
  count: explicit `workers` arg → `config["monte_carlo"]["workers"]` → one per CPU; `workers=1` forces
  serial. Only runs when `include_monte_carlo` is set, so it never touches the default dashboard load.
- **Intake analyses** (`src/intake.py`) fan every simulation of a job across one process pool
  (`parallel.make_pool`/`iter_ordered`: ordered results for progress, no silent serial fallback,
  `terminate_workers()` on cancel on Python 3.14). A full default analysis is ~570 simulations,
  ~2.5 minutes on a 20-core PC (`INTAKE_WORKERS` caps cores); the coarse sweep stops early once every
  limit has clearly failed because high intakes are the most expensive and least informative.
