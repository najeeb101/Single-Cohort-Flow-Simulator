import type { Histogram } from "@/types/simulation";

const W = 360;
const H = 180;

// Faithful port of src/visualize.py::plot_graduation_histogram for the single scenario
// this dashboard runs (the static figure overlays multiple scenarios; here there's one).
export default function GraduationHistogram({ distribution }: { distribution: Histogram }) {
  if (!distribution.length) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-4 text-xs text-muted">
        No graduations recorded yet.
      </div>
    );
  }

  const minSem = distribution[0][0];
  const maxSem = distribution[distribution.length - 1][0];
  const span = Math.max(1, maxSem - minSem + 1);
  const maxCount = Math.max(...distribution.map(([, c]) => c));
  const barW = W / span;
  const cutoffX = (8.5 - minSem) * barW;

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3 text-[13px] font-semibold">
        <span>Time-to-graduate distribution</span>
        <span className="text-xs font-normal text-muted">semesters to graduate</span>
      </div>
      <svg viewBox={`0 0 ${W + 16} ${H + 24}`} className="w-full" style={{ maxHeight: 220 }}>
        <g transform="translate(8,4)">
          {distribution.map(([sem, count]) => {
            const x = (sem - minSem) * barW;
            const h = (count / maxCount) * H;
            return (
              <g key={sem}>
                <rect x={x + 2} y={H - h} width={Math.max(1, barW - 4)} height={h} fill="#6acc65" rx={2} />
                <text x={x + barW / 2} y={H + 14} fontSize={9} fill="#8b97ab" textAnchor="middle">{sem}</text>
                <text x={x + barW / 2} y={H - h - 4} fontSize={8} fill="#5d6878" textAnchor="middle">{count}</text>
              </g>
            );
          })}
          {cutoffX >= 0 && cutoffX <= W && (
            <line x1={cutoffX} x2={cutoffX} y1={0} y2={H} stroke="#e3725b" strokeDasharray="4 3" />
          )}
          <line x1={0} x2={W} y1={H} y2={H} stroke="rgba(255,255,255,0.14)" />
        </g>
      </svg>
      <div className="mt-1 text-xs text-muted">
        <i className="mr-1 inline-block h-2.5 w-2.5 align-[-1px]" style={{ borderTop: "2px dashed #e3725b" }} />
        on-time cutoff (≤8 sem)
      </div>
    </div>
  );
}
