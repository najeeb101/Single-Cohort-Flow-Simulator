# CS Intake Planner: council verdict and changes before Sunday

Idea Council (`amirh3sam/idea-council`), run on 30 October 2026 against the latest `main` (commit `40c7ad0`).

## Verdict: BUILD, BUT (7/10, medium confidence)

Present it on Sunday as a **method and a seat planner that needs the department's real data**.
Do **not** present a recommended intake number as advice.

| Agent | Score | What it scored |
|---|---|---|
| Believer | 7/10 | Strength of the case for: real problem, rigorous method, tested build |
| Skeptic | 6/10 (10 = fatal) | Severity of the case against: serious but not fatal |
| Investor | 6/10 | Worth of the effort: nearly free to show, no money in it, return is adoption |
| Judge | 7/10 | Final ruling |

**What it turns on:** whether Sunday is "here is a method, give me your real data for a pilot"
(ready) or "here is how many students to admit" (not ready).

**Why not a plain BUILD:**
- All inputs are estimates: 0 of 41 courses have QU seats or pass rates, past intakes are
  placeholders (100 a year), and no historical graduation outcomes are entered.
- The headline moves with the settings (40 / 70 / 90 on a full run, "no intake meets the
  limits" on quick runs).
- CSEL2 and CSEL3 come out as the tightest courses only because each elective slot is
  modelled as one small course (methodology section 9).
- QU admits every Qatari applicant who meets the minimum requirements, and students reach
  CS by declaring a major. So the head may not control the intake number, and the model
  (which admits each cohort straight into CS Year 1) does not represent major declaration
  or transfers.

**What the council found in its favour:** no free or commercial tool answers "how many to
admit, given shared seats" for one programme; the statistics are careful; there is no
privacy risk (no student records, runs locally, the AI never produces the number); 286
tests pass and the website builds.

## Changes

### Before Sunday (must do)

- [ ] **Lead with the seat planner, not a number.** Frame the demo as "for an intake of N,
      these courses need these seats", and keep the "Illustrative" badge visible.
- [ ] **Fix or remove the elective artifact.** Either set each CSEL slot's seats to the
      total across every elective section that can fill it, or don't show any headline
      that depends on CSEL2/CSEL3.
- [ ] **Rehearse on the Windows PC from a clean start.** Confirm the 404 is gone (stop
      old servers, delete `web\.next`, run `start.bat`).
- [ ] **Pre-run the full analysis** with the default settings (it takes several minutes on
      a laptop). Never show the quick-test "no intake" result. Keep screenshots or a
      screen recording as a backup.
- [ ] **Enter any real numbers you already have**, such as the actual past intake sizes.
- [ ] **Prepare one "known limits" slide:**
  - Inputs are estimates until the department provides real ones.
  - Major declaration and transfers in or out of CS are not modelled.
  - Faculty load and the cost of extra sections are not modelled.
- [x] ~~Fix stale `src/intake.py` paths in CLAUDE.md~~ (already done on `main`).

### Questions to ask the head (in this order, before showing any number)

1. Who decides how many students enter CS each year, and can the department change it?
2. Can I have last semester's section seats per course and the pass rates? Also 3 to 5
   real past intakes, and one 4- or 6-year graduation rate so the model check can run.
3. How many CS students come in through major declaration or transfer, compared with
   direct entry?
4. Who in the department would own and update this tool after I leave?
5. (Optional) Roughly what does one extra section cost per term? This lets a seat plan be
   priced.

### After Sunday (if the head agrees)

- [ ] Load the real data and tag it as QU data; check that the "Illustrative" badge goes away.
- [ ] Enter the historical outcomes and check that the model reproduces a past year's
      graduation and on-time rates (the back-test).
- [ ] Model elective slots as a pool of all elective sections.
- [ ] Model entry through major declaration and transfers, or show they are small.
- [ ] If the head doesn't set the intake: reframe the home page around "what seats does the
      intake we're given need?" (the seat planner first).
- [ ] Write a short handover note so someone in the department can run it each semester.

## What would change the verdict

- **Clear BUILD:** the head confirms the department sets or strongly shapes the CS intake,
  and agrees to share real seat and outcome data.
- **NOT YET as an intake tool** (still useful as a seat planner): the intake is set
  entirely centrally and no data is shared.

**Cheapest next test:** ask on Sunday, "Who decides how many students enter CS each year,
and could I have last semester's section seats?"
