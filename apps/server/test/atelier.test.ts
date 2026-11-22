import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aktionenListe } from '../src/agenten/aktionen.js';
import { werkzeugprofil } from '../src/agenten/leine.js';
import { rechenraumKlient, type BildSchritt, type RechenraumKlient } from '../src/agenten/rechenraum.js';
import { bildTyp, CLOUDFLARE_MODELL, modellMass } from '../src/atelier.js';
import { kopf } from './etappe7.test.js';
import { ORIGIN, tempOrdner, testDorf } from './hilfen.js';

/**
 * E198 – Atelier: Gebäude-Vorlage, Routen des Bildeditors (öffnen, speichern mit Konfliktkopie, KI im Rechenraum,
 * Bilder generieren über Cloudflare – gegen einen nachgebauten Endpunkt) und das Agenten-Werkzeug bild_bearbeiten
 * (echter Rechenraum-Runner, Attrappe als Motor).
 */

/** Kleines echtes PNG (RGBA, einfarbig) – ohne Bibliothek */
function png(breite: number, hoehe: number, farbe: [number, number, number, number] = [200, 40, 40, 255]) {
  const crcTabelle = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTabelle[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const stueck = (typ: string, daten: Buffer) => {
    const kopfTeil = Buffer.alloc(8);
    kopfTeil.writeUInt32BE(daten.length, 0);
    kopfTeil.write(typ, 4, 'latin1');
    const ende = Buffer.alloc(4);
    ende.writeUInt32BE(crc(Buffer.concat([kopfTeil.subarray(4), daten])), 0);
    return Buffer.concat([kopfTeil, daten, ende]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(breite, 0);
  ihdr.writeUInt32BE(hoehe, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const zeile = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: breite }, () => Buffer.from(farbe)))]);
  const roh = Buffer.concat(Array.from({ length: hoehe }, () => zeile));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), stueck('IHDR', ihdr), stueck('IDAT', zlib.deflateSync(roh)), stueck('IEND', Buffer.alloc(0))]);
}
const pngMasse = (b: Buffer) => [b.readUInt32BE(16), b.readUInt32BE(20)];
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

