import crypto from "node:crypto";
import { cookies } from "next/headers";

export type IdentitySession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
  userId: string;
};

export const IDENTITY_COOKIE = "lorium_identity";
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://vwjejmppzjmcritukshl.supabase.co";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_iwGqNhoCzghta6qw1_RK3Q_pgTGU3xH";

const key = () => {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return crypto.createHash("sha256").update("identity:" + value).digest();
};

export function sealIdentity(data: IdentitySession) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, body].map((part) => part.toString("base64url")).join(".");
}

export function unsealIdentity(value: string): IdentitySession | null {
  try {
    const [ivRaw, tagRaw, bodyRaw] = value.split(".");
    if (!ivRaw || !tagRaw || !bodyRaw) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(bodyRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8")) as IdentitySession;
  } catch {
    return null;
  }
}

export const identityCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

export async function readIdentity() {
  const raw = (await cookies()).get(IDENTITY_COOKIE)?.value;
  return raw ? unsealIdentity(raw) : null;
}

export async function validIdentity(): Promise<{ session: IdentitySession; refreshed: boolean } | null> {
  const current = await readIdentity();
  if (!current) return null;
  if (Date.now() < current.expiresAt - 60_000) return { session: current, refreshed: false };

  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: current.refreshToken }),
    cache: "no-store",
  });
  if (!response.ok) return null;
  const data = await response.json() as {
    access_token?: string; refresh_token?: string; expires_in?: number;
    user?: { id?: string; email?: string };
  };
  if (!data.access_token || !data.refresh_token) return null;
  return {
    refreshed: true,
    session: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
      email: data.user?.email || current.email,
      userId: data.user?.id || current.userId,
    },
  };
}
