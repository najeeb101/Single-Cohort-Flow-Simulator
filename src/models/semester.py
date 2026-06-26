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
`optional_term_course_sections` data the whole time, inert, and an admin flips
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


def effective_admit_interval_terms(config: dict | None = None) -> int:
    """Terms between yearly admissions under the *active* cycle.

    `admit_interval_terms` is normally just "how many terms make up one year" (4 under the
    4-season cycle, 2 under the legacy/collapsed one). If a config's stored value matches the
    *full* `terms_per_year` length but optional terms are currently off, using it as-is would
    silently admit a new cohort only every other year once the cycle collapses to 2 terms — so
    rescale it to one year under the now-active cycle instead. A value that doesn't match that
    "one full year" convention is left untouched (an admin's deliberate non-yearly cadence).
    """
    config = config or {}
    stored = config.get("admit_interval_terms")
    full_cycle = config.get("terms_per_year")
    if (
        stored is not None
        and full_cycle
        and stored == len(full_cycle)
        and not config.get("optional_terms_enabled", True)
    ):
        return len(get_terms(config))
    return stored if stored is not None else len(get_terms(config))


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
