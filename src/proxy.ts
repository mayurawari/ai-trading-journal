import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/session";

/**
 * Deployed, this app is reachable by anyone who finds the URL — and the Google
 * tokens live on the server, not in the visitor's browser. Without this gate a
 * stranger could POST to /api/extract to spend the Gemini quota, or to
 * /api/save to append rows to the sheet. Everything under /api is therefore
 * closed by default, so a route added later is protected the day it lands.
 *
 * (Next.js 16 renamed the `middleware` convention to `proxy`.)
 */
export const config = {
  matcher: ["/api/:path*"],
};

/**
 * Sign-in obviously cannot require a session. `/api/status` stays open too, but
 * answers `connected: false` without one, so the page can still render its
 * "Connect Google" button to a visitor who has not signed in yet.
 */
const OPEN_PATHS = ["/api/auth/google", "/api/status"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isOpen = OPEN_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  if (isOpen) return NextResponse.next();

  if (await isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  return NextResponse.json(
    { ok: false, error: "Sign in with Google first." },
    { status: 401 },
  );
}
