import { NextResponse } from "next/server";
import { IDENTITY_COOKIE } from "../../../../lib/identity";
import { SESSION_COOKIE } from "../../../../lib/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  const options = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: 0 };
  response.cookies.set(IDENTITY_COOKIE, "", options);
  response.cookies.set(SESSION_COOKIE, "", options);
  return response;
}
