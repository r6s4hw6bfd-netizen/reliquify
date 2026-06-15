import { NextRequest, NextResponse } from "next/server";
import { handleUnsubscribe } from "@/lib/optin";
import { getOptInPersistence } from "@/db/persistence";

export const runtime = "nodejs";

/**
 * GET /api/optin/unsubscribe?ior=12-3456789  — honors an importer unsubscribe.
 *
 * Persists via the Drizzle-backed store + audit_log when DATABASE_URL is set; falls back to
 * the in-memory stub otherwise. The unsubscribe is always honored regardless of prior status.
 */
export async function GET(req: NextRequest) {
  const ior = req.nextUrl.searchParams.get("ior");
  if (!ior) return NextResponse.json({ error: "ior is required" }, { status: 400 });

  const { store, audit } = await getOptInPersistence();
  const existing = await store.getByIor(ior);
  const state =
    existing ?? {
      iorNumber: ior,
      importerName: "",
      contactEmail: "",
      optInStatus: "pending" as const,
      touchesSent: 0,
      unsubscribed: false,
    };
  await handleUnsubscribe(state, audit);
  await store.save(state);

  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;max-width:480px;margin:64px auto;text-align:center">
     <h2>You're unsubscribed</h2><p>You will not receive further emails about this refund opportunity.</p></body>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
