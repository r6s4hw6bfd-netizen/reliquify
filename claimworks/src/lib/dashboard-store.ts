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
 * Resolve the dashboard data store. Production wires a Drizzle-backed store scoped by
 * brokerageId (importers/declarations/entries + audit_log writes on sign-off); until then
 * the empty store keeps the pages buildable and truthful.
 */
export function getDashboardStore(): DashboardStore {
  return emptyDashboardStore();
}
