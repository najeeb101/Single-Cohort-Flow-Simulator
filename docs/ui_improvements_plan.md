# UI Refinement Plan — Dashboard Improvements

Last updated: 2026-07-10

Progress
- ✅ **#1 Initial-State onboarding + CSV import** — shipped (commit 475df07). Per-row status
  table (Accepted/Duplicate/Skipped-with-reason), duplicate detection, Download-sample-CSV,
  and Populate-demo-data. The CSV parser + skip-reasons and server-error surfacing already
  existed, so only these pieces were net-new. Verified end-to-end (11/11 UI checks).
- ✅ **#5 Student Trace signal pills + export** — shipped (commit ff87d3b). Introduced the
  shared `web/src/lib/signalMeta.ts` (labels/units/colours for the four signals — the source
  of truth #2 should reuse), labeled block pills with unit tooltips, explicit retake numbers,
  and JSON + printable-HTML export. Verified end-to-end (9/9 UI checks). Note: there is no
  `StudentTracePicker.tsx` — the picker is inline in `StudentTracePanel.tsx`.
- ✅ **#2 SignalLegend + per-signal toggles + Details in Bottlenecks** — shipped. New
  `web/src/components/SignalLegend.tsx` (pills double as filter toggles) + a per-course Details
  modal with a per-term mini bar chart and a signal-specific suggested fix (capacity reuses the
  peak-shortfall calc). Unified the whole app on the shared `signalMeta` colour scheme
  (red/amber/blue/green — offering moved from accent to `--info` to match the plan's cyan
  intent), so the legend, the four cards, the Details charts, and the Student Trace pills all
  agree. Verified end-to-end (11/11 UI checks; Trace re-verified 9/9). Scope note: the
  "filter timeline frames" idea was scoped to filtering the Bottlenecks cards (the actionable
  part); a global frame filter would cross-cut other components.
- ✅ **#4 CurriculumGraph usability** — shipped. New `web/src/components/CourseTooltip.tsx`
  (rich hover/focus tooltip that flips above near the bottom edge, replacing the native
  `<title>`), keyboard-focusable nodes (`role="button"` + aria-labels, Enter/Space opens the
  detail panel, visible focus ring, `role="group"` on the svg), and zoom controls (+/−/Fit +
  ctrl-wheel). The graph node has no `pass_rate` in the contract, so the tooltip shows live
  seat use instead. The "lazy-render >120 nodes" sub-item was deferred as YAGNI (curriculum is
  41 courses; it was explicitly a defensive idea). Verified end-to-end (10/10 UI checks).
- ⏳ #3, #6 — not started.

Purpose
- Collect the prioritized UI improvements discussed from the codebase docs and repository audit.
- For each improvement: describe exactly what to change, which files/components are involved, API considerations, acceptance criteria, and a minimal implementation checklist.

Scope and principles
- Keep data contracts unchanged: `GET /meta` and `POST /simulate` (the `flow_timeline` shape) remain canonical.
- Surface the four block signals separately and make their units and meaning explicit in the UI.
- Improve onboarding and discoverability for the `initial_state` CSV import.
- Make Bottlenecks what-if workflows clearer and safer (diff view + apply path).
- Prioritize accessibility, responsive behavior, and small, testable changes.

Prioritized improvements

1) Improve Initial-State onboarding and CSV import preview

- Why: first-run onboarding blocks access to the dashboard; CSV import is the fastest path but currently undocumented UX can confuse admins.
- Components to change: `web/src/components/InitialStateGate.tsx`, `web/src/components/InitialStateImportModal.tsx`, `web/src/components/InitialStateEditor.tsx` (if present), global styles `web/src/app/globals.css`.
- What to change (exact):
  - Add a two-column CSV preview table in `InitialStateImportModal.tsx` that shows: parsed `code`, parsed `value`, and a `status` column with one of {Accepted, Skipped: unknown code, Skipped: non-numeric, Duplicate}. Implement parsing on paste/upload before sending to the API.
  - Add a `Download sample CSV` button that downloads a 3-line example with a small realistic sample (Year2=10, CMPS151=5, CMPS303=0).
  - Add a `Populate demo data` one-click button that fills the editor with a small demo initial_state (non-zero occupancy for a few gateway courses and Year3 standing) without persisting — user can preview and then `Apply`.
  - On the modal `Apply` action, validate client-side and show an inline API error area that surfaces `PUT /config` validation errors from the server.
- API considerations: client-side only changes; `PUT /config` is still used to persist. No server change required.
- Acceptance criteria:
  - CSV import preview lists all parsed rows with reasons for skips.
  - Sample CSV can be downloaded and imported without errors.
  - Demo populate button fills the editor.

