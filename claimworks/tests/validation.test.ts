import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseEntriesCsv } from "../src/lib/parse";
import { genericMapping } from "../src/lib/mappings/generic";
import {
  parseValidationCsv,
  processValidationResults,
  type ValidationResultRow,
} from "../src/lib/validation";
import { CBP_CAPE_CONTACT_EMAIL } from "../src/lib/codes";
import type { NormalizedEntry } from "../src/lib/eligibility";

const TODAY = new Date("2026-06-09");
const BROKER = { filerCode: "ABC", name: "Acme Brokerage" };

const book = (): NormalizedEntry[] => {
  const csv = readFileSync(new URL("../fixtures/sample-entries.csv", import.meta.url), "utf8");
  return parseEntriesCsv(csv, genericMapping).entries;
};

const capeNow = (over: Partial<NormalizedEntry> = {}): NormalizedEntry => ({
  entryNumber: "ABC-1000001-1",
  filerCode: "ABC",
  importerName: "Test Co",
  iorNumber: "12-3456789",
  entryDate: new Date("2025-06-01"),
  liquidationStatus: "unliquidated",
  lines: [{ lineNumber: 1, htsCode: "9903.01.25", ieepaDutyPaid: 1000 }],
  ...over,
});

describe("parseValidationCsv", () => {
  it("normalizes status and pulls rejection code/reason", () => {
    const { rows } = parseValidationCsv(readFileSync(new URL("../fixtures/validation-result.csv", import.meta.url), "utf8"));
    expect(rows).toHaveLength(6);
    expect(rows[0].status).toBe("accepted");
    expect(rows[1].status).toBe("rejected");
    expect(rows[1].rejectionReason).toMatch(/format/i);
  });

  it("treats a row with a rejection reason but no status as rejected", () => {
    const { rows } = parseValidationCsv("Entry Number,Rejection Reason\nABC-1000001-1,Invalid entry number format\n", {
      entryNumber: "Entry Number",
      rejectionReason: "Rejection Reason",
    });
    expect(rows[0].status).toBe("rejected");
  });
});

describe("processValidationResults — disposition rules", () => {
  const run = (rows: ValidationResultRow[], originals = book()) =>
    processValidationResults(rows, originals, BROKER, TODAY);

  it("AUTO_FIXABLE when re-normalizing the entry number changes it", () => {
    const { report } = run([{ entryNumber: "ABC10000022", status: "rejected", rejectionReason: "Invalid entry number format" }]);
    expect(report.items[0].disposition).toBe("AUTO_FIXABLE");
    expect(report.items[0].correctedEntryNumber).toBe("ABC-1000002-2");
  });

  it("format rejection on an already-canonical number -> HUMAN_REVIEW", () => {
    const { report } = run([{ entryNumber: "ABC-1000001-1", status: "rejected", rejectionReason: "Invalid entry number format" }]);
    expect(report.items[0].disposition).toBe("HUMAN_REVIEW");
  });

  it("RESUBMIT_AS_IS when CBP says ineligible but engine says CAPE_NOW", () => {
    const { report, cbpDraftEmail } = run(
      [{ entryNumber: "ABC-1000007-7", status: "rejected", rejectionReason: "Entry not eligible for CAPE Phase 1" }],
    );
    expect(report.items[0].disposition).toBe("RESUBMIT_AS_IS");
    expect(cbpDraftEmail?.to).toBe(CBP_CAPE_CONTACT_EMAIL);
    expect(cbpDraftEmail?.entryNumbers).toContain("ABC-1000007-7");
  });

  it("HUMAN_REVIEW when CBP says ineligible and engine agrees (not CAPE_NOW)", () => {
    const { report } = run([{ entryNumber: "ABC-1000005-5", status: "rejected", rejectionReason: "Ineligible - liquidated outside window" }]);
    expect(report.items[0].disposition).toBe("HUMAN_REVIEW");
  });

  it("HUMAN_REVIEW for unrecognized rejection reasons", () => {
    const { report } = run([{ entryNumber: "ABC-1000007-7", status: "rejected", rejectionReason: "Filer code not authorized" }]);
    expect(report.items[0].disposition).toBe("HUMAN_REVIEW");
  });

  it("HUMAN_REVIEW when the original entry is not in the book", () => {
    const { report } = run([{ entryNumber: "ABC-9999999-9", status: "rejected", rejectionReason: "Invalid entry number format" }], [capeNow()]);
    expect(report.items[0].disposition).toBe("HUMAN_REVIEW");
    expect(report.items[0].reasons[0]).toMatch(/not found/i);
  });

  it("does not queue accepted rows for remediation", () => {
    const { report } = run([
      { entryNumber: "ABC-1000001-1", status: "accepted" },
      { entryNumber: "ABC-1000007-7", status: "rejected", rejectionReason: "Entry not eligible for CAPE Phase 1" },
    ]);
    expect(report.accepted).toBe(1);
    expect(report.items).toHaveLength(1);
  });
});

describe("processValidationResults — end to end on fixture", () => {
  it("dispositions every rejection and builds a re-validated resubmission + dispute draft", () => {
    const { rows } = parseValidationCsv(readFileSync(new URL("../fixtures/validation-result.csv", import.meta.url), "utf8"));
    const { report, resubmission, cbpDraftEmail } = processValidationResults(rows, book(), BROKER, TODAY);

    expect(report.total).toBe(6);
    expect(report.accepted).toBe(1);
    expect(report.rejected).toBe(5);
    expect(report.byDisposition).toEqual({ AUTO_FIXABLE: 1, RESUBMIT_AS_IS: 1, HUMAN_REVIEW: 3 });

    // Resubmission contains the AUTO_FIXABLE + RESUBMIT_AS_IS entries, re-validated as CAPE_NOW.
    const resubmitted = resubmission.files.flatMap((f) => f.entryNumbers);
    expect(resubmitted).toContain("ABC-1000002-2");
    expect(resubmitted).toContain("ABC-1000007-7");
    expect(resubmission.preflight.includedCount).toBe(2);

    // One drafted dispute email for the single false positive.
    expect(cbpDraftEmail?.entryNumbers).toEqual(["ABC-1000007-7"]);
    expect(cbpDraftEmail?.body).toMatch(/DRAFT/);
  });
});
