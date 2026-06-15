# Reliquify — Claude Code handoff prompt

Paste everything below this line into Claude Code from the repo root. Also worth committing this file as `CLAUDE.md` so every future session inherits it.

---

## Context

You are building **Reliquify** (reliquify.com): a white-label IEEPA tariff-refund claim-operations platform sold to US customs brokerages. Background: the Supreme Court invalidated the 2025–26 IEEPA tariffs (Feb 20, 2026); CBP must refund ~$166B across 330K+ importers; refunds are claimed via **CAPE Declarations** (CSV uploads through the ACE Portal — there is no API). Only the importer of record or the broker who filed the original entries may file. Reliquify ingests a brokerage's entry data, classifies every entry into a claim path, quantifies refunds, generates client-facing reports and CAPE-ready files, manages the rejection/remediation loop, and tracks claims to payment. The broker files through their own ACE login; Reliquify never submits anything to CBP directly.

Business model: broker forwards our white-labeled book analysis to their importer clients; importers pay a recovery fee (3–8%); broker keeps ~60%, Reliquify ~40%. The book-analysis report is the sales weapon — a broker meeting converts when they see their number.

## Current state of the repo

Stages 1–2 are scaffolded and tested (8/8 vitest passing):
- `src/lib/codes.ts` — regulated config: IEEPA Ch.99 prefixes (9903.01/9903.02), collection window (2025-02-04 → 2026-02-24), Phase-1 80-day liquidation lookback, 180-day protest window, 9,999-entry CAPE limit, placeholder interest rate. 
- `src/lib/parse.ts` + `src/lib/mappings/generic.ts` — CSV normalizer with pluggable per-ABI-system column mappings. Blank numeric cells parse as `undefined`, never 0.
- `src/lib/eligibility.ts` — deterministic classifier → CAPE_NOW | CAPE_LATER_PHASE | PROTEST_REQUIRED (with deadline) | NEEDS_REVIEW | NOT_IEEPA. Ambiguity always → NEEDS_REVIEW. EXPIRED is never auto-assigned.
- `src/lib/quantify.ts` — IEEPA duty rollup + interest ESTIMATE; anything inferred is flagged `dutyIsEstimate`.
- `src/lib/report.ts` — per-importer rollups, urgent-deadline list, book totals.
- `scripts/analyze.ts` — CLI: `npm run analyze <csv>` → ranked book analysis, no DB needed.
- `app/api/analyze/route.ts` — same engine as a Vercel API route.
- `src/db/schema.ts` — Drizzle/Neon schema: brokerages, importers, entries, entry_lines, declarations (with `qcSignedBy` human gate), declaration_entries (validation results), audit_log.
- `fixtures/sample-entries.csv`, `tests/eligibility.test.ts`.

If any files still say "ClaimWorks" (pre-rebrand), rename to Reliquify everywhere first.

## Stack & conventions (do not deviate)

- Next.js App Router on **Vercel** · **Neon** Postgres via Drizzle (`@neondatabase/serverless`) · **Resend** for all email · TypeScript strict · vitest.
- Env vars: `DATABASE_URL`, `RESEND_API_KEY`, `REPORT_FROM_EMAIL`. Never commit secrets. Create `.env` from `.env.example`.
- GitHub repo under cjkootch. Small, reviewable commits with imperative messages. Run `npm test` before every commit; add tests with every engine change.

## Non-negotiable engineering rules

1. **The classification/quantification engine stays deterministic.** No LLM calls inside `eligibility.ts`, `quantify.ts`, or anything whose output lands in a federal filing or client dollar figure. LLMs are fine for: column-mapping suggestions (human-confirmed), drafting client emails, summarizing rejection patterns.
2. **Never invent or default a number.** Missing data → `undefined` + estimate flag + NEEDS_REVIEW where applicable. A wrong $0 is worse than no answer.
3. **Audit trail everywhere.** Every engine output carries `reasons[]` + `engineVersion`. Every state change writes to `audit_log`. A declaration cannot reach status `ready` without a human name in `qcSignedBy`.
4. **`codes.ts` is regulated configuration.** Any change requires a comment citing the CBP source (CSMS message or cbp.gov IEEPA Duty Refunds page) and a dated note. FIRST TASK below includes verifying it.
5. Client-facing copy must label estimates as estimates and must never promise recovery on NEEDS_REVIEW/past-deadline entries.

