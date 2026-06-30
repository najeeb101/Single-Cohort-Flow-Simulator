"use client";

import { Fragment, useMemo } from "react";
import type { Frame } from "@/types/simulation";
import { buildUtilizationGrid } from "@/lib/figures";
import { utilColor } from "@/lib/graphLayout";

const CELL = 13;
const LABEL_W = 64;

// Faithful port of src/visualize.py::plot_utilization_heatmap — course x term grid,
// red = oversubscribed, dark = not offered that term.
export default function UtilizationHeatmap({ frames }: { frames: Frame[] }) {
  const grid = useMemo(() => buildUtilizationGrid(frames), [frames]);
  const { terms, courses } = grid;
  const tickEvery = Math.max(1, Math.ceil(terms.length / 20));

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px] font-semibold">
        <span>Seat utilization</span>
        <span className="text-xs font-normal text-muted">course × term · granted / capacity</span>
      </div>
      <p className="mb-3 text-[12px] text-muted">
        Each cell is one course in one term, coloured by how full its seats were (green = empty → red = oversubscribed). A red cell means students who needed that course were turned away that term. Persistent red across many terms on the same course points to a structural capacity shortfall — adding sections or increasing seats per section there would directly reduce student delays.
      </p>
      <div className="max-h-[60vh] overflow-auto rounded-lg border border-border">
        <div
          className="inline-grid"
          style={{
            gridTemplateColumns: `${LABEL_W}px repeat(${terms.length}, ${CELL}px)`,
            gridAutoRows: `${CELL}px`,
          }}
        >
          <div className="sticky left-0 top-0 z-20 bg-surface" />
          {terms.map((t, i) => (
            <div key={`h-${t}`} className="sticky top-0 z-10 bg-surface text-center text-[7px] leading-[13px] text-faint">
              {i % tickEvery === 0 ? t : ""}
            </div>
          ))}
          {courses.map((course) => (
            <Fragment key={course}>
              <div className="sticky left-0 z-10 truncate bg-surface pr-1 text-right text-[9px] leading-[13px] text-muted">
                {course}
              </div>
              {terms.map((t) => {
                const u = grid.utilization(course, t);
                return (
                  <div
                    key={`${course}-${t}`}
                    title={`${course} · t=${t}${u === null ? " · not offered" : ` · ${(u * 100).toFixed(0)}%`}`}
                    style={{ background: u === null ? "var(--surface-2)" : utilColor(u) }}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
