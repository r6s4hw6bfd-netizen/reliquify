/**
 * CAPE Validation Result File parser + remediation queue (Task 3).
 *
 * CBP returns a Validation Result File after each CAPE upload. This module ingests it,
 * maps each rejection onto the originating entry, and deterministically dispositions it:
 *   - AUTO_FIXABLE   : we can regenerate a corrected row (entry-number normalization)
 *   - RESUBMIT_AS_IS : known CBP false-positive — our engine still says CAPE_NOW, so we
 *                      resubmit unchanged and DRAFT a dispute email (a human sends it)
 *   - HUMAN_REVIEW   : anything ambiguous or unrecognized (the safe default)
 *
 * Deterministic throughout: no LLM, every item carries reasons[] + engineVersion, and an
 * unrecognized rejection is never auto-resolved. The dispute email is drafted only.
 */
import { parse } from "csv-parse/sync";
import {
  CAPE_REJECTION_RULES,
  CBP_CAPE_CONTACT_EMAIL,
  ENGINE_VERSION,
} from "./codes";
import type { NormalizedEntry } from "./eligibility";
import { classifyEntry } from "./eligibility";
import { generateCape, type BrokerageRecord, type CapeGenerationResult } from "./cape";

export type RejectionDisposition = "AUTO_FIXABLE" | "RESUBMIT_AS_IS" | "HUMAN_REVIEW";

export interface ValidationResultRow {
  entryNumber: string;
  status: "accepted" | "rejected" | "unknown";
  rejectionCode?: string;
  rejectionReason?: string;
}

export interface RemediationItem {
  entryNumber: string;
  rejectionCode?: string;
  rejectionReason?: string;
  disposition: RejectionDisposition;
  /** Present when AUTO_FIXABLE produced a different (corrected) entry number. */
  correctedEntryNumber?: string;
  reasons: string[];
}

export interface DraftEmail {
  to: string;
  subject: string;
  body: string;
  entryNumbers: string[];
}

export interface RemediationReport {
  generatedAt: string;
  engineToday: string;
  engineVersion: string;
  total: number;
  accepted: number;
  rejected: number;
  byDisposition: Record<RejectionDisposition, number>;
  items: RemediationItem[];
}

export interface ValidationProcessResult {
  report: RemediationReport;
  /** Resubmission CAPE file(s) for AUTO_FIXABLE + RESUBMIT_AS_IS entries (re-validated). */
  resubmission: CapeGenerationResult;
  /** Drafted dispute email for RESUBMIT_AS_IS false positives — undefined if none. */
  cbpDraftEmail?: DraftEmail;
}

export interface ValidationColumnMapping {
  entryNumber: string;
  status?: string;
  rejectionCode?: string;
  rejectionReason?: string;
}

/** Default headers for CBP's validation result export — confirm against the real file. */
export const genericValidationMapping: ValidationColumnMapping = {
  entryNumber: "Entry Number",
  status: "Status",
  rejectionCode: "Rejection Code",
  rejectionReason: "Rejection Reason",
};

function normalizeStatus(v: string | undefined, hasRejection: boolean): ValidationResultRow["status"] {
  const s = (v ?? "").trim().toLowerCase();
  if (s.includes("accept") || s === "ok" || s === "valid" || s === "pass") return "accepted";
  if (s.includes("reject") || s.includes("error") || s.includes("fail") || s.includes("invalid")) return "rejected";
  // No usable status column but a rejection code/reason is present -> treat as rejected.
  if (!s && hasRejection) return "rejected";
  return "unknown";
}

