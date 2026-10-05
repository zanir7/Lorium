import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, seal, sessionCookieOptions, validSession } from "../../../../lib/session";

export const runtime = "nodejs";
const API = "https://mail.zoho.com/api";

function attachSession(response: NextResponse, result: NonNullable<Awaited<ReturnType<typeof validSession>>>) {
  if (result.refreshed) response.cookies.set(SESSION_COOKIE, seal(result.session), sessionCookieOptions);
  return response;
}

export async function GET(request: NextRequest) {
  const result = await validSession();
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const auth = { Authorization: `Zoho-oauthtoken ${result.session.accessToken}` };

  const folderId = request.nextUrl.searchParams.get("folderId");
  const messageId = request.nextUrl.searchParams.get("messageId");

  if (folderId && messageId) {
    const response = await fetch(
      `${API}/accounts/${result.session.accountId}/folders/${encodeURIComponent(folderId)}/messages/${encodeURIComponent(messageId)}/content`,
      { headers: auth, cache: "no-store" },
    );
    const body = await response.json();
    if (!response.ok) return attachSession(NextResponse.json({ error: "Unable to retrieve message." }, { status: response.status }), result);
    return attachSession(NextResponse.json(body), result);
  }

  const foldersResponse = await fetch(`${API}/accounts/${result.session.accountId}/folders`, {
    headers: auth, cache: "no-store",
  });
  const foldersBody = await foldersResponse.json() as {
    data?: Array<{ folderId: string; folderName?: string; folderType?: string; unreadCount?: number }>;
  };
  if (!foldersResponse.ok) return attachSession(NextResponse.json({ error: "Unable to retrieve folders." }, { status: foldersResponse.status }), result);

  const requested = (request.nextUrl.searchParams.get("folder") || "inbox").toLowerCase();
  const folder = foldersBody.data?.find((item) => {
    const name = (item.folderName || item.folderType || "").toLowerCase();
    return name === requested || (requested === "inbox" && name.includes("inbox"));
  }) || foldersBody.data?.[0];

  if (!folder) return attachSession(NextResponse.json({ folders: [], messages: [] }), result);

  const query = new URLSearchParams({
    folderId: folder.folderId,
    start: "1",
    limit: "50",
    sortBy: "date",
    sortorder: "false",
    includeto: "true",
  });
  const messagesResponse = await fetch(
    `${API}/accounts/${result.session.accountId}/messages/view?${query}`,
    { headers: auth, cache: "no-store" },
  );
  const messagesBody = await messagesResponse.json() as { data?: unknown[] };
  if (!messagesResponse.ok) return attachSession(NextResponse.json({ error: "Unable to retrieve correspondence." }, { status: messagesResponse.status }), result);

  const response = NextResponse.json({
    folder: { id: folder.folderId, name: folder.folderName || folder.folderType || "Inbox" },
    folders: foldersBody.data || [],
    messages: messagesBody.data || [],
  });
  return attachSession(response, result);
}
