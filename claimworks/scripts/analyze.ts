/**
 * The sales weapon: csv in -> ranked book analysis out. No database required.
 * Usage: npx tsx scripts/analyze.ts fixtures/sample-entries.csv [as-of-date]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseEntriesCsv } from "../src/lib/parse";
import { genericMapping } from "../src/lib/mappings/generic";
import { analyzeBook } from "../src/lib/report";

const file = process.argv[2];
if (!file) { console.error("Usage: tsx scripts/analyze.ts <entries.csv> [as-of-date]"); process.exit(1); }
const today = process.argv[3] ? new Date(process.argv[3]) : new Date();

const { entries, warnings } = parseEntriesCsv(readFileSync(file, "utf8"), genericMapping);
const analysis = analyzeBook(entries, today);

const usd = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });

console.log(`\n=== RELIQUIFY BOOK ANALYSIS (as of ${analysis.engineToday}) ===\n`);
console.log(`Entries: ${analysis.totals.entries}   Importers: ${analysis.totals.importers}`);
console.log(`Claimable via CAPE now:      ${usd(analysis.totals.estRefundCapeNow)}`);
console.log(`Total potential (all paths): ${usd(analysis.totals.estRefundTotalPotential)}`);
console.log(`Path counts:`, analysis.totals.byPath, "\n");

for (const imp of analysis.importers) {
  console.log(`-- ${imp.importerName} (IOR ${imp.iorNumber}) — ${imp.entryCount} entries`);
  console.log(`   CAPE now: ${usd(imp.estRefundCapeNow)}   Total potential: ${usd(imp.estRefundTotalPotential)}${imp.hasEstimatedFigures ? "   [contains ESTIMATES — request line-level duty export]" : ""}`);
  for (const d of imp.urgentDeadlines) {
    console.log(`   !! PROTEST DEADLINE ${d.deadline} (${d.daysLeft}d left) — entry ${d.entryNumber}`);
  }
}

if (warnings.length) {
  console.log(`\nParser warnings (${warnings.length}):`);
  warnings.forEach((w) => console.log("  - " + w));
}

mkdirSync("output", { recursive: true });
const out = `output/book-analysis-${analysis.engineToday}.json`;
writeFileSync(out, JSON.stringify(analysis, null, 2));
console.log(`\nFull JSON written to ${out}\n`);
