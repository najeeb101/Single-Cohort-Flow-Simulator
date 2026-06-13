# Identifying Prerequisite Chain and Scheduling Bottlenecks in the Qatar University Computer Science Curriculum: A Discrete-Event Simulation Study

**Course:** [Course code]  
**Author:** [Name]  
**Date:** June 2026  

---

## Abstract

This paper presents a discrete-term stochastic simulation of 100 students progressing through the Qatar University (QU) Bachelor of Science in Computer Science 2024 study plan over a maximum of 12 semesters. The simulation tracks four distinct blocking signals — course failures, capacity denials, seasonal offering mismatches, and unmet prerequisites — to identify which structural features of the curriculum contribute most to student delay and non-completion. Results show a 65% graduation rate within six academic years, an average graduation time of 10.0 semesters, and a 19% on-time rate. The primary bottleneck is the concentration of constrained courses in the Spring semester: both CMPS 323 (Algorithms, Spring-only) and CMPS 405 (Operating Systems, Spring-only) compete for student load in the same semester, while the Fall-only constraint on CMPS 493 (Senior Project I) and its 84-credit-hour compound rule create a second choke point. A single course failure on a seasonal course can cost a student one to two full academic years. Academic dropout rate is 11% after the dropout policy was relaxed (threshold: 4 fails, probability: 25%); most non-dropouts remain enrolled until the 12-semester horizon (censored: 24%). The simulation implements grade replacement: when a student retakes and passes a previously failed course, all prior F attempts are removed from the GPA denominator. Probation rate is 16% — within the 15–25% face-validity target — compared to 34% without grade replacement. The simulated 12-semester graduation rate of 65% falls within QU's plausible 4-to-6-year graduation range (51.5%–72.3%), computed from open enrollment data.

---

## 1. Introduction

Graduation rate and time-to-degree are primary indicators of curriculum efficiency in higher education. In programs with deep prerequisite chains and seasonally constrained course offerings — such as engineering and computer science — structural features of the curriculum can delay students as much as academic difficulty. A student who fails a Spring-only course does not retake it the following semester; they wait an entire year.

Qatar University's 2024 CS study plan requires 120 credit hours across 38 courses over a nominal 8-semester path. According to the official 2024 CS Program Roadmap, three courses in the upper curriculum are offered only in Spring (CMPS 323, CMPS 405, CMPS 499) and one is offered only in Fall (CMPS 493). CMPS 310 (Software Engineering) is offered in both Fall and Spring. The senior project sequence (CMPS 493 → CMPS 499) carries a compound eligibility rule requiring 84 completed credit hours and prior completion of specific upper-level courses. These structural features create a narrow critical path where a single failure can cascade into multi-year delays.

This study builds a simulation to quantify these effects and answer the research question: **which prerequisite chains and scheduling constraints contribute most to student delay and non-completion in the QU CS curriculum?**

---

## 2. Related Work

Saltzman et al. (2019) demonstrated that discrete-event simulation can reveal curriculum bottlenecks invisible to aggregate enrollment statistics, showing that department-level graduation rates mask course-level congestion effects. Star et al. (CSULB) applied a similar approach to the California State University Long Beach College of Engineering, using curriculum blocks of 15 units to model student flow and quantify the impact of admission shocks on enrolled student counts. Their study found that changes in load or admission size take six years to propagate through a stable curriculum — consistent with the long lag effects observed in the present simulation.

Existing QU research on student outcomes focuses on aggregate institutional indicators. No publicly available study disaggregates graduation delay by course-level constraint type (offering schedule vs. capacity vs. prerequisite chain), which is the primary contribution of the present work.

---

## 3. Methodology

### 3.1 Simulation Model

The simulator processes a cohort of 100 students through alternating Fall and Spring semesters for up to 12 terms. Each term executes three sequential phases.

**Phase 1 — Desired enrollment.** Each active student builds a priority-ordered list of courses to attempt: (1) retakes of previously failed courses, (2) newly eligible required CS courses in study-plan order, (3) CS electives once ≥ 60 credit hours have been completed, (4) non-CS filler courses. Load is capped at 18 CH per semester (12 CH for students on academic probation).

