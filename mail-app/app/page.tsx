"use client";

import { useEffect, useMemo, useState } from "react";

type Message = {
  messageId: string;
  folderId?: string;
  subject?: string;
  summary?: string;
  sender?: string;
  fromAddress?: string;
  from?: string;
  sentDateInGMT?: string;
  receivedTime?: string;
  status?: string;
};

type MailData = {
  folder?: { id: string; name: string };
  folders?: Array<{ folderId: string; folderName?: string; folderType?: string; unreadCount?: number }>;
  messages?: Message[];
};

function htmlToText(input: string) {
  if (typeof window === "undefined") return input;
  // DOMParser builds an inert document: unlike innerHTML on a live element,
  // it never loads images or fires handlers like <img onerror> from an email.
  const doc = new DOMParser().parseFromString(input, "text/html");
  return doc.body.textContent || "";
}

function authErrorMessage(code: string | null) {
  if (code === "mail_account") return "MAILBOX NOT READY IN ZOHO · OPEN ZOHO MAIL ONCE, THEN RETRY";
  if (code === "token") return "ZOHO AUTHORIZATION EXPIRED · SIGN IN AGAIN";
  if (code === "authorization") return "SIGN-IN EXPIRED OR STARTED IN ANOTHER WINDOW · START AGAIN HERE";
  if (code === "denied") return "ACCESS WAS NOT GRANTED IN ZOHO · ACCEPT THE PERMISSIONS TO CONTINUE";
  if (code === "configuration") return "MAIL AUTHORIZATION IS MISCONFIGURED";
  if (code === "unexpected") return "MAIL AUTHORIZATION HIT AN UNEXPECTED ERROR";
  return code ? "MAIL SIGN-IN FAILED · TRY AGAIN" : "";
}

function senderOf(message: Message) {
  return message.sender || message.fromAddress || message.from || "Unknown";
}

