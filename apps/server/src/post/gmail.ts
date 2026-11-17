import { htmlZuMarkdown } from '../uni/text.js';
import type { GoogleZugang } from './google-oauth.js';

/** Eine Mail, so wie das Dorf sie braucht (Text gekürzt). Alles darin ist Fremdinhalt. */
export interface Mail {
  id: string;
  threadId: string;
  von: string;
  an: string;
  betreff: string;
  datum: number; // ms
  labels: string[];
  schnipsel: string;
  text: string;
  messageId: string; // Header Message-ID (für Antworten)
  referenzen: string;
}

export interface GmailKlient {
  profil(): Promise<{ emailAddress: string; historyId: string }>;
  /** IDs von Nachrichten zu einer Gmail-Suche (z. B. newer_than:7d), neueste zuerst */
  liste(suche: string, max: number): Promise<string[]>;
  /** Neue Nachrichten seit startHistoryId; null = Verlauf zu alt (dann neu mit liste() anfangen) */
  seit(startHistoryId: string): Promise<{ ids: string[]; historyId: string } | null>;
  nachricht(id: string): Promise<Mail>;
  /** Legt einen ENTWURF an – gesendet wird nie */
  entwurf(e: { an: string; betreff: string; text: string; threadId?: string; antwortAuf?: { messageId: string; referenzen: string } }): Promise<{ id: string }>;
}

export class GmailFehler extends Error {
  constructor(
    public status: number,
    meldung: string,
  ) {
    super(meldung);
  }
}

const MAX_TEXT = 20_000;

function base64urlText(d: string) {
  return Buffer.from(d.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

interface Teil {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: Teil[];
}

function textFinden(t: Teil, typ: string): string | null {
  if (t.mimeType === typ && t.body?.data) return base64urlText(t.body.data);
  for (const p of t.parts ?? []) {
    // Anhänge (mit Dateiname) überspringen
    if (p.headers?.some((h) => h.name.toLowerCase() === 'content-disposition' && /attachment/i.test(h.value))) continue;
    const r = textFinden(p, typ);
    if (r) return r;
  }
  return null;
}

/** RFC 2047 für Betreffzeilen mit Umlauten */
function kopfKodieren(w: string) {
  return /^[\x20-\x7e]*$/.test(w) ? w : `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`;
}

/** Baut die Rohnachricht (RFC 5322) für einen Entwurf */
export function rohNachricht(e: { an: string; betreff: string; text: string; antwortAuf?: { messageId: string; referenzen: string } }) {
  if (/[\r\n]/.test(e.an) || /[\r\n]/.test(e.betreff)) throw new Error('Empfänger und Betreff dürfen keine Zeilenumbrüche enthalten.');
  const koepfe = [
    `To: ${e.an}`,
    `Subject: ${kopfKodieren(e.betreff)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  if (e.antwortAuf?.messageId) {
    koepfe.push(`In-Reply-To: ${e.antwortAuf.messageId}`);
    koepfe.push(`References: ${`${e.antwortAuf.referenzen} ${e.antwortAuf.messageId}`.trim()}`);
  }
  const rumpf = Buffer.from(e.text, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return Buffer.from(`${koepfe.join('\r\n')}\r\n\r\n${rumpf}\r\n`, 'utf8').toString('base64url');
}

export function gmailKlient(zugang: GoogleZugang, basis = 'https://gmail.googleapis.com'): GmailKlient {
  const wurzel = `${basis.replace(/\/$/, '')}/gmail/v1/users/me`;
  async function anfrage<T>(pfad: string, init: RequestInit = {}, nochmal = true): Promise<T> {
    const r = await fetch(`${wurzel}${pfad}`, {
      ...init,
      headers: { authorization: `Bearer ${await zugang.accessToken()}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      signal: AbortSignal.timeout(60_000),
    });
    if (r.status === 401 && nochmal) {
      zugang.vergessen();
      return anfrage(pfad, init, false);
    }
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new GmailFehler(r.status, `Gmail: HTTP ${r.status}${j.error?.message ? ` – ${j.error.message}` : ''}`);
    }
    return (await r.json()) as T;
  }
  return {
    profil: () => anfrage('/profile'),
    async liste(suche, max) {
      const ids: string[] = [];
      let seite: string | undefined;
      while (ids.length < max) {
        const p = new URLSearchParams({ q: suche, maxResults: String(Math.min(100, max - ids.length)) });
        if (seite) p.set('pageToken', seite);
        const r = await anfrage<{ messages?: { id: string }[]; nextPageToken?: string }>(`/messages?${p}`);
        ids.push(...(r.messages ?? []).map((m) => m.id));
        seite = r.nextPageToken;
        if (!seite) break;
      }
      return ids;
    },
    async seit(start) {
      const ids: string[] = [];
      let seite: string | undefined;
      let historyId = start;
      try {
        for (let i = 0; i < 20; i++) {
          const p = new URLSearchParams({ startHistoryId: start, historyTypes: 'messageAdded', labelId: 'INBOX' });
          if (seite) p.set('pageToken', seite);
          const r = await anfrage<{ history?: { messagesAdded?: { message: { id: string } }[] }[]; historyId: string; nextPageToken?: string }>(`/history?${p}`);
          for (const h of r.history ?? []) for (const a of h.messagesAdded ?? []) ids.push(a.message.id);
          historyId = r.historyId;
          seite = r.nextPageToken;
          if (!seite) break;
        }
      } catch (e) {
        if (e instanceof GmailFehler && e.status === 404) return null; // startHistoryId zu alt
        throw e;
      }
      return { ids: [...new Set(ids)], historyId };
    },
    async nachricht(id) {
      const m = await anfrage<{ id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload: Teil }>(
        `/messages/${encodeURIComponent(id)}?format=full`,
      );
      const kopf = (n: string) => m.payload.headers?.find((h) => h.name.toLowerCase() === n)?.value ?? '';
      const plain = textFinden(m.payload, 'text/plain');
      const html = plain ? null : textFinden(m.payload, 'text/html');
      let text = plain ?? (html ? htmlZuMarkdown(html) : m.snippet ?? '');
      if (text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT)}\n[… gekürzt]`;
      return {
        id: m.id,
        threadId: m.threadId,
        von: kopf('from'),
        an: kopf('to'),
        betreff: kopf('subject') || '(ohne Betreff)',
        datum: Number(m.internalDate ?? 0),
        labels: m.labelIds ?? [],
        schnipsel: m.snippet ?? '',
        text,
        messageId: kopf('message-id'),
        referenzen: kopf('references'),
      };
    },
    async entwurf(e) {
      const r = await anfrage<{ id: string }>('/drafts', { method: 'POST', body: JSON.stringify({ message: { raw: rohNachricht(e), ...(e.threadId ? { threadId: e.threadId } : {}) } }) });
      return { id: r.id };
    },
  };
}
