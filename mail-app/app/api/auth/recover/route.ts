import { NextRequest, NextResponse } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL } from "../../../../lib/identity";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json() as { email?: string };
  const email = (body.email || "").trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "Email is required." }, { status: 400 });

  const origin = process.env.PUBLIC_ORIGIN || "https://mail.loriumarchive.com";
  await fetch(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(origin)}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
    cache: "no-store",
  });

  // Do not reveal whether an identity exists.
  return NextResponse.json({ ok: true });
}
