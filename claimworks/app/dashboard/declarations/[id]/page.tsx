import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionEmail } from "@/lib/session";
import { getDashboard } from "@/lib/dashboard-store";

export const dynamic = "force-dynamic";

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

async function signOffAction(formData: FormData) {
  "use server";
  const email = await getSessionEmail();
  if (!email) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const signer = String(formData.get("signer") ?? "");
  try {
    const { store } = await getDashboard(email);
    await store.signOff(id, signer);
    revalidatePath(`/dashboard/declarations/${id}`);
  } catch (e) {
    redirect(`/dashboard/declarations/${id}?error=${encodeURIComponent(e instanceof Error ? e.message : "sign-off failed")}`);
  }
}

export default async function DeclarationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const email = await getSessionEmail();
  if (!email) redirect("/login");
  const { id } = await params;
  const { error } = await searchParams;

  const { store } = await getDashboard(email);
  const vm = await store.getDeclarationDetail(id);

  return (
    <main style={{ maxWidth: 860, margin: "32px auto", padding: "0 20px" }}>
      <a href="/dashboard" style={{ fontSize: 13 }}>← Dashboard</a>
      <h1 style={{ fontSize: 22 }}>Declaration {id}</h1>
      {error && <p style={{ color: "#b00", fontSize: 13 }}>{error}</p>}

      {!vm ? (
        <section style={{ background: "#fff", borderRadius: 10, padding: 24 }}>
          <p>Declaration not found, or no data source is connected.</p>
          <p style={{ color: "#666", fontSize: 14 }}>Set <code>DATABASE_URL</code> and wire the Drizzle-backed store to view declaration detail.</p>
        </section>
      ) : (
        <>
          <p style={{ fontSize: 14 }}>
            {vm.declaration.importerName} (IOR {vm.declaration.iorNumber}) — status <strong>{vm.declaration.status}</strong>,
            {" "}{vm.declaration.entryCount} entries
            {vm.declaration.qcSignedBy ? ` — QC signed by ${vm.declaration.qcSignedBy}` : ""}
          </p>

          <h2 style={{ fontSize: 16 }}>Entries</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 8, overflow: "hidden" }}>
            <thead>
              <tr style={{ textAlign: "left", background: "#eef1f4", fontSize: 13 }}>
                <th style={cell}>Entry</th><th style={cell}>Path</th><th style={cell}>Est. total</th>
              </tr>
            </thead>
            <tbody>
              {vm.entries.map((e) => (
                <tr key={e.entryNumber} style={{ borderTop: "1px solid #eee", fontSize: 14 }}>
                  <td style={cell}>{e.entryNumber}</td>
                  <td style={cell}>{e.path}</td>
                  <td style={cell}>{usd(e.estTotal)}{e.isEstimate ? " *" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {vm.remediation.length > 0 && (
            <>
              <h2 style={{ fontSize: 16, marginTop: 24 }}>Remediation queue</h2>
              <ul>
                {vm.remediation.map((r) => (
                  <li key={r.entryNumber} style={{ fontSize: 14 }}>
                    [{r.disposition}] {r.entryNumber} — {r.reasons[0]}
                  </li>
                ))}
              </ul>
            </>
          )}

          <h2 style={{ fontSize: 16, marginTop: 24 }}>QC sign-off</h2>
          {vm.canSignOff ? (
            <form action={signOffAction} style={{ background: "#fff", borderRadius: 10, padding: 18 }}>
              <input type="hidden" name="id" value={id} />
              <p style={{ fontSize: 13, color: "#555", marginTop: 0 }}>
                Reasonable-care gate: typing your name moves this declaration from draft to ready.
              </p>
              <input name="signer" required placeholder="Your full name" style={{ padding: 9, fontSize: 14, border: "1px solid #ccc", borderRadius: 6, width: 280 }} />
              <button type="submit" style={{ marginLeft: 10, padding: "9px 16px", background: "#1e3a5f", color: "#fff", border: 0, borderRadius: 6, cursor: "pointer" }}>
                Sign off & mark ready
              </button>
            </form>
          ) : (
            <p style={{ fontSize: 14, color: "#555" }}>
              {vm.declaration.qcSignedBy
                ? `Signed off by ${vm.declaration.qcSignedBy}.`
                : "Sign-off unavailable (declaration must be a non-empty draft)."}
            </p>
          )}
        </>
      )}
    </main>
  );
}

const cell: React.CSSProperties = { padding: "8px 12px" };
