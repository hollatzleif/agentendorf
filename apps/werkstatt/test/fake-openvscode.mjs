#!/usr/bin/env node
// Nachgebautes openvscode-server für die Erweiterungs-Befehle (E205). Ausgaben und Rückgabewerte wie das Original
// (geprüft gegen openvscode-server 1.109.5): --list-extensions --show-versions · --install-extension <id|datei> --force ·
// --uninstall-extension <id>. Jeder Aufruf wird mit Argumenten und den Namen der Umgebungsvariablen in FAKE_LOG vermerkt.
import fs from 'node:fs';
import path from 'node:path';
const a = process.argv.slice(2);
const wert = (f) => (a.includes(f) ? a[a.indexOf(f) + 1] : undefined);
const daten = wert('--server-data-dir');
if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ args: a, umgebung: Object.keys(process.env).sort() })}\n`);
if (!daten) {
  console.error('--server-data-dir fehlt');
  process.exit(2);
}
fs.mkdirSync(daten, { recursive: true });
const standDatei = path.join(daten, 'fake-erweiterungen.json');
const stand = fs.existsSync(standDatei) ? JSON.parse(fs.readFileSync(standDatei, 'utf8')) : {};
const sichern = () => fs.writeFileSync(standDatei, JSON.stringify(stand));
// zwei Aufrufe gleichzeitig? (der Runner muss sie nacheinander ausführen)
const sperre = path.join(daten, 'fake-sperre');
try {
  fs.writeFileSync(sperre, String(process.pid), { flag: 'wx' });
} catch {
  fs.writeFileSync(path.join(daten, 'fake-ueberlappt'), 'ja');
}
const ende = (code) => {
  fs.rmSync(sperre, { force: true });
  process.exit(code);
};
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

if (a.includes('--list-extensions')) {
  for (const [id, v] of Object.entries(stand)) console.log(a.includes('--show-versions') ? `${id}@${v}` : id);
  ende(0);
}
const inst = wert('--install-extension');
if (inst !== undefined) {
  console.log('Installing extensions...');
  await warte(150);
  if (inst === 'haengt.fuer-immer') {
    fs.rmSync(sperre, { force: true });
    await warte(600_000);
  }
  if (inst.startsWith('/')) {
    // VSIX-Datei: muss existieren und ein ZIP sein
    const kopf = fs.readFileSync(inst).subarray(0, 4).toString('latin1');
    if (kopf !== 'PK\u0003\u0004') {
      console.error(`Error: ${inst} is not a VSIX`);
      ende(1);
    }
    stand['lokal.aus-vsix'] = '0.0.1';
    sichern();
    console.log(`Extension '${path.basename(inst)}' was successfully installed.`);
    ende(0);
  }
  const [id, version] = inst.split('@');
  if (id.startsWith('gibts.')) {
    console.error(`Extension '${id}' not found.\nMake sure you use the full extension ID, including the publisher, e.g.: ms-dotnettools.csharp\nFailed Installing Extensions: ${id}`);
    ende(1);
  }
  stand[id] = version ?? '9.9.9';
  sichern();
  console.log(`Installing extension '${id}'...\n\u001b[32mExtension '${id}' v${stand[id]} was successfully installed.\u001b[0m`);
  ende(0);
}
const weg = wert('--uninstall-extension');
if (weg !== undefined) {
  if (!(weg in stand)) {
    console.error(`Extension '${weg}' is not installed.\nMake sure you use the full extension ID, including the publisher, e.g.: ms-dotnettools.csharp`);
    ende(1);
  }
  delete stand[weg];
  sichern();
  console.log(`Uninstalling ${weg}...\nExtension '${weg}' was successfully uninstalled!`);
  ende(0);
}
console.error('unbekannter Aufruf');
ende(2);
