import http from 'node:http';
import type { AddressInfo } from 'node:net';

interface AttrappenMail {
  id: string;
  threadId: string;
  labels: string[];
  von: string;
  betreff: string;
  text?: string;
  html?: string;
  anhang?: boolean;
  datum: number;
}

const b64 = (t: string) => Buffer.from(t, 'utf8').toString('base64url');

/** Nachgebautes Google: Token-Endpunkt (OAuth) und Gmail-API (profile, messages, history, drafts). */
export async function googleAttrappe() {
  const s = {
    mails: new Map<string, AttrappenMail>(),
    historyId: 100,
    verlauf: [] as { historyId: number; id: string }[],
    aeltesterVerlauf: 0,
    zugaenge: new Set<string>(),
    refreshTokens: new Set<string>(['refresh-gut']),
    entwuerfe: [] as { raw: string; threadId?: string }[],
    tokenAnfragen: [] as Record<string, string>[],
    gmailAnfragen: [] as string[],
    bereiche: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose',
  };
  let n = 0;
  const mailNeu = (m: Omit<AttrappenMail, 'id' | 'threadId'> & { id?: string }) => {
    const id = m.id ?? `m${++n}`;
    s.mails.set(id, { threadId: `t${id}`, ...m, id });
    s.historyId++;
    s.verlauf.push({ historyId: s.historyId, id });
    return id;
  };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const u = new URL(req.url!, 'http://x');
      const json = (status: number, j: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(j));
      if (u.pathname === '/token') {
        const p = Object.fromEntries(new URLSearchParams(body));
        s.tokenAnfragen.push(p);
        if (p.grant_type === 'authorization_code') {
          if (p.code !== 'gutercode' || !p.code_verifier || p.redirect_uri !== 'http://127.0.0.1:8765/') return json(400, { error: 'invalid_grant' });
          const z = `zugang-${++n}`;
          s.zugaenge.add(z);
          return json(200, { access_token: z, expires_in: 3599, refresh_token: 'refresh-gut', scope: s.bereiche });
        }
        if (p.grant_type === 'refresh_token') {
          if (!s.refreshTokens.has(p.refresh_token!)) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
          const z = `zugang-${++n}`;
          s.zugaenge.add(z);
          return json(200, { access_token: z, expires_in: 3599 });
        }
        return json(400, { error: 'unsupported_grant_type' });
      }
      if (!u.pathname.startsWith('/gmail/v1/users/me')) return json(404, {});
      if (!s.zugaenge.has((req.headers.authorization ?? '').replace('Bearer ', ''))) return json(401, { error: { message: 'Invalid Credentials' } });
      const pfad = u.pathname.slice('/gmail/v1/users/me'.length);
      s.gmailAnfragen.push(`${req.method} ${pfad}${u.search}`);
      if (pfad === '/profile') return json(200, { emailAddress: 'leif@example.com', historyId: String(s.historyId) });
      if (pfad === '/messages') {
        const alle = [...s.mails.values()].filter((m) => m.labels.includes('INBOX')).sort((a, b) => b.datum - a.datum);
        return json(200, { messages: alle.map((m) => ({ id: m.id, threadId: m.threadId })) });
      }
      if (pfad === '/history') {
        const start = Number(u.searchParams.get('startHistoryId'));
        if (start < s.aeltesterVerlauf) return json(404, { error: { message: 'Requested entity was not found.' } });
        const neu = s.verlauf.filter((v) => v.historyId > start);
        return json(200, { history: neu.map((v) => ({ id: String(v.historyId), messagesAdded: [{ message: { id: v.id } }] })), historyId: String(s.historyId) });
      }
      const m = /^\/messages\/([^/]+)$/.exec(pfad);
      if (m) {
        const x = s.mails.get(decodeURIComponent(m[1]!));
        if (!x) return json(404, {});
        const headers = [
          { name: 'From', value: x.von },
          { name: 'To', value: 'leif@example.com' },
          { name: 'Subject', value: x.betreff },
          { name: 'Message-ID', value: `<${x.id}@mail.example>` },
        ];
        const teile = [
          ...(x.text ? [{ mimeType: 'text/plain', body: { data: b64(x.text) } }] : []),
          ...(x.html ? [{ mimeType: 'text/html', body: { data: b64(x.html) } }] : []),
          ...(x.anhang ? [{ mimeType: 'text/plain', headers: [{ name: 'Content-Disposition', value: 'attachment; filename="geheim.txt"' }], body: { data: b64('ANHANG-INHALT') } }] : []),
        ];
        return json(200, {
          id: x.id,
          threadId: x.threadId,
          labelIds: x.labels,
          snippet: (x.text ?? '').slice(0, 50),
          internalDate: String(x.datum),
          payload: { mimeType: 'multipart/mixed', headers, parts: [{ mimeType: 'multipart/alternative', parts: teile.filter((t) => !('headers' in t)) }, ...teile.filter((t) => 'headers' in t)] },
        });
      }
      if (pfad === '/drafts' && req.method === 'POST') {
        const j = JSON.parse(body) as { message: { raw: string; threadId?: string } };
        s.entwuerfe.push({ raw: Buffer.from(j.message.raw, 'base64url').toString('utf8'), threadId: j.message.threadId });
        return json(200, { id: `d${s.entwuerfe.length}` });
      }
      return json(404, {});
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const basis = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { s, basis, tokenUrl: `${basis}/token`, mailNeu, schliessen: () => new Promise<void>((r) => server.close(() => r())) };
}