/** multipart/form-data für inject: Textfelder zuerst, dann die Datei */
function formular(datei: { name: string; inhalt: Buffer; typ?: string }, felder: Record<string, string> = {}) {
  const grenze = `----dorf${crypto.randomBytes(8).toString('hex')}`;
  const teile: Buffer[] = [];
  for (const [k, v] of Object.entries(felder)) teile.push(Buffer.from(`--${grenze}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  teile.push(Buffer.from(`--${grenze}\r\nContent-Disposition: form-data; name="datei"; filename="${datei.name}"\r\nContent-Type: ${datei.typ ?? 'application/octet-stream'}\r\n\r\n`), datei.inhalt, Buffer.from(`\r\n--${grenze}--\r\n`));
  return { payload: Buffer.concat(teile), typ: `multipart/form-data; boundary=${grenze}` };
}

/** Rechenraum-Attrappe: merkt sich die Aufträge und gibt ein PNG zurück (oder, was `ergebnis` vorgibt) */
function rechenraumAttrappe(kann: Partial<Awaited<ReturnType<RechenraumKlient['bildKann']>>> = {}, ergebnis?: { inhalt: Buffer; mime: string }) {
  const auftraege: { name: string; groesse: number; schritte: BildSchritt[]; format: string }[] = [];
  const klient = {
    bild: async (name: string, inhalt: Buffer, schritte: BildSchritt[], format: string) => {
      auftraege.push({ name, groesse: inhalt.length, schritte, format });
      return { inhalt: ergebnis?.inhalt ?? png(8, 6), breite: 8, hoehe: 6, eingang: [4, 4], format, mime: ergebnis?.mime ?? 'image/png', transparenz: true, hinweise: [] };
    },
    bildKann: async () => ({ bilder: true, hintergrund_entfernen: true, hochskalieren: false, heic: true, max_pixel: 24_000_000, skalieren_max_pixel: 1_050_000, ...kann }),
  } as unknown as RechenraumKlient;
  return { klient, auftraege };
}

describe('Atelier: Vorlage', () => {
  it('neuer Vault: Gebäude Atelier mit fehlerfreier Aktion „Bild bearbeiten“ (Rechenraum → bild_bearbeiten)', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const g = (await d.app.inject({ url: '/api/gebaeude', headers: h })).json() as { id: string; status: string; fehler?: string; symbol: string }[];
    expect(g.find((x) => x.id === 'Atelier')).toMatchObject({ status: 'offen', symbol: '🎨' });
    expect(g.find((x) => x.id === 'Atelier')!.fehler).toBeUndefined();
    const a = (await aktionenListe(d.vault)).filter((x) => x.gebaeude === 'Atelier');
    // E212: dazu „In Handschrift schreiben“
    expect(a.map((x) => x.id).sort()).toEqual(['Atelier/bild-bearbeiten', 'Atelier/handschrift']);
    for (const x of a) expect(x.fehler, x.id).toBeUndefined();
    // im Dorfplan steht es von selbst
    const plan = (await d.app.inject({ url: '/api/dorf', headers: h })).json() as { layout: { gebaeude: Record<string, unknown> } };
    expect(plan.layout.gebaeude.Atelier).toBeTruthy();
  });

  it('Leine: bild_bearbeiten nur mit werkzeuge: [rechenraum]', () => {
    expect(werkzeugprofil({ werkzeuge: ['vault_lesen', 'vault_schreiben'], fremdinhalte: false }).dorf).not.toContain('bild_bearbeiten');
    expect(werkzeugprofil({ werkzeuge: ['vault_lesen', 'rechenraum'], fremdinhalte: true }).dorf).toContain('bild_bearbeiten');
  });
});

describe('Atelier: Routen', () => {
  it('nur angemeldet und nur von der eigenen Herkunft', async () => {
    const d = await testDorf();
    expect((await d.app.inject({ url: '/api/atelier/stand' })).statusCode).toBe(401);
    expect((await d.app.inject({ url: '/api/atelier/oeffnen?pfad=Atelier/bilder/a.png' })).statusCode).toBe(401);
    const h = await kopf(d);
    const f = formular({ name: 'a.png', inhalt: png(2, 2) });
    const ohneHerkunft = await d.app.inject({ method: 'POST', url: '/api/atelier/speichern?pfad=Atelier/bilder/a.png', headers: { cookie: h.cookie, 'content-type': f.typ }, payload: f.payload });
    expect(ohneHerkunft.statusCode).toBe(403);
    expect(await d.vault.existiert('Atelier/bilder/a.png')).toBe(false);
  });

  it('stand: ohne Rechenraum und ohne Cloudflare ist alles aus; mit Rechenraum meldet er, was das Image kann', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    expect((await d.app.inject({ url: '/api/atelier/stand', headers: h })).json()).toMatchObject({ rechenraum: false, hintergrund: false, hochskalieren: false, generieren: false });
    d.agenten.rechenraum = rechenraumAttrappe().klient;
    expect((await d.app.inject({ url: '/api/atelier/stand', headers: h })).json()).toMatchObject({ rechenraum: true, hintergrund: true, hochskalieren: false, heic: true, generieren: false, skalierenMaxPixel: 1_050_000 });
  });

  it('öffnen: Browser-Formate unverändert mit Version; HEIC nur über den Rechenraum; anderes gar nicht', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const bild = png(4, 3);
    await d.vault.schreiben('Atelier/bilder/foto.png', bild);
    const r = await d.app.inject({ url: '/api/atelier/oeffnen?pfad=Atelier/bilder/foto.png', headers: h });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.headers['x-dorf-version']).toBe(sha(bild));
    expect(r.rawPayload.equals(bild)).toBe(true);

    await d.vault.schreiben('Atelier/bilder/handy.heic', Buffer.from('kein echtes heic'));
    // ohne Rechenraum: ehrliche Meldung
    expect((await d.app.inject({ url: '/api/atelier/oeffnen?pfad=Atelier/bilder/handy.heic', headers: h })).statusCode).toBe(503);
    const rr = rechenraumAttrappe();
    d.agenten.rechenraum = rr.klient;
    const u = await d.app.inject({ url: '/api/atelier/oeffnen?pfad=Atelier/bilder/handy.heic', headers: h });
    expect(u.statusCode).toBe(200);
    expect(u.headers['x-dorf-umgewandelt']).toBe('1');
    // die Version gehört zur Datei im Vault, nicht zum umgewandelten PNG
    expect(u.headers['x-dorf-version']).toBe(sha(Buffer.from('kein echtes heic')));
    expect(rr.auftraege).toEqual([{ name: 'handy.heic', groesse: 16, schritte: [], format: 'png' }]);

    await d.vault.schreiben('Atelier/notiz.md', 'x');
    expect((await d.app.inject({ url: '/api/atelier/oeffnen?pfad=Atelier/notiz.md', headers: h })).statusCode).toBe(400);
    expect((await d.app.inject({ url: '/api/atelier/oeffnen?pfad=Atelier/bilder/fehlt.png', headers: h })).statusCode).toBe(404);
    expect((await d.app.inject({ url: `/api/atelier/oeffnen?pfad=${encodeURIComponent('../../etc/passwd.png')}`, headers: h })).statusCode).toBe(400);
  });

  it('speichern: nur Bilder/Projekte, Inhalt muss zur Endung passen; veraltete basisVersion → Konfliktkopie statt Überschreiben', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const speichern = (pfad: string, inhalt: Buffer, mehr = '') => {
      const f = formular({ name: 'bild', inhalt });
      return d.app.inject({ method: 'POST', url: `/api/atelier/speichern?pfad=${encodeURIComponent(pfad)}${mehr}`, headers: { ...h, 'content-type': f.typ }, payload: f.payload });
    };
    const eins = png(4, 4);
    const r = await speichern('Atelier/bilder/werk.png', eins);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ pfad: 'Atelier/bilder/werk.png', konflikt: false, version: sha(eins) });
    expect((await d.vault.puffer('Atelier/bilder/werk.png'))!.inhalt.equals(eins)).toBe(true);

    // inzwischen hat ein anderes Gerät (oder Obsidian/Syncthing) die Datei geändert
    const fremd = png(5, 5);
    await d.vault.schreiben('Atelier/bilder/werk.png', fremd);
    const zwei = png(6, 6);
    const k = await speichern('Atelier/bilder/werk.png', zwei, `&basisVersion=${sha(eins)}`);
    expect(k.json()).toMatchObject({ konflikt: true });
    const kp = (k.json() as { konfliktPfad: string }).konfliktPfad;
    expect(kp).toMatch(/^Atelier\/bilder\/werk\.konflikt-.*\.png$/);
    expect((await d.vault.puffer('Atelier/bilder/werk.png'))!.inhalt.equals(fremd)).toBe(true);
    expect((await d.vault.puffer(kp))!.inhalt.equals(zwei)).toBe(true);
    // mit der aktuellen Version geht es durch
    expect((await speichern('Atelier/bilder/werk.png', zwei, `&basisVersion=${sha(fremd)}`)).json()).toMatchObject({ konflikt: false });
    // „neu“ überschreibt nie
    expect((await speichern('Atelier/bilder/werk.png', eins, '&neu=1')).statusCode).toBe(409);

    // Projektformat (ZIP) und die anderen Bildformate; Inhalt muss passen
    expect((await speichern('Atelier/bilder/werk.atelier', Buffer.from('PK\x03\x04rest', 'latin1'))).statusCode).toBe(200);
    expect((await speichern('Atelier/bilder/werk.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]))).statusCode).toBe(200);
    expect((await speichern('Atelier/bilder/werk.webp', Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1'))).statusCode).toBe(200);
    expect((await speichern('Atelier/bilder/boese.png', Buffer.from('<script>alert(1)</script>'))).statusCode).toBe(400);
    expect((await speichern('Atelier/bilder/seite.html', eins)).statusCode).toBe(400);
    expect((await speichern('Atelier/bilder/skript.svg', eins)).statusCode).toBe(400);
    expect((await speichern('oben.png', eins)).statusCode).toBe(400);
    expect((await speichern('../draussen/x.png', eins)).statusCode).toBe(400);
    expect((await speichern('Atelier/.versteckt/x.png', eins)).statusCode).toBe(400);
    expect((await speichern('Atelier/bilder/leer.png', Buffer.alloc(0))).statusCode).toBe(400);
    expect(await d.vault.existiert('Atelier/bilder/boese.png')).toBe(false);
  });

  it('E204: „Speichern unter“ einen vorhandenen Namen → 409 mit der Version der Datei; überschreiben nur mit dieser Version', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const speichern = (pfad: string, inhalt: Buffer, mehr = '') => {
      const f = formular({ name: 'bild', inhalt });
      return d.app.inject({ method: 'POST', url: `/api/atelier/speichern?pfad=${encodeURIComponent(pfad)}${mehr}`, headers: { ...h, 'content-type': f.typ }, payload: f.payload });
    };
    const leifs = png(7, 7);
    await d.vault.schreiben('Atelier/bilder/plakat.png', leifs);
    const r = await speichern('Atelier/bilder/plakat.png', png(2, 2), '&neu=1');
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ existiert: true, version: sha(leifs) });
    expect((await d.vault.puffer('Atelier/bilder/plakat.png'))!.inhalt.equals(leifs)).toBe(true);
    // Leif sagt „überschreiben“ – geändert hat sich die Datei inzwischen aber noch einmal → Konfliktkopie, nichts geht verloren
    const neuer = png(8, 8);
    await d.vault.schreiben('Atelier/bilder/plakat.png', neuer);
    const k = await speichern('Atelier/bilder/plakat.png', png(2, 2), `&basisVersion=${sha(leifs)}`);
    expect(k.json()).toMatchObject({ konflikt: true });
    expect((await d.vault.puffer('Atelier/bilder/plakat.png'))!.inhalt.equals(neuer)).toBe(true);
    // mit der richtigen Version wird ersetzt
    const ok = await speichern('Atelier/bilder/plakat.png', png(3, 3), `&basisVersion=${sha(neuer)}`);
    expect(ok.json()).toMatchObject({ konflikt: false });
    expect(pngMasse((await d.vault.puffer('Atelier/bilder/plakat.png'))!.inhalt)).toEqual([3, 3]);
    // ein neuer Name geht mit neu=1 einfach durch; ein Ordner bleibt ein Ordner (409 ohne Version)
    expect((await speichern('Atelier/bilder/neu.png', png(2, 2), '&neu=1')).statusCode).toBe(200);
    await d.vault.ordnerAnlegen('Atelier/bilder/ordner.png');
    const o = await speichern('Atelier/bilder/ordner.png', png(2, 2), '&neu=1');
    expect(o.statusCode).toBe(409);
    expect(o.json().version).toBeUndefined();
  });

  it('E204: Bilder vom Rechenraum gehen nur als PNG hinaus – Typ fest, Anfangsbytes geprüft, sandbox + nosniff', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const ki = () => {
      const f = formular({ name: 'ebene.png', inhalt: png(4, 4) });
      return d.app.inject({ method: 'POST', url: '/api/atelier/ki?art=hintergrund', headers: { ...h, 'content-type': f.typ }, payload: f.payload });
    };
    // der Rechenraum behauptet HTML – zählt nicht, die Bytes sind ein PNG
    d.agenten.rechenraum = rechenraumAttrappe({}, { inhalt: png(8, 6), mime: 'text/html' }).klient;
    const r = await ki();
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.headers['content-security-policy']).toBe('sandbox');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    // Bytes, die kein PNG sind, kommen nicht unter dem Ursprung der App an
    d.agenten.rechenraum = rechenraumAttrappe({}, { inhalt: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), mime: 'image/png' }).klient;
    expect((await ki()).statusCode).toBe(502);
    const f = formular({ name: 'scan.tif', inhalt: png(4, 4) });
    expect((await d.app.inject({ method: 'POST', url: '/api/atelier/umwandeln', headers: { ...h, 'content-type': f.typ }, payload: f.payload })).statusCode).toBe(502);
    await d.vault.schreiben('Atelier/bilder/a.heic', Buffer.from('x'));
    expect((await d.app.inject({ url: '/api/atelier/oeffnen?pfad=Atelier/bilder/a.heic', headers: h })).statusCode).toBe(502);
    // auch Bilder aus dem Vault: sandbox + nosniff
    await d.vault.schreiben('Atelier/bilder/b.png', png(2, 2));
    expect((await d.app.inject({ url: '/api/atelier/oeffnen?pfad=Atelier/bilder/b.png', headers: h })).headers['content-security-policy']).toBe('sandbox');
    // Erkennung nur an den Bytes
    expect(bildTyp(png(1, 1))).toBe('image/png');
    expect(bildTyp(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBeNull(); // zu kurz für IHDR
    expect(bildTyp(Buffer.from('<svg/>'))).toBeNull();
  });

  it('E204: die Antwort des Rechenraums ist begrenzt – ein zu großes Ergebnis wird abgebrochen statt gepuffert', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      // ohne content-length (chunked): das Dorf muss beim Lesen zählen
      res.write('{"inhalt_b64":"');
      for (let i = 0; i < 40; i++) res.write('A'.repeat(64 * 1024));
      res.end('","breite":1,"hoehe":1,"eingang":[1,1],"format":"png","mime":"image/png"}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
    try {
      await expect(rechenraumKlient(url, 'x', 1024 * 1024).bild('a.png', png(1, 1), [], 'png')).rejects.toMatchObject({ status: 502, message: expect.stringContaining('zu groß') });
      // mit genug Platz kommt dieselbe Antwort an
      expect((await rechenraumKlient(url, 'x', 4 * 1024 * 1024).bild('a.png', png(1, 1), [], 'png')).breite).toBe(1);
    } finally {
      server.close();
    }
  });

  it('KI im Rechenraum: Hintergrund entfernen und Hochskalieren reichen genau einen Schritt weiter; ohne Rechenraum 503', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const ki = (frage: string) => {
      const f = formular({ name: 'ebene.png', inhalt: png(4, 4) });
      return d.app.inject({ method: 'POST', url: `/api/atelier/ki?${frage}`, headers: { ...h, 'content-type': f.typ }, payload: f.payload });
    };
    expect((await ki('art=hintergrund')).statusCode).toBe(503);
    const rr = rechenraumAttrappe();
    d.agenten.rechenraum = rr.klient;
    const r = await ki('art=hintergrund');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(pngMasse(r.rawPayload)).toEqual([8, 6]);
    expect((await ki('art=hochskalieren&faktor=4')).statusCode).toBe(200);
    expect(rr.auftraege.map((x) => x.schritte)).toEqual([[{ art: 'hintergrund_entfernen' }], [{ art: 'hochskalieren', faktor: 4 }]]);
    expect((await ki('art=hochskalieren&faktor=3')).statusCode).toBe(400);
    expect((await ki('art=hochskalieren')).statusCode).toBe(400);
    expect((await ki('art=zaubern')).statusCode).toBe(400);
    expect(rr.auftraege).toHaveLength(2);
  });

  it('Bilder generieren: ohne Zugang ehrlich „nicht eingerichtet“ mit dem Befehl', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const r = await d.app.inject({ method: 'POST', url: '/api/atelier/generieren', headers: h, payload: { prompt: 'ein Dorf im Nebel', breite: 1024, hoehe: 768 } });
    expect(r.statusCode).toBe(503);
    expect(r.json().fehler).toContain('dorf bilder-einrichten');
    const f = formular({ name: 'v.png', inhalt: png(4, 4) }, { prompt: 'x', breite: '512', hoehe: '512' });
    expect((await d.app.inject({ method: 'POST', url: '/api/atelier/fuellen', headers: { ...h, 'content-type': f.typ }, payload: f.payload })).statusCode).toBe(503);
  });
});

describe('Atelier: Cloudflare Workers AI (nachgebauter Endpunkt)', () => {
  let server: http.Server;
  let url = '';
  const anfragen: { pfad: string; auth: string; typ: string; koerper: string }[] = [];
  let antwort: { status: number; json?: unknown; roh?: { typ: string; daten: Buffer } } = { status: 200, json: {} };
  const bild = png(16, 16, [10, 120, 200, 255]);

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const teile: Buffer[] = [];
      req.on('data', (t: Buffer) => teile.push(t));
      req.on('end', () => {
        anfragen.push({ pfad: req.url ?? '', auth: req.headers.authorization ?? '', typ: req.headers['content-type'] ?? '', koerper: Buffer.concat(teile).toString('latin1') });
        if (antwort.roh) return void res.writeHead(antwort.status, { 'content-type': antwort.roh.typ }).end(antwort.roh.daten);
        res.writeHead(antwort.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(antwort.json));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/client/v4`;
  });
  afterAll(() => server.close());

  const env = () => ({ CLOUDFLARE_ACCOUNT_ID: 'konto123', CLOUDFLARE_API_TOKEN: 'geheimes-token', CLOUDFLARE_API_URL: url });

  it('Text → Bild: richtiger Endpunkt, Bearer-Token, multipart mit prompt/width/height; das Token erreicht den Browser nie', async () => {
    const d = await testDorf({ env: env() });
    const h = await kopf(d);
    expect((await d.app.inject({ url: '/api/atelier/stand', headers: h })).json()).toMatchObject({ generieren: true });
    antwort = { status: 200, json: { result: { image: bild.toString('base64') }, success: true, errors: [] } };
    anfragen.length = 0;
    const r = await d.app.inject({ method: 'POST', url: '/api/atelier/generieren', headers: h, payload: { prompt: 'ein Dorf im Nebel', breite: 1000, hoehe: 700 } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.rawPayload.equals(bild)).toBe(true);
    expect(anfragen).toHaveLength(1);
    const a = anfragen[0]!;
    expect(a.pfad).toBe(`/client/v4/accounts/konto123/ai/run/${CLOUDFLARE_MODELL}`);
    expect(a.auth).toBe('Bearer geheimes-token');
    expect(a.typ).toMatch(/^multipart\/form-data; boundary=/);
    expect(a.koerper).toMatch(/name="prompt"\r\n\r\nein Dorf im Nebel\r\n/);
    // Maße auf Vielfache von 16 gebracht
    expect(a.koerper).toMatch(/name="width"\r\n\r\n1008\r\n/);
    expect(a.koerper).toMatch(/name="height"\r\n\r\n704\r\n/);
    expect(a.koerper).not.toContain('input_image_0');
    expect(JSON.stringify(r.headers) + r.payload).not.toContain('geheimes-token');
    // leerer Text / unsinnige Maße kommen gar nicht erst bei Cloudflare an
    expect((await d.app.inject({ method: 'POST', url: '/api/atelier/generieren', headers: h, payload: { prompt: '  ', breite: 512, hoehe: 512 } })).statusCode).toBe(400);
    expect((await d.app.inject({ method: 'POST', url: '/api/atelier/generieren', headers: h, payload: { prompt: 'x', breite: 9000, hoehe: 512 } })).statusCode).toBe(400);
    expect(anfragen).toHaveLength(1);
  });

  it('Generatives Füllen: Vorlage als input_image_0; zu große Vorlage wird abgelehnt', async () => {
    const d = await testDorf({ env: env() });
    const h = await kopf(d);
    antwort = { status: 200, json: { result: { image: bild.toString('base64') }, success: true } };
    anfragen.length = 0;
    const fuellen = (vorlage: Buffer) => {
      const f = formular({ name: 'vorlage.png', inhalt: vorlage, typ: 'image/png' }, { prompt: 'eine Katze auf dem Sofa', breite: '512', hoehe: '384' });
      return d.app.inject({ method: 'POST', url: '/api/atelier/fuellen', headers: { ...h, 'content-type': f.typ }, payload: f.payload });
    };
    const r = await fuellen(png(64, 48));
    expect(r.statusCode).toBe(200);
    expect(r.rawPayload.equals(bild)).toBe(true);
    expect(anfragen[0]!.koerper).toMatch(/name="input_image_0"; filename="vorlage.png"\r\nContent-Type: image\/png/);
    expect(anfragen[0]!.koerper).toMatch(/name="height"\r\n\r\n384\r\n/);
    expect((await fuellen(png(600, 10))).statusCode).toBe(400);
    expect((await fuellen(Buffer.from('kein png'))).statusCode).toBe(400);
    // E204: nur die PNG-Signatur und ein paar Bytes (kein IHDR) – sauber 400 statt RangeError/500
    expect((await fuellen(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]))).statusCode).toBe(400);
    expect(anfragen).toHaveLength(1);
  });

  it('Fehler von Cloudflare kommen verständlich an: falscher Schlüssel, Kontingent, kein Bild', async () => {
    const d = await testDorf({ env: env() });
    const h = await kopf(d);
    const los = () => d.app.inject({ method: 'POST', url: '/api/atelier/generieren', headers: h, payload: { prompt: 'x', breite: 512, hoehe: 512 } });
    antwort = { status: 401, json: { success: false, errors: [{ code: 10000, message: 'Authentication error' }] } };
    let r = await los();
    expect(r.statusCode).toBe(503);
    expect(r.json().fehler).toMatch(/Authentication error.*dorf bilder-einrichten/);
    antwort = { status: 429, json: { success: false, errors: [{ code: 4006, message: 'daily free allocation used up' }] } };
    r = await los();
    expect(r.statusCode).toBe(429);
    expect(r.json().fehler).toMatch(/Kontingent.*00:00 UTC/);
    antwort = { status: 200, json: { result: {}, success: true } };
    expect((await los()).statusCode).toBe(502);
    antwort = { status: 200, json: { result: { image: Buffer.from('<html>').toString('base64') } } };
    expect((await los()).statusCode).toBe(502);
    // E204: nur PNG/JPEG/WebP – erkannt an den Bytes; ein SVG (auch als „image/svg+xml“ gemeldet) kommt nie durch
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    antwort = { status: 200, roh: { typ: 'image/svg+xml', daten: svg } };
    expect((await los()).statusCode).toBe(502);
    antwort = { status: 200, json: { result: { image: svg.toString('base64') } } };
    expect((await los()).statusCode).toBe(502);
    // rohe Bilddaten mit falschem Typ: der Typ kommt aus den Bytes
    antwort = { status: 200, roh: { typ: 'image/gif', daten: bild } };
    const r2 = await los();
    expect(r2.statusCode).toBe(200);
    expect(r2.headers['content-type']).toBe('image/png');
    expect(r2.headers['content-security-policy']).toBe('sandbox');
  });

  it('Maße fürs Modell: 256–1920, Vielfache von 16', () => {
    expect([100, 256, 1000, 1024, 5000].map(modellMass)).toEqual([256, 256, 1008, 1024, 1920]);
  });
});

