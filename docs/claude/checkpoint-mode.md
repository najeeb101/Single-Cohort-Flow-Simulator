# Semester Checkpoint Mode

Reference split out of `CLAUDE.md`; read it when touching the Walkthrough page or any `/checkpoint` endpoint.

## Semester Checkpoint Mode ("advance one term at a time")

**The Walkthrough page (`/walkthrough`) IS this feature** (it used to be the dashboard home; the home page is now the Intake Planner). A
department head advances **one calendar term at a time — including optional Summer/Winter
terms, not just Fall/Spring** — and edits future-facing knobs (capacity, pass rate, occupancy,
next intake) between steps — never the courses already run. This is **not** a revival of the
old, removed Live Simulation feature (which was continuous-tick/replay-based over an
append-only edit log): a checkpoint session advances **only** on an explicit "Advance one
term" click, and it freezes/resumes real mid-run engine state rather than replaying from term 0
each time.

The walkthrough page shows the roadmap, headline results, per-cohort table and prerequisite
network, driven by the **checkpoint session's own partial run** instead of a single complete
`/simulate` call (see "Live-synced analytics"); its admissions section links to the latest intake analysis
instead of computing a recommendation. The full-horizon baseline simulation still runs in the
background (`SimulationProvider`, from the dashboard layout) purely so the Advisor and
Bottlenecks have data before any walkthrough starts.

