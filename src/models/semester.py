"""Term-index helpers. Term 0 = Fall Y1, Term 1 = Spring Y1, Term 2 = Fall Y2, …

The season cycle is config-driven (`terms_per_year`/`mandatory_terms` in
simulation_config.json), defaulting to the legacy 2-season Fall/Spring cycle (every season
mandatory) when a config doesn't specify it — every existing caller that omits `config`
gets identical behavior to before this was generalized. A 4-season cycle
(`["Fall", "Winter", "Spring", "Summer"]` with `mandatory_terms: ["Fall", "Spring"]`) models
an institution with optional Winter/Summer intersessions: see CLAUDE.md's "Term/Season
Model" section.

`optional_terms_enabled` (default `True` when the key is absent, so existing hand-built
configs that already set `terms_per_year` without this flag are unaffected) is a runtime
on/off switch for that 4-season cycle, independent of whether `terms_per_year` is actually
present in the config: a plan can carry `terms_per_year`/`mandatory_terms`/
`optional_term_capacity_scale` data the whole time, inert, and an admin flips
`optional_terms_enabled` on later (Settings -> PUT /config) without re-entering any of it.
When `False`, every helper below collapses to the mandatory-only cycle (`mandatory_terms`,
or `DEFAULT_TERMS` if that's also absent) — there is no separate "legacy mode"; disabling
optional terms simply removes Winter/Summer from the cycle the same way an unset
`terms_per_year` always has.
"""
from __future__ import annotations

DEFAULT_TERMS = ("Fall", "Spring")


def get_terms(config: dict | None = None) -> tuple[str, ...]:
    if config and config.get("terms_per_year") and config.get("optional_terms_enabled", True):
        return tuple(config["terms_per_year"])
    if config and config.get("mandatory_terms"):
        return tuple(config["mandatory_terms"])
    return DEFAULT_TERMS


def get_mandatory_seasons(config: dict | None = None) -> frozenset[str]:
    terms = get_terms(config)
    if config and config.get("mandatory_terms") and config.get("optional_terms_enabled", True):
        return frozenset(config["mandatory_terms"])
    return frozenset(terms)  # optional terms off (or no mandatory_terms override): every
                             # season in the (possibly collapsed) cycle is mandatory


def admission_seasons(config: dict | None = None) -> list[str]:
    """Seasons in which new study cohorts are admitted, in the cycle's own order.

    Replaces the old single "admit every N terms" interval with an intuitive choice of *which
    seasons take in a new cohort*. Defaults to the first mandatory season only (Fall for the QU
    default) — identical to the legacy once-a-year Fall admission, since walking the calendar and
    admitting only on Fall lands cohorts exactly one full year apart. Adding a second mandatory
    season (e.g. Spring) gives a second intake each year. Optional (non-mandatory) seasons such
    as Summer/Winter can never be admission seasons and are filtered out here as a safety net,
    even if a stray value slips past API validation — a bonus intersession never admits a cohort.
    """
    config = config or {}
    cycle = get_terms(config)
    mandatory = get_mandatory_seasons(config)
    raw = config.get("admission_terms")
    chosen = {s for s in raw if s in mandatory} if raw else set()
    if not chosen:
        chosen = {next((s for s in cycle if s in mandatory), cycle[0])}
    return [s for s in cycle if s in chosen]


def term_season(term_index: int, config: dict | None = None) -> str:
    terms = get_terms(config)
    return terms[term_index % len(terms)]


def term_year(term_index: int, config: dict | None = None) -> int:
    return term_index // len(get_terms(config)) + 1


def term_label(term_index: int, config: dict | None = None) -> str:
    return f"{term_season(term_index, config)} Y{term_year(term_index, config)}"


def mandatory_horizon_end_term(entry_term: int, max_terms: int, config: dict | None = None) -> int:
    """Calendar term index one past the term where `max_terms` mandatory seasons have
    elapsed since `entry_term` (inclusive).

    Replaces the naive `entry_term + max_terms`, which only gives the right answer when
    every calendar term is mandatory. Once optional (non-mandatory) seasons exist in the
    cycle, that formula would truncate the simulation window before a student's real
    semester budget is exhausted — this walks the season cycle directly instead.
    """
    mandatory = get_mandatory_seasons(config)
    count, t = 0, entry_term
    while count < max_terms:
        if term_season(t, config) in mandatory:
            count += 1
        t += 1
    return t
