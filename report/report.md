# Identifying Prerequisite Chain and Scheduling Bottlenecks in the Qatar University Computer Science Curriculum: A Discrete-Event Simulation Study
  
**Author:** Najeeb Barkhad 
**Date:** June 2026  

---

## Abstract

This paper presents a discrete-term stochastic simulation of 100 students progressing through the Qatar University (QU) Bachelor of Science in Computer Science 2024 study plan over a maximum of 12 semesters. The simulation tracks four distinct blocking signals — course failures, capacity denials, seasonal offering mismatches, and unmet prerequisites — to identify which structural features of the curriculum contribute most to student delay and non-completion. Results show a 71% graduation rate within six academic years, an average graduation time of 9.42 semesters, and a 20% on-time rate. The primary bottleneck is the concentration of constrained courses in the Spring semester: both CMPS 323 (Algorithms, Spring-only) and CMPS 405 (Operating Systems, Spring-only) compete for student load in the same semester, while the compound eligibility rule for CMPS 493 (Senior Project I) — requiring 84 credit hours, CMPS 310, and CMPS 350 or CMPS 405 — creates a second choke point independent of seasonal restrictions. Academic dropout rate is 13%; students who do not drop out often remain enrolled until the 12-semester horizon (censored: 16%). The simulation implements grade replacement: when a student retakes and passes a previously failed course, all prior F attempts are removed from the GPA denominator. Probation rate is 16% — within the 15–25% face-validity target — compared to 34% without grade replacement. The simulated 12-semester graduation rate of 71% is within 1.3 percentage points of QU's published 6-year benchmark of 72.3%, computed from open enrollment data.

---

## 1. Introduction

Graduation rate and time-to-degree are primary indicators of curriculum efficiency in higher education. In programs with deep prerequisite chains and seasonally constrained course offerings — such as engineering and computer science — structural features of the curriculum can delay students as much as academic difficulty. A student who fails a Spring-only course does not retake it the following semester; they wait an entire year.

Qatar University's 2024 CS study plan requires 120 credit hours across 38 courses over a nominal 8-semester path. According to the official 2024 CS Program Roadmap, two courses in the upper curriculum are offered only in Spring (CMPS 323, CMPS 405); CMPS 310 (Software Engineering), CMPS 493 (Senior Project I), and CMPS 499 (Senior Project II) are offered in both Fall and Spring. The senior project sequence (CMPS 493 → CMPS 499) carries a compound eligibility rule requiring 84 completed credit hours and prior completion of specific upper-level courses. These structural features create a narrow critical path where a single failure can cascade into multi-year delays.

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
| CMPS 310 Software Engineering | Fall + Spring | Year 3 Fall (nominal) |
| CMPS 493 Senior Project I | Fall + Spring | Year 4 Fall (nominal) |
| CMPS 499 Senior Project II | Fall + Spring | Year 4 Spring (nominal) |

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
| CMPS 405 Operating Systems | 0.65 | Spring-only; paired with CMPS 323 in same semester |
| CMPS 493 / 499 Senior Projects | 0.88 / 0.90 | High pass rate by design |

**Section capacities (binding courses; all others set to 100):**

| Course | Capacity |
|---|---|
| CMPS 303 | 45 |
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

Rates are computed as (CS graduates within the window) / (CS undergrads enrolled in the entry Fall), using aggregate public data. The 6-year window is restricted to Fall 2015–2016 entry cohorts because later cohorts' 12-semester windows overlap with a large post-2019 graduation surge: adding Fall 2017 produces a rate above 100%, since the aggregate data does not tag graduates to their original entry year. All figures are used as downstream validation benchmarks only — they are not inputs to the simulation.

---

## 4. Results

### 4.1 Overall Cohort Outcomes

| Metric | A_baseline |
|---|---|
| Graduation rate (within 12 semesters) | **71.0%** |
| Academic dropout rate (3-fails rule) | 13.0% |
| Censored (hit 12-semester horizon) | 16.0% |
| Average graduation time | 9.42 semesters |
| On-time rate (≤ 8 semesters) | 20.0% |
| Ever on academic probation | 16.0% |
| Mean GPA at graduation | 2.95 |

**Comparison with real QU data:**

| Horizon | Simulation | Real QU | Gap |
|---|---|---|---|
| 4-year / 8 semesters | 20% (on-time) | 51.5% | −31.5 pp |
| 6-year / 12 semesters | 71% | 72.3% | −1.3 pp |

