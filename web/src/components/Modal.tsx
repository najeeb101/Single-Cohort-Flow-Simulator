"use client";

import { useEffect, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  // "lg" (the default) fits a short form; "wide" is for content with its own data tables
  // (e.g. a full CurriculumTable) that would otherwise overflow a narrow panel.
  size?: "lg" | "wide";
}

const SIZE_CLASS: Record<NonNullable<Props["size"]>, string> = {
  lg: "max-w-lg",
  wide: "max-w-5xl",
};

export default function Modal({ open, onClose, title, children, size = "lg" }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className={`flex w-full max-h-[85vh] flex-col rounded-2xl border border-border bg-surface p-4 shadow-xl ${SIZE_CLASS[size]}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-sm font-semibold">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
