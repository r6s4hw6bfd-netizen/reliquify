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
- `src/db/{audit,optin-store,optin-mapping,persistence}.ts` — Drizzle-backed audit
  sink + opt-in store. The opt-in routes persist to Postgres + `audit_log` when
  `DATABASE_URL` is set (run `npm run db:push` to apply the opt-in columns), and fall
  back to the in-memory stub otherwise. Row↔state mapping is pure and unit-tested.
- `src/lib/cape.ts` + `scripts/cape.ts` — CAPE Declaration generator: opted-in
  CAPE_NOW entries → CBP-template CSV(s), chunked to the 9,999-entry cap and batched
  per importer, with a deterministic pre-validation pass that replicates the known
  first-pass rejection causes (entry-number format, filer-code mismatch, duplicates,
  non-CAPE rows leaking in, missing IOR). Emits the file(s) plus a pre-flight report.
  (`npm run cape <csv> --filer <CODE> [as-of-date] [--out dir] [--opted-in ior1,ior2]`)
- `app/api/analyze/route.ts` — POST a CSV, get the analysis JSON (Vercel-ready).
- `app/api/report/route.ts` — POST a CSV (+ `?broker=&color=&logo=`), get the branded PDF.
- `src/lib/validation.ts` + `scripts/remediate.ts` — CBP Validation Result File parser
  + remediation queue: dispositions each rejection as AUTO_FIXABLE (re-normalize +
  resubmit), RESUBMIT_AS_IS (CBP false positive — engine still says CAPE_NOW, drafts a
  dispute email to CBP), or HUMAN_REVIEW (the safe default for anything unrecognized).
  Emits a re-validated resubmission CSV and a draft email — never sends.
  (`npm run remediate <validation.csv> <entries.csv> --filer <CODE> [as-of-date]`)
- `app/api/cape/route.ts` — POST a CSV (+ `?filer=&asOf=&optedIn=`), get the CAPE file(s)
  + pre-flight report as JSON.
- `src/lib/optin.ts` — importer opt-in flow: white-labeled engagement email (estimate
  labeled, broker-branded, unsubscribe link), capped reminder sequence (3 touches),
  signature + unsubscribe handling. All side effects (Resend email, e-sign, audit,
  persistence) behind injected interfaces; e-sign provider is stubbed pending vendor.
- `app/api/remediate/route.ts` — POST `validation` + `book` CSVs (+ `?filer=&asOf=`), get
  the remediation queue + resubmission file(s) + CBP dispute draft as JSON.
- `app/api/optin/unsubscribe/route.ts` — GET `?ior=` honors an unsubscribe.
- `app/api/optin/webhook/route.ts` — e-sign provider callback recording a signature.
- `src/lib/auth.ts` + `src/lib/session.ts` — magic-link auth (HMAC-signed magic + session
  tokens, no vendor). `app/login`, `app/api/auth/request`, `app/api/auth/verify`.
- `src/lib/dashboard.ts` — brokerage/declaration view-models + the QC sign-off gate
  (`signOffDeclaration`: a draft cannot reach `ready` without a human signer name).
- `app/dashboard` + `app/dashboard/declarations/[id]` — authed brokerage view (importers
  ranked, claim pipeline, urgent deadlines) and declaration detail with a QC sign-off action.
- `src/lib/rev615.ts` + `scripts/reconcile.ts` — REV-615 (Trade CAPE Detail Refund report)
  ingestion + reconciliation: per-entry status (paid/funds_diverted/no_refund/unmatched),
  consolidated ACH payment matching, and fee owed with broker/Reliquify split. Fees accrue
  only on funds actually received. (`npm run reconcile <rev615.csv> <entries.csv> [--fee 5]
  [--broker-split 60]`) · route `app/api/reconcile/route.ts`.

## Claim paths
CAPE_NOW · CAPE_LATER_PHASE · PROTEST_REQUIRED (deadline attached, route to
counsel) · NEEDS_REVIEW · NOT_IEEPA. EXPIRED is never assigned automatically.

## Roadmap (stages 3-8)
1. ~~CAPE CSV generator + pre-validation against known rejection patterns~~ ✓ (`src/lib/cape.ts`)
2. ~~Validation Result File parser + remediation loop~~ ✓ (`src/lib/validation.ts`)
3. ~~Opt-in flow: engagement letter e-sign, Resend sequences~~ ✓ (`src/lib/optin.ts`)
4. ~~Dashboard: brokerage view, declaration detail, QC sign-off + magic-link auth~~ ✓
5. ~~REV-615 ingestion, payment reconciliation, broker/Reliquify fee split~~ ✓ (`src/lib/rev615.ts`)

All six build-order tasks are scaffolded and tested. Remaining work before production:
confirm CBP formats (CAPE template, rejection-code catalog, REV-615 layout) against ACE
Portal guidance, select the e-sign vendor, and wire the Drizzle-backed dashboard/opt-in
stores + audit_log writes.

## Compliance notes
- Filing is done by the licensed broker through their own ACE Portal login. This
  software prepares and tracks; it never submits.
- Every engine output carries reasons + engine version for the reasonable-care
  audit trail. The `declarations.qcSignedBy` gate must be a human before "ready".
- All dollar figures derived without line-level IEEPA duty are flagged as
  estimates and must be presented as such to clients.
