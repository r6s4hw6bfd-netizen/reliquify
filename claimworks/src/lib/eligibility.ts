import {
  IEEPA_WINDOW,
  PHASE1_LIQUIDATION_LOOKBACK_DAYS,
  PROTEST_WINDOW_DAYS,
  ENGINE_VERSION,
  isIeepaCh99,
} from "./codes";

export type LiquidationStatus = "unliquidated" | "liquidated" | "reliquidated" | "unknown";

export interface NormalizedLine {
  lineNumber: number;
  htsCode: string;
  enteredValue?: number;
  dutyPaid?: number;
  /** Duty attributable specifically to the Ch.99 IEEPA line, when the export provides it. */
  ieepaDutyPaid?: number;
}

export interface NormalizedEntry {
  entryNumber: string;
  filerCode: string;
  importerName: string;
  iorNumber: string;
  entryType?: string;
  entryDate: Date;
  portCode?: string;
  liquidationStatus: LiquidationStatus;
  liquidationDate?: Date;
  reconciliationFlag?: boolean;
  drawbackFlag?: boolean;
  adcvdFlag?: boolean;
  openProtestFlag?: boolean;
  lines: NormalizedLine[];
}

export type ClaimPath =
  | "CAPE_NOW"
  | "CAPE_LATER_PHASE"
  | "PROTEST_REQUIRED"
  | "NEEDS_REVIEW"
  | "EXPIRED"
  | "NOT_IEEPA";

export interface Classification {
  entryNumber: string;
  path: ClaimPath;
  /** Hard deadline if one applies (protest window). */
  deadline?: Date;
  daysToDeadline?: number;
  reasons: string[];
  ieepaLineCount: number;
  engineVersion: string;
}

const DAY_MS = 86_400_000;
const daysBetween = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / DAY_MS);

/**
 * Deterministic claim-path classification. No LLM calls, no heuristics:
 * every branch maps to a written rule in codes.ts, and every result carries
 * its reasons for the audit trail. If a situation is ambiguous, the answer
 * is NEEDS_REVIEW — never a guess.
 */
export function classifyEntry(e: NormalizedEntry, today: Date = new Date()): Classification {
  const reasons: string[] = [];
  const ieepaLines = e.lines.filter((l) => isIeepaCh99(l.htsCode));

  const base = {
    entryNumber: e.entryNumber,
    ieepaLineCount: ieepaLines.length,
    engineVersion: ENGINE_VERSION,
  };

  if (ieepaLines.length === 0) {
    return { ...base, path: "NOT_IEEPA", reasons: ["No Ch.99 IEEPA HTS lines (9903.01/9903.02) on entry"] };
  }

  if (e.entryDate < IEEPA_WINDOW.start || e.entryDate > IEEPA_WINDOW.end) {
    reasons.push(`Entry date ${e.entryDate.toISOString().slice(0, 10)} outside IEEPA collection window`);
    return { ...base, path: "NEEDS_REVIEW", reasons };
  }

  // Phase 1 exclusions — these entry types are queued for later CAPE phases.
  if (e.reconciliationFlag) reasons.push("Reconciliation entry — excluded from CAPE Phase 1");
  if (e.drawbackFlag) reasons.push("Drawback-related entry — excluded from CAPE Phase 1");
  if (e.adcvdFlag || e.entryType === "03") reasons.push("AD/CVD entry — excluded from CAPE Phase 1");
  if (e.openProtestFlag) reasons.push("Open protest on entry — excluded from CAPE Phase 1");
  if (reasons.length > 0) {
    return { ...base, path: "CAPE_LATER_PHASE", reasons };
  }

  if (e.liquidationStatus === "unliquidated") {
    return { ...base, path: "CAPE_NOW", reasons: ["Unliquidated — CAPE Phase 1 eligible"] };
  }

  if (e.liquidationStatus === "liquidated" || e.liquidationStatus === "reliquidated") {
    if (!e.liquidationDate) {
      return { ...base, path: "NEEDS_REVIEW", reasons: ["Liquidated but liquidation date missing from export"] };
    }
    const since = daysBetween(today, e.liquidationDate);
    if (since <= PHASE1_LIQUIDATION_LOOKBACK_DAYS) {
      return {
        ...base,
        path: "CAPE_NOW",
        reasons: [`Liquidated ${since}d ago — within ${PHASE1_LIQUIDATION_LOOKBACK_DAYS}d Phase 1 lookback`],
      };
    }
    const deadline = new Date(e.liquidationDate.getTime() + PROTEST_WINDOW_DAYS * DAY_MS);
    const daysToDeadline = daysBetween(deadline, today);
    if (daysToDeadline >= 0) {
      return {
        ...base,
        path: "PROTEST_REQUIRED",
        deadline,
        daysToDeadline,
        reasons: [
          `Liquidated ${since}d ago — outside Phase 1 lookback`,
          `Protest window closes ${deadline.toISOString().slice(0, 10)} (${daysToDeadline}d left) — route to trade counsel`,
        ],
      };
    }
    return {
      ...base,
      path: "NEEDS_REVIEW",
      deadline,
      daysToDeadline,
      reasons: [
        "Past 180-day protest window",
        "Recovery may depend on later CAPE phases / litigation outcome — counsel review required, do not promise client",
      ],
    };
  }

  return { ...base, path: "NEEDS_REVIEW", reasons: ["Liquidation status unknown — request ACE liquidation report"] };
}
