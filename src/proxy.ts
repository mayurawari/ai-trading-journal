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
 * Publicly open paths:
 * - Authentication & status routes
 * - News alerts and cron tasks
 * - Conversational AI (/api/chat) and save (/api/save), which support unauthenticated Demo Sandbox
 *   mode natively while strictly gating live Google Sheet writes behind OAuth session tokens.
 */
const OPEN_PATHS = [
  "/api/auth/google",
  "/api/auth/logout",
  "/api/status",
  "/api/cron",
  "/api/news",
  "/api/chat",
  "/api/save",
];

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
