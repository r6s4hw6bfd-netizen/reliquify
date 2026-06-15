/**
 * IEEPA eligibility configuration — regulated config, every change via PR + audit note.
 *
 * VERIFICATION STATUS (2026-06-10, Task 0):
 * Verified against CSMS #68315804 (CAPE introduction, 2026-04-20 deployment) and
 * CSMS #68396594 (CAPE availability) via content.govdelivery.com/accounts/USDHSCBP,
 * cross-checked with Holland & Knight, Great Lakes Customs Law, and Aprio CAPE guides.
 * cbp.gov itself blocks automated fetch (403) — REMAINING HUMAN VERIFICATION against
 * the CAPE Information Notice / Quick Reference Guide in the ACE Portal:
 *   1. Collection-window endpoints: secondary sources give 2025-02-01 (EO signed) vs
 *      2025-02-04 (EO effective) for the start; we use the effective date. End reflects
 *      collection ceasing 12:00 AM EST 2026-02-24 (last collection day 2026-02-23).
 *   2. Phase 1 exclusions beyond those modeled in eligibility.ts: secondary sources
 *      also list surety-paid entries, warehouse entries (type 21/22), and entries not
 *      filed in ACE. Not yet modeled — confirm before adding flags to the parser.
 *   3. AD/CVD exclusion precise scope ("pending liquidation instructions" vs all type 03).
 * Phase 2 had NOT opened as of 2026-06-10 (signaled for Q3 2026; no CSMS commitment).
 */

/** Ch. 99 HTS prefixes for IEEPA duties: 9903.01 = trafficking/fentanyl tariffs,
 *  9903.02 = reciprocal tariffs. (Great Lakes Customs Law CAPE guide, 2026-04.) */
export const IEEPA_CH99_PREFIXES = ["9903.01", "9903.02"] as const;

/** Window during which IEEPA duties were collected.
 *  Start: first trafficking-tariff EO effective date (2025-02-04; EO signed 2025-02-01 —
 *  see human-verify note 1). End: CBP ceased collection 12:00 AM EST 2026-02-24 following
 *  Learning Resources, Inc. v. Trump (SCOTUS, 2026-02-20), so the last entry date with
 *  IEEPA duty is 2026-02-23. Entries outside the window go to NEEDS_REVIEW, never EXPIRED. */
export const IEEPA_WINDOW = {
  start: new Date("2025-02-04"),
  end: new Date("2026-02-23"),
} as const;

/** CAPE Phase 1: unliquidated entries + entries liquidated within this many days
 *  (within the 90-day voluntary reliquidation window). CSMS #68315804 / #68396594:
 *  "certain unliquidated entries and certain entries within 80 days of liquidation". */
export const PHASE1_LIQUIDATION_LOOKBACK_DAYS = 80;

/** 19 U.S.C. § 1514 protest window after liquidation (statutory, 180 days). */
export const PROTEST_WINDOW_DAYS = 180;

/** Max entries per single CAPE Declaration CSV (ACE CAPE template limit; confirmed by
 *  Holland & Knight and Great Lakes CAPE guides, 2026-04). */
export const CAPE_MAX_ENTRIES_PER_DECLARATION = 9999;

/** Simple-interest annual rate used for ESTIMATED statutory interest. Actual interest is
 *  computed by CBP under 19 CFR 24.36 at Treasury quarterly rates (26 U.S.C. § 6621);
 *  Q1 2026 rates: 7% noncorporate / 6% corporate (Holland & Knight, 2026-04). We use the
 *  noncorporate rate as a flat estimate; all derived figures stay flagged as estimates. */
export const INTEREST_EST_ANNUAL_RATE = 0.07;

/**
 * CAPE Declaration CSV template — REGULATED CONFIG, also REQUIRES HUMAN VERIFICATION.
 *
 * The exact column set/order/header text of the ACE CAPE Declaration upload template is
 * published only in the ACE Portal "CAPE Information Notice / Quick Reference Guide", which
 * cbp.gov serves behind a 403 to automated fetch (see codes.ts header). The columns below
 * are the minimum identifying fields every secondary CAPE guide agrees the declaration keys
 * on (entry number, IOR, filer); they are intentionally a SINGLE EDIT POINT so the layout can
 * be corrected in one place once a human confirms the official template. DO NOT ship a real
 * filing until these headers are reconciled against the ACE template — a header mismatch is
 * itself a known first-pass rejection cause. (Holland & Knight / Great Lakes / Aprio CAPE
 * guides, 2026-04; exact template pending ACE Portal confirmation.) */
export const CAPE_TEMPLATE = {
  columns: [
    { key: "entryNumber", header: "Entry Number" },
    { key: "iorNumber", header: "Importer of Record Number" },
    { key: "filerCode", header: "Filer Code" },
  ],
} as const;

export type CapeColumnKey = (typeof CAPE_TEMPLATE.columns)[number]["key"];

export const ENGINE_VERSION = "0.2.0";

export function isIeepaCh99(hts: string): boolean {
  const clean = hts.replace(/[^0-9.]/g, "");
  return IEEPA_CH99_PREFIXES.some((p) => clean.startsWith(p));
}