export function parseValidationCsv(
  csvText: string,
  mapping: ValidationColumnMapping = genericValidationMapping,
): { rows: ValidationResultRow[]; warnings: string[] } {
  const raw: Record<string, string>[] = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });
  const warnings: string[] = [];
  const rows: ValidationResultRow[] = [];

  raw.forEach((r, i) => {
    const entryNumber = r[mapping.entryNumber]?.trim();
    if (!entryNumber) {
      warnings.push(`Row ${i + 2}: missing entry number — skipped`);
      return;
    }
    const rejectionCode = mapping.rejectionCode ? r[mapping.rejectionCode]?.trim() || undefined : undefined;
    const rejectionReason = mapping.rejectionReason ? r[mapping.rejectionReason]?.trim() || undefined : undefined;
    rows.push({
      entryNumber,
      status: normalizeStatus(mapping.status ? r[mapping.status] : undefined, !!(rejectionCode || rejectionReason)),
      rejectionCode,
      rejectionReason,
    });
  });

  return { rows, warnings };
}

const matchesAny = (patterns: readonly RegExp[], text: string) => patterns.some((p) => p.test(text));

/**
 * Disposition for a single rejected row. Deterministic; uses our own classification engine
 * (not an invented CBP rule) to decide whether an ineligibility rejection is a false positive.
 */
function dispositionFor(
  row: ValidationResultRow,
  original: NormalizedEntry | undefined,
  today: Date,
): { disposition: RejectionDisposition; reasons: string[]; correctedEntryNumber?: string } {
  const haystack = `${row.rejectionCode ?? ""} ${row.rejectionReason ?? ""}`.trim();
  const reasons: string[] = [];

  if (!original) {
    return {
      disposition: "HUMAN_REVIEW",
      reasons: [`Rejected (${haystack || "no reason given"}) but original entry not found in the book — cannot auto-remediate`],
    };
  }

  // Eligibility dispute: trust our deterministic engine over CBP's reject when they conflict.
  if (matchesAny(CAPE_REJECTION_RULES.eligibilityDisputePatterns, haystack)) {
    const cls = classifyEntry(original, today);
    if (cls.path === "CAPE_NOW") {
      reasons.push(`CBP rejected as ineligible ("${haystack}") but engine re-classifies CAPE_NOW: ${cls.reasons[0] ?? ""}`);
      reasons.push("Candidate false positive — resubmit unchanged and dispute with CBP");
      return { disposition: "RESUBMIT_AS_IS", reasons };
    }
    reasons.push(`CBP rejected as ineligible ("${haystack}") and engine agrees it is ${cls.path} — not a false positive`);
    return { disposition: "HUMAN_REVIEW", reasons };
  }

  // Format rejection: only auto-fixable if re-normalization actually changes the number.
  if (matchesAny(CAPE_REJECTION_RULES.autoFixablePatterns, haystack)) {
    const corrected = generateCape([original], { filerCode: original.filerCode }, { today });
    const fixed = corrected.files[0]?.entryNumbers[0];
    if (fixed && fixed !== row.entryNumber.trim()) {
      reasons.push(`Format rejection ("${haystack}") — re-normalized ${row.entryNumber} -> ${fixed}`);
      return { disposition: "AUTO_FIXABLE", reasons, correctedEntryNumber: fixed };
    }
    reasons.push(`Format rejection ("${haystack}") but entry number is already canonical — needs human review`);
    return { disposition: "HUMAN_REVIEW", reasons };
  }

  reasons.push(`Unrecognized rejection ("${haystack || "no reason given"}") — routed to human review`);
  return { disposition: "HUMAN_REVIEW", reasons };
}

