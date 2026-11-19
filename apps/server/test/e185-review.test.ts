import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { apiMotor, type ModellKlient } from '../src/agenten/motor-api.js';
import { attrappe } from '../src/agenten/motor-attrappe.js';
import { motorenSetzen } from '../src/agenten/modelle.js';
import { WerkzeugKiste } from '../src/agenten/werkzeuge.js';
import { testDorf } from './hilfen.js';

/** Funde aus dem unabhängigen Review zu E185–E188 – jeder Test zeigt den Fehler in der Fassung davor. */
const w = (n: string, e: unknown) => `<<werkzeug ${n} ${JSON.stringify(e)}>>`;

async function dorf() {
  const d = await testDorf();
  const aufgabe = async (text: string, warten = true) => {
    const a = await d.schreibtisch.anlegen({ text, quelle: 'app' });
    await d.buergermeister.starten(a.id);
    if (warten) await d.agenten.leerlauf();
    const chatId = d.schreibtisch.holen(a.id).chatId!;
    return { id: a.id, chatId, chat: () => d.agenten.chatDetail(chatId), status: () => d.schreibtisch.holen(a.id).status };
  };
  const helferVon = (chatId: string) => d.agenten.chatListe().filter((c) => c.elternChatId === chatId);
  fs.writeFileSync(path.join(d.vault.wurzel, 'Uni/aktionen/test.md'), '---\nname: Test\neingaben:\n  - name: auftrag\n    typ: langtext\n---\n{auftrag}');
  return { ...d, aufgabe, helferVon };
}
const abschluesse = (c: { nachrichten: { rolle: string; text: string }[] }) => c.nachrichten.filter((n) => n.rolle === 'hinweis' && n.text.includes('Alle Helfer sind fertig')).map((n) => n.text);

describe('Review 1: jeder Helfer-Abschluss erreicht den Bürgermeister genau einmal', () => {
  it('ein später gestarteter Helfer, der endet, während der Bürgermeister schon weiterarbeitet, geht nicht verloren', async () => {
    const d = await dorf();
    const a = await d.aufgabe('Erst das [helfer Bibliothek|Erster Teil]');
    expect(a.status()).toBe('erledigt');
    expect(abschluesse(a.chat())).toHaveLength(1);
    // Leif schiebt nach: der Bürgermeister startet einen zweiten Helfer und arbeitet selbst noch weiter, während der fertig wird
    d.agenten.nachrichtSenden(a.chatId, 'Und noch das [helfer Uni|Zweiter Teil] [pause 300]');
    await d.agenten.leerlauf();
    const c = a.chat();
    const ab = abschluesse(c);
    expect(ab).toHaveLength(2);
    expect(ab[0]).toContain('Helfer: Erster Teil');
    expect(ab[0]).not.toContain('Zweiter Teil');
    // der zweite Abschluss nennt nur den zweiten Helfer – nichts doppelt
    expect(ab[1]).toContain('Helfer: Zweiter Teil');
    expect(ab[1]).not.toContain('Erster Teil');
    // und der Bürgermeister bekommt das Ergebnis (über die Warteschlange, weil er noch lief)
    const dorfLaeufe = c.laeufe.filter((l) => l.auftrag.includes('[Nachricht vom Dorf] Deine Helfer sind fertig'));
    expect(dorfLaeufe).toHaveLength(2);
    expect(dorfLaeufe[1]!.auftrag).toContain('### Helfer: Zweiter Teil (fertig)');
    expect(dorfLaeufe[1]!.auftrag).not.toContain('Erster Teil');
    expect(a.status()).toBe('erledigt');
    expect((d.db.prepare('SELECT COUNT(*) AS n FROM helfer_gemeldet').get() as { n: number }).n).toBe(2);
  });

  it('mehrere Einzelhelfer in einem Lauf: jeder steht in genau einem Abschluss, „erledigt“ erst wenn keiner mehr unterwegs ist', async () => {
    const d = await dorf();
    const a = await d.aufgabe('Drei [helfer Bibliothek|Schnell] [helfer Uni|Langsam {warte 250}] [helfer Rathaus|Mittel {warte 80}]');
    const ab = abschluesse(a.chat()).join('\n');
    for (const titel of ['Helfer: Schnell', 'Helfer: Langsam', 'Helfer: Mittel']) expect(ab.split(titel)).toHaveLength(2);
    const anBm = a.chat().laeufe.filter((l) => l.auftrag.includes('[Nachricht vom Dorf] Deine Helfer sind fertig')).map((l) => l.auftrag).join('\n');
    for (const titel of ['### Helfer: Schnell', '### Helfer: Langsam', '### Helfer: Mittel']) expect(anBm.split(titel)).toHaveLength(2);
    expect(a.status()).toBe('erledigt');
  });
});

