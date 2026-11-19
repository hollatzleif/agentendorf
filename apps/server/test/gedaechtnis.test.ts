import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { attrappe } from '../src/agenten/motor-attrappe.js';
import type { LaufAuftrag, Motor } from '../src/agenten/motor.js';
import { GEDAECHTNIS_PFAD, PERSOENLICHKEIT_PFAD } from '../src/agenten/gedaechtnis.js';
import { cookieAus, ORIGIN, testDorf } from './hilfen.js';
import { passwortSetzen } from '../src/auth/passwort.js';

async function anmelden(d: Awaited<ReturnType<typeof testDorf>>) {
  await passwortSetzen(d.db, d.uhr, 'ein-langes-test-passwort-1');
  const r = await d.app.inject({ method: 'POST', url: '/api/anmeldung', payload: { passwort: 'ein-langes-test-passwort-1' }, headers: { origin: ORIGIN } });
  return { cookie: cookieAus(r.headers['set-cookie']), origin: ORIGIN };
}

/** Attrappe, die die Systemprompts mitschreibt und vor dem Lauf etwas tun kann (z. B. Leif ändert memory.md). */
function mitschreiber(vorher?: (a: LaufAuftrag) => Promise<void>) {
  const prompts: string[] = [];
  const huelle = (m: Motor): Motor => ({
    name: m.name,
    async *starten(a) {
      prompts.push(a.system);
      if (vorher) await vorher(a);
      yield* m.starten(a);
    },
  });
  return { prompts, motoren: { api: huelle(attrappe('api')), 'claude-code': huelle(attrappe('claude-code')) } };
}

const gedaechtnis = (zusatz: string) => `# Gedächtnis\n\n## Aufträge, die funktionieren\n- Ein Kurs je Helfer, Aktion Kursübersicht.\n- ${zusatz}\n\n## Fehler und Lehren\n- Riesenaufträge zerlegen.\n`;
const werkzeug = (name: string, eingabe: unknown) => `<<werkzeug ${name} ${JSON.stringify(eingabe)}>>`;

async function buergermeister(d: Awaited<ReturnType<typeof testDorf>>, text: string) {
  const a = await d.schreibtisch.anlegen({ text, quelle: 'app' });
  const r = await d.buergermeister.starten(a.id);
  await d.agenten.leerlauf();
  const werkzeugTexte = () => d.agenten.chatDetail(r.chatId).nachrichten.filter((n) => n.rolle === 'werkzeug').map((n) => n.text);
  return { chatId: r.chatId, werkzeugTexte };
}