2) Make the four block signals explicit and actionable in Bottlenecks

- Why: docs stress the four signals must never be summed; users often misinterpret magnitudes.
- Components to change: `web/src/components/BottlenecksPanel.tsx`, `web/src/components/CapacityRecommendations.tsx`, shared Legend component if available or create `web/src/components/SignalLegend.tsx`.
- What to change (exact):
  - Add a compact `SignalLegend` with four colored pills and a one-line unit explanation each: `fail` (per-attempt events), `capacity` (seat-denials per term), `offering` (eligible students, per-term), `prereq` (eligible but waiting, per-term). Place legend next to the Bottlenecks title.
  - Add per-signal toggle checkboxes to filter the Bottlenecks list and the timeline frames (client-side filtering of `flow_timeline.frames`). Default: all on.
  - On each course row in the Bottlenecks table, add a `Details` button that opens a modal showing a small chart (sparkline or mini-bar) of the selected signal across terms (use the `frames` array and the course stats within each frame). Provide suggested fixes in the modal: e.g., for `capacity` show `Add section: estimated seats to remove X denied requests in peak term` (reuse the same calculation used by Auto-fill recommendations).
  - Add an explicit caption under the legend: "Do not compare raw counts across signals — each signal uses a different unit. Use the course detail to compare signals for the same course." (use smaller font, high contrast).
- API considerations: no backend changes; consume `flow_timeline.frames` already returned by `POST /simulate`.
- Acceptance criteria:
  - Legend is visible and accessible (keyboard focusable) and includes short unit text.
  - Toggling signals updates the displayed list and charts within the Bottlenecks panel.

3) Bottlenecks What‑If UX: side-by-side diff and apply flow

- Why: when users run a what-if change they need a clear diff and an easy, safe apply path.
- Components to change: `web/src/components/BottlenecksPanel.tsx`, `web/src/components/AutofillPanel.tsx`, `web/src/components/ScenarioDiffModal.tsx` (new), and `web/src/lib/api.ts` (where `POST /simulate` / `PUT /curriculum/{code}` calls are centralized).
- What to change (exact):
  - When the user runs a what-if (e.g., bump capacity on course X), compute both baseline `flow_timeline` and candidate `flow_timeline` (already done by current what-if call). Show a `ScenarioDiffModal` with two columns: left = baseline KPIs, right = candidate KPIs, and a middle column with deltas (e.g., graduation rate +2.1pp). Also show per-course top-3 signal deltas.
  - Add an `Apply changes` CTA in the modal that is disabled by default and becomes enabled after a short confirmation step: checkbox "I understand this will modify the active plan" then `Apply`. On `Apply` call the appropriate REST endpoints: for capacity changes call `PUT /curriculum/{code}` for each course changed; for config-level changes call `PUT /config`. Show per-item success/failure results and an aggregate toast summary.
  - Record the applied change as a new `Scenario` via `POST /scenarios` with `{name, overrides}` so it appears in the Plans/Scenarios list.
- API considerations: call `PUT /curriculum/{code}` and `PUT /config` for persisted changes; call `POST /scenarios` to save the override. Ensure `POST /simulate` remains read-only (what-if only until Apply).
- Acceptance criteria:
  - Scenario diff modal shows baseline, candidate, and delta rows for KPIs and top bottlenecks.
  - `Apply changes` persists the change and it's immediately visible when re-running `GET /meta` or a new `POST /simulate`.

4) CurriculumGraph usability improvements

- Why: roadmap graph is the primary visual; users need faster details and keyboard/zoom controls.
- Components to change: `web/src/components/CurriculumGraph.tsx`, `web/src/lib/graphLayout.ts` (if present), `web/src/components/CourseTooltip.tsx` (new small tooltip component), and global styles.
- What to change (exact):
  - Add hover tooltips that show `code`, `title`, `credits`, `pass_rate`, `capacity`, and `next_offering` for the node under cursor. Implement as a lightweight `CourseTooltip` component positioned near cursor.
  - Enable keyboard focus for selectable nodes: Tab focuses the next node, Enter opens the same detail modal as `Details` in Bottlenecks. Ensure ARIA roles for graph region and nodes.
  - Add visible zoom controls (+ / − / Fit) in the graph header and support scroll-wheel zooming with inertia disabled for accessibility.
  - Lazy-render long layouts: if the graph has > 120 nodes or edges, render a simplified static SVG until the user toggles "Detailed view" to avoid initial performance jank (the curriculum is 41 courses so this is a defensive change).
