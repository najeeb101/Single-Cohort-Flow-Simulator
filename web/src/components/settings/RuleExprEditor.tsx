"use client";

import type { RuleExpr } from "@/types/simulation";

interface Props {
  expr: RuleExpr;
  allCourseCodes: string[];
  onChange: (next: RuleExpr) => void;
}

type AllNode = { all: RuleExpr[] };
type AnyNode = { any: RuleExpr[] };
type MinChNode = { min_ch: number };

const isAllNode = (e: RuleExpr): e is AllNode => typeof e === "object" && e !== null && "all" in e;
const isAnyNode = (e: RuleExpr): e is AnyNode => typeof e === "object" && e !== null && "any" in e;
const isMinChNode = (e: RuleExpr): e is MinChNode => typeof e === "object" && e !== null && "min_ch" in e;
const isCourseLeaf = (e: RuleExpr): e is string => typeof e === "string";

// Structured editor for the canonical compound-rule shape (src/rules.py): a top-level
// {"all": [...]} containing plain course-code leaves (every-one-required), at most one
// {"any": [...]} group (at-least-one-of), and at most one {"min_ch": N} threshold. Covers
// the one real-world case (CMPS493) and any rule built the same way — not a general
// recursive rule builder, by design, per the "structured sub-form, not raw JSON" ask.
export default function RuleExprEditor({ expr, allCourseCodes, onChange }: Props) {
  if (!isAllNode(expr)) {
    return (
      <p className="text-[11px] text-bad">
        This rule isn&apos;t a top-level &quot;all&quot; expression — editing it isn&apos;t supported in this UI.
      </p>
    );
  }

  const requiredCourses = expr.all.filter(isCourseLeaf);
  const anyNode = expr.all.find(isAnyNode);
  const anyChoices = anyNode ? anyNode.any.filter(isCourseLeaf) : [];
  const minChNode = expr.all.find(isMinChNode);

  const rebuild = (required: string[], anyList: string[], minCh: number | undefined) => {
    const nodes: RuleExpr[] = [...required];
    if (anyList.length > 0) nodes.push({ any: anyList });
    if (minCh !== undefined) nodes.push({ min_ch: minCh });
    onChange({ all: nodes });
  };

  const availableForRequired = allCourseCodes.filter((c) => !requiredCourses.includes(c));
  const availableForAny = allCourseCodes.filter((c) => !anyChoices.includes(c));

  return (
    <div className="flex flex-col gap-3 text-[12.5px]">
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Required (all of these)
        </div>
        <div className="flex flex-wrap gap-1.5">
          {requiredCourses.map((code) => (
            <span key={code} className="flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-ink">
              {code}
              <button
                type="button"
                onClick={() => rebuild(requiredCourses.filter((c) => c !== code), anyChoices, minChNode?.min_ch)}
                className="text-bad"
              >
                ×
              </button>
            </span>
          ))}
          {availableForRequired.length > 0 && (
            <select
              value=""
              onChange={(e) => e.target.value && rebuild([...requiredCourses, e.target.value], anyChoices, minChNode?.min_ch)}
              className="rounded-full border border-border-2 bg-surface-2 px-2 py-1 text-ink"
            >
              <option value="">+ add required course</option>
              {availableForRequired.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          At least one of
        </div>
        <div className="flex flex-wrap gap-1.5">
          {anyChoices.map((code) => (
            <span key={code} className="flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-ink">
              {code}
              <button
                type="button"
                onClick={() => rebuild(requiredCourses, anyChoices.filter((c) => c !== code), minChNode?.min_ch)}
                className="text-bad"
              >
                ×
              </button>
            </span>
          ))}
          {availableForAny.length > 0 && (
            <select
              value=""
              onChange={(e) => e.target.value && rebuild(requiredCourses, [...anyChoices, e.target.value], minChNode?.min_ch)}
              className="rounded-full border border-border-2 bg-surface-2 px-2 py-1 text-ink"
            >
              <option value="">+ add choice</option>
              {availableForAny.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Min. completed CH
        </span>
        <input
          type="number"
          min={0}
          max={120}
          value={minChNode?.min_ch ?? ""}
          placeholder="none"
          onChange={(e) =>
            rebuild(requiredCourses, anyChoices, e.target.value === "" ? undefined : Number(e.target.value))
          }
          className="w-20 rounded-[8px] border border-border-2 bg-surface-2 px-2 py-1 text-ink"
        />
      </div>
    </div>
  );
}
