import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "../../../../lib/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  const options = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: 0 };
  // Also clears the cookie left behind by the retired password sign-in.
  response.cookies.set("lorium_identity", "", options);
  response.cookies.set(SESSION_COOKIE, "", options);
  return response;
}
