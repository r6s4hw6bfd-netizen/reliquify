import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { POST as analyzePOST } from "../app/api/analyze/route";
import { POST as capePOST } from "../app/api/cape/route";
import { POST as remediatePOST } from "../app/api/remediate/route";
import { POST as reconcilePOST } from "../app/api/reconcile/route";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

const csvReq = (url: string, body: string) =>
  new NextRequest(url, { method: "POST", headers: { "content-type": "text/csv" }, body });

const multipartReq = (url: string, files: Record<string, string>) => {
  const fd = new FormData();
  for (const [field, name] of Object.entries(files)) {
    fd.set(field, new File([fixture(name)], name, { type: "text/csv" }));
  }
  return new NextRequest(url, { method: "POST", body: fd });
};

describe("POST /api/analyze", () => {
  it("returns the book analysis for a posted CSV", async () => {
    const res = await analyzePOST(csvReq("http://localhost/api/analyze", fixture("sample-entries.csv")));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.analysis.totals.entries).toBe(7);
    expect(json.analysis.totals.importers).toBe(3);
  });

  it("400s on an empty body", async () => {
    const res = await analyzePOST(csvReq("http://localhost/api/analyze", ""));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/cape", () => {
  it("requires a filer", async () => {
    const res = await capePOST(csvReq("http://localhost/api/cape", fixture("cape-malformed.csv")));
    expect(res.status).toBe(400);
  });

  it("returns the pre-flight + files for opted-in CAPE_NOW entries", async () => {
    const res = await capePOST(csvReq("http://localhost/api/cape?filer=ABC&asOf=2026-06-09", fixture("cape-malformed.csv")));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.preflight.includedCount).toBe(3);
    expect(json.preflight.excludedCount).toBe(6);
    expect(json.files).toHaveLength(1);
  });
});

describe("POST /api/remediate", () => {
  it("dispositions a validation result against the book", async () => {
    const res = await remediatePOST(
      multipartReq("http://localhost/api/remediate?filer=ABC&asOf=2026-06-09", {
        validation: "validation-result.csv",
        book: "sample-entries.csv",
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.report.byDisposition).toEqual({ AUTO_FIXABLE: 1, RESUBMIT_AS_IS: 1, HUMAN_REVIEW: 3 });
    expect(json.cbpDraftEmail.entryNumbers).toEqual(["ABC-1000007-7"]);
  });
});

describe("POST /api/reconcile", () => {
  it("reconciles a REV-615 report against the book", async () => {
    const res = await reconcilePOST(
      multipartReq("http://localhost/api/reconcile?fee=5&brokerSplit=60", {
        rev615: "rev615-refunds.csv",
        book: "sample-entries.csv",
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.totals.received).toBe(18635.5);
    expect(json.totals.diverted).toBe(1);
    expect(json.totals.unmatched).toBe(1);
  });
});
