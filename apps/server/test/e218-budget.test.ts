import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ModellKlient } from '../src/agenten/motor-api.js';
import { BudgetErreicht, SystemAufrufe } from '../src/agenten/system.js';
import { stufenLaden } from '../src/agenten/modelle.js';
import { aufwachEinstellungen, budgetErreicht } from '../src/aufwachen.js';
import { testDorf } from './hilfen.js';

/**
 * E218 (Leif: „Bürgermeister höchstens 0,50 $ am Tag – günstigeres Modell oder über das Abo“):
 * Aufwachen über das Abo, automatische Aufrufe mit Haiku, harte Tagesgrenze für alles, was noch über die API geht.
 */
type TestDorf = Awaited<ReturnType<typeof testDorf>>;

function teuerVerbuchen(d: TestDorf, usd: number) {
  const jetzt = d.uhr.jetzt();
  d.db
    .prepare("INSERT OR IGNORE INTO chats (id, gebaeude, titel, motor, stufe, modell, erstellt, geaendert, rolle) VALUES ('sys', 'Post', 'x', 'api', 'klein', 'm', ?, ?, 'system')")
    .run(jetzt, jetzt);
  d.db
    .prepare(
      `INSERT INTO laeufe (id, chat_id, nummer, motor, modell, stufe, aufwand, status, ausloeser, auftrag, erstellt, kosten_usd)
       VALUES (?, 'sys', 1, 'api', 'm', 'klein', 'low', 'fertig', 'zeitplan', 'x', ?, ?)`,
    )
    .run(`teuer-${usd}`, jetzt - 60_000, usd);
}

