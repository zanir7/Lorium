import { NextRequest, NextResponse } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL } from "../../../../lib/identity";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json() as { accessToken?: string; password?: string };
  const accessToken = body.accessToken || "";
  const password = body.password || "";
  if (!accessToken || password.length < 8) {
    return NextResponse.json({ error: "Use a password with at least 8 characters." }, { status: 400 });
  }

  const upstream = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
    cache: "no-store",
  });

  if (!upstream.ok) {
    return NextResponse.json({ error: "This recovery link is invalid or expired." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
