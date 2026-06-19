import { NextResponse } from "next/server";
import { getSessionToken } from "@/lib/auth-session";

// Decodes the JWT payload for display purposes only (e.g. NavBar's "Signed in as <email>").
// No signature re-verification here — the real check happens at FastAPI's get_current_user
// on every actual data request; this route never exposes the raw token to client JS.
function decodePayload(token: string): { email?: string } | null {
  try {
    const payload = token.split(".")[1];
    const json = Buffer.from(payload, "base64url").toString("utf-8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export async function GET() {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ authenticated: false });
  }
  const payload = decodePayload(token);
  if (!payload?.email) {
    return NextResponse.json({ authenticated: false });
  }
  return NextResponse.json({ authenticated: true, email: payload.email });
}