function buildDraftEmail(items: RemediationItem[], brokerage: BrokerageRecord): DraftEmail {
  const entryNumbers = items.map((i) => i.entryNumber);
  const lines = items.map(
    (i) => `  - ${i.entryNumber}: CBP reason "${i.rejectionReason ?? i.rejectionCode ?? "n/a"}"; Reliquify engine classifies this entry CAPE_NOW (IEEPA Ch.99, within collection window, within Phase 1).`,
  );
  const body = [
    `To whom it may concern,`,
    ``,
    `Filer ${brokerage.filerCode}${brokerage.name ? ` (${brokerage.name})` : ""} is disputing the CAPE validation rejection of the following ${items.length} entr${items.length === 1 ? "y" : "ies"}, which we believe are eligible under CAPE Phase 1:`,
    ``,
    ...lines,
    ``,
    `These entries carry Chapter 99 IEEPA duty (9903.01/9903.02), fall within the collection window, and are unliquidated or within the Phase 1 liquidation lookback. We request re-review. Supporting entry detail is available on request.`,
    ``,
    `[DRAFT — review entry detail and send from the filer's account. Figures and eligibility are estimates subject to CBP determination.]`,
  ].join("\n");

  return {
    to: CBP_CAPE_CONTACT_EMAIL,
    subject: `CAPE validation rejection dispute — filer ${brokerage.filerCode} (${items.length} entr${items.length === 1 ? "y" : "ies"})`,
    body,
    entryNumbers,
  };
}

/**
 * Process a parsed validation result against the original book.
 * @param rows         parsed CBP validation result rows
 * @param originals    the original entries, keyed for lookup by entry number
 * @param brokerage    the filing brokerage (for the resubmission + dispute draft)
 */
export function processValidationResults(
  rows: ValidationResultRow[],
  originals: NormalizedEntry[],
  brokerage: BrokerageRecord,
  today: Date = new Date(),
): ValidationProcessResult {
  // Index originals by both the dashed and dash-stripped entry number so a rejection row
  // written either way still resolves back to the original.
  const byNumber = new Map<string, NormalizedEntry>();
  for (const e of originals) {
    const raw = e.entryNumber?.trim();
    if (!raw) continue;
    byNumber.set(raw, e);
    byNumber.set(raw.replace(/-/g, ""), e);
  }
  const lookup = (n: string): NormalizedEntry | undefined =>
    byNumber.get(n.trim()) ?? byNumber.get(n.trim().replace(/-/g, ""));

  const items: RemediationItem[] = [];
  let accepted = 0;
  for (const row of rows) {
    if (row.status === "accepted") {
      accepted++;
      continue;
    }
    if (row.status === "unknown") {
      items.push({
        entryNumber: row.entryNumber,
        rejectionCode: row.rejectionCode,
        rejectionReason: row.rejectionReason,
        disposition: "HUMAN_REVIEW",
        reasons: ["Validation status not recognized — human review"],
      });
      continue;
    }
    const { disposition, reasons, correctedEntryNumber } = dispositionFor(row, lookup(row.entryNumber), today);
    items.push({
      entryNumber: row.entryNumber,
      rejectionCode: row.rejectionCode,
      rejectionReason: row.rejectionReason,
      disposition,
      correctedEntryNumber,
      reasons,
    });
  }

  const byDisposition: Record<RejectionDisposition, number> = {
    AUTO_FIXABLE: 0,
    RESUBMIT_AS_IS: 0,
    HUMAN_REVIEW: 0,
  };
  for (const it of items) byDisposition[it.disposition]++;

  // Resubmission set: AUTO_FIXABLE + RESUBMIT_AS_IS originals, re-validated through generateCape.
  const resubmitNumbers = new Set(
    items
      .filter((i) => i.disposition === "AUTO_FIXABLE" || i.disposition === "RESUBMIT_AS_IS")
      .map((i) => i.entryNumber),
  );
  const resubmitOriginals = [...resubmitNumbers]
    .map((n) => lookup(n))
    .filter((e): e is NormalizedEntry => !!e);
  const resubmission = generateCape(resubmitOriginals, brokerage, { today });

  const falsePositives = items.filter((i) => i.disposition === "RESUBMIT_AS_IS");
  const cbpDraftEmail = falsePositives.length ? buildDraftEmail(falsePositives, brokerage) : undefined;

  const report: RemediationReport = {
    generatedAt: new Date().toISOString(),
    engineToday: today.toISOString().slice(0, 10),
    engineVersion: ENGINE_VERSION,
    total: rows.length,
    accepted,
    rejected: rows.length - accepted,
    byDisposition,
    items,
  };

  return { report, resubmission, cbpDraftEmail };
}
