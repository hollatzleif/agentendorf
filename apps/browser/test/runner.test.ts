import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MoodleBrowser } from '../src/browser.js';
import { runnerStarten } from '../src/runner.js';

const PDF = Buffer.from('%PDF-1.4\n% Folien Woche 1\n%%EOF\n');
const executablePath = process.env.PW_CHROMIUM ?? (process.env.CI ? undefined : '/opt/pw-browsers/chromium');

/** Nachgebautes Moodle mit SSO-Anmeldung – merkt sich jede Anfrage, die ankommt */
function fakeMoodle() {
  const aufrufe: string[] = [];
  const ajax: string[] = [];
  let port = 0;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const angemeldet = (req.headers.cookie ?? '').includes('sitzung=ok');
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      aufrufe.push(`${req.method} ${u.pathname}`);
      const html = (titel: string, inhalt: string) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html><head><title>${titel}</title></head><body><div id="region-main">${inhalt}</div></body></html>`);
      };
      const weiter = (ziel: string, extra: Record<string, string> = {}) => {
        res.writeHead(303, { location: ziel, ...extra });
        res.end();
      };
      if (u.pathname === '/login/index.php') return html('Moodle: Anmelden', '<p>Anmelden mit</p><a href="/auth/sso.php">JKU Single Sign On</a>');
      if (u.pathname === '/auth/sso.php' && req.method === 'GET')
        return html('JKU Login', '<form method="post" action="/auth/sso.php"><input type="text" name="j_username"><input type="password" name="j_password"><button type="submit">Login</button></form>');
      if (u.pathname === '/auth/sso.php' && req.method === 'POST') {
        const f = new URLSearchParams(body);
        if (f.get('j_username') === 'k12345678' && f.get('j_password') === 'sehr-geheim')
          return weiter('/my/', { 'set-cookie': 'sitzung=ok; Path=/' });
        return html('JKU Login', '<div class="alert-danger">Benutzername oder Passwort falsch</div><form method="post" action="/auth/sso.php"><input type="text" name="j_username"><input type="password" name="j_password"></form>');
      }
      if (u.pathname === '/lib/ajax/service.php') {
        for (const x of JSON.parse(body) as { methodname: string }[]) ajax.push(x.methodname);
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end('[{"error":false,"data":[]}]');
      }
      // wie an der JKU: Nicht-Angemeldete sehen ein Gast-Dashboard statt einer Weiterleitung
      if (!angemeldet && u.pathname === '/my/')
        return html('Dashboard (Gast)', '<p>Sie sind als Gast angemeldet</p><a href="/login/index.php">Anmelden</a><a href="/course/view.php?id=1">Öffentlicher Kurs</a>');
      if (!angemeldet) return weiter('/login/index.php');
      if (u.pathname === '/my/')
        return html(
          'Dashboard',
          `<a href="/course/view.php?id=7">Computational Data Analytics</a><a href="/login/logout.php?sesskey=abc">Abmelden</a>
           <script>
             fetch('/lib/ajax/service.php?sesskey=abc', { method: 'POST', body: JSON.stringify([{ methodname: 'core_course_get_enrolled_courses_by_timeline_classification' }]) });
             fetch('/lib/ajax/service.php?sesskey=abc', { method: 'POST', body: JSON.stringify([{ methodname: 'core_user_update_user_preferences' }]) });
           </script>`,
        );
      if (u.pathname === '/course/view.php')
        return html(
          'Kurs: Computational Data Analytics',
          `<h2>Computational Data Analytics</h2>
           <a href="/mod/resource/view.php?id=11">Folien Woche 1</a>
           <a href="/mod/assign/view.php?id=12">Übung 3</a>
           <a href="/course/togglecompletion.php?id=11&sesskey=abc">Als erledigt markieren</a>
           <a href="http://localhost:${port}/fremd">Externe Seite</a>`,
        );
      if (u.pathname === '/mod/resource/view.php') return weiter('/pluginfile.php/1/mod_resource/content/1/folien1.pdf');
      if (u.pathname.startsWith('/pluginfile.php/')) {
        res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="folien1.pdf"' });
        return res.end(PDF);
      }
      if (u.pathname === '/mod/assign/view.php' && req.method === 'GET')
        return html(
          'Übung 3',
          `<h2>Übung 3</h2><p>Abgabe bis Donnerstag, 23:59</p><table><tr><td>Abgabestatus</td><td>Nicht abgegeben</td></tr></table>
           <form method="post" action="/mod/assign/view.php"><input type="hidden" name="action" value="submit"><button type="submit">Abgabe einreichen</button></form>`,
        );
      res.writeHead(404);
      res.end('nicht da');
    });
  });
  return {
    aufrufe,
    ajax,
    starten: () =>
      new Promise<string>((r) =>
        server.listen(0, '127.0.0.1', () => {
          port = (server.address() as AddressInfo).port;
          r(`http://127.0.0.1:${port}`);
        }),
      ),
    stoppen: () => new Promise((r) => server.close(r)),
  };
}

