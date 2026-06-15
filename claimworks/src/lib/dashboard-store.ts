import type { DashboardStore } from "./dashboard";

/**
 * Empty store: no data source wired yet. The dashboard pages render an honest
 * "connect a data source" state rather than fabricating numbers.
 */
export function emptyDashboardStore(): DashboardStore {
  return {
    async getBrokerageView() {
      return undefined;
    },
    async getDeclarationDetail() {
      return undefined;
    },
    async signOff() {
      throw new Error("No data source configured — set DATABASE_URL and wire the Drizzle-backed store");
    },
  };
}

/**
 * Resolve the dashboard data source. Returns a Drizzle-backed store (scoped to the user's
 * brokerage) when DATABASE_URL is set, otherwise the empty store so pages stay buildable and
 * truthful. The DB client is lazy-imported so module load never evaluates neon() without a URL.
 */
export async function getDashboard(email?: string): Promise<{ store: DashboardStore; brokerageId?: string }> {
  if (!process.env.DATABASE_URL) return { store: emptyDashboardStore() };
  const [{ db }, mod] = await Promise.all([import("@/db/client"), import("@/db/dashboard-store")]);
  const brokerageId = await mod.resolveBrokerageId(db, email);
  if (!brokerageId) return { store: emptyDashboardStore() };
  return { store: mod.drizzleDashboardStore(db, brokerageId), brokerageId };
}
