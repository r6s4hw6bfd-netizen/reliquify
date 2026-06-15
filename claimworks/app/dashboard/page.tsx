import { redirect } from "next/navigation";
import { getSessionEmail } from "@/lib/session";
import { getDashboard } from "@/lib/dashboard-store";
import { DECLARATION_STATUSES } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export default async function DashboardPage() {
  const email = await getSessionEmail();
  if (!email) redirect("/login");

  const { store, brokerageId } = await getDashboard(email);
  const vm = brokerageId ? await store.getBrokerageView(brokerageId) : undefined;

  return (
    <main style={{ maxWidth: 960, margin: "32px auto", padding: "0 20px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ fontSize: 24 }}>{vm?.brokerageName ?? "Brokerage dashboard"}</h1>
        <span style={{ color: "#777", fontSize: 13 }}>{email}</span>
      </header>

      {!vm ? (
        <section style={{ background: "#fff", borderRadius: 10, padding: 24, marginTop: 16 }}>
          <p>No data source connected yet.</p>
          <p style={{ color: "#666", fontSize: 14 }}>
            Set <code>DATABASE_URL</code> and ingest a book to populate the brokerage view. Engine output and
            CAPE/remediation artifacts are available today via the API routes and CLIs.
          </p>
        </section>
      ) : (
        <>
          <section style={{ display: "flex", gap: 16, marginTop: 16 }}>
            <Card label="Claimable via CAPE now" value={usd(vm.totalEstRefundCapeNow)} />
            <Card label="Total potential (all paths)" value={usd(vm.totalEstRefundTotalPotential)} />
          </section>

          <h2 style={{ fontSize: 16, marginTop: 28 }}>Claim pipeline</h2>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {DECLARATION_STATUSES.map((s) => (
              <span key={s} style={{ background: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 13 }}>
                {s}: <strong>{vm.pipeline[s]}</strong>
              </span>
            ))}
          </div>

          <h2 style={{ fontSize: 16, marginTop: 28 }}>Importers by recovery</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 8, overflow: "hidden" }}>
            <thead>
              <tr style={{ textAlign: "left", background: "#eef1f4", fontSize: 13 }}>
                <th style={th}>Importer</th><th style={th}>IOR</th><th style={th}>Entries</th>
                <th style={th}>CAPE now</th><th style={th}>Total potential</th>
              </tr>
            </thead>
            <tbody>
              {vm.importers.map((imp) => (
                <tr key={imp.iorNumber} style={{ borderTop: "1px solid #eee", fontSize: 14 }}>
                  <td style={td}>{imp.importerName}{imp.hasEstimatedFigures ? " *" : ""}</td>
                  <td style={td}>{imp.iorNumber}</td>
                  <td style={td}>{imp.entryCount}</td>
                  <td style={td}>{usd(imp.estRefundCapeNow)}</td>
                  <td style={td}>{usd(imp.estRefundTotalPotential)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {vm.urgentDeadlines.length > 0 && (
            <>
              <h2 style={{ fontSize: 16, marginTop: 28 }}>Urgent protest deadlines</h2>
              <ul>
                {vm.urgentDeadlines.map((u) => (
                  <li key={u.entryNumber} style={{ fontSize: 14 }}>
                    {u.deadline} ({u.daysLeft}d) — {u.entryNumber}, {u.importerName}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p style={{ color: "#999", fontSize: 12, marginTop: 20 }}>* contains estimated figures — request a line-level duty export.</p>
        </>
      )}
    </main>
  );
}

const th: React.CSSProperties = { padding: "8px 12px" };
const td: React.CSSProperties = { padding: "8px 12px" };

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#fff", borderRadius: 10, padding: 18, flex: 1 }}>
      <div style={{ color: "#777", fontSize: 13 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}
