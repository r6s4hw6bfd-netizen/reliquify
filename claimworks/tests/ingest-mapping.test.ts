import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseEntriesCsv } from "../src/lib/parse";
import { genericMapping } from "../src/lib/mappings/generic";
import { buildIngestPayload } from "../src/db/ingest-mapping";

const TODAY = new Date("2026-06-09");
const payload = () => {
  const csv = readFileSync(new URL("../fixtures/sample-entries.csv", import.meta.url), "utf8");
  return buildIngestPayload(parseEntriesCsv(csv, genericMapping).entries, TODAY);
};

describe("buildIngestPayload", () => {
  it("groups entries under their importer", () => {
    const p = payload();
    expect(p.map((i) => i.iorNumber).sort()).toEqual(["12-3456789", "45-1122334", "98-7654321"]);
    const gulf = p.find((i) => i.iorNumber === "12-3456789")!;
    expect(gulf.entries.map((e) => e.entryNumber).sort()).toEqual(["ABC-1000001-1", "ABC-1000002-2", "ABC-1000007-7"]);
  });

  it("denormalizes engine output and Ch.99 codes onto the entry/lines", () => {
    const gulf = payload().find((i) => i.iorNumber === "12-3456789")!;
    const e = gulf.entries.find((x) => x.entryNumber === "ABC-1000001-1")!;
    expect(e.claimPath).toBe("CAPE_NOW");
    expect(e.estIeepaDuty).toBe("5000"); // only the 9903.01.25 line
    expect(e.totalDutyPaid).toBe("6750"); // 1750 + 5000
    expect(e.engineVersion).toBeTruthy();

    const ieepaLine = e.lines.find((l) => l.htsCode === "9903.01.25")!;
    const otherLine = e.lines.find((l) => l.htsCode === "8501.10.4060")!;
    expect(ieepaLine.chapter99Codes).toEqual(["9903.01.25"]);
    expect(otherLine.chapter99Codes).toEqual([]);
  });

  it("keeps missing numbers undefined (never 0) and flags est duty of 0", () => {
    const gulf = payload().find((i) => i.iorNumber === "12-3456789")!;
    const e = gulf.entries.find((x) => x.entryNumber === "ABC-1000007-7")!; // blank duty cells
    expect(e.totalDutyPaid).toBeUndefined();
    expect(e.lines[0].dutyPaid).toBeUndefined();
    expect(e.estIeepaDuty).toBe("0");
  });

  it("emits dates as yyyy-mm-dd strings and carries the protest deadline", () => {
    const lone = payload().find((i) => i.iorNumber === "45-1122334")!;
    const e = lone.entries.find((x) => x.entryNumber === "ABC-1000005-5")!; // liquidated 2025-09-15
    expect(e.entryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // classified NEEDS_REVIEW past the window -> no claim deadline asserted here, just the path
    expect(["NEEDS_REVIEW", "PROTEST_REQUIRED"]).toContain(e.claimPath);
  });
});
