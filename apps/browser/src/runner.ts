import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { BrowserFehler, MoodleBrowser } from './browser.js';

/**
 * Runner des Moodle-Browsers: HTTP-Schnittstelle NUR für das Dorf (Geheimnis im Kopf „Authorization: Bearer …“).
 * Zugangsdaten (MOODLE_BENUTZER/MOODLE_PASSWORT) kennt nur dieser Container; sie verlassen ihn nie.
 */
export function runnerStarten(o: { port: number; geheimnis: string; browser: MoodleBrowser; host?: string }) {
  const erwartet = Buffer.from(`Bearer ${o.geheimnis}`);
  const server = http.createServer((req, res) => {
    const senden = (status: number, daten: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(daten));
    };
    if (req.method === 'GET' && req.url === '/gesundheit') return senden(200, { ok: true, zugang: o.browser.hatZugang() });
    const auth = Buffer.from(req.headers.authorization ?? '');
    if (auth.length !== erwartet.length || !crypto.timingSafeEqual(auth, erwartet)) return senden(401, { ok: false, fehler: 'Nicht erlaubt.' });
    if (req.method !== 'POST') return senden(405, { ok: false, fehler: 'Nur POST.' });
    const teile: Buffer[] = [];
    let groesse = 0;
    req.on('data', (c: Buffer) => {
      groesse += c.length;
      if (groesse > 64 * 1024) req.destroy();
      else teile.push(c);
    });
    req.on('end', () => {
      void (async () => {
        let k: Record<string, unknown>;
        try {
          k = JSON.parse(Buffer.concat(teile).toString('utf8') || '{}') as Record<string, unknown>;
        } catch {
          return senden(400, { ok: false, fehler: 'Ungültiges JSON.' });
        }
        const sitzung = String(k.sitzung ?? '').slice(0, 100);
        const nr = Number(k.nr);
        const b = o.browser;
        try {
          switch (req.url) {
            case '/oeffnen':
              return senden(200, { ok: true, ...(await b.oeffnen(sitzung, String(k.url ?? '/'))) });
            case '/klicken':
              return senden(200, { ok: true, ...(await b.klicken(sitzung, nr)) });
            case '/seite':
              return senden(200, { ok: true, ...(await b.seite(sitzung)) });
            case '/zurueck':
              return senden(200, { ok: true, ...(await b.zurueck(sitzung)) });
            case '/bild':
              return senden(200, { ok: true, ...(await b.bild(sitzung)) });
            case '/herunterladen': {
              const d = await b.herunterladen(sitzung, nr);
              return senden(200, { ok: true, name: d.name, mime: d.mime, daten: d.daten.toString('base64') });
            }
            case '/schliessen':
              await b.schliessen(sitzung);
              return senden(200, { ok: true });
            case '/anmeldung-pruefen':
              return senden(200, await b.anmeldungPruefen());
            default:
              return senden(404, { ok: false, fehler: 'Unbekannt.' });
          }
        } catch (e) {
          const meldung = e instanceof BrowserFehler ? e.message : `Browserfehler: ${(e as Error).message.split('\n')[0]}`;
          return senden(200, { ok: false, fehler: meldung });
        }
      })();
    });
  });
  server.listen(o.port, o.host ?? '0.0.0.0');
  return server;
}

/** KEY=WERT-Datei lesen (browser.env, als Datei eingebunden – kein env_file, damit das Dorf sie nie sieht) */
export function konfigLesen(text: string): Record<string, string> {
  const aus: Record<string, string> = {};
  for (const zeile of text.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(zeile);
    if (m) aus[m[1]!] = m[2]!;
  }
  return aus;
}

// Start als Programm (im Container): „node runner.js“ = Dienst, „node runner.js pruefen“ = Anmeldung testen
if (process.argv[1] && /runner\.(js|ts)$/.test(process.argv[1])) {
  const datei = process.env.BROWSER_KONFIG;
  let ausDatei: Record<string, string> = {};
  if (datei && fs.existsSync(datei)) {
    try {
      ausDatei = konfigLesen(fs.readFileSync(datei, 'utf8'));
    } catch (e) {
      console.error(`${datei} ist nicht lesbar (${(e as Error).message}) – auf dem Server: dorf deploy bzw. dorf moodle-browser-zugang`);
    }
  }
  const k: Record<string, string | undefined> = { ...process.env, ...ausDatei };
  const browser = new MoodleBrowser({
    moodleUrl: k.MOODLE_WEB_URL || 'https://moodle.jku.at',
    hosts: (k.BROWSER_HOSTS || 'jku.at').split(/[\s,]+/).filter(Boolean),
    benutzer: k.MOODLE_BENUTZER || undefined,
    passwort: k.MOODLE_PASSWORT || undefined,
    log: (t) => console.log(t),
  });
  if (process.argv[2] === 'pruefen') {
    void browser
      .anmeldungPruefen()
      .then((r) => {
        console.log(r.meldung);
        return browser.beenden().then(() => process.exit(r.ok ? 0 : 1));
      })
      .catch((e: Error) => {
        console.error(e.message);
        void browser.beenden().then(() => process.exit(1));
      });
  } else {
    const geheimnis = k.BROWSER_GEHEIMNIS ?? '';
    if (geheimnis.length < 32) {
      console.error('BROWSER_GEHEIMNIS fehlt oder ist zu kurz (mind. 32 Zeichen).');
      process.exit(1);
    }
    runnerStarten({ port: Number(k.PORT ?? 4200), geheimnis, browser });
    console.log(`Moodle-Browser bereit (Domains: ${k.BROWSER_HOSTS || 'jku.at'}, Zugangsdaten ${k.MOODLE_BENUTZER ? 'hinterlegt' : 'FEHLEN – dorf moodle-browser-zugang'}).`);
    const ende = () => void browser.beenden().finally(() => process.exit(0));
    process.on('SIGTERM', ende);
    process.on('SIGINT', ende);
  }
}
