"""Term-index helpers. Term 0 = Fall Y1, Term 1 = Spring Y1, Term 2 = Fall Y2, …"""

TERMS = ("Fall", "Spring")


def term_season(term_index: int) -> str:
    return TERMS[term_index % 2]


def term_year(term_index: int) -> int:
    return term_index // 2 + 1


def term_label(term_index: int) -> str:
    return f"{term_season(term_index)} Y{term_year(term_index)}"
