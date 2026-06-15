import React from "react";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { BookAnalysis } from "./report";

/** Broker-facing branding for the white-label report. No Reliquify mention by default. */
export interface BrokerBranding {
  brokerName: string;
  /** Absolute URL or data URI; rendered on the cover when provided. */
  logoUrl?: string;
  /** Accent color (hex). */
  primaryColor?: string;
  /** e.g. "trade@broker.com · (555) 123-4567" */
  contactLine?: string;
}

const usd = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 10, color: "#1a1a1a", padding: 48 },
  coverPage: { fontFamily: "Helvetica", padding: 48, justifyContent: "center" },
  logo: { maxHeight: 60, maxWidth: 200, objectFit: "contain", alignSelf: "flex-start", marginBottom: 24 },
  coverBroker: { fontSize: 14, marginBottom: 4 },
  coverTitle: { fontSize: 26, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  coverDate: { fontSize: 11, color: "#555", marginBottom: 36 },
  headlineRow: { flexDirection: "row", gap: 12, marginBottom: 36 },
  headlineBox: { flex: 1, padding: 14, borderRadius: 4, color: "#fff" },
  headlineLabel: { fontSize: 8, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, opacity: 0.85 },
  headlineValue: { fontSize: 20, fontFamily: "Helvetica-Bold" },
  coverFootnote: { fontSize: 8, color: "#777" },
  h1: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 14 },
  row: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: "#ddd" },
  headerRow: { flexDirection: "row", paddingVertical: 6, paddingHorizontal: 6, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 9 },
  cImporter: { flex: 3 },
  cNum: { flex: 1, textAlign: "right" },
  para: { marginBottom: 8, lineHeight: 1.5 },
  small: { fontSize: 8.5, color: "#444", lineHeight: 1.5, marginBottom: 6 },
  footer: { position: "absolute", bottom: 24, left: 48, right: 48, fontSize: 8, color: "#888", flexDirection: "row", justifyContent: "space-between" },
});

const Footer = ({ branding, analysis }: { branding: BrokerBranding; analysis: BookAnalysis }) => (
  <View style={styles.footer} fixed>
    <Text>{branding.brokerName} — IEEPA Tariff Refund Book Analysis</Text>
    <Text>Estimates as of {analysis.engineToday} · Confidential</Text>
  </View>
);

