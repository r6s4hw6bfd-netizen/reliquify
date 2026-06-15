/**
 * Pure mapper: a parsed book (NormalizedEntry[]) -> nested insert payload for
 * importers / entries / entry_lines, with the engine's classification + quantification
 * denormalized onto each entry (claim path, deadline, est. duty/interest, reasons,
 * engineVersion). The DB-generated ids are filled in by the Drizzle glue; this layer is
 * pure so the row shaping + engine wiring is unit-testable without a database.
 *
 * Numeric/date columns are emitted as the strings Drizzle's numeric()/date() expect, and
 * missing numbers stay undefined (never coerced to "0").
 */
import type { NormalizedEntry as Entry } from "../lib/eligibility";
import { classifyEntry } from "../lib/eligibility";
import { quantifyEntry } from "../lib/quantify";
import { isIeepaCh99 } from "../lib/codes";

export interface EntryLineInsert {
  lineNumber: number;
  htsCode: string;
  chapter99Codes: string[];
  enteredValue?: string;
  dutyPaid?: string;
  ieepaDutyPaid?: string;
}

export interface EntryInsert {
  entryNumber: string;
  filerCode: string;
  entryType?: string;
  entryDate: string;
  portCode?: string;
  liquidationStatus: Entry["liquidationStatus"];
  liquidationDate?: string;
  reconciliationFlag: boolean;
  drawbackFlag: boolean;
  adcvdFlag: boolean;
  openProtestFlag: boolean;
  totalEnteredValue?: string;
  totalDutyPaid?: string;
  claimPath: string;
  claimDeadline?: string;
  estIeepaDuty: string;
  estInterest: string;
  engineReasons: string[];
  engineVersion: string;
  lines: EntryLineInsert[];
}

export interface ImporterInsert {
  name: string;
  iorNumber: string;
  entries: EntryInsert[];
}

const numStr = (n: number | undefined): string | undefined => (n == null ? undefined : String(n));
const day = (d: Date | undefined): string | undefined => (d ? d.toISOString().slice(0, 10) : undefined);

/** Sum the defined values of a line field; undefined when none are present (never 0). */
function sumDefined(entry: Entry, pick: (l: Entry["lines"][number]) => number | undefined): number | undefined {
  let total: number | undefined;
  for (const l of entry.lines) {
    const v = pick(l);
    if (v != null) total = (total ?? 0) + v;
  }
  return total;
}

function entryToInsert(entry: Entry, today: Date): EntryInsert {
  const cls = classifyEntry(entry, today);
  const q = quantifyEntry(entry, today);
  return {
    entryNumber: entry.entryNumber,
    filerCode: entry.filerCode,
    entryType: entry.entryType,
    entryDate: day(entry.entryDate)!,
    portCode: entry.portCode,
    liquidationStatus: entry.liquidationStatus,
    liquidationDate: day(entry.liquidationDate),
    reconciliationFlag: !!entry.reconciliationFlag,
    drawbackFlag: !!entry.drawbackFlag,
    adcvdFlag: !!entry.adcvdFlag,
    openProtestFlag: !!entry.openProtestFlag,
    totalEnteredValue: numStr(sumDefined(entry, (l) => l.enteredValue)),
    totalDutyPaid: numStr(sumDefined(entry, (l) => l.dutyPaid)),
    claimPath: cls.path,
    claimDeadline: day(cls.deadline),
    estIeepaDuty: String(q.ieepaDuty),
    estInterest: String(q.interestEstimate),
    engineReasons: cls.reasons,
    engineVersion: cls.engineVersion,
    lines: entry.lines.map((l) => ({
      lineNumber: l.lineNumber,
      htsCode: l.htsCode,
      chapter99Codes: isIeepaCh99(l.htsCode) ? [l.htsCode] : [],
      enteredValue: numStr(l.enteredValue),
      dutyPaid: numStr(l.dutyPaid),
      ieepaDutyPaid: numStr(l.ieepaDutyPaid),
    })),
  };
}

/** Group a parsed book into importer -> entries -> lines insert payloads. */
export function buildIngestPayload(entries: Entry[], today: Date = new Date()): ImporterInsert[] {
  const byImporter = new Map<string, ImporterInsert>();
  for (const e of entries) {
    const key = `${e.iorNumber}|${e.importerName}`;
    if (!byImporter.has(key)) byImporter.set(key, { name: e.importerName, iorNumber: e.iorNumber, entries: [] });
    byImporter.get(key)!.entries.push(entryToInsert(e, today));
  }
  return [...byImporter.values()];
}
