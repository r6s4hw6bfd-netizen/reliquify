/**
 * CAPE remediation: CBP validation result + original book -> dispositioned queue,
 * re-validated resubmission CSV(s), and a drafted CBP dispute email.
 * Usage: npx tsx scripts/remediate.ts <validation-result.csv> <original-entries.csv> --filer ABC [as-of-date] [--out dir]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseEntriesCsv } from "../src/lib/parse";
import { genericMapping } from "../src/lib/mappings/generic";
import { parseValidationCsv, processValidationResults } from "../src/lib/validation";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

const [validationFile, bookFile] = positional;
const filer = flag("filer");
if (!validationFile || !bookFile || !filer) {
  console.error("Usage: tsx scripts/remediate.ts <validation-result.csv> <original-entries.csv> --filer <CODE> [as-of-date] [--out dir]");
  process.exit(1);
}
const today = positional[2] ? new Date(positional[2]) : new Date();
const outDir = flag("out") ?? "output/remediation";

const { rows, warnings } = parseValidationCsv(readFileSync(validationFile, "utf8"));
warnings.forEach((w) => console.warn("validation parse warning: " + w));
const { entries } = parseEntriesCsv(readFileSync(bookFile, "utf8"), genericMapping);

const { report, resubmission, cbpDraftEmail } = processValidationResults(rows, entries, { filerCode: filer }, today);

console.log(`\n=== CAPE REMEDIATION (filer ${filer}, as of ${report.engineToday}) ===`);
console.log(`Results: ${report.total}   Accepted: ${report.accepted}   Rejected: ${report.rejected}`);
console.log(`Dispositions:`, report.byDisposition);
for (const it of report.items) {
  const fix = it.correctedEntryNumber ? ` -> ${it.correctedEntryNumber}` : "";
  console.log(`  [${it.disposition}] ${it.entryNumber}${fix} — ${it.reasons[0]}`);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `remediation-${report.engineToday}.json`), JSON.stringify(report, null, 2));
for (const f of resubmission.files) {
  writeFileSync(join(outDir, f.fileName), f.csv);
  console.log(`\nwrote resubmission ${f.fileName} — ${f.entryCount} entries`);
}
if (cbpDraftEmail) {
  const p = join(outDir, `cbp-dispute-draft-${report.engineToday}.txt`);
  writeFileSync(p, `To: ${cbpDraftEmail.to}\nSubject: ${cbpDraftEmail.subject}\n\n${cbpDraftEmail.body}\n`);
  console.log(`\nDRAFT dispute email (${cbpDraftEmail.entryNumbers.length} entries) written to ${p} — review and send from the filer's account.`);
}
console.log(`\nRemediation report + artifacts written to ${outDir}/`);
