"use client";

import { SIGNAL_META, SIGNAL_ORDER, type SignalKey } from "@/lib/signalMeta";

// Compact legend for the four block signals. Renders each as a coloured pill with its one-line
// unit explanation, and — when `active`/`onToggle` are supplied — the pills double as filter
// toggles (an inactive signal is dimmed). Consumes the shared SIGNAL_META so its colours/labels
// always match the Bottlenecks cards. Reusable across pages.
interface Props {
  signals?: SignalKey[];
  active?: Set<SignalKey>; // when provided, pills act as toggles
  onToggle?: (k: SignalKey) => void;
  showCaption?: boolean;
}

export default function SignalLegend({ signals = SIGNAL_ORDER, active, onToggle, showCaption = true }: Props) {
  const interactive = !!onToggle;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5" role={interactive ? "group" : undefined} aria-label="Block-signal legend">
        {signals.map((k) => {
          const info = SIGNAL_META[k];
          const on = !active || active.has(k);
          const base = `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-opacity ${info.pill}`;
          const dimmed = on ? "" : "opacity-35";
          const content = (
            <>
              <span className={`h-2 w-2 rounded-full ${info.dot}`} aria-hidden />
              {info.label}
            </>
          );
          return interactive ? (
            <button
              key={k}
              type="button"
              onClick={() => onToggle!(k)}
              aria-pressed={on}
              title={`${info.unit}${active ? (on ? " — click to hide" : " — click to show") : ""}`}
              className={`${base} ${dimmed} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent`}
            >
              {content}
            </button>
          ) : (
            <span key={k} title={info.unit} className={base}>
              {content}
            </span>
          );
        })}
      </div>
      {showCaption && (
        <p className="max-w-3xl text-[10.5px] leading-snug text-muted">
          Each signal uses a different unit — <b className="text-ink/80">don&apos;t compare raw counts across signals</b>.
          Open a course&apos;s details to compare its own signals over time.
        </p>
      )}
    </div>
  );
}
