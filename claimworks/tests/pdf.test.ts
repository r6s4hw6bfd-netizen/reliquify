import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseEntriesCsv } from "../src/lib/parse";
import { genericMapping } from "../src/lib/mappings/generic";
import { analyzeBook } from "../src/lib/report";
import { renderBookAnalysisPdf } from "../src/lib/pdf";

const TODAY = new Date("2026-06-09");

describe("renderBookAnalysisPdf", () => {
  it("renders the sample book to a multi-page PDF", async () => {
    const { entries } = parseEntriesCsv(readFileSync("fixtures/sample-entries.csv", "utf8"), genericMapping);
    const analysis = analyzeBook(entries, TODAY);
    const pdf = await renderBookAnalysisPdf(analysis, { brokerName: "Test Brokerage Inc" });

    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // cover + importer table + deadlines + methodology
    expect(pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g)?.length).toBe(4);
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it("renders an empty book without crashing", async () => {
    const analysis = analyzeBook([], TODAY);
    const pdf = await renderBookAnalysisPdf(analysis, { brokerName: "Test Brokerage Inc" });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
