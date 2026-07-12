"""Process-pool helper for the engine's embarrassingly-parallel workloads (optimization plan
item 2): Monte Carlo across seeds and the Auto-fill intake-probe across candidate intakes. Each
of those is a set of *independent* full simulations, so fanning them across CPU cores is a large
wall-time win with no change to results.

Two correctness properties this helper guarantees, so parallel output is trustworthy:

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
from typing import Callable, Iterable, Sequence, TypeVar

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
