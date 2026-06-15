import { describe, it, expect } from "vitest";
import {
  entryRowToNormalized,
  withImporter,
  declarationRowToRecord,
  type EntryRow,
  type EntryLineRow,
  type DeclarationRow,
} from "../src/db/entry-mapping";
import { classifyEntry } from "../src/lib/eligibility";
import { quantifyEntry } from "../src/lib/quantify";

const TODAY = new Date("2026-06-09");

const entryRow = (over: Partial<EntryRow> = {}): EntryRow => ({
  id: "e1",
  entryNumber: "ABC-1000001-1",
  filerCode: "ABC",
  entryType: "01",
  entryDate: "2025-06-15",
  portCode: "5301",
  liquidationStatus: "unliquidated",
  liquidationDate: null,
  reconciliationFlag: false,
  drawbackFlag: false,
  adcvdFlag: false,
  openProtestFlag: false,
  ...over,
});

const lineRows: EntryLineRow[] = [
  { entryId: "e1", lineNumber: 1, htsCode: "9903.01.25", enteredValue: "50000", dutyPaid: "5000", ieepaDutyPaid: "5000" },
  { entryId: "e2", lineNumber: 1, htsCode: "8501.10.4060", enteredValue: "1", dutyPaid: "1", ieepaDutyPaid: null },
];

describe("entryRowToNormalized", () => {
  it("reconstructs an entry that the engine classifies + quantifies like the parsed CSV", () => {
    const e = withImporter(entryRowToNormalized(entryRow(), lineRows), "Gulf Coast Imports LLC", "12-3456789");
    expect(e.lines).toHaveLength(1); // only its own line, e2's line excluded
    expect(e.lines[0].ieepaDutyPaid).toBe(5000);
    expect(e.entryDate.toISOString().slice(0, 10)).toBe("2025-06-15");

    expect(classifyEntry(e, TODAY).path).toBe("CAPE_NOW");
    const q = quantifyEntry(e, TODAY);
    expect(q.ieepaDuty).toBe(5000);
    expect(q.dutyIsEstimate).toBe(false);
  });

  it("maps numeric nulls to undefined (never 0)", () => {
    const e = entryRowToNormalized(entryRow({ id: "e9" }), [
      { entryId: "e9", lineNumber: 1, htsCode: "9903.01.25", enteredValue: null, dutyPaid: null, ieepaDutyPaid: null },
    ]);
    expect(e.lines[0].dutyPaid).toBeUndefined();
    expect(e.lines[0].ieepaDutyPaid).toBeUndefined();
  });

  it("carries liquidation date through for the protest-window path", () => {
    const e = entryRowToNormalized(entryRow({ liquidationStatus: "liquidated", liquidationDate: "2026-01-15" }), lineRows);
    expect(e.liquidationDate?.toISOString().slice(0, 10)).toBe("2026-01-15");
    expect(classifyEntry(withImporter(e, "X", "1"), TODAY).path).toBe("PROTEST_REQUIRED");
  });
});

describe("declarationRowToRecord", () => {
  it("maps a declaration row + importer identity", () => {
    const row: DeclarationRow = { id: "d1", status: "ready", entryCount: 3, qcSignedBy: "Jamie", qcSignedAt: new Date("2026-06-15") };
    const r = declarationRowToRecord(row, "Gulf Coast Imports LLC", "12-3456789");
    expect(r).toMatchObject({ id: "d1", status: "ready", entryCount: 3, qcSignedBy: "Jamie", importerName: "Gulf Coast Imports LLC" });
  });

  it("defaults an unknown status to draft and null signer to undefined", () => {
    const r = declarationRowToRecord({ id: "d2", status: "weird", entryCount: 0, qcSignedBy: null, qcSignedAt: null }, "X", "1");
    expect(r.status).toBe("draft");
    expect(r.qcSignedBy).toBeUndefined();
  });
});
