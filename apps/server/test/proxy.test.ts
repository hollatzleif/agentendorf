import { describe, expect, it } from 'vitest';
import { passwortSetzen } from '../src/auth/passwort.js';
import { proxyVertrauen } from '../src/proxy.js';
import { ORIGIN, testDorf } from './hilfen.js';

const PW = 'ein-langes-test-passwort';

/**
 * E195: Der Coding-Container (und Werkstatt, Rechenraum, Browser) erreichen dorf:3000 direkt. Mit `trustProxy: true`
 * konnte von dort jede Anfrage eine andere Herkunft behaupten (X-Forwarded-For) – die Login-Drossel je IP griff nie.
 */
describe('X-Forwarded-For gilt nur vom vertrauten Proxy (E195)', () => {
  const CADDY = '172.20.0.2';
  const CODING = '172.21.0.7';
  async function dorf() {
    const d = await testDorf({ env: { HINTER_PROXY: 'true', VERTRAUTER_PROXY: CADDY } });
    await passwortSetzen(d.db, d.uhr, PW);
    const versuch = (von: string, xff: string, pw = 'falsch') =>
      d.app.inject({ method: 'POST', url: '/api/anmeldung', remoteAddress: von, headers: { origin: ORIGIN, 'x-forwarded-for': xff }, payload: { passwort: pw } });
    const ips = () => (d.db.prepare('SELECT DISTINCT ip FROM login_versuche ORDER BY ip').all() as { ip: string }[]).map((x) => x.ip);
    return { ...d, versuch, ips };
  }

  it('aus dem Coding-Container: gefälschte Herkunft zählt nicht – nach 5 Fehlversuchen ist Schluss, egal was im Kopf steht', async () => {
    const d = await dorf();
    for (let i = 0; i < 5; i++) expect((await d.versuch(CODING, `203.0.113.${i + 1}`)).statusCode).toBe(401);
    expect((await d.versuch(CODING, '203.0.113.99')).statusCode).toBe(429);
    expect(d.ips()).toEqual([CODING]);
    // Leif (über Caddy, andere Adresse) ist davon nicht ausgesperrt
    expect((await d.versuch(CADDY, '198.51.100.20', PW)).statusCode).toBe(200);
    await d.app.close();
  });

  it('über Caddy: die Herkunft aus X-Forwarded-For zählt (je Besucher eine eigene Drossel)', async () => {
    const d = await dorf();
    for (let i = 0; i < 5; i++) expect((await d.versuch(CADDY, '198.51.100.7')).statusCode).toBe(401);
    expect((await d.versuch(CADDY, '198.51.100.7')).statusCode).toBe(429);
    expect((await d.versuch(CADDY, '198.51.100.8')).statusCode).toBe(401);
    expect(d.ips()).toEqual(['198.51.100.7', '198.51.100.8']);
    // ein Besucher kann sich über Caddy nicht selbst eine Kette vorsetzen, die tiefer reicht: es zählt die letzte Adresse vor Caddy
    await d.versuch(CADDY, '1.1.1.1, 198.51.100.9');
    expect(d.ips()).toContain('198.51.100.9');
    expect(d.ips()).not.toContain('1.1.1.1');
    await d.app.close();
  });

  it('HINTER_PROXY ohne VERTRAUTER_PROXY: nur der eigene Rechner; ohne HINTER_PROXY niemand', async () => {
    const d = await testDorf({ env: { HINTER_PROXY: 'true' } });
    await passwortSetzen(d.db, d.uhr, PW);
    await d.app.inject({ method: 'POST', url: '/api/anmeldung', remoteAddress: '10.9.9.9', headers: { origin: ORIGIN, 'x-forwarded-for': '203.0.113.5' }, payload: { passwort: 'x' } });
    await d.app.inject({ method: 'POST', url: '/api/anmeldung', remoteAddress: '127.0.0.1', headers: { origin: ORIGIN, 'x-forwarded-for': '203.0.113.6' }, payload: { passwort: 'x' } });
    expect((d.db.prepare('SELECT ip FROM login_versuche ORDER BY id').all() as { ip: string }[]).map((x) => x.ip)).toEqual(['10.9.9.9', '203.0.113.6']);
    await d.app.close();
    const d2 = await testDorf();
    await passwortSetzen(d2.db, d2.uhr, PW);
    await d2.app.inject({ method: 'POST', url: '/api/anmeldung', remoteAddress: '127.0.0.1', headers: { origin: ORIGIN, 'x-forwarded-for': '203.0.113.6' }, payload: { passwort: 'x' } });
    expect((d2.db.prepare('SELECT ip FROM login_versuche').all() as { ip: string }[]).map((x) => x.ip)).toEqual(['127.0.0.1']);
    await d2.app.close();
  });

  it('Namen (caddy) werden aufgelöst und erneuert: neue Adresse nach Neustart gilt, die alte nicht mehr; unauflösbar = niemand', async () => {
    let adressen: string[] | Error = ['172.20.0.2', '172.21.0.2'];
    let zeit = 0;
    const p = proxyVertrauen(['caddy', '10.0.0.1'], {
      aufloesen: async () => {
        if (adressen instanceof Error) throw adressen;
        return adressen;
      },
      intervallMs: 3_600_000,
      jetzt: () => zeit,
    });
    expect(p.pruefen('172.20.0.2')).toBe(false); // noch nicht aufgelöst → lieber nicht trauen
    await p.erneuern();
    expect(p.pruefen('172.20.0.2')).toBe(true);
    expect(p.pruefen('::ffff:172.21.0.2')).toBe(true);
    expect(p.pruefen('10.0.0.1')).toBe(true);
    expect(p.pruefen('172.21.0.7')).toBe(false);
    // Caddy startet neu und bekommt eine andere Adresse: die erste Anfrage von dort stößt das Nachsehen an
    adressen = ['172.20.0.9'];
    zeit += 5000;
    expect(p.pruefen('172.20.0.9')).toBe(false);
    await p.erneuern();
    expect(p.pruefen('172.20.0.9')).toBe(true);
    expect(p.pruefen('172.20.0.2')).toBe(false);
    adressen = new Error('ENOTFOUND');
    await p.erneuern();
    expect(p.pruefen('172.20.0.9')).toBe(false);
    expect(p.pruefen('10.0.0.1')).toBe(true);
    p.stoppen();
  });
});
