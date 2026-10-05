import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, seal, sessionCookieOptions, validSession } from "../../../../lib/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const result = await validSession();
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as { to?: string; subject?: string; content?: string };
  const to = (body.to || "").trim();
  const subject = (body.subject || "").trim().slice(0, 500);
  const content = (body.content || "").trim().slice(0, 100_000);

  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !content) {
    return NextResponse.json({ error: "Recipient and message are required." }, { status: 400 });
  }

  const zohoResponse = await fetch(
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
    },
  );
  const responseBody = await zohoResponse.json();
  const response = NextResponse.json(responseBody, { status: zohoResponse.ok ? 200 : zohoResponse.status });
  if (result.refreshed) response.cookies.set(SESSION_COOKIE, seal(result.session), sessionCookieOptions);
  return response;
}
