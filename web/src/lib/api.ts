import type {
  CourseCreate,
  CourseRecord,
  CourseUpdate,
  InstructorCreate,
  InstructorRecord,
  InstructorUpdate,
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
  if (!res.ok) {
    // The auth cookie can expire mid-session (e.g. partway through the Plan Builder
    // wizard) — every API call surfaces the same 401, so handle it in one place rather
    // than every page needing to special-case it. Skip on /login itself to avoid a loop.
    if (res.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
    throw new ApiError(await errorMessage(res));
  }
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

export function simulate(overrides: ScenarioRequest): Promise<SimulateResponse> {
  return fetch(`${API_BASE}/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(overrides),
  }).then((res) => asJson<SimulateResponse>(res));
}

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

export function getScenario(id: number): Promise<ScenarioRecord> {
  return fetch(`${API_BASE}/scenarios/${id}`).then((res) => asJson<ScenarioRecord>(res));
}

export function updateScenario(
  id: number,
  patch: { name?: string; overrides?: ScenarioRequest }
): Promise<ScenarioRecord> {
  return fetch(`${API_BASE}/scenarios/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((res) => asJson<ScenarioRecord>(res));
}

export function deleteScenario(id: number): Promise<void> {
  return fetch(`${API_BASE}/scenarios/${id}`, { method: "DELETE" }).then((res) => asJson<void>(res));
}

export function listRuns(): Promise<RunRecord[]> {
  return fetch(`${API_BASE}/runs`).then((res) => asJson<RunRecord[]>(res));
}

export function getRun(id: number): Promise<RunRecord> {
  return fetch(`${API_BASE}/runs/${id}`).then((res) => asJson<RunRecord>(res));
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

export function listInstructors(): Promise<InstructorRecord[]> {
  return fetch(`${API_BASE}/instructors`).then((res) => asJson<InstructorRecord[]>(res));
}

export function createInstructor(instructor: InstructorCreate): Promise<InstructorRecord> {
  return fetch(`${API_BASE}/instructors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(instructor),
  }).then((res) => asJson<InstructorRecord>(res));
}

export function updateInstructor(id: number, patch: InstructorUpdate): Promise<InstructorRecord> {
  return fetch(`${API_BASE}/instructors/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((res) => asJson<InstructorRecord>(res));
}

export function deleteInstructor(id: number): Promise<void> {
  return fetch(`${API_BASE}/instructors/${id}`, { method: "DELETE" }).then((res) => asJson<void>(res));
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

export function exportPlan(id: number): Promise<PlanExportPayload> {
  return fetch(`${API_BASE}/plans/${id}/export`).then((res) => asJson<PlanExportPayload>(res));
}
