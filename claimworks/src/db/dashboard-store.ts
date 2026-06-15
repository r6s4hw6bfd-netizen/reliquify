/**
 * Drizzle-backed DashboardStore. Reads importers/entries/entry_lines/declarations for a
 * brokerage, reconstructs NormalizedEntry via the (tested) entry-mapping module, runs the
 * (tested) classification/quantification engine, and builds the view-models. Sign-off goes
 * through the (tested) QC gate and writes declarations + audit_log.
 *
 * The query glue here needs DB integration testing; the field mapping and all figure logic
 * it depends on are covered by unit tests (entry-mapping, dashboard, eligibility/quantify).
 */
import { eq, inArray } from "drizzle-orm";
import { brokerages, importers, entries, entryLines, declarations, declarationEntries, auditLog } from "./schema";
import {
  entryRowToNormalized,
  withImporter,
  declarationRowToRecord,
  type EntryRow,
  type EntryLineRow,
  type DeclarationRow,
} from "./entry-mapping";
import { analyzeBook } from "../lib/report";
import { classifyEntry } from "../lib/eligibility";
import { quantifyEntry } from "../lib/quantify";
import { buildBrokerageView, buildDeclarationDetail, signOffDeclaration, type DashboardStore } from "../lib/dashboard";

type Db = (typeof import("./client"))["db"];

/** Resolve a signed-in user's brokerage: by matching contact email, else the only/first. */
export async function resolveBrokerageId(db: Db, email?: string): Promise<string | undefined> {
  if (email) {
    const m = await db.select().from(brokerages).where(eq(brokerages.contactEmail, email));
    if (m[0]) return m[0].id;
  }
  const all = await db.select().from(brokerages);
  return all[0]?.id;
}

export function drizzleDashboardStore(db: Db, brokerageId: string, today: Date = new Date()): DashboardStore {
  return {
    async getBrokerageView() {
      const brs = await db.select().from(brokerages).where(eq(brokerages.id, brokerageId));
      if (!brs[0]) return undefined;

      const imps = await db.select().from(importers).where(eq(importers.brokerageId, brokerageId));
      const impById = new Map(imps.map((i) => [i.id, i]));
      const impIds = imps.map((i) => i.id);

      const ents = impIds.length ? await db.select().from(entries).where(inArray(entries.importerId, impIds)) : [];
      const entIds = ents.map((e) => e.id);
      const lines = entIds.length ? await db.select().from(entryLines).where(inArray(entryLines.entryId, entIds)) : [];

      const normalized = ents.map((e) => {
        const imp = impById.get(e.importerId);
        return withImporter(entryRowToNormalized(e as EntryRow, lines as EntryLineRow[]), imp?.name ?? "", imp?.iorNumber ?? "");
      });
      const analysis = analyzeBook(normalized, today);

      const declRows = await db.select().from(declarations).where(eq(declarations.brokerageId, brokerageId));
      const declRecords = declRows.map((d) => {
        const imp = d.importerId ? impById.get(d.importerId) : undefined;
        return declarationRowToRecord(d as DeclarationRow, imp?.name ?? "", imp?.iorNumber ?? "");
      });

      return buildBrokerageView(brs[0].name, analysis, declRecords);
    },

    async getDeclarationDetail(declarationId: string) {
      const drows = await db.select().from(declarations).where(eq(declarations.id, declarationId));
      if (!drows[0]) return undefined;
      const d = drows[0];
      const imp = d.importerId ? (await db.select().from(importers).where(eq(importers.id, d.importerId)))[0] : undefined;
      const record = declarationRowToRecord(d as DeclarationRow, imp?.name ?? "", imp?.iorNumber ?? "");

      const de = await db.select().from(declarationEntries).where(eq(declarationEntries.declarationId, declarationId));
      const entIds = de.map((x) => x.entryId);
      const ents = entIds.length ? await db.select().from(entries).where(inArray(entries.id, entIds)) : [];
      const lines = entIds.length ? await db.select().from(entryLines).where(inArray(entryLines.entryId, entIds)) : [];

      const entryVMs = ents.map((e) => {
        const n = withImporter(entryRowToNormalized(e as EntryRow, lines as EntryLineRow[]), record.importerName, record.iorNumber);
        const cls = classifyEntry(n, today);
        const q = quantifyEntry(n, today);
        return { entryNumber: e.entryNumber, path: cls.path, estTotal: q.total, isEstimate: q.dutyIsEstimate };
      });

      return buildDeclarationDetail(record, entryVMs, []);
    },

    async signOff(declarationId: string, signerName: string) {
      const drows = await db.select().from(declarations).where(eq(declarations.id, declarationId));
      if (!drows[0]) throw new Error("Declaration not found");
      const { declaration, audit } = signOffDeclaration(declarationRowToRecord(drows[0] as DeclarationRow, "", ""), signerName);

      await db
        .update(declarations)
        .set({ status: declaration.status, qcSignedBy: declaration.qcSignedBy, qcSignedAt: declaration.qcSignedAt })
        .where(eq(declarations.id, declarationId));
      await db.insert(auditLog).values({
        actor: audit.actor,
        action: audit.action,
        subjectTable: audit.subjectTable ?? null,
        subjectId: audit.subjectId ?? null,
        detail: audit.detail ?? null,
      });
      return declaration;
    },
  };
}
