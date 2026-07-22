import type { CohortMetric } from "@/types/simulation";
import { pct } from "@/lib/format";

// Faithful port of frontend/app.js::renderCohortsTable().
export default function CohortsTable({ cohorts, showHeading = true }: { cohorts: CohortMetric[]; showHeading?: boolean }) {
  return (
    <section className={showHeading ? "py-6" : ""}>
      {showHeading && <h2 className="mb-1 text-[15px] font-bold">Per-cohort outcomes</h2>}
      <p className="mb-4 max-w-3xl text-sm text-muted">
        One row per cohort showing graduation rate, dropout rate, and average semesters to complete — plus the single course that blocked each cohort the most by seat denial, prerequisite, and failure. Cohorts that entered in busy years (when the university is already full) typically show lower graduation rates and higher seat-block counts than later cohorts.
      </p>
      <div className="overflow-auto rounded-2xl border border-border bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {["Cohort", "n", "Grad", "Dropout", "Censored", "Avg sem", "Top seat-block", "Top prereq-block", "Top fail"].map((h) => (
                <th key={h} className="sticky top-0 whitespace-nowrap border-b border-border bg-surface px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((c) => (
              <tr key={c.cohort_id} className={`group hover:bg-surface-2 transition-colors ${c.is_incumbent ? "italic text-muted" : "text-ink"}`}>
                <td className="whitespace-nowrap border-b border-border px-3 py-2.5">{c.is_incumbent ? "inc " : ""}{c.cohort_id}</td>
                <td className="whitespace-nowrap border-b border-border px-3 py-2.5">{c.n}</td>
                <td className="whitespace-nowrap border-b border-border px-3 py-2.5">{pct(c.graduation_rate)}</td>
                <td className="whitespace-nowrap border-b border-border px-3 py-2.5">{pct(c.academic_dropout_rate)}</td>
                <td className="whitespace-nowrap border-b border-border px-3 py-2.5">{pct(c.censored_rate)}</td>
                <td className="whitespace-nowrap border-b border-border px-3 py-2.5">{c.avg_time_to_degree.toFixed(1)}</td>
                <td className="whitespace-nowrap border-b border-border px-3 py-2.5">{c.top_capacity_block || "—"}</td>
                <td className="whitespace-nowrap border-b border-border px-3 py-2.5">{c.top_prereq_block || "—"}</td>
                <td className="whitespace-nowrap border-b border-border px-3 py-2.5">{c.top_fail || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
