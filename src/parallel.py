"""Process-pool helper for the engine's embarrassingly-parallel workloads: Monte Carlo across
seeds (`ordered_map`) and the intake analyses' runs across candidate intakes and seeds
(`make_pool`/`iter_ordered`). Each of those is a set of *independent* full simulations, so
fanning them across CPU cores is a large wall-time win with no change to results.

Two correctness properties `ordered_map` guarantees, so parallel output is trustworthy
(`iter_ordered` keeps the ordering but has no serial fallback):

1. **Order-preserving.** `ordered_map` returns results in the same order as `items`, exactly
   like a serial `[fn(x) for x in items]`. Callers that aggregate seed samples therefore get a
   byte-identical list whether they ran serial or parallel — so mean/CI/etc. don't drift.
2. **Serial fallback that can't mask real bugs.** If a process pool can't be created (a
   restricted sandbox, a spawn error) *or* a worker task raises, the whole batch is redone
   serially. A genuine bug in `fn` then re-raises from the serial path (it fails there too);
   only environmental pool problems are silently recovered.

`fn` must be a module-level function (picklable by qualified name under Windows' spawn start
method); a lambda or closure won't pickle. Args are passed per item, so keep each item small
(our curriculum/config payloads are a few KB — negligible next to a ~1s simulation).
"""
from __future__ import annotations

import os
from concurrent.futures import ProcessPoolExecutor
from contextlib import contextmanager
from typing import Callable, Iterable, Iterator, Sequence, TypeVar

T = TypeVar("T")
R = TypeVar("R")

# Below this many items the process-spawn overhead outweighs the parallel win — just run serial.
_MIN_ITEMS_FOR_PARALLEL = 3


def resolve_workers(n_items: int, requested: int | None = None, config_workers: int | None = None) -> int:
    """Pick a worker count. Explicit `requested` wins, then a config-supplied default, else one
    per CPU capped at the number of items (never more workers than there is work)."""
    if requested is not None:
        return max(1, int(requested))
    if config_workers is not None:
        return max(1, int(config_workers))
    return max(1, min(os.cpu_count() or 1, max(1, n_items)))


def ordered_map(fn: Callable[[T], R], items: Iterable[T], *, workers: int) -> list[R]:
    """Apply `fn` to each item and return results in input order. Runs in a process pool when
    `workers > 1` and there are enough items to be worth it; otherwise (or on any pool failure)
    runs serially. See the module docstring for the guarantees."""
    items_list: Sequence[T] = list(items)
    if workers <= 1 or len(items_list) < _MIN_ITEMS_FOR_PARALLEL:
        return [fn(x) for x in items_list]

    try:
        with ProcessPoolExecutor(max_workers=workers) as executor:
            return list(executor.map(fn, items_list))
    except Exception:
        # Environmental pool failure (or a task error): redo serially. A real bug in `fn`
        # surfaces here instead of being swallowed.
        return [fn(x) for x in items_list]


# ------------------------------------------------------------------ #
# Long jobs (the intake analysis): one pool per job, streamed results #
# ------------------------------------------------------------------ #
# ordered_map's silent serial redo is right for a few-second Monte Carlo but wrong for a
# minutes-long intake sweep: a failure there would quietly re-run everything ~20x slower. A long
# job instead opens one pool for its whole life (spawning workers costs ~1s each on Windows),
# streams results in order so it can report progress, and lets errors propagate.

class SerialPool:
    """Stand-in for a process pool when `workers <= 1` (tests, or a one-core box) — same
    `map`/`shutdown` surface, runs in-process."""

    def map(self, fn: Callable[[T], R], items: Iterable[T]) -> Iterator[R]:
        return (fn(x) for x in items)

    def shutdown(self, wait: bool = True, cancel_futures: bool = False) -> None:
        return None


@contextmanager
def make_pool(workers: int):
    """A process pool sized `workers` for the duration of one job (or a SerialPool for 1)."""
    if workers <= 1:
        yield SerialPool()
        return
    pool = ProcessPoolExecutor(max_workers=workers)
    try:
        yield pool
    finally:
        pool.shutdown(wait=True, cancel_futures=True)


def terminate_pool(pool) -> None:
    """Stop a running job's workers immediately (cancel). `terminate_workers` exists on
    Python 3.14+; older interpreters just drop queued work and wait for the in-flight tasks."""
    terminate = getattr(pool, "terminate_workers", None)
    if terminate is not None:
        terminate()
    else:
        pool.shutdown(wait=False, cancel_futures=True)


def iter_ordered(fn: Callable[[T], R], items: Iterable[T], pool) -> Iterator[R]:
    """Yield `fn(item)` in input order as each result becomes available, on an open pool from
    `make_pool`. No serial fallback: a worker error is raised to the caller."""
    return iter(pool.map(fn, list(items)))
