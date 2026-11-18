import { describe, expect, it } from 'vitest';
import { passwortSetzen } from '../src/auth/passwort.js';
import { cookieAus, ORIGIN, testDorf } from './hilfen.js';

const PW = 'ein-langes-test-passwort-1';
export async function kopf(d: Awaited<ReturnType<typeof testDorf>>) {
  await passwortSetzen(d.db, d.uhr, PW);
  const r = await d.app.inject({ method: 'POST', url: '/api/anmeldung', headers: { origin: ORIGIN }, payload: { passwort: PW } });
  return { origin: ORIGIN, cookie: cookieAus(r.headers['set-cookie']) };
}

describe('Etappe 7a: Gebäude anlegen und eröffnen', () => {
  it('neues Gebäude: Ordner + gebaeude.md + aktionen/, erscheint in der Liste und im Dorfplan; doppelt → 409', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const r = await d.app.inject({ method: 'POST', url: '/api/gebaeude', headers: h, payload: { name: 'Fitness Studio', symbol: '🏋️', beschreibung: 'Training und Ernährung' } });
    expect(r.json()).toEqual({ id: 'Fitness-Studio' });
    expect(await d.vault.existiert('Fitness-Studio/aktionen')).toBe(true);
    const g = ((await d.app.inject({ url: '/api/gebaeude', headers: h })).json() as { id: string; status: string; symbol: string; name: string }[]).find((x) => x.id === 'Fitness-Studio');
    expect(g).toMatchObject({ name: 'Fitness Studio', symbol: '🏋️', status: 'offen' });
    const plan = (await d.app.inject({ url: '/api/dorf', headers: h })).json() as { layout: { gebaeude: Record<string, unknown> } };
    expect(plan.layout.gebaeude['Fitness-Studio']).toBeTruthy();
    expect((await d.app.inject({ method: 'POST', url: '/api/gebaeude', headers: h, payload: { name: 'fitness studio' } })).statusCode).toBe(409);
    expect((await d.app.inject({ method: 'POST', url: '/api/gebaeude', headers: h, payload: { name: '..' } })).statusCode).toBe(400);
  });

  it('eröffnen, umbenennen, schließen; Rathaus bleibt offen; Text der Arbeitsanweisung bleibt erhalten', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    await d.vault.schreiben('Werkstatt/gebaeude.md', '---\nname: Werkstatt\nstatus: geschlossen\nbeschreibung: Noch nicht eröffnet\n---\n# Werkstatt\n\nMein Text.\n');
    const r = await d.app.inject({ method: 'PATCH', url: '/api/gebaeude/Werkstatt', headers: h, payload: { status: 'offen', symbol: '🔧' } });
    expect(r.json()).toMatchObject({ id: 'Werkstatt', status: 'offen', symbol: '🔧', beschreibung: '' });
    expect((await d.vault.lesen('Werkstatt/gebaeude.md')).inhalt).toContain('Mein Text.');
    expect((await d.app.inject({ method: 'PATCH', url: '/api/gebaeude/Rathaus', headers: h, payload: { status: 'geschlossen' } })).statusCode).toBe(400);
    expect((await d.app.inject({ method: 'PATCH', url: '/api/gebaeude/Gibtsnicht', headers: h, payload: { status: 'offen' } })).statusCode).toBe(404);
  });
});

describe('Etappe 7b: Einkaufsladen', () => {
  it('ist offen; Skills Essensplan (so 17:00, Ablage) und Preisvergleich (Internet, ohne Fremdinhalte) sind fehlerfrei', async () => {
    const d = await testDorf();
    const { gebaeudeListe } = await import('../src/vault/gebaeude.js');
    const { aktionenListe } = await import('../src/agenten/aktionen.js');
    expect((await gebaeudeListe(d.vault)).find((g) => g.id === 'Einkaufsladen')).toMatchObject({ status: 'offen' });
    const a = await aktionenListe(d.vault);
    expect(a.find((x) => x.id === 'Einkaufsladen/essensplan')).toMatchObject({ zeitplan: 'so 17:00', ablage: 'Einkaufsladen/00_Essensplan.md', fremdinhalte: true });
    expect(a.find((x) => x.id === 'Einkaufsladen/essensplan')!.fehler).toBeUndefined();
    const p = a.find((x) => x.id === 'Einkaufsladen/preisvergleich')!;
    expect(p.fehler).toBeUndefined();
    expect(p).toMatchObject({ fremdinhalte: false });
    expect(p.werkzeuge).toContain('web');
    expect(await d.vault.existiert('Einkaufsladen/einstellungen.md')).toBe(true);
  });
});
