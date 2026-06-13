"""
Computes real-world CS undergraduate graduation rate from Qatar University open data.

Setup:
  1. https://www.data.gov.qa/explore/dataset/qu-graduated-students-per-semester-fall-2015-till-spring-2024
     Export -> CSV -> save as  data/qu_raw/qu_graduated.csv
  2. https://www.data.gov.qa/explore/dataset/qu-registered-students-per-semester-fall-2015-till-spring-2025
     Export -> CSV -> save as  data/qu_raw/qu_registered.csv
  3. Run:  py scripts/analyze_qu_data.py

NOTE: Only Fall 2015 and Fall 2016 cohorts are used. Later cohorts produce >100% rates
because the aggregate data doesn't tag graduates to their entry year — graduation windows
for Fall 2017/2018 overlap with late-graduating students from older cohorts.
"""
from __future__ import annotations

import sys
from pathlib import Path

try:
    import pandas as pd
except ImportError:
    sys.exit("pandas not found — run: py -m pip install pandas")

GRADUATED_CSV = Path("data/qu_raw/qu_graduated.csv")
REGISTERED_CSV = Path("data/qu_raw/qu_registered.csv")

CS_KEYWORDS = ["computer science"]

# Cohorts per window.
# 4-yr (8 sem):  Fall 2019 + 8 sem = Spring 2024 (last data point) -> 2015-2019 valid
# 6-yr (12 sem): limited to Fall 2015-2016 only. Fall 2017's 12-semester window
#   (2017-2023) overlaps with the large Spring/Fall 2023 graduation surge from the
#   rapidly expanding Fall 2019-2021 cohorts, producing rates >100%. The aggregate
#   data does not tag graduates to their entry year, so late-cohort graduates inflate
#   the numerator without appearing in the Fall 2017 denominator.
WINDOWS = {
    "4-yr  (8 sem)": {"sems": 8,  "cohorts": [2015, 2016, 2017, 2018, 2019]},
    "6-yr (12 sem)": {"sems": 12, "cohorts": [2015, 2016]},
}


def load_csv(path: Path) -> pd.DataFrame:
    if not path.exists():
        sys.exit(f"File not found: {path}")
    for sep in (";", ",", "\t"):
        df = pd.read_csv(path, sep=sep, encoding="utf-8-sig")
        if len(df.columns) > 2:
            return df
    sys.exit(f"Could not parse {path}")


def sem_to_index(semester_str: str) -> int | None:
    s = str(semester_str).strip().lower()
    if "summer" in s:
        return None
    for part in s.split():
        if part.isdigit() and len(part) == 4:
            year = int(part)
            base = (year - 2015) * 2
            return base + (0 if "fall" in s else 1)
    return None


def main() -> None:
    grad_df = load_csv(GRADUATED_CSV)
    reg_df  = load_csv(REGISTERED_CSV)

    reg_cs = reg_df[
        reg_df["Major"].str.contains("|".join(CS_KEYWORDS), case=False, na=False) &
        reg_df["Level"].str.contains("undergraduate", case=False, na=False)
    ].copy()
    reg_cs["sem_idx"] = reg_cs["Semester"].apply(sem_to_index)
    reg_cs = reg_cs.dropna(subset=["sem_idx"])
    reg_cs["sem_idx"] = reg_cs["sem_idx"].astype(int)

    grad_cs = grad_df[
        grad_df["Major"].str.contains("|".join(CS_KEYWORDS), case=False, na=False) &
        grad_df["Level"].str.contains("undergraduate", case=False, na=False)
    ].copy()
    grad_cs["sem_idx"] = grad_cs["Semester"].apply(sem_to_index)
    grad_cs = grad_cs.dropna(subset=["sem_idx"])
    grad_cs["sem_idx"] = grad_cs["sem_idx"].astype(int)

    if reg_cs.empty:
        sys.exit("No CS undergrad rows found in registered CSV.")
    if grad_cs.empty:
        sys.exit("No CS undergrad rows found in graduated CSV.")

    print(f"CS undergrad rows found: {len(reg_cs)} registered, {len(grad_cs)} graduated\n")

    for window_label, cfg in WINDOWS.items():
        window_sems = cfg["sems"]
        cohort_years = cfg["cohorts"]
        print(f"-- {window_label} graduation rate ------------------")
        print(f"  {'Cohort':<12} {'Enrolled':<12} {'Graduates':<12} {'Grad Rate'}")
        print("  " + "-" * 44)

        rates = []
        for year in cohort_years:
            entry_idx  = (year - 2015) * 2
            window_end = entry_idx + window_sems

            cohort_size = int(reg_cs[reg_cs["sem_idx"] == entry_idx]["Total Registered"].sum())
            grad_count  = int(
                grad_cs[
                    (grad_cs["sem_idx"] >= entry_idx) &
                    (grad_cs["sem_idx"] <= window_end)
                ]["Number of Graduates"].sum()
            )

            if cohort_size == 0:
                print(f"  Fall {year}: no enrollment data")
                continue

            rate = grad_count / cohort_size
            rates.append(rate)
            print(f"  Fall {year:<7} {cohort_size:<12} {grad_count:<12} {rate:.1%}")

        if rates:
            avg = sum(rates) / len(rates)
            print("  " + "-" * 44)
            print(f"  Average real-world rate : {avg:.1%}")
        print()

    print("-- Simulation comparison ------------------------")
    print(f"  A_baseline graduation rate : 59.0%")
    print(f"  A_baseline on-time rate    : 18.0%  (<=8 sem)")


if __name__ == "__main__":
    main()
