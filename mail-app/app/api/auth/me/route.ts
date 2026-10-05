import { NextResponse } from "next/server";
import { IDENTITY_COOKIE, identityCookieOptions, sealIdentity, validIdentity } from "../../../../lib/identity";
import {
  loadPersistedMailSession, persistMailSession, SESSION_COOKIE,
  seal, sessionCookieOptions, validSession,
} from "../../../../lib/session";

export const runtime = "nodejs";

export async function GET() {
  const identity = await validIdentity();
  if (!identity) return NextResponse.json({ authenticated: false }, { status: 401 });

  let mail = await validSession();
  if (mail && mail.session.email.toLowerCase() !== identity.session.email.toLowerCase()) {
    mail = null;
  }

  let restored = false;
  if (!mail) {
    const persisted = await loadPersistedMailSession(identity.session);
    if (persisted) {
      mail = { session: persisted, refreshed: false };
      restored = true;
    }
  } else if (mail.refreshed) {
    await persistMailSession(identity.session, mail.session);
  }

  const response = NextResponse.json({
    authenticated: true,
    email: identity.session.email,
    mailConnected: Boolean(mail),
    mailEmail: mail?.session.email || null,
  });
  if (identity.refreshed) response.cookies.set(IDENTITY_COOKIE, sealIdentity(identity.session), identityCookieOptions);
  if (mail && (mail.refreshed || restored)) response.cookies.set(SESSION_COOKIE, seal(mail.session), sessionCookieOptions);
  return response;
}
