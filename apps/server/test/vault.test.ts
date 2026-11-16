import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { VaultDienst, versionVon } from '../src/vault/dienst.js';
import { dateinameBereinigen, normalisieren } from '../src/vault/pfade.js';
import { TestUhr } from '../src/uhr.js';
import { tempOrdner } from './hilfen.js';

const neu = () => new VaultDienst(path.join(tempOrdner(), 'vault'), new TestUhr());

describe('Pfadregeln', () => {
  it('lässt nichts aus dem Vault hinaus', () => {
    expect(() => normalisieren('../etc/passwd')).toThrow(/hinaus/);
    expect(() => normalisieren('a/../../b')).toThrow(/hinaus/);
    expect(() => normalisieren('a/\u0000b')).toThrow(/Ungültige/);
    expect(() => normalisieren('.obsidian/app.json')).toThrow(/Versteckte/);
    expect(normalisieren('/Uni//faecher/./x.md')).toBe('Uni/faecher/x.md');
    expect(normalisieren('Uni\\faecher\\x.md')).toBe('Uni/faecher/x.md');
    expect(normalisieren('')).toBe('');
  });

  it('lehnt Symlinks ab, die aus dem Vault zeigen', async () => {
    const v = neu();
    const draussen = tempOrdner('draussen-');
    fs.writeFileSync(path.join(draussen, 'geheim.txt'), 'geheim');
    fs.symlinkSync(draussen, path.join(v.wurzel, 'link'));
    await expect(v.lesen('link/geheim.txt')).rejects.toThrow(/hinaus/);
    await expect(v.schreiben('link/neu.md', 'x')).rejects.toThrow(/hinaus/);
    expect(fs.existsSync(path.join(draussen, 'neu.md'))).toBe(false);
  });

  it('bereinigt Dateinamen für alle Systeme', () => {
    expect(dateinameBereinigen('Übung Nr. 3: Lösung?.pdf')).toBe('Uebung Nr. 3- Loesung-.pdf');
    expect(dateinameBereinigen('CON.txt')).toBe('datei-CON.txt');
    expect(dateinameBereinigen('...versteckt')).toBe('versteckt');
    expect(dateinameBereinigen('café.md')).toBe('cafe.md');
    expect(dateinameBereinigen('a'.repeat(300) + '.md').length).toBeLessThanOrEqual(120);
  });
});