describe('Moodle-Browser gegen ein nachgebautes Moodle', () => {
  const m = fakeMoodle();
  let basis = '';
  let b: MoodleBrowser;
  beforeAll(async () => {
    basis = await m.starten();
    b = new MoodleBrowser({ moodleUrl: basis, hosts: ['127.0.0.1'], benutzer: 'k12345678', passwort: 'sehr-geheim', executablePath });
  });
  afterAll(async () => {
    await b?.beenden();
    await m.stoppen();
  });

  it('meldet sich über SSO-Knopf und Formular an; Passwort taucht nie in Antworten auf', async () => {
    const r = await b.anmeldungPruefen();
    expect(r).toMatchObject({ ok: true, meldung: expect.stringContaining('Dashboard') });
    expect(r.meldung).not.toMatch(/Gast/);
    // Gast-Dashboard → Login-Seite → SSO-Formular
    expect(m.aufrufe).toContain('GET /login/index.php');
    expect(m.aufrufe).toContain('POST /auth/sso.php');
    expect(JSON.stringify(r)).not.toContain('sehr-geheim');
  });

  it('liest Kurs und Abgabe; Abgeben, sesskey-Aktionen, Abmelden und fremde Domains bleiben gesperrt', async () => {
    const kurs = await b.oeffnen('lauf1', '/course/view.php?id=7');
    expect(kurs.titel).toBe('Kurs: Computational Data Analytics');
    expect(kurs.text).toContain('Computational Data Analytics');
    const nr = (t: string) => kurs.links.find((l) => l.text === t)!.nr;

    const abgabe = await b.klicken('lauf1', nr('Übung 3'));
    expect(abgabe.text).toContain('Nicht abgegeben');
    const knopf = abgabe.links.find((l) => l.text === 'Abgabe einreichen')!;
    expect(knopf.art).toBe('knopf');
    const nachKlick = await b.klicken('lauf1', knopf.nr);
    expect(nachKlick.blockiert.join('\n')).toMatch(/Formular senden ist gesperrt/);
    expect(m.aufrufe).not.toContain('POST /mod/assign/view.php');

    const wieder = await b.oeffnen('lauf1', '/course/view.php?id=7');
    const erledigt = await b.klicken('lauf1', wieder.links.find((l) => l.text === 'Als erledigt markieren')!.nr);
    expect(erledigt.blockiert.join('\n')).toMatch(/sesskey/);
    expect(m.aufrufe).not.toContain('GET /course/togglecompletion.php');

    const kurs2 = await b.oeffnen('lauf1', '/course/view.php?id=7');
    await expect(b.klicken('lauf1', kurs2.links.find((l) => l.text === 'Externe Seite')!.nr)).rejects.toThrow(/außerhalb/);
    await expect(b.oeffnen('lauf1', 'https://example.com/')).rejects.toThrow(/außerhalb/);
  });

  it('Dashboard: lesende Ajax-Aufrufe gehen durch, schreibende nicht; Abmelden gesperrt', async () => {
    const d = await b.oeffnen('lauf2', '/my/');
    expect(m.ajax).toContain('core_course_get_enrolled_courses_by_timeline_classification');
    expect(m.ajax).not.toContain('core_user_update_user_preferences');
    const ab = await b.klicken('lauf2', d.links.find((l) => l.text === 'Abmelden')!.nr);
    expect(ab.blockiert.join('\n')).toMatch(/Abmelden ist gesperrt|sesskey/);
    expect(m.aufrufe).not.toContain('GET /login/logout.php');
  });

  it('lädt Folien über die Moodle-Weiterleitung herunter; Bildschirmfoto als JPEG', async () => {
    const kurs = await b.oeffnen('lauf3', '/course/view.php?id=7');
    const d = await b.herunterladen('lauf3', kurs.links.find((l) => l.text === 'Folien Woche 1')!.nr);
    expect(d).toMatchObject({ name: 'folien1.pdf', mime: 'application/pdf' });
    expect(d.daten.equals(PDF)).toBe(true);
    const bild = await b.bild('lauf3');
    expect(bild.bild.slice(0, 4)).toBe('/9j/');
  });

  it('falsches Passwort und fehlende Zugangsdaten: klare Meldung', async () => {
    const falsch = new MoodleBrowser({ moodleUrl: basis, hosts: ['127.0.0.1'], benutzer: 'k12345678', passwort: 'falsch', executablePath });
    await expect(falsch.oeffnen('x', '/my/')).rejects.toThrow(/Anmeldung fehlgeschlagen.*Passwort falsch/);
    await falsch.beenden();
    const ohne = new MoodleBrowser({ moodleUrl: basis, hosts: ['127.0.0.1'], executablePath });
    await expect(ohne.oeffnen('x', '/my/')).rejects.toThrow(/Keine Moodle-Zugangsdaten/);
    await ohne.beenden();
  });

  it('Runner: nur mit Geheimnis; Fehler kommen als Meldung zurück', async () => {
    const server = runnerStarten({ port: 0, host: '127.0.0.1', geheimnis: 'g'.repeat(40), browser: b });
    await new Promise((r) => server.once('listening', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect(await (await fetch(`${url}/gesundheit`)).json()).toEqual({ ok: true, zugang: true });
    expect((await fetch(`${url}/oeffnen`, { method: 'POST', body: '{}' })).status).toBe(401);
    const h = { authorization: `Bearer ${'g'.repeat(40)}`, 'content-type': 'application/json' };
    const r = (await (await fetch(`${url}/oeffnen`, { method: 'POST', headers: h, body: JSON.stringify({ sitzung: 'r', url: '/course/view.php?id=7' }) })).json()) as { ok: boolean; titel: string };
    expect(r).toMatchObject({ ok: true, titel: 'Kurs: Computational Data Analytics' });
    const f = (await (await fetch(`${url}/klicken`, { method: 'POST', headers: h, body: JSON.stringify({ sitzung: 'r', nr: 999 }) })).json()) as { ok: boolean; fehler: string };
    expect(f).toMatchObject({ ok: false, fehler: expect.stringMatching(/Kein Eintrag \[999\]/) });
    await new Promise((r2) => server.close(r2));
  });
});
