import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseEntriesCsv } from "../src/lib/parse";
import { genericMapping } from "../src/lib/mappings/generic";
import { analyzeBook } from "../src/lib/report";
import {
  buildBrokerageView,
  buildDeclarationDetail,
  signOffDeclaration,
  type DeclarationRecord,
} from "../src/lib/dashboard";

const TODAY = new Date("2026-06-09");
const analysis = () => {
  const csv = readFileSync(new URL("../fixtures/sample-entries.csv", import.meta.url), "utf8");
  return analyzeBook(parseEntriesCsv(csv, genericMapping).entries, TODAY);
};

const decl = (over: Partial<DeclarationRecord> = {}): DeclarationRecord => ({
  id: "d1",
  importerName: "Gulf Coast Imports LLC",
  iorNumber: "12-3456789",
  status: "draft",
  entryCount: 3,
  ...over,
});

describe("buildBrokerageView", () => {
  it("ranks importers, counts the pipeline, and surfaces deadlines", () => {
    const vm = buildBrokerageView("Acme Customs", analysis(), [
      decl({ id: "d1", status: "draft" }),
      decl({ id: "d2", status: "filed" }),
      decl({ id: "d3", status: "filed" }),
    ]);
    expect(vm.brokerageName).toBe("Acme Customs");
    expect(vm.importers.length).toBeGreaterThan(0);
    // importers arrive pre-ranked by total potential
    const totals = vm.importers.map((i) => i.estRefundTotalPotential);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
    expect(vm.pipeline.draft).toBe(1);
    expect(vm.pipeline.filed).toBe(2);
    expect(vm.urgentDeadlines.every((u, i, arr) => i === 0 || arr[i - 1].daysLeft <= u.daysLeft)).toBe(true);
  });
});

describe("buildDeclarationDetail", () => {
  it("allows sign-off only for a non-empty unsigned draft", () => {
    expect(buildDeclarationDetail(decl(), []).canSignOff).toBe(true);
    expect(buildDeclarationDetail(decl({ status: "filed" }), []).canSignOff).toBe(false);
    expect(buildDeclarationDetail(decl({ qcSignedBy: "J. Broker" }), []).canSignOff).toBe(false);
    expect(buildDeclarationDetail(decl({ entryCount: 0 }), []).canSignOff).toBe(false);
  });
});

describe("signOffDeclaration (QC gate, rule 3)", () => {
  it("requires a human signer name", () => {
    expect(() => signOffDeclaration(decl(), "  ")).toThrow(/human signer/i);
  });

  it("moves a draft to ready and stamps the signer + audit", () => {
    const at = new Date("2026-06-15T10:00:00Z");
    const { declaration, audit } = signOffDeclaration(decl(), "Jamie Broker", at);
    expect(declaration.status).toBe("ready");
    expect(declaration.qcSignedBy).toBe("Jamie Broker");
    expect(declaration.qcSignedAt).toEqual(at);
    expect(audit.action).toBe("declaration.qc_signed");
    expect(audit.actor).toBe("Jamie Broker");
  });

  it("refuses to sign off a non-draft or empty declaration", () => {
    expect(() => signOffDeclaration(decl({ status: "filed" }), "Jamie")).toThrow(/draft/i);
    expect(() => signOffDeclaration(decl({ entryCount: 0 }), "Jamie")).toThrow(/no entries/i);
  });
});
