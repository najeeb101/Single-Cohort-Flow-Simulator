# User guide for department staff

This guide walks through the yearly routine of the CS Intake Planner: entering data, running
an analysis, reading the result, and planning seats. No technical background is needed.

The tool runs on the department PC. Everything stays on that machine.

---

## 1. Starting the tool

Double-click **`start.bat`**. It starts the program in the background and opens the website at
<http://localhost:3000> in your browser. Leave the black window open while you work; close it
when you are done.

If the page does not open, type `http://localhost:3000` into the address bar yourself (do not
use `127.0.0.1`).

---

## 2. First-run setup

The first time, the site shows a setup screen before anything else. It asks for two things:

- **Past intakes**: how many students entered CS in each of the last few years (five or more
  is best). The tool uses them to rebuild the students who are in the department today.
- **Seats used by other programs**: for shared courses such as CMPS151 or MATH101, how many
  seats are taken each semester by students from other programs (for example Computer
  Engineering). These seats are not available to CS students.

Entering zero is an accepted answer for the second item. Press **Save and continue** when you
are done, or **Skip for now and use the estimates** to keep the shipped estimates. You can change
either later on the **Data** page.

---

## 3. Entering and updating data

Open the **Data** page. It has tabs:

| Tab | What to enter |
|---|---|
| Courses & seats | For each course, the total seats per regular semester (all sections together). The page shows how many sections of the section size (default 35, set on Policy & analysis) that is. |
| Pass rates | The share of students who pass each course on an attempt. |
| Current students | The past intakes, most recent first. |
| Other-program seats | Seats per course used by other programs. |
| Policy & analysis | The policy limits, the planning label (for example "Fall 2027 intake"), historical outcomes and enrolled headcount (optional, used for the calibration check), and analysis settings. |
| Advanced | Dropout and registration rules, the baseline run's cohort settings, and the course structure. Leave these alone unless you know why you are changing them. |

**Importing from CSV or Excel.** Each tab has an import button. Use a file with a code column
and a value column (a header row is detected automatically). Rows with unknown course codes or
non-numeric values are skipped and listed with a reason; the rest are still imported.

**QU data or estimate.** Next to each input there is a tag; click it to switch. Mark a value **QU data** only when it
comes from a real QU source (the class schedule, the Registrar, Admissions). Leave everything
else as **Estimate**. The tool uses the tags to tell you how much of a result rests on real
figures.

**Sections change every semester.** When the class schedule changes, update the seats here
before running an analysis.

---

## 4. Running an analysis

Open the **Intake Planner** page (the home page). From top to bottom you will see:

1. The planning label, for example "Fall 2027 intake".
2. The **data-quality strip** (for example "Pass rates: 19 of 41 QU data, 22 estimated") and a
   reminder that sections and seats change every semester.
3. The **policy limits**, which you can edit. The default "Balanced" policy lets seat shortages
   cost at most 2 points of graduation rate and 10 points of on-time graduation rate.
4. The **Run analysis** button.

Press **Run analysis**. A progress bar shows what the tool is doing. A full analysis takes a few
minutes (about 2.5 minutes on a 20-core PC). You can press **Cancel** at any time. Only one
analysis runs at a time. If the PC is turned off or the program is restarted during a run, the
run is marked as interrupted and you simply run it again.

---

## 5. Reading the result

**The recommendation card**

- **Recommended intake.** The largest next intake that stays inside your policy limits, taking
  today's students into account.
- **Sustainable every year.** The largest intake that stays inside the limits if you admit the
  same number every year. If the recommended number is higher than this, the card says: *you can
  take N once, but not every year.*
- **Upper limit.** Beyond this number each extra student adds fewer than a quarter of a
  graduate per year, so more admits mostly add delay.
- **Why.** One sentence naming the first limit to break and the course that runs out of seats.
- **Range.** The recommendation re-checked with one fewer section in the tightest courses and
  with pass rates 5 points lower, for example "72 to 80". A wide range means the answer is
  sensitive to the inputs.
- **Warnings.** For example "some estimates are imprecise" (run again with more seeds) or "most
  inputs are estimates" (the **illustrative** badge).
- **No feasible intake.** If even the smallest intake breaks a limit, the card says so and why
  (usually that today's students and other programs already fill the seats). It never invents
  a number. Use the seat planner, or relax a limit.

**The chart and the table.** The chart shows the outcome at each tested intake with its
uncertainty band; the table gives the same numbers per intake: graduation rate, on-time rate,
average time to degree, graduates per year, losses from seat shortages (best estimate and a
cautious upper value), the share of seat denials that fall in Summer, the effect on students
already enrolled, and the course most short of seats. **Download CSV** saves the table, and
**Print** gives a clean copy for the committee.

**The calibration check.** If you entered historical outcomes or the enrolled headcount, the
tool compares its own results with them. A mismatch is flagged only when it is larger than
chance allows. If it is flagged, check the pass rates and dropout settings before relying on
the number.

---

## 6. Using the seat planner

Use it when you want to know what it would take to admit more than the card recommends.

1. Type the target intake, for example 120, and press the plan button.
2. Wait for the result (faster than a full analysis).
3. Read the list, for example "CMPS303: +1 section (+35 seats)", together with predicted
   graduation and on-time rates before and after, and whether your policy limits are then met.
4. If you agree, press **Apply to plan**. The seats on the Data page are updated.
5. Run the analysis again. The recommended intake should now be higher.

If the planner says the limits still fail after its search, it will not claim the target is
reachable; consider a lower target or relaxing a limit.

---

## 7. Other pages

- **Bottlenecks**: which courses limit the intake, and how many sections they need.
- **Walkthrough**: advance the department one semester at a time, changing seats, pass rates
  or the next intake between steps. Good for exploring "what if" ideas.
- **Advisor**: see section 10.
- **Programs**: Plans and Plan Builder, for keeping separate curricula and settings (for
  example a Computer Engineering plan later).
- **Methodology**: a plain explanation of how the number is produced.

---

## 8. When to re-run

Run the analysis again whenever:

- the class schedule changes (sections or section sizes);
- a new intake has entered, or the actual intake number is known (add it to Current students);
- pass rates or other-program seats are updated with better data;
- you change the policy limits;
- you are preparing a decision for the committee (so the "as of" date is current).

Past analyses are kept in a list at the bottom of the Intake Planner page. Each remembers the
exact inputs it used, and can be printed or exported to CSV for the committee.

---

## 9. What "illustrative" means

A result is marked **illustrative** when most of its inputs are still estimates: fewer than
half of the seats or pass rates are tagged QU data, or no real past intakes were entered. The
number shows how the tool works but should not drive a decision. As you replace estimates with
QU data and tag them, the badge disappears.

---

## 10. Using the Advisor

The Advisor page offers rule-based advice and an optional chat. The chat uses an AI model that
runs **on this PC** (the Qwen model `qwen3:4b-instruct-2507-q4_K_M` through Ollama, about 25 seconds per answer) by default, so nothing leaves the machine. A larger model such as `qwen3-coder:30b` gives better answers but needs a PC with about 32 GB of RAM (set `LLM_MODEL` in `.env`). If
Ollama is not running, the page says how to enable it; the rule-based advice still works.

Good questions: "Why 80?", "What would it take to admit 120?", "Which course is the problem?".

**The AI explains; it never decides.** The intake number always comes from the simulation. The
Advisor can suggest a change to test (for example one more section in a course). You can press
**Test** to see the predicted effect without changing anything, and **Apply** only after you
confirm. Under the chat box the site shows which model answered. Smaller local models can word
things badly, so check any figure against the recommendation card.
