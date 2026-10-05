import crypto from "node:crypto";
import { cookies } from "next/headers";
import { SUPABASE_KEY, SUPABASE_URL, type IdentitySession } from "./identity";

export type MailSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
  accountId: string;
};

export const SESSION_COOKIE = "lorium_mail";
export const STATE_COOKIE = "lorium_oauth_state";

const secret = () => {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return crypto.createHash("sha256").update(value).digest();
};

export function seal(data: MailSession) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secret(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, body].map((part) => part.toString("base64url")).join(".");
}

export function unseal(value: string): MailSession | null {
  try {
    const [ivRaw, tagRaw, bodyRaw] = value.split(".");
    if (!ivRaw || !tagRaw || !bodyRaw) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", secret(), Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    const clear = Buffer.concat([
      decipher.update(Buffer.from(bodyRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(clear) as MailSession;
  } catch {
    return null;
  }
}

export async function readSession() {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  return raw ? unseal(raw) : null;
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

async function refreshSession(current: MailSession): Promise<{ session: MailSession; refreshed: boolean } | null> {
  if (Date.now() < current.expiresAt - 60_000) return { session: current, refreshed: false };
  if (!current.refreshToken) return null;

  const base = process.env.ZOHO_ACCOUNTS_BASE || "https://accounts.zoho.com";
  const params = new URLSearchParams({
    refresh_token: current.refreshToken,
    grant_type: "refresh_token",
    client_id: process.env.ZOHO_CLIENT_ID || "",
    client_secret: process.env.ZOHO_CLIENT_SECRET || "",
  });
  const response = await fetch(`${base}/oauth/v2/token?${params}`, { method: "POST", cache: "no-store" });
  if (!response.ok) return null;
  const token = await response.json() as { access_token?: string; expires_in?: number };
  if (!token.access_token) return null;
  return {
    refreshed: true,
    session: {
      ...current,
      accessToken: token.access_token,
      expiresAt: Date.now() + (token.expires_in || 3600) * 1000,
    },
  };
}

export async function validSession() {
  const current = await readSession();
  return current ? refreshSession(current) : null;
}

function connectionHeaders(identity: IdentitySession) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${identity.accessToken}`,
    "Content-Type": "application/json",
  };
}

export async function persistMailSession(identity: IdentitySession, mail: MailSession) {
  if (identity.email.toLowerCase() !== mail.email.toLowerCase()) return false;
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/lorium_mail_connections?on_conflict=user_id`,
    {
      method: "POST",
      headers: {
        ...connectionHeaders(identity),
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        user_id: identity.userId,
        email: mail.email.toLowerCase(),
        sealed_session: seal(mail),
        updated_at: new Date().toISOString(),
      }),
      cache: "no-store",
    },
  );
  return response.ok;
}

export async function loadPersistedMailSession(identity: IdentitySession) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/lorium_mail_connections?user_id=eq.${encodeURIComponent(identity.userId)}&select=sealed_session&limit=1`,
    { headers: connectionHeaders(identity), cache: "no-store" },
  );
  if (!response.ok) return null;
  const rows = await response.json() as Array<{ sealed_session?: string }>;
  const stored = rows[0]?.sealed_session ? unseal(rows[0].sealed_session) : null;
  if (!stored || stored.email.toLowerCase() !== identity.email.toLowerCase()) return null;

  const current = await refreshSession(stored);
  if (!current) return null;
  if (current.refreshed) await persistMailSession(identity, current.session);
  return current.session;
}