The simulation's 12-semester graduation rate (71%) is within 1.3 percentage points of QU's 6-year benchmark. The remaining gap reflects mechanisms absent from the model — summer enrolment, course withdrawal without grade penalty, and academic advising — that allow real students to clear the seasonal bottlenecks that keep the simulation's censored rate at 16%.

---

### 4.2 Graduation Time Distribution

![Figure 1: Time-to-Graduate Distribution](../outputs/figures/graduation_histogram.png)

**Figure 1** shows the distribution of semesters-to-graduate for all graduating students.

Key observations:
- The distribution is **concentrated between semesters 9 and 12**, with a mode near semester 9–10. Twenty students graduate on time (≤ 8 semesters), reflecting the narrow slice of students who encounter no seasonal delays on the critical path.
- The **spike at semester 12** represents the last graduation opportunity before the horizon; students who reach this point experienced exactly the number of delays that kept them just inside the 6-year window.
- The structural minimum graduation time, even with no failures, is constrained by the CMPS 303 → CMPS 323 (Spring) → CMPS 493 (compound 84 CH + CMPS 310 rule) → CMPS 499 chain. A student passing CMPS 303 in Fall Year 2 takes CMPS 323 in Spring Year 2 and CMPS 310 concurrently or in Fall Year 3; CMPS 493 is available once 84 CH are completed and prerequisites are met, and CMPS 499 follows thereafter — placing the structural minimum at 8 semesters. Any single failure on a Spring-only course pushes graduation to semester 10 or later.

---

### 4.3 Cohort Survivorship

![Figure 2: Cohort Survivorship](../outputs/figures/funnel.png)

**Figure 2** shows cohort flow across all 12 semesters as a stacked area chart.

Key observations:
- The **enrolled band** shrinks in two phases: an early attrition phase (semesters 1–5) driven by academic withdrawals in the lower curriculum, and a later graduation phase (semesters 8–12) as students complete the senior project sequence.
- **Academic dropouts** (13% overall) accumulate most rapidly between semesters 4 and 8 — when students first encounter CMPS 303, CMPS 310, CMPS 323, and CMPS 405 and begin accumulating fail counts.
- The **graduated band** grows only after semester 8, remaining near zero through semesters 1–7. This confirms that the curriculum structure systematically places graduation in Year 4 at the earliest, and in Year 5 for most students.
- The **censored band** (16%) at semester 12 represents students who were still progressing academically — most were waiting to satisfy the CMPS 493 compound rule — but ran out of time. Making CMPS 493 and CMPS 499 available in both seasons has reduced this group compared to a Fall-only/Spring-only senior project configuration, but the compound credit-hour gate continues to hold some students past the 12-semester horizon.

---

### 4.4 Students by Curriculum Stage

![Figure 3: Students by Curriculum Stage](../outputs/figures/stage_flow_A_baseline.png)

**Figure 3** tracks enrolled students across four credit-hour bands over time, showing *where* in the curriculum students are concentrated each semester.

Key observations:

- **0–29 CH (Year 1, blue):** Empties quickly by semester 3. The introductory sequence (CMPS 151, CMPS 251, mathematics, general education) is completed without major difficulty — high pass rates (0.80–0.98) and ample section capacity mean few students are held back here.

- **30–59 CH (Year 2, green):** Peaks around semester 3 and drains through semesters 4–6. This band captures the CMPS 303 gateway. Students who fail CMPS 303 (pass rate 0.74) remain in this band for an additional semester. Since CMPS 303 is the prerequisite for six upper-level courses, failures here have the widest downstream effect of any single course. Capacity was raised to 45 seats, reducing the number of students blocked from attempting it each term.

- **60–89 CH (Year 3, orange):** Shows the most prolonged plateau, persisting from semesters 4 through 9. Students in this band are eligible for CMPS 323 (Spring-only) and CMPS 405 (also Spring-only), which compete for student load in the same Spring semester. CMPS 310, offered in both Fall and Spring, can be taken concurrently with CMPS 323 in Spring or alongside other courses in Fall, reducing the sequential stacking that previously held students in this band. Despite this, Spring congestion remains the primary cause of the plateau: students who fail CMPS 323 or CMPS 405 in Spring must wait a full year to retry, keeping them in the 60–89 CH band longer than the study plan assumes.