describe('Review 2: die Grenzen (5 Helfer, 2 $) gelten je Aufgabe, nicht je Plan', () => {
  it('zwei kleine Pläne in einem Lauf: der zweite braucht Leifs Freigabe; Einzelhelfer zählen mit', async () => {
    const d = await dorf();
    const a = await d.aufgabe('Viel [los Bibliothek|A; Uni|B; Rathaus|C] [los Bibliothek|D; Uni|E; Rathaus|F]');
    expect(d.helferVon(a.chatId)).toHaveLength(3);
    const offen = d.agenten.freigaben.liste('offen');
    expect(offen).toMatchObject([{ art: 'plan_ausfuehren' }]);
    expect(a.chat().nachrichten.filter((n) => n.text.startsWith('plan_vorlegen:')).map((n) => n.text)[1]).toMatch(/so viele Helfer für eine Aufgabe bestätigt Leif/);
    // nach Leifs Ja laufen auch die drei weiteren
    await d.agenten.freigaben.entscheiden(offen[0]!.id, true);
    await d.agenten.leerlauf();
    expect(d.helferVon(a.chatId)).toHaveLength(6);
    // Einzelhelfer + Plan: 3 einzeln, dann ein Plan mit 3 → Freigabe; und nach einem 5er-Plan kein Einzelhelfer mehr ohne Leif
    const b = await d.aufgabe('Gemischt [helfer Bibliothek|1] [helfer Bibliothek|2] [helfer Bibliothek|3] [los Uni|4; Uni|5; Uni|6]');
    expect(d.helferVon(b.chatId)).toHaveLength(3);
    expect(d.agenten.freigaben.liste('offen')).toHaveLength(1);
    const c = await d.aufgabe(`Voll [los Uni|1; Uni|2; Uni|3; Uni|4; Uni|5] ${w('helfer_starten', { gebaeude: 'Bibliothek', auftrag: '6', stufe: 'klein' })}`);
    expect(d.helferVon(c.chatId)).toHaveLength(5);
    expect(c.chat().nachrichten.find((n) => n.text.startsWith('helfer_starten:'))!.text).toMatch(/schon 5 Helfer – mehr startet das Dorf nicht ohne Leif/);
  });
});

