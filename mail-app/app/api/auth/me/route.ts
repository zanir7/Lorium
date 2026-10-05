import { NextResponse } from "next/server";
import { IDENTITY_COOKIE, identityCookieOptions, sealIdentity, validIdentity } from "../../../../lib/identity";
import { SESSION_COOKIE, seal, sessionCookieOptions, validSession } from "../../../../lib/session";

export const runtime = "nodejs";

export async function GET() {
  const identity = await validIdentity();
  if (!identity) return NextResponse.json({ authenticated: false }, { status: 401 });

  const mail = await validSession();
  const response = NextResponse.json({
    authenticated: true,
    email: identity.session.email,
    mailConnected: Boolean(mail),
    mailEmail: mail?.session.email || null,
  });
  if (identity.refreshed) response.cookies.set(IDENTITY_COOKIE, sealIdentity(identity.session), identityCookieOptions);
  if (mail?.refreshed) response.cookies.set(SESSION_COOKIE, seal(mail.session), sessionCookieOptions);
  return response;
}
