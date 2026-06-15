/**
 * Minimal magic-link auth (Task 5). HMAC-signed, stateless tokens — no auth vendor yet.
 *
 * Two token types share one signing scheme: a short-lived "magic" token emailed to the
 * user, and a longer-lived "session" token set as a cookie after the magic link is used.
 * Pure crypto (node:crypto), so it is fully testable without network. Replace with a real
 * IdP later if multi-tenant auth grows beyond brokerageId scoping.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type TokenType = "magic" | "session";

interface TokenPayload {
  email: string;
  typ: TokenType;
  exp: number; // epoch ms
}

const MAGIC_TTL_MS = 15 * 60_000; // 15 minutes
const SESSION_TTL_MS = 7 * 24 * 60 * 60_000; // 7 days

const enc = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const hmac = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest("base64url");

function signToken(email: string, typ: TokenType, ttlMs: number, secret: string, now: number): string {
  const payload = enc({ email: email.trim().toLowerCase(), typ, exp: now + ttlMs } satisfies TokenPayload);
  return `${payload}.${hmac(payload, secret)}`;
}

export interface VerifyResult {
  ok: boolean;
  email?: string;
  reason?: "malformed" | "bad_signature" | "expired" | "wrong_type";
}

function verifyToken(token: string, typ: TokenType, secret: string, now: number): VerifyResult {
  const dot = token.indexOf(".");
  if (dot < 1) return { ok: false, reason: "malformed" };
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };

  let obj: TokenPayload;
  try {
    obj = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (obj.typ !== typ) return { ok: false, reason: "wrong_type" };
  if (now > obj.exp) return { ok: false, reason: "expired" };
  return { ok: true, email: obj.email };
}

export const signMagicToken = (email: string, secret: string, now: number = Date.now()) =>
  signToken(email, "magic", MAGIC_TTL_MS, secret, now);

export const verifyMagicToken = (token: string, secret: string, now: number = Date.now()) =>
  verifyToken(token, "magic", secret, now);

export const signSession = (email: string, secret: string, now: number = Date.now()) =>
  signToken(email, "session", SESSION_TTL_MS, secret, now);

export const verifySession = (token: string, secret: string, now: number = Date.now()) =>
  verifyToken(token, "session", secret, now);

export const SESSION_COOKIE = "rq_session";
