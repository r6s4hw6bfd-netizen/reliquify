# Reliquify

IEEPA tariff refund claim-ops engine: ingest a customs brokerage's entry data,
classify every entry into a claim path, quantify the refund, and produce the
broker-facing book analysis. Stages 1–2 of the pipeline (intake + triage/quantify).

## Stack
Next.js (Vercel) · Neon Postgres + Drizzle · Resend (email, stage 3) · TypeScript.

## Quick start
```bash
npm install
npm test                                        # engine tests
npm run analyze fixtures/sample-entries.csv     # CSV in -> ranked book analysis out
```
The `analyze` CLI needs no database — it's the sales weapon. Drop in a broker's
export, walk into the meeting with their number.

## Layout
- `src/lib/codes.ts` — **regulated config**: IEEPA Ch.99 prefixes, windows, phase
  rules, limits. VERIFY against CBP's IEEPA Duty Refunds page before first client
  filing; every change via PR with an audit note.
- `src/lib/parse.ts` + `src/lib/mappings/` — CSV normalizer; one mapping file per
  ABI system (CargoWise/Magaya/Netchb exports differ only in column names).
- `src/lib/eligibility.ts` — deterministic claim-path engine. No LLM calls.
  Ambiguity always resolves to NEEDS_REVIEW, never a guess.
- `src/lib/quantify.ts` — IEEPA duty rollup + interest ESTIMATE (placeholder rate;
  real rate is Treasury quarterly under 26 U.S.C. § 6621).
- `src/lib/report.ts` — per-importer rollups, deadline alerts, book totals.
- `src/lib/pdf.tsx` + `scripts/report.ts` — broker-brandable book-analysis PDF
  (`npm run report <csv> [as-of-date] -- --broker "Name" [--color "#1e3a5f"] [--logo url]`).
- `src/db/schema.ts` — Drizzle schema incl. declarations, validation results,
  QC sign-off gate, and audit log.
- `src/lib/cape.ts` + `scripts/cape.ts` — CAPE Declaration generator: opted-in
  CAPE_NOW entries → CBP-template CSV(s), chunked to the 9,999-entry cap and batched
  per importer, with a deterministic pre-validation pass that replicates the known
  first-pass rejection causes (entry-number format, filer-code mismatch, duplicates,
  non-CAPE rows leaking in, missing IOR). Emits the file(s) plus a pre-flight report.
  (`npm run cape <csv> --filer <CODE> [as-of-date] [--out dir] [--opted-in ior1,ior2]`)
- `app/api/analyze/route.ts` — POST a CSV, get the analysis JSON (Vercel-ready).
- `app/api/report/route.ts` — POST a CSV (+ `?broker=&color=&logo=`), get the branded PDF.
- `app/api/cape/route.ts` — POST a CSV (+ `?filer=&asOf=&optedIn=`), get the CAPE file(s)
  + pre-flight report as JSON.

## Claim paths
CAPE_NOW · CAPE_LATER_PHASE · PROTEST_REQUIRED (deadline attached, route to
counsel) · NEEDS_REVIEW · NOT_IEEPA. EXPIRED is never assigned automatically.

## Roadmap (stages 3-8)
1. ~~CAPE CSV generator + pre-validation against known rejection patterns~~ ✓ (`src/lib/cape.ts`)
2. Validation Result File parser + remediation loop
3. Opt-in flow: engagement letter e-sign, Resend sequences
4. REV-615 ingestion, payment reconciliation, invoicing + broker split
5. Dashboard

## Compliance notes
- Filing is done by the licensed broker through their own ACE Portal login. This
  software prepares and tracks; it never submits.
- Every engine output carries reasons + engine version for the reasonable-care
  audit trail. The `declarations.qcSignedBy` gate must be a human before "ready".
- All dollar figures derived without line-level IEEPA duty are flagged as
  estimates and must be presented as such to clients.
