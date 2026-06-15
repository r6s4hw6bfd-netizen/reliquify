import { NextRequest, NextResponse } from "next/server";
import { verifyMagicToken, signSession, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

/** GET ?token=... -> verify the magic token, set a session cookie, redirect to /dashboard. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const base = process.env.APP_BASE_URL ?? req.nextUrl.origin;
  const secret = process.env.AUTH_SECRET;

  if (!secret) return NextResponse.json({ error: "AUTH_SECRET is not configured" }, { status: 500 });
  const result = token ? verifyMagicToken(token, secret) : { ok: false, reason: "malformed" as const };
  if (!result.ok || !result.email) {
    return NextResponse.redirect(new URL(`/login?error=${result.ok ? "unknown" : result.reason}`, base));
  }

  const session = signSession(result.email, secret);
  const res = NextResponse.redirect(new URL("/dashboard", base));
  res.cookies.set(SESSION_COOKIE, session, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  return res;
}
