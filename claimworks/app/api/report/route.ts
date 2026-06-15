import { NextRequest, NextResponse } from "next/server";
import { parseEntriesCsv } from "@/lib/parse";
import { genericMapping } from "@/lib/mappings/generic";
import { analyzeBook } from "@/lib/report";
import { renderBookAnalysisPdf } from "@/lib/pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST a CSV (multipart "file" field or raw text/csv body) -> branded book-analysis PDF.
 * Branding via query params: ?broker=Name&color=%231e3a5f&logo=https://...
 */
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

    const q = req.nextUrl.searchParams;
    const { entries } = parseEntriesCsv(csvText, genericMapping);
    const analysis = analyzeBook(entries);
    const pdf = await renderBookAnalysisPdf(analysis, {
      brokerName: q.get("broker") ?? "Your Brokerage",
      primaryColor: q.get("color") ?? undefined,
      logoUrl: q.get("logo") ?? undefined,
    });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="book-analysis-${analysis.engineToday}.pdf"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Report failure" }, { status: 500 });
  }
}
