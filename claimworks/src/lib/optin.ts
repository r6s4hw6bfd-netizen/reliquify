/**
 * Importer opt-in flow (Task 4).
 *
 * Sends the white-labeled book-analysis summary + engagement-letter link to each
 * importer contact, tracks opt-in status, runs a capped reminder sequence (3 touches),
 * and records signature / unsubscribe. Every send and state change is written to the
 * audit log; unsubscribes are honored permanently.
 *
 * All side effects (email, e-sign, audit, persistence) are behind injected interfaces so
 * the sequencing logic stays deterministic and testable without network or DB. The e-sign
 * provider is stubbed pending vendor selection. This module never decides a dollar figure
 * or eligibility — it carries the engine's existing estimate through, labeled as such.
 */
import type { BrokerBranding } from "./pdf";

export type OptInStatus = "pending" | "sent" | "signed" | "declined";

export interface ImporterOptInState {
  iorNumber: string;
  importerName: string;
  contactEmail: string;
  contactName?: string;
  optInStatus: OptInStatus;
  /** Number of emails sent so far (initial + reminders). */
  touchesSent: number;
  lastTouchAt?: Date;
  unsubscribed: boolean;
  signedAt?: Date;
  envelopeId?: string;
  /** Headline estimate carried from the book analysis (always an estimate). */
  estRefundTotalPotential?: number;
  hasEstimatedFigures?: boolean;
}

export interface OptInConfig {
  /** Max emails per importer across the whole sequence (initial counts as 1). */
  maxTouches: number;
  /** Minimum days between touches. */
  reminderIntervalDays: number;
}

export const DEFAULT_OPT_IN_CONFIG: OptInConfig = { maxTouches: 3, reminderIntervalDays: 5 };

export type OptInAction =
  | "SEND_INITIAL"
  | "SEND_REMINDER"
  | "SKIP_SIGNED"
  | "SKIP_DECLINED"
  | "SKIP_UNSUBSCRIBED"
  | "SKIP_MAX_TOUCHES"
  | "SKIP_TOO_SOON";

const DAY_MS = 86_400_000;
const daysBetween = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / DAY_MS);

/** Deterministic: given a contact's state, what (if anything) do we send next. */
export function decideNextAction(
  s: ImporterOptInState,
  today: Date = new Date(),
  config: OptInConfig = DEFAULT_OPT_IN_CONFIG,
): OptInAction {
  if (s.unsubscribed) return "SKIP_UNSUBSCRIBED";
  if (s.optInStatus === "signed") return "SKIP_SIGNED";
  if (s.optInStatus === "declined") return "SKIP_DECLINED";
  if (s.touchesSent === 0) return "SEND_INITIAL";
  if (s.touchesSent >= config.maxTouches) return "SKIP_MAX_TOUCHES";
  if (s.lastTouchAt && daysBetween(today, s.lastTouchAt) < config.reminderIntervalDays) return "SKIP_TOO_SOON";
  return "SEND_REMINDER";
}

// --- Injected side-effect interfaces ----------------------------------------

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  send(m: EmailMessage): Promise<{ id: string }>;
}

export interface EnvelopeRequest {
  iorNumber: string;
  importerName: string;
  contactEmail: string;
}

/** E-sign provider seam (DocuSign/Dropbox Sign/etc — TBD). Stubbed for now. */
export interface ESignProvider {
  createEnvelope(req: EnvelopeRequest): Promise<{ envelopeId: string; signUrl: string }>;
}

export interface AuditEntry {
  actor: string;
  action: string;
  subjectTable?: string;
  subjectId?: string;
  detail?: unknown;
}

export interface AuditSink {
  log(e: AuditEntry): Promise<void> | void;
}

export interface OptInStore {
  getByIor(ior: string): Promise<ImporterOptInState | undefined>;
  save(s: ImporterOptInState): Promise<void>;
}

// --- Email construction ------------------------------------------------------

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export interface EngagementEmailInput {
  state: ImporterOptInState;
  branding: BrokerBranding;
  signUrl: string;
  unsubscribeUrl: string;
  isReminder: boolean;
}

