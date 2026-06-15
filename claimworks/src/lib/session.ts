import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "./auth";

/** Resolve the signed-in user's email from the session cookie, or undefined. */
export async function getSessionEmail(): Promise<string | undefined> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return undefined;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return undefined;
  const r = verifySession(token, secret);
  return r.ok ? r.email : undefined;
}
