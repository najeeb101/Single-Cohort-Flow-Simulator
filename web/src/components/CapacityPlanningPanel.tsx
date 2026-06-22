import type { CapacityPlanning, CapacityStatus, SeatUtilizationRow } from "@/types/simulation";

const STATUS_BORDER: Record<CapacityStatus, string> = {
  ok: "border-l-good",
  tight: "border-l-warn",
  shortfall: "border-l-bad",
};

const STATUS_TEXT: Record<CapacityStatus, string> = {
  ok: "text-good",
  tight: "text-warn",
  shortfall: "text-bad",
};

function seatUtilizationSummary(rows: SeatUtilizationRow[]) {
  const byCourse = new Map<string, SeatUtilizationRow[]>();
  for (const row of rows) {
    byCourse.set(row.course, [...(byCourse.get(row.course) ?? []), row]);
  }
  return Array.from(byCourse.entries())
    .map(([course, courseRows]) => {
      const peakUtilization = Math.max(...courseRows.map((r) => r.utilization));
      const oversubscribedTerms = courseRows.filter((r) => r.status === "oversubscribed").length;
      const totalDenied = courseRows.reduce((sum, r) => sum + r.denied, 0);
      return { course, peakUtilization, oversubscribedTerms, totalDenied };
    })
    .filter((r) => r.totalDenied > 0)
    .sort((a, b) => b.totalDenied - a.totalDenied)
    .slice(0, 8);
}

export default function CapacityPlanningPanel({ capacityPlanning }: { capacityPlanning: CapacityPlanning }) {
  const { seat_utilization, instructor_capacity } = capacityPlanning;
  const seatRisks = seatUtilizationSummary(seat_utilization);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="mb-3 text-[13px] font-bold">Instructor capacity by category</h3>
        <div className="overflow-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {["Category", "Peak sections needed", "Typical sections needed", "Instructor capacity", "Qualified headcount", "Shortfall", "Status"].map((h) => (
                  <th key={h} className="border-b border-border bg-surface px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {instructor_capacity.by_category.map((row) => (
                <tr key={row.category} className={`border-l-[3px] ${STATUS_BORDER[row.status]}`}>
                  <td className="border-b border-border px-3 py-2 font-semibold">{row.category}</td>
                  <td className="border-b border-border px-3 py-2">{row.peak_sections_needed}</td>
                  <td className="border-b border-border px-3 py-2 text-muted">{row.representative_sections_needed}</td>
                  <td className="border-b border-border px-3 py-2">{row.instructor_capacity}</td>
                  <td className="border-b border-border px-3 py-2 text-muted">{row.qualified_headcount}</td>
                  <td className="border-b border-border px-3 py-2">{row.shortfall > 0 ? row.shortfall : "—"}</td>
                  <td className={`border-b border-border px-3 py-2 font-semibold ${STATUS_TEXT[row.status]}`}>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted">{instructor_capacity.note}</p>
      </section>

      <section>
        <h3 className="mb-3 text-[13px] font-bold">Course staffing risks</h3>
        {instructor_capacity.course_staffing_risks.length === 0 ? (
          <p className="text-[12.5px] text-muted">No courses are in an at-risk (tight/shortfall) category.</p>
        ) : (
          <div className="overflow-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {["Course", "Category", "Peak sections / term", "Category status", "Top driver"].map((h) => (
                    <th key={h} className="border-b border-border bg-surface px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {instructor_capacity.course_staffing_risks.map((risk) => (
                  <tr key={risk.course}>
                    <td className="border-b border-border px-3 py-2 font-semibold">{risk.course}</td>
                    <td className="border-b border-border px-3 py-2 text-muted">{risk.category}</td>
                    <td className="border-b border-border px-3 py-2">{risk.peak_sections}</td>
                    <td className={`border-b border-border px-3 py-2 font-semibold ${STATUS_TEXT[risk.category_status]}`}>{risk.category_status}</td>
                    <td className="border-b border-border px-3 py-2">{risk.top_driver ? "★ biggest driver" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-[13px] font-bold">Seats: most-denied courses</h3>
        {seatRisks.length === 0 ? (
          <p className="text-[12.5px] text-muted">No course denied seats over this run.</p>
        ) : (
          <div className="overflow-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {["Course", "Peak utilization", "Oversubscribed terms", "Total seats denied"].map((h) => (
                    <th key={h} className="border-b border-border bg-surface px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {seatRisks.map((r) => (
                  <tr key={r.course}>
                    <td className="border-b border-border px-3 py-2 font-semibold">{r.course}</td>
                    <td className="border-b border-border px-3 py-2">{(r.peakUtilization * 100).toFixed(0)}%</td>
                    <td className="border-b border-border px-3 py-2 text-muted">{r.oversubscribedTerms}</td>
                    <td className="border-b border-border px-3 py-2 text-bad">{r.totalDenied}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
