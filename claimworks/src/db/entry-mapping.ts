/**
 * Pure mappers between the entries/entry_lines row shape and the engine's NormalizedEntry,
 * and between declaration rows and the dashboard DeclarationRecord. Kept separate from the
 * Drizzle query glue so the translation that feeds the (tested) classification engine is
 * itself unit-testable without a database.
 */
import type { NormalizedEntry, NormalizedLine, LiquidationStatus } from "../lib/eligibility";
import type { DeclarationRecord, DeclarationStatus } from "../lib/dashboard";

/** Subset of an entries row the dashboard reconstruction needs. */
export interface EntryRow {
  id: string;
  entryNumber: string;
  filerCode: string;
  entryType: string | null;
  entryDate: string; // date column -> ISO yyyy-mm-dd
  portCode: string | null;
  liquidationStatus: LiquidationStatus;
  liquidationDate: string | null;
  reconciliationFlag: boolean;
  drawbackFlag: boolean;
  adcvdFlag: boolean;
  openProtestFlag: boolean;
}

/** Subset of an entry_lines row. numeric() columns arrive as strings (or null). */
export interface EntryLineRow {
  entryId: string;
  lineNumber: number;
  htsCode: string;
  enteredValue: string | null;
  dutyPaid: string | null;
  ieepaDutyPaid: string | null;
}

const num = (v: string | null): number | undefined => {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
};

const date = (v: string | null): Date | undefined => {
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
};

function lineRowToNormalized(row: EntryLineRow): NormalizedLine {
  return {
    lineNumber: row.lineNumber,
    htsCode: row.htsCode,
    enteredValue: num(row.enteredValue),
    dutyPaid: num(row.dutyPaid),
    ieepaDutyPaid: num(row.ieepaDutyPaid),
  };
}

/** Reconstruct a NormalizedEntry from its row + line rows, ready for the engine. */
export function entryRowToNormalized(entry: EntryRow, lineRows: EntryLineRow[]): NormalizedEntry {
  const lines = lineRows.filter((l) => l.entryId === entry.id).map(lineRowToNormalized);
  return {
    entryNumber: entry.entryNumber,
    filerCode: entry.filerCode,
    importerName: "", // joined separately by the caller
    iorNumber: "",
    entryType: entry.entryType ?? undefined,
    entryDate: date(entry.entryDate) ?? new Date(entry.entryDate),
    portCode: entry.portCode ?? undefined,
    liquidationStatus: entry.liquidationStatus,
    liquidationDate: date(entry.liquidationDate),
    reconciliationFlag: entry.reconciliationFlag,
    drawbackFlag: entry.drawbackFlag,
    adcvdFlag: entry.adcvdFlag,
    openProtestFlag: entry.openProtestFlag,
    lines,
  };
}

/** Attach importer identity (joined from the importers row) to a reconstructed entry. */
export function withImporter(e: NormalizedEntry, importerName: string, iorNumber: string): NormalizedEntry {
  return { ...e, importerName, iorNumber };
}

export interface DeclarationRow {
  id: string;
  status: string;
  entryCount: number;
  qcSignedBy: string | null;
  qcSignedAt: Date | null;
}

const DECLARATION_STATUSES: DeclarationStatus[] = [
  "draft", "ready", "filed", "partially_accepted", "accepted", "rejected", "paid",
];
const asDeclStatus = (s: string): DeclarationStatus =>
  DECLARATION_STATUSES.includes(s as DeclarationStatus) ? (s as DeclarationStatus) : "draft";

export function declarationRowToRecord(row: DeclarationRow, importerName: string, iorNumber: string): DeclarationRecord {
  return {
    id: row.id,
    importerName,
    iorNumber,
    status: asDeclStatus(row.status),
    entryCount: row.entryCount,
    qcSignedBy: row.qcSignedBy ?? undefined,
    qcSignedAt: row.qcSignedAt ?? undefined,
  };
}
