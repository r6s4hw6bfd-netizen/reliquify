/**
 * CAPE Declaration generator + pre-validation (Task 2).
 *
 * Turns opted-in CAPE_NOW entries into CBP-template CSV file(s), chunked to the
 * per-declaration entry cap and batched per importer, and runs a deterministic
 * pre-validation pass that replicates the known first-pass rejection causes
 * (~21% of CAPE submissions are accepted on first try, so this pass is the value).
 *
 * Like the rest of the engine this is fully deterministic: no LLM calls, every
 * exclusion carries a reason code, and a wrong row is never invented to fill a gap.
 * Anything ambiguous is excluded with a finding rather than guessed into a filing.
 */
import {
  CAPE_MAX_ENTRIES_PER_DECLARATION,
  CAPE_TEMPLATE,
  ENGINE_VERSION,
  type CapeColumnKey,
} from "./codes";
import type { NormalizedEntry } from "./eligibility";
import { classifyEntry } from "./eligibility";

/** The brokerage that will file through its own ACE login. Only the broker who
 *  filed the original entries may file the CAPE, so the filer code must match. */
export interface BrokerageRecord {
  filerCode: string;
  name?: string;
}

export type PreValidationCode =
  | "MISSING_ENTRY_NUMBER"
  | "ENTRY_NUMBER_FORMAT"
  | "FILER_CODE_MISMATCH"
  | "DUPLICATE_ENTRY"
  | "MISSING_IOR"
  | "NOT_OPTED_IN"
  | "NOT_CAPE_NOW";

export interface PreValidationFinding {
  /** Best available identifier for the row; "" only when even that is missing. */
  entryNumber: string;
  importerName: string;
  iorNumber: string;
  code: PreValidationCode;
  /** block = kept out of the CSV; warn = informational (e.g. duplicate removed). */
  severity: "block" | "warn";
  message: string;
}

export interface CapeFile {
  importerName: string;
  iorNumber: string;
  filerCode: string;
  fileName: string;
  /** 1-based position within this importer's chunk set. */
  chunkIndex: number;
  chunkCount: number;
  entryCount: number;
  entryNumbers: string[];
  csv: string;
}

export interface PreflightReport {
  generatedAt: string;
  engineToday: string;
  engineVersion: string;
  brokerageFilerCode: string;
  totalInput: number;
  includedCount: number;
  excludedCount: number;
  duplicatesRemoved: number;
  byCode: Record<PreValidationCode, number>;
  findings: PreValidationFinding[];
  perImporter: {
    importerName: string;
    iorNumber: string;
    included: number;
    excluded: number;
    fileCount: number;
  }[];
}

export interface CapeGenerationResult {
  files: CapeFile[];
  preflight: PreflightReport;
}

export interface CapeOptions {
  /** As-of date for the CAPE_NOW re-classification (must match the analysis run). */
  today?: Date;
  /** IORs whose importer has signed the engagement letter. Entries for any other
   *  IOR are excluded as NOT_OPTED_IN. Omit to treat every input entry as opted in
   *  (caller asserts it has already filtered to signed importers). */
  optedInIors?: Iterable<string>;
  /** Override the per-declaration entry cap (defaults to the regulated limit). */
  maxEntriesPerDeclaration?: number;
}

/** CBP entry number: 3-char filer code + 7-digit serial + 1 check digit, written
 *  with or without the conventional dashes (e.g. "ABC-1234567-8"). We validate the
 *  structure only — the check-digit arithmetic is not modeled here because an
 *  unverified algorithm would manufacture false rejections (rule 2). */
const ENTRY_NUMBER_RE = /^([A-Za-z0-9]{3})-?(\d{7})-?(\d)$/;

interface ParsedEntryNumber {
  filerCode: string;
  display: string;
}

function parseEntryNumber(raw: string): ParsedEntryNumber | undefined {
  const m = raw.trim().replace(/\s+/g, "").match(ENTRY_NUMBER_RE);
  if (!m) return undefined;
  const [, filer, serial, check] = m;
  return { filerCode: filer.toUpperCase(), display: `${filer.toUpperCase()}-${serial}-${check}` };
}

const PRE_VALIDATION_CODES: PreValidationCode[] = [
  "MISSING_ENTRY_NUMBER",
  "ENTRY_NUMBER_FORMAT",
  "FILER_CODE_MISMATCH",
  "DUPLICATE_ENTRY",
  "MISSING_IOR",
  "NOT_OPTED_IN",
  "NOT_CAPE_NOW",
];

const csvCell = (v: string): string =>
  /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

const slug = (s: string): string =>
  s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "unknown";

/**
 * Generate CAPE declaration CSV(s) with a pre-flight report.
 * Entries that fail any blocking check are kept OUT of the CSVs and listed in the
 * report; the broker fixes those before filing rather than having CBP reject them.
 */
