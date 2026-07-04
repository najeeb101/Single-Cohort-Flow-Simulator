# INTERNSHIP PROGRESS REPORT (Form 2-2)

*(To Be Filed at the Completion of 1/2 of the Internship Period)*

## INTERN'S STATEMENT

**Intern's Name:** Najeeb Abdi

### 1. Describe what you did during this period.

This period was spent building a discrete-term, agent-based simulation of Qatar University's
Computer Science curriculum, modeling how students move through prerequisite chains,
registration priority, and course capacity over up to 12 semesters, with the goal of identifying
which bottlenecks cause delay or non-completion.

**Week 1: Core Simulation Engine**
I set up the project and built the core Python simulation engine from scratch: a discrete-term
loop that advances student agents through registration, seat allocation, and pass/fail outcomes
each semester. I implemented a multi-cohort model where a new cohort is admitted every year and
all cohorts compete for one shared pool of course seats, plus GPA-driven dropout logic and
capacity-bottleneck tracking for the CS core sequence. I also wrote the initial documentation
(technical design doc and README) describing the model's assumptions.

**Week 2: Full-Stack Dashboard**
I moved from a script-only engine to a full product. I built a FastAPI backend on top of the
simulation engine, added a database layer (SQLAlchemy/SQLite) with JWT authentication, and built
a Next.js/React frontend dashboard. On the frontend, I built an animated curriculum graph that
plays back the simulation term by term, ported the existing static analytics figures into
React/SVG components, and added a prerequisite-network diagram. I then added a Scenario Builder
for running what-if experiments, a Plan Builder wizard for creating alternate curricula from
scratch, a Settings page with full CRUD on courses/instructors, a capacity-planning module that
checks both seat and instructor staffing feasibility, a light/dark theme with a visual design
pass, and a deployment configuration for hosting the app on Render.

**Week 3: Live Simulation + Scope Simplification**
I added a "Live Simulation" mode that runs one semester at a time instead of the whole window at
once, so an admin can review a term's results, adjust capacity/policy knobs, and manually advance
to the next term, closer to how a real academic-planning workflow works. I then did a
significant simplification pass: after reviewing what was actually load-bearing for the research
question, I removed authentication, the Scenario Builder, the Capacity Planning page, and the
instructor-staffing model to cut down the product to its core value, and added an inline
"what-if" panel plus capacity-section recommendations directly on the main dashboard.

**Week 4: UI Refactor**
I refactored the dashboard's navigation and component structure: extracting a dedicated
pre-start screen, moving the what-if panel into the Bottlenecks page, promoting Bottlenecks to
primary navigation, and adding live running totals to the in-progress simulation view, based on
usability issues I noticed while using the tool myself.

### 2. Describe what you learned during this period.

I learned how to design and build a complete simulation product end-to-end, from the modeling
logic (agent-based simulation, prerequisite/eligibility rule evaluation, seat-allocation policy)
through a REST API layer to an animated frontend dashboard. On the backend side, I learned how to
structure a FastAPI service with a proper database layer, authentication, and a clean separation
between the simulation engine and file I/O so the same engine could be called from both a CLI
script and an API. On the frontend side, I learned how to build animated, data-driven
visualizations in React/SVG and how to lay out a dashboard so a non-technical user (an
academic-planning admin) could actually make sense of the output.

I also learned a project-management lesson I didn't expect going in: after building out a
feature-rich version of the tool (auth, multi-plan support, capacity planning, instructor
modeling), I realized a lot of that complexity wasn't serving the core research question, and I
learned to make the call to strip it back down rather than keep adding features. That
simplification pass was one of the most useful things I did this period; it taught me to keep
re-asking what the tool is actually for, instead of just accumulating functionality.

Working mostly independently on a long-running codebase also pushed me to get better at reading
my own prior design decisions back (via documentation I'd written myself) and staying consistent
with them as the project grew, which is a different skill than writing code for a one-off
assignment.

**Intern's Name:** Najeeb Abdi &nbsp;&nbsp;&nbsp;&nbsp; **Date:** 04/07/2026

---

## EMPLOYER'S STATEMENT

*Please comment on the intern's work during this period.*

&nbsp;

&nbsp;

&nbsp;

**Industrial Supervisor's Signature:** _______________________ &nbsp;&nbsp;&nbsp;&nbsp; **Date:** _______________
