import type { Graph } from "@/types/simulation";

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