describe('Review 3: Ersetzen eines geschützten Skills braucht Leifs Freigabe; unbekannte Felder bleiben', () => {
  it('freigabe_vor_start lässt sich nicht ohne Klick entfernen; anhaenge und zeitplan_je bleiben erhalten', async () => {
    const d = await dorf();
    const pfad = 'Bibliothek/aktionen/teurer-lauf.md';
    const alt = '---\nname: Teurer Lauf\nfreigabe_vor_start: ja\nanhaenge:\n  - Bibliothek/gebaeude.md\n---\nAlte Anweisung, lang genug.\n';
    await d.vault.schreiben(pfad, alt);
    const entwurf = { gebaeude: 'Bibliothek', name: 'Teurer Lauf', anweisung: 'Neue Anweisung ohne Schutz.', werkzeuge: ['vault_lesen'], ersetzen: true };
    const a = await d.aufgabe(w('aktion_anlegen', entwurf));
    const t = a.chat().nachrichten.find((n) => n.rolle === 'werkzeug')!.text;
    expect(t).toMatch(/Die bisherige Fassung ist geschützt \(freigabe_vor_start\) – als Freigabe/);
    // nichts geschrieben, kein „Rückgängig“-Eintrag
    expect((await d.vault.lesen(pfad)).inhalt).toBe(alt);
    expect(d.agenten.rueckgaengig.liste()).toEqual([]);
    const [f] = d.agenten.freigaben.liste('offen');
    expect(f).toMatchObject({ art: 'aktion_anlegen', titel: 'Skill ersetzen: Teurer Lauf (Bibliothek)' });
    expect(f!.begruendung).toContain('freigabe_vor_start');
    // nach Leifs Ja: neue Anweisung – Schutz und Anhänge sind noch da
    await d.agenten.freigaben.entscheiden(f!.id, true);
    const neu = (await d.vault.lesen(pfad)).inhalt;
    expect(neu).toContain('Neue Anweisung ohne Schutz.');
    expect(neu).toMatch(/freigabe_vor_start: ['"]?ja/);
    expect(neu).toContain('- Bibliothek/gebaeude.md');
    const { aktionLaden } = await import('../src/agenten/aktionen.js');
    expect(await aktionLaden(d.vault, 'Bibliothek/teurer-lauf')).toMatchObject({ freigabeVorStart: true, anhaenge: ['Bibliothek/gebaeude.md'] });
    // ohne Schutz: direkt ersetzt, unbekannte Felder (anhaenge) bleiben trotzdem
    await d.vault.schreiben('Bibliothek/aktionen/harmlos.md', '---\nname: Harmlos\nanhaenge:\n  - Bibliothek/gebaeude.md\n---\nAlte Anweisung, lang genug.\n');
    const b = await d.aufgabe(w('aktion_anlegen', { ...entwurf, name: 'Harmlos' }));
    expect(b.chat().nachrichten.find((n) => n.rolle === 'werkzeug')!.text).toMatch(/^aktion_anlegen: Skill ersetzt/);
    expect((await aktionLaden(d.vault, 'Bibliothek/harmlos')).anhaenge).toEqual(['Bibliothek/gebaeude.md']);
    // alter Zeitplan (auch zeitplan_je) → ebenfalls Freigabe
    await d.vault.schreiben('Bibliothek/aktionen/morgens.md', '---\nname: Morgens\nzeitplan: täglich 06:00\n---\nAlte Anweisung, lang genug.\n');
    const c = await d.aufgabe(w('aktion_anlegen', { ...entwurf, name: 'Morgens' }));
    expect(c.chat().nachrichten.find((n) => n.rolle === 'werkzeug')!.text).toMatch(/geschützt \(zeitplan\) – als Freigabe/);
  });
});

describe('Review 4–6: die Warteschlange bleibt nie hängen und hält die Reihenfolge', () => {
  it('nach einem Neustart wird Wartendes übergeben (der Lauf davor gilt als fehlgeschlagen)', async () => {
    const d = await dorf();
    const { chatId, laufId } = await d.agenten.aktionStarten('Uni/test', { auftrag: 'x' });
    await d.agenten.leerlauf();
    // Zustand wie nach einem Deploy mitten im Lauf: Lauf „fehler“ (setzt der Konstruktor), Nachricht wartet noch
    d.db.prepare("UPDATE laeufe SET status = 'fehler' WHERE id = ?").run(laufId);
    d.db.prepare("INSERT INTO chat_warteschlange (chat_id, text, ausloeser, erstellt) VALUES (?, 'hängt seit dem Deploy', 'klick', 1)").run(chatId);
    d.agenten.nachStart();
    await d.agenten.leerlauf();
    const c = d.agenten.chatDetail(chatId);
    expect(c.wartend).toEqual([]);
    expect(c.laeufe.map((l) => [l.status, l.auftrag])).toEqual([
      ['fehler', 'x'],
      ['fertig', 'hängt seit dem Deploy'],
    ]);
  });

  it('abgelehnte „Aktion starten“-Freigabe: der Lauf ist abgebrochen, Wartendes kommt dran', async () => {
    const d = await dorf();
    fs.writeFileSync(path.join(d.vault.wurzel, 'Uni/aktionen/teuer.md'), '---\nname: Teuer\nfreigabe_vor_start: ja\n---\nMach was.');
    const { chatId } = await d.agenten.aktionStarten('Uni/teuer', {});
    expect(d.agenten.nachrichtSenden(chatId, 'lieber nur die kurze Fassung')).toEqual({ wartend: 1 });
    const [f] = d.agenten.freigaben.liste('offen');
    await d.agenten.freigaben.entscheiden(f!.id, false);
    await d.agenten.leerlauf();
    const c = d.agenten.chatDetail(chatId);
    expect(c.laeufe.map((l) => [l.status, l.auftrag.slice(0, 28)])).toEqual([
      ['abgebrochen', 'Mach was.'],
      ['fertig', 'lieber nur die kurze Fassung'],
    ]);
    expect(c.wartend).toEqual([]);
    // danach ist der Chat frei
    expect(d.agenten.nachrichtSenden(chatId, 'danke')).toEqual({ laufId: expect.any(String) });
    await d.agenten.leerlauf();
  });

  it('neue Nachricht überholt nichts: wartet noch Älteres (Lauf gerade zu Ende), gehen beide in dieser Reihenfolge in EINEN Lauf', async () => {
    const d = await dorf();
    const { chatId } = await d.agenten.aktionStarten('Uni/test', { auftrag: 'x' });
    await d.agenten.leerlauf();
    // das Fenster zwischen „Lauf fertig“ und „Schlange übergeben“: Älteres wartet, kein Lauf offen
    d.db.prepare("INSERT INTO chat_warteschlange (chat_id, text, ausloeser, erstellt) VALUES (?, 'zuerst geschrieben', 'klick', 1)").run(chatId);
    expect(d.agenten.nachrichtSenden(chatId, 'danach geschrieben')).toEqual({ laufId: expect.any(String) });
    await d.agenten.leerlauf();
    const c = d.agenten.chatDetail(chatId);
    expect(c.laeufe).toHaveLength(2);
    expect(c.laeufe[1]!.auftrag).toBe('Nachricht 1:\nzuerst geschrieben\n\n---\n\nNachricht 2:\ndanach geschrieben');
    expect(c.wartend).toEqual([]);
  });
});

describe('Review 5: Pläne mit Reihenfolge hängen nicht', () => {
  it('ein wartender Helfer wird abgebrochen → seine Nachfolger fallen aus, der Plan endet', async () => {
    const d = await dorf();
    // nur ein Lauf gleichzeitig: solange der Bürgermeister läuft, wartet Helfer 1
    await motorenSetzen(d.vault, { alleAuf: 'keiner', parallel: { 'claude-code': 1, api: 1 } });
    const a = await d.aufgabe('Kette [los Rathaus|Erst; Post|Dann|1] [pause 400]', false);
    // erst wenn plan_vorlegen ganz durch ist (sonst räumt dessen eigene Schlussprüfung den Abbruch noch mit auf)
    for (let i = 0; i < 200 && !a.chat().nachrichten.some((n) => n.text.startsWith('plan_vorlegen:')); i++) await new Promise((r) => setTimeout(r, 10));
    const helfer = d.helferVon(a.chatId);
    const lauf = d.agenten.chatDetail(helfer[0]!.id).laeufe[0]!;
    expect(lauf.status).toBe('wartend');
    d.agenten.abbrechen(lauf.id);
    await d.agenten.leerlauf();
    const plan = d.buergermeister.plaene()[0]!;
    expect(plan.status).toBe('fertig');
    expect(plan.helfer.map((h) => h.status)).toEqual(['abgebrochen']);
    expect(plan.uebersprungen).toEqual([{ nr: 2, grund: 'Teilaufgabe 1 („Erst“) ist nicht fertig geworden.' }]);
    expect(abschluesse(a.chat())).toHaveLength(1);
  });

  it('nach einem Neustart: ein Plan, dessen Helfer beim Neustart „fehler“ wurde, wird abgeschlossen; ungemeldete Einzelhelfer werden gemeldet', async () => {
    const d = await dorf();
    await motorenSetzen(d.vault, { alleAuf: 'keiner', parallel: { 'claude-code': 1, api: 1 } });
    const a = await d.aufgabe('Kette [los Rathaus|Erst; Post|Dann|1] [helfer Uni|Einzeln] [pause 300]', false);
    // warten, bis plan_vorlegen ganz durch ist (der Bürgermeister pausiert danach noch und hält den einzigen Platz besetzt)
    for (let i = 0; i < 200 && !a.chat().nachrichten.some((n) => n.text.startsWith('plan_vorlegen:')); i++) await new Promise((r) => setTimeout(r, 10));
    const helfer = d.helferVon(a.chatId);
    expect(helfer).toHaveLength(2);
    // wie nach einem Neustart: die Läufe der Helfer sind „fehler“, ohne dass je ein Laufende gemeldet wurde
    for (const h of helfer) d.db.prepare("UPDATE laeufe SET status = 'fehler', fehler = 'Server wurde während des Laufs neu gestartet.' WHERE chat_id = ?").run(h.id);
    await d.agenten.leerlauf(); // der Bürgermeister selbst wird fertig
    expect(d.buergermeister.plaene()[0]!.status).toBe('laeuft');
    await d.buergermeister.nachStart();
    await d.agenten.leerlauf();
    expect(d.buergermeister.plaene()[0]).toMatchObject({ status: 'fertig', uebersprungen: [{ nr: 2 }] });
    const ab = abschluesse(a.chat());
    expect(ab).toHaveLength(2); // einer für den Plan, einer für den Einzelhelfer
    expect(ab.filter((t) => t.includes('Helfer: Einzeln'))).toHaveLength(1);
    // ein zweiter Start meldet nichts doppelt
    await d.buergermeister.nachStart();
    await d.agenten.leerlauf();
    expect(abschluesse(a.chat())).toHaveLength(2);
  });
});

describe('Review 7: Nachschub ohne Antwort geht nicht verloren', () => {
  it('api-Motor: scheitert der Aufruf nach dem Nachschub, gibt es einen Folgelauf mit Leifs Nachtrag', async () => {
    let d: Awaited<ReturnType<typeof testDorf>> | undefined;
    let chat = '';
    let n = 0;
    const klient: ModellKlient = {
      async streamen() {
        n++;
        if (n === 1) {
          d!.agenten.nachrichtSenden(chat, 'Ach ja: bitte auf Englisch');
          return { id: 'm', type: 'message', role: 'assistant', model: 'x', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id: 't1', name: 'vault_liste', input: { pfad: '' }, caller: { type: 'direct' } }], stop_reason: 'tool_use' } as unknown as BetaMessage;
        }
        if (n === 2) throw new Error('API gerade nicht erreichbar');
        return { id: 'm', type: 'message', role: 'assistant', model: 'x', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: 'Sure.', citations: null }], stop_reason: 'end_turn' } as unknown as BetaMessage;
      },
    };
    d = await testDorf({ motoren: { api: apiMotor(() => klient), 'claude-code': attrappe('claude-code') } });
    fs.writeFileSync(path.join(d.vault.wurzel, 'Uni/aktionen/a.md'), '---\nname: A\nmotor: api\n---\nTu was.');
    chat = (await d.agenten.aktionStarten('Uni/a', {})).chatId;
    await d.agenten.leerlauf();
    const c = d.agenten.chatDetail(chat);
    expect(c.laeufe.map((l) => [l.status, l.auftrag])).toEqual([
      ['fehler', 'Tu was.'],
      ['fertig', 'Ach ja: bitte auf Englisch'],
    ]);
    expect(c.wartend).toEqual([]);
    expect(c.nachrichten.at(-1)).toMatchObject({ rolle: 'agent', text: 'Sure.' });
  });
});