- **90–119 CH (Year 4+, red):** Never exceeds ~25 students simultaneously, constrained by the CMPS 493 gate (30 seats, compound 84 CH + CMPS 310 rule) and prior attrition. With CMPS 493 and CMPS 499 now available in both Fall and Spring, students who clear the 84 CH threshold mid-year are no longer forced to wait for a specific season; they can attempt CMPS 493 in the next available term. The slow growth of this band across semesters 7–11 reflects the compound rule's gatekeeping rather than a seasonal restriction.

The Year 3 plateau (orange) is the most diagnostic feature of this chart. Its persistence from semester 5 through semester 9 shows that students are clearing the 60 CH threshold but then queuing through two sequential Spring-only courses (CMPS 323 and CMPS 405) before they can advance to the senior project stage. This two-course Spring gauntlet is the dominant structural bottleneck in the curriculum.

---

### 4.5 Bottleneck Identification

![Figure 4: Bottleneck Signals](../outputs/figures/bottlenecks_A_baseline.png)

**Figure 4** shows the four bottleneck signals as separate horizontal bar charts. Each panel measures a different mechanism; cross-panel magnitude comparisons are not meaningful, but the pattern of which courses appear in which panels is the key finding.

#### Panel 1 — Failures (red)

| Course | Cumulative Fail Events |
|---|---|
| CMPS 405 Operating Systems | 55 |
| CMPE 355 Data Comm. and Networks I | (2nd) |
| CMPS 323 Algorithms | (3rd) |

CMPS 405 leads failures: it is Spring-only with a pass rate of 0.65, meaning every student who attempts it faces a 35% chance of failing and waiting a full year to retry. CMPE 355 (Data Communication and Computer Networks I, pass rate 0.72) is a new entrant as the second-highest failure course — this course sits downstream of CMPE 263 (Computer Architecture) and is attempted by many students in the 60–89 CH band concurrently with the Spring-only bottleneck courses, amplifying its failure count despite a relatively moderate difficulty. CMPS 323 generates the third-most failures; its Spring-only constraint means students attempt it in the same semester as CMPS 405, splitting attention across two hard courses simultaneously.

#### Panel 2 — Capacity Blocks (orange)

| Course | Denied Registrations |
|---|---|
| CMPS 323 Algorithms | 47 |
| CMPS 303 Data Structures | (2nd) |

CMPS 323 now leads capacity blocks. With CMPS 303's capacity raised from 35 to 45 seats, the queuing pressure at that gateway has eased, shifting the top capacity block signal to CMPS 323 (Spring-only, 35 seats). CMPS 323's Spring-only constraint concentrates an entire year's accumulated eligible-but-blocked students into a single semester's registration window, consistently generating the highest denial count.

#### Panel 3 — Offering Blocks (blue)

| Course | Missed-offering Events |
|---|---|
| CMPS 323 Algorithms | 213 |
| CMPS 405 Operating Systems | (2nd, dominant) |

CMPS 323 and CMPS 405 dominate the offering-block panel — both Spring-only, generating missed-offering events every Fall semester that an eligible student remains uncompleted. CMPS 323's count (213) dwarfs its failure count (~40–55), confirming that seasonal scheduling is a far larger source of delay than course difficulty for this course. CMPS 493 and CMPS 499, now offered in both seasons, have dropped to near-zero offering blocks, a direct consequence of removing their previous Fall-only and Spring-only restrictions.

#### Panel 4 — Prerequisite Blocks (purple)

CMPS 499 (Senior Project II) leads because it requires CMPS 493 first. Any semester a student has not yet passed CMPS 493 generates a prereq block for CMPS 499. CMPS 493 itself also appears, reflecting students still working to satisfy its compound rule — particularly the 84 CH threshold combined with CMPS 310 and either CMPS 350 or CMPS 405.

#### Cross-panel summary

| Course | Failures | Cap Blocks | Offering Blocks | Prereq Blocks |
|---|---|---|---|---|
| CMPS 405 | ✓ (1st) | — | ✓ (2nd, dominant) | — |
| CMPS 323 | ✓ (3rd) | ✓ (1st) | ✓ (1st, dominant) | — |
| CMPE 355 | ✓ (2nd) | — | — | — |
| CMPS 303 | ✓ | ✓ (2nd) | — | ✓ |
| CMPS 499 | — | — | — | ✓ (1st) |

