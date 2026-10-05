import { NextRequest, NextResponse } from "next/server";
import {
  IDENTITY_COOKIE, SUPABASE_KEY, SUPABASE_URL,
  identityCookieOptions, sealIdentity,
} from "../../../../lib/identity";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json() as { email?: string; password?: string };
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  if (!email || !password) return NextResponse.json({ error: "Email and password are required." }, { status: 400 });

  const upstream = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  const data = await upstream.json() as {
    access_token?: string; refresh_token?: string; expires_in?: number;
    user?: { id?: string; email?: string };
  };

  if (!upstream.ok || !data.access_token || !data.refresh_token || !data.user?.id) {
    return NextResponse.json({ error: "Unable to verify Lorium identity." }, { status: 401 });
  }

  const response = NextResponse.json({ authenticated: true, email: data.user.email || email });
  response.cookies.set(
    IDENTITY_COOKIE,
    sealIdentity({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
      email: data.user.email || email,
      userId: data.user.id,
    }),
    identityCookieOptions,
  );
  return response;
}
