/**
 * CAPE Declaration generator: csv in -> CBP-template CSV file(s) + pre-flight report.
 * Usage: npx tsx scripts/cape.ts <entries.csv> --filer ABC [as-of-date] [--out dir] [--opted-in 12-3456789,98-7654321]
 *
 * Files are written to <out>/ (default output/cape/). The pre-flight report lists every
 * entry held back and why — fix those before the broker uploads through their ACE login.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseEntriesCsv } from "../src/lib/parse";
import { genericMapping } from "../src/lib/mappings/generic";
import { generateCape } from "../src/lib/cape";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

const file = positional[0];
const filer = flag("filer");
if (!file || !filer) {
  console.error('Usage: tsx scripts/cape.ts <entries.csv> --filer <CODE> [as-of-date] [--out dir] [--opted-in ior1,ior2]');
  process.exit(1);
}
const today = positional[1] ? new Date(positional[1]) : new Date();
const outDir = flag("out") ?? "output/cape";
const optedInIors = flag("opted-in")?.split(",").map((s) => s.trim()).filter(Boolean);

const { entries, warnings } = parseEntriesCsv(readFileSync(file, "utf8"), genericMapping);
warnings.forEach((w) => console.warn("parser warning: " + w));

const { files, preflight } = generateCape(entries, { filerCode: filer }, { today, optedInIors });

console.log(`\n=== CAPE PRE-FLIGHT (filer ${preflight.brokerageFilerCode}, as of ${preflight.engineToday}) ===`);
console.log(`Input entries: ${preflight.totalInput}   Included: ${preflight.includedCount}   Excluded: ${preflight.excludedCount}   Dupes removed: ${preflight.duplicatesRemoved}`);
console.log(`Rejection-cause counts:`, preflight.byCode);
if (preflight.findings.length) {
  console.log(`\nFindings (${preflight.findings.length}):`);
  for (const f of preflight.findings) {
    console.log(`  [${f.severity.toUpperCase()}] ${f.code} ${f.entryNumber || "(no entry#)"} — ${f.message}`);
  }
}

mkdirSync(outDir, { recursive: true });
for (const f of files) {
  writeFileSync(join(outDir, f.fileName), f.csv);
  console.log(`\nwrote ${f.fileName} — ${f.entryCount} entries (${f.importerName}, IOR ${f.iorNumber}, chunk ${f.chunkIndex}/${f.chunkCount})`);
}
const reportPath = join(outDir, `preflight-${preflight.engineToday}.json`);
writeFileSync(reportPath, JSON.stringify(preflight, null, 2));
console.log(`\n${files.length} CAPE file(s) + pre-flight report written to ${outDir}/`);
if (preflight.excludedCount > 0) {
  console.log(`Review the ${preflight.excludedCount} excluded entr${preflight.excludedCount === 1 ? "y" : "ies"} above before filing.`);
}
