import type {
  CourseRecord,
  CourseUpdate,
  MetaResponse,
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
    throw new ApiError(`API returned ${res.status}`);
  }
  return (await res.json()) as T;
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

export async function updateCourse(code: string, patch: CourseUpdate): Promise<CourseRecord> {
  const res = await fetch(`${API_BASE}/curriculum/${code}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body?.detail?.message ?? `API returned ${res.status}`);
  }
  return res.json() as Promise<CourseRecord>;
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