## Build order — work top to bottom, one PR-sized chunk each

**Task 0 — Verify regulated config.** Fetch CBP's IEEPA Duty Refunds page (cbp.gov/trade/programs-administration/trade-remedies/ieepa-duty-refunds) and current CSMS guidance. Confirm/correct: Ch.99 prefix list, window dates, Phase 1 scope (which liquidation lookback, which exclusions — reconciliation, drawback, AD/CVD, open protests), per-declaration entry limit, and whether new phases have opened. Update `codes.ts` with citations. If you cannot fetch, STOP and list exactly what a human must verify.

**Task 1 — Branded book-analysis PDF (the sales weapon).** `src/lib/pdf.ts` + `scripts/report.ts`: from a `BookAnalysis`, render a clean broker-brandable PDF (broker logo/name parameterized): cover with headline numbers, per-importer table ranked by recovery, urgent-deadline page, methodology + disclaimers page (estimates flagged, "not legal advice", figures subject to CBP determination). Use `@react-pdf/renderer` or puppeteer-on-Vercel — pick one, justify in the PR. Also: `app/api/report/route.ts` returning the PDF.

**Task 2 — CAPE Declaration generator with pre-validation.** `src/lib/cape.ts`: from opted-in CAPE_NOW entries → CBP-template CSV(s), chunked ≤9,999 entries, batched per importer. Pre-validation pass replicating known rejection causes (entry-number format, filer-code mismatch vs brokerage record, duplicate entries, non-CAPE-eligible rows leaking in). Output: file(s) + a pre-flight report. Tests with malformed fixtures.

**Task 3 — Validation Result File parser + remediation queue.** `src/lib/validation.ts`: ingest CBP's validation result export, map rejection codes/reasons onto `declaration_entries`, auto-classify each rejection as AUTO_FIXABLE (regenerate corrected row) vs RESUBMIT_AS_IS (known false-positive pattern) vs HUMAN_REVIEW. Generate the resubmission CSV and a draft email to IEEPARefunds@cbp.dhs.gov for false rejects (draft only — human sends).

**Task 4 — Opt-in flow.** Resend integration: send book-analysis summary + engagement-letter link to importer contacts, track opt_in_status, reminder sequence (3 touches max), webhook/route to record signature (e-sign provider TBD — stub the interface). All sends logged to audit_log; unsubscribe honored.

**Task 5 — Status dashboard.** Minimal authed Next.js pages: brokerage view (importers ranked, claim pipeline by status, urgent deadlines), declaration detail (entries, validation results, remediation queue), and a QC sign-off action that sets `qcSignedBy/qcSignedAt`. Auth: simple email magic-link via Resend for now.

**Task 6 — REV-615 ingestion + reconciliation (stub acceptable).** Parser for CBP's Trade CAPE Detail Refund report → update entry/declaration statuses, flag "Funds Diverted", match consolidated ACH payments back to entries, compute fee owed per engagement terms.

## Verification loop

After each task: `npm test` green, run `npm run analyze fixtures/sample-entries.csv 2026-06-09` and confirm output unchanged unless intended, and add at least one fixture exercising the new path. Keep `README.md` roadmap current.

## What NOT to build

- No ACE portal automation/scraping of CBP systems — filing is the broker's manual action, by design and by law.
- No payment collection yet (invoicing comes after first signed broker).
- No multi-tenant auth complexity — one table column (`brokerageId`) scoping is enough for now.