function modell() {
  const anfragen: Record<string, unknown>[] = [];
  const klient: ModellKlient = {
    async streamen(params) {
      anfragen.push(params as Record<string, unknown>);
      return {
        id: 'm',
        type: 'message',
        role: 'assistant',
        model: String((params as { model: string }).model),
        content: [{ type: 'text', text: '{"ok":true}', citations: null }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      } as unknown as BetaMessage;
    },
  };
  return { klient, anfragen };
}

const auftrag = (vonLeif?: boolean) => ({
  gebaeude: 'Rathaus',
  chatTitel: 'Test',
  kurzAuftrag: 'Test',
  stufe: 'klein' as const,
  system: 's',
  nachricht: 'n',
  schema: { type: 'object' },
  pruefen: (r: unknown) => r as { ok: boolean },
  kurzErgebnis: () => 'ok',
  ...(vonLeif ? { vonLeif } : {}),
});

describe('E218: Bürgermeister höchstens 0,50 $ am Tag', () => {
  it('Vorlage: denkt über das Abo, Budget 0,50 $, System-Modell Haiku 5.5', async () => {
    const d = await testDorf();
    expect(await aufwachEinstellungen(d.vault)).toMatchObject({ denken_ueber: 'abo', tagesbudget_usd: 0.5 });
    expect((await stufenLaden(d.vault)).system).toEqual({ modell: 'claude-haiku-5-5', aufwand: 'medium' });
  });

  it('von selbst aufgewacht: Bürgermeister läuft über das Abo – auch wenn das API-Budget aufgebraucht ist', async () => {
    const d = await testDorf();
    teuerVerbuchen(d, 0.6);
    expect(await budgetErreicht(d.db, d.uhr, d.vault)).toBe(0.5);
    const a = await d.schreibtisch.anlegen({ text: 'Notiz aus Obsidian: Frage zur Bibliothek', quelle: 'app' });
    const r = await d.aufwachen.aufwachen();
    expect(r).toMatchObject({ budgetErreicht: false, gestartet: 1 });
    await d.agenten.leerlauf();
    const lauf = d.agenten.chatDetail(d.schreibtisch.holen(a.id).chatId!).laeufe[0]!;
    expect(lauf).toMatchObject({ motor: 'claude-code', ausloeser: 'zeitplan', status: 'fertig' });
    // kostet kein API-Geld: der Verbrauch bleibt bei den 0,60 $ von vorher
    expect(d.aufwachen.verbrauchHeute()).toBeCloseTo(0.6);
  });

  it('denken_ueber: api → wie bisher über die API und vom Budget gebremst; Notschalter übersteuert das Abo', async () => {
    const d = await testDorf();
    const alt = await d.vault.lesen('00_Stadtordnung/aufwachen.md');
    await d.vault.schreiben('00_Stadtordnung/aufwachen.md', alt.inhalt.replace('denken_ueber: abo', 'denken_ueber: api'), { basisVersion: alt.version });
    const a = await d.schreibtisch.anlegen({ text: 'Notiz: Frage', quelle: 'app' });
    await d.aufwachen.aufwachen();
    await d.agenten.leerlauf();
    expect(d.agenten.chatDetail(d.schreibtisch.holen(a.id).chatId!).laeufe[0]).toMatchObject({ motor: 'api', ausloeser: 'zeitplan' });
    teuerVerbuchen(d, 0.6);
    expect((await d.aufwachen.aufwachen()).budgetErreicht).toBe(true);
  });

  it('Systemaufrufe: automatisch mit Haiku ohne fallbacks, harte Grenze; Leifs Klick mit seiner Stufe und außerhalb des Budgets', async () => {
    const d = await testDorf();
    const m = modell();
    const ki = new SystemAufrufe({ db: d.db, uhr: d.uhr, vault: d.vault, hub: d.hub, klient: () => m.klient, budgetErreicht: () => budgetErreicht(d.db, d.uhr, d.vault) });
    expect(await ki.json(auftrag())).toEqual({ ok: true });
    expect(m.anfragen[0]).toMatchObject({ model: 'claude-haiku-5-5', output_config: { effort: 'medium' } });
    expect(m.anfragen[0]!.fallbacks).toBeUndefined();

    teuerVerbuchen(d, 0.6);
    await expect(ki.json(auftrag())).rejects.toBeInstanceOf(BudgetErreicht);
    expect(m.anfragen).toHaveLength(1); // kein Aufruf, nichts verbucht
    // Leifs Klick („In Schritte zerlegen“): Stufe klein (Sonnet, mit fallbacks), als „klick“ verbucht – zählt nicht ins Budget
    const vorher = d.aufwachen.verbrauchHeute();
    expect(await ki.json(auftrag(true))).toEqual({ ok: true });
    expect(m.anfragen[1]).toMatchObject({ model: 'claude-sonnet-5-5', fallbacks: 'default' });
    expect(d.aufwachen.verbrauchHeute()).toBeCloseTo(vorher);
    const l = d.db.prepare("SELECT ausloeser FROM laeufe WHERE modell = 'claude-sonnet-5-5'").get() as { ausloeser: string };
    expect(l.ausloeser).toBe('klick');
  });

  it('Vorlagen: unveränderte aufwachen.md (E192) und modelle.md bekommen beim Start die neue Fassung, geänderte nicht', async () => {
    const { dorfStarten } = await import('../src/dorf.js');
    const alt = (n: string) => fs.readFileSync(path.join(import.meta.dirname, 'vorlagen-alt', n), 'utf8');
    const neu = (p: string) => fs.readFileSync(path.join(import.meta.dirname, '../../../vault-vorlage', p), 'utf8');
    const d = await testDorf();
    await d.vault.schreiben('00_Stadtordnung/aufwachen.md', alt('aufwachen-e192.md'));
    await d.vault.schreiben('00_Stadtordnung/modelle.md', alt('modelle-1.md').replace('aufwand: medium', 'aufwand: low'));
    await d.app.close();
    const d2 = await dorfStarten(d.konfig, { beobachten: false });
    expect((await d2.vault.lesen('00_Stadtordnung/aufwachen.md')).inhalt).toBe(neu('00_Stadtordnung/aufwachen.md'));
    // von Leif geändert → bleibt; das System-Modell gilt trotzdem (Standard Haiku, wenn der Schlüssel fehlt)
    expect((await d2.vault.lesen('00_Stadtordnung/modelle.md')).inhalt).toContain('aufwand: low');
    expect((await stufenLaden(d2.vault)).system.modell).toBe('claude-haiku-5-5');
    await d2.app.close();
    // unverändert → neue Fassung mit dem system-Block
    const d3 = await testDorf();
    await d3.vault.schreiben('00_Stadtordnung/modelle.md', alt('modelle-1.md'));
    await d3.app.close();
    const d4 = await dorfStarten(d3.konfig, { beobachten: false });
    expect((await d4.vault.lesen('00_Stadtordnung/modelle.md')).inhalt).toBe(neu('00_Stadtordnung/modelle.md'));
    await d4.app.close();
  });
});
