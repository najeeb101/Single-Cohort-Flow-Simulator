import { cookies } from "next/headers";

const COOKIE_NAME = "session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days, matches src/auth.py's token expiry

// Server-side route handlers call FastAPI directly (not through the /api/backend rewrite,
// which exists for browser calls only) — same default as next.config.ts/lib/api.ts's
// pre-Phase-2 NEXT_PUBLIC_API_BASE convention.
export const BACKEND_ORIGIN = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8001";

export async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE_NAME)?.value;
}

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}
