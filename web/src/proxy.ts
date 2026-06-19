import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Next.js 16 renamed Middleware to Proxy (functionality unchanged) — see
// node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md.
//
// Optimistic check only: reads the cookie, doesn't verify its signature (that's the
// Next.js docs' explicit two-tier model — the real check is FastAPI's get_current_user on
// every actual data request via src/auth.py). A stale/forged cookie gets past here but
// then 401s at the API.
const PUBLIC_ROUTES = ["/login", "/register"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get("session")?.value);
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);

  if (!hasSession && !isPublicRoute) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (hasSession && isPublicRoute) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
