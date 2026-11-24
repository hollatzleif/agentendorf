import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { passwortSetzen } from '../src/auth/passwort.js';
import { hotp, zaehlerFuer } from '../src/auth/totp.js';
import { cookieAus, ORIGIN, testDorf } from './hilfen.js';

const PW = 'ein-sehr-langes-Passwort-42';

async function angemeldetesDorf() {
  const d = await testDorf();
  await passwortSetzen(d.db, d.uhr, PW);
  const r = await d.app.inject({ method: 'POST', url: '/api/anmeldung', headers: { origin: ORIGIN }, payload: { passwort: PW } });
  expect(r.statusCode).toBe(200);
  const cookie = cookieAus(r.headers['set-cookie']);
  const h = { origin: ORIGIN, cookie };
  return { ...d, cookie, h };
}

describe('Anmeldung', () => {
  it('ohne Passwort: klare Meldung statt Login', async () => {
    const d = await testDorf();
    const info = await d.app.inject({ url: '/api/anmeldung/info' });
    expect(info.json()).toEqual({ passwortGesetzt: false, totpAktiv: false });
    const r = await d.app.inject({ method: 'POST', url: '/api/anmeldung', headers: { origin: ORIGIN }, payload: { passwort: 'x' } });
    expect(r.statusCode).toBe(503);
  });

  it('schwache Passwörter werden abgelehnt', async () => {
    const d = await testDorf();
    await expect(passwortSetzen(d.db, d.uhr, 'kurz')).rejects.toThrow(/zu schwach/);
    await expect(passwortSetzen(d.db, d.uhr, 'aaaaaaaaaaaaaaaaaa')).rejects.toThrow(/zu schwach/);
  });

  it('Cookie ist HttpOnly, Secure, SameSite=Strict', async () => {
    const d = await testDorf();
    await passwortSetzen(d.db, d.uhr, PW);
    const r = await d.app.inject({ method: 'POST', url: '/api/anmeldung', headers: { origin: ORIGIN }, payload: { passwort: PW } });
    const c = String(r.headers['set-cookie']);
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/Secure/);
    expect(c).toMatch(/SameSite=Strict/);
  });

  it('ohne Sitzung kein Zugriff, fremde Herkunft wird abgelehnt', async () => {
    const d = await angemeldetesDorf();
    expect((await d.app.inject({ url: '/api/vault/baum' })).statusCode).toBe(401);
    expect((await d.app.inject({ url: '/api/ich', headers: { cookie: d.cookie } })).statusCode).toBe(200);
    // schreibende Anfrage ohne Origin
    const ohne = await d.app.inject({ method: 'PUT', url: '/api/vault/datei', headers: { cookie: d.cookie }, payload: { pfad: 'a.md', inhalt: 'x' } });
    expect(ohne.statusCode).toBe(403);
    const fremd = await d.app.inject({
      method: 'PUT',
      url: '/api/vault/datei',
      headers: { cookie: d.cookie, origin: 'https://boese.example' },
      payload: { pfad: 'a.md', inhalt: 'x' },
    });
    expect(fremd.statusCode).toBe(403);
  });

  it('E203: kodierte Pfade (/%61pi/…) kommen ohne Sitzung nirgends an – weder lesen noch schreiben noch WebSocket', async () => {
    const d = await testDorf();
    await d.vault.schreiben('Rathaus/geheim.md', 'nur für Leif');
    for (const url of ['/%61pi/vault/baum', '/%61pi/vault/datei?pfad=Rathaus%2Fgeheim.md', '/%61%70%69/todos', '/%2561pi/sitzungen', '/api/%76ault/baum', '/%61pi/gesundheit']) {
      const r = await d.app.inject({ method: 'GET', url });
      expect(r.statusCode, url).not.toBe(200);
      expect(r.body).not.toContain('nur für Leif');
    }
    const w = await d.app.inject({
      method: 'PUT',
      url: '/%61pi/vault/datei',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { pfad: 'Rathaus/boese.md', inhalt: 'x' },
    });
    expect([401, 404]).toContain(w.statusCode);
    expect(await d.vault.existiert('Rathaus/boese.md')).toBe(false);
    expect((await d.app.inject({ method: 'GET', url: '/%E0%A4%A' })).statusCode).toBe(400);
    // der normale offene Weg bleibt offen
    expect((await d.app.inject({ method: 'GET', url: '/api/gesundheit' })).statusCode).toBe(200);
    expect((await d.app.inject({ method: 'GET', url: '/api/anmeldung/info' })).statusCode).toBe(200);
  });

  it('Drosselung greift nach 5 Fehlversuchen', async () => {
    const d = await testDorf();
    await passwortSetzen(d.db, d.uhr, PW);
    const versuch = (pw: string) =>
      d.app.inject({ method: 'POST', url: '/api/anmeldung', headers: { origin: ORIGIN }, payload: { passwort: pw } });
    for (let i = 0; i < 5; i++) expect((await versuch('falsch')).statusCode).toBe(401);
    const gesperrt = await versuch(PW); // auch das richtige Passwort wird während der Sperre nicht geprüft
    expect(gesperrt.statusCode).toBe(429);
    expect(gesperrt.headers['retry-after']).toBe('30');
    d.uhr.vor(30_000);
    expect((await versuch(PW)).statusCode).toBe(200);
  });

  it('Sitzungen auflisten und widerrufen', async () => {
    const d = await angemeldetesDorf();
    const zweit = await d.app.inject({ method: 'POST', url: '/api/anmeldung', headers: { origin: ORIGIN, 'user-agent': 'Handy' }, payload: { passwort: PW } });
    const c2 = cookieAus(zweit.headers['set-cookie']);
    const liste = (await d.app.inject({ url: '/api/sitzungen', headers: d.h })).json();
    expect(liste).toHaveLength(2);
    expect(liste.filter((s: { aktuell: boolean }) => s.aktuell)).toHaveLength(1);
    const handy = liste.find((s: { geraet: string }) => s.geraet === 'Handy');
    expect((await d.app.inject({ method: 'DELETE', url: `/api/sitzungen/${handy.id}`, headers: d.h })).statusCode).toBe(200);
    expect((await d.app.inject({ url: '/api/ich', headers: { cookie: c2 } })).statusCode).toBe(401);
    expect((await d.app.inject({ method: 'POST', url: '/api/abmeldung', headers: d.h })).statusCode).toBe(200);
    expect((await d.app.inject({ url: '/api/ich', headers: { cookie: d.cookie } })).statusCode).toBe(401);
  });

  it('Passwort ändern beendet andere Sitzungen', async () => {
    const d = await angemeldetesDorf();
    const zweit = await d.app.inject({ method: 'POST', url: '/api/anmeldung', headers: { origin: ORIGIN }, payload: { passwort: PW } });
    const c2 = cookieAus(zweit.headers['set-cookie']);
    const r = await d.app.inject({ method: 'POST', url: '/api/passwort', headers: d.h, payload: { alt: PW, neu: 'noch-ein-anderes-langes-PW-7' } });
    expect(r.json()).toEqual({ ok: true, andereBeendet: 1 });
    expect((await d.app.inject({ url: '/api/ich', headers: { cookie: c2 } })).statusCode).toBe(401);
    expect((await d.app.inject({ url: '/api/ich', headers: { cookie: d.cookie } })).statusCode).toBe(200);
  });

  it('zweiter Faktor: einrichten, anmelden, abschalten', async () => {
    const d = await angemeldetesDorf();
    const e = await d.app.inject({ method: 'POST', url: '/api/totp/einrichten', headers: d.h, payload: { passwort: PW } });
    const { geheimnis, uri } = e.json();
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    const code = () => hotp(geheimnis, zaehlerFuer(d.uhr.jetzt()));
    expect((await d.app.inject({ method: 'POST', url: '/api/totp/bestaetigen', headers: d.h, payload: { code: '000000' } })).statusCode).toBe(400);
    expect((await d.app.inject({ method: 'POST', url: '/api/totp/bestaetigen', headers: d.h, payload: { code: code() } })).statusCode).toBe(200);
    expect((await d.app.inject({ url: '/api/anmeldung/info' })).json().totpAktiv).toBe(true);

    const login = (payload: object) => d.app.inject({ method: 'POST', url: '/api/anmeldung', headers: { origin: ORIGIN }, payload });
    expect((await login({ passwort: PW })).statusCode).toBe(401);
    d.uhr.vor(30_000);
    const c = code();
    expect((await login({ passwort: PW, code: c })).statusCode).toBe(200);
    expect((await login({ passwort: PW, code: c })).statusCode).toBe(401); // nicht wiederverwendbar

    d.uhr.vor(30_000);
    expect((await d.app.inject({ method: 'POST', url: '/api/totp/abschalten', headers: d.h, payload: { passwort: PW, code: code() } })).statusCode).toBe(200);
    expect((await login({ passwort: PW })).statusCode).toBe(200);
  });
});

