# Simulation Optimization Plan

Last updated: 2026-07-11

Purpose
- Capture a prioritized, actionable plan to optimize the simulation engine (hot paths, batching, parallelization, memory use, and interactive responsiveness).
- Provide developer tasks, acceptance criteria, run steps and rollout guidance.

High-level goals
- Make Monte Carlo and search/optimizer workloads parallel and CPU-efficient.
- Reduce per-term runtime from O(N_students * N_courses) where possible by incremental or inverted checks.
- Avoid full-run replay for interactive LiveRunner advances.
- Provide metrics-only fast-mode for control loops (optimizer, Monte Carlo warm-ups) to reduce memory + I/O.

Prioritized action list (why → what → acceptance)

1) Add a profiling harness (MANDATORY, 1 day)
- Why: verify hotspots before changing code.
- What: add `scripts/profile_run.py` that runs a representative scenario under `cProfile` and optionally emits a flamegraph-friendly callgrind output or `pyinstrument` snapshot. Document how to run locally.
- Acceptance: a `profile_report.html` or `callgrind.out` is produced and identifies top 3 hot functions (expected: `_run_term`, `_record_blocks`, allocation sorting).

2) Parallelize Monte Carlo and optimizer candidate runs (HIGH, 1–2 days)
- Why: independent sims are embarrassingly parallel — large wall-time gains across cores.
- What: implement `concurrent.futures.ProcessPoolExecutor` wrappers in `src/montecarlo.py` and `src/optimizer.py` (configurable `max_workers`). Ensure deterministic seeding per process (seed + worker_id + candidate_index). Add a `--workers` CLI and unit tests for deterministic outputs.
- Acceptance: Monte Carlo of 40 seeds on 8 cores runs ~5× faster than single-thread baseline and produces identical aggregated results to serial run.

3) Add `metrics_only` / `lite` simulation mode for short-run control loops (MEDIUM, 1–2 days)
- Why: optimizer and capacity-solver only need a handful of metrics; recording transcripts/timeline is expensive.
- What: add `Simulator(..., record_traces=False, record_history_level="full|metrics|none")`. `metrics` mode collects only counters needed by `evaluate_health_criteria` and `compute_metrics` (e.g., history capacity_block_counts, fail_counts, graduation counts) and skips `transcript`, `outcomes`, `history.timeline`. Make `optimizer.solve_for_targets` use `metrics` mode.
- Acceptance: `solve_for_targets` runs with <40% memory and ~30–50% time of full-run mode on benchmark.

4) Avoid full per-term curriculum sweep in `_record_blocks` (ALGO, 2–4 days)
- Why: current inner loop is student × course and dominates runtime for large populations.
- What: replace full sweep with incremental/inverted strategies:
  - Maintain per-student `unpassed_prereqs` set updated only when a student passes a course; only iterate those few codes per student.
  - For offering-block counts, compute eligible courses by checking the student's `unpassed_prereqs` and intersect with offered set (small). If many students share unchanged prerequisites, memoize eligibility by `student_id` and invalidate on pass events.
- Acceptance: measured per-term runtime on a stress scenario reduces by >40% vs baseline profiling numbers and block counts remain identical.

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
