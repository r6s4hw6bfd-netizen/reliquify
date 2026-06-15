import { parse } from "csv-parse/sync";
import type { NormalizedEntry, NormalizedLine, LiquidationStatus } from "./eligibility";

/**
 * Column mapping: maps our canonical field names to the header names used by a
 * given ABI system's export (CargoWise, Magaya, Netchb, raw ACE reports...).
 * Each new broker = at most one new mapping file in src/lib/mappings/.
 */
export interface ColumnMapping {
  name: string;
  columns: {
    entryNumber: string;
    filerCode: string;
    importerName: string;
    iorNumber: string;
    entryType?: string;
    entryDate: string;
    portCode?: string;
    liquidationStatus?: string;
    liquidationDate?: string;
    lineNumber: string;
    htsCode: string;
    enteredValue?: string;
    dutyPaid?: string;
    ieepaDutyPaid?: string;
    reconciliationFlag?: string;
    drawbackFlag?: string;
    adcvdFlag?: string;
    openProtestFlag?: string;
  };
}

const truthy = (v: unknown) =>
  typeof v === "string" && ["y", "yes", "true", "1", "x"].includes(v.trim().toLowerCase());

function parseDate(v: unknown): Date | undefined {
  if (!v || typeof v !== "string" || !v.trim()) return undefined;
  const d = new Date(v.trim());
  return isNaN(d.getTime()) ? undefined : d;
}

function parseNum(v: unknown): number | undefined {
  if (v == null) return undefined;
  const s = String(v).replace(/[$,\s]/g, "");
  if (s === "") return undefined;
  const n = Number(s);
  return isNaN(n) ? undefined : n;
}

function normalizeLiqStatus(v: unknown): LiquidationStatus {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "unknown";
  if (s.includes("unliq") || s === "open" || s === "not liquidated") return "unliquidated";
  if (s.includes("reliq")) return "reliquidated";
  if (s.includes("liq")) return "liquidated";
  return "unknown";
}

export interface ParseResult {
  entries: NormalizedEntry[];
  warnings: string[];
}

/** One CSV row per entry LINE; rows sharing an entry number group into one entry. */
export function parseEntriesCsv(csvText: string, mapping: ColumnMapping): ParseResult {
  const rows: Record<string, string>[] = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });

  const warnings: string[] = [];
  const byEntry = new Map<string, NormalizedEntry>();
  const c = mapping.columns;

  rows.forEach((row, i) => {
    const entryNumber = row[c.entryNumber]?.trim();
    if (!entryNumber) {
      warnings.push(`Row ${i + 2}: missing entry number — skipped`);
      return;
    }

    const entryDate = parseDate(row[c.entryDate]);
    if (!entryDate) {
      warnings.push(`Row ${i + 2} (${entryNumber}): unparseable entry date "${row[c.entryDate]}" — skipped`);
      return;
    }

    let entry = byEntry.get(entryNumber);
    if (!entry) {
      entry = {
        entryNumber,
        filerCode: row[c.filerCode]?.trim() ?? "",
        importerName: row[c.importerName]?.trim() ?? "UNKNOWN IMPORTER",
        iorNumber: row[c.iorNumber]?.trim() ?? "",
        entryType: c.entryType ? row[c.entryType]?.trim() : undefined,
        entryDate,
        portCode: c.portCode ? row[c.portCode]?.trim() : undefined,
        liquidationStatus: normalizeLiqStatus(c.liquidationStatus ? row[c.liquidationStatus] : undefined),
        liquidationDate: c.liquidationDate ? parseDate(row[c.liquidationDate]) : undefined,
        reconciliationFlag: c.reconciliationFlag ? truthy(row[c.reconciliationFlag]) : false,
        drawbackFlag: c.drawbackFlag ? truthy(row[c.drawbackFlag]) : false,
        adcvdFlag: c.adcvdFlag ? truthy(row[c.adcvdFlag]) : false,
        openProtestFlag: c.openProtestFlag ? truthy(row[c.openProtestFlag]) : false,
        lines: [],
      };
      byEntry.set(entryNumber, entry);
    }

    const line: NormalizedLine = {
      lineNumber: parseNum(row[c.lineNumber]) ?? entry.lines.length + 1,
      htsCode: row[c.htsCode]?.trim() ?? "",
      enteredValue: c.enteredValue ? parseNum(row[c.enteredValue]) : undefined,
      dutyPaid: c.dutyPaid ? parseNum(row[c.dutyPaid]) : undefined,
      ieepaDutyPaid: c.ieepaDutyPaid ? parseNum(row[c.ieepaDutyPaid]) : undefined,
    };
    if (!line.htsCode) warnings.push(`Row ${i + 2} (${entryNumber}): missing HTS code on line ${line.lineNumber}`);
    entry.lines.push(line);
  });

  return { entries: [...byEntry.values()], warnings };
}
