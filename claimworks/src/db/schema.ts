import {
  pgTable, uuid, text, timestamp, date, boolean, integer, numeric, pgEnum, jsonb, uniqueIndex,
} from "drizzle-orm/pg-core";

export const liquidationStatus = pgEnum("liquidation_status", [
  "unliquidated", "liquidated", "reliquidated", "unknown",
]);

export const claimPath = pgEnum("claim_path", [
  "CAPE_NOW", "CAPE_LATER_PHASE", "PROTEST_REQUIRED", "NEEDS_REVIEW", "EXPIRED", "NOT_IEEPA",
]);

export const declarationStatus = pgEnum("declaration_status", [
  "draft", "ready", "filed", "partially_accepted", "accepted", "rejected", "paid",
]);

export const brokerages = pgTable("brokerages", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  filerCode: text("filer_code").notNull(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  feeSplitBrokerPct: numeric("fee_split_broker_pct").default("60"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [uniqueIndex("brokerages_filer_code_idx").on(t.filerCode)]);

export const importers = pgTable("importers", {
  id: uuid("id").primaryKey().defaultRandom(),
  brokerageId: uuid("brokerage_id").references(() => brokerages.id).notNull(),
  name: text("name").notNull(),
  iorNumber: text("ior_number").notNull(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  achVerified: boolean("ach_verified").default(false).notNull(),
  form4811OnFile: boolean("form_4811_on_file").default(false).notNull(),
  optInStatus: text("opt_in_status").default("pending").notNull(), // pending | sent | signed | declined
  // Opt-in sequence tracking (Task 4 persistence)
  optInTouchesSent: integer("opt_in_touches_sent").default(0).notNull(),
  optInLastTouchAt: timestamp("opt_in_last_touch_at"),
  optInUnsubscribed: boolean("opt_in_unsubscribed").default(false).notNull(),
  optInEnvelopeId: text("opt_in_envelope_id"),
  optInSignedAt: timestamp("opt_in_signed_at"),
  feeRatePct: numeric("fee_rate_pct").default("5"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const entries = pgTable("entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  importerId: uuid("importer_id").references(() => importers.id).notNull(),
  entryNumber: text("entry_number").notNull(),
  filerCode: text("filer_code").notNull(),
  entryType: text("entry_type"), // e.g. "01" consumption, "03" AD/CVD
  entryDate: date("entry_date").notNull(),
  portCode: text("port_code"),
  liquidationStatus: liquidationStatus("liquidation_status").default("unknown").notNull(),
  liquidationDate: date("liquidation_date"),
  reconciliationFlag: boolean("reconciliation_flag").default(false).notNull(),
  drawbackFlag: boolean("drawback_flag").default(false).notNull(),
  adcvdFlag: boolean("adcvd_flag").default(false).notNull(),
  openProtestFlag: boolean("open_protest_flag").default(false).notNull(),
  totalEnteredValue: numeric("total_entered_value"),
  totalDutyPaid: numeric("total_duty_paid"),
  // Engine outputs (denormalized for dashboard speed; recomputed on every run)
  claimPath: claimPath("claim_path"),
  claimDeadline: date("claim_deadline"),
  estIeepaDuty: numeric("est_ieepa_duty"),
  estInterest: numeric("est_interest"),
  engineReasons: jsonb("engine_reasons"),
  engineVersion: text("engine_version"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [uniqueIndex("entries_entry_number_idx").on(t.entryNumber)]);

export const entryLines = pgTable("entry_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryId: uuid("entry_id").references(() => entries.id).notNull(),
  lineNumber: integer("line_number").notNull(),
  htsCode: text("hts_code").notNull(),
  chapter99Codes: jsonb("chapter99_codes").$type<string[]>().default([]),
  enteredValue: numeric("entered_value"),
  dutyPaid: numeric("duty_paid"),
  ieepaDutyPaid: numeric("ieepa_duty_paid"), // duty attributable to 9903.01/9903.02 lines
});

export const declarations = pgTable("declarations", {
  id: uuid("id").primaryKey().defaultRandom(),
  brokerageId: uuid("brokerage_id").references(() => brokerages.id).notNull(),
  importerId: uuid("importer_id").references(() => importers.id),
  status: declarationStatus("status").default("draft").notNull(),
  capeCsvPath: text("cape_csv_path"),
  entryCount: integer("entry_count").default(0).notNull(),
  filedAt: timestamp("filed_at"),
  qcSignedBy: text("qc_signed_by"), // reasonable-care gate: a human name goes here before "ready"
  qcSignedAt: timestamp("qc_signed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const declarationEntries = pgTable("declaration_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  declarationId: uuid("declaration_id").references(() => declarations.id).notNull(),
  entryId: uuid("entry_id").references(() => entries.id).notNull(),
  validationStatus: text("validation_status").default("pending").notNull(), // pending | accepted | rejected
  rejectionCode: text("rejection_code"),
  rejectionReason: text("rejection_reason"),
  resubmittedInDeclarationId: uuid("resubmitted_in_declaration_id"),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actor: text("actor").notNull(), // "engine" | user email
  action: text("action").notNull(),
  subjectTable: text("subject_table"),
  subjectId: uuid("subject_id"),
  detail: jsonb("detail"),
  at: timestamp("at").defaultNow().notNull(),
});
