import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, seal, sessionCookieOptions, validSession } from "../../../../lib/session";

export const runtime = "nodejs";
const API = "https://mail.zoho.com/api";
const TRANSIENT = new Set([429, 500, 502, 503, 504]);

function attachSession(response: NextResponse, result: NonNullable<Awaited<ReturnType<typeof validSession>>>) {
  if (result.refreshed) response.cookies.set(SESSION_COOKIE, seal(result.session), sessionCookieOptions);
  return response;
}

async function zohoGet(url: string, headers: Record<string, string>) {
  let last: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      last = await fetch(url, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });
      if (!TRANSIENT.has(last.status) || attempt === 2) return last;
    } catch {
      if (attempt === 2) return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  return last;
}

async function jsonBody(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const result = await validSession();
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const auth = { Authorization: `Zoho-oauthtoken ${result.session.accessToken}` };

  const folderId = request.nextUrl.searchParams.get("folderId");
  const messageId = request.nextUrl.searchParams.get("messageId");

  if (folderId && messageId) {
    const upstream = await zohoGet(
      `${API}/accounts/${result.session.accountId}/folders/${encodeURIComponent(folderId)}/messages/${encodeURIComponent(messageId)}/content`,
      auth,
    );
    if (!upstream) return attachSession(NextResponse.json({ error: "Mail service temporarily unavailable." }, { status: 503 }), result);
    const body = await jsonBody(upstream);
    if (!upstream.ok) return attachSession(NextResponse.json({ error: "Unable to retrieve message." }, { status: upstream.status }), result);
    return attachSession(NextResponse.json(body || {}), result);
  }

  const foldersResponse = await zohoGet(`${API}/accounts/${result.session.accountId}/folders`, auth);
  if (!foldersResponse) return attachSession(NextResponse.json({ error: "Mail service temporarily unavailable." }, { status: 503 }), result);
  const foldersBody = await jsonBody(foldersResponse) as {
    data?: Array<{ folderId: string; folderName?: string; folderType?: string; unreadCount?: number }>;
  } | null;
  if (!foldersResponse.ok) return attachSession(NextResponse.json({ error: "Unable to retrieve folders." }, { status: foldersResponse.status }), result);

  const requested = (request.nextUrl.searchParams.get("folder") || "inbox").toLowerCase();
  const folder = foldersBody?.data?.find((item) => {
    const name = (item.folderName || item.folderType || "").toLowerCase();
    return name === requested || (requested === "inbox" && name.includes("inbox"));
  }) || (requested === "inbox" ? foldersBody?.data?.[0] : undefined);

  if (!folder) return attachSession(NextResponse.json({ folders: foldersBody?.data || [], messages: [] }), result);

  const query = new URLSearchParams({
    folderId: folder.folderId,
    start: "1",
    limit: "50",
    sortBy: "date",
    sortorder: "false",
    includeto: "true",
  });
  const messagesResponse = await zohoGet(
    `${API}/accounts/${result.session.accountId}/messages/view?${query}`,
    auth,
  );
  if (!messagesResponse) return attachSession(NextResponse.json({ error: "Mail service temporarily unavailable." }, { status: 503 }), result);
  const messagesBody = await jsonBody(messagesResponse) as { data?: unknown[] } | null;
  if (!messagesResponse.ok) return attachSession(NextResponse.json({ error: "Unable to retrieve correspondence." }, { status: messagesResponse.status }), result);

  return attachSession(NextResponse.json({
    folder: { id: folder.folderId, name: folder.folderName || folder.folderType || "Inbox" },
    folders: foldersBody?.data || [],
    messages: messagesBody?.data || [],
  }), result);
}
