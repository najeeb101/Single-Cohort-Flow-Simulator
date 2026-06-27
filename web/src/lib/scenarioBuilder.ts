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
  initialOccupancy: Record<string, number>;
  standing: Record<string, number>;
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
    initialOccupancy: { ...(meta.initial_state?.occupancy ?? {}) },
    standing: { Year2: 0, Year3: 0, Year4: 0, ...(meta.initial_state?.standing ?? {}) },
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

  // initial_state is a nested object — if either occupancy or standing changed, send the
  // whole thing (the engine replaces config.initial_state wholesale).
  const occupancyChanged =
    JSON.stringify(state.initialOccupancy) !== JSON.stringify(baseline.initialOccupancy);
  const standingChanged = JSON.stringify(state.standing) !== JSON.stringify(baseline.standing);
  if (occupancyChanged || standingChanged) {
    req.initial_state = { occupancy: state.initialOccupancy, standing: state.standing };
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

// Inverse of buildOverrides — reconstructs a BuilderState by overlaying a saved
// Scenario's overrides onto baseline (used when loading a saved/cloned scenario).
export function applyOverrides(overrides: ScenarioRequest, baseline: BuilderState): BuilderState {
  return {
    capacityMultipliers: { ...baseline.capacityMultipliers, ...overrides.capacity_overrides },
    courseSections: { ...baseline.courseSections, ...overrides.course_sections_overrides },
    cohortSize: overrides.cohort_size ?? baseline.cohortSize,
    passRates: { ...baseline.passRates, ...overrides.pass_rate_overrides },
    dropoutGpaFloor: overrides.dropout_gpa_floor ?? baseline.dropoutGpaFloor,
    dropoutBaseHazard: overrides.dropout_base_hazard ?? baseline.dropoutBaseHazard,
    dropoutEarlyMultiplier: overrides.dropout_early_multiplier ?? baseline.dropoutEarlyMultiplier,
    dropoutEarlySemCutoff: overrides.dropout_early_sem_cutoff ?? baseline.dropoutEarlySemCutoff,
    dropoutFailsThreshold: overrides.dropout_fails_threshold ?? baseline.dropoutFailsThreshold,
    dropoutProbOnRepeatedFail: overrides.dropout_prob_on_repeated_fail ?? baseline.dropoutProbOnRepeatedFail,
    numCohorts: overrides.num_cohorts ?? baseline.numCohorts,
    numIncumbentCohorts: overrides.num_incumbent_cohorts ?? baseline.numIncumbentCohorts,
    initialOccupancy: { ...baseline.initialOccupancy, ...(overrides.initial_state?.occupancy ?? {}) },
    standing: { ...baseline.standing, ...(overrides.initial_state?.standing ?? {}) },
    admitIntervalTerms: overrides.admit_interval_terms ?? baseline.admitIntervalTerms,
    maxTerms: overrides.max_terms ?? baseline.maxTerms,
    seed: overrides.seed ?? baseline.seed,
    registrationTierThresholds: overrides.registration_tier_thresholds ?? baseline.registrationTierThresholds,
    enrollmentPriorityTiers: overrides.enrollment_priority_tiers ?? baseline.enrollmentPriorityTiers,
  };
}