describe('Review 8: Zurücknehmen überschreibt nichts von Leif und bleibt nach einem Fehler versuchbar', () => {
  it('Skill: hat Leif ihn seither bearbeitet, bleibt seine Fassung; passt die Datei wieder, klappt der zweite Versuch', async () => {
    const d = await dorf();
    const entwurf = { gebaeude: 'Bibliothek', name: 'Mail entwerfen', anweisung: 'Erste Fassung der Anweisung.', werkzeuge: ['vault_lesen'] };
    const pfad = 'Bibliothek/aktionen/mail-entwerfen.md';
    await d.aufgabe(w('aktion_anlegen', entwurf));
    await d.aufgabe(w('aktion_anlegen', { ...entwurf, anweisung: 'Zweite Fassung der Anweisung.', ersetzen: true }));
    const vomAgenten = (await d.vault.lesen(pfad)).inhalt;
    const [geaendert, angelegt] = d.agenten.rueckgaengig.liste();
    // Leif bearbeitet den Skill in Obsidian
    await d.vault.schreiben(pfad, vomAgenten.replace('Zweite Fassung', 'Leifs Fassung'));
    const r = await d.agenten.rueckgaengig.zuruecknehmen(geaendert!.id);
    expect(r).toMatchObject({ status: 'fehlgeschlagen', ergebnis: expect.stringMatching(/wurde seither geändert – nichts zurückgenommen/) });
    expect((await d.vault.lesen(pfad)).inhalt).toContain('Leifs Fassung');
    // auch „neu angelegt → Papierkorb“ räumt Leifs Fassung nicht weg
    expect((await d.agenten.rueckgaengig.zuruecknehmen(angelegt!.id)).status).toBe('fehlgeschlagen');
    expect(await d.vault.existiert(pfad)).toBe(true);
    // der Eintrag bleibt offen (mit Grund) – ein späterer Versuch ist möglich
    expect(d.agenten.rueckgaengig.holen(geaendert!.id)).toMatchObject({ status: 'offen', ergebnis: expect.stringMatching(/seither geändert/) });
    await d.vault.schreiben(pfad, vomAgenten);
    expect(await d.agenten.rueckgaengig.zuruecknehmen(geaendert!.id)).toMatchObject({ status: 'zurueckgenommen' });
    expect((await d.vault.lesen(pfad)).inhalt).toContain('Erste Fassung');
    await expect(d.agenten.rueckgaengig.zuruecknehmen(geaendert!.id)).rejects.toThrow(/schon zurückgenommen/);
  });
});

