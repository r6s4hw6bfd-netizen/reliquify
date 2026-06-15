/**
 * REV-615 (Trade CAPE Detail Refund report) ingestion + reconciliation (Task 6).
 *
 * Parses CBP's refund detail report, matches each refunded entry back to the book, flags
 * "Funds Diverted" rows, reconciles consolidated ACH payments to their entries, and computes
 * the fee owed per engagement terms (importer recovery rate × broker/Reliquify split).
 *
 * Deterministic; never invents a number (missing amounts stay undefined, unmatched rows are
 * flagged, fees are computed only on funds actually received — diverted funds earn no fee).
 * The exact REV-615 column layout is HUMAN-VERIFY config: confirm headers against the real
 * report before production use; unknown columns simply parse as undefined.
 */
import { parse } from "csv-parse/sync";
import { ENGINE_VERSION } from "./codes";

export interface Rev615ColumnMapping {
  entryNumber: string;
  refundAmount?: string;
  interestAmount?: string;
  paymentRef?: string;
  status?: string;
}

/** Default headers for CBP's Trade CAPE Detail Refund export — confirm against the real file. */
export const genericRev615Mapping: Rev615ColumnMapping = {
  entryNumber: "Entry Number",
  refundAmount: "Refund Amount",
  interestAmount: "Interest Amount",
  paymentRef: "ACH Trace Number",
  status: "Refund Status",
};

/** Status text indicating CBP diverted/offset the refund rather than paying it out. */
const FUNDS_DIVERTED_PATTERNS = [/divert/i, /offset/i, /applied to/i];

export interface Rev615Row {
  entryNumber: string;
  refundAmount?: number;
  interestAmount?: number;
  paymentRef?: string;
  status?: string;
  fundsDiverted: boolean;
}

function parseNum(v: unknown): number | undefined {
  if (v == null) return undefined;
  const s = String(v).replace(/[$,\s]/g, "");
  if (s === "") return undefined;
  const n = Number(s);
  return isNaN(n) ? undefined : n;
}

