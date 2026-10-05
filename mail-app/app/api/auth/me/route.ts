import { NextResponse } from "next/server";
import { SESSION_COOKIE, seal, sessionCookieOptions, validSession } from "../../../../lib/session";

export const runtime = "nodejs";

export async function GET() {
  const result = await validSession();
  if (!result) return NextResponse.json({ authenticated: false }, { status: 401 });
  const response = NextResponse.json({ authenticated: true, email: result.session.email });
  if (result.refreshed) response.cookies.set(SESSION_COOKIE, seal(result.session), sessionCookieOptions);
  return response;
}
