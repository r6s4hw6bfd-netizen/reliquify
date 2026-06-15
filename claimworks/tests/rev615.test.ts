import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseEntriesCsv } from "../src/lib/parse";
import { genericMapping } from "../src/lib/mappings/generic";
import { parseRev615, reconcileRefunds, type EntryRef, type EngagementTerms } from "../src/lib/rev615";

const TERMS: EngagementTerms = { defaultFeeRatePct: 5, brokerSplitPct: 60 };

const refs = (): EntryRef[] => {
  const csv = readFileSync(new URL("../fixtures/sample-entries.csv", import.meta.url), "utf8");
  return parseEntriesCsv(csv, genericMapping).entries.map((e) => ({
    entryNumber: e.entryNumber,
    iorNumber: e.iorNumber,
    importerName: e.importerName,
  }));
};

const rows = () => parseRev615(readFileSync(new URL("../fixtures/rev615-refunds.csv", import.meta.url), "utf8")).rows;

describe("parseRev615", () => {
  it("parses amounts and flags funds-diverted rows", () => {
    const r = rows();
    expect(r).toHaveLength(6);
    expect(r[0].refundAmount).toBe(5000);
    expect(r[0].interestAmount).toBe(120.5);
    const diverted = r.find((x) => x.entryNumber === "ABC-1000005-5")!;
    expect(diverted.fundsDiverted).toBe(true);
  });

  it("leaves missing amounts undefined, never zero by default", () => {
    const { rows: r } = parseRev615("Entry Number,Refund Amount\nABC-1000001-1,\n");
    expect(r[0].refundAmount).toBeUndefined();
  });
});

describe("reconcileRefunds", () => {
  it("computes fee + broker/Reliquify split on received funds", () => {
    const { items } = reconcileRefunds(rows(), refs(), TERMS);
    const it = items.find((x) => x.entryNumber === "ABC-1000002-2")!;
    expect(it.status).toBe("paid");
    expect(it.received).toBe(12300);
    expect(it.feeOwed).toBe(615); // 5% of 12,300
    expect(it.brokerShare).toBe(369); // 60%
    expect(it.reliquifyShare).toBe(246); // 40%
  });

  it("flags funds-diverted rows with no fee and no funds received", () => {
    const { items } = reconcileRefunds(rows(), refs(), TERMS);
    const it = items.find((x) => x.entryNumber === "ABC-1000005-5")!;
    expect(it.status).toBe("funds_diverted");
    expect(it.received).toBe(0);
    expect(it.feeOwed).toBe(0);
  });

  it("marks zero-refund and unmatched rows distinctly", () => {
    const { items } = reconcileRefunds(rows(), refs(), TERMS);
    expect(items.find((x) => x.entryNumber === "ABC-1000003-3")!.status).toBe("no_refund");
    const unmatched = items.find((x) => x.entryNumber === "ZZZ-5000000-0")!;
    expect(unmatched.status).toBe("unmatched");
    expect(unmatched.matched).toBe(false);
  });

  it("matches consolidated ACH payments back to their entries", () => {
    const { byPayment } = reconcileRefunds(rows(), refs(), TERMS);
    const ach1 = byPayment.find((p) => p.paymentRef === "ACH-99001")!;
    expect(ach1.total).toBe(17420.5); // 5,120.50 + 12,300
    expect(ach1.entryNumbers.sort()).toEqual(["ABC-1000001-1", "ABC-1000002-2"]);
  });

  it("rolls up totals: received, diverted, unmatched", () => {
    const { totals } = reconcileRefunds(rows(), refs(), TERMS);
    expect(totals.received).toBe(18635.5);
    expect(totals.diverted).toBe(1);
    expect(totals.unmatched).toBe(1);
    expect(totals.brokerShare + totals.reliquifyShare).toBeCloseTo(totals.feeOwed, 2);
  });

  it("honors per-importer fee rate overrides", () => {
    const terms: EngagementTerms = { defaultFeeRatePct: 5, brokerSplitPct: 60, feeRatePctByIor: { "12-3456789": 8 } };
    const { items } = reconcileRefunds(rows(), refs(), terms);
    const it = items.find((x) => x.entryNumber === "ABC-1000002-2")!;
    expect(it.feeOwed).toBe(984); // 8% of 12,300
  });
});