export function parseRev615(
  csvText: string,
  mapping: Rev615ColumnMapping = genericRev615Mapping,
): { rows: Rev615Row[]; warnings: string[] } {
  const raw: Record<string, string>[] = parse(csvText, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  const warnings: string[] = [];
  const rows: Rev615Row[] = [];

  raw.forEach((r, i) => {
    const entryNumber = r[mapping.entryNumber]?.trim();
    if (!entryNumber) {
      warnings.push(`Row ${i + 2}: missing entry number — skipped`);
      return;
    }
    const status = mapping.status ? r[mapping.status]?.trim() || undefined : undefined;
    rows.push({
      entryNumber,
      refundAmount: mapping.refundAmount ? parseNum(r[mapping.refundAmount]) : undefined,
      interestAmount: mapping.interestAmount ? parseNum(r[mapping.interestAmount]) : undefined,
      paymentRef: mapping.paymentRef ? r[mapping.paymentRef]?.trim() || undefined : undefined,
      status,
      fundsDiverted: !!status && FUNDS_DIVERTED_PATTERNS.some((p) => p.test(status)),
    });
  });

  return { rows, warnings };
}

// --- Reconciliation ----------------------------------------------------------

export interface EntryRef {
  entryNumber: string;
  iorNumber: string;
  importerName: string;
}

export interface EngagementTerms {
  /** Recovery-fee rate (%) per importer IOR; falls back to defaultFeeRatePct. */
  feeRatePctByIor?: Record<string, number>;
  defaultFeeRatePct: number;
  /** Share of the recovery fee retained by the broker (%); remainder is Reliquify's. */
  brokerSplitPct: number;
}

export type ReconStatus = "paid" | "funds_diverted" | "no_refund" | "unmatched";

export interface ReconItem {
  entryNumber: string;
  matched: boolean;
  iorNumber?: string;
  importerName?: string;
  refundAmount: number;
  interestAmount: number;
  /** Funds actually received by the importer (0 when diverted). */
  received: number;
  fundsDiverted: boolean;
  status: ReconStatus;
  feeOwed: number;
  brokerShare: number;
  reliquifyShare: number;
  paymentRef?: string;
  reasons: string[];
}

export interface ReconciliationResult {
  generatedAt: string;
  engineToday: string;
  engineVersion: string;
  totals: {
    refund: number;
    interest: number;
    received: number;
    feeOwed: number;
    brokerShare: number;
    reliquifyShare: number;
    diverted: number;
    unmatched: number;
  };
  items: ReconItem[];
  byImporter: {
    iorNumber: string;
    importerName: string;
    received: number;
    feeOwed: number;
    brokerShare: number;
    reliquifyShare: number;
    divertedCount: number;
  }[];
  byPayment: { paymentRef: string; total: number; entryNumbers: string[] }[];
  warnings: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Reconcile REV-615 rows against the book. Fees accrue only on funds actually received;
 * diverted or unmatched rows are flagged and earn nothing.
 */
export function reconcileRefunds(
  rows: Rev615Row[],
  entries: EntryRef[],
  terms: EngagementTerms,
  today: Date = new Date(),
): ReconciliationResult {
  const byNumber = new Map<string, EntryRef>();
  for (const e of entries) {
    const raw = e.entryNumber?.trim();
    if (!raw) continue;
    byNumber.set(raw, e);
    byNumber.set(raw.replace(/-/g, ""), e);
  }
  const lookup = (n: string) => byNumber.get(n.trim()) ?? byNumber.get(n.trim().replace(/-/g, ""));

  const warnings: string[] = [];
  const items: ReconItem[] = rows.map((row) => {
    const entry = lookup(row.entryNumber);
    const refundAmount = row.refundAmount ?? 0;
    const interestAmount = row.interestAmount ?? 0;
    const gross = round2(refundAmount + interestAmount);
    const reasons: string[] = [];

    if (!entry) {
      warnings.push(`Refund row ${row.entryNumber} did not match any entry in the book`);
      return {
        entryNumber: row.entryNumber, matched: false, refundAmount, interestAmount, received: 0,
        fundsDiverted: row.fundsDiverted, status: "unmatched", feeOwed: 0, brokerShare: 0,
        reliquifyShare: 0, paymentRef: row.paymentRef,
        reasons: ["No matching entry in the book — cannot attribute refund or fee"],
      };
    }

    if (row.fundsDiverted) {
      reasons.push(`CBP diverted/offset the refund ("${row.status}") — no funds received, no fee`);
      return {
        entryNumber: row.entryNumber, matched: true, iorNumber: entry.iorNumber, importerName: entry.importerName,
        refundAmount, interestAmount, received: 0, fundsDiverted: true, status: "funds_diverted",
        feeOwed: 0, brokerShare: 0, reliquifyShare: 0, paymentRef: row.paymentRef, reasons,
      };
    }

    if (gross <= 0) {
      reasons.push("No refund amount on this row");
      return {
        entryNumber: row.entryNumber, matched: true, iorNumber: entry.iorNumber, importerName: entry.importerName,
        refundAmount, interestAmount, received: 0, fundsDiverted: false, status: "no_refund",
        feeOwed: 0, brokerShare: 0, reliquifyShare: 0, paymentRef: row.paymentRef, reasons,
      };
    }

    const feeRate = (terms.feeRatePctByIor?.[entry.iorNumber] ?? terms.defaultFeeRatePct) / 100;
    const feeOwed = round2(gross * feeRate);
    const brokerShare = round2(feeOwed * (terms.brokerSplitPct / 100));
    const reliquifyShare = round2(feeOwed - brokerShare);
    reasons.push(`Received ${gross}; fee ${terms.feeRatePctByIor?.[entry.iorNumber] ?? terms.defaultFeeRatePct}% = ${feeOwed} (broker ${brokerShare} / Reliquify ${reliquifyShare})`);

    return {
      entryNumber: row.entryNumber, matched: true, iorNumber: entry.iorNumber, importerName: entry.importerName,
      refundAmount, interestAmount, received: gross, fundsDiverted: false, status: "paid",
      feeOwed, brokerShare, reliquifyShare, paymentRef: row.paymentRef, reasons,
    };
  });

  // Per-importer rollup.
  const impMap = new Map<string, ReconciliationResult["byImporter"][number]>();
  for (const it of items) {
    if (!it.matched || !it.iorNumber) continue;
    const key = it.iorNumber;
    if (!impMap.has(key)) {
      impMap.set(key, { iorNumber: it.iorNumber, importerName: it.importerName ?? "", received: 0, feeOwed: 0, brokerShare: 0, reliquifyShare: 0, divertedCount: 0 });
    }
    const r = impMap.get(key)!;
    r.received = round2(r.received + it.received);
    r.feeOwed = round2(r.feeOwed + it.feeOwed);
    r.brokerShare = round2(r.brokerShare + it.brokerShare);
    r.reliquifyShare = round2(r.reliquifyShare + it.reliquifyShare);
    if (it.fundsDiverted) r.divertedCount++;
  }

  // Consolidated ACH payment matching: group received funds by payment reference.
  const payMap = new Map<string, { paymentRef: string; total: number; entryNumbers: string[] }>();
  for (const it of items) {
    if (!it.paymentRef || it.received <= 0) continue;
    if (!payMap.has(it.paymentRef)) payMap.set(it.paymentRef, { paymentRef: it.paymentRef, total: 0, entryNumbers: [] });
    const p = payMap.get(it.paymentRef)!;
    p.total = round2(p.total + it.received);
    p.entryNumbers.push(it.entryNumber);
  }

  const totals = items.reduce(
    (t, it) => ({
      refund: round2(t.refund + it.refundAmount),
      interest: round2(t.interest + it.interestAmount),
      received: round2(t.received + it.received),
      feeOwed: round2(t.feeOwed + it.feeOwed),
      brokerShare: round2(t.brokerShare + it.brokerShare),
      reliquifyShare: round2(t.reliquifyShare + it.reliquifyShare),
      diverted: t.diverted + (it.fundsDiverted ? 1 : 0),
      unmatched: t.unmatched + (it.matched ? 0 : 1),
    }),
    { refund: 0, interest: 0, received: 0, feeOwed: 0, brokerShare: 0, reliquifyShare: 0, diverted: 0, unmatched: 0 },
  );

  return {
    generatedAt: new Date().toISOString(),
    engineToday: today.toISOString().slice(0, 10),
    engineVersion: ENGINE_VERSION,
    totals,
    items,
    byImporter: [...impMap.values()].sort((a, b) => b.received - a.received),
    byPayment: [...payMap.values()],
    warnings,
  };
}
