import { NextRequest, NextResponse } from "next/server";
import { seal, SESSION_COOKIE, STATE_COOKIE, sessionCookieOptions, type MailSession } from "../../../../lib/session";

export const runtime = "nodejs";

type Account = {
  accountId?: string;
  primaryEmailAddress?: string;
  mailboxAddress?: string;
  enabled?: boolean;
};

function fail(origin: string, error: string, stage: string, status?: number) {
  console.error("[mail-oauth] callback failed", { stage, status });
  return NextResponse.redirect(`${origin}/?error=${encodeURIComponent(error)}`);
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const origin = process.env.PUBLIC_ORIGIN || "https://mail.loriumarchive.com";

  try {
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const expected = request.cookies.get(STATE_COOKIE)?.value;

    if (!code || !state || !expected || state !== expected) {
      return fail(origin, "authorization", "state");
    }

    const clientId = process.env.ZOHO_CLIENT_ID;
    const clientSecret = process.env.ZOHO_CLIENT_SECRET;
    if (!clientId || !clientSecret) return fail(origin, "configuration", "configuration");

    const redirectUri = process.env.ZOHO_REDIRECT_URI || `${origin}/api/auth/callback`;
    const base = process.env.ZOHO_ACCOUNTS_BASE || "https://accounts.zoho.com";
    const params = new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });

    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(`${base}/oauth/v2/token?${params}`, {
        method: "POST",
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      return fail(origin, "token", "token-network");
    }

    const tokenBody = await safeJson(tokenResponse);
    const token = tokenBody && typeof tokenBody === "object"
      ? tokenBody as { access_token?: string; refresh_token?: string; expires_in?: number }
      : {};

    if (!tokenResponse.ok || !token.access_token || !token.refresh_token) {
      return fail(origin, "token", "token-response", tokenResponse.status);
    }

    let accountsResponse: Response;
    try {
      accountsResponse = await fetch("https://mail.zoho.com/api/accounts", {
        headers: { Authorization: `Zoho-oauthtoken ${token.access_token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      return fail(origin, "mail_account", "accounts-network");
    }

    const accountsBody = await safeJson(accountsResponse) as { data?: Account[] | Account } | null;
    if (!accountsResponse.ok || !accountsBody) {
      return fail(origin, "mail_account", "accounts-response", accountsResponse.status);
    }

    const raw = accountsBody.data;
    const accounts: Account[] = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
    const account = accounts.find((item) => {
      const address = (item.primaryEmailAddress || item.mailboxAddress || "").toLowerCase();
      return address.endsWith("@loriumarchive.com") && item.enabled !== false && Boolean(item.accountId);
    });

    if (!account?.accountId) return fail(origin, "mail_account", "accounts-domain");

    const email = (account.primaryEmailAddress || account.mailboxAddress || "").toLowerCase();
    const mailSession: MailSession = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + (token.expires_in || 3600) * 1000,
      email,
      accountId: account.accountId,
    };

    const response = NextResponse.redirect(origin);
    response.cookies.delete(STATE_COOKIE);
    response.cookies.set(SESSION_COOKIE, seal(mailSession), sessionCookieOptions);
    console.info("[mail-oauth] callback success", { domain: "loriumarchive.com" });
    return response;
  } catch (error) {
    console.error("[mail-oauth] callback exception", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.redirect(`${origin}/?error=unexpected`);
  }
}
