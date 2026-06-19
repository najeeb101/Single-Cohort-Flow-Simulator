import { NextRequest, NextResponse } from "next/server";
import { BACKEND_ORIGIN, setSessionCookie } from "@/lib/auth-session";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const res = await fetch(`${BACKEND_ORIGIN}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return NextResponse.json({ ok: false, error: "Invalid credentials" }, { status: res.status });
  }

  const data = await res.json();
  await setSessionCookie(data.access_token);
  return NextResponse.json({ ok: true });
}
