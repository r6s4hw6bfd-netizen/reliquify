import { INTEREST_EST_ANNUAL_RATE, isIeepaCh99 } from "./codes";
import type { NormalizedEntry } from "./eligibility";

export interface Quantification {
  entryNumber: string;
  /** Sum of duty attributable to IEEPA Ch.99 lines. */
  ieepaDuty: number;
  /** True when the export lacked line-level IEEPA duty and we had to infer. */
  dutyIsEstimate: boolean;
  /** Simple-interest ESTIMATE from entry date to today. Always an estimate. */
  interestEstimate: number;
  total: number;
}

export function quantifyEntry(e: NormalizedEntry, today: Date = new Date()): Quantification {
  const ieepaLines = e.lines.filter((l) => isIeepaCh99(l.htsCode));

  let ieepaDuty = 0;
  let dutyIsEstimate = false;

  for (const line of ieepaLines) {
    if (line.ieepaDutyPaid != null) {
      ieepaDuty += line.ieepaDutyPaid;
    } else if (line.dutyPaid != null) {
      // Export didn't break out the Ch.99 duty: take the line's duty as-is and flag it.
      ieepaDuty += line.dutyPaid;
      dutyIsEstimate = true;
    } else {
      dutyIsEstimate = true;
    }
  }

  const years = Math.max(0, (today.getTime() - e.entryDate.getTime()) / (365.25 * 86_400_000));
  const interestEstimate = round2(ieepaDuty * INTEREST_EST_ANNUAL_RATE * years);

  return {
    entryNumber: e.entryNumber,
    ieepaDuty: round2(ieepaDuty),
    dutyIsEstimate,
    interestEstimate,
    total: round2(ieepaDuty + interestEstimate),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