const HAT_PILLOW = spawnSync('python3', ['-c', 'import PIL']).status === 0;

describe.skipIf(!HAT_PILLOW)('Atelier: Ende zu Ende mit dem echten Rechenraum-Runner (Pillow)', () => {
  const GEHEIM = 'atelier-test-geheimnis';
  let runner: ChildProcess;
  let url = '';

  beforeAll(async () => {
    const port = await new Promise<number>((r) => {
      const s = net.createServer().listen(0, () => {
        const p = (s.address() as net.AddressInfo).port;
        s.close(() => r(p));
      });
    });
    runner = spawn('python3', [path.resolve(import.meta.dirname, '../../rechenraum/runner.py')], {
      env: { ...process.env, ARBEIT_DIR: tempOrdner('atelier-rr-'), PORT: String(port), RECHENRAUM_GEHEIMNIS: GEHEIM, PYTHONDONTWRITEBYTECODE: '1' },
      stdio: 'inherit',
    });
    url = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 50; i++) {
      if (await fetch(`${url}/gesundheit`).then((r) => r.ok, () => false)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Runner startet nicht');
  });
  afterAll(() => runner?.kill());

  const befehl = (name: string, e: unknown) => `<<werkzeug ${name} ${JSON.stringify(e)}>>`;

  it('bild_bearbeiten: neues Bild im Ablage-Ordner des Chats, Original unverändert, Lauf gilt als „hat Fremdes gesehen“', async () => {
    const d = await testDorf({ env: { RECHENRAUM_URL: url, RECHENRAUM_GEHEIMNIS: GEHEIM } });
    const original = png(120, 80);
    await d.vault.schreiben('Atelier/bilder/foto.png', original);
    await d.vault.schreiben('Atelier/notiz.md', 'kein Bild');
    const auftrag = [
      befehl('bild_bearbeiten', { pfad: 'Atelier/bilder/foto.png', schritte: [{ art: 'zuschneiden', x: 10, y: 0, breite: 100, hoehe: 80 }, { art: 'groesse', breite: 50 }, { art: 'drehen', grad: 90 }] }),
      befehl('bild_bearbeiten', { pfad: 'Atelier/bilder/foto.png', schritte: [], format: 'jpg', name: 'Für die Bewerbung!' }),
      befehl('bild_bearbeiten', { pfad: 'Atelier/notiz.md', schritte: [] }),
      befehl('bild_bearbeiten', { pfad: 'Atelier/bilder/foto.png', schritte: [{ art: 'zaubern' }] }),
      befehl('bild_bearbeiten', { pfad: 'Atelier/bilder/foto.png', schritte: [{ art: 'zuschneiden', x: 500, y: 0, breite: 10, hoehe: 10 }] }),
      befehl('bild_bearbeiten', { pfad: '../draussen.png', schritte: [] }),
    ].join('\n');
    const { chatId } = await d.agenten.aktionStarten('Atelier/bild-bearbeiten', { bild: 'Atelier/bilder/foto.png', auftrag });
    await d.agenten.leerlauf();

    const log = d.db.prepare("SELECT erlaubt, ergebnis, pfad, art FROM werkzeug_log WHERE chat_id = ? AND werkzeug = 'bild_bearbeiten' ORDER BY id").all(chatId) as { erlaubt: number; ergebnis: string; pfad: string | null; art: string | null }[];
    expect(log).toHaveLength(6);
    // 1: zugeschnitten, verkleinert, gedreht → 40×50 PNG in <Gebäude>/entwuerfe/<stempel>_<titel>/
    expect(log[0]).toMatchObject({ erlaubt: 1, art: 'geschrieben' });
    expect(log[0]!.pfad).toMatch(/^Atelier\/entwuerfe\/\d{4}-\d{2}-\d{2}_\d{4}_[a-z0-9-]+\/foto-bearbeitet\.png$/);
    expect(log[0]!.ergebnis).toContain('120×80 → 40×50 PNG');
    const erstes = (await d.vault.puffer(log[0]!.pfad!))!.inhalt;
    expect(pngMasse(erstes)).toEqual([40, 50]);
    // 2: nur Format; der Name des Agenten wird bereinigt
    expect(log[1]!.pfad).toMatch(/\/fuer-die-bewerbung\.jpg$/);
    const zweites = (await d.vault.puffer(log[1]!.pfad!))!.inhalt;
    expect([zweites[0], zweites[1]]).toEqual([0xff, 0xd8]);
    // 3–6: ehrliche Fehler, nichts geschrieben
    for (const l of log.slice(2)) expect(l.pfad).toBeNull();
    expect(log[2]!.ergebnis).toContain('kein Bild');
    expect(log[4]!.ergebnis).toContain('außerhalb');
    // Original unverändert
    expect((await d.vault.puffer('Atelier/bilder/foto.png'))!.inhalt.equals(original)).toBe(true);
    // Leif sieht die neuen Dateien am Lauf
    const detail = d.agenten.chatDetail(chatId);
    expect(detail.laeufe[0]!.dateien!.map((x) => x.name).sort()).toEqual(['foto-bearbeitet.png', 'fuer-die-bewerbung.jpg']);
    // der Lauf hat ein Bild gesehen → Chat gilt als von Fremdem berührt (E195)
    expect((d.db.prepare('SELECT fremd_beruehrt FROM chats WHERE id = ?').get(chatId) as { fremd_beruehrt: number }).fremd_beruehrt).toBe(1);
  });

  it('bild_bearbeiten überschreibt nie eine fremde Datei; ohne Rechenraum-Fähigkeit ist das Werkzeug nicht erlaubt', async () => {
    const d = await testDorf({ env: { RECHENRAUM_URL: url, RECHENRAUM_GEHEIMNIS: GEHEIM } });
    await d.vault.schreiben('Atelier/bilder/foto.png', png(20, 20));
    const erster = await d.agenten.aktionStarten('Atelier/bild-bearbeiten', { bild: 'x', auftrag: befehl('bild_bearbeiten', { pfad: 'Atelier/bilder/foto.png', schritte: [], name: 'ergebnis' }) });
    await d.agenten.leerlauf();
    const pfad = (d.db.prepare("SELECT pfad FROM werkzeug_log WHERE chat_id = ? AND werkzeug = 'bild_bearbeiten'").get(erster.chatId) as { pfad: string }).pfad;
    // E204: Leif bearbeitet das Ergebnis danach selbst – auch derselbe Chat ersetzt es nie (früher: „eigene Datei“ → überschrieben)
    const leifs = png(3, 3);
    await d.vault.schreiben(pfad, leifs);
    await d.agenten.nachrichtSenden(erster.chatId, befehl('bild_bearbeiten', { pfad: 'Atelier/bilder/foto.png', schritte: [], name: 'ergebnis' }));
    await d.agenten.leerlauf();
    expect((await d.vault.puffer(pfad))!.inhalt.equals(leifs)).toBe(true);
    expect(await d.vault.existiert(pfad.replace(/ergebnis\.png$/, 'ergebnis-2.png'))).toBe(true);
    // und ohne Leifs Änderung: ebenfalls ein neuer Name, nie ersetzt
    await d.agenten.nachrichtSenden(erster.chatId, befehl('bild_bearbeiten', { pfad: 'Atelier/bilder/foto.png', schritte: [], name: 'ergebnis' }));
    await d.agenten.leerlauf();
    expect(await d.vault.existiert(pfad.replace(/ergebnis\.png$/, 'ergebnis-3.png'))).toBe(true);
    expect((await d.vault.puffer(pfad))!.inhalt.equals(leifs)).toBe(true);

    // Aktion ohne Rechenraum
    await d.vault.schreiben('Atelier/aktionen/ohne.md', '---\nname: Ohne\nmotor: api\nstufe: klein\nwerkzeuge: [vault_lesen, vault_schreiben]\nfremdinhalte: nein\neingaben:\n  - name: auftrag\n---\n{auftrag}\n');
    const ohne = await d.agenten.aktionStarten('Atelier/ohne', { auftrag: befehl('bild_bearbeiten', { pfad: 'Atelier/bilder/foto.png', schritte: [] }) });
    await d.agenten.leerlauf();
    expect(d.db.prepare("SELECT erlaubt FROM werkzeug_log WHERE chat_id = ? AND werkzeug = 'bild_bearbeiten'").get(ohne.chatId)).toEqual({ erlaubt: 0 });
  });

  it('Editor über den echten Runner: Datei von der Festplatte umwandeln; KI ohne Modell meldet ehrlich, was fehlt', async () => {
    const d = await testDorf({ env: { RECHENRAUM_URL: url, RECHENRAUM_GEHEIMNIS: GEHEIM } });
    const h = await kopf(d);
    const stand = (await d.app.inject({ url: '/api/atelier/stand', headers: h })).json() as { rechenraum: boolean; hintergrund: boolean };
    expect(stand.rechenraum).toBe(true);
    const f = formular({ name: 'scan.tif', inhalt: png(30, 20) });
    const u = await d.app.inject({ method: 'POST', url: '/api/atelier/umwandeln', headers: { ...h, 'content-type': f.typ }, payload: f.payload });
    expect(u.statusCode).toBe(200);
    expect(pngMasse(u.rawPayload)).toEqual([30, 20]);
    const kaputt = formular({ name: 'kaputt.heic', inhalt: Buffer.from('nichts') });
    const k = await d.app.inject({ method: 'POST', url: '/api/atelier/umwandeln', headers: { ...h, 'content-type': kaputt.typ }, payload: kaputt.payload });
    expect(k.statusCode).toBe(400);
    if (!stand.hintergrund) {
      const g = formular({ name: 'ebene.png', inhalt: png(30, 20) });
      const r = await d.app.inject({ method: 'POST', url: '/api/atelier/ki?art=hintergrund', headers: { ...h, 'content-type': g.typ }, payload: g.payload });
      expect(r.statusCode).toBe(400);
      expect(r.json().fehler).toMatch(/fehlt im Rechenraum/);
    }
  });
});
