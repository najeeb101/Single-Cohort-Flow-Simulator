# Curriculum facts, constraints and outputs

Reference split out of `CLAUDE.md`; read it when touching curriculum data, offering rules, grading or `outputs/`.

## Key Constraints

- **Curriculum = the official Qatar University CS Program Roadmap 2024** (41 courses, 120 CH):
  real course codes/titles/credits (CMPS151, MATH101, CHEM101/103, PHYS191–194, ENGL202/203,
  HIS121, ARAB100, DAWA111, GENG200/300, CMPS307, MAGT101, the Core-Curriculum "Package"
  courses, and Major Electives CSEL1–4), each placed in its real semester via `study_plan_term`
  (Year 1 Fall … Year 4 Spring), categories mapped to the roadmap's requirement-type colours
  (cs_core=Major Core, cs_elective=Major Elective, math=College Requirement, science=Major
  Supporting, english/gen_ed=Core Curriculum). See [Initial-State Model] / the dashboard
  roadmap note above.
- **Offerings mirror QU's real schedule, not a blanket Fall+Spring.** Most courses run
  Fall+Spring, but **8 core courses are single-term**: Fall-only {CMPS200, CMPS310, CMPE355,
  CMPS380} and Spring-only {CMPE263, CMPS323, CMPS351, CMPS405}. The 22 non-CS **service courses
  (math/science/english/gen_ed) additionally run in Summer** (an optional term — see "Term/Season
  Model"), matching how QU offers high-demand service courses year-round; CS courses are **never**
  offered in Summer. This single-term realism interacts with capacity: because a missed seat in an
  *early* gateway pushes a student off the annual rhythm and into a once-a-year upper course
  off-cycle (a full year lost), the required cs_core sequence is sized to **peak** demand rather
  than squeezed (see "Capacity model" below and `scripts/size_capacity.py`).
- CMPS303 (Data Structures) is the central gateway: prerequisite for CMPS323, CMPS380, CMPS405.
- CMPS493 (Senior Project I) compound rule: requires CMPS310 + (CMPS350 OR CMPS405) +
  completed_ch ≥ 84 — exactly the roadmap's stated Senior-Project entry requirement.
- D or better satisfies any prerequisite
- GPA = Σ(grade_points × credits) / Σ(all_attempted_credits) — F = 0.0 pts included in denominator
- CRN: each student RNG is `random.Random(seed + student_id)`, deterministic across runs.

## Outputs

```
outputs/
├── figures/    university_enrollment.png, cohort_flow.png, utilization_heatmap.png,
│               graduation_histogram.png, bottlenecks_<scenario>.png, curriculum_network.png,
│               survival_curve.png, cohort_bottleneck_comparison.png, scenario_comparison.png
└── reports/    simulation_summary.csv, cohort_flow.csv, cohort_summary.csv,
                course_utilization.csv, monte_carlo.csv, flow_timeline.json,
                intake_analysis.json (only with `py run.py --intake`)
```

`flow_timeline.json` is the frontend contract: `meta` (scenario name, stage nodes, cohorts, prerequisite `graph`), `frames` (one per semester: per-course stats + per-cohort stage nodes/flows), and `summary` (headline metrics + CIs, per-cohort metrics + bottlenecks, severe terms). The intake recommendation is not in it: it lives in the `Analysis` result (`POST /intake-analyses`).
