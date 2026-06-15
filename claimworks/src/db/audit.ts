/**
 * Drizzle-backed audit sink — writes every engine/user action to audit_log (rule 3).
 * Thin glue over the pure AuditSink interface so the opt-in flow and dashboard persist a
 * real, queryable audit trail in place of the in-memory test sink.
 */
import { auditLog } from "./schema";
import type { AuditSink, AuditEntry } from "../lib/optin";

type Db = { insert: (table: typeof auditLog) => { values: (v: Record<string, unknown>) => Promise<unknown> } };

export function drizzleAuditSink(db: Db): AuditSink {
  return {
    async log(e: AuditEntry) {
      await db.insert(auditLog).values({
        actor: e.actor,
        action: e.action,
        subjectTable: e.subjectTable ?? null,
        subjectId: e.subjectId ?? null,
        detail: e.detail ?? null,
      });
    },
  };
}
