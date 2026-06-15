/**
 * REV-615 reconciliation: CBP refund report + original book -> per-entry/-importer/-payment
 * reconciliation with fee owed (broker/Reliquify split) and funds-diverted flags.
 * Usage: npx tsx scripts/reconcile.ts <rev615.csv> <entries.csv> [--fee 5] [--broker-split 60] [--out dir]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseEntriesCsv } from "../src/lib/parse";
import { genericMapping } from "../src/lib/mappings/generic";
import { parseRev615, reconcileRefunds, type EntryRef } from "../src/lib/rev615";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

const [refundFile, bookFile] = positional;
if (!refundFile || !bookFile) {
  console.error("Usage: tsx scripts/reconcile.ts <rev615.csv> <entries.csv> [--fee 5] [--broker-split 60] [--out dir]");
  process.exit(1);
}
const defaultFeeRatePct = Number(flag("fee") ?? 5);
const brokerSplitPct = Number(flag("broker-split") ?? 60);
const outDir = flag("out") ?? "output/reconciliation";

const { rows, warnings } = parseRev615(readFileSync(refundFile, "utf8"));
warnings.forEach((w) => console.warn("rev615 parse warning: " + w));
const refs: EntryRef[] = parseEntriesCsv(readFileSync(bookFile, "utf8"), genericMapping).entries.map((e) => ({
  entryNumber: e.entryNumber,
  iorNumber: e.iorNumber,
  importerName: e.importerName,
}));

const result = reconcileRefunds(rows, refs, { defaultFeeRatePct, brokerSplitPct });
const usd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

console.log(`\n=== REV-615 RECONCILIATION (as of ${result.engineToday}) ===`);
console.log(`Refund: ${usd(result.totals.refund)}   Interest: ${usd(result.totals.interest)}   Received: ${usd(result.totals.received)}`);
console.log(`Fee owed: ${usd(result.totals.feeOwed)}  (broker ${usd(result.totals.brokerShare)} / Reliquify ${usd(result.totals.reliquifyShare)})`);
console.log(`Funds diverted: ${result.totals.diverted}   Unmatched: ${result.totals.unmatched}`);
console.log(`\nBy importer:`);
for (const i of result.byImporter) {
  console.log(`  ${i.importerName} (IOR ${i.iorNumber}): received ${usd(i.received)}, fee ${usd(i.feeOwed)} (broker ${usd(i.brokerShare)} / Reliquify ${usd(i.reliquifyShare)})${i.divertedCount ? `, ${i.divertedCount} diverted` : ""}`);
}
console.log(`\nConsolidated ACH payments:`);
for (const p of result.byPayment) {
  console.log(`  ${p.paymentRef}: ${usd(p.total)} across ${p.entryNumbers.length} entr${p.entryNumbers.length === 1 ? "y" : "ies"} (${p.entryNumbers.join(", ")})`);
}
if (result.warnings.length) {
  console.log(`\nWarnings:`);
  result.warnings.forEach((w) => console.log("  - " + w));
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `reconciliation-${result.engineToday}.json`), JSON.stringify(result, null, 2));
console.log(`\nFull reconciliation written to ${outDir}/reconciliation-${result.engineToday}.json`);
