"""Term-index helpers. Term 0 = Fall Y1, Term 1 = Spring Y1, Term 2 = Fall Y2, …

The season cycle is config-driven (`terms_per_year`/`mandatory_terms` in
simulation_config.json), defaulting to the legacy 2-season Fall/Spring cycle (every season
mandatory) when a config doesn't specify it — every existing caller that omits `config`
gets identical behavior to before this was generalized. A 4-season cycle
(`["Fall", "Winter", "Spring", "Summer"]` with `mandatory_terms: ["Fall", "Spring"]`) models
an institution with optional Winter/Summer intersessions: see CLAUDE.md's "Term/Season
Model" section.
"""
from __future__ import annotations

DEFAULT_TERMS = ("Fall", "Spring")


def get_terms(config: dict | None = None) -> tuple[str, ...]:
    if config and config.get("terms_per_year"):
        return tuple(config["terms_per_year"])
    return DEFAULT_TERMS


def get_mandatory_seasons(config: dict | None = None) -> frozenset[str]:
    terms = get_terms(config)
    if config and config.get("mandatory_terms"):
        return frozenset(config["mandatory_terms"])
    return frozenset(terms)  # legacy: every season in the cycle is mandatory


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
