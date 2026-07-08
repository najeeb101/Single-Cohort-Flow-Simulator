import type { TopBottlenecks } from "@/types/simulation";

// Faithful port of frontend/app.js::renderBottlenecks().
export default function BottlenecksPanel({ bottlenecks }: { bottlenecks: TopBottlenecks }) {
  // Each of the four block signals gets its own color instead of one flat accent, so they read
  // as four distinct signals at a glance (a real attempt-and-fail vs. a scheduling fact vs. a
  // structural prerequisite gap are different kinds of problem, not variations on one).
  const cards: { title: string; list: TopBottlenecks[keyof TopBottlenecks]; color: string }[] = [
    { title: "Failures", list: bottlenecks.fail, color: "bad" },
    { title: "Capacity blocks", list: bottlenecks.capacity, color: "warn" },
    { title: "Offering blocks", list: bottlenecks.offering, color: "info" },
    { title: "Prerequisite blocks", list: bottlenecks.prereq, color: "accent" },
  ];

  // Static class strings (not template-built) so Tailwind's build-time scanner picks them up.
  const COLOR_CLASSES: Record<string, { text: string; border: string }> = {
    bad: { text: "text-bad", border: "border-l-bad" },
    warn: { text: "text-warn", border: "border-l-warn" },
    info: { text: "text-info", border: "border-l-info" },
    accent: { text: "text-accent", border: "border-l-accent" },
  };

  return (
    <section className="py-6">
      <h2 className="mb-1 text-[15px] font-bold">Top bottlenecks</h2>
      <p className="mb-4 max-w-3xl text-[12.5px] text-muted">
        The four reasons a student couldn't take a course they needed — ranked by how often each course caused the problem across the whole run. <b className="text-ink">Failures</b>: attempted and failed. <b className="text-ink">Capacity blocks</b>: requested a seat but lost the allocation (course was full). <b className="text-ink">Offering blocks</b>: eligible but the course wasn't taught that term. <b className="text-ink">Prerequisite blocks</b>: prerequisites not yet satisfied. A course appearing at the top of multiple lists is the deepest structural delay point in the curriculum.
      </p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3.5">
        {cards.map((c) => {
          const desc: Record<string, string> = {
            "Failures": "Times a student sat the course and did not pass.",
            "Capacity blocks": "Times a student requested a seat and was denied because the course was full.",
            "Offering blocks": "Times an eligible student couldn't enrol because the course wasn't running that term.",
            "Prerequisite blocks": "Times a student was ready to take the course but still missing a prerequisite.",
          };
          const colors = COLOR_CLASSES[c.color];
          return (
            <div key={c.title} className={`rounded-2xl border border-border border-l-[3px] bg-surface p-4 ${colors.border}`}>
              <h4 className={`mb-0.5 text-xs uppercase tracking-wide ${colors.text}`}>{c.title}</h4>
              <p className="mb-2.5 text-[11px] text-muted">{desc[c.title]}</p>
              {c.list.length ? (
                <ol className="list-decimal space-y-1.5 pl-5 text-[13px] marker:text-faint">
                  {c.list.map(([code, n]) => (
                    <li key={code}>
                      {code} <span className="text-muted">({n})</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <span className="text-xs text-muted">none</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
