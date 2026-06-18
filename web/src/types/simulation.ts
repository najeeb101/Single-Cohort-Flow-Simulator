// Mirrors the JSON contract proven by tests/test_api.py and built in
// src/analytics.py::flow_timeline_payload / src/api.py. Keep in sync with those —
// there's no shared schema generation in this MVP slice, so a backend field rename
// needs a matching edit here.

export type TopList = [code: string, count: number][];

export interface Criterion {
  name: string;
  observed: number;
  target: number;
  slack: number;
}

export interface AdmissionsRecommendation {
  current_intake?: number;
  recommended_intake?: number;
  binding_criterion?: string;
  binding_slack?: number;
  growth_capped_at?: number;
  representative_cohort?: number | string;
  criteria?: Criterion[];
  note?: string;
}

export interface ConfidenceInterval {
  mean: number;
  stdev: number;
  ci_low: number;
  ci_high: number;
  n_runs: number;
}

export interface Headline {
  graduation_rate: number;
  academic_dropout_rate: number;
  censored_rate: number;
  avg_graduation_time: number;
  on_time_rate: number;
  probation_rate: number;
  mean_gpa_at_graduation: number;
  top_fail_courses: TopList;
  top_capacity_blocks: TopList;
  top_offering_blocks: TopList;
  top_prereq_blocks: TopList;
  confidence_intervals?: Record<string, ConfidenceInterval>;
}

export interface CohortMetric {
  cohort_id: number | string;
  is_incumbent: boolean;
  n: number;
  graduation_rate: number;
  academic_dropout_rate: number;
  censored_rate: number;
  on_time_rate: number;
  avg_time_to_degree: number;
  probation_rate: number;
  top_fail: string;
  top_capacity_block: string;
  top_offering_block: string;
  top_prereq_block: string;
}

export interface TopBottlenecks {
  fail: TopList;
  capacity: TopList;
  offering: TopList;
  prereq: TopList;
}

export interface FlowTimelineSummary {
  headline: Headline;
  per_cohort: CohortMetric[];
  admissions_recommendation: AdmissionsRecommendation;
  top_bottlenecks: TopBottlenecks;
}

export interface FlowTimelineMeta {
  scenario: string | null;
  stage_nodes: string[];
  cohorts: { id: number; is_incumbent: boolean; entry_term: number }[];
  graph: { nodes: unknown[]; edges: unknown[] };
  seed: number;
  cohort_size: number;
  max_terms: number;
  num_cohorts: number;
  num_incumbent_cohorts: number;
  seats_per_section: number;
}

export interface FlowTimeline {
  meta: FlowTimelineMeta;
  frames: unknown[]; // not consumed in this slice — the animated graph is deferred
  summary: FlowTimelineSummary;
}

export interface SimulateResponse {
  metrics: Headline;
  cohort_metrics: Record<string, CohortMetric>;
  admissions_recommendation: AdmissionsRecommendation;
  flow_timeline: FlowTimeline;
}

export interface MetaResponse {
  graph: { nodes: unknown[]; edges: unknown[] };
  course_sections: Record<string, number>;
  seats_per_section: number;
  baseline_scenario: Record<string, unknown> & { name: string };
  cohort_size: number;
}

export interface ScenarioRequest {
  capacity_multiplier?: number;
  capacity_overrides?: Record<string, number>;
  offering_overrides?: Record<string, string[]>;
  pass_rate_overrides?: Record<string, number>;
  cohort_size?: number;
  include_monte_carlo?: boolean;
}
