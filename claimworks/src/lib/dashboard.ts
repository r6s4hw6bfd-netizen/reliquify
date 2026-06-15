/**
 * Dashboard view-models + QC sign-off gate (Task 5).
 *
 * Pure builders that turn engine output + declaration records into the shapes the brokerage
 * and declaration-detail pages render. The QC sign-off gate enforces the reasonable-care
 * rule: a declaration cannot reach status "ready" without a human signer name (rule 3).
 * No data access here — pages inject a DashboardStore.
 */
import type { ClaimPath } from "./eligibility";
import type { ImporterSummary, BookAnalysis } from "./report";
import type { RemediationItem } from "./validation";

export type DeclarationStatus =
  | "draft"
  | "ready"
  | "filed"
  | "partially_accepted"
  | "accepted"
  | "rejected"
  | "paid";

export const DECLARATION_STATUSES: DeclarationStatus[] = [
  "draft", "ready", "filed", "partially_accepted", "accepted", "rejected", "paid",
];

export interface DeclarationRecord {
  id: string;
  importerName: string;
  iorNumber: string;
  status: DeclarationStatus;
  entryCount: number;
  qcSignedBy?: string;
  qcSignedAt?: Date;
}

export interface BrokerageViewModel {
  brokerageName: string;
  importers: ImporterSummary[];
  pipeline: Record<DeclarationStatus, number>;
  totalEstRefundCapeNow: number;
  totalEstRefundTotalPotential: number;
  urgentDeadlines: { importerName: string; entryNumber: string; deadline: string; daysLeft: number }[];
}

const emptyPipeline = (): Record<DeclarationStatus, number> =>
  Object.fromEntries(DECLARATION_STATUSES.map((s) => [s, 0])) as Record<DeclarationStatus, number>;

/** Brokerage overview: importers ranked by recovery, pipeline by declaration status,
 *  and the soonest protest deadlines across the book. */
export function buildBrokerageView(
  brokerageName: string,
  analysis: BookAnalysis,
  declarations: DeclarationRecord[],
): BrokerageViewModel {
  const pipeline = emptyPipeline();
  for (const d of declarations) pipeline[d.status]++;

  const urgentDeadlines = analysis.importers
    .flatMap((imp) =>
      imp.urgentDeadlines.map((u) => ({
        importerName: imp.importerName,
        entryNumber: u.entryNumber,
        deadline: u.deadline,
        daysLeft: u.daysLeft,
      })),
    )
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 25);

  return {
    brokerageName,
    importers: analysis.importers, // already ranked by estRefundTotalPotential
    pipeline,
    totalEstRefundCapeNow: analysis.totals.estRefundCapeNow,
    totalEstRefundTotalPotential: analysis.totals.estRefundTotalPotential,
    urgentDeadlines,
  };
}

export interface DeclarationDetailViewModel {
  declaration: DeclarationRecord;
  entries: { entryNumber: string; path: ClaimPath; estTotal: number; isEstimate: boolean }[];
  remediation: RemediationItem[];
  /** True when QC sign-off is permitted (draft, non-empty, not already signed). */
  canSignOff: boolean;
}

export function buildDeclarationDetail(
  declaration: DeclarationRecord,
  entries: DeclarationDetailViewModel["entries"],
  remediation: RemediationItem[] = [],
): DeclarationDetailViewModel {
  return {
    declaration,
    entries,
    remediation,
    canSignOff: declaration.status === "draft" && declaration.entryCount > 0 && !declaration.qcSignedBy,
  };
}

export interface AuditEntry {
  actor: string;
  action: string;
  subjectTable?: string;
  subjectId?: string;
  detail?: unknown;
}

/**
 * QC sign-off gate (rule 3): set qcSignedBy/qcSignedAt and move draft -> ready.
 * Refuses an empty signer name, an empty declaration, or a non-draft status. Returns the
 * updated record plus the audit entry the caller must persist.
 */
export function signOffDeclaration(
  d: DeclarationRecord,
  signerName: string,
  at: Date = new Date(),
): { declaration: DeclarationRecord; audit: AuditEntry } {
  const name = signerName?.trim();
  if (!name) throw new Error("QC sign-off requires a human signer name");
  if (d.status !== "draft") throw new Error(`Only a draft declaration can be signed off (status is "${d.status}")`);
  if (d.entryCount <= 0) throw new Error("Cannot sign off a declaration with no entries");

  const declaration: DeclarationRecord = { ...d, status: "ready", qcSignedBy: name, qcSignedAt: at };
  return {
    declaration,
    audit: {
      actor: name,
      action: "declaration.qc_signed",
      subjectTable: "declarations",
      subjectId: d.id,
      detail: { from: "draft", to: "ready", entryCount: d.entryCount, qcSignedAt: at.toISOString() },
    },
  };
}

// --- Data-access seam --------------------------------------------------------

export interface DashboardStore {
  getBrokerageView(brokerageId: string): Promise<BrokerageViewModel | undefined>;
  getDeclarationDetail(declarationId: string): Promise<DeclarationDetailViewModel | undefined>;
  signOff(declarationId: string, signerName: string): Promise<DeclarationRecord>;
}
