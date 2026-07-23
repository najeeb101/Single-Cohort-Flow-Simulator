import type {
  AdvisorChatMessage,
  AdvisorChatResponse,
  AutofillResult,
  CheckpointEdit,
  CheckpointState,
  CourseCreate,
  CourseRecord,
  CourseUpdate,
  MetaResponse,
  PlanExportPayload,
  PlanImportPayload,
  PlanRecord,
  RunRecord,
  ScenarioRecord,
  ScenarioRequest,
  SimulateResponse,
} from "@/types/simulation";

// Relative + same-origin: resolves to localhost:3000/api/backend/..., which
// next.config.ts's rewrites() forwards server-to-server to FastAPI (see that file's
// comment) — this is what lets the browser's httpOnly auth cookie reach the backend
// without ever being readable by client JS.
export const API_BASE = "/api/backend";

export class ApiError extends Error {}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw new ApiError(await errorMessage(res));
  return (await res.json()) as T;
}

// FastAPI's `detail` is sometimes a plain string (404/409/generic 422) and sometimes a
// structured `{message, cycle}` object (the prerequisite-cycle 422s from
// src/curriculum_validation.py) — normalize both into one message string.
async function errorMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  const detail = body?.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && "message" in detail) return String(detail.message);
  return `API returned ${res.status}`;
}

export function getMeta(): Promise<MetaResponse> {
  return fetch(`${API_BASE}/meta`).then((res) => asJson<MetaResponse>(res));
}

// Render free-tier web services spin down after ~15 min idle; the first request that wakes one
// can take 40-50s, or bounce with a 502/503 while the backend is still booting. A single
// getMeta() therefore fails on the very first cold-start visit even though the backend is
// perfectly healthy. Retry it a few times with backoff and a per-attempt timeout so a cold
// start reads as "waking up" rather than a hard failure. `onAttempt(n)` fires before each
// *retry* (n = 1, 2, …) so the UI can show a "waking the backend" message.
export async function getMetaWithRetry(
  opts: { retries?: number; timeoutMs?: number; backoffMs?: number; onAttempt?: (attempt: number) => void } = {}
): Promise<MetaResponse> {
  const retries = opts.retries ?? 5;
  const timeoutMs = opts.timeoutMs ?? 25000;
  const backoffMs = opts.backoffMs ?? 3000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) opts.onAttempt?.(attempt);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${API_BASE}/meta`, { signal: ctrl.signal });
      return await asJson<MetaResponse>(res);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, backoffMs));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export function simulate(overrides: ScenarioRequest): Promise<SimulateResponse> {
  return fetch(`${API_BASE}/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(overrides),
  }).then((res) => asJson<SimulateResponse>(res));
}

// Phase B advisor chat (POST /advisor/chat). `context` is the grounding facts blob built from the
// run summary. Returns configured:false (not an error) when the backend has no LLM_API_KEY set.
export function advisorChat(
  messages: AdvisorChatMessage[],
  context: Record<string, unknown>,
): Promise<AdvisorChatResponse> {
  return fetch(`${API_BASE}/advisor/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, context }),
  }).then((res) => asJson<AdvisorChatResponse>(res));
}

export function autofill(runBudget?: number): Promise<AutofillResult> {
  return fetch(`${API_BASE}/autofill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(runBudget ? { run_budget: runBudget } : {}),
  }).then((res) => asJson<AutofillResult>(res));
}

export const RUNS_LIMIT = 100;

export function listRuns(limit = RUNS_LIMIT): Promise<RunRecord[]> {
  return fetch(`${API_BASE}/runs?limit=${limit}`).then((res) => asJson<RunRecord[]>(res));
}

export function getRun(id: number): Promise<RunRecord> {
  return fetch(`${API_BASE}/runs/${id}`).then((res) => asJson<RunRecord>(res));
}

// Saved scenarios: a named override set persisted for later (POST /scenarios). Scoped to the
// shared demo user, like runs. See src/scenarios.py.
export function listScenarios(): Promise<ScenarioRecord[]> {
  return fetch(`${API_BASE}/scenarios`).then((res) => asJson<ScenarioRecord[]>(res));
}

export function createScenario(name: string, overrides: ScenarioRequest): Promise<ScenarioRecord> {
  return fetch(`${API_BASE}/scenarios`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, overrides }),
  }).then((res) => asJson<ScenarioRecord>(res));
}

export function deleteScenario(id: number): Promise<void> {
  return fetch(`${API_BASE}/scenarios/${id}`, { method: "DELETE" }).then((res) => {
    if (!res.ok) throw new ApiError(`API returned ${res.status}`);
  });
}

