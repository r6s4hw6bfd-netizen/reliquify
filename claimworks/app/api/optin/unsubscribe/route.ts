import { NextRequest, NextResponse } from "next/server";
import { handleUnsubscribe, arrayAuditSink, inMemoryOptInStore } from "@/lib/optin";

export const runtime = "nodejs";

/**
 * GET /api/optin/unsubscribe?ior=12-3456789  — honors an importer unsubscribe.
 *
 * NOTE: persistence here uses the ephemeral in-memory store as a stub; production wires a
 * Drizzle-backed OptInStore (importers.opt_in_status) and a real audit_log sink. The
 * unsubscribe is always honored regardless of prior status.
 */
const store = inMemoryOptInStore();
const audit = arrayAuditSink();

export async function GET(req: NextRequest) {
  const ior = req.nextUrl.searchParams.get("ior");
  if (!ior) return NextResponse.json({ error: "ior is required" }, { status: 400 });

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
