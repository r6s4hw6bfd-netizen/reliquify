import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseEntriesCsv } from "../src/lib/parse";
import { genericMapping } from "../src/lib/mappings/generic";
import { generateCape } from "../src/lib/cape";
import type { NormalizedEntry } from "../src/lib/eligibility";

const TODAY = new Date("2026-06-09");
const BROKER = { filerCode: "ABC", name: "Acme Brokerage" };

const capeNow = (over: Partial<NormalizedEntry> = {}, n = 1): NormalizedEntry => ({
  entryNumber: `ABC-100000${n}-${n}`,
  filerCode: "ABC",
  importerName: "Test Co",
  iorNumber: "12-3456789",
  entryDate: new Date("2025-06-01"),
  liquidationStatus: "unliquidated",
  lines: [{ lineNumber: 1, htsCode: "9903.01.25", ieepaDutyPaid: 1000 }],
  ...over,
});

describe("generateCape — happy path", () => {
  it("emits one CSV per importer with the regulated template header", () => {
    const { files, preflight } = generateCape([capeNow()], BROKER, { today: TODAY });
    expect(files).toHaveLength(1);
    const [header, row] = files[0].csv.trimEnd().split("\r\n");
    expect(header).toBe("Entry Number,Importer of Record Number,Filer Code");
    expect(row).toBe("ABC-1000001-1,12-3456789,ABC");
    expect(preflight.includedCount).toBe(1);
    expect(preflight.excludedCount).toBe(0);
    expect(preflight.engineVersion).toBeDefined();
  });

  it("normalizes undashed entry numbers to the dashed display form", () => {
    const { files } = generateCape([capeNow({ entryNumber: "ABC10000019" })], BROKER, { today: TODAY });
    expect(files[0].entryNumbers[0]).toBe("ABC-1000001-9");
  });

  it("batches per importer", () => {
    const a = capeNow({ iorNumber: "11-1111111", importerName: "A Co" }, 1);
    const b = capeNow({ iorNumber: "22-2222222", importerName: "B Co", entryNumber: "ABC-2000002-2" });
    const { files } = generateCape([a, b], BROKER, { today: TODAY });
    expect(files).toHaveLength(2);
    expect(new Set(files.map((f) => f.iorNumber))).toEqual(new Set(["11-1111111", "22-2222222"]));
  });

  it("chunks an importer above the per-declaration cap", () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      capeNow({ entryNumber: `ABC-100000${i}-${i}` }),
    );
    const { files } = generateCape(many, BROKER, { today: TODAY, maxEntriesPerDeclaration: 2 });
    expect(files).toHaveLength(3); // 2 + 2 + 1
    expect(files.map((f) => f.entryCount)).toEqual([2, 2, 1]);
    expect(files.every((f) => f.chunkCount === 3)).toBe(true);
    const all = files.flatMap((f) => f.entryNumbers);
    expect(new Set(all).size).toBe(5); // no entry duplicated across chunks
  });
});

describe("generateCape — pre-validation (known rejection causes)", () => {
  it("blocks malformed entry numbers", () => {
    const { files, preflight } = generateCape([capeNow({ entryNumber: "BADFORMAT" })], BROKER, { today: TODAY });
    expect(files).toHaveLength(0);
    expect(preflight.byCode.ENTRY_NUMBER_FORMAT).toBe(1);
  });

  it("blocks entries whose filer code is not the brokerage's", () => {
    const { preflight } = generateCape([capeNow({ entryNumber: "XYZ-1000001-1", filerCode: "XYZ" })], BROKER, { today: TODAY });
    expect(preflight.byCode.FILER_CODE_MISMATCH).toBe(1);
    expect(preflight.includedCount).toBe(0);
  });

  it("drops duplicate entry numbers but keeps one", () => {
    const { files, preflight } = generateCape([capeNow(), capeNow()], BROKER, { today: TODAY });
    expect(preflight.duplicatesRemoved).toBe(1);
    expect(preflight.byCode.DUPLICATE_ENTRY).toBe(1);
    expect(files[0].entryCount).toBe(1);
  });

  it("blocks non-CAPE_NOW rows leaking in (AD/CVD, liquidated-past-window, non-IEEPA)", () => {
    const adcvd = capeNow({ adcvdFlag: true, entryNumber: "ABC-1000001-1" });
    const nonIeepa = capeNow({ entryNumber: "ABC-1000002-2", lines: [{ lineNumber: 1, htsCode: "7318.15.8085", dutyPaid: 100 }] });
    const { files, preflight } = generateCape([adcvd, nonIeepa], BROKER, { today: TODAY });
    expect(files).toHaveLength(0);
    expect(preflight.byCode.NOT_CAPE_NOW).toBe(2);
  });

  it("blocks entries missing an IOR", () => {
    const { preflight } = generateCape([capeNow({ iorNumber: "" })], BROKER, { today: TODAY });
    expect(preflight.byCode.MISSING_IOR).toBe(1);
  });

  it("excludes importers that have not opted in", () => {
    const a = capeNow({ iorNumber: "11-1111111", entryNumber: "ABC-1000001-1" });
    const b = capeNow({ iorNumber: "22-2222222", entryNumber: "ABC-2000002-2" });
    const { files, preflight } = generateCape([a, b], BROKER, { today: TODAY, optedInIors: ["11-1111111"] });
    expect(files).toHaveLength(1);
    expect(files[0].iorNumber).toBe("11-1111111");
    expect(preflight.byCode.NOT_OPTED_IN).toBe(1);
  });
});

describe("generateCape — malformed fixture", () => {
  it("includes only the clean Gulf Coast entries and reports every rejection cause", () => {
    const csv = readFileSync(new URL("../fixtures/cape-malformed.csv", import.meta.url), "utf8");
    const { entries } = parseEntriesCsv(csv, genericMapping);
    const { files, preflight } = generateCape(entries, BROKER, { today: TODAY });

    // Three clean Gulf Coast CAPE_NOW entries, one file.
    expect(files).toHaveLength(1);
    expect(files[0].iorNumber).toBe("12-3456789");
    expect(files[0].entryCount).toBe(3);
    expect(files[0].entryNumbers).toEqual([
      "ABC-1000001-1",
      "ABC-1000002-2",
      "ABC-1000007-7",
    ]);

    // The repeated ABC-1000001-1 row is merged by the parser into one entry with
    // two lines, so it is one filing row here — not a CAPE-level duplicate.
    expect(preflight.byCode.DUPLICATE_ENTRY).toBe(0);
    expect(preflight.byCode.ENTRY_NUMBER_FORMAT).toBe(1);
    expect(preflight.byCode.FILER_CODE_MISMATCH).toBe(1);
    expect(preflight.byCode.NOT_CAPE_NOW).toBe(3);
    expect(preflight.byCode.MISSING_IOR).toBe(1);
    expect(preflight.includedCount).toBe(3);
    expect(preflight.excludedCount).toBe(6);
  });
});
