import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { VaultDienst } from '../src/vault/dienst.js';
import { Suchindex } from '../src/vault/suche.js';
import { gebaeudeListe } from '../src/vault/gebaeude.js';
import { DateiVerstehen } from '../src/agenten/anhaenge.js';
import { vaultBefund } from '../src/rundgang.js';
import { dbOeffnen } from '../src/db.js';
import { TestUhr } from '../src/uhr.js';
import { tempOrdner } from './hilfen.js';

/**
 * E195: Seit dem Codehaus (E191) schreibt ein Agent mit Shell in den Vault. Er kann eine Datei oder einen Ordner
 * jederzeit gegen einen Symlink tauschen – auch zwischen Prüfung und Zugriff. Kein Leseweg des Dorfs darf dem folgen
 * (sonst läse das Dorf z. B. /proc/self/environ mit allen Schlüsseln), kein Schreibweg darf draußen landen.
 */
const GEHEIM = 'GEHEIM-ANTHROPIC_API_KEY=sk-nicht-fuer-agenten';

function aufbau() {
  const basis = tempOrdner();
  const draussen = path.join(basis, 'draussen');
  fs.mkdirSync(draussen);
  fs.writeFileSync(path.join(draussen, 'geheim.md'), GEHEIM);
  fs.writeFileSync(path.join(draussen, 'gebaeude.md'), `---\nname: ${GEHEIM}\n---\n`);
  const v = new VaultDienst(path.join(basis, 'vault'), new TestUhr());
  return { v, draussen, geheim: path.join(draussen, 'geheim.md') };
}

const kinder: ChildProcess[] = [];
afterEach(() => {
  for (const k of kinder.splice(0)) k.kill('SIGKILL');
});

/** Eigener Prozess, der `pfad` pausenlos zwischen echter Datei/echtem Ordner und einem Symlink auf `ziel` tauscht. */
async function tauscher(pfad: string, ziel: string, art: 'datei' | 'ordner') {
  const skript = `
    const fs = require('node:fs');
    const [p, ziel, art] = process.argv.slice(1);
    const echt = p + '.echt', link = p + '.link';
    process.stdout.write('los\\n');
    for (;;) {
      try {
        if (art === 'datei') {
          fs.symlinkSync(ziel, link); fs.renameSync(link, p);           // Datei → Symlink (atomar)
          fs.writeFileSync(echt, 'harmlos'); fs.renameSync(echt, p);    // Symlink → Datei (atomar)
        } else {
          fs.renameSync(p, echt); fs.symlinkSync(ziel, p);              // Ordner → Symlink
          fs.unlinkSync(p); fs.renameSync(echt, p);                     // Symlink → Ordner
        }
      } catch {
        // das Dorf hat dazwischengefunkt (z. B. den Ordner neu angelegt) – wieder in einen sauberen Zustand
        try { if (fs.lstatSync(p).isSymbolicLink()) fs.unlinkSync(p); } catch {}
        try { fs.rmSync(echt, { recursive: true, force: true }); } catch {}
        try { fs.rmSync(link, { force: true }); } catch {}
        if (art === 'ordner') { try { fs.mkdirSync(p); } catch {} }
      }
    }`;
  const k = spawn(process.execPath, ['-e', skript, pfad, ziel, art], { stdio: ['ignore', 'pipe', 'ignore'] });
  kinder.push(k);
  await new Promise((r) => k.stdout!.once('data', r));
  return k;
}

const strom = async (s: NodeJS.ReadableStream) => {
  const t: Buffer[] = [];
  for await (const c of s) t.push(c as Buffer);
  return Buffer.concat(t).toString('utf8');
};