/**
 * White-labeled engagement email. Estimates are labeled as estimates and no recovery is
 * promised (rule 5). The broker is the sender of record; Reliquify is not mentioned.
 */
export function buildEngagementEmail(input: EngagementEmailInput): EmailMessage {
  const { state, branding, signUrl, unsubscribeUrl, isReminder } = input;
  const broker = branding.brokerName;
  const greeting = state.contactName ? `Hi ${state.contactName},` : `Hello,`;
  const estLine =
    state.estRefundTotalPotential != null
      ? `Our analysis estimates up to ${usd(state.estRefundTotalPotential)} in potentially recoverable IEEPA tariffs for ${state.importerName}. This is an estimate, subject to CBP determination.`
      : `Our analysis identified potentially recoverable IEEPA tariffs for ${state.importerName}, subject to CBP determination.`;
  const lead = isReminder
    ? `A quick follow-up on the IEEPA tariff refund opportunity we sent over.`
    : `${broker} has completed a review of your import entries for potentially refundable IEEPA tariffs.`;

  const subject = isReminder
    ? `Reminder: your IEEPA tariff refund engagement — ${broker}`
    : `${broker}: potential IEEPA tariff refund for ${state.importerName}`;

  const text = [
    greeting,
    "",
    lead,
    estLine,
    "",
    `To begin a claim, review and sign the engagement letter: ${signUrl}`,
    "",
    `These figures are estimates and not legal advice; final amounts are determined by CBP.`,
    "",
    broker,
    "",
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");

  const html = `<div style="font-family:system-ui,Arial,sans-serif;max-width:560px;line-height:1.5">
  <p>${greeting}</p>
  <p>${lead}</p>
  <p><strong>${estLine}</strong></p>
  <p><a href="${signUrl}" style="background:${branding.primaryColor ?? "#1e3a5f"};color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Review &amp; sign the engagement letter</a></p>
  <p style="color:#666;font-size:12px">These figures are estimates and not legal advice; final amounts are determined by CBP.</p>
  <p>${broker}</p>
  <p style="color:#999;font-size:11px"><a href="${unsubscribeUrl}" style="color:#999">Unsubscribe</a></p>
</div>`;

  return { to: state.contactEmail, subject, html, text };
}

// --- Sequence orchestration --------------------------------------------------

export interface OptInDeps {
  email: EmailSender;
  esign: ESignProvider;
  audit: AuditSink;
  branding: BrokerBranding;
  /** Base URL for building unsubscribe links, e.g. https://app.brokerage.com */
  baseUrl: string;
  today?: Date;
  config?: OptInConfig;
}

export interface SequenceResultItem {
  iorNumber: string;
  action: OptInAction;
  emailId?: string;
  envelopeId?: string;
  signUrl?: string;
  touchesSent: number;
}

const unsubscribeUrlFor = (baseUrl: string, ior: string) =>
  `${baseUrl.replace(/\/$/, "")}/api/optin/unsubscribe?ior=${encodeURIComponent(ior)}`;

/**
 * Process a batch of contacts: send the initial email or a due reminder, mutating each
 * state in place. Sends and state changes are audit-logged. Returns one result per contact.
 */
export async function runOptInSequence(
  states: ImporterOptInState[],
  deps: OptInDeps,
): Promise<{ items: SequenceResultItem[] }> {
  const today = deps.today ?? new Date();
  const config = deps.config ?? DEFAULT_OPT_IN_CONFIG;
  const items: SequenceResultItem[] = [];

  for (const s of states) {
    const action = decideNextAction(s, today, config);
    if (action !== "SEND_INITIAL" && action !== "SEND_REMINDER") {
      items.push({ iorNumber: s.iorNumber, action, touchesSent: s.touchesSent });
      continue;
    }

    const { envelopeId, signUrl } = await deps.esign.createEnvelope({
      iorNumber: s.iorNumber,
      importerName: s.importerName,
      contactEmail: s.contactEmail,
    });
    const message = buildEngagementEmail({
      state: s,
      branding: deps.branding,
      signUrl,
      unsubscribeUrl: unsubscribeUrlFor(deps.baseUrl, s.iorNumber),
      isReminder: action === "SEND_REMINDER",
    });
    const { id: emailId } = await deps.email.send(message);

    s.touchesSent += 1;
    s.lastTouchAt = today;
    s.envelopeId = envelopeId;
    if (s.optInStatus === "pending") s.optInStatus = "sent";

    await deps.audit.log({
      actor: "optin-engine",
      action: action === "SEND_INITIAL" ? "optin.email.initial" : "optin.email.reminder",
      subjectTable: "importers",
      detail: { iorNumber: s.iorNumber, to: s.contactEmail, emailId, envelopeId, touchesSent: s.touchesSent },
    });

    items.push({ iorNumber: s.iorNumber, action, emailId, envelopeId, signUrl, touchesSent: s.touchesSent });
  }

  return { items };
}

/** Record a completed signature (called from the e-sign webhook). Idempotent. */
export async function recordSignature(
  s: ImporterOptInState,
  audit: AuditSink,
  opts: { envelopeId?: string; signedAt?: Date } = {},
): Promise<ImporterOptInState> {
  if (opts.envelopeId && s.envelopeId && opts.envelopeId !== s.envelopeId) {
    throw new Error(`Envelope mismatch for IOR ${s.iorNumber}: expected ${s.envelopeId}, got ${opts.envelopeId}`);
  }
  if (s.optInStatus === "signed") return s; // idempotent
  s.optInStatus = "signed";
  s.signedAt = opts.signedAt ?? new Date();
  await audit.log({
    actor: "esign-webhook",
    action: "optin.signed",
    subjectTable: "importers",
    detail: { iorNumber: s.iorNumber, envelopeId: s.envelopeId, signedAt: s.signedAt.toISOString() },
  });
  return s;
}

/** Honor an unsubscribe permanently. No further sends regardless of status. */
export async function handleUnsubscribe(s: ImporterOptInState, audit: AuditSink): Promise<ImporterOptInState> {
  s.unsubscribed = true;
  await audit.log({
    actor: "importer",
    action: "optin.unsubscribed",
    subjectTable: "importers",
    detail: { iorNumber: s.iorNumber },
  });
  return s;
}

// --- Default adapters --------------------------------------------------------

/** Resend-backed email sender. Lazy-imports `resend` so test/CLI paths needn't load it. */
export function createResendSender(apiKey: string, from: string): EmailSender {
  return {
    async send(m: EmailMessage) {
      const { Resend } = await import("resend");
      const resend = new Resend(apiKey);
      const { data, error } = await resend.emails.send({
        from,
        to: m.to,
        subject: m.subject,
        html: m.html,
        text: m.text,
      });
      if (error) throw new Error(`Resend send failed: ${error.message ?? String(error)}`);
      return { id: data?.id ?? "" };
    },
  };
}

/**
 * Stub e-sign provider — deterministic envelope id + sign URL derived from the IOR.
 * Replace with the real vendor adapter (DocuSign/Dropbox Sign) implementing ESignProvider.
 */
export function stubESignProvider(signBaseUrl = "https://esign.example"): ESignProvider {
  return {
    async createEnvelope(req: EnvelopeRequest) {
      const envelopeId = `stub-${req.iorNumber.replace(/[^A-Za-z0-9]/g, "")}`;
      return { envelopeId, signUrl: `${signBaseUrl.replace(/\/$/, "")}/sign/${envelopeId}` };
    },
  };
}

/** In-memory audit sink (tests / CLI). Production wires the Drizzle audit_log table. */
export function arrayAuditSink(): AuditSink & { entries: AuditEntry[] } {
  const entries: AuditEntry[] = [];
  return { entries, log: (e) => void entries.push(e) };
}

/** Ephemeral in-memory store. Production wires a Drizzle-backed OptInStore. */
export function inMemoryOptInStore(seed: ImporterOptInState[] = []): OptInStore {
  const map = new Map<string, ImporterOptInState>(seed.map((s) => [s.iorNumber, s]));
  return {
    async getByIor(ior) {
      return map.get(ior);
    },
    async save(s) {
      map.set(s.iorNumber, s);
    },
  };
}