- **Resumable engine** (`src/simulator.py`): both stepping methods share a private
  `_advance_one_calendar_term()` (admit any cohort due that term, run it, advance the cursor —
  returns the season processed). `Simulator.step_one_mandatory_term()` loops that until it hits
  a MANDATORY (Fall/Spring) term, sweeping through any intervening optional (Summer/Winter) term
  in the same call — this is what `run()` uses (`while not self.is_finished:
  self.step_one_mandatory_term()`, byte-identical to the old single-shot for-loop; the full test
  suite's many fixed-value assertions all still pass unchanged). **`Simulator.step_one_term()`**
  calls `_advance_one_calendar_term()` exactly once, mandatory or optional — this is what the
  Semester Checkpoint Mode session actually calls, so a department head can pause (and edit) at
  a Summer/Winter boundary too, not just Fall/Spring. Neither method changes
  `Student.personal_semester` semantics (still mandatory-terms-only, handled inside
  `_run_term`) — pausing more often never changes what happens inside any given term, only how
  finely a caller can stop between terms. `Simulator.snapshot()`/
  `from_snapshot(curriculum, config, scenario, blob)` pickle/restore the dynamic state (students,
  `History`, the resume cursor) so a session can pause after one request and resume in a
  **brand-new** `Simulator` instance on the next — curriculum/config/scenario are supplied fresh
  on restore, which is how a staged edit takes effect starting with the next step. `History`'s
  per-cohort counters use named module-level factory functions (`_int_defaultdict`/
  `_cohort_int_defaultdict`) instead of lambdas specifically so `History` stays picklable.
  Covered by `tests/test_checkpoint_engine.py`, most importantly a snapshot→restore→finish run
  producing byte-identical results to a straight-through run, and (for `step_one_term`) that
  stepping one calendar term at a time all the way to completion matches a straight `run()`
  exactly even with optional terms enabled.
- **Persistence** (`src/db_models.py::CheckpointSession`, `src/db.py::
  resolve_active_checkpoint_session`): one row per in-progress session, one active-or-completed
  session per user (mirrors `User.active_plan_id`). `working_curriculum` (plan-export shape,
  a list of course dicts) and `working_config` are a **frozen-at-creation copy** of the active
  plan's data, mutated only by `POST /checkpoint/edit` — never the plan's own `Course`/
  `AppConfig` rows, so a concurrent Settings/Plan edit can't reach into an in-progress session.
  `status` is `active | completed | discarded`; the resolver returns anything not `discarded`
  (so a `completed` session's final frames stay viewable until explicitly discarded, not 404).
- **API** (`src/api.py`, no `Run` row is ever written — this isn't the baseline `/simulate`
  path): `POST /checkpoint` starts one (404-then-create is the normal "no session yet" flow);
  `GET /checkpoint` reads the current state; `POST /checkpoint/edit` stages a whitelisted patch
  (`capacity`, `pass_rate`, `initial_state`, `cohort_size`, `admission_sizes` — there is
  deliberately no field for prerequisites/offering/category/admission_terms/num_cohorts/
  max_terms/seed, so there's no way to smuggle a structural or horizon-changing edit through it
  even by accident) validated through the same `plan_validation.py` guardrails as a persisted
  `PUT /curriculum`/`PUT /config`; `POST /checkpoint/advance` steps the session forward exactly
  one calendar term (`Simulator.step_one_term()` — mandatory or optional, see "Resumable engine"
  above); `DELETE /checkpoint` discards it. `GET /meta` reports
  `checkpoint_active`/`checkpoint_next_term`.
- **Go back to a previous term** (`src/db_models.py::CheckpointSnapshot`, `POST
  /checkpoint/rewind`): a second table holds one engine snapshot **per step** (`seq=0` at
  session creation, `seq=N` after the Nth successful advance) instead of the single
  overwritten blob `CheckpointSession.snapshot` still tracks as "the current/latest" (for the
  existing advance/edit code paths, unchanged). `_checkpoint_summary_from_sim` exposes this as
  `history: [{seq, next_term, label}]` (`label` is "Start" for `seq=0`, otherwise
  `term_label(next_term - 1, config)` — the season/year just completed, e.g. "Summer Y2" — so an
  optional-term step reads as distinctly as a mandatory one) and a top-level `next_term_label`
  (the *upcoming* term's season/year, `None` once finished) so the frontend never has to do its
  own season arithmetic. `POST /checkpoint/rewind {seq}` looks up that step's snapshot, **deletes
  every recorded step after it** (a linear undo, no branching/redo — advancing again after a
  rewind records a fresh forward path from there, overwriting what would have been the old
  future), restores the engine from that blob, and reactivates a `completed` session back to
  `active` if the target isn't the horizon's end. **Deliberately does NOT touch
  `working_curriculum`/`working_config`**: staged capacity/pass-rate/occupancy/intake edits
  survive a rewind and apply starting from the rewound point forward — that's what makes "go
  back, then try a different number from here" actually useful, and it matches the existing
  edits-are-always-forward-looking architecture. A session created *before* this feature shipped
  (or one that otherwise lost its `seq=0` row) self-heals on its next advance:
  `advance_checkpoint` back-fills the CURRENT pre-advance state as `seq=0` first if it finds zero
  recorded steps, rather than mislabeling "one step further along" as the start. `DELETE
  /checkpoint` and starting a new session both purge the old session's `CheckpointSnapshot` rows
  (`_purge_checkpoint_snapshots`) — they have no value once their session is gone. Covered by
  `tests/test_checkpoint_api.py` (rewind restores/truncates correctly, edits survive a rewind, a
  completed session reactivates, an out-of-range `seq` 422s, the backfill scenario, discard
  purges history).
- **Preview before committing** (`GET /checkpoint/peek/{seq}`): clicking a Term-history chip no
  longer rewinds immediately — it calls this read-only sibling of `POST /checkpoint/rewind`
  instead, which looks up the same `CheckpointSnapshot` row but **never mutates
  `CheckpointSession` or deletes anything**; it just returns a `_checkpoint_summary_from_sim`
  payload for that step (with `next_term`/`next_term_label`/`status` overridden to reflect the
  *peeked* point, since those three normally come from the live `row` this endpoint deliberately
  leaves untouched), plus a `viewed_seq` marker so the frontend knows it's a preview and not the
  live session. `CheckpointContext`'s `viewing` state holds this separately from `session` (the
  real, current state every other page still reads) — the Dashboard renders whichever the head is
  looking at, but "Edit term settings"/"Advance one term" are hidden while `viewing` is set, since
  those always act on the live session. Only the explicit **"Continue from here"** action (shown
  in place of Edit/Advance while previewing) calls the actual `POST /checkpoint/rewind` — same
  confirm dialog and truncation behavior as before, just moved one click later so "go back to look"
  and "go back and change something" are no longer the same action. Covered by
  `tests/test_checkpoint_api.py` (peek returns an earlier step's data without touching session
  status/`next_term`/history length; a peek doesn't affect a subsequent rewind's behavior).
- **Live-synced analytics**: `_checkpoint_summary_from_sim` includes a `flow_timeline` field —
  the *exact* `{meta, frames, summary}` shape `analytics.flow_timeline_payload` builds for a
  completed `/simulate` run, computed straight off the mid-run `Simulator` (`compute_metrics`/
  `compute_cohort_metrics` only ever read `.history`/
  `.config`/`.students`, all present on a `Simulator` whether it's finished or not — every ratio
  already guards its own zero-student/zero-graduate case).
  This lets the walkthrough's `HeadlineKpis`/`CohortsTable`/
  `PrerequisiteNetwork` (each wrapped in a `CollapsibleSection`, collapsed by default) and the
  Bottlenecks page's `BottlenecksPanel`/`CapacityRecommendations` read a checkpoint session
  exactly like they'd read the baseline's `flow_timeline` — always **explicitly framed as
  partial** (a note above the sections / a banner on Bottlenecks: "N terms run so far, not the
  full horizon"), since fewer terms run means less reliable numbers, especially before any
  cohort has finished. `CheckpointProvider` therefore lives at the **dashboard layout level**
  (`web/src/app/(dashboard)/layout.tsx`, nested inside `SimulationProvider`), not just on the
  Dashboard page, so Bottlenecks can reach it too; unlike `SimulationProvider` it does **not**
  block rendering while its initial `GET /checkpoint` resolves (`loading` is exposed for the one
  place — the Dashboard's own start/session branch — that needs to avoid flashing the wrong
  screen; every other page just falls back to the baseline until the near-instant fetch settles).
  **Seat plans also have a session-scoped variant**: `POST /intake-analyses` with `source: "checkpoint"`
  runs the analysis or seat plan against the session's `working_curriculum`/`working_config` (it replaced
  `POST /checkpoint/autofill`) — read-only; "Apply" routes through `POST /checkpoint/edit` instead of
  `PUT /curriculum`/`PUT /config`, so it takes effect on the next Advance rather than immediately. The seat
  planner and `CapacityRecommendations` pick whichever mode matches whether a checkpoint session is active.
  Covered by `tests/test_checkpoint_api.py::test_checkpoint_summary_carries_flow_timeline_shaped_data`.
- **Frontend** (`web/src/lib/CheckpointContext.tsx`,
  `web/src/app/(dashboard)/walkthrough/page.tsx`, `web/src/components/checkpoint/CheckpointEditPanel.tsx`):
  built like `SimulationContext` but **with no auto-run** — it starts idle until "Start checkpoint
  walkthrough" is clicked. A "Term history" chip strip (`TermHistoryStrip`, rendered
  once `session.history` has more than one entry) lists every recorded step by its `label` (from
  the API, e.g. "Start", "Fall Y1", "Summer Y2"); clicking an earlier chip confirms via
  `window.confirm` (same pattern as Discard) and calls `useCheckpoint().rewind(seq)` — the
  current step's chip is visually marked and disabled. The status bar's "Next up: …" line prefers
  `session.next_term_label` over the bare `next_term` number. The edit panel (`CheckpointEditPanel`, composed entirely from existing
  pieces — `InitialStateEditor` for occupancy, `CurriculumTable` for capacity/pass-rate/occupancy,
  a small custom next-intake control, no new form widgets) is no longer rendered inline: an "Edit
  term settings" button in the session's status bar opens it inside `web/src/components/Modal.tsx`
  (given a new `size="wide"` variant so a full `CurriculumTable` fits and scrolls inside the modal
  instead of overflowing it), and a successful save (`onSaved` callback) auto-closes the modal.
  `CurriculumTable` gained a `structuralEditsDisabled` prop: it hides Add/Delete and the structural
  edit-expansion row, since those call `updateCourse`/`createCourse`/`deleteCourse`
  (`PUT`/`POST`/`DELETE /curriculum`) against the **live plan**, not a checkpoint session's
  `working_curriculum` — only the deferred inline capacity/pass-rate/occupancy columns (already
  owned by the parent's `onChange`) stay available. `AdmissionsTab` was deliberately **not** reused
  for the intake control: its `BuilderState` coupling and `mode="simple"/"advanced"` split doesn't
  cleanly hide exactly `num_cohorts`/`max_terms`/`seed` while keeping `cohort_size`/
  `admission_sizes`/initial state, so a small purpose-built control was simpler and safer than
  forcing that fit.