describe('E207: Vorschau für alle Formate', () => {
  it('Word & Co. über die Umwandlung im Rechenraum; ohne Sitzung 401; Pfad-Tricks abgelehnt', async () => {
    const d = await angemeldetesDorf();
    await d.vault.schreiben('Rathaus/dateien/bericht.docx', Buffer.from('PK\x03\x04 kein echtes docx'));
    const gesehen: string[] = [];
    d.agenten.rechenraum = {
      umwandeln: async (name: string) => {
        gesehen.push(name);
        return { version: '1', typ: 'Word-Dokument', text: '# Bericht\n\nErster Absatz', bilder: [{ mime: 'image/png', b64: 'iVBORw0KGgo=', titel: 'Seite 1' }, { mime: 'image/svg+xml', b64: 'PHN2Zz4=', titel: 'x' }], hinweise: ['ok'] };
      },
    } as unknown as NonNullable<typeof d.agenten.rechenraum>;
    const r = await d.app.inject({ method: 'GET', url: '/api/vault/vorschau?pfad=Rathaus%2Fdateien%2Fbericht.docx', headers: { cookie: d.cookie } });
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json();
    expect(j).toMatchObject({ name: 'bericht.docx', typ: 'Word-Dokument', art: 'umgewandelt', text: '# Bericht\n\nErster Absatz' });
    expect(j.bilder).toEqual([{ mime: 'image/png', base64: 'iVBORw0KGgo=', titel: 'Seite 1' }]); // kein SVG
    expect(gesehen).toEqual(['bericht.docx']);
    expect((await d.app.inject({ method: 'GET', url: '/api/vault/vorschau?pfad=Rathaus%2Fdateien%2Fbericht.docx' })).statusCode).toBe(401);
    expect((await d.app.inject({ method: 'GET', url: '/%61pi/vault/vorschau?pfad=Rathaus%2Fdateien%2Fbericht.docx' })).statusCode).toBe(401);
    expect((await d.app.inject({ method: 'GET', url: '/api/vault/vorschau?pfad=..%2F..%2Fetc%2Fpasswd', headers: { cookie: d.cookie } })).statusCode).toBe(400);
  });
});

