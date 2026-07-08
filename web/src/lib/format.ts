export function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export function num(x: number, decimals = 2): string {
  return x.toFixed(decimals);
}

// graduation_rate/throughput_stability are 0-1 rates; time_to_degree is in semesters;
// seats_denied_per_stud is a per-student count — each admission health criterion needs its
// own display precision instead of rendering the backend's raw round(x, 4) straight through.
// Shared by AdmissionsRecommendation and AutofillPanel, which both render this same criterion shape.
export function formatCriterionValue(name: string, x: number): string {
  if (name === "graduation_rate" || name === "throughput_stability") return pct(x);
  if (name === "time_to_degree") return num(x, 1);
  return num(x, 2);
}
