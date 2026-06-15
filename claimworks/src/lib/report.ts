import type { NormalizedEntry, Classification, ClaimPath } from "./eligibility";
import { classifyEntry } from "./eligibility";
import { quantifyEntry, Quantification } from "./quantify";

export interface EntryResult {
  entry: NormalizedEntry;
  classification: Classification;
  quantification: Quantification;
}

export interface ImporterSummary {
  importerName: string;
  iorNumber: string;
  entryCount: number;
  byPath: Record<ClaimPath, number>;
  estRefundCapeNow: number;
  estRefundTotalPotential: number;
  estInterest: number;
  hasEstimatedFigures: boolean;
  urgentDeadlines: { entryNumber: string; deadline: string; daysLeft: number }[];
}

export interface BookAnalysis {
  generatedAt: string;
  engineToday: string;
  totals: {
    entries: number;
    importers: number;
    estRefundCapeNow: number;
    estRefundTotalPotential: number;
    byPath: Record<ClaimPath, number>;
  };
  importers: ImporterSummary[];
  results: EntryResult[];
}

const PATHS: ClaimPath[] = ["CAPE_NOW", "CAPE_LATER_PHASE", "PROTEST_REQUIRED", "NEEDS_REVIEW", "EXPIRED", "NOT_IEEPA"];
const emptyByPath = () => Object.fromEntries(PATHS.map((p) => [p, 0])) as Record<ClaimPath, number>;

export function analyzeBook(entries: NormalizedEntry[], today: Date = new Date()): BookAnalysis {
  const results: EntryResult[] = entries.map((entry) => ({
    entry,
    classification: classifyEntry(entry, today),
    quantification: quantifyEntry(entry, today),
  }));

  const byImporter = new Map<string, EntryResult[]>();
  for (const r of results) {
    const key = `${r.entry.iorNumber}|${r.entry.importerName}`;
    if (!byImporter.has(key)) byImporter.set(key, []);
    byImporter.get(key)!.push(r);
  }

  const importers: ImporterSummary[] = [...byImporter.values()].map((rs) => {
    const byPath = emptyByPath();
    let capeNow = 0, totalPotential = 0, interest = 0, hasEst = false;
    const urgent: ImporterSummary["urgentDeadlines"] = [];
    for (const r of rs) {
      byPath[r.classification.path]++;
      if (r.quantification.dutyIsEstimate) hasEst = true;
      const claimable = ["CAPE_NOW", "CAPE_LATER_PHASE", "PROTEST_REQUIRED"].includes(r.classification.path);
      if (claimable) {
        totalPotential += r.quantification.total;
        interest += r.quantification.interestEstimate;
      }
      if (r.classification.path === "CAPE_NOW") capeNow += r.quantification.total;
      if (r.classification.path === "PROTEST_REQUIRED" && r.classification.deadline) {
        urgent.push({
          entryNumber: r.entry.entryNumber,
          deadline: r.classification.deadline.toISOString().slice(0, 10),
          daysLeft: r.classification.daysToDeadline ?? 0,
        });
      }
    }
    urgent.sort((a, b) => a.daysLeft - b.daysLeft);
    return {
      importerName: rs[0].entry.importerName,
      iorNumber: rs[0].entry.iorNumber,
      entryCount: rs.length,
      byPath,
      estRefundCapeNow: round2(capeNow),
      estRefundTotalPotential: round2(totalPotential),
      estInterest: round2(interest),
      hasEstimatedFigures: hasEst,
      urgentDeadlines: urgent.slice(0, 10),
    };
  }).sort((a, b) => b.estRefundTotalPotential - a.estRefundTotalPotential);

  const totalsByPath = emptyByPath();
  for (const r of results) totalsByPath[r.classification.path]++;

  return {
    generatedAt: new Date().toISOString(),
    engineToday: today.toISOString().slice(0, 10),
    totals: {
      entries: results.length,
      importers: importers.length,
      estRefundCapeNow: round2(importers.reduce((s, i) => s + i.estRefundCapeNow, 0)),
      estRefundTotalPotential: round2(importers.reduce((s, i) => s + i.estRefundTotalPotential, 0)),
      byPath: totalsByPath,
    },
    importers,
    results,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
