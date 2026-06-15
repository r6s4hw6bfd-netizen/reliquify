/**
 * Persistence factory: real Drizzle-backed store + audit sink when DATABASE_URL is set,
 * otherwise the in-memory stubs (so dev/preview without a database still build and run).
 * The DB client is lazy-imported so module load never evaluates neon() without a URL.
 */
import { inMemoryOptInStore, arrayAuditSink, type OptInStore, type AuditSink } from "../lib/optin";

export async function getOptInPersistence(): Promise<{ store: OptInStore; audit: AuditSink; persistent: boolean }> {
  if (!process.env.DATABASE_URL) {
    return { store: inMemoryOptInStore(), audit: arrayAuditSink(), persistent: false };
  }
  const [{ db }, { drizzleOptInStore }, { drizzleAuditSink }] = await Promise.all([
    import("./client"),
    import("./optin-store"),
    import("./audit"),
  ]);
  return {
    store: drizzleOptInStore(db as unknown as Parameters<typeof drizzleOptInStore>[0]),
    audit: drizzleAuditSink(db as unknown as Parameters<typeof drizzleAuditSink>[0]),
    persistent: true,
  };
}
