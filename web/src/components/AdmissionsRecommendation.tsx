import type { AdmissionsRecommendation as Rec } from "@/types/simulation";
import { formatCriterionValue } from "@/lib/format";

// Faithful port of frontend/app.js::renderRecommendation().
export default function AdmissionsRecommendation({ rec, showHeading = true }: { rec: Rec; showHeading?: boolean }) {
  return (
    <section className={showHeading ? "py-6" : ""}>
      {showHeading && (
        <h2 className="mb-4 text-[15px] font-bold">
          Admissions recommendation <span className="text-xs font-normal text-muted">— heuristic, edit targets in Settings</span>
        </h2>
      )}
      <div className="rounded-2xl border border-border border-l-[4px] border-l-accent bg-surface px-6 py-5">
        {!rec.recommended_intake ? (
          <div className="py-6 text-center text-sm italic text-muted">No capacity recommendation available for this scenario.</div>
        ) : (
          <>
            <div className="text-2xl font-extrabold tracking-tight text-ink">
              Supported capacity: {rec.recommended_intake} students / year{" "}
              <span className="text-sm font-semibold text-muted">(current intake: {rec.current_intake})</span>
            </div>
            <div className="my-2 max-w-3xl text-sm text-muted">
              Binding criterion: <b className="text-ink">{rec.binding_criterion}</b> (slack {rec.binding_slack}). {rec.note}
            </div>
            <table className="max-w-2xl text-sm">
              <thead>
                <tr>
                  {["Health criterion", "Observed", "Target", "Slack"].map((h) => (
                    <th key={h} className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(rec.criteria ?? []).map((c) => (
                  <tr key={c.name} className="group border-b border-border transition-colors hover:bg-surface-2">
                    <td className="px-3 py-1.5">{c.name}</td>
                    <td className="px-3 py-1.5">{formatCriterionValue(c.name, c.observed)}</td>
                    <td className="px-3 py-1.5">{formatCriterionValue(c.name, c.target)}</td>
                    <td className="px-3 py-1.5">{typeof c.slack === "number" ? c.slack.toFixed(2) : c.slack}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </section>
  );
}