function dateOf(message: Message) {
  const raw = message.sentDateInGMT || message.receivedTime;
  if (!raw) return "";
  const value = /^\d+$/.test(raw) ? Number(raw) : raw;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function Mail() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [mail, setMail] = useState<MailData>({});
  const [activeFolder, setActiveFolder] = useState("inbox");
  const [selected, setSelected] = useState<Message | null>(null);
  const [messageBody, setMessageBody] = useState("");
  const [compose, setCompose] = useState(false);
  const [draft, setDraft] = useState({ to: "", subject: "", content: "" });
  const [draftReady, setDraftReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");

  const messages = useMemo(() => mail.messages || [], [mail]);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = await response.json();
        setEmail(data.mailEmail || data.email || "");
        return loadFolder("inbox");
      })
      .catch(() => {
        setEmail("");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("lorium-mail-draft");
      if (saved) setDraft(JSON.parse(saved));
    } catch {
      // A damaged local draft should never stop the inbox from opening.
    } finally {
      setDraftReady(true);
    }
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    const hasDraft = Boolean(draft.to || draft.subject || draft.content);
    if (hasDraft) window.localStorage.setItem("lorium-mail-draft", JSON.stringify(draft));
    else window.localStorage.removeItem("lorium-mail-draft");
  }, [draft, draftReady]);

  async function loadFolder(name: string) {
    setActiveFolder(name);
    setSelected(null);
    setMessageBody("");
    try {
      const response = await fetch(`/api/mail/messages?folder=${encodeURIComponent(name)}`, { cache: "no-store" });
      if (response.status === 401) {
        setEmail("");
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to retrieve correspondence.");
      setMail(data);
    } catch (error) {
      setNotice(error instanceof Error ? error.message.toUpperCase() : "MAIL TEMPORARILY UNAVAILABLE");
      window.setTimeout(() => setNotice(""), 3500);
    }
  }

  async function openMessage(message: Message) {
    setSelected(message);
    setMessageBody("Retrieving correspondence…");
    const folderId = message.folderId || mail.folder?.id;
    if (!folderId) return setMessageBody(message.summary || "");
    try {
      const response = await fetch(
        `/api/mail/messages?folderId=${encodeURIComponent(folderId)}&messageId=${encodeURIComponent(message.messageId)}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to retrieve message.");
      const content = data?.data?.content || data?.data?.messageContent || message.summary || "";
      setMessageBody(htmlToText(String(content)));
    } catch (error) {
      setMessageBody(message.summary || "MESSAGE TEMPORARILY UNAVAILABLE");
      setNotice(error instanceof Error ? error.message.toUpperCase() : "MESSAGE TEMPORARILY UNAVAILABLE");
      window.setTimeout(() => setNotice(""), 3500);
    }
  }

  function beginReply() {
    if (!selected) return;
    setDraft({
      to: senderOf(selected).match(/<([^>]+)>/)?.[1] || senderOf(selected),
      subject: selected.subject?.toLowerCase().startsWith("re:") ? selected.subject : `Re: ${selected.subject || ""}`,
      content: "",
    });
    setCompose(true);
  }

  async function send() {
    if (!draft.to || !draft.content.trim()) return;
    setSending(true);
    setNotice("");
    try {
      const response = await fetch("/api/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await response.json();
      if (response.status === 401) {
        setEmail("");
        throw new Error("Session expired. Sign in again; your draft is saved.");
      }
      if (!response.ok) throw new Error(data.error || "Transmission failed.");
      setCompose(false);
      setDraft({ to: "", subject: "", content: "" });
      setNotice("SENT");
      window.setTimeout(() => setNotice(""), 1800);
    } catch (error) {
      setNotice(error instanceof Error ? error.message.toUpperCase() : "TRANSMISSION FAILED");
    } finally {
      setSending(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setEmail("");
    setMail({});
    setSelected(null);
  }

  if (loading) {
    return <main className="gate"><div className="gate-inner"><div className="wordmark">LORIUM</div><div className="lightline"/><p>OPENING ARCHIVE</p></div></main>;
  }

  if (!email) {
    const error = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("error") : null;
    return (
      <main className="gate">
        <div className="ambient" />
        <div className="gate-inner">
          <div className="wordmark">LORIUM</div>
          <span className="index">MAIL / PRIVATE SYSTEM</span>
          <div className="lightline" />
          <p className="quiet">YOUR LORIUM EMAIL. NOTHING ELSE.</p>
          <a className="enter" href="/api/auth/zoho"><span>ENTER LORIUM MAIL</span><i /></a>
          {error && <p className="identity-error">{authErrorMessage(error)}</p>}
          <small>AUTHORIZED LORIUMARCHIVE.COM MAILBOXES ONLY</small>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div><span className="brand">LORIUM</span><span className="system">MAIL / 001</span></div>
        <div className="account"><span className="live-dot"/><span>{email}</span><button onClick={logout}>LOG OUT</button></div>
      </header>

      <aside className="rail">
        <button className="new" onClick={() => setCompose(true)}>NEW CORRESPONDENCE <span>+</span></button>
        <nav>
          {["inbox", "sent", "drafts", "archive"].map((name) => (
            <button key={name} className={activeFolder === name ? "active" : ""} onClick={() => loadFolder(name)}>
              <span>{name}</span>
              {name === "inbox" && <b>{mail.folders?.find(f => (f.folderName || f.folderType || "").toLowerCase().includes("inbox"))?.unreadCount || ""}</b>}
            </button>
          ))}
        </nav>
        <div className="rail-foot"><span>PRIVATE SYSTEM</span><span>EST. MMXXV</span></div>
      </aside>

      <section className={`list ${selected ? "mobile-hidden" : ""}`}>
        <div className="list-head"><span>{activeFolder.toUpperCase()}</span><span>{String(messages.length).padStart(2, "0")}</span></div>
        <div className="rows">
          {messages.length ? messages.map((message) => (
            <button key={message.messageId} className={`mail-row ${selected?.messageId === message.messageId ? "selected" : ""}`} onClick={() => openMessage(message)}>
              <i className={String(message.status || "").toLowerCase().includes("unread") ? "unread" : ""}/>
              <div className="row-main">
                <div><strong>{senderOf(message)}</strong><time>{dateOf(message)}</time></div>
                <h2>{message.subject || "Untitled correspondence"}</h2>
                <p>{message.summary || "No preview available."}</p>
              </div>
            </button>
          )) : <div className="empty"><span>THE ARCHIVE IS QUIET.</span></div>}
        </div>
      </section>

      <article className={`reader ${selected ? "mobile-open" : ""}`}>
        {selected ? <>
          <button className="back" onClick={() => setSelected(null)}>← {activeFolder.toUpperCase()}</button>
          <div className="reader-head">
            <span className="message-index">CORRESPONDENCE / {selected.messageId.slice(-4)}</span>
            <h1>{selected.subject || "Untitled correspondence"}</h1>
            <div className="meta"><span>FROM</span><strong>{senderOf(selected)}</strong><time>{dateOf(selected)}</time></div>
          </div>
          <div className="body-copy">{messageBody || selected.summary || ""}</div>
          <div className="reader-actions"><button onClick={beginReply}>REPLY <span>↗</span></button></div>
        </> : <div className="reader-empty"><div className="halo"/><span>SELECT CORRESPONDENCE</span><small>PRIVATE / LORIUM ARCHIVE</small></div>}
      </article>

      {compose && <div className="compose-wrap" role="dialog" aria-modal="true" aria-label="New correspondence">
        <section className="compose">
          <header><span>NEW CORRESPONDENCE</span><button onClick={() => setCompose(false)}>CLOSE</button></header>
          <label><span>TO</span><input autoFocus type="email" value={draft.to} onChange={e => setDraft({...draft,to:e.target.value})} placeholder="recipient@domain.com"/></label>
          <label><span>SUBJECT</span><input value={draft.subject} onChange={e => setDraft({...draft,subject:e.target.value})} placeholder="Untitled"/></label>
          <textarea value={draft.content} onChange={e => setDraft({...draft,content:e.target.value})} placeholder="Write quietly."/>
          <footer><span>{draft.content.length.toLocaleString()} / 100,000</span><button onClick={send} disabled={sending || !draft.to || !draft.content.trim()}>{sending ? "SENDING" : "SEND"} <i/></button></footer>
        </section>
      </div>}

      {notice && <div className="toast">{notice}</div>}
    </main>
  );
}
