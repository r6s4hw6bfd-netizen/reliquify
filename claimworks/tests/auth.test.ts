import { describe, it, expect } from "vitest";
import { signMagicToken, verifyMagicToken, signSession, verifySession } from "../src/lib/auth";

const SECRET = "test-secret-do-not-use";
const NOW = Date.parse("2026-06-15T12:00:00Z");

describe("magic + session tokens", () => {
  it("round-trips a magic token and normalizes the email", () => {
    const t = signMagicToken("  Dana@Example.com ", SECRET, NOW);
    const r = verifyMagicToken(t, SECRET, NOW + 1000);
    expect(r.ok).toBe(true);
    expect(r.email).toBe("dana@example.com");
  });

  it("rejects a tampered token", () => {
    const t = signMagicToken("dana@example.com", SECRET, NOW);
    const r = verifyMagicToken(t + "x", SECRET, NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("bad_signature");
  });

  it("rejects a token signed with a different secret", () => {
    const t = signMagicToken("dana@example.com", SECRET, NOW);
    expect(verifyMagicToken(t, "other-secret", NOW).ok).toBe(false);
  });

  it("expires a magic token after its TTL", () => {
    const t = signMagicToken("dana@example.com", SECRET, NOW);
    const r = verifyMagicToken(t, SECRET, NOW + 16 * 60_000);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("expired");
  });

  it("does not accept a magic token as a session token (type confusion)", () => {
    const magic = signMagicToken("dana@example.com", SECRET, NOW);
    const r = verifySession(magic, SECRET, NOW + 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("wrong_type");
  });

  it("a session token stays valid for days", () => {
    const s = signSession("dana@example.com", SECRET, NOW);
    expect(verifySession(s, SECRET, NOW + 6 * 24 * 60 * 60_000).ok).toBe(true);
  });
});
