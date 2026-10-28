import type { ReactNode } from "react";

// Shared page furniture in the QU CoAdvisor style: a quiet context line, a large title and one
// summary sentence; sections labelled above their card rather than inside it; soft pill chips.

export function PageHeader({
  context,
  title,
  children,
  actions,
}: {
  context?: ReactNode;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 pb-4 pt-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 max-w-3xl">
        {context && <div className="text-[13px] text-muted">{context}</div>}
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[28px]">{title}</h1>
        {children && <div className="mt-2 text-[14px] leading-relaxed text-muted">{children}</div>}
      </div>
      {actions && <div className="no-print flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({
  title,
  meta,
  children,
  className = "",
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex flex-col gap-3 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {meta && <div className="text-[13px] text-muted">{meta}</div>}
      </div>
      {children}
    </section>
  );
}

type Tone = "neutral" | "good" | "warn" | "bad" | "info" | "accent";

const TONE: Record<Tone, string> = {
  neutral: "border-border bg-surface text-ink",
  good: "border-good/25 bg-good/10 text-good",
  warn: "border-warn/25 bg-warn/10 text-warn",
  bad: "border-bad/25 bg-bad/10 text-bad",
  info: "border-info/25 bg-info/10 text-info",
  accent: "border-accent/25 bg-accent/10 text-accent",
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] ${TONE[tone]}`}>
      {children}
    </span>
  );
}

// Button looks, as class strings so they work on <button> and <Link> alike.
export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-[14px] font-medium text-primary-ink disabled:cursor-not-allowed disabled:opacity-50";
export const btnSecondary =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-[14px] font-medium text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50";
