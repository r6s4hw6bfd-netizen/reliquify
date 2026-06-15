import { NextRequest, NextResponse } from "next/server";
import { recordSignature, arrayAuditSink, inMemoryOptInStore } from "@/lib/optin";

export const runtime = "nodejs";

/**
 * POST /api/optin/webhook — e-sign provider callback recording a completed signature.
 * Body: { iorNumber: string, envelopeId?: string, event: "signed" | string, signedAt?: string }
 *
 * NOTE: this is the stub seam for the TBD e-sign vendor. Production must (1) verify the
 * provider's webhook signature before trusting the payload, and (2) persist via a
 * Drizzle-backed OptInStore + audit_log sink rather than the ephemeral in-memory store here.
 */
const store = inMemoryOptInStore();
const audit = arrayAuditSink();

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { iorNumber?: string; envelopeId?: string; event?: string; signedAt?: string };
    if (!body.iorNumber) return NextResponse.json({ error: "iorNumber is required" }, { status: 400 });
    if (body.event && body.event !== "signed") {
      return NextResponse.json({ ok: true, ignored: body.event });
    }

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
