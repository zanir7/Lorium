import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { STATE_COOKIE, STATE_MAX_AGE, publicOrigin } from "../../../../lib/session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const origin = publicOrigin();

  // The state cookie must live on the same host Zoho redirects back to.
  // Starting on any other host (e.g. the *.vercel.app alias) would always
  // fail the state check, so hop to the public origin first.
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (host && host !== new URL(origin).host) {
    return NextResponse.redirect(`${origin}/api/auth/zoho${request.nextUrl.search}`);
  }

  const clientId = process.env.ZOHO_CLIENT_ID;
  if (!clientId) return NextResponse.redirect(`${origin}/?error=configuration`);

  const redirectUri = process.env.ZOHO_REDIRECT_URI || `${origin}/api/auth/callback`;
  const base = process.env.ZOHO_ACCOUNTS_BASE || "https://accounts.zoho.com";
  // A trailing ".r" marks an automatic retry so the callback never loops.
  const retry = request.nextUrl.searchParams.get("retry") === "1";
  const state = crypto.randomBytes(24).toString("base64url") + (retry ? ".r" : "");

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
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: STATE_MAX_AGE,
  });
  return response;
}
