# Simulation Optimization Plan

Last updated: 2026-07-12

> **STATUS: CLOSED (2026-07-12).** The high-value work shipped in commit `8408d63`:
> item 1 (profiling/benchmark harness), item 2 (parallel Monte Carlo — **~7.5× faster**, plus
> the Auto-fill intake-probe), and the safe subset of item 4 (monotonic eligibility cache —
> **~20% faster per run**, byte-identical). A single sim is ~0.75s and 30-seed Monte Carlo went
> from ~28s to ~4s.
>
> The remaining items were **deliberately not done**, each for a measured reason:
> - **Item 3** (`metrics_only` mode): moot — the "expensive" discarded per-run work measured ~1ms.
> - **Item 5** (heapq allocation): moot — profiling showed sorting is ~0.05s, not a hotspot.
> - **Item 6** (LiveRunner checkpointing): its target was "advance < 1s"; a full replay-from-0 is
>   now ~0.75s, so it's effectively already met.
> - **Items 7–9** (memory / micro-opts / JIT): low value — peak memory is ~10 MB.
> - **Item 4 remainder** (inverted `unpassed_prereqs` index → toward the >40% target): the one
>   real lever left, but it needs genuine cache-invalidation logic (grade replacement, retakes,
>   initial-state students) and carries correctness risk. Reopen this if per-run speed ever
>   matters again; the safe cache already in place is the floor to beat.
>
> Everything below is the original plan, kept for provenance; per-item DONE/PARTIAL notes are inline.

Purpose
- Capture a prioritized, actionable plan to optimize the simulation engine (hot paths, batching, parallelization, memory use, and interactive responsiveness).
- Provide developer tasks, acceptance criteria, run steps and rollout guidance.

High-level goals
- Make Monte Carlo and search/optimizer workloads parallel and CPU-efficient.
- Reduce per-term runtime from O(N_students * N_courses) where possible by incremental or inverted checks.
- Avoid full-run replay for interactive LiveRunner advances.
- Provide metrics-only fast-mode for control loops (optimizer, Monte Carlo warm-ups) to reduce memory + I/O.

Prioritized action list (why → what → acceptance)

1) Add a profiling harness (MANDATORY, 1 day) — **DONE 2026-07-12**
- Why: verify hotspots before changing code.
- What: `scripts/profile_run.py` (cProfile, stdlib-only, `--montecarlo N`/`--sort`/`--top`/`--out`,
  optional `--pyinstrument` HTML if the package is installed) + `scripts/benchmark.py` (wall time
  via `perf_counter` + peak Python memory via `tracemalloc`, `--repeats`/`--montecarlo`/`--compare`,
  writes a committable `outputs/profiling/benchmark_baseline.json`). Raw `.out`/`.html` are
  gitignored; the JSON baseline is tracked for PR-to-PR diffs.
- Run: `py scripts/profile_run.py --sort tottime` and `py scripts/benchmark.py`.
- **Measured baseline (commit 4bd4b0d, CPython 3.14, one 800-student baseline run):
  ~0.9s wall (median 0.925s), ~8.5 MB peak traced memory.**
  - *Correction (same day):* the first cut of `benchmark.py` timed the run **while tracemalloc
    was active**, which inflates wall time ~3.6x — so an earlier draft of this doc read "~3.1s".
    The harness now times untraced repeats and samples memory in a separate untimed run; the
    true single-run figure is ~0.9s. Derived serial costs: Monte Carlo 30 seeds ≈ 27s,
    Auto-fill (up to 20 greedy runs + ≤6 probe runs) ≈ 24s.
- **Findings — top hot functions by tottime (whole run, ~2.6s of engine time):**
  1. `student.get_desired_courses` (0.34s, phase-1 desired-enrollment build)
  2. `simulator._record_blocks` (0.23s) — as predicted
  3. `student.prerequisites_met` (0.22s, 270k calls) + `student.has_passed` (0.21s, **942k calls**)
     + `can_enroll` / `is_eligible_for` — the eligibility-check family dominates collectively.
  4. `simulator._run_term` (0.21s tottime; 2.6s cumulative — the driver).
- **Correction to the plan's guess:** "allocation sorting" is **not** a real hotspot
  (`sorted` ~0.05s, 11k calls). Item 5 (heapq selection) will pay almost nothing at this
  population; the win is in the eligibility/prereq sweep, so **prioritize item 4 over item 5.**
  Memory is already tiny (~8.5 MB), so item 7's memory angle is low value — its record-level
  angle only matters as plumbing for item 3.

