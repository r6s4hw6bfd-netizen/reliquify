/**
 * Drizzle-backed OptInStore — reads/writes the opt-in columns on the importers row.
 * The field translation lives in optin-mapping.ts (pure, tested); this is just the glue.
 */
import { eq } from "drizzle-orm";
import { importers } from "./schema";
import { importerRowToOptInState, optInStateToColumns, type ImporterOptInRow } from "./optin-mapping";
import type { OptInStore } from "../lib/optin";

export interface OptInDb {
  select: () => { from: (t: typeof importers) => { where: (c: unknown) => Promise<ImporterOptInRow[]> } };
  update: (t: typeof importers) => { set: (v: Record<string, unknown>) => { where: (c: unknown) => Promise<unknown> } };
}

export function drizzleOptInStore(db: OptInDb): OptInStore {
  return {
    async getByIor(ior) {
      const rows = await db.select().from(importers).where(eq(importers.iorNumber, ior));
      return rows[0] ? importerRowToOptInState(rows[0]) : undefined;
    },
    async save(s) {
      await db.update(importers).set(optInStateToColumns(s)).where(eq(importers.iorNumber, s.iorNumber));
    },
  };
}
