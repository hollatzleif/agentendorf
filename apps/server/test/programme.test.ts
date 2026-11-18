import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { passwortSetzen } from '../src/auth/passwort.js';
import { cookieAus, ORIGIN, testDorf } from './hilfen.js';

describe('Programme für Mac und Windows (Etappe 6)', () => {
  it('ohne Programme: Übersicht leer, latest.json 204; mit Programmen: Download, Update-Datei mit eigener Adresse', async () => {
    const d = await testDorf();
    await passwortSetzen(d.db, d.uhr, 'ein-langes-test-passwort-1');
    const r = await d.app.inject({ method: 'POST', url: '/api/anmeldung', headers: { origin: ORIGIN }, payload: { passwort: 'ein-langes-test-passwort-1' } });
    const h = { origin: ORIGIN, cookie: cookieAus(r.headers['set-cookie']) };
    expect((await d.app.inject({ url: '/api/programme' })).statusCode).toBe(401);
    expect((await d.app.inject({ url: '/api/programme', headers: h })).json()).toEqual({ vorhanden: false });
    expect((await d.app.inject({ url: '/programme/latest.json' })).statusCode).toBe(204);

    const ordner = path.join(d.konfig.datenDir, 'programme');
    fs.mkdirSync(ordner, { recursive: true });
    fs.writeFileSync(path.join(ordner, 'Agentendorf_0.1.7_aarch64.dmg'), 'DMG');
    fs.writeFileSync(path.join(ordner, 'Agentendorf.app.tar.gz'), 'TGZ');
    fs.writeFileSync(path.join(ordner, 'Agentendorf_0.1.7_x64-setup.exe'), 'EXE');
    fs.writeFileSync(
      path.join(ordner, 'programme.json'),
      JSON.stringify({
        version: '0.1.7',
        erstellt: '2026-11-18T10:00:00Z',
        mac: { installer: 'Agentendorf_0.1.7_aarch64.dmg', update: 'Agentendorf.app.tar.gz', signatur: 'SIG-MAC' },
        windows: { installer: 'Agentendorf_0.1.7_x64-setup.exe', update: 'Agentendorf_0.1.7_x64-setup.exe', signatur: 'SIG-WIN' },
      }),
    );
    expect((await d.app.inject({ url: '/api/programme', headers: h })).json()).toEqual({
      vorhanden: true,
      version: '0.1.7',
      erstellt: '2026-11-18T10:00:00Z',
      mac: { datei: 'Agentendorf_0.1.7_aarch64.dmg', url: '/programme/datei/Agentendorf_0.1.7_aarch64.dmg' },
      windows: { datei: 'Agentendorf_0.1.7_x64-setup.exe', url: '/programme/datei/Agentendorf_0.1.7_x64-setup.exe' },
    });
    const u = (await d.app.inject({ url: '/programme/latest.json' })).json();
    expect(u).toMatchObject({
      version: '0.1.7',
      pub_date: '2026-11-18T10:00:00Z',
      platforms: {
        'darwin-aarch64': { signature: 'SIG-MAC', url: `${ORIGIN}/programme/datei/Agentendorf.app.tar.gz` },
        'windows-x86_64': { signature: 'SIG-WIN', url: `${ORIGIN}/programme/datei/Agentendorf_0.1.7_x64-setup.exe` },
      },
    });
    const dl = await d.app.inject({ url: '/programme/datei/Agentendorf_0.1.7_aarch64.dmg' });
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toBe('DMG');
    expect(dl.headers['content-disposition']).toContain('attachment');
    // nichts außerhalb des Ordners, kein Manifest, keine versteckten Dateien
    for (const n of ['programme.json', '..%2Fdorf.db', '.versteckt', '%2E%2E%2Fdorf.db']) expect((await d.app.inject({ url: `/programme/datei/${n}` })).statusCode).toBe(404);
  });
});
