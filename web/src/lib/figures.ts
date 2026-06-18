import type { CohortInfo, Frame } from "@/types/simulation";

// Pure data-transforms feeding the static-figure ports (src/visualize.py) — frames
// already carry everything these need (see src/simulator.py::_record_term_outputs),
// so this is reshaping, not new computation.

const ENROLLED_STAGES = ["Admitted", "Year1", "Year2", "Year3", "Year4"];

export interface EnrollmentSeries {
  terms: number[];
  enrolled: number[];
  graduated: number[];
  dropped: number[];
  censored: number[];
}

// Mirrors src/visualize.py::plot_university_enrollment's stackplot bands.
export function aggregateEnrollment(frames: Frame[]): EnrollmentSeries {
  const terms: number[] = [];
  const enrolled: number[] = [];
  const graduated: number[] = [];
  const dropped: number[] = [];
  const censored: number[] = [];
  for (const f of frames) {
    const nodes = f.stages.totals.nodes;
    terms.push(f.term);
    enrolled.push(ENROLLED_STAGES.reduce((s, k) => s + (nodes[k] || 0), 0));
    graduated.push(nodes["Graduated"] || 0);
    dropped.push(nodes["Dropped"] || 0);
    censored.push(nodes["Censored"] || 0);
  }
  return { terms, enrolled, graduated, dropped, censored };
}

export interface CohortSeries {
  id: number;
  isIncumbent: boolean;
  points: [term: number, active: number][];
}

// Mirrors src/visualize.py::plot_cohort_flow's per-cohort active head-count line.
export function cohortActiveSeries(frames: Frame[], cohorts: CohortInfo[]): CohortSeries[] {
  return cohorts.map((c) => {
    const points: [number, number][] = [];
    for (const f of frames) {
      const block = f.stages.cohorts[String(c.id)];
      if (!block) continue;
      const active = ENROLLED_STAGES.reduce((s, k) => s + (block.nodes[k] || 0), 0);
      points.push([f.term, active]);
    }
    return { id: c.id, isIncumbent: c.is_incumbent, points };
  });
}

// x: index position along `terms` (evenly spaced, since each frame is one consecutive
// term) -> pixel; y: value -> pixel, inverted (SVG y grows downward).
export function makeScales(terms: number[], maxY: number, width: number, height: number) {
  const n = Math.max(1, terms.length - 1);
  const x = (i: number) => (i / n) * width;
  const y = (v: number) => height - (maxY <= 0 ? 0 : (v / maxY) * height);
  return { x, y };
}

export interface UtilizationGrid {
  terms: number[];
  courses: string[];
  utilization: (course: string, term: number) => number | null; // null = not offered
}

// Mirrors src/visualize.py::plot_utilization_heatmap (course x term, granted/capacity).
export function buildUtilizationGrid(frames: Frame[]): UtilizationGrid {
  const terms = frames.map((f) => f.term);
  const courses = frames.length ? Object.keys(frames[0].courses).sort() : [];
  const byTerm = new Map(frames.map((f) => [f.term, f.courses]));
  return {
    terms,
    courses,
    utilization(course, term) {
      const stat = byTerm.get(term)?.[course];
      if (!stat || !stat.offered || !stat.capacity) return null;
      return stat.granted / stat.capacity;
    },
  };
}
