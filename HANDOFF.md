# Reliquify — session handoff (2026-06-15)

This repo was migrated to a new GitHub account. The previous account's GitHub
access was suspended mid-session (automated flag), so the last work was committed
locally and exported rather than pushed. Full commit history is preserved in the
export. Read `CLAUDE.md` for the full product spec and build order; this note is
just the current state and the immediate next step.

## Important layout note
The app lives in the **`claimworks/`** subdirectory (legacy folder name from before
the Reliquify rebrand — the code itself is fully rebranded; only the directory name
remains). On Vercel, the project's **Root Directory** must be set to `claimworks`,
and `claimworks/vercel.json` pins the Next.js framework preset. If you re-create the
Vercel project against the new repo, set Root Directory = `claimworks` again.

## What's done

- **Pre-work / rebrand** (commit "Rebrand ClaimWorks to Reliquify"): package name,
  README, CLI banner → Reliquify. Added `.env.example`
  (`DATABASE_URL`, `RESEND_API_KEY`, `REPORT_FROM_EMAIL`).

- **Task 0 — verify regulated config** (commit "Task 0: verify regulated config"):
  `src/lib/codes.ts` checked against CSMS #68315804 / #68396594 and trade-law CAPE
  guides (cbp.gov blocks automated fetch). Confirmed: 9903.01/9903.02 prefixes,
  80-day Phase 1 lookback, 180-day protest window, 9,999-entry CAPE limit, ~7%
  interest estimate. Corrected: prefix labels (9903.01 = trafficking, 9903.02 =
  reciprocal) and collection-window end → 2026-02-23. Engine version → 0.2.0.
  Items still needing human verification in the ACE Portal CAPE notice are listed
  in the `codes.ts` header (window start date; surety-paid / warehouse / non-ACE
  exclusions; AD/CVD scope). Phase 2 had not opened as of the verification date.

- **Task 1 — branded book-analysis PDF** (commit "Task 1: branded book-analysis
  PDF"): `src/lib/pdf.tsx` renders a four-page broker-brandable PDF via
  `@react-pdf/renderer` (chosen over puppeteer: pure JS, runs in a Vercel Node
  function and the no-DB CLI alike). Cover + per-importer ranking + urgent
  protest-deadlines + methodology/disclosures. `scripts/report.ts` CLI
  (`npm run report <csv> [as-of] -- --broker "Name" --color "#hex" --logo url`)
  and `app/api/report/route.ts` (POST CSV → PDF, branding via query params).

## Verification status
- `npm test` → 12/12 passing (eligibility + PDF).
- `npm run analyze fixtures/sample-entries.csv 2026-06-09` and
  `npm run report fixtures/sample-entries.csv 2026-06-09 -- --broker "..."` both work.
- `npm run build` compiles `/api/analyze` and `/api/report`.

## Next up (per CLAUDE.md build order)
**Task 2 — CAPE Declaration generator with pre-validation** (`src/lib/cape.ts`):
opted-in CAPE_NOW entries → CBP-template CSV(s), chunked ≤9,999, batched per
importer, with a pre-validation pass replicating known rejection causes
(entry-number format, filer-code mismatch, duplicates, non-eligible rows leaking
in). Output the file(s) plus a pre-flight report. Add malformed-fixture tests.
Context: only ~21% of CAPE submissions are accepted on first pass, so the
pre-validation pass is the core value here.

## First steps in the new session
1. `cd claimworks && npm install`
2. `npm test` to confirm green.
3. Re-point or re-create the Vercel project (Root Directory = `claimworks`).
4. Start Task 2.