export function generateCape(
  entries: NormalizedEntry[],
  brokerage: BrokerageRecord,
  opts: CapeOptions = {},
): CapeGenerationResult {
  const today = opts.today ?? new Date();
  const cap = opts.maxEntriesPerDeclaration ?? CAPE_MAX_ENTRIES_PER_DECLARATION;
  const brokerFiler = brokerage.filerCode.trim().toUpperCase();
  const optedIn = opts.optedInIors ? new Set([...opts.optedInIors].map((s) => s.trim())) : undefined;

  const findings: PreValidationFinding[] = [];
  const byCode = Object.fromEntries(PRE_VALIDATION_CODES.map((c) => [c, 0])) as Record<
    PreValidationCode,
    number
  >;
  const block = (e: Partial<NormalizedEntry>, code: PreValidationCode, message: string, severity: "block" | "warn" = "block") => {
    findings.push({
      entryNumber: e.entryNumber ?? "",
      importerName: e.importerName ?? "",
      iorNumber: e.iorNumber ?? "",
      code,
      severity,
      message,
    });
    byCode[code]++;
  };

  const seen = new Set<string>();
  let duplicatesRemoved = 0;
  // Eligible entries grouped per importer (keyed by IOR + name, as report.ts does).
  const perImporter = new Map<string, { importerName: string; iorNumber: string; filerCode: string; entryNumbers: string[] }>();

  for (const e of entries) {
    // 1. Entry number present + well-formed.
    if (!e.entryNumber?.trim()) {
      block(e, "MISSING_ENTRY_NUMBER", "Row has no entry number");
      continue;
    }
    const parsed = parseEntryNumber(e.entryNumber);
    if (!parsed) {
      block(e, "ENTRY_NUMBER_FORMAT", `Entry number "${e.entryNumber}" is not the 11-character filer+serial+check format CBP expects`);
      continue;
    }

    // 2. Filer code matches the brokerage on record (only that broker may file).
    const recordFiler = e.filerCode?.trim().toUpperCase();
    if (parsed.filerCode !== brokerFiler) {
      block(e, "FILER_CODE_MISMATCH", `Entry number filer code ${parsed.filerCode} ≠ brokerage filer code ${brokerFiler} — this broker cannot file this entry`);
      continue;
    }
    if (recordFiler && recordFiler !== brokerFiler) {
      block(e, "FILER_CODE_MISMATCH", `Entry filer-code field ${recordFiler} ≠ brokerage filer code ${brokerFiler}`);
      continue;
    }

    // 3. IOR present (the declaration is batched per importer of record).
    if (!e.iorNumber?.trim()) {
      block(e, "MISSING_IOR", "Entry has no importer-of-record number");
      continue;
    }

    // 4. Opt-in gate: only file for importers who signed the engagement letter.
    if (optedIn && !optedIn.has(e.iorNumber.trim())) {
      block(e, "NOT_OPTED_IN", `Importer ${e.iorNumber} has not opted in — excluded from filing`);
      continue;
    }

    // 5. Duplicate entry numbers collapse to one filing row.
    if (seen.has(parsed.display)) {
      duplicatesRemoved++;
      block(e, "DUPLICATE_ENTRY", `Entry ${parsed.display} already included — duplicate row dropped`, "warn");
      continue;
    }

    // 6. Re-classify as the final safety net: nothing but CAPE_NOW reaches a filing.
    const cls = classifyEntry(e, today);
    if (cls.path !== "CAPE_NOW") {
      block(e, "NOT_CAPE_NOW", `Entry classified ${cls.path}, not CAPE_NOW — ${cls.reasons[0] ?? "ineligible"}`);
      continue;
    }

    seen.add(parsed.display);
    const key = `${e.iorNumber.trim()}|${e.importerName}`;
    if (!perImporter.has(key)) {
      perImporter.set(key, { importerName: e.importerName, iorNumber: e.iorNumber.trim(), filerCode: brokerFiler, entryNumbers: [] });
    }
    perImporter.get(key)!.entryNumbers.push(parsed.display);
  }

  // Build chunked CSV files per importer (deterministic order).
  const header = CAPE_TEMPLATE.columns.map((c) => csvCell(c.header)).join(",");
  const files: CapeFile[] = [];
  const perImporterReport: PreflightReport["perImporter"] = [];

  for (const grp of perImporter.values()) {
    const sorted = [...grp.entryNumbers].sort();
    const chunks: string[][] = [];
    for (let i = 0; i < sorted.length; i += cap) chunks.push(sorted.slice(i, i + cap));

    chunks.forEach((chunk, idx) => {
      const rows = chunk.map((entryNumber) => {
        const values: Record<CapeColumnKey, string> = {
          entryNumber,
          iorNumber: grp.iorNumber,
          filerCode: grp.filerCode,
        };
        return CAPE_TEMPLATE.columns.map((c) => csvCell(values[c.key])).join(",");
      });
      files.push({
        importerName: grp.importerName,
        iorNumber: grp.iorNumber,
        filerCode: grp.filerCode,
        fileName: `cape_${grp.filerCode}_${slug(grp.iorNumber)}_${slug(grp.importerName)}_${idx + 1}of${chunks.length}.csv`,
        chunkIndex: idx + 1,
        chunkCount: chunks.length,
        entryCount: chunk.length,
        entryNumbers: chunk,
        csv: [header, ...rows].join("\r\n") + "\r\n",
      });
    });

    perImporterReport.push({
      importerName: grp.importerName,
      iorNumber: grp.iorNumber,
      included: grp.entryNumbers.length,
      excluded: 0,
      fileCount: chunks.length,
    });
  }

  // Attribute blocking exclusions back to importers where we know the IOR.
  for (const f of findings) {
    if (f.severity !== "block") continue;
    const row = perImporterReport.find((p) => p.iorNumber === f.iorNumber && f.iorNumber);
    if (row) row.excluded++;
  }

  const includedCount = [...perImporter.values()].reduce((s, g) => s + g.entryNumbers.length, 0);
  const excludedCount = findings.filter((f) => f.severity === "block").length;

  const preflight: PreflightReport = {
    generatedAt: new Date().toISOString(),
    engineToday: today.toISOString().slice(0, 10),
    engineVersion: ENGINE_VERSION,
    brokerageFilerCode: brokerFiler,
    totalInput: entries.length,
    includedCount,
    excludedCount,
    duplicatesRemoved,
    byCode,
    findings,
    perImporter: perImporterReport.sort((a, b) => b.included - a.included),
  };

  return { files, preflight };
}
