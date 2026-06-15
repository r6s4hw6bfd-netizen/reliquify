import { NextRequest, NextResponse } from "next/server";
import { signMagicToken } from "@/lib/auth";
import { createResendSender } from "@/lib/optin";

export const runtime = "nodejs";

/**
 * POST { email } -> emails a magic sign-in link (or logs it when Resend isn't configured).
 * Always returns ok regardless of whether the email exists (no account enumeration).
 */
export async function POST(req: NextRequest) {
  try {
    const { email } = (await req.json()) as { email?: string };
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
    }
    const secret = process.env.AUTH_SECRET;
    if (!secret) return NextResponse.json({ error: "AUTH_SECRET is not configured" }, { status: 500 });

    const token = signMagicToken(email, secret);
    const base = process.env.APP_BASE_URL ?? req.nextUrl.origin;
    const link = `${base.replace(/\/$/, "")}/api/auth/verify?token=${encodeURIComponent(token)}`;

    if (process.env.RESEND_API_KEY && process.env.REPORT_FROM_EMAIL) {
      const sender = createResendSender(process.env.RESEND_API_KEY, process.env.REPORT_FROM_EMAIL);
      await sender.send({
        to: email,
        subject: "Your Reliquify sign-in link",
        text: `Sign in to Reliquify: ${link}\n\nThis link expires in 15 minutes.`,
        html: `<p>Sign in to Reliquify:</p><p><a href="${link}">${link}</a></p><p style="color:#888;font-size:12px">This link expires in 15 minutes.</p>`,
      });
    } else {
      // No mail configured (dev/preview): surface the link in logs so sign-in still works.
      console.log(`[auth] magic link for ${email}: ${link}`);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Auth request failure" }, { status: 500 });
  }
}
