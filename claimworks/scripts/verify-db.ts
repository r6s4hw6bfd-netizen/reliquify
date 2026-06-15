/* DB smoke test: resolve a brokerage by contact email, read the dashboard view back from
 * Postgres, and confirm it equals the same book analyzed straight from the CSV. Requires
 * DATABASE_URL. Usage: npm run verify:db -- <email> [csv] [as-of-date] */
import { readFileSync } from "node:fs";
import { resolveBrokerageId, drizzleDashboardStore } from "../src/db/dashboard-store";
import { parseEntriesCsv } from "../src/lib/parse";
import { genericMapping } from "../src/lib/mappings/generic";
import { analyzeBook } from "../src/lib/report";

const email = process.argv[2] ?? "demo@reliquify.com";
const csvPath = process.argv[3] ?? "fixtures/sample-entries.csv";
const TODAY = process.argv[4] ? new Date(process.argv[4]) : new Date("2026-06-09");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  const { db } = await import("../src/db/client");
  const bid = await resolveBrokerageId(db, email);
  if (!bid) throw new Error(`could not resolve a brokerage for ${email}`);

  const view = await (await drizzleDashboardStore(db, bid, TODAY)).getBrokerageView(bid);
  if (!view) throw new Error("no view");

  const csv = parseEntriesCsv(readFileSync(csvPath, "utf8"), genericMapping);
  const direct = analyzeBook(csv.entries, TODAY);

  console.log("DB read-back:");
  console.log("  brokerage:", view.brokerageName);
  console.log("  importers:", view.importers.length, "(csv:", direct.totals.importers + ")");
  console.log("  CAPE_NOW est $:", view.totalEstRefundCapeNow, "(csv:", direct.totals.estRefundCapeNow + ")");
  console.log("  total potential $:", view.totalEstRefundTotalPotential, "(csv:", direct.totals.estRefundTotalPotential + ")");
  console.log("  urgent deadlines:", view.urgentDeadlines.length);
  const match =
    view.importers.length === direct.totals.importers &&
    view.totalEstRefundCapeNow === direct.totals.estRefundCapeNow &&
    view.totalEstRefundTotalPotential === direct.totals.estRefundTotalPotential;
  console.log(match ? "\nMATCH: DB read-back equals the CSV analysis." : "\nMISMATCH!");
  if (!match) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
