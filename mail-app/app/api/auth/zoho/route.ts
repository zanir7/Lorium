import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { STATE_COOKIE } from "../../../../lib/session";

export const runtime = "nodejs";

export async function GET() {
  const origin = process.env.PUBLIC_ORIGIN || "https://mail.loriumarchive.com";
  const clientId = process.env.ZOHO_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: "Mail authorization is not configured." }, { status: 503 });

  const redirectUri = process.env.ZOHO_REDIRECT_URI || `${origin}/api/auth/callback`;
  const base = process.env.ZOHO_ACCOUNTS_BASE || "https://accounts.zoho.com";
  const state = crypto.randomBytes(24).toString("base64url");

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.READ,ZohoMail.messages.CREATE",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  const response = NextResponse.redirect(`${base}/oauth/v2/auth?${params}`);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600,
  });
  return response;
}
