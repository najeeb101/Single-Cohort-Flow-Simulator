import type { TopBottlenecks } from "@/types/simulation";

// Faithful port of frontend/app.js::renderBottlenecks().
export default function BottlenecksPanel({ bottlenecks }: { bottlenecks: TopBottlenecks }) {
  const cards: { title: string; list: TopBottlenecks[keyof TopBottlenecks] }[] = [
    { title: "Failures", list: bottlenecks.fail },
    { title: "Capacity blocks", list: bottlenecks.capacity },
    { title: "Offering blocks", list: bottlenecks.offering },
    { title: "Prerequisite blocks", list: bottlenecks.prereq },
  ];

  return (
    <section className="py-6">
      <h2 className="mb-4 flex items-center gap-2 text-[15px] font-bold">
        <span className="grid h-6 w-6 place-items-center rounded-[7px] border border-border-2 bg-surface-2 text-xs font-bold text-accent">5</span>
        Top bottlenecks <span className="text-xs font-normal text-muted">— whole run</span>
      </h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3.5">
        {cards.map((c) => (
          <div key={c.title} className="rounded-2xl border border-border bg-surface p-4">
            <h4 className="mb-2.5 text-xs uppercase tracking-wide text-accent">{c.title}</h4>
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
        ))}
      </div>
    </section>
  );
}
