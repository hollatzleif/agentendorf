import { describe, expect, it } from 'vitest';
import { AUSSEHEN_STANDARD } from '@dorf/shared';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

/** E224: Aussehen – speichern, prüfen (Zod), Standardwerte auffüllen, kein Nachladen von außen im eigenen CSS, Live-Ereignis */
describe('Aussehen (E224)', () => {
  it('Standard, speichern, auffüllen, ungültig, CSS ohne url()/@import', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    expect((await d.app.inject({ url: '/api/aussehen', headers: h })).json()).toEqual(AUSSEHEN_STANDARD);
    const ereignisse: string[] = [];
    const senden = d.hub.senden.bind(d.hub);
    d.hub.senden = (e) => {
      ereignisse.push(e.typ);
      senden(e);
    };
    const r = await d.app.inject({ method: 'PUT', url: '/api/aussehen', headers: h, payload: { vorlage: 'nacht', groesse: 18, farben: { akzent: '#ff0000' }, css: '.kopf { color: red; }' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ vorlage: 'nacht', groesse: 18, farben: { akzent: '#ff0000' }, dichte: 'normal', schatten: 'spiel' });
    expect((await d.app.inject({ url: '/api/aussehen', headers: h })).json()).toMatchObject({ vorlage: 'nacht', groesse: 18 });
    expect(ereignisse).toContain('aussehen.geaendert');
    for (const schlecht of [{ vorlage: 'gibtsnicht' }, { groesse: 40 }, { farben: { akzent: 'rot' } }, { farben: { unbekannt: '#000000' } }, { css: '@import "https://x.example/a.css";' }, { css: 'body { background: url(https://x.example/a.png) }' }, { fremd: 1 }]) {
      const x = await d.app.inject({ method: 'PUT', url: '/api/aussehen', headers: h, payload: schlecht });
      expect(x.statusCode, JSON.stringify(schlecht)).toBe(400);
    }
    // Meine Looks
    expect((await d.app.inject({ url: '/api/aussehen/looks', headers: h })).json()).toEqual([]);
    const l = await d.app.inject({ method: 'PUT', url: '/api/aussehen/looks', headers: h, payload: [{ name: 'Abends', aussehen: { vorlage: 'mitternacht' } }] });
    expect(l.statusCode).toBe(200);
    expect(l.json()[0]).toMatchObject({ name: 'Abends', aussehen: { vorlage: 'mitternacht', groesse: 16 } });
    expect((await d.app.inject({ method: 'PUT', url: '/api/aussehen/looks', headers: h, payload: [{ name: '', aussehen: {} }] })).statusCode).toBe(400);
    expect((await d.app.inject({ method: 'PUT', url: '/api/aussehen/looks', headers: h, payload: Array.from({ length: 21 }, (_, i) => ({ name: `L${i}`, aussehen: {} })) })).statusCode).toBe(400);
    // ohne Sitzung nichts
    expect((await d.app.inject({ url: '/api/aussehen' })).statusCode).toBe(401);
  });
});