describe('VaultDienst', () => {
  it('schreibt atomar und liest mit Version', async () => {
    const v = neu();
    const e = await v.schreiben('Uni/notiz.md', '# Hallo');
    expect(e).toMatchObject({ pfad: 'Uni/notiz.md', konflikt: false, version: versionVon('# Hallo') });
    const d = await v.lesen('Uni/notiz.md');
    expect(d.inhalt).toBe('# Hallo');
    expect(d.version).toBe(e.version);
    expect(fs.readdirSync(path.join(v.wurzel, 'Uni')).filter((n) => n.includes('dorf-tmp'))).toEqual([]);
  });

  it('überschreibt nie still: geänderte Datei → Konfliktkopie', async () => {
    const v = neu();
    const a = await v.schreiben('x.md', 'Fassung A');
    fs.writeFileSync(path.join(v.wurzel, 'x.md'), 'Fassung von Obsidian'); // Änderung von außen
    const b = await v.schreiben('x.md', 'Fassung B aus der App', { basisVersion: a.version });
    expect(b.konflikt).toBe(true);
    expect(b.konfliktPfad).toMatch(/^x\.konflikt-\d{8}-\d{6}\.md$/);
    expect(fs.readFileSync(path.join(v.wurzel, 'x.md'), 'utf8')).toBe('Fassung von Obsidian');
    expect(fs.readFileSync(path.join(v.wurzel, b.konfliktPfad!), 'utf8')).toBe('Fassung B aus der App');
    expect((await v.konflikte()).map((k) => [k.pfad, k.original, k.quelle])).toEqual([[b.konfliktPfad, 'x.md', 'dorf']]);
    // zweiter Konflikt in derselben Sekunde bekommt einen eigenen Namen
    const c = await v.schreiben('x.md', 'C', { basisVersion: a.version });
    expect(c.konfliktPfad).not.toBe(b.konfliktPfad);
  });

  it('erkennt Syncthing-Konflikte', async () => {
    const v = neu();
    fs.mkdirSync(path.join(v.wurzel, 'Uni'));
    fs.writeFileSync(path.join(v.wurzel, 'Uni/plan.sync-conflict-20261116-101010-ABCDEFG.md'), 'x');
    expect(await v.konflikte()).toMatchObject([{ original: 'Uni/plan.md', quelle: 'syncthing' }]);
  });

  it('nurNeu verhindert Überschreiben', async () => {
    const v = neu();
    await v.schreiben('a.md', '1');
    await expect(v.schreiben('a.md', '2', { nurNeu: true })).rejects.toThrow(/gibt es schon/);
  });

  it('löschen verschiebt in den Papierkorb', async () => {
    const v = neu();
    await v.schreiben('Post/eingang/mail.md', 'Inhalt');
    const ziel = await v.loeschen('Post/eingang/mail.md');
    expect(ziel).toMatch(/^\.papierkorb\/\d{8}-\d{6}\/Post\/eingang\/mail\.md$/);
    expect(fs.readFileSync(path.join(v.wurzel, ziel), 'utf8')).toBe('Inhalt');
    expect(await v.existiert('Post/eingang/mail.md')).toBe(false);
    await expect(v.loeschen('')).rejects.toThrow();
    const baum = await v.baum();
    expect(JSON.stringify(baum)).not.toContain('papierkorb');
  });

  it('verschieben schützt das Ziel', async () => {
    const v = neu();
    await v.schreiben('a.md', 'a');
    await v.schreiben('b.md', 'b');
    await expect(v.verschieben('a.md', 'b.md')).rejects.toThrow(/Ziel/);
    await v.ordnerAnlegen('Ordner');
    await expect(v.verschieben('Ordner', 'Ordner/unter')).rejects.toThrow(/sich selbst/);
    expect(await v.verschieben('a.md', 'Ordner/a.md')).toBe('Ordner/a.md');
  });

  it('hochladen bereinigt Namen und nummeriert Doppelte', async () => {
    const v = neu();
    expect(await v.hochladen('Uni', 'Folie Ä.pdf', Readable.from(Buffer.from('1')))).toBe('Uni/Folie Ae.pdf');
    expect(await v.hochladen('Uni', 'Folie Ä.pdf', Readable.from(Buffer.from('2')))).toBe('Uni/Folie Ae (2).pdf');
  });

  it('meldet Änderungen an Beobachter', async () => {
    const v = neu();
    const log: string[] = [];
    v.beobachten((p, a) => log.push(`${a}:${p}`));
    await v.schreiben('a.md', '1');
    await v.schreiben('a.md', '2');
    await v.loeschen('a.md');
    expect(log).toEqual(['angelegt:a.md', 'geaendert:a.md', 'geloescht:a.md']);
  });

  it('Vorlage: füllt nur leeren Vault, ergänzen überschreibt nie', async () => {
    const vorlage = tempOrdner('vorlage-');
    fs.mkdirSync(path.join(vorlage, 'Uni'));
    fs.writeFileSync(path.join(vorlage, 'Uni/gebaeude.md'), 'Vorlage');
    fs.writeFileSync(path.join(vorlage, 'Uni/.gitkeep'), '');
    const v = neu();
    expect(await v.ausVorlage(vorlage)).toBe(1);
    expect(fs.existsSync(path.join(v.wurzel, 'Uni/.gitkeep'))).toBe(false);
    fs.writeFileSync(path.join(v.wurzel, 'Uni/gebaeude.md'), 'Leifs Fassung');
    expect(await v.ausVorlage(vorlage)).toBe(0);
    expect(await v.ausVorlage(vorlage, { ergaenzen: true })).toBe(0);
    expect(fs.readFileSync(path.join(v.wurzel, 'Uni/gebaeude.md'), 'utf8')).toBe('Leifs Fassung');
  });
});
