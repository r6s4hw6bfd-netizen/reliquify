import { describe, it, expect } from "vitest";
import {
  decideNextAction,
  runOptInSequence,
  buildEngagementEmail,
  recordSignature,
  handleUnsubscribe,
  stubESignProvider,
  arrayAuditSink,
  DEFAULT_OPT_IN_CONFIG,
  type ImporterOptInState,
  type EmailMessage,
  type EmailSender,
} from "../src/lib/optin";

const TODAY = new Date("2026-06-15");
const BRANDING = { brokerName: "Acme Customs Brokers", primaryColor: "#1e3a5f" };

const state = (over: Partial<ImporterOptInState> = {}): ImporterOptInState => ({
  iorNumber: "12-3456789",
  importerName: "Gulf Coast Imports LLC",
  contactEmail: "ap@gulfcoast.example",
  contactName: "Dana",
  optInStatus: "pending",
  touchesSent: 0,
  unsubscribed: false,
  estRefundTotalPotential: 17988,
  ...over,
});

const captureSender = () => {
  const sent: EmailMessage[] = [];
  const sender: EmailSender = {
    async send(m) {
      sent.push(m);
      return { id: `email-${sent.length}` };
    },
  };
  return { sent, sender };
};

const deps = (today = TODAY, extra = {}) => {
  const { sent, sender } = captureSender();
  const audit = arrayAuditSink();
  return {
    sent,
    audit,
    deps: { email: sender, esign: stubESignProvider(), audit, branding: BRANDING, baseUrl: "https://app.acme.example", today, ...extra },
  };
};

describe("decideNextAction", () => {
  it("first contact -> SEND_INITIAL", () => {
    expect(decideNextAction(state(), TODAY)).toBe("SEND_INITIAL");
  });
  it("signed/declined/unsubscribed are skipped", () => {
    expect(decideNextAction(state({ optInStatus: "signed" }), TODAY)).toBe("SKIP_SIGNED");
    expect(decideNextAction(state({ optInStatus: "declined" }), TODAY)).toBe("SKIP_DECLINED");
    expect(decideNextAction(state({ unsubscribed: true }), TODAY)).toBe("SKIP_UNSUBSCRIBED");
  });
  it("caps at maxTouches", () => {
    expect(decideNextAction(state({ touchesSent: 3, optInStatus: "sent" }), TODAY)).toBe("SKIP_MAX_TOUCHES");
  });
  it("reminder only after the interval has elapsed", () => {
    const recent = state({ touchesSent: 1, optInStatus: "sent", lastTouchAt: new Date("2026-06-13") });
    expect(decideNextAction(recent, TODAY)).toBe("SKIP_TOO_SOON");
    const old = state({ touchesSent: 1, optInStatus: "sent", lastTouchAt: new Date("2026-06-01") });
    expect(decideNextAction(old, TODAY)).toBe("SEND_REMINDER");
  });
});

describe("runOptInSequence", () => {
  it("sends the initial email, advances state, and audit-logs", async () => {
    const s = state();
    const { sent, audit, deps: d } = deps();
    const { items } = await runOptInSequence([s], d);

    expect(items[0].action).toBe("SEND_INITIAL");
    expect(sent).toHaveLength(1);
    expect(s.touchesSent).toBe(1);
    expect(s.optInStatus).toBe("sent");
    expect(s.envelopeId).toBe("stub-123456789");
    expect(audit.entries.some((e) => e.action === "optin.email.initial")).toBe(true);
  });

  it("respects the 3-touch cap across repeated runs", async () => {
    const s = state();
    // touch 1
    await runOptInSequence([s], deps(new Date("2026-06-01")).deps);
    // touch 2 (interval elapsed)
    await runOptInSequence([s], deps(new Date("2026-06-08")).deps);
    // touch 3
    await runOptInSequence([s], deps(new Date("2026-06-15")).deps);
    expect(s.touchesSent).toBe(3);
    // 4th attempt is capped
    const { items } = await runOptInSequence([s], deps(new Date("2026-06-25")).deps);
    expect(items[0].action).toBe("SKIP_MAX_TOUCHES");
    expect(s.touchesSent).toBe(3);
  });

  it("never emails an unsubscribed contact", async () => {
    const s = state({ unsubscribed: true });
    const { sent, deps: d } = deps();
    const { items } = await runOptInSequence([s], d);
    expect(items[0].action).toBe("SKIP_UNSUBSCRIBED");
    expect(sent).toHaveLength(0);
  });
});

describe("buildEngagementEmail", () => {
  it("white-labels, labels the estimate, and includes sign + unsubscribe links", () => {
    const m = buildEngagementEmail({
      state: state(),
      branding: BRANDING,
      signUrl: "https://esign.example/sign/stub-123456789",
      unsubscribeUrl: "https://app.acme.example/api/optin/unsubscribe?ior=12-3456789",
      isReminder: false,
    });
    expect(m.subject).toContain("Acme Customs Brokers");
    expect(m.html).not.toMatch(/Reliquify/i);
    expect(m.text).toMatch(/estimate/i);
    expect(m.text).not.toMatch(/guarantee|guaranteed|will recover/i);
    expect(m.html).toContain("https://esign.example/sign/stub-123456789");
    expect(m.html).toContain("unsubscribe?ior=12-3456789");
  });
});

describe("recordSignature / handleUnsubscribe", () => {
  it("records a signature once and is idempotent", async () => {
    const s = state({ optInStatus: "sent", envelopeId: "stub-123456789" });
    const audit = arrayAuditSink();
    await recordSignature(s, audit, { envelopeId: "stub-123456789", signedAt: TODAY });
    expect(s.optInStatus).toBe("signed");
    expect(s.signedAt).toEqual(TODAY);
    await recordSignature(s, audit, { envelopeId: "stub-123456789" });
    expect(audit.entries.filter((e) => e.action === "optin.signed")).toHaveLength(1);
  });

  it("rejects a mismatched envelope", async () => {
    const s = state({ optInStatus: "sent", envelopeId: "stub-123456789" });
    await expect(recordSignature(s, arrayAuditSink(), { envelopeId: "stub-OTHER" })).rejects.toThrow(/mismatch/i);
  });

  it("an unsubscribe stops all further sends", async () => {
    const s = state();
    const audit = arrayAuditSink();
    await handleUnsubscribe(s, audit);
    expect(s.unsubscribed).toBe(true);
    const { sent, deps: d } = deps();
    await runOptInSequence([s], d);
    expect(sent).toHaveLength(0);
    expect(audit.entries.some((e) => e.action === "optin.unsubscribed")).toBe(true);
  });

  it("a signed contact is not re-contacted", async () => {
    const s = state({ optInStatus: "signed", touchesSent: 1 });
    const { sent, deps: d } = deps();
    const { items } = await runOptInSequence([s], d);
    expect(items[0].action).toBe("SKIP_SIGNED");
    expect(sent).toHaveLength(0);
  });
});
