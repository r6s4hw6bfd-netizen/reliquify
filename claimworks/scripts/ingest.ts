/**
 * Load a parsed book into Neon. Requires DATABASE_URL and a brokerage id.
 * Usage: npx tsx scripts/ingest.ts <entries.csv> --brokerage <uuid> [as-of-date]
 */
import { readFileSync } from "node:fs";
import { parseEntriesCsv } from "../src/lib/parse";
import { genericMapping } from "../src/lib/mappings/generic";
import { buildIngestPayload } from "../src/db/ingest-mapping";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

const file = positional[0];
const brokerageId = flag("brokerage");
if (!file || !brokerageId) {
  console.error("Usage: tsx scripts/ingest.ts <entries.csv> --brokerage <uuid> [as-of-date]");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — ingestion requires a database connection.");
  process.exit(1);
}
const today = positional[1] ? new Date(positional[1]) : new Date();

// Narrowed (the guard above exits otherwise) so they're typed as string inside main().
const csvPath: string = file;
const brokerage: string = brokerageId;

async function main() {
  const { entries, warnings } = parseEntriesCsv(readFileSync(csvPath, "utf8"), genericMapping);
  warnings.forEach((w) => console.warn("parser warning: " + w));
  const payload = buildIngestPayload(entries, today);

  const [{ db }, { ingestBook }] = await Promise.all([import("../src/db/client"), import("../src/db/ingest")]);
  const summary = await ingestBook(db, brokerage, payload);
  console.log(`Ingested: ${summary.importers} importers, ${summary.entries} entries, ${summary.lines} lines.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
