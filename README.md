# CS Intake Planner

A decision tool for Qatar University's Computer Science department. It answers one question:

> **How many students should we admit into the next CS intake, and what course seats does that number need?**

It simulates every student in the department moving through the real CS study plan (the 2024
roadmap: 41 courses, 120 credit hours), one semester at a time. Students register by seniority,
compete for a limited number of seats in each course, pass or fail, fall behind, or leave. The
simulation includes the students already enrolled and the seats used by other programs, so the
answer reflects how crowded the courses will really be. The tool tries many intake sizes, compares
each with a world where seats never run out, and reports the largest intake whose *seat-shortage
harm* stays within limits the department sets.

It runs **locally on a department PC**. Nothing is sent to an outside server, and there is no
login. Computer Engineering can be added later as a second program on the same engine.

## Who it is for

**Department heads and planning staff** who set the intake number. You do not need to understand
the simulation to use it: the site shows a recommended intake, a safe range, the reason, and what
it would take (in seats) to admit more. Every input is labelled **QU data** or **estimate**, and
results resting mostly on estimates carry an "illustrative" badge.

> Sections and seats change every semester. A recommendation assumes the seats you entered stay
> roughly the same for the next six years. Update the data and re-run whenever the schedule changes.

## Quick start

On the department PC, double-click **`start.bat`**. It starts the backend and the website and
opens <http://localhost:3000>. The first time, the site asks for the past intakes and the seats
used by other programs.

Manual start:

```bash
py -m pip install -r requirements.txt          # 1. Python dependencies (project root)
py -m uvicorn src.api:app --port 8001          # 2. backend API
cd web && npm install && npm run dev           # 3. website (second terminal)
# open http://localhost:3000   (not 127.0.0.1:3000)
```

Command line only (no website):

```bash
py run.py            # baseline simulation -> outputs/
py run.py --intake   # plus the full intake analysis (a minute or two on a multi-core PC)
```

Tests: `py -m pytest tests/ -q`.

**Optional Advisor chat.** The Advisor explains a result and proposes changes to test, using a
local model through [Ollama](https://ollama.com) (free, nothing leaves the PC). Copy `.env.example`
to `.env` to choose the model. Without it, the rules-based advice on the Advisor page still works.
The AI never produces the intake number; the simulation does.

## The yearly workflow

1. **Update the data** on the **Data** page: seats per course, pass rates, the last few years'
   intakes, and seats used by other programs. Type them in or import from CSV/Excel.
2. **Run the analysis** on the **Intake Planner** page (takes a few minutes).
3. **Read the card**: recommended intake, the number that is sustainable every year, an upper
   limit beyond which extra students add little, the reason, and how sensitive it all is.
4. **Make a seat plan** if you want to admit more: "what would it take to admit 120?" lists the
   seats to add per course, with predicted outcomes before and after.
5. **Decide**, using the card, chart and table. Past analyses are kept with the exact inputs each
   used, and can be exported.
6. **Record** the decision and the data's "as of" date. Next year, start again at step 1.

Step-by-step guidance for staff: [docs/user_guide.md](docs/user_guide.md).

## How it works

```
 Data you enter ──►  Simulator (many cohorts, one shared seat pool)  ──►  Intake analysis
 seats, pass rates,   • prerequisites and once-a-year courses              • many intake sizes N
 past intakes,        • seniority-based registration                       • many random replications
 other programs'      • pass/fail, GPA, probation, dropout                 • vs. a no-seat-shortage run
 seats                                                                     • decision rule + uncertainty
```

- **Two views of every intake size.** *Next*: today's students plus the next intakes, which drives
  the headline. *Steady*: a university that has admitted that size for years, which gives the
  sustainable number.
- **Honest uncertainty.** Each size is simulated with many independent random seeds; the result is
  smoothed and given a one-sided 95% bound, and the tool says "imprecise" rather than guess.
- **Seat shortage is isolated.** The same students are run with unlimited seats, so the harm
  attributed to seats is the difference, not noise.

The full method, assumptions and limits are in [docs/methodology.md](docs/methodology.md).

### Example result (illustrative, not advice)

On the *estimated* data shipped with the project (five past intakes of 100, default seats, the
"Balanced" policy: seat shortages may cost at most 2 points of graduation rate and 10 points of
on-time rate):

| | |
|---|---|
| Recommended next intake | **40** |
| Sustainable every year | **70** |
| Upper limit (beyond this, extra students add little) | **90** |
| Limit that binds first | on-time graduation |
| Course that runs out of seats first | CSEL2 |

The default plan models each elective slot (CSEL1 to CSEL4) as one 35-70 seat course; at QU the
real elective capacity is the sum of all elective sections, so entering real numbers changes this.
Treat the table as a demonstration of the output.

## Repository map

```
src/        Python backend, in layers (a layer imports only from layers below it)
            domain → validation → engine → analysis → storage → planner → api
web/        Next.js website: Intake Planner, Bottlenecks, Walkthrough, Advisor, Data, Programs
data/       Seed data: curriculum.json, simulation_config.json (the SQLite DB is generated)
scripts/    Maintenance tools: calibrate seats, seed the DB, profile a run
tests/      pytest suite (includes a test that enforces the layering)
docs/       Documentation (below)
references/ The official QU CS study plan and prerequisite flowchart (PDF)
run.py      Command-line entry point        start.bat   One-click launcher
```

Details and the rules for where new code goes: [docs/architecture.md](docs/architecture.md).

## Documentation

| Read this | If you want to |
|---|---|
| [docs/user_guide.md](docs/user_guide.md) | use the tool each year |
| [docs/methodology.md](docs/methodology.md) | understand and defend the recommendation |
| [docs/architecture.md](docs/architecture.md) | find your way around the code |
| [docs/engine.md](docs/engine.md) | know how one student and one term behave |
| [docs/assumptions.md](docs/assumptions.md) | check any parameter and its justification |
| [docs/api.md](docs/api.md) | call the HTTP API |
| [docs/database.md](docs/database.md) | see the SQLite schema |
| [CLAUDE.md](CLAUDE.md) | work on the code (commands, design record, constraints) |
