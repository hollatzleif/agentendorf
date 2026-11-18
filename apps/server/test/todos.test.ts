import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { passwortSetzen } from '../src/auth/passwort.js';
import { cookieAus, ORIGIN, testDorf } from './hilfen.js';

const PW = 'ein-langes-test-passwort-1';
async function kopf(d: Awaited<ReturnType<typeof testDorf>>) {
  await passwortSetzen(d.db, d.uhr, PW);
  const r = await d.app.inject({ method: 'POST', url: '/api/anmeldung', headers: { origin: ORIGIN }, payload: { passwort: PW } });
  return { origin: ORIGIN, cookie: cookieAus(r.headers['set-cookie']) };
}

describe('To-do-Brett (E65)', () => {
  it('App: anlegen, abhaken, bearbeiten (Version), löschen = Papierkorb; Obsidian-Datei wird gelesen', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    const neu = (await d.app.inject({ method: 'POST', url: '/api/todos', headers: h, payload: { titel: 'Plakat abgeben', faellig: '2026-11-18' } })).json();
    expect(neu).toMatchObject({ titel: 'Plakat abgeben', erledigt: false, faellig: '2026-11-18', quelle: 'Leif' });
    expect(neu.pfad).toMatch(/^Marktplatz\/todos\/\d{4}-\d{2}-\d{2}_\d{4}_plakat-abgeben\.md$/);
    expect((await d.vault.lesen(neu.pfad)).inhalt).toMatch(/titel: Plakat abgeben\nstatus: offen\nfaellig: '?2026-11-18'?/);
    // in Obsidian von Hand angelegt (ohne titel) – erscheint trotzdem
    fs.mkdirSync(path.join(d.vault.wurzel, 'Marktplatz/todos'), { recursive: true });
    fs.writeFileSync(path.join(d.vault.wurzel, 'Marktplatz/todos/milch-kaufen.md'), '---\nstatus: offen\n---\n');
    let l = (await d.app.inject({ url: '/api/todos', headers: h })).json() as { titel: string; pfad: string; version: string; erledigt: boolean }[];
    expect(l.map((t) => t.titel)).toEqual(['Plakat abgeben', 'milch kaufen']); // fällige zuerst

    const ab = await d.app.inject({ method: 'PATCH', url: '/api/todos', headers: h, payload: { pfad: neu.pfad, basisVersion: neu.version, erledigt: true } });
    expect(ab.json()).toMatchObject({ erledigt: true });
    expect(ab.json().erledigtAm).toBeTruthy();
    // alte Version → 409 statt überschreiben
    expect((await d.app.inject({ method: 'PATCH', url: '/api/todos', headers: h, payload: { pfad: neu.pfad, basisVersion: neu.version, titel: 'x' } })).statusCode).toBe(409);
    // nur Marktplatz/todos/
    expect((await d.app.inject({ method: 'PATCH', url: '/api/todos', headers: h, payload: { pfad: 'Rathaus/memory.md', titel: 'x' } })).statusCode).toBe(400);
    expect((await d.app.inject({ method: 'DELETE', url: '/api/todos?pfad=Uni%2Fgebaeude.md', headers: h })).statusCode).toBe(400);

    const weg = await d.app.inject({ method: 'DELETE', url: `/api/todos?pfad=${encodeURIComponent('Marktplatz/todos/milch-kaufen.md')}`, headers: h });
    expect(weg.json().papierkorb).toMatch(/^\.papierkorb\//);
    l = (await d.app.inject({ url: '/api/todos', headers: h })).json();
    expect(l.map((t) => [t.titel, t.erledigt])).toEqual([['Plakat abgeben', true]]);
    expect((await d.app.inject({ method: 'POST', url: '/api/todos', headers: h, payload: { titel: ' ' } })).statusCode).toBe(400);
  });

  it('alle Agenten haben die todo-Werkzeuge: anlegen, liste (als Fremdinhalt), abhaken, löschen', async () => {
    const d = await testDorf();
    const w = (n: string, e: unknown) => `<<werkzeug ${n} ${JSON.stringify(e)}>>`;
    // eine Aktion OHNE Schreibrechte im Vault – die To-do-Werkzeuge hat sie trotzdem
    fs.writeFileSync(
      path.join(d.vault.wurzel, 'Uni/aktionen/todo-test.md'),
      `---\nname: Todo-Test\nwerkzeuge: [vault_lesen]\n---\n${w('todo_anlegen', { titel: 'Mathe Blatt 5', faellig: '2026-11-20', gebaeude: 'Uni' })}\n${w('todo_liste', {})}\n`,
    );
    const r = await d.agenten.aktionStarten('Uni/todo-test', {});
    await d.agenten.leerlauf();
    const t = d.agenten.chatDetail(r.chatId).nachrichten.filter((n) => n.rolle === 'werkzeug').map((n) => n.text);
    expect(t[0]).toMatch(/^todo_anlegen: To-do angelegt: \[ \] Mathe Blatt 5 \(fällig 2026-11-20\) #Uni – Marktplatz\/todos\//);
    expect(t[1]).toMatch(/<fremdinhalt quelle="todos">[\s\S]*Mathe Blatt 5/);
    const [todo] = await d.todos.liste();
    expect(todo).toMatchObject({ quelle: 'Agent (Uni)' });

    const r2 = await d.agenten.aktionStarten('Bibliothek/notizen-zusammenfassen', { thema: `${w('todo_bearbeiten', { pfad: todo!.pfad, erledigt: true })} ${w('todo_loeschen', { pfad: todo!.pfad })} ${w('todo_loeschen', { pfad: 'Rathaus/memory.md' })}` });
    await d.agenten.leerlauf();
    const t2 = d.agenten.chatDetail(r2.chatId).nachrichten.filter((n) => n.rolle === 'werkzeug').map((n) => n.text);
    expect(t2[0]).toMatch(/To-do geändert: \[x\] Mathe Blatt 5/);
    expect(t2[1]).toMatch(/Papierkorb, wiederherstellbar/);
    expect(t2[2]).toMatch(/verweigert.*Kein To-do/);
    expect(await d.todos.liste()).toEqual([]);
    expect(await d.vault.existiert('Rathaus/memory.md')).toBe(true);
  });
});