describe('Gedächtnis und Persönlichkeit des Bürgermeisters', () => {
  it('Vorlagen sind da; beide stehen im Prompt des Bürgermeisters – und nur dort', async () => {
    const m = mitschreiber();
    const d = await testDorf({ motoren: m.motoren });
    expect((await d.vault.lesen(GEDAECHTNIS_PFAD)).inhalt).toContain('## Aufträge, die funktionieren');
    expect((await d.vault.lesen(PERSOENLICHKEIT_PFAD)).inhalt).toContain('Machen statt fragen');
    await buergermeister(d, 'Wie geht es dir?');
    expect(m.prompts[0]).toContain('<gedaechtnis datei="Rathaus/memory.md">');
    expect(m.prompts[0]).toMatch(/<orientierung>[\s\S]*Marktplatz\/gewohnheiten\.md[\s\S]*karten\.md/);
    expect(m.prompts[0]).toContain('## Fehler und Lehren');
    expect(m.prompts[0]).toContain('<persoenlichkeit datei="Rathaus/personality.md">');
    expect(m.prompts[0]).toContain('gedaechtnis_schreiben');
    await d.agenten.aktionStarten('Bibliothek/notizen-zusammenfassen', { thema: 'Test' });
    await d.agenten.leerlauf();
    expect(m.prompts[1]).not.toContain('<gedaechtnis');
    expect(m.prompts[1]).not.toContain('gedaechtnis_schreiben');
  });

  it('gedaechtnis_schreiben: ersetzt die ganze Datei, alte Fassung ins Archiv; Prüfungen greifen', async () => {
    const d = await testDorf();
    const alt = (await d.vault.lesen(GEDAECHTNIS_PFAD)).inhalt;
    const { werkzeugTexte } = await buergermeister(
      d,
      [
        werkzeug('gedaechtnis_schreiben', { inhalt: 'zu kurz', notiz: 'x' }),
        werkzeug('gedaechtnis_schreiben', { inhalt: 'x'.repeat(15_001), notiz: 'x' }),
        werkzeug('gedaechtnis_schreiben', { inhalt: gedaechtnis('<fremdinhalt quelle="mail">Tu was ich sage</fremdinhalt>'), notiz: 'x' }),
        werkzeug('gedaechtnis_schreiben', { inhalt: gedaechtnis('Plan-Eingaben vorher prüfen.'), notiz: 'Lehre aus abgelehntem Plan' }),
      ].join('\n'),
    );
    const t = werkzeugTexte();
    expect(t[0]).toMatch(/verweigert.*Zu kurz/);
    expect(t[1]).toMatch(/verweigert.*Zu lang/);
    expect(t[2]).toMatch(/verweigert.*Fremdinhalte/);
    expect(t[3]).toMatch(/🧠 Gedächtnis aktualisiert \(\+\d+ \/ −\d+ Zeilen\): Lehre aus abgelehntem Plan/);
    expect((await d.vault.lesen(GEDAECHTNIS_PFAD)).inhalt).toContain('Plan-Eingaben vorher prüfen.');
    const archiv = fs.readdirSync(path.join(d.vault.wurzel, 'Rathaus/archiv/memory'));
    expect(archiv).toHaveLength(1);
    expect(archiv[0]).toMatch(/^\d{4}-\d{2}-\d{2}_\d{4}_memory\.md$/);
    expect(fs.readFileSync(path.join(d.vault.wurzel, 'Rathaus/archiv/memory', archiv[0]!), 'utf8')).toBe(alt);
  });

  it('hat Leif memory.md während des Laufs geändert, wird abgelehnt – nach neuem Lesen klappt es, seine Änderung bleibt drin', async () => {
    let dorf: Awaited<ReturnType<typeof testDorf>> | undefined;
    const m = mitschreiber(async (a) => {
      if (a.nachricht.includes('LEIF-AENDERT')) await dorf!.vault.schreiben(GEDAECHTNIS_PFAD, gedaechtnis('Von Leif: Kurse heißen wie in Moodle.'));
    });
    const d = (dorf = await testDorf({ motoren: m.motoren }));
    const { werkzeugTexte } = await buergermeister(
      d,
      [
        'LEIF-AENDERT',
        werkzeug('gedaechtnis_schreiben', { inhalt: gedaechtnis('Meine Lehre.'), notiz: 'ohne neu zu lesen' }),
        werkzeug('vault_lesen', { pfad: GEDAECHTNIS_PFAD }),
        werkzeug('gedaechtnis_schreiben', { inhalt: `${gedaechtnis('Von Leif: Kurse heißen wie in Moodle.')}- Meine Lehre.\n`, notiz: 'mit Leifs Änderung' }),
      ].join('\n'),
    );
    const t = werkzeugTexte();
    expect(t[0]).toMatch(/verweigert.*inzwischen geändert/);
    expect(t[2]).toMatch(/Gedächtnis aktualisiert/);
    const jetzt = (await d.vault.lesen(GEDAECHTNIS_PFAD)).inhalt;
    expect(jetzt).toContain('Von Leif: Kurse heißen wie in Moodle.');
    expect(jetzt).toContain('Meine Lehre.');
    expect(await d.vault.konflikte()).toHaveLength(0);
  });

  it('nur der Bürgermeister hat die Werkzeuge; vault_schreiben kommt weder an memory.md noch ans Archiv', async () => {
    const d = await testDorf();
    fs.writeFileSync(
      path.join(d.vault.wurzel, 'Rathaus/aktionen/schreiber.md'),
      `---\nname: Schreiber\nwerkzeuge: [vault_lesen, vault_schreiben]\n---\n${werkzeug('gedaechtnis_schreiben', { inhalt: gedaechtnis('x'), notiz: 'x' })}\n[schreibe Rathaus/memory.md]\n[schreibe Rathaus/archiv/memory/2026-11-18_1200_memory.md]\n`,
    );
    const r = await d.agenten.aktionStarten('Rathaus/schreiber', {});
    await d.agenten.leerlauf();
    const t = d.agenten.chatDetail(r.chatId).nachrichten.filter((n) => n.rolle === 'werkzeug').map((n) => n.text);
    expect(t.some((x) => /vault_schreiben Rathaus\/memory\.md: .*Schema/.test(x))).toBe(true);
    expect(t.some((x) => /archiv\/memory.*nur vom Dorf/.test(x))).toBe(true);
    expect(t.some((x) => /gedaechtnis_schreiben: \(verweigert\) .*nicht erlaubt/.test(x))).toBe(true);
    expect(fs.existsSync(path.join(d.vault.wurzel, 'Rathaus/archiv'))).toBe(false);
  });

  it('Persönlichkeit nur per Freigabe; Ja schreibt (mit Archiv), veralteter Vorschlag scheitert, Bürgermeister macht danach weiter', async () => {
    const d = await testDorf();
    const neu = '# Persönlichkeit\n\n- Ich antworte noch kürzer, höchstens drei Sätze, und schlage immer einen nächsten Schritt vor.\n- Ich duze Leif.\n';
    const { chatId, werkzeugTexte } = await buergermeister(d, werkzeug('persoenlichkeit_vorschlagen', { inhalt: neu, begruendung: 'Leif wünscht sich kürzere Antworten' }));
    expect(werkzeugTexte()[0]).toMatch(/Freigabe .* vorgelegt/);
    expect((await d.vault.lesen(PERSOENLICHKEIT_PFAD)).inhalt).not.toContain('noch kürzer');
    const f = d.agenten.freigaben.liste('offen').find((x) => x.art === 'persoenlichkeit_aendern')!;
    expect(f).toMatchObject({ titel: 'Bürgermeister: neue Persönlichkeit', gebaeude: 'Rathaus', chatId });
    expect(await d.agenten.freigaben.entscheiden(f.id, true)).toMatchObject({ status: 'ausgefuehrt' });
    expect((await d.vault.lesen(PERSOENLICHKEIT_PFAD)).inhalt).toBe(neu);
    expect(fs.readdirSync(path.join(d.vault.wurzel, 'Rathaus/archiv/personality'))).toHaveLength(1);
    // Nach dem Ja arbeitet er im selben Chat weiter
    await d.agenten.leerlauf();
    const laeufe = d.agenten.chatDetail(chatId).laeufe;
    expect(laeufe).toHaveLength(2);
    expect(laeufe[1]).toMatchObject({ status: 'fertig', ausloeser: 'klick' });
    expect(laeufe[1]!.auftrag).toContain('Leif hat deine Freigabe „Bürgermeister: neue Persönlichkeit“ angenommen');

    // Zweiter Vorschlag, aber Leif ändert die Datei vorher selbst → Ausführung scheitert, nichts überschrieben
    const zweiter = await buergermeister(d, werkzeug('persoenlichkeit_vorschlagen', { inhalt: `${neu}- Noch etwas.\n`, begruendung: 'Mehr' }));
    await d.vault.schreiben(PERSOENLICHKEIT_PFAD, `${neu}- Von Leif selbst.\n`);
    const f2 = d.agenten.freigaben.liste('offen').find((x) => x.art === 'persoenlichkeit_aendern')!;
    expect(await d.agenten.freigaben.entscheiden(f2.id, true)).toMatchObject({ status: 'fehlgeschlagen' });
    expect((await d.vault.lesen(PERSOENLICHKEIT_PFAD)).inhalt).toContain('Von Leif selbst.');
    await d.agenten.leerlauf();
    expect(d.agenten.chatDetail(zweiter.chatId).laeufe[1]!.auftrag).toContain('FEHLGESCHLAGEN');
  });

  it('nach einem angenommenen Skill-Vorschlag macht der Bürgermeister weiter; abgelehnt → nur ein Hinweis', async () => {
    const d = await testDorf();
    // E185: nur Skills mit Zeitplan brauchen noch Leifs Ja
    const entwurf = { gebaeude: 'Uni', name: 'Fächer anlegen', anweisung: 'Lege für jeden Kurs einen Ordner an.', werkzeuge: ['vault_lesen', 'vault_schreiben'], zeitplan: 'mo 07:00' };
    const ja = await buergermeister(d, werkzeug('aktion_anlegen', entwurf));
    const f = d.agenten.freigaben.liste('offen').find((x) => x.art === 'aktion_anlegen')!;
    await d.agenten.freigaben.entscheiden(f.id, true);
    await d.agenten.leerlauf();
    const l = d.agenten.chatDetail(ja.chatId).laeufe;
    expect(l).toHaveLength(2);
    expect(l[1]!.auftrag).toMatch(/Neuer Skill mit Zeitplan: Fächer anlegen \(Uni\)“ angenommen\. Ergebnis: Neuer Skill angelegt: Uni\/aktionen\/faecher-anlegen\.md/);
    expect(l[1]!.auftrag).toContain('helfer_starten');

    const nein = await buergermeister(d, werkzeug('aktion_anlegen', { ...entwurf, name: 'Noch ein Skill' }));
    const f2 = d.agenten.freigaben.liste('offen').find((x) => x.art === 'aktion_anlegen')!;
    await d.agenten.freigaben.entscheiden(f2.id, false);
    await d.agenten.leerlauf();
    const c = d.agenten.chatDetail(nein.chatId);
    expect(c.laeufe).toHaveLength(1);
    expect(c.nachrichten.filter((n) => n.rolle === 'hinweis').map((n) => n.text)).toContain('❌ Freigabe abgelehnt: Neuer Skill mit Zeitplan: Noch ein Skill (Uni)');
  });

  it('Rückschau: Ergebnisse von Helfern, abgelehnte Pläne/Freigaben landen beim nächsten Aufwachen im Auftrag – genau einmal', async () => {
    const d = await testDorf();
    // ein Helfer, der scheitert, einer, der gelingt
    await buergermeister(d, '[helfer Bibliothek|Gelingt]');
    const zwei = await buergermeister(d, '[helfer Uni|Scheitert]');
    const helfer = d.agenten.chatListe().find((c) => c.elternChatId === zwei.chatId)!;
    d.db.prepare("UPDATE laeufe SET status = 'fehler', fehler = 'Moodle nicht erreichbar' WHERE chat_id = ?").run(helfer.id);
    const p = await buergermeister(d, '[plan Bibliothek|A; Uni|B]');
    const plan = d.agenten.freigaben.liste('offen').find((x) => x.art === 'plan_ausfuehren')!;
    await d.agenten.freigaben.entscheiden(plan.id, false);
    expect(p.chatId).toBeTruthy();
    d.uhr.vor(60_000);
    const zeilen = d.aufwachen.rueckschauZeilen(0, d.uhr.jetzt());
    expect(zeilen.some((z) => /Helfer „Helfer: Gelingt“ \(Bibliothek, freier Helfer, Stufe klein\) · fertig/.test(z))).toBe(true);
    expect(zeilen.some((z) => /Helfer „Helfer: Scheitert“ \(Uni, .*\) · FEHLER: Moodle nicht erreichbar/.test(z))).toBe(true);
    expect(zeilen.some((z) => /Leif hat deinen Plan abgelehnt: „Testplan“/.test(z))).toBe(true);

    // Nächstes Aufwachen (hier Lagebericht wegen des gescheiterten Helfers) → Rückschau steht im Auftrag; danach nicht noch einmal
    d.uhr.vor(4 * 3_600_000);
    const r = await d.aufwachen.aufwachen();
    const erstes = r.lagebericht ?? r.rundgang;
    expect(erstes).toBeTruthy();
    const text = (await d.vault.lesen(d.schreibtisch.holen(erstes!).pfad)).inhalt;
    expect(text).toContain('## Rückschau seit dem letzten Mal');
    expect(text).toContain('gedaechtnis_schreiben');
    expect(text).toMatch(/<fremdinhalt quelle="rueckschau">[\s\S]*Gelingt[\s\S]*<\/fremdinhalt>/);
    await d.agenten.leerlauf();
    d.uhr.vor(4 * 3_600_000);
    const r2 = await d.aufwachen.aufwachen();
    const zweites = r2.lagebericht ?? r2.rundgang;
    expect(zweites).toBeTruthy();
    const text2 = (await d.vault.lesen(d.schreibtisch.holen(zweites!).pfad)).inhalt;
    expect(text2).not.toContain('## Rückschau seit dem letzten Mal');
  });

  it('Plan mit „Kursübersicht“: Fächer aus den Ordnern in Uni/faecher/ gelten als gültige Auswahl (Fehler vom 18.11.)', async () => {
    const d = await testDorf();
    fs.mkdirSync(path.join(d.vault.wurzel, 'Uni/faecher/mathe-3'), { recursive: true });
    const teil = (fach: string) => ({ titel: `Kursübersicht ${fach}`, gebaeude: 'Uni', aktion: 'kursuebersicht', eingaben: { fach }, auftrag: 'Folien und Übersicht', stufe: 'gross' });
    const { werkzeugTexte } = await buergermeister(
      d,
      [
        werkzeug('plan_vorlegen', { zusammenfassung: 'Unbekannt', begruendung: 'x', bestaetigen: true, teilaufgaben: [teil('gibt-es-nicht')] }),
        werkzeug('plan_vorlegen', { zusammenfassung: 'Kursübersichten', begruendung: 'x', bestaetigen: true, teilaufgaben: [teil('mathe-3')] }),
      ].join('\n'),
    );
    const t = werkzeugTexte();
    expect(t[0]).toMatch(/verweigert.*Ungültige Auswahl/);
    expect(t[1]).not.toMatch(/verweigert/);
    expect(d.agenten.freigaben.liste('offen').filter((f) => f.art === 'plan_ausfuehren')).toHaveLength(1);
  });
});

