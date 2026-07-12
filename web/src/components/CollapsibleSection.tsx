"use client";

import { useState, type ReactNode } from "react";

// A click-to-expand section: the title bar is always visible; the body shows/hides on click.
// Used on the Dashboard so the detail sections (admissions rec, headline results, per-cohort
// table, prerequisite network) stay collapsed until the admin opens them. The wrapped component
// renders WITHOUT its own heading (pass showHeading={false}) since this provides the title.
export default function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 py-4 text-left"
      >
        <span
          className={`text-[10px] text-accent transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          aria-hidden
        >
          ▶
        </span>
        <span className="text-[15px] font-bold">{title}</span>
        {subtitle && <span className="text-xs font-normal text-muted">— {subtitle}</span>}
      </button>
      {open && <div className="pb-2">{children}</div>}
    </section>
  );
}
