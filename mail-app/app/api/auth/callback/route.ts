import { NextRequest, NextResponse } from "next/server";
import { validIdentity } from "../../../../lib/identity";
import { seal, SESSION_COOKIE, STATE_COOKIE, sessionCookieOptions } from "../../../../lib/session";

export const runtime = "nodejs";

type Account = {
  accountId: string;
  primaryEmailAddress?: string;
  mailboxAddress?: string;
  enabled?: boolean;
};

export async function GET(request: NextRequest) {
  const origin = process.env.PUBLIC_ORIGIN || "https://mail.loriumarchive.com";
  const identity = await validIdentity();
  if (!identity) return NextResponse.redirect(`${origin}/?error=identity`);
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expected = request.cookies.get(STATE_COOKIE)?.value;

  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(`${origin}/?error=authorization`);
  }

  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  if (!clientId || !clientSecret) return NextResponse.redirect(`${origin}/?error=configuration`);

  const redirectUri = process.env.ZOHO_REDIRECT_URI || `${origin}/api/auth/callback`;
  const base = process.env.ZOHO_ACCOUNTS_BASE || "https://accounts.zoho.com";
  const params = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });

  const tokenResponse = await fetch(`${base}/oauth/v2/token?${params}`, { method: "POST", cache: "no-store" });
  const token = await tokenResponse.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!tokenResponse.ok || !token.access_token || !token.refresh_token) {
    return NextResponse.redirect(`${origin}/?error=token`);
  }

  const accountsResponse = await fetch("https://mail.zoho.com/api/accounts", {
    headers: { Authorization: `Zoho-oauthtoken ${token.access_token}` },
    cache: "no-store",
  });
  const accountsBody = await accountsResponse.json() as { data?: Account[] };
  const account = accountsBody.data?.find((item) => {
    const address = (item.primaryEmailAddress || item.mailboxAddress || "").toLowerCase();
    return address.endsWith("@loriumarchive.com") && item.enabled !== false;
  });

  if (!account) return NextResponse.redirect(`${origin}/?error=domain`);

  const email = (account.primaryEmailAddress || account.mailboxAddress || "").toLowerCase();
  const response = NextResponse.redirect(origin);
  response.cookies.delete(STATE_COOKIE);
  response.cookies.set(
    SESSION_COOKIE,
    seal({
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + (token.expires_in || 3600) * 1000,
      email,
      accountId: account.accountId,
    }),
    sessionCookieOptions,
  );
  return response;
}