describe('Symlinks im Vault werden nie verfolgt (E195)', () => {
  it('Symlink auf eine Datei außerhalb: kein Leseweg liefert den Inhalt', async () => {
    const { v, geheim } = aufbau();
    fs.mkdirSync(path.join(v.wurzel, 'Codehaus'));
    fs.symlinkSync(geheim, path.join(v.wurzel, 'Codehaus/x.md'));
    fs.symlinkSync('/proc/self/environ', path.join(v.wurzel, 'Codehaus/umgebung.md'));
    for (const p of ['Codehaus/x.md', 'Codehaus/umgebung.md']) {
      await expect(v.lesen(p)).rejects.toThrow(/hinaus/);
      expect(() => v.rohOeffnen(p)).toThrow(/hinaus/);
      await expect(v.puffer(p)).rejects.toThrow(/hinaus/);
      expect(v.statJetzt(p)).toBeNull();
    }
    expect((await v.namen('Codehaus')).map((n) => n.name)).toEqual([]);
    expect((await v.baum('Codehaus')).kinder).toEqual([]);
    const dateien: string[] = [];
    for await (const d of v.alleDateien()) dateien.push(d.rel);
    expect(dateien).toEqual([]);
    // Suchindex, Datei-Verstehen (Anhänge, vault_lesen für andere Formate), Rundgang
    const db = dbOeffnen(path.join(tempOrdner(), 'dorf.db'));
    const suche = new Suchindex(db, v);
    await suche.aktualisieren('Codehaus/x.md');
    await suche.vollIndex();
    expect(JSON.stringify(db.prepare('SELECT * FROM suche').all())).not.toContain('GEHEIM');
    const verstehen = new DateiVerstehen(v, () => undefined);
    expect(JSON.stringify(await verstehen.verstehen('Codehaus/x.md', { pdfNativ: true, bildNativ: true }))).not.toContain('GEHEIM');
    expect(JSON.stringify(await vaultBefund(v))).not.toContain('GEHEIM');
    db.close();
  });

  it('Symlink auf einen Ordner außerhalb: weder lesen noch auflisten noch hineinschreiben, -verschieben, -hochladen', async () => {
    const { v, draussen } = aufbau();
    fs.symlinkSync(draussen, path.join(v.wurzel, 'Link'));
    await v.schreiben('Echt/a.md', 'a');
    await expect(v.lesen('Link/geheim.md')).rejects.toThrow(/hinaus/);
    expect(() => v.rohOeffnen('Link/geheim.md')).toThrow(/hinaus/);
    expect(await v.namen('Link').catch(() => [])).toEqual([]);
    expect((await v.baum('')).kinder!.map((k) => k.name)).toEqual(['Echt']);
    // ein Gebäude, das nur ein Symlink ist, gibt es nicht (gebaeude.md von draußen würde sonst gelesen)
    expect(JSON.stringify(await gebaeudeListe(v))).not.toContain('GEHEIM');
    await expect(v.schreiben('Link/neu.md', 'x')).rejects.toThrow(/hinaus/);
    await expect(v.ordnerAnlegen('Link/unter/ordner')).rejects.toThrow(/hinaus/);
    await expect(v.verschieben('Echt/a.md', 'Link/a.md')).rejects.toThrow(/hinaus/);
    await expect(v.hochladen('Link', 'h.txt', Readable.from(['x']))).rejects.toThrow(/hinaus/);
    await expect(v.loeschen('Link/geheim.md')).rejects.toThrow(/hinaus/);
    expect(fs.readdirSync(draussen).sort()).toEqual(['gebaeude.md', 'geheim.md']);
    // überschreiben einer Datei, die ein Symlink ist: der Symlink wird ersetzt, das Ziel draußen bleibt unberührt
    fs.symlinkSync(path.join(draussen, 'geheim.md'), path.join(v.wurzel, 'Echt/b.md'));
    await v.schreiben('Echt/b.md', 'neu').catch(() => undefined);
    expect(fs.readFileSync(path.join(draussen, 'geheim.md'), 'utf8')).toBe(GEHEIM);
    // der Symlink selbst lässt sich in den Papierkorb legen (er wird bewegt, nicht verfolgt)
    await v.loeschen('Link');
    expect(fs.existsSync(path.join(draussen, 'geheim.md'))).toBe(true);
  });

  it('Wettlauf beim Lesen: Datei wird pausenlos gegen einen Symlink getauscht – das Geheimnis kommt nie heraus', async () => {
    const { v, geheim } = aufbau();
    await v.schreiben('Codehaus/x.md', 'harmlos');
    await tauscher(path.join(v.wurzel, 'Codehaus/x.md'), geheim, 'datei');
    const verstehen = new DateiVerstehen(v, () => undefined);
    let gelesen = 0;
    let abgewiesen = 0;
    const ende = Date.now() + 2500;
    while (Date.now() < ende) {
      for (const lesen of [
        async () => (await v.lesen('Codehaus/x.md')).inhalt,
        async () => strom(v.rohOeffnen('Codehaus/x.md').strom),
        async () => (await v.puffer('Codehaus/x.md'))?.inhalt.toString('utf8') ?? '',
        async () => JSON.stringify(await verstehen.verstehen('Codehaus/x.md', { pdfNativ: false, bildNativ: false })),
      ]) {
        try {
          const t = await lesen();
          expect(t).not.toContain('GEHEIM');
          gelesen++;
        } catch (e) {
          if (!/hinaus|nicht gefunden/i.test((e as Error).message)) throw e;
          abgewiesen++;
        }
      }
    }
    // der Tauscher hat wirklich getauscht: beide Zustände kamen vor
    expect(gelesen).toBeGreaterThan(5);
    expect(abgewiesen).toBeGreaterThan(5);
  }, 20_000);

  it('Wettlauf beim Schreiben: Ordner wird pausenlos gegen einen Symlink getauscht – draußen entsteht nie eine Datei', async () => {
    const { v, draussen } = aufbau();
    const ziel = path.join(draussen, 'ziel');
    fs.mkdirSync(ziel);
    await v.schreiben('Codehaus/ord/start.md', 'x');
    await tauscher(path.join(v.wurzel, 'Codehaus/ord'), ziel, 'ordner');
    let geschrieben = 0;
    let abgewiesen = 0;
    const ende = Date.now() + 2500;
    for (let i = 0; Date.now() < ende; i++) {
      for (const tun of [
        () => v.schreiben(`Codehaus/ord/s${i}.md`, 'inhalt'),
        () => v.hochladen('Codehaus/ord', `h${i}.txt`, Readable.from(['inhalt'])),
        () => v.ordnerAnlegen(`Codehaus/ord/o${i}`),
      ]) {
        try {
          await tun();
          geschrieben++;
        } catch {
          abgewiesen++;
        }
      }
    }
    expect(fs.readdirSync(ziel)).toEqual([]);
    expect(geschrieben).toBeGreaterThan(5);
    expect(abgewiesen).toBeGreaterThan(5);
  }, 20_000);
});
