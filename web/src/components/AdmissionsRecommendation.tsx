import type { AdmissionsRecommendation as Rec } from "@/types/simulation";

// Faithful port of frontend/app.js::renderRecommendation().
export default function AdmissionsRecommendation({ rec }: { rec: Rec }) {
  return (
    <section className="py-6">
      <h2 className="mb-4 text-[15px] font-bold">
        Admissions recommendation <span className="text-xs font-normal text-muted">— heuristic, edit targets in Settings</span>
      </h2>
      <div className="rounded-2xl border border-border border-l-[3px] border-l-good bg-surface px-5.5 py-4.5">
        {!rec.recommended_intake ? (
          <span className="text-xs text-muted">No recommendation.</span>
        ) : (
          <>
            <div className="text-[25px] font-extrabold tracking-tight text-good">
              Admit {rec.recommended_intake} students / year{" "}
              <span className="text-sm font-semibold text-muted">(current {rec.current_intake})</span>
            </div>
            <div className="my-2 max-w-3xl text-[12.5px] text-muted">
              Binding criterion: <b className="text-ink">{rec.binding_criterion}</b> (slack {rec.binding_slack}). {rec.note}
            </div>
            <table className="max-w-2xl text-[12.5px]">
              <thead>
                <tr>
                  {["Health criterion", "Observed", "Target", "Slack"].map((h) => (
                    <th key={h} className="px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(rec.criteria ?? []).map((c) => (
                  <tr key={c.name} className="border-b border-border">
                    <td className="px-3 py-1.5">{c.name}</td>
                    <td className="px-3 py-1.5">{c.observed}</td>
                    <td className="px-3 py-1.5">{c.target}</td>
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
