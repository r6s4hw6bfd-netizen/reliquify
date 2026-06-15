/**
 * Branded book-analysis PDF: csv in -> broker-ready PDF out. No database required.
 * Usage: npx tsx scripts/report.ts <entries.csv> [as-of-date] [--broker "Name"] [--color "#1e3a5f"] [--logo url]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseEntriesCsv } from "../src/lib/parse";
import { genericMapping } from "../src/lib/mappings/generic";
import { analyzeBook } from "../src/lib/report";
import { renderBookAnalysisPdf, BrokerBranding } from "../src/lib/pdf";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1]?.startsWith("--") !== true);

const file = positional[0];
if (!file) { console.error('Usage: tsx scripts/report.ts <entries.csv> [as-of-date] [--broker "Name"]'); process.exit(1); }
const today = positional[1] ? new Date(positional[1]) : new Date();

const branding: BrokerBranding = {
  brokerName: flag("broker") ?? "Your Brokerage",
  primaryColor: flag("color"),
  logoUrl: flag("logo"),
};

const { entries, warnings } = parseEntriesCsv(readFileSync(file, "utf8"), genericMapping);
const analysis = analyzeBook(entries, today);
warnings.forEach((w) => console.warn("parser warning: " + w));

renderBookAnalysisPdf(analysis, branding).then((pdf) => {
  mkdirSync("output", { recursive: true });
  const out = `output/book-analysis-${analysis.engineToday}.pdf`;
  writeFileSync(out, pdf);
  console.log(`PDF written to ${out} (${(pdf.length / 1024).toFixed(0)} kB)`);
});