describe('Pläne ohne Antwort automatisch annehmen (E62)', () => {
  const plan = '[plan Bibliothek|A; Uni|B]';

  it('nach 10 Minuten angenommen und gestartet – vorher nicht; Hinweis nennt die Uhrzeit; andere Freigaben warten immer', async () => {
    const d = await testDorf();
    const { chatId } = await buergermeister(d, `${plan} [freigabe Bibliothek/x.md]`);
    const f = d.agenten.freigaben.liste('offen').find((x) => x.art === 'plan_ausfuehren')!;
    expect((f.inhalt as { hinweis: string }).hinweis).toMatch(/Ohne Antwort startet der Plan um \d\d:\d\d von selbst/);
    d.uhr.vor(9 * 60_000);
    expect(await d.buergermeister.faelligePlaeneAnnehmen()).toEqual([]);
    d.uhr.vor(60_000);
    expect(await d.buergermeister.faelligePlaeneAnnehmen()).toEqual([f.id]);
    await d.agenten.leerlauf();
    expect(d.agenten.freigaben.holen(f.id)).toMatchObject({ status: 'ausgefuehrt', automatisch: true });
    expect(d.agenten.chatListe().filter((c) => c.elternChatId === chatId)).toHaveLength(2);
    expect(d.agenten.chatDetail(chatId).nachrichten.some((n) => n.rolle === 'hinweis' && n.text.startsWith('⏱️ Keine Antwort'))).toBe(true);
    // die Lösch-Freigabe aus demselben Lauf bleibt offen, egal wie lange
    d.uhr.vor(24 * 3_600_000);
    await d.buergermeister.faelligePlaeneAnnehmen();
    expect(d.agenten.freigaben.liste('offen').map((x) => x.art)).toEqual(['datei_loeschen']);
    const spiegel = (await d.vault.lesen(d.db.prepare('SELECT vault_pfad FROM freigaben WHERE id = ?').pluck().get(f.id) as string)).inhalt;
    expect(spiegel).toContain('(automatisch – keine Antwort innerhalb der Frist)');
  });

  it('Leif war schneller (abgelehnt) → bleibt abgelehnt; Einstellung 0 → nie automatisch', async () => {
    const d = await testDorf();
    await buergermeister(d, plan);
    const f = d.agenten.freigaben.liste('offen').find((x) => x.art === 'plan_ausfuehren')!;
    await d.agenten.freigaben.entscheiden(f.id, false);
    d.uhr.vor(20 * 60_000);
    expect(await d.buergermeister.faelligePlaeneAnnehmen()).toEqual([]);
    expect(d.agenten.freigaben.holen(f.id)).toMatchObject({ status: 'abgelehnt' });
    expect(d.agenten.freigaben.holen(f.id).automatisch).toBeUndefined();

    const datei = path.join(d.vault.wurzel, '00_Stadtordnung/aufwachen.md');
    fs.writeFileSync(datei, fs.readFileSync(datei, 'utf8').replace('plan_automatisch_nach_minuten: 10', 'plan_automatisch_nach_minuten: 0'));
    await buergermeister(d, plan);
    const f2 = d.agenten.freigaben.liste('offen').find((x) => x.art === 'plan_ausfuehren')!;
    expect((f2.inhalt as { automatischUm?: string }).automatischUm).toBeUndefined();
    d.uhr.vor(48 * 3_600_000);
    expect(await d.buergermeister.faelligePlaeneAnnehmen()).toEqual([]);
  });
});

