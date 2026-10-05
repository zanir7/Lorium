import { NextResponse } from "next/server";
import { SESSION_COOKIE, seal, sessionCookieOptions, validSession } from "../../../../lib/session";

export const runtime = "nodejs";

export async function GET() {
  const mail = await validSession();
  if (!mail) return NextResponse.json({ authenticated: false, mailConnected: false }, { status: 401 });

  const response = NextResponse.json({
    authenticated: true,
    email: mail.session.email,
    mailConnected: true,
    mailEmail: mail.session.email,
  });
  if (mail.refreshed) response.cookies.set(SESSION_COOKIE, seal(mail.session), sessionCookieOptions);
  return response;
}
