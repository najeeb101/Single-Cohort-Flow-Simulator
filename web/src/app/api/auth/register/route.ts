import { NextRequest, NextResponse } from "next/server";
import { BACKEND_ORIGIN, setSessionCookie } from "@/lib/auth-session";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const res = await fetch(`${BACKEND_ORIGIN}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const error = res.status === 409 ? "Email already registered" : detail?.detail ?? "Registration failed";
    return NextResponse.json({ ok: false, error }, { status: res.status });
  }

  const data = await res.json();
  await setSessionCookie(data.access_token);
  return NextResponse.json({ ok: true });
}
