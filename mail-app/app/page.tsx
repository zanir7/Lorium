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
  const node = document.createElement("div");
  node.innerHTML = input;
  return node.textContent || node.innerText || "";
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
  const [identityEmail, setIdentityEmail] = useState("");
  const [mailConnected, setMailConnected] = useState(false);
  const [email, setEmail] = useState("");
  const [login, setLogin] = useState({ email: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryToken, setRecoveryToken] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [recoveryStatus, setRecoveryStatus] = useState("");
  const [mail, setMail] = useState<MailData>({});
  const [activeFolder, setActiveFolder] = useState("inbox");
  const [selected, setSelected] = useState<Message | null>(null);
  const [messageBody, setMessageBody] = useState("");
  const [compose, setCompose] = useState(false);
  const [draft, setDraft] = useState({ to: "", subject: "", content: "" });
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");

  const messages = useMemo(() => mail.messages || [], [mail]);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (fragment.get("type") === "recovery" && fragment.get("access_token")) {
      setRecoveryToken(fragment.get("access_token") || "");
      setRecoveryMode(true);
      window.history.replaceState({}, "", window.location.pathname);
      setLoading(false);
      return;
    }

    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = await response.json();
        setIdentityEmail(data.email || "");
        setMailConnected(Boolean(data.mailConnected));
        if (data.mailConnected) {
          setEmail(data.mailEmail || data.email || "");
          return loadFolder("inbox");
        }
      })
      .catch(() => {
        setIdentityEmail("");
        setMailConnected(false);
        setEmail("");
      })
      .finally(() => setLoading(false));
  }, []);

  async function signInLorium(event: React.FormEvent) {
    event.preventDefault();
    if (!login.email || !login.password) return;
    setLoggingIn(true);
    setLoginError("");
    try {
      const response = await fetch("/api/auth/lorium", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(login),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to verify Lorium identity.");
      setIdentityEmail(data.email || login.email);
      setLogin({ email: "", password: "" });

      const statusResponse = await fetch("/api/auth/me", { cache: "no-store" });
      const status = await statusResponse.json();
      const connected = statusResponse.ok && Boolean(status.mailConnected);
      setMailConnected(connected);
      if (connected) {
        setEmail(status.mailEmail || status.email || data.email || login.email);
        await loadFolder("inbox");
      }
    } catch (error) {
      setLoginError(error instanceof Error ? error.message.toUpperCase() : "ACCESS DENIED");
    } finally {
      setLoggingIn(false);
    }
  }

  async function requestRecovery() {
    if (!login.email) {
      setLoginError("ENTER YOUR LORIUM EMAIL FIRST");
      return;
    }
    setLoginError("");
    setRecoveryStatus("SENDING RECOVERY LINK");
    try {
      await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: login.email }),
      });
      setRecoveryStatus("CHECK YOUR EMAIL · RECOVERY LINK SENT");
    } catch {
      setRecoveryStatus("UNABLE TO SEND RECOVERY LINK");
    }
  }

  async function completeRecovery(event: React.FormEvent) {
    event.preventDefault();
    setRecoveryStatus("");
    const response = await fetch("/api/auth/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: recoveryToken, password: resetPassword }),
    });
    const data = await response.json();
    if (!response.ok) {
      setRecoveryStatus((data.error || "UNABLE TO RESET PASSWORD").toUpperCase());
      return;
    }
    setRecoveryMode(false);
    setRecoveryToken("");
    setResetPassword("");
    setRecoveryStatus("PASSWORD UPDATED · ENTER LORIUM");
  }

  async function loadFolder(name: string) {
    setActiveFolder(name);
    setSelected(null);
    setMessageBody("");
    const response = await fetch(`/api/mail/messages?folder=${encodeURIComponent(name)}`, { cache: "no-store" });
    if (response.status === 401) {
      setMailConnected(false);
      return;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to retrieve correspondence.");
    setMail(data);
  }

  async function openMessage(message: Message) {
    setSelected(message);
    setMessageBody("Retrieving correspondence…");
    const folderId = message.folderId || mail.folder?.id;
    if (!folderId) return setMessageBody(message.summary || "");
    const response = await fetch(
      `/api/mail/messages?folderId=${encodeURIComponent(folderId)}&messageId=${encodeURIComponent(message.messageId)}`,
      { cache: "no-store" },
    );
    const data = await response.json();
    const content = data?.data?.content || data?.data?.messageContent || message.summary || "";
    setMessageBody(htmlToText(String(content)));
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
    setIdentityEmail("");
    setMailConnected(false);
    setEmail("");
    setMail({});
    setSelected(null);
  }

  if (loading) {
    return <main className="gate"><div className="gate-inner"><div className="wordmark">LORIUM</div><div className="lightline"/><p>OPENING ARCHIVE</p></div></main>;
  }

  if (recoveryMode) {
    return (
      <main className="gate">
        <div className="ambient" />
        <form className="gate-inner identity-form" onSubmit={completeRecovery}>
          <div className="wordmark">LORIUM</div>
          <span className="index">IDENTITY / RECOVERY</span>
          <div className="lightline" />
          <p className="quiet">CHOOSE A NEW LORIUM PASSWORD.</p>
          <label className="identity-field">
            <span>NEW PASSWORD</span>
            <input type="password" minLength={8} autoComplete="new-password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} />
          </label>
          <button className="enter identity-enter" type="submit" disabled={resetPassword.length < 8}>
            <span>UPDATE PASSWORD</span><i />
          </button>
          {recoveryStatus && <p className="identity-error">{recoveryStatus}</p>}
          <small>PRIVATE / LORIUM IDENTITY</small>
        </form>
      </main>
    );
  }

  if (!identityEmail) {
    return (
      <main className="gate">
        <div className="ambient" />
        <form className="gate-inner identity-form" onSubmit={signInLorium}>
          <div className="wordmark">LORIUM</div>
          <span className="index">IDENTITY / PRIVATE SYSTEM</span>
          <div className="lightline" />
          <p className="quiet">ONE IDENTITY. EVERY LORIUM SYSTEM.</p>
          <label className="identity-field">
            <span>EMAIL</span>
            <input type="email" autoComplete="email" value={login.email} onChange={(e) => setLogin({...login,email:e.target.value})} />
          </label>
          <label className="identity-field">
            <span>PASSWORD</span>
            <input type="password" autoComplete="current-password" value={login.password} onChange={(e) => setLogin({...login,password:e.target.value})} />
          </label>
          <button className="enter identity-enter" type="submit" disabled={loggingIn}>
            <span>{loggingIn ? "VERIFYING IDENTITY" : "ENTER LORIUM"}</span><i />
          </button>
          {loginError && <p className="identity-error">{loginError}</p>}
          {recoveryStatus && <p className="identity-error">{recoveryStatus}</p>}
          <button className="identity-sever" type="button" onClick={requestRecovery}>FORGOT PASSWORD</button>
          <small>YOUR LORIUM EMAIL IS YOUR IDENTITY</small>
        </form>
      </main>
    );
  }

  if (!mailConnected) {
    const error = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("error") : null;
    return (
      <main className="gate">
        <div className="ambient" />
        <div className="gate-inner">
          <div className="wordmark">LORIUM</div>
          <span className="index">IDENTITY VERIFIED / {identityEmail}</span>
          <div className="lightline" />
          <p className="quiet">{error === "domain" ? "ACTIVATE THE MATCHING LORIUM MAILBOX." : "ACTIVATE YOUR MAILBOX ONCE."}</p>
          <a className="enter" href="/api/auth/zoho"><span>ACTIVATE LORIUM MAIL</span><i /></a>
          <button className="identity-sever" onClick={logout}>USE ANOTHER LORIUM IDENTITY</button>
          <small>ONE-TIME MAILBOX ACTIVATION · THEN YOUR LORIUM LOGIN IS ENOUGH</small>
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
        <button className="new" onClick={() => { setDraft({to:"",subject:"",content:""}); setCompose(true); }}>NEW CORRESPONDENCE <span>+</span></button>
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
          <button className="back" onClick={() => setSelected(null)}>← INBOX</button>
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
