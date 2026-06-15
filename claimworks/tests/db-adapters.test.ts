import { describe, it, expect } from "vitest";
import { importerRowToOptInState, optInStateToColumns, type ImporterOptInRow } from "../src/db/optin-mapping";
import { drizzleOptInStore } from "../src/db/optin-store";
import { drizzleAuditSink } from "../src/db/audit";
import type { ImporterOptInState } from "../src/lib/optin";

const row = (over: Partial<ImporterOptInRow> = {}): ImporterOptInRow => ({
  iorNumber: "12-3456789",
  name: "Gulf Coast Imports LLC",
  contactEmail: "ap@gulfcoast.example",
  contactName: "Dana",
  optInStatus: "sent",
  optInTouchesSent: 2,
  optInLastTouchAt: new Date("2026-06-10"),
  optInUnsubscribed: false,
  optInEnvelopeId: "stub-123456789",
  optInSignedAt: null,
  ...over,
});

describe("optin-mapping", () => {
  it("maps a row to state and back without losing fields", () => {
    const s = importerRowToOptInState(row());
    expect(s).toMatchObject({
      iorNumber: "12-3456789",
      importerName: "Gulf Coast Imports LLC",
      contactEmail: "ap@gulfcoast.example",
      optInStatus: "sent",
      touchesSent: 2,
      unsubscribed: false,
      envelopeId: "stub-123456789",
    });
    const cols = optInStateToColumns(s);
    expect(cols).toEqual({
      optInStatus: "sent",
      optInTouchesSent: 2,
      optInLastTouchAt: new Date("2026-06-10"),
      optInUnsubscribed: false,
      optInEnvelopeId: "stub-123456789",
      optInSignedAt: null,
    });
  });

  it("coerces nulls and unknown status defensively", () => {
    const s = importerRowToOptInState(row({ contactEmail: null, contactName: null, optInStatus: "weird", optInLastTouchAt: null }));
    expect(s.contactEmail).toBe("");
    expect(s.contactName).toBeUndefined();
    expect(s.optInStatus).toBe("pending");
    expect(s.lastTouchAt).toBeUndefined();
  });
});

// Minimal fake matching the structural Db shapes the adapters call.
function fakeDb(rows: ImporterOptInRow[]) {
  const calls = { updates: [] as Record<string, unknown>[], inserts: [] as Record<string, unknown>[] };
  const db = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: () => { calls.updates.push(v); return Promise.resolve(); } }) }),
    insert: () => ({ values: (v: Record<string, unknown>) => { calls.inserts.push(v); return Promise.resolve(); } }),
  };
  return { db, calls };
}

describe("drizzleOptInStore", () => {
  it("getByIor maps the row; missing row -> undefined", async () => {
    const present = fakeDb([row()]);
    const store = drizzleOptInStore(present.db as never);
    expect((await store.getByIor("12-3456789"))?.touchesSent).toBe(2);

    const absent = fakeDb([]);
    expect(await drizzleOptInStore(absent.db as never).getByIor("nope")).toBeUndefined();
  });

  it("save writes the opt-in columns", async () => {
    const f = fakeDb([]);
    const s: ImporterOptInState = importerRowToOptInState(row({ optInTouchesSent: 3, optInStatus: "signed", optInSignedAt: new Date("2026-06-15") }));
    await drizzleOptInStore(f.db as never).save(s);
    expect(f.calls.updates[0]).toMatchObject({ optInStatus: "signed", optInTouchesSent: 3 });
  });
});

describe("drizzleAuditSink", () => {
  it("inserts an audit row with nulled optionals", async () => {
    const f = fakeDb([]);
    await drizzleAuditSink(f.db as never).log({ actor: "optin-engine", action: "optin.email.initial" });
    expect(f.calls.inserts[0]).toMatchObject({ actor: "optin-engine", action: "optin.email.initial", subjectTable: null, subjectId: null, detail: null });
  });
});