2) Parallelize Monte Carlo and optimizer candidate runs (HIGH, 1–2 days) — **DONE 2026-07-12**
- Why: independent sims are embarrassingly parallel — large wall-time gains across cores.
- What shipped: `src/parallel.py` — a small `ordered_map(fn, items, workers=...)` over
  `concurrent.futures.ProcessPoolExecutor` that (a) preserves input order so aggregates are
  byte-identical to serial, and (b) falls back to a serial map on any pool/spawn failure (a real
  bug in `fn` re-raises from the serial path, so nothing is masked).
  - `run_monte_carlo(..., workers=None)` fans its seeds across the pool. Seeds are still
    `base_seed + k` (unchanged); results are collected in seed order, so mean/stdev/CI are
    identical. Worker count: explicit `workers` arg → `config["monte_carlo"]["workers"]` →
    one per CPU. `workers=1` forces serial.
  - `optimizer._probe_intake` (the Auto-fill intake fallback) fans its independent candidate
    intakes across the pool and picks the largest passing one — identical to the old
    sequential step-down.
  - Tests: `tests/test_parallel.py` (parallel == serial byte-for-byte + order/worker-resolution
    units); existing `test_multicohort`/`test_optimizer` determinism checks still pass (201 total).
- **Measured (20-core box, real config):**
  - **Monte Carlo 30 seeds: 27.7s → 4.0s (6.9× faster), result byte-identical.** ✅ beats the ~5× bar.
  - Auto-fill intake probe (6 candidates): 3.4s → 1.2s (2.8×). This only trims the fallback;
    **Auto-fill's main greedy loop is a strict dependency chain (each iteration's seats depend on
    the previous run) and is genuinely unparallelizable** — its ~18s floor is `run_budget` × the
    per-run sim time, so cutting *that* needs a per-run engine speedup (item 4), not parallelism.
- Note: the plan's "seed + worker_id + candidate_index" seeding was unnecessary — seeds are
  already unique per run (`base_seed + k`) and order-preserving collection keeps parallel and
  serial bit-identical, which is stronger than "deterministic per process".

3) Add `metrics_only` / `lite` simulation mode for short-run control loops (MEDIUM, 1–2 days)
- Why: optimizer and capacity-solver only need a handful of metrics; recording transcripts/timeline is expensive.
- What: add `Simulator(..., record_traces=False, record_history_level="full|metrics|none")`. `metrics` mode collects only counters needed by `evaluate_health_criteria` and `compute_metrics` (e.g., history capacity_block_counts, fail_counts, graduation counts) and skips `transcript`, `outcomes`, `history.timeline`. Make `optimizer.solve_for_targets` use `metrics` mode.
- Acceptance: `solve_for_targets` runs with <40% memory and ~30–50% time of full-run mode on benchmark.

4) Avoid full per-term curriculum sweep in `_record_blocks` (ALGO, 2–4 days) — **PARTIAL / safe subset DONE 2026-07-12**
- Why: current inner loop is student × course and dominates runtime for large populations.
- What shipped (the safe, zero-risk subset): a **monotonic eligibility cache** on `Student`.
  `is_eligible_for` now caches a *True* result in `self._eligible_codes` (wiped in
  `_reset_rng_and_state`, so a scenario re-run never inherits stale state). This is provably
  behavior-preserving because eligibility is monotonic: it depends only on passed courses
  (grades are never removed) and `completed_ch` (only increases), combined by `rule_expr`'s
  AND/OR of `has_passed`/`min_ch` — the grammar (`src/rules.py`) has **no negation or upper
  bound**, so a course that is eligible stays eligible. A False is never cached (recomputed until
  it flips). Both hot callers benefit: `get_desired_courses`'s per-course `can_enroll` and
  `_record_blocks`'s passive sweep.
- **Verified byte-identical**: a full fingerprint (metrics + cohort metrics + admissions rec +
  the entire `flow_timeline` frames/summary + all four raw block-count dicts incl.
  mandatory/by-cohort variants) hashes to the *same* sha256 before and after. All 201 tests pass.
- **Measured**: single run **0.925s → 0.743s (−20%)**; Auto-fill (20 greedy runs) ~18.5s → ~16.6s;
  Monte Carlo 30 (parallel) 4.0s → 3.7s. Peak memory 8.5 → 10.2 MB (a small `set` per student —
  negligible in absolute terms).