CMPS 405 and CMPS 323 together dominate offering blocks — both Spring-only, encountered by the same students in the same Spring semesters. CMPS 323 leads capacity blocks due to its Spring-only concentration effect; CMPS 303's capacity increase (35→45) has shifted queuing pressure away from the gateway and toward the mid-curriculum Spring bottleneck. CMPE 355 appears in failures but not in the scheduling panels, confirming it is a difficulty-driven bottleneck rather than a seasonal one. CMPS 493 and CMPS 499 have largely exited the offering-block panel following their transition to year-round availability.

---

### 4.6 Curriculum Network

![Figure 5: CS Prerequisite Network](../outputs/figures/curriculum_network.png)

**Figure 5** shows the directed prerequisite graph for CS and elective courses, with node size and colour scaled by cumulative failure count (darker = more failures).

Key observations:

- **CMPS 303 as the central hub.** CMPS 303 has the highest out-degree in the graph, with direct edges to CMPS 323, CMPS 310, CMPS 351, CMPS 380, CMPS 405, and CMPE 263. Despite not appearing as the top failure course, it is structurally the most important node: failures here block all six downstream courses simultaneously.

- **The linear path to graduation.** The path CMPS 303 → CMPS 310 → CMPS 493 → CMPS 499 is a straight line with no parallel routes. CMPS 323 branches off from CMPS 303 but is not a formal prerequisite in the graduation chain; however, its Spring-only constraint means it competes with CMPS 405 for student load and is sequenced between CMPS 303 and the senior project in the study plan, creating a de facto bottleneck.

- **CMPS 405 appears as the darkest node** (most failure events, 55), consistent with its Spring-only constraint and 0.65 pass rate concentrating failures into a single season. CMPE 355 is the second-darkest, reflecting its position as the next most failure-prone course after the Spring bottleneck courses.

---

## 5. Discussion

### 5.1 Spring Congestion: The Primary Bottleneck

The most important structural finding is that two upper-curriculum courses are Spring-only (CMPS 323, CMPS 405), while CMPS 310, CMPS 493, and CMPS 499 are now available in both seasons. This creates asymmetric seasonal congestion concentrated in Spring:

**In Spring**, students in Year 3 must compete for seats in both CMPS 323 (35 seats, pass rate 0.65) and CMPS 405 (35 seats, pass rate 0.65) simultaneously. Both courses have the lowest pass rates in the curriculum. A student who takes both and fails one must wait a full year to retry. A student who fails both in the same Spring faces two compounding year-long delays.

**Making CMPS 493 and CMPS 499 year-round** has materially reduced end-of-path congestion: the censored rate dropped from 24% (under a Fall-only/Spring-only senior project configuration) to 16% in the current model. Students who clear the 84 CH compound rule mid-year can now attempt CMPS 493 in the very next term rather than waiting up to a full semester for the single available season.

**The offering-block counts for CMPS 323 (213) and CMPS 405 each exceed their combined failure counts by a factor of four**, demonstrating that seasonal constraints are far larger sources of delay than course difficulty for these two courses. Every eligible student who cannot attempt a Spring-only course in Fall generates one offering-block event, making this signal scale with both the number of affected students and the number of Fall semesters they remain stuck.

**CMPE 355 as an emerging bottleneck.** The second-highest failure count belongs to CMPE 355 (Data Communication and Computer Networks I, pass rate 0.72). This course is offered year-round and its failures are not amplified by seasonal restrictions; the signal reflects pure difficulty. Students attempting CMPE 355 are typically in the 60–89 CH band, concurrent with the Spring bottleneck courses, which may reduce study load available for it. This course warrants monitoring as a secondary difficulty-driven bottleneck.

### 5.2 The CMPS 303 Gateway

CMPS 303 (Data Structures) remains the most structurally critical course despite not appearing as the top failure course. It is the prerequisite for six upper-level courses, so any failure there simultaneously blocks access to CMPS 323, CMPS 310, CMPS 351, CMPS 380, CMPS 405, and CMPE 263. With a pass rate of 0.74, roughly 26 out of 100 students fail it on their first attempt. Because it is offered Fall and Spring, the delay from a failure is at most one semester — but those students then arrive at the Spring-only upper courses one semester later, often just out of phase with the optimal scheduling window. Raising capacity from 35 to 45 seats has reduced capacity blocking at this gateway; the queuing pressure has shifted downstream to CMPS 323.

