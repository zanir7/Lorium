import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, seal, sessionCookieOptions, validSession } from "../../../../lib/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const result = await validSession();
  if (!result) return NextResponse.json({ error: "Sign in again to send mail." }, { status: 401 });

  let body: { to?: string; subject?: string; content?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid message." }, { status: 400 });
  }

  const to = (body.to || "").trim();
  const subject = (body.subject || "").trim().slice(0, 500);
  const content = (body.content || "").trim().slice(0, 100_000);

  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !content) {
    return NextResponse.json({ error: "Recipient and message are required." }, { status: 400 });
  }

  let zohoResponse: Response;
  try {
    zohoResponse = await fetch(
      `https://mail.zoho.com/api/accounts/${result.session.accountId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Zoho-oauthtoken ${result.session.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fromAddress: result.session.email,
          toAddress: to,
          subject,
          content,
          mailFormat: "plaintext",
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    return NextResponse.json(
      { error: "Send status unknown. Check Sent before retrying; your draft is saved." },
      { status: 504 },
    );
  }

  let responseBody: unknown = {};
  try {
    responseBody = await zohoResponse.json();
  } catch {
    if (!zohoResponse.ok) responseBody = { error: "Mail service temporarily unavailable." };
  }

  const response = NextResponse.json(responseBody, { status: zohoResponse.ok ? 200 : zohoResponse.status });
  if (result.refreshed) response.cookies.set(SESSION_COOKIE, seal(result.session), sessionCookieOptions);
  return response;
}