describe('Review 9: vault_aendern überschreibt keine gleichzeitige Änderung; der Fremdinhalt-Stempel lässt Frontmatter und Leifs Dateien in Ruhe', () => {
  it('ändert jemand die Datei zwischen Lesen und Schreiben, entsteht eine Konfliktkopie – kein Überschreiben, kein „Rückgängig“', async () => {
    const d = await dorf();
    const k = new WerkzeugKiste(d.db, d.uhr, d.vault, d.suche, d.agenten.freigaben, { laufId: 'l1', chatId: 'c1', gebaeude: 'Uni', erlaubt: ['vault_aendern'], rueckgaengig: d.agenten.rueckgaengig });
    await d.vault.schreiben('Uni/liste.md', '- eins\n');
    const lesen = d.vault.lesen.bind(d.vault);
    d.vault.lesen = async (p: string) => {
      const r = await lesen(p);
      if (p === 'Uni/liste.md') fs.writeFileSync(path.join(d.vault.wurzel, 'Uni/liste.md'), '- eins\n- von Leif\n'); // Leif speichert in Obsidian
      return r;
    };
    const r = await k.aufrufen('vault_aendern', { pfad: 'Uni/liste.md', anhaengen: '- vom Agenten' });
    d.vault.lesen = lesen;
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/wurde gerade von jemand anderem geändert – nichts überschrieben/);
    expect((await d.vault.lesen('Uni/liste.md')).inhalt).toBe('- eins\n- von Leif\n');
    expect(d.agenten.rueckgaengig.liste()).toEqual([]);
  });

  it('Stempel: nur eine Zeile kommt dazu, das Frontmatter bleibt Zeichen für Zeichen; bestehende Dateien werden nie gestempelt', async () => {
    const d = await dorf();
    const k = new WerkzeugKiste(d.db, d.uhr, d.vault, d.suche, d.agenten.freigaben, { laufId: 'l1', chatId: 'c1', gebaeude: 'Uni', erlaubt: ['vault_schreiben', 'vault_aendern', 'vault_lesen'], fremdinhalte: true, rueckgaengig: d.agenten.rueckgaengig });
    const kopf = '---\ntitel: "Übung: 3"\nerstellt: 2026-11-16\ntags: [uni, mathe]\nliste:\n  - a\n  - b\n---\n';
    await k.aufrufen('vault_schreiben', { pfad: 'Uni/2026-11-16_1200_neu.md', inhalt: `${kopf}Text\n` });
    expect((await d.vault.lesen('Uni/2026-11-16_1200_neu.md')).inhalt).toBe(`${kopf.replace(/---\n$/, 'fremdinhalt: true\n---\n')}Text\n`);
    // überschreibt der Chat seine eigene Datei, kommt kein zweiter Stempel dazu und nichts wird umgebaut
    await k.aufrufen('vault_schreiben', { pfad: 'Uni/2026-11-16_1200_neu.md', inhalt: `${kopf}Neuer Text\n` });
    expect((await d.vault.lesen('Uni/2026-11-16_1200_neu.md')).inhalt).toBe(`${kopf}Neuer Text\n`);
    // Leifs eigene Datei: vault_aendern hängt an – ohne sie als Fremdinhalt zu markieren, Frontmatter unverändert
    const leif = '---\ntitel: Meine Liste\nerstellt: 2026-11-01\ntags: [a, b]\n---\n- eins\n';
    await d.vault.schreiben('Uni/meine-liste.md', leif);
    expect((await k.aufrufen('vault_aendern', { pfad: 'Uni/meine-liste.md', anhaengen: '- zwei' })).ok).toBe(true);
    expect((await d.vault.lesen('Uni/meine-liste.md')).inhalt).toBe(`${leif}- zwei\n`);
  });
});
