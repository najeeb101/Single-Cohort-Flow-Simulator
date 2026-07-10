import type { CourseRecord, EnrollmentPriorityTier, MetaResponse, PlanImportPayload } from "@/types/simulation";
import type { BuilderState } from "@/lib/scenarioBuilder";

// Sensible scalar defaults for a "start blank" plan — same shape/values as
// data/simulation_config.json. Per-course seat capacity lives on each course's own
// `capacity` field (see emptyCourse() below), not here.
export const BLANK_CONFIG: Record<string, unknown> = {
  seed: 42,
  cohort_size: 100,
  max_terms: 12,
  num_cohorts: 4,
  num_incumbent_cohorts: 0,
  initial_state: { occupancy: {}, standing: { Year2: 0, Year3: 0, Year4: 0 } },
  admit_interval_terms: 2,
  registration_tier_thresholds: [0, 30, 60, 90, 120],
  enrollment_priority_tiers: [],
  year_standing_thresholds: [30, 60, 90],
  on_time_terms: 8,
  normal_load_ch: 18,
  probation_load_ch: 12,
  probation_min_ch: 25,
  dropout_gpa_floor: 2.0,
  dropout_base_hazard: 0.1,
  dropout_early_multiplier: 1.5,
  dropout_early_sem_cutoff: 2,
  dropout_fails_threshold: 3,
  dropout_prob_on_repeated_fail: 0.2,
  grade_tiers: {
    hard_max: 0.72,
    medium_max: 0.82,
    hard: { A: 0.08, "B+": 0.15, B: 0.32, "C+": 0.22, C: 0.18, D: 0.05 },
    medium: { A: 0.12, "B+": 0.18, B: 0.33, "C+": 0.22, C: 0.13, D: 0.02 },
    easy: { A: 0.25, "B+": 0.25, B: 0.25, "C+": 0.12, C: 0.1, D: 0.03 },
  },
  scenarios: [{ name: "baseline" }],
};

// Mirrors src/api.py's CourseCreate validators (VALID_OFFERINGS, credits 0-6, capacity >= 1,
// non-blank code/title/category) so a bad course gets a clear inline message before the
// round trip, not a generic "API returned 422" after submitting. Category is free text
// (different plans/departments use different taxonomies) — only presence is checked, same
// as the backend. `validSeasons` is the plan's own `terms_per_year` cycle (defaults to the
// legacy Fall/Spring), so this mirrors the backend's per-plan offering check rather than a
// hardcoded season list.
const DEFAULT_SEASONS = ["Fall", "Spring"];

export function validateCourseDraft(
  draft: CourseRecord,
  existingCodes: string[],
  validSeasons: string[] = DEFAULT_SEASONS,
): string | null {
  const seasons = validSeasons.length ? validSeasons : DEFAULT_SEASONS;
  const code = draft.code.trim();
  if (!code) return "Code is required";
  if (!draft.title.trim()) return "Title is required";
  if (existingCodes.includes(code)) return `Course ${code} already exists in this plan`;
  if (draft.credits < 0 || draft.credits > 6) return "Credits must be between 0 and 6";
  if (draft.capacity < 1) return "Capacity must be at least 1";
  if (draft.offering.length === 0) return "Select at least one offering season";
  if (!draft.offering.every((s) => seasons.includes(s))) return `Offering must be one of ${seasons.join(", ")}`;
  if (!draft.category.trim()) return "Category is required";
  return null;
}

export function emptyCourse(): CourseRecord {
  return {
    code: "",
    title: "",
    credits: 3,
    prerequisites: [],
    pass_rate: 0.85,
    offering: ["Fall", "Spring"],
    category: "",
    capacity: 30,
    rule_expr: null,
    study_plan_order: 99,
    study_plan_term: 0,
  };
}