- API considerations: none.
- Acceptance criteria:
  - Tooltips display correct values from `GET /meta` and `flow_timeline.frames[0].course_stats` if present.
  - Keyboard navigation cycles nodes and is accessible to screen readers.

5) Student Trace: clearer blocked signal labels and export

- Why: trace consumers want the exact cause (capacity/offering/prereq) clearly visible and trace exportable for meeting notes.
- Components to change: `web/src/components/StudentTracePanel.tsx` and the trace candidate picker `web/src/components/StudentTracePicker.tsx`.
- What to change (exact):
  - In the per-term trace rows, render the blocked signal as a labeled pill with color and tooltip explaining the unit (matching `SignalLegend`). For failed courses, show attempt no. and whether this was a retake.
  - Add an `Export trace` button to download the selected student's trace as JSON and as a printable PDF-friendly HTML page.
- API considerations: uses `POST /simulate/students/{id}/trace` — no backend changes.
- Acceptance criteria:
  - Exported JSON matches the JSON returned by the trace API.
  - Trace UI uses same signal colors and legends as Bottlenecks.

6) Accessibility, responsive layout, and contrast fixes (low-effort, high-impact)

- Why: many stakeholders will use the dashboard; these are basic accessibility wins.
- Files to change: `web/src/app/globals.css`, components above to add aria attributes and keyboard handlers.
- What to change (exact):
  - Ensure color contrast ratio ≥ 4.5:1 for all text against background on KPIs and legend bullets.
  - Add `aria-label`/`role` attributes for interactive controls (Apply, Download sample CSV, Details buttons, Toggles) and ensure keyboard focus styles are visible (outline: 3px solid accent color).
  - Implement mobile stacking for KPI bar and Bottlenecks list: single-column on widths < 720px.
- Acceptance criteria: basic Lighthouse accessibility score improvement locally; keyboard-only navigation can open main modals.

Developer tasks & implementation checklist

For each improvement above follow these common steps:

1. Branch
  - Create a short-lived feature branch: `feat/ui-improvements/initialstate-preview` (one branch per grouped improvement or combine small ones).
2. Code edits
  - Update the component(s) listed. Keep changes small and self-contained. Add new small components under `web/src/components/` (e.g., `SignalLegend.tsx`, `ScenarioDiffModal.tsx`, `CourseTooltip.tsx`).
3. Styling
  - Add or reuse tokens in `web/src/app/globals.css`. Prefer simple utility classes and avoid heavy CSS frameworks.
4. Tests
  - Add component tests (React Testing Library) for CSV parser preview, Bottlenecks signal toggles, and Apply flow. Put tests under `web/__tests__/` or `web/src/__tests__/` depending on project config. If repo has no JS test infra, add a short note in the PR describing manual verification steps.
5. Manual verification
  - Run the backend: `py -m uvicorn src.api:app --reload --port 8001`
  - Run the frontend: `cd web && npm install && npm run dev`
  - Verify initial-state CSV import preview, Bottlenecks legend, and what‑if diff modal.

Exact run commands for local testing (copy-paste)

```bash
# from repo root (Windows)
py -m pip install -r requirements.txt
py -m uvicorn src.api:app --reload --port 8001
cd web
npm install
npm run dev
```

Notes on scope & rollout
- Make one user-visible change at a time and ship as small PRs with screenshots.
- Start with the Initial-State CSV preview + sample CSV (high impact, small change) — this is the recommended first PR.
- If you'd like, I can implement the Initial-State CSV preview change now and open the patch.

Design references and assets
- Suggested colors for signals (ensure contrast):
  - fail: #d9534f (red)
  - capacity: #f0ad4e (orange)
  - offering: #5bc0de (cyan)
  - prereq: #5cb85c (green)

Appendix: mapping to files (quick)
- Initial-state onboarding: `web/src/components/InitialStateGate.tsx`, `web/src/components/InitialStateImportModal.tsx`
- Bottlenecks and legend: `web/src/components/BottlenecksPanel.tsx`, `web/src/components/SignalLegend.tsx`, `web/src/components/CapacityRecommendations.tsx`
- What-if diff modal / apply: `web/src/components/ScenarioDiffModal.tsx` (new), `web/src/lib/api.ts`
- Curriculum graph improvements: `web/src/components/CurriculumGraph.tsx`, `web/src/components/CourseTooltip.tsx` (new)
- Student trace export and labels: `web/src/components/StudentTracePanel.tsx`, `web/src/components/StudentTracePicker.tsx`

If you want I can now implement improvement #1 (Initial-State CSV preview + sample CSV + demo populate) and open a patch. Which improvement shall I implement first? 
