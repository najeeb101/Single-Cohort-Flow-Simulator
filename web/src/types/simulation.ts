// Mirrors the JSON contract proven by tests/test_api.py and built in
// src/analytics.py::flow_timeline_payload / src/api.py. Keep in sync with those —
// there's no shared schema generation in this MVP slice, so a backend field rename
// needs a matching edit here.

export type TopList = [code: string, count: number][];
export type Histogram = [semester: number, count: number][];

export interface GraphNode {
  code: string;
  title: string;
  credits: number;
  category: string;
  offering: string[];
  capacity: number;
  study_plan_order: number;
  study_plan_term: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: "prereq" | "required" | "one_of";
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface CourseFrameStat {
  capacity: number;
  registered: number;
  granted: number;
  denied: number;
  passed: number;
  failed: number;
  prereq_waiting: number;
  offering_blocked: number;
  offered: boolean;
  full: boolean;
}

export interface CohortFlow {
  from: string;
  to: string;
  count: number;
}

export interface CohortStageBlock {
  is_incumbent: boolean;
  nodes: Record<string, number>;
  flows: CohortFlow[];
  seats_requested: number;
  seats_denied: number;
}

export interface FrameStages {
  cohorts: Record<string, CohortStageBlock>;
  totals: { nodes: Record<string, number>; seats_requested: number; seats_denied: number };
}

export interface Frame {
  term: number;
  season: string;
  label: string;
  courses: Record<string, CourseFrameStat>;
  stages: FrameStages;
}

// Admin-entered warm start that replaces the old simulated incumbent cohorts: per-course
// seats already taken by the existing student body.
export interface InitialState {
  occupancy: Record<string, number>;
}

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

// Auto-fill solver (POST /autofill, src/optimizer.py): smallest capacity additions that meet
// the admission health targets at the current intake. `recommended` is keyed by course code,
// changed courses only.
export interface AutofillCapacityRec {
  current: number;
  recommended: number;
  added: number;
}

export interface AutofillCriterion {
  name: string;
  observed: number;
  target: number;
  slack: number;
  met: boolean;
}

export interface AutofillTraceRow {
  iteration: number;
  action: string;
  course?: string;
  from?: number;
  to?: number;
  worst_criterion?: string | null;
  worst_slack?: number | null;
}

export interface AutofillIntakeSuggestion {
  recommended_intake: number | null;
  note: string;
}

export interface AutofillResult {
  feasible: boolean;
  runs: number;
  current_intake: number;
  recommended: Record<string, AutofillCapacityRec>;
  total_seats_added: number;
  final_metrics: {
    graduation_rate: number;
    on_time_rate: number;
    avg_graduation_time: number;
    academic_dropout_rate: number;
    censored_rate: number;
  };
  criteria: AutofillCriterion[];
  trace: AutofillTraceRow[];
  intake_suggestion: AutofillIntakeSuggestion | null;
  note: string;
}

export interface Headline {
  graduation_rate: number;
  academic_dropout_rate: number;
  censored_rate: number;
  avg_graduation_time: number;
  graduation_time_distribution: Histogram;
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

export interface TermSummary {
  term: number;
  season: string;
  capacity_shortfalls: Record<string, number>;
  offering_blocks: Record<string, number>;
}

export interface TermWarning {
  term: number;
  season: string;
  course: string;
  type: "capacity_shortfall" | "offering_block";
  severity: "high" | "medium";
  message: string;
}

/** Worst-terms-so-far in this run's own history — retrospective, not a forecast. See
 * src/analytics.py::summarize_severe_terms. */
export interface SevereTermsSummary {
  term_summaries: TermSummary[];
  warnings: TermWarning[];
}

export interface FlowTimelineSummary {
  headline: Headline;
  per_cohort: CohortMetric[];
  admissions_recommendation: AdmissionsRecommendation;
  top_bottlenecks: TopBottlenecks;
  severe_terms: SevereTermsSummary;
}

export interface CohortInfo {
  id: number;
  is_incumbent: boolean;
  entry_term: number;
}

export interface FlowTimelineMeta {
  scenario: string | null;
  stage_nodes: string[];
  cohorts: CohortInfo[];
  graph: Graph;
  seed: number;
  cohort_size: number;
  max_terms: number;
  num_cohorts: number;
  num_incumbent_cohorts: number;
  initial_state: InitialState;
}

export interface FlowTimeline {
  meta: FlowTimelineMeta;
  frames: Frame[];
  summary: FlowTimelineSummary;
}

export interface SimulateResponse {
  metrics: Headline;
  cohort_metrics: Record<string, CohortMetric>;
  admissions_recommendation: AdmissionsRecommendation;
  flow_timeline: FlowTimeline;
}

export interface EnrollmentPriorityTier {
  categories: string[];
  min_ch?: number;
}

export interface MetaResponse {
  graph: Graph;
  course_pass_rates: Record<string, number>;
  baseline_scenario: Record<string, unknown> & { name: string };
  cohort_size: number;
  num_cohorts: number;
  num_incumbent_cohorts: number;
  initial_state: InitialState;
  // Which seasons admit a new study cohort (Fall-only, or Fall+Spring). Replaces the old
  // admit_interval_terms count. admission_sizes optionally overrides the intake size per season.
  admission_terms: string[];
  admission_sizes: Record<string, number>;
  optional_terms_enabled: boolean;
  terms_per_year: string[]; // the plan's season cycle — the valid set for a course's offering
  mandatory_terms?: string[]; // the "regular" seasons (Fall/Spring); capacity views count only these
  max_terms: number;
  seed: number;
  dropout_gpa_floor: number;
  dropout_base_hazard: number;
  dropout_early_multiplier: number;
  dropout_early_sem_cutoff: number;
  dropout_fails_threshold: number;
  dropout_prob_on_repeated_fail: number;
  registration_tier_thresholds: number[];
  enrollment_priority_tiers: EnrollmentPriorityTier[];
  year_standing_thresholds: number[];
  on_time_terms: number;
  admission_targets: {
    target_grad_rate: number;
    max_avg_time_to_degree: number;
    max_seats_denied_per_student: number;
    min_throughput_stability: number;
  };
  // Phase B: whether the optional LLM advisor chat is configured on the backend (LLM_API_KEY set).
  llm_chat_enabled?: boolean;
  // Whether the caller has an in-progress Semester Checkpoint Mode session — see CheckpointState.
  checkpoint_active?: boolean;
  checkpoint_next_term?: number | null;
}

// Semester Checkpoint Mode (see CLAUDE.md): a turn-based, resumable re-run of the active plan.
// One step = one mandatory term; between steps the department head may edit future-facing
// knobs only (capacity/pass_rate/occupancy/intake) via checkpointEdit(). Mirrors
// src/api.py's _checkpoint_summary_from_sim payload shape.
export interface CheckpointCounts {
  active: number;
  delayed: number;
  graduated: number;
  dropped: number;
  censored: number;
}

export interface CheckpointState {
  id: number;
  status: "active" | "completed" | "discarded";
  next_term: number;
  // Season/year label for the upcoming term (e.g. "Summer Y2") — null once finished. Every
  // calendar term is its own step now (see `history`), including optional Summer/Winter terms,
  // so this disambiguates which kind of term is coming up next.
  next_term_label: string | null;
  is_finished: boolean;
  working_curriculum: CourseRecord[];
  working_config: Record<string, unknown> & { initial_state?: InitialState };
  frames: Frame[];
  meta: { graph: Graph; stage_nodes: string[] };
  counts_so_far: CheckpointCounts;
  // Every step recorded so far (seq 0 = session creation, seq N = after the Nth advance) — lets
  // the UI offer "go back to an earlier term" (POST /checkpoint/rewind) without a separate call.
  // `label` names the season/year completed at that step (e.g. "Summer Y2"), or "Start" for seq 0.
  history: { seq: number; next_term: number; label: string }[];
  // Same {meta, frames, summary} shape a completed /simulate produces (src/api.py's
  // _checkpoint_summary_from_sim), computed live off the session's partial run — lets
  // Bottlenecks/HeadlineKpis/AdmissionsRecommendation/CohortsTable read a checkpoint session
  // exactly like the baseline dashboard's flow_timeline. Always partial: fewer terms run so far
  // means less reliable headline/admissions numbers, especially before any cohort has finished.
  flow_timeline: FlowTimeline;
}

// Whitelisted future-facing edit — mirrors src/api.py's CheckpointEditRequest. Every field is
// optional; only the ones present are changed.
export interface CheckpointEdit {
  capacity?: Record<string, number>;
  pass_rate?: Record<string, number>;
  initial_state?: InitialState;
  cohort_size?: number;
  admission_sizes?: Record<string, number>;
}

export interface AdvisorChatMessage {
  role: "user" | "assistant";
  content: string;
}

// A concrete, one-click-applicable change the LLM proposed, already validated by the backend
// against the real active plan. Applied via the existing PUT /curriculum / PUT /config endpoints —
// the model never writes anything itself.
export interface AdvisorProposal {
  type: "capacity" | "offering" | "pass_rate" | "cohort_size";
  code?: string;
  value: number | string[];
  current?: number | string[] | null;
  reason: string;
  label: string;
}

export interface AdvisorChatResponse {
  configured: boolean;
  reply: string | null;
  proposals?: AdvisorProposal[];
}

export interface ScenarioRequest {
  capacity_multiplier?: number;
  capacity_overrides?: Record<string, number>;
  offering_overrides?: Record<string, string[]>;
  pass_rate_overrides?: Record<string, number>;
  cohort_size?: number;
  num_cohorts?: number;
  num_incumbent_cohorts?: number;
  admission_terms?: string[];
  admission_sizes?: Record<string, number>;
  max_terms?: number;
  seed?: number;
  initial_state?: InitialState;
  dropout_gpa_floor?: number;
  dropout_base_hazard?: number;
  dropout_early_multiplier?: number;
  dropout_early_sem_cutoff?: number;
  dropout_fails_threshold?: number;
  dropout_prob_on_repeated_fail?: number;
  registration_tier_thresholds?: number[];
  enrollment_priority_tiers?: EnrollmentPriorityTier[];
  include_monte_carlo?: boolean;
  scenario_id?: number;
}

// A saved, named override set (POST /scenarios). `overrides` is a ScenarioRequest payload.
export interface ScenarioRecord {
  id: number;
  name: string;
  overrides: ScenarioRequest;
  created_at: string;
  updated_at: string;
}

export type RuleExpr = string | { all: RuleExpr[] } | { any: RuleExpr[] } | { min_ch: number };

export interface CourseRecord {
  code: string;
  title: string;
  credits: number;
  prerequisites: string[];
  pass_rate: number;
  offering: string[];
  category: string;
  capacity: number;
  rule_expr: RuleExpr | null;
  study_plan_order: number;
  study_plan_term: number;
}

export interface CourseCreate {
  code: string;
  title: string;
  credits: number;
  prerequisites: string[];
  pass_rate: number;
  offering: string[];
  category: string;
  capacity: number;
  rule_expr: RuleExpr | null;
  study_plan_order: number;
  study_plan_term: number;
}

export interface CourseUpdate {
  title?: string;
  credits?: number;
  prerequisites?: string[];
  pass_rate?: number;
  offering?: string[];
  category?: string;
  capacity?: number;
  rule_expr?: RuleExpr | null;
  study_plan_order?: number;
  study_plan_term?: number;
}

export interface PlanRecord {
  id: number;
  name: string;
  is_default: boolean;
  is_active: boolean;
}

export interface PlanImportPayload {
  name: string;
  curriculum: CourseRecord[];
  config: Record<string, unknown>;
}

export interface PlanExportPayload {
  curriculum: CourseRecord[];
  config: Record<string, unknown>;
}

export interface RunRecord {
  id: number;
  scenario_id: number | null;
  requested_at: string;
  overrides_json: ScenarioRequest;
  summary_json: { metrics: Headline; admissions_recommendation: AdmissionsRecommendation };
}

export type BlockSignal = "capacity" | "offering" | "prereq";
