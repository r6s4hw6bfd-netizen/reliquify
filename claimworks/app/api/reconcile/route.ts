import { NextRequest, NextResponse } from "next/server";
import { parseEntriesCsv } from "@/lib/parse";
import { genericMapping } from "@/lib/mappings/generic";
import { parseRev615, reconcileRefunds, type EntryRef } from "@/lib/rev615";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST multipart with two CSVs -> REV-615 reconciliation JSON (per-entry/-importer/-payment,
 * fee owed + broker/Reliquify split, funds-diverted + unmatched flags).
 *   form field "rev615" : CBP Trade CAPE Detail Refund report CSV
 *   form field "book"   : the original entries CSV
 *   query ?fee=5 &brokerSplit=60 : engagement terms (defaults 5% fee, 60% broker split)
 */
export async function POST(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const form = await req.formData();
    const rev615File = form.get("rev615");
    const bookFile = form.get("book");
    if (!(rev615File instanceof File) || !(bookFile instanceof File)) {
      return NextResponse.json({ error: "Attach both 'rev615' and 'book' CSV files" }, { status: 400 });
    }

    const { rows, warnings } = parseRev615(await rev615File.text());
    const refs: EntryRef[] = parseEntriesCsv(await bookFile.text(), genericMapping).entries.map((e) => ({
      entryNumber: e.entryNumber,
      iorNumber: e.iorNumber,
      importerName: e.importerName,
    }));
    const result = reconcileRefunds(rows, refs, {
      defaultFeeRatePct: Number(q.get("fee") ?? 5),
      brokerSplitPct: Number(q.get("brokerSplit") ?? 60),
    });

    return NextResponse.json({ ...result, parserWarnings: warnings });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Reconciliation failure" }, { status: 500 });
  }
}
