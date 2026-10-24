# CS Intake Planner

A decision tool for Qatar University's Computer Science department. It answers one question:

> **How many students should we admit into the next CS intake, and what course seats does that number need?**

It does this by simulating students moving through the real CS study plan (the 2024 roadmap,
41 courses, 120 credit hours): who can take which course, who gets a seat, who passes, who falls
behind, who drops out. The simulation includes the students already in the department and the
seats used by other programs, so the answer reflects how crowded the courses will actually be.
Computer Engineering can be added later as a second program on the same engine.

The tool runs **locally on a department PC**. Nothing is sent to an outside server.

---

## Who it is for

Department heads and planning staff who set the intake number. You do not need to know how the
simulation works to use it. The site shows a recommended intake, a safe range, the reason, and
what it would take (in sections) to admit more. Every number is labelled as **QU data** or
**estimate**, so you can see how much of an answer rests on real figures.

> Sections and seats change every semester. A recommendation assumes the seats you entered stay
> roughly the same for the next 6 years. Update the data and run the analysis again whenever the
> schedule changes.

---

## The yearly workflow

1. **Update the data.** Seats per course (sections times section size), pass rates, the last
   few years of intakes, and seats used by other programs. Import from CSV or Excel, or type
   them in on the **Data** page.
2. **Run the analysis.** On the **Intake Planner** page, check the policy limits and press
   **Run analysis**. It takes a few minutes (about 2.5 minutes on a 20-core PC).
3. **Read the card.** It gives the recommended intake, the number that is sustainable every
   year, an upper limit beyond which extra students add little, the reason, and a range showing
   how sensitive the number is.
4. **Make a seat plan.** To admit more than the card allows, ask the **seat planner** what it
   would take, for example "what would it take to admit 120?". It lists the sections to add per
   course, with predicted outcomes before and after. Apply them to the plan if you wish.
5. **Decide.** Take the card, the chart and the table to the committee. Past analyses are kept
   (with the exact inputs each used) and can be printed or exported to CSV.
6. **Record.** Note the decision and the "as of" date of the data. Next year, start again at step 1.

A step-by-step guide for staff is in [docs/user_guide.md](docs/user_guide.md).

---

## Quick start

On the department PC, double-click **`start.bat`**. It starts the backend and the website and
opens <http://localhost:3000>. The first time, the site asks you to enter the past intakes and
other-program seats before anything else.

**Manual start (fallback)**

```bash
# 1. Install the Python dependencies (from the project root)
py -m pip install -r requirements.txt

# 2. Start the backend API
py -m uvicorn src.api:app --port 8001

# 3. In a second terminal, start the website
cd web && npm install && npm run dev
# then open http://localhost:3000  (not 127.0.0.1:3000)
```

**From the command line (no website)**

```bash
py run.py --intake
```

Runs the baseline simulation and the full intake analysis, prints the recommendation, and writes
`outputs/reports/intake_analysis.json` next to the usual CSV reports.

**Optional: the Advisor chat.** The Advisor explains the result and proposes changes to test.
It uses a local model through [Ollama](https://ollama.com) (no cost, nothing leaves the PC).
The recommended model is `qwen3:4b-instruct-2507-q4_K_M` (about 25 s per answer); a larger one such as `qwen3-coder:30b` needs a PC with about 32 GB RAM. Copy `.env.example` to `.env` to choose the model. Without it, the rules-based advice on the
Advisor page still works. The AI never produces the intake number; the simulation does.

---

## Example result (illustrative, not a recommendation)

This is what the card looked like on the **default, estimated data** shipped with the project:
today's student body rebuilt from five past intakes of 100 (padded to 8 years), default seats,
and the "Balanced" policy (seat shortages may cost at most 2 points of graduation rate and 10
points of on-time rate).

| | |
|---|---|
| Recommended next intake | **40** |
| Sustainable every year | **70** |
| Upper limit (beyond this, extra students add little) | **90** |
| Limit that binds first | on-time graduation |
| Course that runs out of seats first | CSEL2 |

Why so low? The default plan models the elective slots (CSEL1 to CSEL4) as single courses of
35 to 70 seats, a leftover from an earlier research version that squeezed electives on purpose.
That crowds them. At QU the real elective capacity is the sum of all elective sections, so
entering real numbers changes this result. **Treat the table above as a demonstration of the
output, not as advice.** Results built mostly on estimates carry an "illustrative" badge on the site.

---

## Local only

The database (`data/app.db`) lives on the PC, and analyses run on its CPU cores. There is no
login and no hosting. The optional paid-API Advisor setting sends only aggregate numbers
(never student records), and is off unless you configure it.

---

## Project structure

```
src/
├── models/
│   ├── course.py        # Course dataclass + load_curriculum()
│   ├── student.py       # Student state, GPA, eligibility, cohort_id/entry_term
│   └── semester.py      # term index -> season + year (config-driven, optional terms)
├── datasource.py         # CohortSpec + SyntheticDataSource (builds today's students from past intakes)
├── rules.py              # evaluate_rule() / gate_edges() - compound prerequisite expressions
├── simulator.py          # Simulator (staggered admission + 3-phase per-term loop) + History
├── intake.py             # THE DECISION LAYER: intake sweep, no-shortage reference, smoothing,
│                         # decision rule, seat plan, calibration check
├── jobs.py               # background runner: one analysis at a time, progress, cancel
├── analytics.py          # metrics, per-cohort metrics, curriculum graph, flow_timeline JSON, CSVs
├── service.py            # run_simulation() - no-file-I/O engine boundary
├── parallel.py           # process-pool helpers (order-preserving)
├── montecarlo.py         # mean +/- 95% CI over spaced seeds
├── db.py / db_models.py  # SQLite persistence (plans, courses, config, analyses)
├── plan_validation.py    # guardrails on every edit
├── advisor.py            # rules + optional local-LLM chat, grounded in the plan and analysis
├── api.py                # FastAPI: /meta, /intake-analyses, /simulate, /curriculum, /config, /plans, /checkpoint
└── visualize.py          # static figures for run.py

web/        Next.js website: Intake Planner, Bottlenecks, Walkthrough, Advisor, Data, Plans, Methodology
data/       curriculum.json, simulation_config.json (seed data for the database)
scripts/    size_capacity.py, migrate_json_to_db.py
tests/      pytest suite
docs/       methodology, user guide, technical documentation
run.py      command-line entry point (--intake for the intake analysis)
start.bat   one-click launcher for the department PC
```

Run the tests with `py -m pytest tests/ -v`.

---

## Documentation

- **[docs/user_guide.md](docs/user_guide.md)**: step-by-step guide for department staff.
- **[docs/methodology.md](docs/methodology.md)**: how the recommendation is computed, what it assumes, and its limits. For the committee and technical reviewers.
- **[docs/project_overview.md](docs/project_overview.md)**: what the project is and how the simulation works.
- **[docs/technical_design.md](docs/technical_design.md)**: model architecture and execution walkthrough.
- **[docs/code_walkthrough.md](docs/code_walkthrough.md)**: module-by-module code reference.
- **[docs/assumptions.md](docs/assumptions.md)**: every assumption and parameter, with justification.
- **[docs/api.md](docs/api.md)**: every HTTP endpoint, request and response shapes.
- **[docs/database.md](docs/database.md)**: the SQLite schema and startup migration.