// Builds a MetaResponse-shaped object from a Plan's exported {curriculum, config} so the
// wizard's config step can reuse the Scenario Builder's tab components (AdmissionsTab /
// PassRatesDropoutTab / RegistrationPolicyTab) unmodified — they only read field names off
// `meta`/`BuilderState`, never call the network themselves. `graph` is unused by those tabs,
// so it's stubbed empty rather than recomputed client-side.
export function metaFromPlanExport(curriculum: CourseRecord[], config: Record<string, unknown>): MetaResponse {
  const scenarios = (config.scenarios as Record<string, unknown>[] | undefined) ?? [{ name: "baseline" }];
  return {
    graph: { nodes: [], edges: [] },
    course_pass_rates: Object.fromEntries(curriculum.map((c) => [c.code, c.pass_rate])),
    baseline_scenario: (scenarios[0] as MetaResponse["baseline_scenario"]) ?? { name: "baseline" },
    cohort_size: (config.cohort_size as number) ?? 100,
    num_cohorts: (config.num_cohorts as number) ?? 4,
    num_incumbent_cohorts: (config.num_incumbent_cohorts as number) ?? 0,
    initial_state: (config.initial_state as MetaResponse["initial_state"]) ?? { occupancy: {}, standing: {} },
    admit_interval_terms: (config.admit_interval_terms as number) ?? 2,
    optional_terms_enabled: (config.optional_terms_enabled as boolean) ?? false,
    terms_per_year: (config.terms_per_year as string[] | undefined) ?? ["Fall", "Spring"],
    max_terms: (config.max_terms as number) ?? 12,
    seed: (config.seed as number) ?? 42,
    dropout_gpa_floor: (config.dropout_gpa_floor as number) ?? 2.0,
    dropout_base_hazard: (config.dropout_base_hazard as number) ?? 0.1,
    dropout_early_multiplier: (config.dropout_early_multiplier as number) ?? 1.5,
    dropout_early_sem_cutoff: (config.dropout_early_sem_cutoff as number) ?? 2,
    dropout_fails_threshold: (config.dropout_fails_threshold as number) ?? 3,
    dropout_prob_on_repeated_fail: (config.dropout_prob_on_repeated_fail as number) ?? 0.2,
    registration_tier_thresholds: (config.registration_tier_thresholds as number[]) ?? [0, 30, 60, 90, 120],
    enrollment_priority_tiers: (config.enrollment_priority_tiers as EnrollmentPriorityTier[]) ?? [],
    year_standing_thresholds: (config.year_standing_thresholds as number[]) ?? [30, 60, 90],
    on_time_terms: (config.on_time_terms as number) ?? 8,
    admission_targets: (config.admission_targets as MetaResponse["admission_targets"]) ?? {
      target_grad_rate: 0.70,
      max_avg_time_to_degree: 10.0,
      max_seats_denied_per_student: 1.0,
      min_throughput_stability: 0.85,
    },
  };
}

// Folds the config step's edited BuilderState back into the cloned/blank base config
// (preserving fields the tabs don't expose, e.g. `scenarios`) and applies any pass-rate
// edits onto the course list.
export function composePlanPayload(
  name: string,
  courses: CourseRecord[],
  baseConfig: Record<string, unknown>,
  state: BuilderState
): PlanImportPayload {
  const config: Record<string, unknown> = {
    ...baseConfig,
    cohort_size: state.cohortSize,
    num_cohorts: state.numCohorts,
    num_incumbent_cohorts: state.numIncumbentCohorts,
    initial_state: { occupancy: state.initialOccupancy, standing: state.standing },
    admit_interval_terms: state.admitIntervalTerms,
    max_terms: state.maxTerms,
    seed: state.seed,
    dropout_gpa_floor: state.dropoutGpaFloor,
    dropout_base_hazard: state.dropoutBaseHazard,
    dropout_early_multiplier: state.dropoutEarlyMultiplier,
    dropout_early_sem_cutoff: state.dropoutEarlySemCutoff,
    dropout_fails_threshold: state.dropoutFailsThreshold,
    dropout_prob_on_repeated_fail: state.dropoutProbOnRepeatedFail,
    registration_tier_thresholds: state.registrationTierThresholds,
    enrollment_priority_tiers: state.enrollmentPriorityTiers,
  };

  const curriculum = courses.map((c) => ({ ...c, pass_rate: state.passRates[c.code] ?? c.pass_rate }));

  return { name, curriculum, config };
}
