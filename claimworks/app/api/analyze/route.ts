import { NextRequest, NextResponse } from "next/server";
import { parseEntriesCsv } from "@/lib/parse";
import { genericMapping } from "@/lib/mappings/generic";
import { analyzeBook } from "@/lib/report";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST a CSV (multipart "file" field or raw text/csv body) -> book analysis JSON. */
export async function POST(req: NextRequest) {
  try {
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

    const { entries, warnings } = parseEntriesCsv(csvText, genericMapping);
    const analysis = analyzeBook(entries);
    return NextResponse.json({ warnings, analysis });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Parse failure" }, { status: 500 });
  }
}
