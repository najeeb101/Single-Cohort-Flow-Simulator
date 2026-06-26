import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Auth is disabled for local demo use — src/auth.py::get_current_user no longer checks a
// token, so there's nothing left to gate here. Every route passes through.
export function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
