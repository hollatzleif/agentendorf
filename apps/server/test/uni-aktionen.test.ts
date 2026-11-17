import { afterEach, describe, expect, it } from 'vitest';
import { passwortSetzen } from '../src/auth/passwort.js';
import { schreibenPruefen } from '../src/agenten/leine.js';
import { moodleKlient } from '../src/uni/moodle.js';
import { cookieAus, ORIGIN, testDorf } from './hilfen.js';
import { moodleAttrappe, TOKEN } from './moodle-attrappe.js';

const PW = 'ein-sehr-langes-Passwort-42';
const offen: { schliessen: () => Promise<void> }[] = [];
afterEach(async () => {
  while (offen.length) await offen.pop()!.schliessen();
});

async function angemeldet(mitMoodle = false) {
  let moodle;
  if (mitMoodle) {
    const m = await moodleAttrappe();
    offen.push(m);
    const jetzt = Math.floor(Date.UTC(2026, 10, 16, 12) / 1000);
    m.s.aufgaben[11] = [
      { id: 501, cmid: 106, course: 11, name: 'Übung 1', intro: '', duedate: jetzt + 86_400 },
      { id: 502, cmid: 107, course: 11, name: 'Übung 0', intro: '', duedate: jetzt + 3600 },
    ];
    m.s.abgegeben.add(502);
    moodle = moodleKlient(m.basis, TOKEN);
  }
  const d = await testDorf({ moodle });
  await passwortSetzen(d.db, d.uhr, PW);
  const r = await d.app.inject({ method: 'POST', url: '/api/anmeldung', headers: { origin: ORIGIN }, payload: { passwort: PW } });
  return { ...d, h: { origin: ORIGIN, cookie: cookieAus(r.headers['set-cookie']) } };
}

describe('HTML aus dem Vault (Lernzettel, Probeklausuren)', () => {
  it('wird abgeschottet ausgeliefert: Skripte ja, gleicher Ursprung nein, Netz nein', async () => {
    const d = await angemeldet();
    await d.vault.schreiben('Uni/lern.html', '<!doctype html><script>document.title="x"</script>');
    expect((await d.app.inject({ url: '/api/vault/seite?pfad=Uni/lern.html' })).statusCode).toBe(401);
    const r = await d.app.inject({ url: '/api/vault/seite?pfad=Uni/lern.html', headers: d.h });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    const csp = String(r.headers['content-security-policy']);
    expect(csp).toMatch(/^sandbox allow-scripts;/);
    expect(csp).not.toContain('allow-same-origin');
    expect(csp).not.toContain('allow-top-navigation');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toMatch(/https?:/);
    expect(r.body).toContain('<script>');
    // Nur .html; andere Dateien bleiben bei /api/vault/roh (dort ohne Skripte)
    await d.vault.schreiben('Uni/a.svg', '<svg/>');
    expect((await d.app.inject({ url: '/api/vault/seite?pfad=Uni/a.svg', headers: d.h })).statusCode).toBe(400);
    const roh = await d.app.inject({ url: '/api/vault/roh?pfad=Uni/lern.html', headers: d.h });
    expect(String(roh.headers['content-security-policy'])).toMatch(/^sandbox;/);
    expect(String(roh.headers['content-disposition'])).toMatch(/^attachment/);
  });

  it('Agenten dürfen .html im eigenen Gebäude anlegen – Schema bleibt Pflicht', () => {
    const p = (pfad: string) => schreibenPruefen({ gebaeude: 'Uni', pfad, existiert: false, vonDiesemChat: false });
    expect(p('Uni/faecher/CDA/lernsitzungen/2026-11-17_1400_lernzettel.html')).toBeNull();
    expect(p('Uni/faecher/CDA/lernsitzungen/lernzettel.html')).toMatch(/Schema/);
    expect(p('Uni/x/2026-11-17_1400_a.htm')).toMatch(/Schema/);
    expect(p('Bibliothek/2026-11-17_1400_a.html')).toMatch(/eigenen Gebäude/);
  });
});

describe('Aktions-Eingaben aus Moodle (quelle)', () => {
  const AKTION = `---
name: Testlernen
motor: api
stufe: klein
eingaben:
  - name: fach
    typ: auswahl
    quelle: uni.faecher
  - name: abgabe
    typ: auswahl
    quelle: uni.abgaben
    pflicht: nein
anhaenge: ["Uni/faecher/{fach}/kurs.md"]
---
Lerne {fach}. Abgabe: {abgabe}
`;

  it('liefert Kurse und offene Abgaben; beim Start zählt nur, was der Server anbietet', async () => {
    const d = await angemeldet(true);
    await d.vault.schreiben('Uni/aktionen/testlernen.md', AKTION);
    await d.uni.abgleichen();
    const faecher = (await d.app.inject({ url: '/api/aktionen/quelle?name=uni.faecher', headers: d.h })).json();
    expect(faecher).toEqual([
      { wert: 'Computational Data Analytics', beschriftung: 'Computational Data Analytics' },
      { wert: 'Statistik - UE', beschriftung: 'Statistik / UE' },
    ]);
    const abgaben = (await d.app.inject({ url: '/api/aktionen/quelle?name=uni.abgaben', headers: d.h })).json();
    expect(abgaben).toHaveLength(1); // Übung 0 ist abgegeben
    expect(abgaben[0]).toMatchObject({ wert: 'Computational Data Analytics/aufgaben/Uebung 1' });
    expect(abgaben[0].beschriftung).toMatch(/^Übung 1 – Computational Data Analytics \(Frist /);
    expect((await d.app.inject({ url: '/api/aktionen/quelle?name=boese', headers: d.h })).statusCode).toBe(400);

    const starten = (eingaben: Record<string, string>) =>
      d.app.inject({ method: 'POST', url: '/api/aktionen/starten', headers: d.h, payload: { id: 'Uni/testlernen', eingaben } });
    const falsch = await starten({ fach: '../Rathaus' });
    expect(falsch.statusCode).toBe(400);
    expect(falsch.json().fehler).toMatch(/nicht in uni\.faecher/);
    expect((await starten({ fach: 'Computational Data Analytics', abgabe: 'Computational Data Analytics/aufgaben/Uebung 0' })).statusCode).toBe(400);
    const ok = await starten({ fach: 'Computational Data Analytics' });
    expect(ok.statusCode).toBe(200);
    await d.agenten.leerlauf();
    const c = d.agenten.chatDetail(ok.json().chatId);
    expect(c.nachrichten[0]!.text).toContain('Lerne Computational Data Analytics.');
    expect(c.nachrichten[0]!.text).toContain('## Uni/faecher/Computational Data Analytics/kurs.md');
  });

  it('ohne Moodle: leere Auswahl, Start mit Phantasiewert abgelehnt', async () => {
    const d = await angemeldet(false);
    await d.vault.schreiben('Uni/aktionen/testlernen.md', AKTION);
    expect((await d.app.inject({ url: '/api/aktionen/quelle?name=uni.faecher', headers: d.h })).json()).toEqual([]);
    const r = await d.app.inject({ method: 'POST', url: '/api/aktionen/starten', headers: d.h, payload: { id: 'Uni/testlernen', eingaben: { fach: 'Irgendwas' } } });
    expect(r.statusCode).toBe(400);
  });
});
