import type { EnrollmentPriorityTier, MetaResponse, ScenarioRequest } from "@/types/simulation";

// The 7 known course categories (src/models/course.py::Course.category).
export const CATEGORIES = [
  "cs_core",
  "cs_elective",
  "college_req",
  "math",
  "science",
  "english",
  "gen_ed",
] as const;

export interface BuilderState {
  capacityMultipliers: Record<string, number>;
  courseSections: Record<string, number>;
  cohortSize: number;
  passRates: Record<string, number>;
  dropoutGpaFloor: number;
  dropoutBaseHazard: number;
  dropoutEarlyMultiplier: number;
  dropoutEarlySemCutoff: number;
  dropoutFailsThreshold: number;
  dropoutProbOnRepeatedFail: number;
  numCohorts: number;
  numIncumbentCohorts: number;
  admitIntervalTerms: number;
  maxTerms: number;
  seed: number;
  registrationTierThresholds: number[];
  enrollmentPriorityTiers: EnrollmentPriorityTier[];
}

export function baselineFromMeta(meta: MetaResponse, topCapacityCourses: string[]): BuilderState {
  return {
    capacityMultipliers: Object.fromEntries(topCapacityCourses.map((code) => [code, 1])),
    courseSections: { ...meta.course_sections },
    cohortSize: meta.cohort_size,
    passRates: { ...meta.course_pass_rates },
    dropoutGpaFloor: meta.dropout_gpa_floor,
    dropoutBaseHazard: meta.dropout_base_hazard,
    dropoutEarlyMultiplier: meta.dropout_early_multiplier,
    dropoutEarlySemCutoff: meta.dropout_early_sem_cutoff,
    dropoutFailsThreshold: meta.dropout_fails_threshold,
    dropoutProbOnRepeatedFail: meta.dropout_prob_on_repeated_fail,
    numCohorts: meta.num_cohorts,
    numIncumbentCohorts: meta.num_incumbent_cohorts,
    admitIntervalTerms: meta.admit_interval_terms,
    maxTerms: meta.max_terms,
    seed: meta.seed,
    registrationTierThresholds: [...meta.registration_tier_thresholds],
    enrollmentPriorityTiers: meta.enrollment_priority_tiers.map((t) => ({ ...t, categories: [...t.categories] })),
  };
}

function numDiffers(a: number, b: number): boolean {
  return Math.abs(a - b) > 1e-9;
}

function recordDiff(state: Record<string, number>, baseline: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(state)) {
    if (numDiffers(v, baseline[k])) out[k] = v;
  }
  return out;
}

// Builds a /simulate request containing only fields that differ from baseline — mirrors
// the diff-only-changed pattern from the old LiveWhatIfPanel so an unedited form is a no-op.
export function buildOverrides(state: BuilderState, baseline: BuilderState): ScenarioRequest {
  const req: ScenarioRequest = {};

  const capacity_overrides = recordDiff(state.capacityMultipliers, baseline.capacityMultipliers);
  if (Object.keys(capacity_overrides).length) req.capacity_overrides = capacity_overrides;

  const course_sections_overrides = recordDiff(state.courseSections, baseline.courseSections);
  if (Object.keys(course_sections_overrides).length) req.course_sections_overrides = course_sections_overrides;

  if (numDiffers(state.cohortSize, baseline.cohortSize)) req.cohort_size = state.cohortSize;

  const pass_rate_overrides = recordDiff(state.passRates, baseline.passRates);
  if (Object.keys(pass_rate_overrides).length) req.pass_rate_overrides = pass_rate_overrides;

  if (numDiffers(state.dropoutGpaFloor, baseline.dropoutGpaFloor)) req.dropout_gpa_floor = state.dropoutGpaFloor;
  if (numDiffers(state.dropoutBaseHazard, baseline.dropoutBaseHazard)) req.dropout_base_hazard = state.dropoutBaseHazard;
  if (numDiffers(state.dropoutEarlyMultiplier, baseline.dropoutEarlyMultiplier)) {
    req.dropout_early_multiplier = state.dropoutEarlyMultiplier;
  }
  if (numDiffers(state.dropoutEarlySemCutoff, baseline.dropoutEarlySemCutoff)) {
    req.dropout_early_sem_cutoff = state.dropoutEarlySemCutoff;
  }
  if (numDiffers(state.dropoutFailsThreshold, baseline.dropoutFailsThreshold)) {
    req.dropout_fails_threshold = state.dropoutFailsThreshold;
  }
  if (numDiffers(state.dropoutProbOnRepeatedFail, baseline.dropoutProbOnRepeatedFail)) {
    req.dropout_prob_on_repeated_fail = state.dropoutProbOnRepeatedFail;
  }

  if (numDiffers(state.numCohorts, baseline.numCohorts)) req.num_cohorts = state.numCohorts;
  if (numDiffers(state.numIncumbentCohorts, baseline.numIncumbentCohorts)) {
    req.num_incumbent_cohorts = state.numIncumbentCohorts;
  }
  if (numDiffers(state.admitIntervalTerms, baseline.admitIntervalTerms)) {
    req.admit_interval_terms = state.admitIntervalTerms;
  }
  if (numDiffers(state.maxTerms, baseline.maxTerms)) req.max_terms = state.maxTerms;
  if (numDiffers(state.seed, baseline.seed)) req.seed = state.seed;

  if (JSON.stringify(state.registrationTierThresholds) !== JSON.stringify(baseline.registrationTierThresholds)) {
    req.registration_tier_thresholds = state.registrationTierThresholds;
  }
  if (JSON.stringify(state.enrollmentPriorityTiers) !== JSON.stringify(baseline.enrollmentPriorityTiers)) {
    req.enrollment_priority_tiers = state.enrollmentPriorityTiers;
  }

  return req;
}