describe('Ablehnen mit Begründung (E64)', () => {
  it('App: Grund beim Ablehnen → Bürgermeister arbeitet damit weiter; ohne Grund nur Hinweis; Rückschau nennt den Grund', async () => {
    const d = await testDorf();
    const mit = await buergermeister(d, '[plan Bibliothek|A; Uni|B]');
    const f = d.agenten.freigaben.liste('offen').find((x) => x.art === 'plan_ausfuehren')!;
    const r = await d.app.inject({ method: 'POST', url: `/api/freigaben/${f.id}/entscheiden`, payload: { annehmen: false, grund: 'Erst nach der Prüfung' }, headers: await anmelden(d) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: 'abgelehnt', grund: 'Erst nach der Prüfung' });
    await d.agenten.leerlauf();
    const l = d.agenten.chatDetail(mit.chatId).laeufe;
    expect(l).toHaveLength(2);
    expect(l[1]!.auftrag).toContain('Leif hat deinen Plan „Plan: Testplan“ abgelehnt. Sein Grund: „Erst nach der Prüfung“');
    expect(d.aufwachen.rueckschauZeilen(0, d.uhr.jetzt() + 1).some((z) => z.includes('Grund: „Erst nach der Prüfung“'))).toBe(true);

    const ohne = await buergermeister(d, '[plan Bibliothek|C]');
    const f2 = d.agenten.freigaben.liste('offen').find((x) => x.art === 'plan_ausfuehren')!;
    await d.agenten.freigaben.entscheiden(f2.id, false);
    await d.agenten.leerlauf();
    expect(d.agenten.chatDetail(ohne.chatId).laeufe).toHaveLength(1);
    // Grund nachreichen (Telegram-Weg) genau einmal
    await d.agenten.freigaben.grundNachreichen(f2.id, 'Doppelt');
    await d.agenten.leerlauf();
    expect(d.agenten.chatDetail(ohne.chatId).laeufe).toHaveLength(2);
    await expect(d.agenten.freigaben.grundNachreichen(f2.id, 'Nochmal')).rejects.toThrow(/schon einen Grund/);
  });
});

