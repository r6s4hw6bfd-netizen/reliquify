/**
 * Pure mappers between the `importers` row shape and the opt-in engine's
 * ImporterOptInState. Kept separate from the Drizzle glue so the field-by-field
 * translation is unit-testable without a database.
 */
import type { ImporterOptInState, OptInStatus } from "../lib/optin";

/** The subset of the importers row the opt-in flow reads. */
export interface ImporterOptInRow {
  iorNumber: string;
  name: string;
  contactEmail: string | null;
  contactName: string | null;
  optInStatus: string;
  optInTouchesSent: number;
  optInLastTouchAt: Date | null;
  optInUnsubscribed: boolean;
  optInEnvelopeId: string | null;
  optInSignedAt: Date | null;
}

const OPT_IN_STATUSES: OptInStatus[] = ["pending", "sent", "signed", "declined"];
const asStatus = (s: string): OptInStatus => (OPT_IN_STATUSES.includes(s as OptInStatus) ? (s as OptInStatus) : "pending");

export function importerRowToOptInState(row: ImporterOptInRow): ImporterOptInState {
  return {
    iorNumber: row.iorNumber,
    importerName: row.name,
    contactEmail: row.contactEmail ?? "",
    contactName: row.contactName ?? undefined,
    optInStatus: asStatus(row.optInStatus),
    touchesSent: row.optInTouchesSent ?? 0,
    lastTouchAt: row.optInLastTouchAt ?? undefined,
    unsubscribed: row.optInUnsubscribed ?? false,
    envelopeId: row.optInEnvelopeId ?? undefined,
    signedAt: row.optInSignedAt ?? undefined,
  };
}

/** Columns to persist back to the importers row from an opt-in state. */
export function optInStateToColumns(s: ImporterOptInState): {
  optInStatus: OptInStatus;
  optInTouchesSent: number;
  optInLastTouchAt: Date | null;
  optInUnsubscribed: boolean;
  optInEnvelopeId: string | null;
  optInSignedAt: Date | null;
} {
  return {
    optInStatus: s.optInStatus,
    optInTouchesSent: s.touchesSent,
    optInLastTouchAt: s.lastTouchAt ?? null,
    optInUnsubscribed: s.unsubscribed,
    optInEnvelopeId: s.envelopeId ?? null,
    optInSignedAt: s.signedAt ?? null,
  };
}
