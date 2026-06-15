import { describe, it, expect } from "vitest";
import { classifyEntry, NormalizedEntry } from "../src/lib/eligibility";
import { quantifyEntry } from "../src/lib/quantify";

const TODAY = new Date("2026-06-09");

const base = (over: Partial<NormalizedEntry>): NormalizedEntry => ({
  entryNumber: "T-1",
  filerCode: "ABC",
  importerName: "Test Co",
  iorNumber: "11-1111111",
  entryDate: new Date("2025-06-01"),
  liquidationStatus: "unliquidated",
  lines: [{ lineNumber: 1, htsCode: "9903.01.25", ieepaDutyPaid: 1000 }],
  ...over,
});

describe("classifyEntry", () => {
  it("flags non-IEEPA entries", () => {
    const r = classifyEntry(base({ lines: [{ lineNumber: 1, htsCode: "8501.10.4060", dutyPaid: 100 }] }), TODAY);
    expect(r.path).toBe("NOT_IEEPA");
  });

  it("unliquidated IEEPA entry -> CAPE_NOW", () => {
    expect(classifyEntry(base({}), TODAY).path).toBe("CAPE_NOW");
  });

  it("recently liquidated (within 80d) -> CAPE_NOW", () => {
    const r = classifyEntry(base({ liquidationStatus: "liquidated", liquidationDate: new Date("2026-04-20") }), TODAY);
    expect(r.path).toBe("CAPE_NOW");
  });

  it("liquidated 80-180d ago -> PROTEST_REQUIRED with deadline", () => {
    const r = classifyEntry(base({ liquidationStatus: "liquidated", liquidationDate: new Date("2026-01-15") }), TODAY);
    expect(r.path).toBe("PROTEST_REQUIRED");
    expect(r.daysToDeadline).toBeGreaterThan(0);
  });

  it("liquidated >180d ago -> NEEDS_REVIEW, never auto-expired", () => {
    const r = classifyEntry(base({ liquidationStatus: "liquidated", liquidationDate: new Date("2025-09-15") }), TODAY);
    expect(r.path).toBe("NEEDS_REVIEW");
  });

  it("AD/CVD entry -> CAPE_LATER_PHASE", () => {
    expect(classifyEntry(base({ adcvdFlag: true }), TODAY).path).toBe("CAPE_LATER_PHASE");
  });

  it("entry on last collection day (2026-02-23) stays in window", () => {
    expect(classifyEntry(base({ entryDate: new Date("2026-02-23") }), TODAY).path).toBe("CAPE_NOW");
  });

  it("entry after collection ceased (2026-02-24) -> NEEDS_REVIEW", () => {
    const r = classifyEntry(base({ entryDate: new Date("2026-02-24") }), TODAY);
    expect(r.path).toBe("NEEDS_REVIEW");
    expect(r.reasons[0]).toMatch(/outside IEEPA collection window/);
  });
});

describe("quantifyEntry", () => {
  it("uses line-level IEEPA duty when present, no estimate flag", () => {
    const q = quantifyEntry(base({}), TODAY);
    expect(q.ieepaDuty).toBe(1000);
    expect(q.dutyIsEstimate).toBe(false);
    expect(q.interestEstimate).toBeGreaterThan(0);
  });

  it("flags estimates when IEEPA duty column missing", () => {
    const q = quantifyEntry(base({ lines: [{ lineNumber: 1, htsCode: "9903.01.25", dutyPaid: 500 }] }), TODAY);
    expect(q.ieepaDuty).toBe(500);
    expect(q.dutyIsEstimate).toBe(true);
  });
});
