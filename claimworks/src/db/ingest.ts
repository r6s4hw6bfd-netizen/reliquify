/**
 * Drizzle-backed book ingestion: load a buildIngestPayload() result into Neon.
 * Upserts importers by IOR within the brokerage, inserts entries + lines, and writes an
 * audit_log row. Thin glue (needs DB integration testing); the payload shaping + all engine
 * figures it carries are unit-tested in ingest-mapping.
 */
import { eq, and } from "drizzle-orm";
import { importers, entries, entryLines, auditLog } from "./schema";
import type { ImporterInsert } from "./ingest-mapping";

type Db = (typeof import("./client"))["db"];

export interface IngestSummary {
  importers: number;
  entries: number;
  lines: number;
}

export async function ingestBook(db: Db, brokerageId: string, payload: ImporterInsert[]): Promise<IngestSummary> {
  const summary: IngestSummary = { importers: 0, entries: 0, lines: 0 };

  for (const imp of payload) {
    const existing = await db
      .select()
      .from(importers)
      .where(and(eq(importers.brokerageId, brokerageId), eq(importers.iorNumber, imp.iorNumber)));
    let importerId = existing[0]?.id;
    if (!importerId) {
      const [row] = await db
        .insert(importers)
        .values({ brokerageId, name: imp.name, iorNumber: imp.iorNumber })
        .returning({ id: importers.id });
      importerId = row.id;
      summary.importers++;
    }

    for (const e of imp.entries) {
      const [entryRow] = await db
        .insert(entries)
        .values({
          importerId,
          entryNumber: e.entryNumber,
          filerCode: e.filerCode,
          entryType: e.entryType,
          entryDate: e.entryDate,
          portCode: e.portCode,
          liquidationStatus: e.liquidationStatus,
          liquidationDate: e.liquidationDate,
          reconciliationFlag: e.reconciliationFlag,
          drawbackFlag: e.drawbackFlag,
          adcvdFlag: e.adcvdFlag,
          openProtestFlag: e.openProtestFlag,
          totalEnteredValue: e.totalEnteredValue,
          totalDutyPaid: e.totalDutyPaid,
          claimPath: e.claimPath as typeof entries.$inferInsert.claimPath,
          claimDeadline: e.claimDeadline,
          estIeepaDuty: e.estIeepaDuty,
          estInterest: e.estInterest,
          engineReasons: e.engineReasons,
          engineVersion: e.engineVersion,
        })
        .returning({ id: entries.id });
      summary.entries++;

      if (e.lines.length) {
        await db.insert(entryLines).values(
          e.lines.map((l) => ({
            entryId: entryRow.id,
            lineNumber: l.lineNumber,
            htsCode: l.htsCode,
            chapter99Codes: l.chapter99Codes,
            enteredValue: l.enteredValue,
            dutyPaid: l.dutyPaid,
            ieepaDutyPaid: l.ieepaDutyPaid,
          })),
        );
        summary.lines += e.lines.length;
      }
    }
  }

  await db.insert(auditLog).values({
    actor: "ingest",
    action: "book.ingested",
    subjectTable: "brokerages",
    subjectId: brokerageId,
    detail: summary,
  });

  return summary;
}