describe('Bibliothek über die API', () => {
  it('Vault aus Vorlage, Gebäude erkannt', async () => {
    const d = await angemeldetesDorf();
    const g = (await d.app.inject({ url: '/api/gebaeude', headers: d.h })).json();
    expect(g.map((x: { id: string }) => x.id)).toEqual(['Rathaus', 'Uni', 'Post', 'Marktplatz', 'Bibliothek', 'Corpshaus', 'Bank', 'Boerse', 'Einkaufsladen', 'Kirchturm', 'Codehaus', 'Atelier', 'Hafen']);
    expect(g.find((x: { id: string }) => x.id === 'Bank').status).toBe('offen'); // seit Etappe 7
    expect(g.every((x: { fehler?: string }) => !x.fehler)).toBe(true);
    const baum = (await d.app.inject({ url: '/api/vault/baum', headers: d.h })).json();
    expect(baum.kinder[0].name).toBe('00_Stadtordnung');
  });

  it('fehlerhafte gebaeude.md wird angezeigt statt verschluckt', async () => {
    const d = await angemeldetesDorf();
    fs.mkdirSync(path.join(d.vault.wurzel, 'Werkstatt'));
    fs.writeFileSync(path.join(d.vault.wurzel, 'Werkstatt/gebaeude.md'), '---\nstatus: vielleicht\n---\n');
    const g = (await d.app.inject({ url: '/api/gebaeude', headers: d.h })).json();
    expect(g.find((x: { id: string }) => x.id === 'Werkstatt').fehler).toMatch(/fehlerhaft/);
  });

  it('lesen, schreiben mit Konfliktschutz, suchen, löschen', async () => {
    const d = await angemeldetesDorf();
    const put = (payload: object) => d.app.inject({ method: 'PUT', url: '/api/vault/datei', headers: d.h, payload });
    const a = (await put({ pfad: 'Uni/faecher/Mathe/notiz.md', inhalt: 'Eigenwerte und Eigenvektoren', neu: true })).json();
    expect(a.konflikt).toBe(false);
    expect((await put({ pfad: 'Uni/faecher/Mathe/notiz.md', inhalt: 'x', neu: true })).statusCode).toBe(409);
    const d1 = (await d.app.inject({ url: '/api/vault/datei?pfad=Uni/faecher/Mathe/notiz.md', headers: d.h })).json();
    expect(d1.version).toBe(a.version);

    await new Promise((r) => setTimeout(r, 50));
    const treffer = (await d.app.inject({ url: '/api/vault/suche?q=eigenwer', headers: d.h })).json();
    expect(treffer[0].pfad).toBe('Uni/faecher/Mathe/notiz.md');
    expect(treffer[0].ausschnitt).toContain('«Eigenwerte»');
    const umlaut = (await d.app.inject({ url: `/api/vault/suche?q=${encodeURIComponent('buergermeister')}`, headers: d.h })).json();
    expect(umlaut.length).toBeGreaterThan(0);

    const b = (await put({ pfad: 'Uni/faecher/Mathe/notiz.md', inhalt: 'neu', basisVersion: 'veraltet' })).json();
    expect(b.konflikt).toBe(true);
    expect((await d.app.inject({ url: '/api/vault/konflikte', headers: d.h })).json()).toHaveLength(1);

    const del = await d.app.inject({ method: 'DELETE', url: '/api/vault/eintrag?pfad=Uni/faecher/Mathe/notiz.md', headers: d.h });
    expect(del.json().papierkorb).toMatch(/^\.papierkorb\//);
    expect((await d.app.inject({ url: '/api/vault/datei?pfad=Uni/faecher/Mathe/notiz.md', headers: d.h })).statusCode).toBe(404);
    expect((await d.app.inject({ url: '/api/vault/datei?pfad=../../etc/passwd', headers: d.h })).statusCode).toBe(400);
    expect((await d.app.inject({ url: `/api/vault/datei?pfad=${encodeURIComponent('.papierkorb/x')}`, headers: d.h })).statusCode).toBe(400);
  });

  it('Rohdateien werden nie als aktive Seite ausgeliefert', async () => {
    const d = await angemeldetesDorf();
    fs.writeFileSync(path.join(d.vault.wurzel, 'boese.html'), '<script>alert(1)</script>');
    fs.writeFileSync(path.join(d.vault.wurzel, 'bild.svg'), '<svg><script>alert(1)</script></svg>');
    const html = await d.app.inject({ url: '/api/vault/roh?pfad=boese.html', headers: d.h });
    expect(html.headers['content-type']).toBe('application/octet-stream');
    expect(html.headers['content-disposition']).toMatch(/^attachment/);
    const svg = await d.app.inject({ url: '/api/vault/roh?pfad=bild.svg', headers: d.h });
    expect(svg.headers['content-security-policy']).toMatch(/sandbox/);
    expect(svg.headers['content-disposition']).toMatch(/^attachment/);
    const md = await d.app.inject({ url: '/api/vault/roh?pfad=Start.md', headers: d.h });
    expect(md.headers['content-disposition']).toMatch(/^inline/);
  });

  it('hochladen per Multipart', async () => {
    const d = await angemeldetesDorf();
    const grenze = '----dorf';
    const body =
      `--${grenze}\r\nContent-Disposition: form-data; name="datei"; filename="Übung 1.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 test\r\n` +
      `--${grenze}--\r\n`;
    const r = await d.app.inject({
      method: 'POST',
      url: '/api/vault/hochladen?ordner=Uni',
      headers: { ...d.h, 'content-type': `multipart/form-data; boundary=${grenze}` },
      payload: body,
    });
    expect(r.json()).toEqual({ gespeichert: ['Uni/Uebung 1.pdf'] });
  });
});

describe('Live-Verbindung', () => {
  it('meldet Änderungen von außen (Dateiwächter) und trennt widerrufene Sitzungen', async () => {
    const d = await testDorf({ beobachten: true });
    await passwortSetzen(d.db, d.uhr, PW);
    const r = await d.app.inject({ method: 'POST', url: '/api/anmeldung', headers: { origin: ORIGIN }, payload: { passwort: PW } });
    const cookie = cookieAus(r.headers['set-cookie']);
    await d.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (d.app.server.address() as { port: number }).port;

    // fremde Herkunft wird schon beim Verbindungsaufbau abgelehnt
    const boese = new WebSocket(`ws://127.0.0.1:${port}/api/live`, { headers: { cookie, origin: 'https://boese.example' } });
    await new Promise<void>((res) => boese.on('error', () => res()).on('unexpected-response', () => res()));

    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/live`, { headers: { cookie, origin: ORIGIN } });
    const nachrichten: { typ: string; pfad?: string }[] = [];
    ws.on('message', (m) => nachrichten.push(JSON.parse(String(m))));
    await new Promise((res) => ws.on('open', res));
    await new Promise((res) => setTimeout(res, 300)); // Wächter bereit
    fs.writeFileSync(path.join(d.vault.wurzel, 'Rathaus/schreibtisch/aus-obsidian.md'), 'Hallo');
    await new Promise((res) => setTimeout(res, 1500));
    expect(nachrichten[0]?.typ).toBe('hallo');
    expect(nachrichten.some((n) => n.typ === 'vault.geaendert' && n.pfad === 'Rathaus/schreibtisch/aus-obsidian.md')).toBe(true);
    // und der Suchindex kennt die neue Datei
    expect(d.suche.suchen('Hallo').map((t) => t.pfad)).toContain('Rathaus/schreibtisch/aus-obsidian.md');

    const geschlossen = new Promise<number>((res) => ws.on('close', (code) => res(code)));
    await d.app.inject({ method: 'POST', url: '/api/abmeldung', headers: { origin: ORIGIN, cookie } });
    expect(await geschlossen).toBe(4001);
    expect(nachrichten.at(-1)?.typ).toBe('sitzung.beendet');
    await d.app.close();
  });
});

describe('Suche mit Umlauten', () => {
  it('findet Übung und Uebung gegenseitig', async () => {
    const d = await testDorf();
    await d.vault.schreiben('a.md', 'Die Übung zur Vorlesung');
    await d.vault.schreiben('b.md', 'Die Uebung aus Moodle');
    await d.suche.vollIndex();
    for (const q of ['Übung', 'uebung', 'UEBUNG']) {
      expect(d.suche.suchen(q).map((t) => t.pfad)).toEqual(expect.arrayContaining(['a.md', 'b.md']));
    }
    expect(d.suche.suchen('"; DROP TABLE suche; --')).toEqual([]);
  });
});
