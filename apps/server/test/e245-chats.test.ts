import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cookieAus, ORIGIN, testDorf } from './hilfen.js';
import { passwortSetzen } from '../src/auth/passwort.js';
import { auftragAnzeige } from '../src/agenten/dienst.js';

/**
 * E245: Die Arbeitsanweisung einer Aktion geht unverändert ans Modell, die App zeigt nur Leifs Eingabe (`anzeige`);
 * „Letzte Chats“: die 5 Chats mit der jüngsten Nachricht von Leif oder einem Modell, über alle Gebäude, ohne System-Chats.
 */
async function kopf(d: Awaited<ReturnType<typeof testDorf>>) {
  await passwortSetzen(d.db, d.uhr, 'e245-Passwort-sehr-lang');
  const r = await d.app.inject({ method: 'POST', url: '/api/anmeldung', headers: { origin: ORIGIN }, payload: { passwort: 'e245-Passwort-sehr-lang' } });
  return { origin: ORIGIN, cookie: cookieAus(r.headers['set-cookie']) };
}

async function dorf() {
  const d = await testDorf();
  fs.writeFileSync(
    path.join(d.vault.wurzel, 'Uni/aktionen/berater.md'),
    '---\nname: Berater\nmotor: claude-code\nstufe: klein\neingaben:\n  - name: frage\n    typ: langtext\n---\nDu bist Leifs Berater. Seine Frage:\n\n{frage}\n\nSo arbeitest du:\n- gründlich\n- mit Quellen',
  );
  fs.writeFileSync(
    path.join(d.vault.wurzel, 'Uni/aktionen/zwei.md'),
    '---\nname: Zwei\nmotor: claude-code\nstufe: klein\neingaben:\n  - name: fach\n    typ: text\n  - name: thema\n    typ: text\n---\nLange Anweisung zu {fach} und {thema}.',
  );
  fs.writeFileSync(path.join(d.vault.wurzel, 'Uni/aktionen/ohne.md'), '---\nname: Ohne Eingaben\nmotor: claude-code\nstufe: klein\n---\nMach die Checkliste.');
  return d;
}

describe('Arbeitsanweisung ausblenden (E245)', () => {
  it('erste Nachricht: text = ganze Anweisung (geht ans Modell), anzeige = nur Leifs Eingabe; Folgenachrichten normal', async () => {
    const d = await dorf();
    const { chatId } = await d.agenten.aktionStarten('Uni/berater', { frage: 'Soll ich 500 Franken in einen Quantum-ETF stecken?' });
    await d.agenten.leerlauf();
    const c = d.agenten.chatDetail(chatId);
    const erste = c.nachrichten[0]!;
    expect(erste.rolle).toBe('nutzer');
    expect(erste.text).toContain('So arbeitest du:');
    expect(erste.text).toContain('Soll ich 500 Franken');
    expect(erste.anzeige).toBe('Soll ich 500 Franken in einen Quantum-ETF stecken?');
    // weitere Nachricht von Leif: ohne anzeige
    await d.agenten.nachrichtSenden(chatId, 'Und welcher genau?');
    await d.agenten.leerlauf();
    const nutzer = d.agenten.chatDetail(chatId).nachrichten.filter((n) => n.rolle === 'nutzer');
    expect(nutzer).toHaveLength(2);
    expect(nutzer[1]!.anzeige).toBeUndefined();
  });

  it('mehrere Eingaben, keine Eingaben, Helfer, freier Chat', () => {
    expect(auftragAnzeige({ aktion: 'Uni/zwei', titel: 'Zwei: CDA', eingaben_json: JSON.stringify({ fach: 'CDA', thema: 'Regression' }) })).toBe('**fach:** CDA\n\n**thema:** Regression');
    expect(auftragAnzeige({ aktion: 'Uni/ohne', titel: 'Ohne Eingaben', eingaben_json: '{}' })).toBe('▶ Ohne Eingaben');
    expect(auftragAnzeige({ aktion: null, titel: 'Helfer: Mail an Prof entwerfen', eingaben_json: '{}' })).toBe('Auftrag: Mail an Prof entwerfen');
    expect(auftragAnzeige({ aktion: null, titel: 'Freier Chat', eingaben_json: '{}' })).toBeNull();
    expect(auftragAnzeige({ aktion: 'Uni/x', titel: 'X', eingaben_json: 'kaputt' })).toBe('▶ X');
  });
});

describe('Letzte Chats (E245)', () => {
  it('die 5 jüngsten Chats mit Nachrichten von Leif oder einem Modell, ohne System-Chats; Vorschau nie die Anweisung', async () => {
    const d = await dorf();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      d.uhr.vor(60_000);
      const { chatId } = await d.agenten.aktionStarten('Uni/berater', { frage: `Frage ${i}` });
      await d.agenten.leerlauf();
      ids.push(chatId);
    }
    // System-Chat (z. B. Post-Einordnung, Hafen-Bewertung) zählt nicht
    d.uhr.vor(60_000);
    d.db.prepare("INSERT INTO chats (id, gebaeude, aktion, titel, motor, stufe, modell, eingaben_json, anhaenge_json, werkzeuge_json, fremdinhalte, rolle, erstellt, geaendert) VALUES ('sys', 'Post', NULL, 'Einordnung', 'api', 'klein', 'm', '{}', '[]', '[]', 1, 'system', ?, ?)").run(d.uhr.jetzt(), d.uhr.jetzt());
    d.db.prepare("INSERT INTO nachrichten (chat_id, rolle, text, erstellt) VALUES ('sys', 'agent', 'eingeordnet', ?)").run(d.uhr.jetzt());
    // Leif schreibt im ältesten Chat → der steht oben
    d.uhr.vor(60_000);
    await d.agenten.nachrichtSenden(ids[0]!, 'Noch eine Frage');
    const h = await kopf(d);
    const r = await d.app.inject({ url: '/api/chats/letzte', headers: h });
    expect(r.statusCode).toBe(200);
    const liste = r.json() as { id: string; von: string; vorschau: string; gebaeude: string }[];
    expect(liste).toHaveLength(5);
    // die Attrappe antwortet sofort – oben steht ihre Antwort, ohne das Protokoll darunter
    expect(liste[0]).toMatchObject({ id: ids[0], von: 'agent', gebaeude: 'Uni' });
    expect(liste[0]!.vorschau).toMatch(/^Erledigt\./);
    expect(liste[0]!.vorschau).not.toContain('Zusammenfassung');
    expect(liste.map((x) => x.id)).not.toContain('sys');
    expect(liste.slice(1).map((x) => x.id)).toEqual([ids[5], ids[4], ids[3], ids[2]]);
    for (const x of liste) expect(x.vorschau).not.toContain('So arbeitest du');
    expect((await d.app.inject({ url: '/api/chats/letzte' })).statusCode).toBe(401);
    expect((await d.app.inject({ url: '/api/chats/letzte?anzahl=99', headers: h })).statusCode).toBe(400);
  });
});