- **Not done (the riskier remainder, deferred):** the fully *inverted* index — a per-student
  `unpassed_prereqs` set so `_record_blocks` iterates only the few not-yet-eligible codes instead
  of sweeping the whole curriculum. That would push toward the >40% target but needs real
  invalidation logic (grade replacement, retakes, initial-state students), so it's a separate,
  carefully-verified change, not folded into this safe pass.

5) Replace full sort with selection for allocation (LOW, 0.5–1 day)
- Why: selecting top-`cap` winners does not need an O(n log n) full sort when cap << requesters.
- What: use `heapq.nlargest(cap, requesters, key=...)` or `itertools.islice(sorted(...), cap)` depending on distribution; benchmark both.
- Acceptance: allocation step time reduced when requesters >> cap; behavior unchanged.

6) LiveRunner checkpointing to avoid full replay (INTERACTIVE, 3–5 days)
- Why: replay-from-term-0 for each advance is wasteful for stepwise UI workflows.
- What: implement periodic in-memory checkpoints (pickle minimal engine state: students' minimal state, cohort_entry, history aggregates) every N terms (configurable). `LiveRunner.advance()` replays from nearest checkpoint + applies subsequent terms. Store checkpoints under `runs/live_checkpoints/` for dev; add safe invalidation on plan edits.
- Acceptance: advancing one term in LiveRunner is <1s on benchmark instead of full-run time; periodic replay correctness tests pass.

7) Memory and recording improvements (LOW, 1 day)
- Why: trimming unneeded data reduces GC pressure and I/O during multi-run tasks.
- What: make transcript/outcomes/history.timeline optional (tied to `record_level`), stream large outputs to temporary files when requested, and add a `--no-history` flag to `run.py`.
- Acceptance: multi-run memory footprint drops significantly; `pytests` pass.

8) Micro-optimizations and low-level cleanups (LOW, ongoing)
- Localize attribute/dict lookups in tight loops, avoid repeated property access, and favor list/dict comprehensions. Add a small set of targeted changes after profiling proves hotspots.
- Acceptance: measurable per-term speedup of a few percent; no behavioral changes.

9) Optional: JIT / C-extension for numeric hot loops (EVALUATE AFTER PROFILING)
- Why: if Python-level fixes are insufficient, Numba/Cython can accelerate heavy numeric work (eligibility math, large vector ops).
- What: prototype Numba for the most CPU-bound kernels and benchmark; only adopt if maintainability trade-offs are acceptable.

Testing, verification & benchmarks
- Add `scripts/benchmark.py` which runs a standard scenario (replicate the current CI baseline) and measures wall time + peak memory. Record baseline before changes and attach results to PRs.
- For each change, add a smoke test asserting numeric parity (where required) or guarded tolerance (for Monte Carlo nondeterminism: use identical seeds to assert equality). Update `tests/` for `optimizer` and `montecarlo` to run with `metrics_only` where appropriate.

Developer workflow & branches
- Use short-lived feature branches: `feat/opt/profile`, `feat/opt/parallel-montecarlo`, `feat/opt/metrics-only`, `feat/opt/checkpoint-liverunner`.
- Each branch: small PR, include benchmark before/after, and a small verification checklist.

Run commands and profiling examples
```bash
# Install deps
py -m pip install -r requirements.txt

# Profile a representative run (example)
python -m cProfile -o profile.out scripts/profile_run.py --scenario baseline
# Generate a flamegraph (on dev machine with `pyprof2calltree` available)
pyprof2calltree -k -i profile.out

# Run Monte Carlo in parallel (after change)
python -m src.montecarlo --seeds 40 --workers 8

# Run optimizer with metrics-only fast mode
python -m scripts/run_optimizer.py --metrics-only
```

Rollout guidance
- Land `profile` and `benchmark` first to get baselines.
- Parallelize Monte Carlo and `optimizer` next (lowest risk, biggest win).
- Add `metrics_only` and switch optimizer to it.
- Revisit `_record_blocks` algorithm once profiling confirms it's the hotspot; include correctness tests.
- Prototype LiveRunner checkpointing as a feature branch and load-test.

Notes on determinism and safety
- Parallel runs must preserve determinism when requested: use seed derivation `seed + candidate_index + worker_id * 1_000_000` and document it.
- Keep default behavior unchanged for existing callers; new modes should be opt-in.

If you want, I can implement the profiling harness and the parallel Monte Carlo change first. Which two items should I pick to implement now?
