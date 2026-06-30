# Design Improvements Plan

Five concrete changes, ordered by user impact. Each section covers the problem,
the exact files to touch, and what done looks like.

---

## 1. Move Bottlenecks to primary nav

**Problem**  
Bottlenecks is the most actionable page in the app — it identifies what's blocking students,
recommends section changes, and lets you test them. It's currently buried as one item in the
Analytics dropdown. A new user has no reason to click Analytics → Bottlenecks; they'll miss it.

**Files**
- `web/src/components/NavBar.tsx`

**Change**  
Move `{ href: "/bottlenecks", label: "Bottlenecks" }` from the `GROUPS[Analytics].links` array
into `PRIMARY_LINKS`, between Dashboard and Live. Remove it from the Analytics dropdown.

```
Before: Dashboard | Live | Analytics ▾ (Cohorts, Bottlenecks, Figures, Prerequisites) | Plans ▾ | Settings
After:  Dashboard | Bottlenecks | Live | Analytics ▾ (Cohorts, Figures, Prerequisites) | Plans ▾ | Settings
```

**Done when**  
Bottlenecks appears as a top-level nav tab. Analytics dropdown still exists with the remaining
three pages.

---

## 2. Merge Dashboard what-if into Bottlenecks

**Problem**  
The app has two separate tools that do the same thing:

- Dashboard → "Try a what-if" panel (cohort size + section bumps, shows KPI delta)
- Bottlenecks → "Test +1 section" button per course row (shows grad rate + seat delta)

A user has to discover both independently and learn two UIs for the same concept. The natural
home for "test a change" is Bottlenecks, where the problem is already identified.

**Files**
- `web/src/app/(dashboard)/page.tsx` — remove `WhatIfPanel`
- `web/src/app/(dashboard)/bottlenecks/page.tsx` — add expanded what-if
- `web/src/components/WhatIfPanel.tsx` — move conceptually; adapt so it also receives `baselineGradRate` and `baselineSeatsPerStud` from the bottlenecks page (already has these)
- `web/src/components/CapacityRecommendations.tsx` — remove the per-row Test button (now redundant once WhatIfPanel is on the same page)

**Change**  
Remove `<WhatIfPanel>` from the Dashboard entirely. Add it at the bottom of the Bottlenecks
page, below `<CapacityRecommendations>`. Remove the per-row "▶ Test +1 section" button from
`CapacityRecommendations` — the unified what-if panel above it already does this with more
control (any course, any amount, plus cohort size).

The Bottlenecks page flow becomes:
```
1. Four block-type cards   ← what's blocking students
2. Section recommendations ← which courses to fix and by how much (estimate)
3. What-if panel           ← test a combination of fixes, see actual impact
```

**Done when**  
There is one place in the app to test interventions. Dashboard no longer has a what-if section.
The Bottlenecks page ends with the what-if panel and a comparison table.

---

## 3. Fix roadmap light/dark contrast

**Problem**  
The programme roadmap SVG uses QU's official pastel colours (light blue, yellow, grey, etc.)
designed for a white background. The rest of the app uses a dark theme. The result is a
light-coloured SVG sitting on a dark surface card — jarring on every page that shows the roadmap
(Dashboard, pre-start screen, Live Simulation).

**Files**
- `web/src/components/CurriculumGraph.tsx`

**Change**  
Add `bg-white` to the viewport container div so the roadmap always renders on white regardless
of the app's theme. The colours are correct — only the container background is wrong.

```tsx
// Before
className="relative min-h-[300px] flex-1 overflow-auto p-2"

// After
className="relative min-h-[300px] flex-1 overflow-auto p-2 bg-white"
```

For a more complete fix (if dark-mode roadmap colours are wanted later): extract the fill/border
values in `graphLayout.ts::CATEGORY_STYLE` into CSS variables so they can respond to the
`theme-light` class on `<html>`. This is optional — the `bg-white` fix is sufficient for now.

**Done when**  
The roadmap always has a white background. No visual jarring when embedded in the dark dashboard
or live simulation page.

---

## 4. Add cohort summary to Live Simulation

**Problem**  
After advancing 5 terms in Live Simulation, you can only see the current term's per-course
snapshot. There's no aggregate "where is this cohort after 5 terms?" view — no running
graduation count, no dropout count, no comparison to the baseline run. The tool feels like
looking through a keyhole one frame at a time with no sense of the overall trajectory.

**Files**
- `web/src/components/live/LiveSimDetailView.tsx`
- `web/src/types/simulation.ts` — verify `TermSnapshot.summary` shape
- `src/api.py` — confirm the `summary` stored per-snapshot has enough fields (currently
  `{term, label, enrolled, graduated, dropped}`; may need to add `capacity_blocks`)

**Change**  
Add a "Running totals" bar between the history scrubber and the Curriculum status section.
It reads from `snapshots` (all terms up to the current one) and accumulates:

```
Graduated so far: 12  ·  Dropped: 3  ·  Still enrolled: 123  ·  Total capacity blocks: 847
```

For the current snapshot, also show it in context of the baseline run if available (e.g.,
"at this term in the baseline, 18 had graduated"). This requires threading the baseline
`flow_timeline.summary` into the Live page — feasible since `SimulationContext` already holds
it and the Live page could accept it as a prop or fetch it independently.

**Done when**  
The Live Simulation page shows running totals accumulating across all advanced terms. A user
advancing through 10 terms can see the cohort's trajectory without leaving the page.

---

## 5. Split SimulationContext into context + page

**Problem**  
`web/src/lib/SimulationContext.tsx` currently does three unrelated things:

1. Fetches `/meta` and manages load/error state
2. Renders the entire pre-start landing page (hero, research question, Start button, roadmap)
3. Provides the simulation context to all dashboard children

This means a 200-line file where a UI change to the landing page requires editing the context
file, and the context logic is buried inside JSX. It also makes the pre-start screen impossible
to test or reuse independently.

**Files**
- `web/src/lib/SimulationContext.tsx` — keep only the context logic
- `web/src/components/PreStartScreen.tsx` — new file, receives `meta`, `start`, `starting`, `startError` as props
- `web/src/app/(dashboard)/layout.tsx` — possibly: move the provider here if appropriate

**Change**  
Extract the entire `if (!data || !chartMeta)` return block into a standalone
`<PreStartScreen meta={meta} onStart={start} starting={starting} error={startError} />`
component. `SimulationContext.tsx` calls it and passes props; it doesn't know what the UI
looks like.

```tsx
// SimulationContext.tsx — after extraction
if (!data || !chartMeta) {
  return <PreStartScreen meta={meta} onStart={start} starting={starting} error={startError} />;
}
```

**Done when**  
`SimulationContext.tsx` contains only state, effects, and context wiring — no JSX beyond the
`<SimulationContext.Provider>` return. `PreStartScreen.tsx` is a self-contained component that
can be edited and understood without touching the context logic.

---

## Implementation order

```
1 → 3 → 5 → 2 → 4
```

Start with the two that are purely additive/no-risk (1 = one-line nav change, 3 = one CSS
class). Then the refactor that improves code quality without changing behaviour (5). Then the
feature consolidation that removes a redundant tool (2). Finally the Live Simulation enhancement
that adds new data (4), since it may need a small backend change to expose more summary fields.
```
