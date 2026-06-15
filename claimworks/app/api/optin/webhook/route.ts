import { NextRequest, NextResponse } from "next/server";
import { recordSignature } from "@/lib/optin";
import { getOptInPersistence } from "@/db/persistence";

export const runtime = "nodejs";

/**
 * POST /api/optin/webhook — e-sign provider callback recording a completed signature.
 * Body: { iorNumber: string, envelopeId?: string, event: "signed" | string, signedAt?: string }
 *
 * Persists via the Drizzle-backed store + audit_log when DATABASE_URL is set; in-memory stub
 * otherwise. STILL TODO before production: verify the provider's webhook signature before
 * trusting the payload (the e-sign vendor is not yet selected).
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { iorNumber?: string; envelopeId?: string; event?: string; signedAt?: string };
    if (!body.iorNumber) return NextResponse.json({ error: "iorNumber is required" }, { status: 400 });
    if (body.event && body.event !== "signed") {
      return NextResponse.json({ ok: true, ignored: body.event });
    }

    const { store, audit } = await getOptInPersistence();
    const existing = await store.getByIor(body.iorNumber);
    const state =
      existing ?? {
        iorNumber: body.iorNumber,
        importerName: "",
        contactEmail: "",
        optInStatus: "sent" as const,
        touchesSent: 0,
        unsubscribed: false,
        envelopeId: body.envelopeId,
      };
    await recordSignature(state, audit, {
      envelopeId: body.envelopeId,
      signedAt: body.signedAt ? new Date(body.signedAt) : undefined,
    });
    await store.save(state);

    return NextResponse.json({ ok: true, iorNumber: state.iorNumber, optInStatus: state.optInStatus });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Webhook failure" }, { status: 400 });
  }
}