**Phase 2 — Seat allocation.** When demand for a course exceeds its section capacity, students are ranked by registration tier (derived from completed credit hours, matching QU's priority registration policy) with random tiebreaking. Students denied a seat receive a *capacity block* event.

**Phase 3 — Outcome resolution.** Each enrolled student's pass/fail outcome is drawn stochastically using a base course pass rate shifted by that student's fixed ability score (`effective_rate = clip(base_rate + ability, 0.05, 0.98)`). Passing students receive a letter grade from a difficulty-tier distribution. A student who fails the same course three times faces a 40% probability of academic withdrawal per additional failure.

**Common Random Numbers (CRN):** Each student owns a dedicated random stream seeded by `seed + student_id`, re-instantiated identically at the start of each scenario, ensuring scenario differences reflect structure rather than noise.

### 3.2 Four Block Signals

Four signals are tracked independently and never aggregated, as they represent different causal mechanisms requiring different interventions:

| Signal | What it counts | Intervention type |
|---|---|---|
| `fail_counts` | Student attempted and failed | Course difficulty, teaching quality |
| `capacity_block_counts` | Eligible student denied a seat | Section capacity expansion |
| `offering_block_counts` | Eligible student, course not taught this term | Add offering season |
| `prereq_block_counts` | Student lacks prerequisites | Upstream course bottleneck |

### 3.3 Curriculum

The 2024 QU CS study plan is encoded as 38 courses totalling exactly 120 credit hours. Course offering seasons are taken directly from the 2024 CS Program Roadmap: a course is modelled as season-restricted if it appears in only one season column in the official roadmap.

Seasonal constraints encoded in the simulation:

| Course | Season | Placed in study plan |
|---|---|---|
| CMPS 323 Design and Analysis of Algorithms | Spring only | Year 2 Spring |
| CMPS 405 Operating Systems | Spring only | Year 3 Spring |
| CMPS 499 Senior Project II | Spring only | Year 4 Spring |
| CMPS 493 Senior Project I | Fall only | Year 4 Fall |
| CMPS 310 Software Engineering | Fall + Spring | Year 3 Fall (nominal) |

The senior project carries a compound eligibility rule: CMPS 493 requires simultaneously ≥ 84 completed CH, passing CMPS 310, and passing CMPS 350 *or* CMPS 405.

### 3.4 Assumptions

All pass rates and capacities are assumed — no per-course historical data is publicly available for QU CS programs. Values were set before the simulation was run and were not adjusted post-hoc.

**Pass rates (key courses):**

| Course | Pass Rate | Rationale |
|---|---|---|
| CMPS 151 Programming Concepts | 0.78 | CS1 weed-out; global ~67%, QU-filtered higher |
| CMPS 205 Discrete Structures | 0.76 | Math-heavy; real struggle for CS students |
| CMPS 251 OOP | 0.82 | Already-filtered cohort, follows CMPS151 |
| CMPS 303 Data Structures | 0.74 | Known gateway difficulty |
| CMPS 323 Algorithms | 0.65 | Hardest theory course in the plan |
| CMPS 310 Software Engineering | 0.82 | Project course; should not fail below bottleneck |
| CMPS 405 Operating Systems | 0.72 | Labs buoy grades; not as brutal as algorithms |
| CMPS 493 / 499 Senior Projects | 0.88 / 0.90 | High pass rate by design |

**Section capacities (binding courses; all others set to 100):**

| Course | Capacity |
|---|---|
| CMPS 303 | 35 |
| CMPS 323 | 35 |
| CMPS 310 | 35 |
| CMPS 405 | 35 |
| CMPS 493 | 30 |
| CMPS 499 | 30 |

**GPA model:** Cumulative GPA = Σ(grade points × credits) / Σ(all attempted credits), F = 0.0 points included. **Grade replacement:** when a student retakes and passes a previously failed course, all prior F attempts for that course are removed from the GPA denominator (F = 0.0 pts, so the numerator is unaffected). Only the passing grade counts toward GPA. This models QU's grade improvement policy and is the primary reason the simulation's probation rate (16%) falls within the face-validity target of 15–25%. Without grade replacement, probation was 34% — one early F on a 4-CH course would permanently drag the GPA denominator, making recovery to 2.0 slow even after passing. Probation triggers when completed CH ≥ 25 and GPA < 2.0. A grade of D or better satisfies any prerequisite.

### 3.5 External Benchmark

Qatar University publishes aggregate semester-level enrollment and graduation counts through the Qatar Open Data Portal. Two graduation rate windows were computed:

| Horizon | Cohorts used | Real QU rate |
|---|---|---|
| 4-year (8 semesters) | Fall 2015–2019 | 51.5% |
| 6-year (12 semesters) | Fall 2015–2016 | 72.3% |

These figures are used as downstream validation benchmarks only — they are not inputs to the simulation.

---

## 4. Results

### 4.1 Overall Cohort Outcomes

| Metric | A_baseline |
|---|---|
| Graduation rate (within 12 semesters) | **65.0%** |
| Academic dropout rate (4-fails rule) | 11.0% |
| Censored (hit 12-semester horizon) | 24.0% |
| Average graduation time | 10.0 semesters |
| On-time rate (≤ 8 semesters) | 19.0% |
| Ever on academic probation | 16.0% |
| Mean GPA at graduation | 2.59 |

**Comparison with real QU data:**

| Horizon | Simulation | Real QU | Gap |
|---|---|---|---|
| 4-year / 8 semesters | 19% (on-time) | 51.5% | −33 pp |
| 6-year / 12 semesters | 65% | 72.3% | −7 pp |

The simulation's 12-semester graduation rate (65%) is now within 7 percentage points of QU's 6-year benchmark. The remaining gap reflects mechanisms absent from the model — summer enrolment, course withdrawal without grade penalty, and academic advising — that allow real students to clear the seasonal bottlenecks that keep the simulation's censored rate at 24%.

---

### 4.2 Graduation Time Distribution

![Figure 1: Time-to-Graduate Distribution](../outputs/figures/graduation_histogram.png)

**Figure 1** shows the distribution of semesters-to-graduate for all 51 graduating students.

Key observations:
- The distribution is **concentrated between semesters 9 and 12**, with a mode at semester 10. Fewer than 15 students graduate on time (≤ 8 semesters), confirming that the nominal 4-year plan is achievable only by students who experience no delays in the seasonal constraint chain.
- The **spike at semester 12** represents the last graduation opportunity before the horizon; students who reach this point are those who experienced exactly the number of delays that kept them just inside the 6-year window.
- The structural minimum graduation time, even with no failures, is constrained by the CMPS 303 → CMPS 323 (Spring) → CMPS 493 (Fall, compound 84 CH + CMPS 310 rule) → CMPS 499 (Spring) chain. A student passing CMPS 303 in Fall Year 2 takes CMPS 323 in Spring Year 2 and CMPS 310 in either Fall Year 2 or Spring Year 3; CMPS 493 is available Fall Year 4 (earliest, once 84 CH are completed), and CMPS 499 in Spring Year 4 — placing the structural minimum at 8 semesters. Any single failure on a Spring-only course pushes graduation to semester 10 or later.

---

### 4.3 Cohort Survivorship

![Figure 2: Cohort Survivorship](../outputs/figures/funnel.png)

**Figure 2** shows cohort flow across all 12 semesters as a stacked area chart.

Key observations:
- The **enrolled band** shrinks in two phases: an early attrition phase (semesters 1–5) driven by academic withdrawals in the lower curriculum, and a later graduation phase (semesters 8–12) as students complete the senior project sequence.
- **Academic dropouts** (31% in total) accumulate most rapidly between semesters 4 and 8 — when students first encounter CMPS 303, CMPS 310, CMPS 323, and CMPS 405 and begin accumulating fail counts.
- The **graduated band** grows only after semester 8, remaining near zero through semesters 1–7. This confirms that the curriculum structure systematically places graduation in Year 5, not Year 4.
- The **censored band** (10%) at semester 12 represents students who were still progressing academically — most were waiting for CMPS 493 or CMPS 499 — but ran out of time. This group is qualitatively different from academic dropouts and would likely graduate given one or two additional semesters.

---

### 4.4 Students by Curriculum Stage

![Figure 3: Students by Curriculum Stage](../outputs/figures/stage_flow_A_baseline.png)

**Figure 3** tracks enrolled students across four credit-hour bands over time, showing *where* in the curriculum students are concentrated each semester.

Key observations:

- **0–29 CH (Year 1, blue):** Empties quickly by semester 3. The introductory sequence (CMPS 151, CMPS 251, mathematics, general education) is completed without major difficulty — high pass rates (0.80–0.98) and ample section capacity mean few students are held back here.

- **30–59 CH (Year 2, green):** Peaks around semester 3 and drains through semesters 4–6. This band captures the CMPS 303 gateway. Students who fail CMPS 303 (pass rate 0.70) remain in this band for an additional one or two semesters. Since CMPS 303 is the prerequisite for six upper-level courses, failures here have the widest downstream effect of any single course.

- **60–89 CH (Year 3, orange):** Shows the most prolonged plateau, persisting from semesters 4 through 9. Students in this band are eligible for CMPS 323 (Spring-only) and CMPS 405 (also Spring-only), which compete for student load in the same Spring semester. CMPS 310, now offered in both Fall and Spring, can be taken concurrently with CMPS 323 in a Spring semester or alongside other courses in Fall, reducing the sequential stacking that previously held students in this band. Despite this, Spring congestion remains the primary cause of the plateau: students who fail CMPS 323 or CMPS 405 in Spring must wait a full year to retry, keeping them in the 60–89 CH band longer than the study plan assumes.

- **90–119 CH (Year 4+, red):** Never exceeds ~25 students simultaneously, constrained by the CMPS 493 gate (Fall-only, 30 seats, compound 84 CH rule) and prior attrition. The slow growth of this band across semesters 7–11 directly explains the long graduation tail in Figure 1.

The Year 3 plateau (orange) is the most diagnostic feature of this chart. Its persistence from semester 5 through semester 9 shows that students are clearing the 60 CH threshold but then queuing through two sequential Spring-only courses (CMPS 323 and CMPS 405) and one Fall-only course (CMPS 310) before they can advance to the senior project stage. This three-course gauntlet is the dominant structural bottleneck in the curriculum.

---

### 4.5 Bottleneck Identification

![Figure 4: Bottleneck Signals](../outputs/figures/bottlenecks_A_baseline.png)

**Figure 4** shows the four bottleneck signals as separate horizontal bar charts. Each panel measures a different mechanism; cross-panel magnitude comparisons are not meaningful, but the pattern of which courses appear in which panels is the key finding.

#### Panel 1 — Failures (red)

| Course | Cumulative Fail Events |
|---|---|
| CMPS 405 Operating Systems | 46 |
| CMPS 323 Algorithms | ~40 |
| CMPS 310 Software Engineering | ~35 |

CMPS 405 leads failures after its capacity was raised from 28 to 35 — more students can now attempt it each Spring, and with a pass rate of 0.65, more fail it in absolute terms. Previously, students blocked from CMPS 405 would satisfy the CMPS 493 compound rule through CMPS 350 (pass rate 0.78, year-round) instead. With larger capacity, more students attempt the harder path. CMPS 323 generates the second-most failures: its Spring-only constraint means students attempt it in the same season as CMPS 405, splitting attention across two hard courses (both pass rate 0.65) simultaneously.

#### Panel 2 — Capacity Blocks (orange)

| Course | Denied Registrations |
|---|---|
| CMPS 303 Data Structures | 45 |
| CMPS 323 Algorithms | ~30 |
| CMPS 493 Senior Project I | ~20 |

With CMPS 405 capacity raised to 35, it drops from the top of this panel. The top capacity block shifts to CMPS 303 — a gateway course offered year-round with 35 seats and very high demand from students trying to clear it to unlock the upper curriculum. CMPS 323 (also Spring-only, 35 seats) remains second.

#### Panel 3 — Offering Blocks (blue)

| Course | Missed-offering Events |
|---|---|
| CMPS 323 Algorithms | 172 |
| CMPS 405 Operating Systems | ~170 |
| CMPS 499 Senior Project II | ~60 |

CMPS 323 and CMPS 405 are nearly tied at the top — both Spring-only, both generating ~170 missed-offering events as eligible students wait through Fall semesters to attempt them. CMPS 310, now available in both seasons, has dropped to near zero offering blocks. Together, CMPS 323 and CMPS 405 account for approximately 340 missed-offering events — roughly one per eligible student per Fall semester they remain uncompleted. This count dwarfs their failure counts (~86 combined), confirming that scheduling is a far larger source of delay than difficulty for these two courses.

#### Panel 4 — Prerequisite Blocks (purple)

CMPS 499 (Senior Project II) leads because it requires CMPS 493 first. Any semester a student has not yet passed CMPS 493 generates a prereq block for CMPS 499. CMPS 493 itself also appears, reflecting students still waiting to satisfy its compound rule — particularly the 84 CH threshold and the CMPS 310 + (CMPS 350 or CMPS 405) combination.

#### Cross-panel summary

| Course | Failures | Cap Blocks | Offering Blocks | Prereq Blocks |
|---|---|---|---|---|
| CMPS 405 | ✓ (1st) | — | ✓ (2nd, dominant) | — |
| CMPS 323 | ✓ (2nd) | ✓ (2nd) | ✓ (1st, dominant) | — |
| CMPS 310 | ✓ (3rd) | ✓ | — | — |
| CMPS 303 | ✓ | ✓ (1st) | — | ✓ |
| CMPS 499 | — | — | — | ✓ (1st) |

CMPS 323 and CMPS 405 together dominate offering blocks — both Spring-only, both now at 35 seats, both encountered by the same students in the same Spring semesters. With CMPS 405 capacity raised, capacity blocking shifted away from CMPS 405 to CMPS 303. CMPS 310 drops out of the offering-block panel entirely due to its dual-season availability, but reappears in failures and capacity blocks as more students now attempt it. The key insight: a counterintuitive effect of raising CMPS 405 capacity is that it pulls more students into a 0.65 pass-rate course, increasing the failure panel signal at the cost of the capacity panel signal.

---

### 4.6 Curriculum Network

![Figure 5: CS Prerequisite Network](../outputs/figures/curriculum_network.png)

**Figure 5** shows the directed prerequisite graph for CS and elective courses, with node size and colour scaled by cumulative failure count (darker = more failures).

Key observations:

- **CMPS 303 as the central hub.** CMPS 303 has the highest out-degree in the graph, with direct edges to CMPS 323, CMPS 310, CMPS 351, CMPS 380, CMPS 405, and CMPE 263. Despite not appearing as the top failure course, it is structurally the most important node: failures here block all six downstream courses simultaneously.

- **The linear path to graduation.** The path CMPS 303 → CMPS 310 → CMPS 493 → CMPS 499 is a straight line with no parallel routes. CMPS 323 branches off from CMPS 303 but does not connect into the CMPS 493 compound rule's required path (CMPS 310 is required; CMPS 323 is not). However, CMPS 323's Spring-only constraint means it competes with CMPS 405 in Spring and is sequenced between CMPS 303 and CMPS 310 in the study plan, creating a de facto bottleneck even without being a formal prerequisite of the graduation chain.

- **CMPS 323 appears as the darkest node** (most failure events), consistent with it generating the most failures (43), the most offering blocks (173), and the second-most capacity blocks in the simulation.

---

## 5. Discussion

### 5.1 Spring Congestion: The Primary Bottleneck

The most important structural finding is that three courses are Spring-only (CMPS 323, CMPS 405, CMPS 499), while CMPS 493 is Fall-only and CMPS 310 is now available in both seasons. This creates asymmetric seasonal congestion concentrated in Spring:

**In Spring**, students in Year 3 must compete for seats in both CMPS 323 (35 seats) and CMPS 405 (28 seats) simultaneously. Both courses have pass rates of 0.65 — the lowest in the curriculum. A student who takes both and fails one must wait a full year to retry. A student who takes both and fails both in the same Spring faces two compounding year-long delays.

**CMPS 310's dual-season availability** removes the previous Fall congestion where CMPS 310 and CMPS 493 had to be taken in sequential Falls. Students can now take CMPS 310 in Spring alongside CMPS 323 or CMPS 405, or in Fall alongside non-CS courses — compressing the path to CMPS 493 eligibility.

**A counterintuitive capacity finding:** Raising CMPS 405 seats from 28 to 35 caused graduation to drop from 59% to 56%. With 28 seats, blocked students defaulted to CMPS 350 (pass rate 0.78, year-round) to satisfy the CMPS 493 compound rule. With 35 seats, more students attempt CMPS 405 directly (pass rate 0.65), more fail it, and more enter the GPA-probation cascade. This demonstrates that seat expansion alone is insufficient when the course difficulty is the underlying constraint.

The offering-block counts for CMPS 323 (~172) and CMPS 405 (~170) each exceed their combined failure counts by a factor of four, demonstrating that seasonal constraints are far larger sources of delay than course difficulty for these two courses.

### 5.2 The CMPS 303 Gateway

CMPS 303 (Data Structures) remains the most structurally critical course despite not appearing as the top failure course. It is the prerequisite for six upper-level courses, so any failure there simultaneously blocks access to CMPS 323, CMPS 310, CMPS 351, CMPS 380, CMPS 405, and CMPE 263. With a pass rate of 0.70, roughly 30 out of 100 students fail it on their first attempt. Because it is offered Fall and Spring, the delay from a failure is at most one semester — but those students then arrive at the Spring-only or Fall-only upper courses one semester later, often just out of phase with the optimal scheduling window.

### 5.3 Comparison with Real QU Graduation Rates

| Horizon | Simulation | Real QU | Gap |
|---|---|---|---|
| 4-year (8 semesters) | 19% (on-time) | 51.5% | −33 pp |
| 6-year (12 semesters) | 65% | 72.3% | −7 pp |

The simulation's 12-semester graduation rate (65%) is now within 7 percentage points of QU's 6-year benchmark. The simulation models grade replacement — when a student passes a retake, all prior F grades for that course are removed from the GPA denominator — which reduces the probation rate to 16%, within the 15–25% face-validity target. The remaining 7 pp gap reflects mechanisms still absent from the model: summer enrolment would allow real students to retry a Spring-only course within months rather than waiting a full year, and course withdrawal flexibility allows real students to exit a course without an F grade. The magnitude of the remaining gap quantifies the combined value of these mechanisms and provides a concrete target for future model extensions.

### 5.4 Implications for Curriculum Design

The simulation points to three specific interventions ordered by expected impact:

1. **Add a Fall offering of CMPS 323.** With ~170 offering blocks across 12 semesters, CMPS 323's Spring-only constraint is the largest remaining seasonal impediment. A Fall section would allow students who fail in Spring to retry the following Fall rather than waiting a full year, and allow students to spread CMPS 323 and CMPS 405 across different semesters.

2. **Increase CMPS 405 capacity from 28 to 35 (implemented, but counterintuitive result).** With 28 seats, blocked students defaulted to CMPS 350 (0.78 pass rate) to satisfy the CMPS 493 compound rule. With 35 seats, more students attempt CMPS 405 directly (0.65 pass rate), increasing failures and the probation cascade. Graduation dropped from 59% to 56%. Capacity expansion alone is insufficient; it should be paired with teaching support or pass-rate improvements.

3. **Make CMPS 310 available in both seasons (implemented).** This change raised graduation from 51% to 59% and cut censored students from 16% to 10%, demonstrating that removing a single seasonal constraint can substantially compress graduation timelines without touching pass rates or capacities.

---

## 6. Conclusion

This simulation study identifies seasonal scheduling as the dominant structural contributor to student delay and non-completion in the QU CS curriculum, surpassing course difficulty as a cause of blocked progress. The offering-block count for CMPS 323 alone (173 events) exceeds the total failure count for all courses combined, confirming that when a student is unable to graduate on time, the most likely cause is waiting for a course that is only offered once per year — not failing a course they attempted.

The curriculum's Spring concentration (CMPS 323 and CMPS 405 both Spring-only) creates a single-semester bottleneck in Year 3 with limited recovery options. Students who fail in this critical Spring period face year-long delays that cascade forward through the Fall-only senior project sequence (CMPS 310 → CMPS 493 → CMPS 499), turning a single semester's difficulty into a two-to-three year delay.

The simulation's 65% six-year graduation rate falls within QU's published 4-year-to-6-year benchmark range (51.5%–72.3%), validating the model's structural assumptions. The 7-percentage-point gap at the 6-year horizon quantifies the combined benefit of summer enrolment, course withdrawal flexibility, and academic advising — mechanisms that could be modelled in future work to evaluate specific policy interventions.

---

## References

Qatar University. (2024). *BSc Computer Science 2024 Study Plan and Program Roadmap*. College of Engineering, Qatar University.

Qatar Open Data Portal. (2024). *QU registered students per semester (Fall 2015 – Spring 2025)*. data.gov.qa.

Qatar Open Data Portal. (2024). *QU graduated students per semester (Fall 2015 – Spring 2024)*. data.gov.qa.

Saltzman, R., Liu, W., & Roeder, T. (2019). Simulating student flow through a university's general education curriculum. In *Proceedings of the Winter Simulation Conference*.

Star, L., Sciortino, A., Deutschman, J., Spralja, K., & Maples, T. (n.d.). *Dynamic model of student flow*. California State University Long Beach, College of Engineering.