function BookAnalysisDoc({ analysis, branding }: { analysis: BookAnalysis; branding: BrokerBranding }) {
  const accent = branding.primaryColor ?? "#1e3a5f";
  const t = analysis.totals;
  const urgent = analysis.importers.flatMap((i) =>
    i.urgentDeadlines.map((d) => ({ ...d, importerName: i.importerName }))
  ).sort((a, b) => a.daysLeft - b.daysLeft);
  const hasEstimates = analysis.importers.some((i) => i.hasEstimatedFigures);

  return (
    <Document title="IEEPA Tariff Refund Book Analysis" author={branding.brokerName}>
      {/* Cover */}
      <Page size="LETTER" style={styles.coverPage}>
        {branding.logoUrl ? <Image style={styles.logo} src={branding.logoUrl} /> : null}
        <Text style={styles.coverBroker}>{branding.brokerName}</Text>
        <Text style={styles.coverTitle}>IEEPA Tariff Refund{"\n"}Book Analysis</Text>
        <Text style={styles.coverDate}>
          As of {analysis.engineToday}{branding.contactLine ? ` · ${branding.contactLine}` : ""}
        </Text>
        <View style={styles.headlineRow}>
          <View style={[styles.headlineBox, { backgroundColor: accent }]}>
            <Text style={styles.headlineLabel}>Est. total potential refund</Text>
            <Text style={styles.headlineValue}>{usd(t.estRefundTotalPotential)}</Text>
          </View>
          <View style={[styles.headlineBox, { backgroundColor: accent, opacity: 0.85 }]}>
            <Text style={styles.headlineLabel}>Claimable via CAPE now</Text>
            <Text style={styles.headlineValue}>{usd(t.estRefundCapeNow)}</Text>
          </View>
          <View style={[styles.headlineBox, { backgroundColor: accent, opacity: 0.7 }]}>
            <Text style={styles.headlineLabel}>Entries / Importers</Text>
            <Text style={styles.headlineValue}>{t.entries} / {t.importers}</Text>
          </View>
        </View>
        <Text style={styles.coverFootnote}>
          All dollar figures are estimates, subject to U.S. Customs and Border Protection determination.
          See Methodology &amp; Disclosures. This document is not legal advice.
        </Text>
      </Page>

      {/* Importer ranking */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.h1}>Recovery by Importer</Text>
        <View style={[styles.headerRow, { backgroundColor: accent }]}>
          <Text style={styles.cImporter}>Importer (IOR)</Text>
          <Text style={styles.cNum}>Entries</Text>
          <Text style={styles.cNum}>CAPE now</Text>
          <Text style={styles.cNum}>Needs review</Text>
          <Text style={styles.cNum}>Est. CAPE-now $</Text>
          <Text style={styles.cNum}>Est. total $</Text>
        </View>
        {analysis.importers.map((imp) => (
          <View style={styles.row} key={imp.iorNumber} wrap={false}>
            <Text style={styles.cImporter}>
              {imp.importerName} ({imp.iorNumber}){imp.hasEstimatedFigures ? " *" : ""}
            </Text>
            <Text style={styles.cNum}>{imp.entryCount}</Text>
            <Text style={styles.cNum}>{imp.byPath.CAPE_NOW}</Text>
            <Text style={styles.cNum}>{imp.byPath.NEEDS_REVIEW}</Text>
            <Text style={styles.cNum}>{usd(imp.estRefundCapeNow)}</Text>
            <Text style={styles.cNum}>{usd(imp.estRefundTotalPotential)}</Text>
          </View>
        ))}
        {hasEstimates ? (
          <Text style={[styles.small, { marginTop: 10 }]}>
            * Contains estimated figures: the source export lacked line-level IEEPA duty for some entries.
            Request a line-level duty export to firm up these numbers.
          </Text>
        ) : null}
        <Footer branding={branding} analysis={analysis} />
      </Page>

      {/* Urgent deadlines */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.h1}>Urgent: Protest Deadlines</Text>
        {urgent.length === 0 ? (
          <Text style={styles.para}>No entries currently require a protest filing to preserve refund rights.</Text>
        ) : (
          <>
            <Text style={styles.para}>
              The following entries fall outside CAPE Phase 1 and require a protest under 19 U.S.C. § 1514
              before the dates below to preserve refund rights. Route to trade counsel immediately.
            </Text>
            <View style={[styles.headerRow, { backgroundColor: accent }]}>
              <Text style={styles.cImporter}>Importer</Text>
              <Text style={[styles.cImporter, { flex: 2 }]}>Entry number</Text>
              <Text style={styles.cNum}>Deadline</Text>
              <Text style={styles.cNum}>Days left</Text>
            </View>
            {urgent.map((d) => (
              <View style={styles.row} key={d.entryNumber} wrap={false}>
                <Text style={styles.cImporter}>{d.importerName}</Text>
                <Text style={[styles.cImporter, { flex: 2 }]}>{d.entryNumber}</Text>
                <Text style={styles.cNum}>{d.deadline}</Text>
                <Text style={styles.cNum}>{d.daysLeft}</Text>
              </View>
            ))}
          </>
        )}
        <Footer branding={branding} analysis={analysis} />
      </Page>

      {/* Methodology & disclosures */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.h1}>Methodology &amp; Disclosures</Text>
        <Text style={styles.para}>
          Each entry in the source data was classified by a deterministic rules engine
          (version {analysis.results[0]?.classification.engineVersion ?? "n/a"}) into one of the following
          claim paths, based on its IEEPA Chapter 99 tariff lines (9903.01 / 9903.02), entry date,
          liquidation status, and CAPE Phase 1 eligibility rules published by CBP:
        </Text>
        <Text style={styles.small}>• CAPE NOW — eligible for a CAPE Declaration today (unliquidated, or liquidated within the Phase 1 lookback).</Text>
        <Text style={styles.small}>• CAPE LATER PHASE — excluded from Phase 1 (e.g. reconciliation, drawback, AD/CVD, open protest); expected in a later CAPE phase.</Text>
        <Text style={styles.small}>• PROTEST REQUIRED — outside the Phase 1 lookback but within the 180-day protest window; a protest filing is required to preserve rights.</Text>
        <Text style={styles.small}>• NEEDS REVIEW — data is incomplete or the entry is past the protest window; individual review required. No recovery is promised for these entries.</Text>
        <Text style={styles.small}>• NOT IEEPA — no IEEPA Chapter 99 lines found; no refund expected.</Text>
        <Text style={[styles.para, { marginTop: 10 }]}>
          Refund figures sum the IEEPA duty identified on each eligible entry. Where the source export did not
          break out IEEPA duty at line level, figures are estimates and are flagged as such. Interest shown is a
          simple-interest estimate; actual interest is computed by CBP under 19 CFR 24.36 at quarterly Treasury
          rates (26 U.S.C. § 6621) and will differ.
        </Text>
        <Text style={styles.small}>
          This analysis is provided for evaluation purposes only and is not legal advice. All amounts are
          estimates subject to CBP validation, liquidation status changes, and final agency determination.
          Filing is performed by the licensed customs broker through their own ACE Portal credentials.
          Entries classified NEEDS REVIEW or past statutory deadlines may yield no recovery.
        </Text>
        <Footer branding={branding} analysis={analysis} />
      </Page>
    </Document>
  );
}

export async function renderBookAnalysisPdf(analysis: BookAnalysis, branding: BrokerBranding): Promise<Buffer> {
  return renderToBuffer(<BookAnalysisDoc analysis={analysis} branding={branding} />);
}