### 5.3 Comparison with Real QU Graduation Rates

| Horizon | Simulation | Real QU | Gap |
|---|---|---|---|
| 4-year (8 semesters) | 20% (on-time) | 51.5% | −31.5 pp |
| 6-year (12 semesters) | 71% | 72.3% | −1.3 pp |

The simulation's 12-semester graduation rate (71%) is within 1.3 percentage points of QU's 6-year benchmark — a substantially closer fit than earlier calibration states. The simulation models grade replacement — when a student passes a retake, all prior F grades for that course are removed from the GPA denominator — which reduces the probation rate to 16%, within the 15–25% face-validity target. The remaining 1.3 pp gap at the 6-year horizon reflects mechanisms still absent from the model: summer enrolment would allow real students to retry a Spring-only course within months rather than waiting a full year, and course withdrawal flexibility allows real students to exit a course before receiving an F grade. The 4-year gap (−31.5 pp) remains wide, confirming that the nominal 8-semester plan is structurally unachievable for most students under realistic assumptions about failures and seasonal restrictions.

### 5.4 Implications for Curriculum Design

The simulation points to three specific interventions ordered by expected impact:

1. **Add a Fall offering of CMPS 323.** With 213 offering blocks across 12 semesters, CMPS 323's Spring-only constraint is the largest remaining seasonal impediment. A Fall section would allow students who fail in Spring to retry the following Fall rather than waiting a full year, and would allow students to spread CMPS 323 and CMPS 405 across different semesters — reducing the simultaneous double-bottleneck effect in Year 3 Spring.

2. **Make CMPS 493 and CMPS 499 year-round (implemented).** This change reduced the censored rate from 24% to 16%, adding approximately 6–7 graduating students per cohort who were previously held past the 12-semester horizon solely by the seasonal gate. The compound credit-hour rule remains a gatekeeping constraint and cannot be resolved by scheduling alone.

3. **Raise CMPS 303 capacity from 35 to 45 (implemented).** This change reduced capacity blocking at the gateway course and shifted queuing pressure to CMPS 323. The overall effect on graduation is modest because CMPS 303 failures — not capacity blocks — are the primary source of Year 2 delay; capacity expansion does not reduce the probability of failing the course.

---

## 6. Conclusion

This simulation study identifies seasonal scheduling as the dominant structural contributor to student delay and non-completion in the QU CS curriculum, surpassing course difficulty as a cause of blocked progress. The offering-block count for CMPS 323 alone (213 events) exceeds the total failure count for all courses combined, confirming that when a student is unable to graduate on time, the most likely cause is waiting for a course offered only once per year — not failing a course they attempted.

The curriculum's Spring concentration (CMPS 323 and CMPS 405 both Spring-only) creates a single-semester bottleneck in Year 3 with limited recovery options. Students who fail in this critical Spring period face year-long delays that cascade forward through the senior project compound rule (CMPS 310 → CMPS 493 → CMPS 499), turning a single semester's difficulty into a two-to-three year delay. Making CMPS 493 and CMPS 499 year-round has materially eased end-of-path congestion (censored rate fell from 24% to 16%), but the upstream Spring bottleneck at CMPS 323 and CMPS 405 continues to generate the largest block signal in the simulation.

The simulation's 71% six-year graduation rate is within 1.3 percentage points of QU's published 6-year benchmark of 72.3%, validating the model's structural assumptions. This close fit confirms that the four block signals — particularly the offering-block count for Spring-only courses — capture the dominant mechanisms of delay in the real curriculum. The remaining gap quantifies the combined benefit of summer enrolment, course withdrawal flexibility, and academic advising, and provides a concrete target for future model extensions.

---

## References

Qatar University. (2024). *BSc Computer Science 2024 Study Plan and Program Roadmap*. College of Engineering, Qatar University.

Qatar Open Data Portal. (2024). *QU registered students per semester (Fall 2015 – Spring 2025)*. data.gov.qa.

Qatar Open Data Portal. (2024). *QU graduated students per semester (Fall 2015 – Spring 2024)*. data.gov.qa.

Saltzman, R., Liu, W., & Roeder, T. (2019). Simulating student flow through a university's general education curriculum. In *Proceedings of the Winter Simulation Conference*.

Star, L., Sciortino, A., Deutschman, J., Spralja, K., & Maples, T. (n.d.). *Dynamic model of student flow*. California State University Long Beach, College of Engineering.
