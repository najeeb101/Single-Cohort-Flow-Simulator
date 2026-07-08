import type { Graph, GraphNode } from "@/types/simulation";

// Faithful port of frontend/app.js::buildGraph()'s layering math + utilColor(). Pure,
// no DOM — called from a useMemo keyed on the (frozen, see page.tsx) `graph` reference,
// so it only runs once per page load, never on a live what-if update.

export interface NodePos {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GraphLayout {
  positions: Record<string, NodePos>;
  width: number;
  height: number;
}

const NW = 132;
const NH = 48;
const HGAP = 70;
const VGAP = 16;
const MX = 24;
const MY = 24;

export function computeLayout(graph: Graph): GraphLayout {
  const prereqs: Record<string, string[]> = {};
  graph.nodes.forEach((n) => (prereqs[n.code] = []));
  graph.edges.forEach((e) => {
    if (prereqs[e.to]) prereqs[e.to].push(e.from);
  });

  const layerCache: Record<string, number> = {};
  function layer(code: string, seen: Set<string>): number {
    if (code in layerCache) return layerCache[code];
    if (seen.has(code)) return 0;
    seen.add(code);
    const ps = prereqs[code] || [];
    const l = ps.length ? 1 + Math.max(...ps.map((p) => layer(p, seen))) : 0;
    layerCache[code] = l;
    return l;
  }
  graph.nodes.forEach((n) => layer(n.code, new Set()));

  const byLayer: Record<number, Graph["nodes"]> = {};
  graph.nodes.forEach((n) => {
    (byLayer[layerCache[n.code]] ??= []).push(n);
  });
  const layers = Object.keys(byLayer).map(Number).sort((a, b) => a - b);

  let maxRows = 0;
  layers.forEach((l) => {
    byLayer[l].sort((a, b) => a.study_plan_order - b.study_plan_order || a.code.localeCompare(b.code));
    maxRows = Math.max(maxRows, byLayer[l].length);
  });
  const width = MX * 2 + layers.length * NW + (layers.length - 1) * HGAP;
  const height = MY * 2 + maxRows * NH + (maxRows - 1) * VGAP;

  const positions: Record<string, NodePos> = {};
  layers.forEach((l, ci) => {
    const col = byLayer[l];
    const colH = col.length * NH + (col.length - 1) * VGAP;
    const y0 = MY + (height - MY * 2 - colH) / 2;
    col.forEach((n, ri) => {
      positions[n.code] = { x: MX + ci * (NW + HGAP), y: y0 + ri * (NH + VGAP), w: NW, h: NH };
    });
  });

  return { positions, width, height };
}

// ── Roadmap layout (university program-roadmap style) ─────────────────────────
// Columns = recommended semester (GraphNode.study_plan_term, 1..N): term 1 = Year 1 Fall,
// term 2 = Year 1 Spring, term 3 = Year 2 Fall, … so columns group two-per-year under a
// "Year N" band with Fall/Spring + credit-hour sub-labels, in a standard university
// program-roadmap layout. study_plan_term === 0 (unassigned) collects into a trailing
// "Unscheduled" column. If a plan has NO assigned terms at all, we fall back to prerequisite
// depth so the chart still spreads into columns instead of collapsing into one.

// Requirement-type styling for course boxes + the legend, keyed by Course.category. Different
// plans (different departments) use different category taxonomies, so this isn't a closed
// enum: the default QU CS plan's categories get their familiar named colours below, and any
// other category string gets a distinct colour deterministically generated from its name (via
// GENERATED_STYLES) rather than collapsing into one generic "Other" bucket. Light fills with
// dark text, roadmap-style.
export interface CategoryStyle {
  label: string;
  fill: string;
  border: string;
  text: string;
}

export const CATEGORY_STYLE: Record<string, CategoryStyle> = {
  cs_core: { label: "Major Core", fill: "var(--cs-core-fill)", border: "var(--cs-core-border)", text: "var(--cs-core-text)" },
  cs_elective: { label: "Major Elective", fill: "var(--cs-elective-fill)", border: "var(--cs-elective-border)", text: "var(--cs-elective-text)" },
  math: { label: "College Requirement", fill: "var(--math-fill)", border: "var(--math-border)", text: "var(--math-text)" },
  college_req: { label: "College Requirement", fill: "var(--math-fill)", border: "var(--math-border)", text: "var(--math-text)" },
  science: { label: "Major Supporting", fill: "var(--science-fill)", border: "var(--science-border)", text: "var(--science-text)" },
  english: { label: "Core Curriculum", fill: "var(--english-fill)", border: "var(--english-border)", text: "var(--english-text)" },
  gen_ed: { label: "Core Curriculum", fill: "var(--english-fill)", border: "var(--english-border)", text: "var(--english-text)" },
};

// Extra palette for categories outside the known set above, so an unrecognized category still
// gets a distinct, readable colour instead of a flat gray "Other". Reuses the same CSS custom
// properties the known categories use (defined per-theme in globals.css) rather than introducing
// new hardcoded hex values.
const GENERATED_STYLES: Omit<CategoryStyle, "label">[] = [
  { fill: "var(--cs-core-fill)", border: "var(--cs-core-border)", text: "var(--cs-core-text)" },
  { fill: "var(--cs-elective-fill)", border: "var(--cs-elective-border)", text: "var(--cs-elective-text)" },
  { fill: "var(--math-fill)", border: "var(--math-border)", text: "var(--math-text)" },
  { fill: "var(--science-fill)", border: "var(--science-border)", text: "var(--science-text)" },
  { fill: "var(--english-fill)", border: "var(--english-border)", text: "var(--english-text)" },
];

const FALLBACK_STYLE: CategoryStyle = { label: "Other", fill: "var(--border-2)", border: "var(--border)", text: "var(--ink)" };

function prettifyCategory(category: string): string {
  return category
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function categoryStyle(category: string): CategoryStyle {
  if (CATEGORY_STYLE[category]) return CATEGORY_STYLE[category];
  if (!category) return FALLBACK_STYLE;
  const picked = GENERATED_STYLES[hashString(category) % GENERATED_STYLES.length];
  return { ...picked, label: prettifyCategory(category) };
}

// Per-plan style assignment for every distinct category actually present in `nodes`. Unlike
// categoryStyle()'s standalone hash (which can collide once you look at only one category at a
// time), this hands out GENERATED_STYLES slots in first-seen order — so up to 5 distinct
// unrecognized categories in the same plan are guaranteed visually distinct instead of a couple
// of them coincidentally landing on the same hash bucket. Only wraps (and can collide) past 5.
export function categoryStyleMap(nodes: GraphNode[]): Map<string, CategoryStyle> {
  const map = new Map<string, CategoryStyle>();
  let genIdx = 0;
  for (const node of nodes) {
    const category = node.category;
    if (map.has(category)) continue;
    if (CATEGORY_STYLE[category]) {
      map.set(category, CATEGORY_STYLE[category]);
    } else if (!category) {
      map.set(category, FALLBACK_STYLE);
    } else {
      map.set(category, { ...GENERATED_STYLES[genIdx % GENERATED_STYLES.length], label: prettifyCategory(category) });
      genIdx++;
    }
  }
  return map;
}

// Legend entries for every distinct category present in `nodes`, in first-seen order,
// de-duplicated by label (so e.g. math+science sharing a label collapse to one entry).
export function categoryLegend(nodes: GraphNode[]): CategoryStyle[] {
  const map = categoryStyleMap(nodes);
  const seen = new Set<string>();
  const out: CategoryStyle[] = [];
  for (const node of nodes) {
    const s = map.get(node.category)!;
    if (!seen.has(s.label)) {
      seen.add(s.label);
      out.push(s);
    }
  }
  return out;
}

export interface RoadmapColumn {
  term: number; // 0 = unscheduled
  year: number; // 0 for unscheduled
  season: string; // "Fall" | "Spring" | ""
  creditHours: number;
  x: number; // left edge
  cx: number; // center x
}

export interface YearBand {
  year: number;
  label: string;
  x: number; // left edge of the band
  width: number;
  cx: number;
}

export interface SemesterLayout extends GraphLayout {
  columns: RoadmapColumn[];
  yearBands: YearBand[];
  headerH: number;
  colWidth: number;
}

const RM_NW = 172;
const RM_NH = 60;
const RM_HGAP = 54;
const RM_VGAP = 14;
const YEAR_BAND_H = 22;
const SEASON_H = 22;
const HEADER_H = YEAR_BAND_H + SEASON_H + 8;

// Effective term per course: the assigned study_plan_term when present. If a plan has NO
// assigned terms at all (e.g. a custom plan, or a server that predates the field), derive a
// *balanced*, prerequisite-respecting schedule so the roadmap still reads like a roadmap
// instead of dumping every no-prerequisite course into one giant Year-1 column. Each course
// lands no earlier than 1 + its deepest prerequisite, packed into terms with a soft per-term
// cap (≈ total / 8 columns).
function effectiveTerms(graph: Graph): Record<string, number> {
  const hasAny = graph.nodes.some((n) => (n.study_plan_term ?? 0) > 0);
  const out: Record<string, number> = {};
  if (hasAny) {
    graph.nodes.forEach((n) => (out[n.code] = (n.study_plan_term ?? 0) > 0 ? n.study_plan_term : 0));
    return out;
  }

  const prereqs: Record<string, string[]> = {};
  graph.nodes.forEach((n) => (prereqs[n.code] = []));
  graph.edges.forEach((e) => {
    if (prereqs[e.to]) prereqs[e.to].push(e.from);
  });
  const depthCache: Record<string, number> = {};
  const depth = (code: string, seen: Set<string>): number => {
    if (code in depthCache) return depthCache[code];
    if (seen.has(code)) return 1;
    seen.add(code);
    const ps = prereqs[code] || [];
    const d = ps.length ? 1 + Math.max(...ps.map((p) => depth(p, seen))) : 1;
    depthCache[code] = d;
    return d;
  };

  const cap = Math.max(4, Math.ceil(graph.nodes.length / 8));
  const counts: Record<number, number> = {};
  const ordered = [...graph.nodes].sort(
    (a, b) =>
      depth(a.code, new Set()) - depth(b.code, new Set()) ||
      a.study_plan_order - b.study_plan_order ||
      a.code.localeCompare(b.code),
  );
  for (const n of ordered) {
    let t = depth(n.code, new Set());
    while ((counts[t] || 0) >= cap) t++; // push overflow to a later term (still ≥ prereq depth)
    counts[t] = (counts[t] || 0) + 1;
    out[n.code] = t;
  }
  return out;
}

export function computeSemesterLayout(graph: Graph): SemesterLayout {
  const termOf = effectiveTerms(graph);
  const byTerm = new Map<number, Graph["nodes"]>();
  graph.nodes.forEach((n) => {
    const t = termOf[n.code] ?? 0;
    (byTerm.get(t) ?? byTerm.set(t, []).get(t)!).push(n);
  });

  // Scheduled terms ascending, then the unscheduled (0) bucket last if present.
  const terms = [...byTerm.keys()].filter((t) => t > 0).sort((a, b) => a - b);
  if (byTerm.has(0)) terms.push(0);

  let maxRows = 0;
  terms.forEach((t) => {
    byTerm.get(t)!.sort((a, b) => a.study_plan_order - b.study_plan_order || a.code.localeCompare(b.code));
    maxRows = Math.max(maxRows, byTerm.get(t)!.length);
  });

  const ncols = terms.length;
  const width = MX * 2 + ncols * RM_NW + Math.max(0, ncols - 1) * RM_HGAP;
  const height = MY * 2 + HEADER_H + maxRows * RM_NH + Math.max(0, maxRows - 1) * RM_VGAP;

  const positions: Record<string, NodePos> = {};
  const columns: RoadmapColumn[] = [];
  terms.forEach((t, ci) => {
    const x = MX + ci * (RM_NW + RM_HGAP);
    const nodes = byTerm.get(t)!;
    const creditHours = nodes.reduce((s, n) => s + (n.credits || 0), 0);
    const year = t > 0 ? Math.ceil(t / 2) : 0;
    const season = t > 0 ? (t % 2 === 1 ? "Fall" : "Spring") : "";
    columns.push({ term: t, year, season, creditHours, x, cx: x + RM_NW / 2 });
    nodes.forEach((n, ri) => {
      positions[n.code] = { x, y: MY + HEADER_H + ri * (RM_NH + RM_VGAP), w: RM_NW, h: RM_NH };
    });
  });

  // Year bands span all consecutive columns sharing a year (the unscheduled column, year 0,
  // gets no band).
  const yearBands: YearBand[] = [];
  const yearCols = new Map<number, RoadmapColumn[]>();
  columns.forEach((c) => {
    if (c.year > 0) (yearCols.get(c.year) ?? yearCols.set(c.year, []).get(c.year)!).push(c);
  });
  [...yearCols.keys()].sort((a, b) => a - b).forEach((year) => {
    const cols = yearCols.get(year)!;
    const left = Math.min(...cols.map((c) => c.x));
    const right = Math.max(...cols.map((c) => c.x + RM_NW));
    yearBands.push({ year, label: `Year ${year}`, x: left, width: right - left, cx: (left + right) / 2 });
  });

  return { positions, width, height, columns, yearBands, headerH: HEADER_H, colWidth: RM_NW };
}

export function utilColor(u: number): string {
  if (u <= 0) return "#9fd89f";
  if (u >= 1) return "#e2553b";
  const stops: [number, [number, number, number]][] = [
    [0, [159, 216, 159]],
    [0.6, [242, 193, 78]],
    [1, [226, 85, 59]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (u <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (u - t0) / (t1 - t0);
      const c = c0.map((v, k) => Math.round(v + f * (c1[k] - v)));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return "#e2553b";
}