export function listCurriculum(): Promise<CourseRecord[]> {
  return fetch(`${API_BASE}/curriculum`).then((res) => asJson<CourseRecord[]>(res));
}

export function updateCourse(code: string, patch: CourseUpdate): Promise<CourseRecord> {
  return fetch(`${API_BASE}/curriculum/${code}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((res) => asJson<CourseRecord>(res));
}

export function createCourse(course: CourseCreate): Promise<CourseRecord> {
  return fetch(`${API_BASE}/curriculum`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(course),
  }).then((res) => asJson<CourseRecord>(res));
}

export function deleteCourse(code: string): Promise<void> {
  return fetch(`${API_BASE}/curriculum/${code}`, { method: "DELETE" }).then((res) => asJson<void>(res));
}

export function getConfig(): Promise<Record<string, unknown>> {
  return fetch(`${API_BASE}/config`).then((res) => asJson<Record<string, unknown>>(res));
}

export function updateConfig(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  return fetch(`${API_BASE}/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((res) => asJson<Record<string, unknown>>(res));
}

export function listPlans(): Promise<PlanRecord[]> {
  return fetch(`${API_BASE}/plans`).then((res) => asJson<PlanRecord[]>(res));
}

export function importPlan(payload: PlanImportPayload): Promise<PlanRecord> {
  return fetch(`${API_BASE}/plans/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((res) => asJson<PlanRecord>(res));
}

export function activatePlan(id: number): Promise<PlanRecord> {
  return fetch(`${API_BASE}/plans/${id}/activate`, { method: "POST" }).then((res) => asJson<PlanRecord>(res));
}

export function deletePlan(id: number): Promise<void> {
  return fetch(`${API_BASE}/plans/${id}`, { method: "DELETE" }).then((res) => asJson<void>(res));
}

export function renamePlan(id: number, name: string): Promise<PlanRecord> {
  return fetch(`${API_BASE}/plans/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }).then((res) => asJson<PlanRecord>(res));
}

export function exportPlan(id: number): Promise<PlanExportPayload> {
  return fetch(`${API_BASE}/plans/${id}/export`).then((res) => asJson<PlanExportPayload>(res));
}

// Semester Checkpoint Mode (see CLAUDE.md): a turn-based, resumable re-run of the active plan,
// separate from the baseline /simulate path (no Run row is written for any of these).
export function getCheckpoint(): Promise<CheckpointState> {
  return fetch(`${API_BASE}/checkpoint`).then((res) => asJson<CheckpointState>(res));
}

export function createCheckpoint(): Promise<CheckpointState> {
  return fetch(`${API_BASE}/checkpoint`, { method: "POST" }).then((res) => asJson<CheckpointState>(res));
}

export function editCheckpoint(patch: CheckpointEdit): Promise<CheckpointState> {
  return fetch(`${API_BASE}/checkpoint/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((res) => asJson<CheckpointState>(res));
}

export function advanceCheckpoint(): Promise<CheckpointState> {
  return fetch(`${API_BASE}/checkpoint/advance`, { method: "POST" }).then((res) => asJson<CheckpointState>(res));
}

// Roll the session's simulated terms back to an earlier step (see the `history` field on
// CheckpointState) — staged capacity/pass_rate/occupancy/intake edits are kept as-is; only the
// already-run terms are undone. See src/api.py::rewind_checkpoint.
export function rewindCheckpoint(seq: number): Promise<CheckpointState> {
  return fetch(`${API_BASE}/checkpoint/rewind`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seq }),
  }).then((res) => asJson<CheckpointState>(res));
}

// Read-only view of an earlier step — unlike rewindCheckpoint, this never truncates history or
// changes the live session; it's purely for previewing what a past term looked like before
// deciding whether to commit to it (via rewindCheckpoint). See src/api.py::peek_checkpoint.
export function peekCheckpoint(seq: number): Promise<CheckpointState> {
  return fetch(`${API_BASE}/checkpoint/peek/${seq}`).then((res) => asJson<CheckpointState>(res));
}

// Auto-fill solver scoped to the session's staged curriculum/config rather than the live plan —
// see src/api.py::autofill_checkpoint. Read-only; apply via editCheckpoint (POST /checkpoint/edit).
export function autofillCheckpoint(runBudget?: number): Promise<AutofillResult> {
  return fetch(`${API_BASE}/checkpoint/autofill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(runBudget ? { run_budget: runBudget } : {}),
  }).then((res) => asJson<AutofillResult>(res));
}

export function discardCheckpoint(): Promise<void> {
  return fetch(`${API_BASE}/checkpoint`, { method: "DELETE" }).then((res) => asJson<void>(res));
}
