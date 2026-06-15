import { NextRequest, NextResponse } from "next/server";
import { parseEntriesCsv } from "@/lib/parse";
import { genericMapping } from "@/lib/mappings/generic";
import { parseValidationCsv, processValidationResults } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST multipart with two CSV files -> remediation queue + resubmission file(s) + CBP
 * dispute draft, as JSON. The broker resubmits / sends; this route never contacts CBP.
 *   form field "validation" : CBP validation result CSV
 *   form field "book"       : the original entries CSV
 *   query ?filer=ABC        : (required) brokerage filer code
 *   query &asOf=2026-06-15   : as-of date for re-classification
 */
export async function POST(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const filer = q.get("filer");
    if (!filer) return NextResponse.json({ error: "filer query param is required" }, { status: 400 });

    const form = await req.formData();
    const validation = form.get("validation");
    const bookFile = form.get("book");
    if (!(validation instanceof File) || !(bookFile instanceof File)) {
      return NextResponse.json({ error: "Attach both 'validation' and 'book' CSV files" }, { status: 400 });
    }

    const { rows, warnings } = parseValidationCsv(await validation.text());
    const { entries } = parseEntriesCsv(await bookFile.text(), genericMapping);
    const result = processValidationResults(rows, entries, { filerCode: filer }, asOf(q.get("asOf")));

    return NextResponse.json({ ...result, parserWarnings: warnings });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Remediation failure" }, { status: 500 });
  }
}

const asOf = (v: string | null) => (v ? new Date(v) : undefined);
