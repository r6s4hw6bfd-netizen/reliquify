import { NextRequest, NextResponse } from "next/server";
import { parseEntriesCsv } from "@/lib/parse";
import { genericMapping } from "@/lib/mappings/generic";
import { generateCape } from "@/lib/cape";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST a CSV (multipart "file" field or raw text/csv body) -> CAPE declaration file(s)
 * + pre-flight report as JSON. The broker uploads the returned CSV(s) through their own
 * ACE login; this route never submits to CBP.
 *
 * Query params:
 *   ?filer=ABC                       (required) brokerage filer code on record
 *   &asOf=2026-06-15                 as-of date for CAPE_NOW re-classification
 *   &optedIn=12-3456789,98-7654321   restrict to opted-in IORs (omit = all input opted in)
 */
export async function POST(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const filer = q.get("filer");
    if (!filer) return NextResponse.json({ error: "filer query param is required" }, { status: 400 });

    let csvText: string;
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Attach a CSV as the 'file' field" }, { status: 400 });
      }
      csvText = await file.text();
    } else {
      csvText = await req.text();
    }
    if (!csvText.trim()) return NextResponse.json({ error: "Empty CSV" }, { status: 400 });

    const asOf = q.get("asOf");
    const optedIn = q.get("optedIn")?.split(",").map((s) => s.trim()).filter(Boolean);
    const { entries, warnings } = parseEntriesCsv(csvText, genericMapping);
    const { files, preflight } = generateCape(entries, { filerCode: filer }, {
      today: asOf ? new Date(asOf) : undefined,
      optedInIors: optedIn,
    });

    return NextResponse.json({ preflight, files, parserWarnings: warnings });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "CAPE generation failure" }, { status: 500 });
  }
}
