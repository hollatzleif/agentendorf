import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ruht, todoAusText, type FreigabeInfo, type GeraetInfo, type GeraetKopplung, type LaufStatus, type PlanInhalt, type TodoInfo } from '@dorf/shared';
import type { Abhaengigkeiten } from './app.js';
import type { DB } from './db.js';
import type { Uhr } from './uhr.js';
import { tokenHash } from './auth/sitzungen.js';
import type { Drossel } from './auth/drossel.js';
import { DorfFehler } from './fehler.js';
import type { Einmalig } from './idempotenz.js';
import { terminAusAngaben } from './kalender-google.js';
import { ortszeitZuUtc } from './uni/ical.js';
import { ortIso, tagIn, tagPlus, uhrzeitIn, versatzMinuten, ZONE_WIEN } from './zeit.js';

/**
 * Geräte (E182): Der Cardputer (und später vielleicht weitere kleine Geräte) spricht mit eigenem Schlüssel nur mit
 * /api/geraet/*. Vertrag: apps/cardputer/API.md. Gekoppelt wird mit einem 6-stelligen Code aus der App (5 min, einmalig).
 * In der DB steht nur der sha256 des Schlüssels; Sperren löscht das Gerät – der Schlüssel gilt sofort nicht mehr.
 * Die Routen rufen nur die vorhandenen Dienste auf (To-dos, Kalender, Kirchturm, Bürgermeister, Freigaben …) –
 * Live-Ereignisse und der Telegram-Spiegel laufen darüber ohnehin mit.
 */
export const KOPPLUNG_MS = 5 * 60_000;
/** Nach so vielen falschen Codes (von irgendwo) verfällt der offene Code – Leif holt sich einfach einen neuen */
export const KOPPLUNG_MAX_FEHLVERSUCHE = 10;
export const MAX_GERAETE = 20;

export interface Geraet {
  id: string;
  name: string;
  token_hash: string;
  erstellt: number;
  zuletzt: number;
  ip: string;
}

export class Geraete {
  constructor(private o: { db: DB; uhr: Uhr }) {}

  /** Neuer Kopplungscode – ersetzt einen noch offenen (es gibt immer höchstens einen) */
  kopplungStarten(): GeraetKopplung {
    const jetzt = this.o.uhr.jetzt();
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const bis = jetzt + KOPPLUNG_MS;
    this.o.db.transaction(() => {
      this.o.db.prepare('DELETE FROM geraete_kopplung').run();
      this.o.db.prepare('INSERT INTO geraete_kopplung (code_hash, gueltig_bis) VALUES (?, ?)').run(tokenHash(code), bis);
    })();
    return { code, gueltigBis: new Date(bis).toISOString() };
  }

  /** Code einlösen – genau einmal (atomar), nur innerhalb von 5 min. null = falsch/abgelaufen. */
  koppeln(code: string, name: string, ip: string): { token: string; name: string } | null {
    const db = this.o.db;
    const jetzt = this.o.uhr.jetzt();
    return db.transaction(() => {
      db.prepare('DELETE FROM geraete_kopplung WHERE gueltig_bis <= ?').run(jetzt);
      const offen = db.prepare('SELECT 1 FROM geraete_kopplung WHERE code_hash = ?').get(tokenHash(code));
      if (!offen) {
        db.prepare('UPDATE geraete_kopplung SET fehlversuche = fehlversuche + 1').run();
        db.prepare('DELETE FROM geraete_kopplung WHERE fehlversuche >= ?').run(KOPPLUNG_MAX_FEHLVERSUCHE);
        return null;
      }
      if ((db.prepare('SELECT COUNT(*) AS n FROM geraete').get() as { n: number }).n >= MAX_GERAETE)
        throw new DorfFehler(409, `Höchstens ${MAX_GERAETE} Geräte – sperr in der App erst ein altes.`);
      db.prepare('DELETE FROM geraete_kopplung WHERE code_hash = ?').run(tokenHash(code));
      const token = crypto.randomBytes(32).toString('hex');
      db.prepare('INSERT INTO geraete (id, name, token_hash, erstellt, zuletzt, ip) VALUES (?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), name, tokenHash(token), jetzt, jetzt, ip);
      return { token, name };
    })();
  }

  /** Kopfzeile „Authorization: Bearer <64 Hex>“ prüfen; merkt „zuletzt gesehen“ bei jeder Anfrage */
  pruefen(kopf: string | undefined, ip: string): Geraet | null {
    const m = /^Bearer ([0-9a-f]{64})$/.exec(kopf?.trim() ?? '');
    if (!m) return null;
    const g = this.o.db.prepare('SELECT * FROM geraete WHERE token_hash = ?').get(tokenHash(m[1]!)) as Geraet | undefined;
    if (!g) return null;
    g.zuletzt = this.o.uhr.jetzt();
    g.ip = ip;
    this.o.db.prepare('UPDATE geraete SET zuletzt = ?, ip = ? WHERE id = ?').run(g.zuletzt, ip, g.id);
    return g;
  }

  liste(): GeraetInfo[] {
    return (this.o.db.prepare('SELECT * FROM geraete ORDER BY zuletzt DESC').all() as Geraet[]).map((g) => ({
      id: g.id,
      name: g.name,
      erstellt: new Date(g.erstellt).toISOString(),
      zuletzt: new Date(g.zuletzt).toISOString(),
      ip: g.ip,
    }));
  }

  /** Sperren = löschen: der Schlüssel gilt ab sofort nicht mehr */
  sperren(id: string) {
    return this.o.db.prepare('DELETE FROM geraete WHERE id = ?').run(id).changes === 1;
  }
}

// ---- Texte für den kleinen Bildschirm ---------------------------------------------------------

/** Einzeilig, höchstens n Zeichen (Codepunkte) */
export function kurz(t: string, n: number) {
  const z = Array.from(t.replace(/\s+/g, ' ').trim());
  return z.length > n ? `${z.slice(0, n - 1).join('')}…` : z.join('');
}

/** Mehrzeilig gekürzt (Zeilenumbrüche bleiben) */
function kuerzen(t: string, n: number) {
  const z = Array.from(t.trim());
  return z.length > n ? `${z.slice(0, n - 1).join('')}…` : z.join('');
}

/** Markdown grob entfernen – der Cardputer zeigt reinen Text */
export function ohneMarkdown(t: string) {
  return t
    .replace(/\r/g, '')
    .replace(/^```.*$/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[*+]\s+/gm, '- ')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, '')
    .replace(/^\|\s*(.*?)\s*\|?$/gm, (_m, x: string) => x.split(/\s*\|\s*/).join(' · '))
    .replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,:;!?]|$)/gm, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---- To-do aus Text (wie Telegram/App, dazu Datum am Ende und „!“) -----------------------------

const WOCHENTAGE: Record<string, number> = { so: 0, sonntag: 0, mo: 1, montag: 1, di: 2, dienstag: 2, mi: 3, mittwoch: 3, do: 4, donnerstag: 4, fr: 5, freitag: 5, sa: 6, samstag: 6 };

/** Datum am ENDE des Texts: heute, morgen, übermorgen, Wochentag (mo … so, montag …), 24.12. / 24.12.2026 */
function datumAmEnde(text: string, heute: string): { titel: string; faellig?: string } {
  let m = /^(.*?\S)\s+(?:(?:am|bis)\s+)?(heute|morgen|übermorgen|uebermorgen)$/i.exec(text);
  if (m) {
    const w = m[2]!.toLowerCase();
    return { titel: m[1]!, faellig: tagPlus(heute, w === 'heute' ? 0 : w === 'morgen' ? 1 : 2) };
  }
  m = /^(.*?\S)\s+(?:(?:am|bis)\s+)?(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?$/i.exec(text);
  if (m) {
    const t = Number(m[2]);
    const mo = Number(m[3]);
    let j = m[4] ? Number(m[4]) : Number(heute.slice(0, 4));
    if (j < 100) j += 2000;
    const tag = `${j}-${String(mo).padStart(2, '0')}-${String(t).padStart(2, '0')}`;
    if (new Date(`${tag}T12:00:00Z`).toISOString().slice(0, 10) !== tag) return { titel: text };
    // ohne Jahr und schon vorbei → nächstes Jahr
    return { titel: m[1]!, faellig: !m[4] && tag < heute ? `${j + 1}${tag.slice(4)}` : tag };
  }
  m = /^(.*?\S)\s+(?:(am|bis|nächsten|naechsten|kommenden)\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|mo|di|mi|do|fr|sa|so)\.?$/i.exec(text);
  // „jeden Montag“ ist eine Wiederholung (todoAusText), kein Datum
  if (m && !/(^|\s)jeden$/i.test(m[1]!)) {
    const ziel = WOCHENTAGE[m[3]!.toLowerCase()]!;
    let diff = (ziel - new Date(`${heute}T12:00:00Z`).getUTCDay() + 7) % 7;
    // „fr“ am Freitag = heute, „nächsten fr“ = in einer Woche
    if (diff === 0 && /^n/i.test(m[2] ?? '')) diff = 7;
    return { titel: m[1]!, faellig: tagPlus(heute, diff) };
  }
  return { titel: text };
}

/** „Mathe Übung 3 morgen !“ → Titel, fällig morgen, wichtig. Dauer, Wiederholung und „wartet auf“ wie in der App. */
export function geraetTodoAusText(roh: string, heute: string) {
  let text = roh.replace(/\s+/g, ' ').trim();
  const wichtig = /!+$/.test(text);
  text = text.replace(/\s*!+$/, '').trim();
  const d1 = datumAmEnde(text, heute);
  const e = todoAusText(d1.titel, heute);
  const d2 = d1.faellig ? { titel: e.titel } : datumAmEnde(e.titel, heute);
  const faellig = d1.faellig ?? d2.faellig ?? e.faellig;
  return { ...e, titel: d2.titel || e.titel, ...(faellig ? { faellig } : {}), ...(wichtig ? { wichtig: true } : {}) };
}

// ---- Routen ------------------------------------------------------------------------------------

/** „Heute“ wie in der App: ⭐ wichtig, überfällig, heute fällig – ohne Wartendes (ruht bis zum Nachfass-Tag) */
export function heuteTodos(alle: TodoInfo[], heute: string) {
  return alle.filter((t) => !t.erledigt && !ruht(t, heute) && (t.wichtig || (t.faellig && t.faellig <= heute)));
}

const mitternacht = (tag: string) => ortszeitZuUtc(...(tag.split('-').map(Number) as [number, number, number]), 0, 0, 0, ZONE_WIEN);

function laufStatus(s: LaufStatus | undefined): 'laeuft' | 'fertig' | 'fehler' | 'wartet' {
  if (!s || s === 'laeuft' || s === 'wartend') return 'laeuft';
  if (s === 'wartet_freigabe') return 'wartet';
  return s === 'fertig' ? 'fertig' : 'fehler';
}

export function freigabeGeraetText(f: FreigabeInfo) {
  const i = (f.inhalt ?? {}) as { pfad?: string; beschreibung?: string };
  const teile: string[] = [];
  if (f.art === 'plan_ausfuehren') {
    const p = f.inhalt as PlanInhalt;
    teile.push(p.zusammenfassung, ...(p.teilaufgaben ?? []).map((t, n) => `${n + 1}. ${t.titel} (${t.gebaeude})`));
  } else {
    if (i.beschreibung) teile.push(i.beschreibung);
    if (i.pfad) teile.push(`Datei: ${i.pfad}`);
  }
  if (f.begruendung) teile.push(f.begruendung);
  return kuerzen(ohneMarkdown(teile.filter(Boolean).join('\n')), 600);
}

export function geraeteRouten(app: FastifyInstance, a: Abhaengigkeiten, o: { geraete: Geraete; drossel: Drossel; einmalig: Einmalig }) {
  const { geraete, drossel } = o;
  const { uhr } = a;

  // ---- App (Sitzungs-Cookie wie alles andere) ----
  app.post('/api/geraete/kopplung', async () => geraete.kopplungStarten());
  app.get('/api/geraete', async () => geraete.liste());
  app.delete('/api/geraete/:id', async (req) => {
    const { id } = z.object({ id: z.string().min(1).max(100) }).parse(req.params);
    if (!geraete.sperren(id)) throw new DorfFehler(404, 'Dieses Gerät gibt es nicht (mehr).');
    return { ok: true };
  });

  // ---- Gerät: koppeln (ohne Schlüssel, gedrosselt wie die Anmeldung) ----
  app.post('/api/geraet/koppeln', async (req, reply) => {
    const b = z.object({ code: z.string().max(20), name: z.string().max(200).optional() }).parse(req.body);
    const d = drossel.pruefen(req.ip);
    if (!d.erlaubt) {
      reply.header('Retry-After', String(d.warteSek));
      throw new DorfFehler(429, `Zu viele Versuche. Bitte ${d.warteSek} Sekunden warten.`, { warteSek: d.warteSek });
    }
    const code = b.code.trim();
    const name = kurz((b.name ?? '').replace(/[\u0000-\u001f\u007f]/g, ''), 40) || 'Cardputer';
    const r = /^\d{6}$/.test(code) ? geraete.koppeln(code, name, req.ip) : null;
    drossel.merken(req.ip, !!r);
    if (!r) throw new DorfFehler(401, 'Code falsch oder abgelaufen – in der App einen neuen holen.');
    return r;
  });

  // Schreibende Aufrufe mit „X-Vorgang“: dieselbe id → gespeicherte Antwort (Funkloch), je Gerät getrennt
  const vorgang = (req: FastifyRequest) => {
    const v = req.headers['x-vorgang'];
    return typeof v === 'string' && /^[A-Za-z0-9._-]{8,64}$/.test(v) ? `geraet:${req.geraet!.id}:${v}` : undefined;
  };
  const schreiben = <T>(pfad: string, f: (req: FastifyRequest) => Promise<T>) => app.post(pfad, async (req) => o.einmalig(vorgang(req), () => f(req)));

  const listen = () => {
    if (!a.listen) throw new DorfFehler(503, 'Die To-do-Liste ist nicht eingerichtet.');
    return a.listen.todo;
  };
  const kirchturm = () => {
    if (!a.kirchturm) throw new DorfFehler(503, 'Der Kirchturm ist nicht eingerichtet.');
    return a.kirchturm;
  };
  const todoAus = (t: TodoInfo) => ({
    id: t.pfad,
    titel: kurz(t.titel, 120),
    faellig: t.faellig ?? null,
    wichtig: !!t.wichtig,
    erledigt: t.erledigt,
    schritte: (t.schritte ?? []).slice(0, 12).map((s) => ({ text: kurz(s.text, 80), erledigt: s.erledigt })),
  });

  /** Termine und Uni-Fristen eines Tages (wie „Heute“: Kalender + Fristen), ganztägige zuerst, dann nach Beginn */
  const tagesTermine = async (tag: string) => {
    const von = mitternacht(tag);
    const bis = mitternacht(tagPlus(tag, 1));
    const aus: { art: 'termin' | 'frist'; text: string; start: number; ende: number; ganztags: boolean; id?: string; erledigt?: boolean }[] = [];
    const k = a.googleKalender ? await a.googleKalender.zeitraum(von, bis).catch(() => null) : null;
    for (const t of k?.termine ?? []) {
      if (t.quelle === 'uni') continue; // Fristen kommen unten direkt aus der Uni (mit „erledigt“)
      if (t.ganztags ? !(t.start <= tag && tag < t.ende) : tagIn(Date.parse(t.start)) !== tag) continue;
      aus.push({ art: 'termin', text: t.titel, start: t.ganztags ? von : Date.parse(t.start), ende: t.ganztags ? bis : Date.parse(t.ende), ganztags: t.ganztags, id: t.id });
    }
    for (const f of a.uni.fristen()) {
      if ((f.art !== 'abgabe' && f.art !== 'test') || !f.frist || tagIn(Date.parse(f.frist)) !== tag) continue;
      const s = Date.parse(f.frist);
      aus.push({ art: 'frist', text: `${f.kurs ? `${f.kurs}: ` : ''}${f.titel}`, start: s, ende: s, ganztags: false, id: f.id, erledigt: f.abgegeben });
    }
    return aus.sort((x, y) => Number(y.ganztags) - Number(x.ganztags) || x.start - y.start);
  };

  const kirchturmLaufend = () => {
    const k = kirchturm().zustand();
    const jetzt = uhr.jetzt();
    const laufend: Record<string, unknown>[] = [];
    const p = k.pomodoro;
    if (p.phase !== 'aus') {
      const ende = p.status === 'laeuft' && p.ende ? Date.parse(p.ende) : null;
      laufend.push({
        id: 'pomodoro',
        art: 'pomodoro',
        titel: kurz(p.einstellungen.thema || 'Pomodoro', 60),
        phase: p.phase === 'arbeit' ? 'fokus' : p.phase,
        endeMs: ende,
        pausiert: p.status !== 'laeuft',
        restMs: ende != null ? Math.max(0, ende - jetzt) : (p.restMs ?? 0),
        runde: p.phase === 'arbeit' ? p.erledigt + 1 : p.erledigt,
      });
    }
    for (const t of k.timer) {
      if (t.status === 'fertig') continue;
      const ende = t.status === 'laeuft' && t.ende ? Date.parse(t.ende) : null;
      laufend.push({ id: t.id, art: 'timer', titel: kurz(t.name, 60), endeMs: ende, pausiert: t.status !== 'laeuft', restMs: ende != null ? Math.max(0, ende - jetzt) : (t.restMs ?? 0) });
    }
    for (const w of k.wecker) {
      if (!w.aktiv || !w.naechster) continue;
      const ende = Date.parse(w.naechster);
      laufend.push({ id: w.id, art: 'wecker', titel: kurz(w.name || `Wecker ${w.zeit}`, 60), endeMs: ende, pausiert: false, restMs: Math.max(0, ende - jetzt) });
    }
    // Stoppuhr: restMs = gemessene Zeit (sie zählt hoch)
    const s = k.stoppuhr;
    if (s.start || s.bisherMs) laufend.push({ id: 'stoppuhr', art: 'stoppuhr', titel: 'Stoppuhr', endeMs: null, pausiert: !s.start, restMs: s.bisherMs + (s.start ? jetzt - Date.parse(s.start) : 0) });
    return { k, laufend: laufend.slice(0, 16) };
  };

  // ---- Übersicht ----
  app.get('/api/geraet/start', async () => {
    const jetzt = uhr.jetzt();
    const heute = tagIn(jetzt);
    const todos = a.listen ? await a.listen.todo.liste() : [];
    const gw = a.gewohnheiten ? await a.gewohnheiten.stand().catch(() => ({ gewohnheiten: [] })) : { gewohnheiten: [] };
    const termine = await tagesTermine(heute).catch(() => []);
    const naechster = termine.find((t) => t.art === 'termin' && !t.ganztags && t.ende > jetzt);
    let fokus: { art: string; phase: string | null; restSek: number } | null = null;
    if (a.kirchturm) {
      const { laufend } = kirchturmLaufend();
      const p = laufend.find((x) => x.art === 'pomodoro');
      const t = laufend.filter((x) => x.art === 'timer' && !x.pausiert).sort((x, y) => (x.restMs as number) - (y.restMs as number))[0];
      const f = p ?? t;
      if (f) fokus = { art: f.art as string, phase: (f.phase as string | undefined) ?? null, restSek: Math.round((f.restMs as number) / 1000) };
    }
    const bmLaeuft = !!a.db
      .prepare("SELECT 1 FROM laeufe l JOIN chats c ON c.id = l.chat_id WHERE c.rolle = 'buergermeister' AND l.status IN ('wartend', 'laeuft') LIMIT 1")
      .get();
    return {
      zeit: Math.floor(jetzt / 1000),
      offsetMin: versatzMinuten(jetzt),
      version: a.konfig.version,
      todosOffen: todos.filter((t) => !t.erledigt).length,
      todosHeute: heuteTodos(todos, heute).length,
      freigaben: a.agenten.freigaben.anzahlOffen(),
      gewohnheitenOffen: gw.gewohnheiten.filter((g) => g.heuteFaellig && !g.heuteErledigt).length,
      termin: naechster ? { zeit: uhrzeitIn(naechster.start), titel: kurz(naechster.text, 60) } : null,
      fokus,
      buergermeister: { laeuft: bmLaeuft },
    };
  });

  app.get('/api/geraet/heute', async () => {
    const jetzt = uhr.jetzt();
    const heute = tagIn(jetzt);
    const zeilen: { art: string; text: string; zeit?: string; id?: string; erledigt: boolean }[] = [];
    for (const t of await tagesTermine(heute))
      zeilen.push({ art: t.art, text: kurz(t.text, 80), ...(t.ganztags ? {} : { zeit: uhrzeitIn(t.start) }), ...(t.art === 'frist' && t.id ? { id: t.id } : {}), erledigt: t.erledigt ?? (!t.ganztags && t.ende <= jetzt) });
    if (a.listen) for (const t of heuteTodos(await a.listen.todo.liste(), heute)) zeilen.push({ art: 'todo', text: kurz(t.titel, 80), id: t.pfad, erledigt: false });
    if (a.gewohnheiten)
      for (const g of (await a.gewohnheiten.stand().catch(() => ({ gewohnheiten: [] }))).gewohnheiten.filter((x) => x.heuteFaellig))
        zeilen.push({ art: 'gewohnheit', text: kurz(g.name, 80), ...(g.uhrzeit ? { zeit: g.uhrzeit } : {}), id: g.name, erledigt: g.heuteErledigt });
    return { zeilen: zeilen.slice(0, 40) };
  });

  // ---- To-dos ----
  app.get('/api/geraet/todos', async (req) => {
    const { ansicht } = z.object({ ansicht: z.enum(['offen', 'heute', 'erledigt']).default('offen') }).parse(req.query);
    const alle = await listen().liste();
    const heute = tagIn(uhr.jetzt());
    const l = ansicht === 'heute' ? heuteTodos(alle, heute) : ansicht === 'erledigt' ? alle.filter((t) => t.erledigt) : alle.filter((t) => !t.erledigt);
    return { todos: l.slice(0, 60).map(todoAus) };
  });
  schreiben('/api/geraet/todos', async (req) => {
    const { text } = z.object({ text: z.string().trim().min(1, 'Text fehlt').max(300) }).parse(req.body);
    const t = await listen().anlegen(geraetTodoAusText(text, tagIn(uhr.jetzt())), 'Cardputer');
    return { todo: todoAus(t) };
  });
  schreiben('/api/geraet/todos/erledigt', async (req) => {
    const b = z.object({ id: z.string().min(1).max(300), erledigt: z.boolean() }).parse(req.body);
    await listen().aendern(b.id, { erledigt: b.erledigt });
    return { ok: true };
  });
  schreiben('/api/geraet/todos/schritt', async (req) => {
    const b = z.object({ id: z.string().min(1).max(300), index: z.number().int().min(0).max(100), erledigt: z.boolean() }).parse(req.body);
    await listen().schrittHaken(b.id, b.index, b.erledigt);
    return { ok: true };
  });
  schreiben('/api/geraet/todos/loeschen', async (req) => {
    const b = z.object({ id: z.string().min(1).max(300) }).parse(req.body);
    await listen().loeschen(b.id);
    return { ok: true };
  });

  // ---- Kalender ----
  app.get('/api/geraet/termine', async (req) => {
    const { tage } = z.object({ tage: z.coerce.number().int().min(1).max(60).default(14) }).parse(req.query);
    if (!a.googleKalender) return { termine: [] };
    const heute = tagIn(uhr.jetzt());
    const k = await a.googleKalender.zeitraum(mitternacht(heute), mitternacht(tagPlus(heute, tage)));
    const termine = k.termine
      .filter((t) => t.quelle !== 'uni')
      .map((t) => {
        const s = t.ganztags ? 0 : Date.parse(t.start);
        return {
          datum: t.ganztags ? (t.start < heute ? heute : t.start) : tagIn(s),
          zeit: t.ganztags ? '' : uhrzeitIn(s),
          ende: t.ganztags ? '' : uhrzeitIn(Date.parse(t.ende)),
          titel: kurz(t.titel, 80),
          ort: kurz(t.ort ?? '', 60),
          s,
        };
      })
      .sort((x, y) => x.datum.localeCompare(y.datum) || x.s - y.s)
      .slice(0, 60)
      .map(({ s: _s, ...t }) => t);
    return { termine };
  });
  // Leif legt am Gerät selbst an → direkt in den Hauptkalender (wie /api/kalender/termin), ohne Einladungen
  schreiben('/api/geraet/termine', async (req) => {
    if (!a.googleKalender) throw new DorfFehler(409, 'Kein Kalender verbunden.');
    const b = z.object({ titel: z.string(), datum: z.string(), zeit: z.string().max(5).optional(), dauerMin: z.number().int().optional() }).parse(req.body);
    await a.googleKalender.inHauptkalender(terminAusAngaben(b));
    return { ok: true };
  });

  // ---- Kirchturm ----
  app.get('/api/geraet/kirchturm', async () => {
    const { k, laufend } = kirchturmLaufend();
    const e = k.pomodoro.einstellungen;
    return {
      jetztMs: uhr.jetzt(),
      laufend,
      klingelt: k.klingelt.slice(-8).map((x) => ({ id: x.id, titel: kurz(x.titel, 60) })),
      pomodoro: { fokus: e.arbeitMin, kurz: e.kurzMin, lang: e.langMin, langNach: e.langNach },
    };
  });
  schreiben('/api/geraet/kirchturm', async (req) => {
    const b = z
      .object({
        aktion: z.enum(['pomodoro', 'timer', 'wecker', 'stopp', 'pause', 'weiter', 'naechste', 'leise']),
        titel: z.string().trim().max(60).optional(),
        minuten: z.number().int().min(1).max(1440).optional(),
        zeit: z.string().trim().max(5).optional(),
        id: z.string().max(100).optional(),
      })
      .parse(req.body);
    const k = kirchturm();
    const z1 = k.zustand();
    switch (b.aktion) {
      case 'pomodoro':
        k.ausfuehren(b.titel ? { befehl: 'pomodoro_fuer', titel: b.titel } : { befehl: 'pomodoro', aktion: 'start' });
        break;
      case 'timer':
        if (!b.minuten) throw new DorfFehler(400, 'Wie viele Minuten?');
        k.ausfuehren({ befehl: 'timer_start', name: b.titel ?? '', dauerMs: b.minuten * 60_000 });
        break;
      case 'wecker':
        if (!b.zeit) throw new DorfFehler(400, 'Uhrzeit fehlt (HH:MM).');
        k.ausfuehren({ befehl: 'wecker_speichern', name: b.titel ?? '', zeit: b.zeit.padStart(5, '0'), tage: [] });
        break;
      case 'leise':
        if (!b.id) k.ausfuehren({ befehl: 'alle_aus' });
        else if (z1.klingelt.some((x) => x.id === b.id)) k.ausfuehren({ befehl: 'klingel', id: b.id, aktion: 'aus' });
        break;
      default: {
        const id = b.id ?? 'pomodoro';
        const a2 = b.aktion;
        if (id === 'pomodoro') {
          const p = z1.pomodoro;
          const aktion = a2 === 'naechste' ? 'ueberspringen' : a2 === 'weiter' && p.status === 'wartet' ? 'start' : a2;
          k.ausfuehren({ befehl: 'pomodoro', aktion });
        } else if (id === 'stoppuhr') {
          if (a2 === 'naechste') throw new DorfFehler(400, 'Bei der Stoppuhr gibt es keine nächste Phase.');
          k.ausfuehren({ befehl: 'stoppuhr', aktion: a2 === 'stopp' ? 'zuruecksetzen' : a2 === 'pause' ? 'stopp' : 'start' });
        } else if (z1.timer.some((t) => t.id === id)) {
          if (a2 === 'naechste') throw new DorfFehler(400, 'Ein Timer hat keine nächste Phase.');
          k.ausfuehren({ befehl: 'timer', id, aktion: a2 === 'stopp' ? 'loeschen' : a2 });
        } else if (z1.wecker.some((w) => w.id === id)) {
          if (a2 !== 'stopp') throw new DorfFehler(400, 'Einen Wecker kann man nur löschen (stopp).');
          k.ausfuehren({ befehl: 'wecker_loeschen', id });
        } else throw new DorfFehler(404, 'Das läuft nicht (mehr).');
      }
    }
    return { ok: true };
  });
  schreiben('/api/geraet/kirchturm/einstellungen', async (req) => {
    const b = z
      .object({ fokus: z.number().int().min(1).max(240).optional(), kurz: z.number().int().min(1).max(120).optional(), lang: z.number().int().min(1).max(240).optional(), langNach: z.number().int().min(1).max(20).optional() })
      .parse(req.body);
    const k = kirchturm();
    const e = k.zustand().pomodoro.einstellungen;
    k.ausfuehren({
      befehl: 'pomodoro_einstellen',
      einstellungen: { ...e, arbeitMin: b.fokus ?? e.arbeitMin, kurzMin: b.kurz ?? e.kurzMin, langMin: b.lang ?? e.langMin, langNach: b.langNach ?? e.langNach },
    });
    return { ok: true };
  });

  // ---- Bürgermeister ----
  const bmChat = (id: string) => {
    const c = a.agenten.chatZeile(id);
    if (c.rolle !== 'buergermeister') throw new DorfFehler(404, 'Chat nicht gefunden.');
    return c;
  };
  schreiben('/api/geraet/buergermeister', async (req) => {
    const b = z.object({ text: z.string().trim().min(1, 'Text fehlt').max(4000), chatId: z.string().min(1).max(100).optional() }).parse(req.body);
    if (b.chatId) {
      const c = bmChat(b.chatId);
      a.agenten.nachrichtSenden(c.id, b.text, 'klick');
      return { chatId: c.id };
    }
    // wie eine Aufgabe aus der App: auf den Schreibtisch, der Bürgermeister legt sofort los
    const auf = await a.schreibtisch.anlegen({ text: b.text, quelle: 'app' });
    const r = await a.buergermeister.starten(auf.id, 'klick');
    return { chatId: r.chatId };
  });
  app.get('/api/geraet/buergermeister', async () => {
    const heute = tagIn(uhr.jetzt());
    const chats = a.agenten
      .chatListe()
      .filter((c) => c.rolle === 'buergermeister')
      .slice(0, 10)
      .map((c) => {
        const t = Date.parse(c.geaendert);
        return {
          chatId: c.id,
          titel: kurz(c.titel.replace(/^Bürgermeister:\s*/, ''), 60),
          status: laufStatus(c.status),
          zeit: tagIn(t) === heute ? uhrzeitIn(t) : new Date(t).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', timeZone: ZONE_WIEN }),
        };
      });
    return { chats };
  });
  app.get('/api/geraet/buergermeister/:chatId', async (req) => {
    const { chatId } = z.object({ chatId: z.string().min(1).max(100) }).parse(req.params);
    const c = bmChat(chatId);
    const d = a.agenten.chatDetail(c.id);
    // Die erste Nachricht ist der ganze Auftrag an den Bürgermeister – am Gerät steht stattdessen Leifs Aufgabe
    let aufgabe: string | null = null;
    if (c.schreibtisch_id) {
      const i = await a.schreibtisch.inhalt(c.schreibtisch_id).catch(() => null);
      aufgabe = i ? (i.fremd ? a.schreibtisch.holen(c.schreibtisch_id).titel : i.text) : null;
    }
    const erste = d.nachrichten.find((n) => n.rolle === 'nutzer')?.id;
    const nachrichten = d.nachrichten
      .filter((n) => n.rolle === 'nutzer' || n.rolle === 'agent' || n.rolle === 'hinweis')
      .slice(-20)
      .map((n) => {
        if (n.rolle === 'nutzer') return { von: 'du', text: kuerzen(n.id === erste && aufgabe ? aufgabe : n.text, 1500) };
        // wie Telegram: ohne den Abschnitt „## Zusammenfassung“ (der ist fürs Protokoll)
        const ohne = n.text.split(/^##\s*Zusammenfassung/m)[0]!.trim() || n.text;
        return { von: 'bm', text: kuerzen(ohneMarkdown(ohne), 1500) };
      });
    return { status: laufStatus(d.status), nachrichten };
  });

  // ---- Freigaben ----
  app.get('/api/geraet/freigaben', async () => ({
    freigaben: a.agenten.freigaben
      .liste('offen')
      .slice(0, 20)
      .map((f) => ({ id: f.id, titel: kurz(f.titel, 120), gebaeude: f.gebaeude, text: freigabeGeraetText(f) })),
  }));
  schreiben('/api/geraet/freigaben/entscheiden', async (req) => {
    const b = z.object({ id: z.string().min(1).max(100), entscheidung: z.enum(['ja', 'nein']), begruendung: z.string().max(2000).optional() }).parse(req.body);
    await a.agenten.freigaben.entscheiden(b.id, b.entscheidung === 'ja', 'leif', b.begruendung);
    return { ok: true };
  });

  // ---- E194: Spracheingabe – WAV vom Cardputer → Text (whisper.cpp im Rechenraum, ohne Cloud; nichts wird gespeichert) ----
  if (!app.hasContentTypeParser('audio/wav'))
    app.addContentTypeParser(['audio/wav', 'audio/x-wav', 'audio/wave'], { parseAs: 'buffer', bodyLimit: SPRACHE_MAX_BYTES }, (_req, body, fertig) => fertig(null, body));
  app.post('/api/geraet/sprache', { bodyLimit: SPRACHE_MAX_BYTES }, async (req) => {
    const rr = a.agenten.rechenraum;
    if (!rr) throw new DorfFehler(503, 'Die Spracherkennung ist gerade nicht verfügbar (Rechenraum fehlt).');
    const wav = req.body;
    if (!Buffer.isBuffer(wav) || wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE')
      throw new DorfFehler(400, 'Keine gültige WAV-Aufnahme.');
    const e = await rr.umwandeln('sprache.wav', wav);
    return { text: transkriptAus(e.text) };
  });

  // ---- Weiteres ----
  app.get('/api/geraet/gewohnheiten', async () => {
    if (!a.gewohnheiten) return { gewohnheiten: [] };
    const s = await a.gewohnheiten.stand();
    return {
      gewohnheiten: [...s.gewohnheiten]
        .sort((x, y) => Number(y.heuteFaellig) - Number(x.heuteFaellig))
        .slice(0, 30)
        .map((g) => ({ name: g.name, erledigt: g.heuteErledigt, serie: g.serie })),
    };
  });
  schreiben('/api/geraet/gewohnheiten', async (req) => {
    if (!a.gewohnheiten) throw new DorfFehler(503, 'Gewohnheiten sind nicht eingerichtet.');
    const b = z.object({ name: z.string().min(1).max(200), erledigt: z.boolean() }).parse(req.body);
    await a.gewohnheiten.haken(b.name, b.erledigt);
    return { ok: true };
  });
  schreiben('/api/geraet/notiz', async (req) => {
    if (!a.notizen) throw new DorfFehler(503, 'Notizen sind nicht eingerichtet.');
    const { text } = z.object({ text: z.string().trim().min(1, 'Die Notiz ist leer.').max(2000) }).parse(req.body);
    await a.notizen.hinzufuegen(text, 'Cardputer');
    return { ok: true };
  });
  app.get('/api/geraet/fristen', async () => {
    const bis = uhr.jetzt() + 14 * 86_400_000;
    return {
      fristen: a.uni
        .fristen()
        .filter((f) => (f.art === 'abgabe' || f.art === 'test') && f.frist && Date.parse(f.frist) <= bis)
        .slice(0, 40)
        .map((f) => ({ titel: kurz(f.titel, 120), fach: kurz(f.kurs, 60), faellig: ortIso(Date.parse(f.frist!)), erledigt: f.abgegeben })),
    };
  });
  app.get('/api/geraet/post', async () => {
    const ab = mitternacht(tagPlus(tagIn(uhr.jetzt()), -1));
    return {
      mails: a.postbote
        .uebersicht()
        .mails.filter((m) => Date.parse(m.datum) >= ab)
        .slice(0, 20)
        .map((m) => ({ von: kurz(m.von, 60), betreff: kurz(m.betreff, 120), zusammenfassung: kurz(m.zusammenfassung ?? '', 300), antwortNoetig: m.antwortNoetig })),
    };
  });
}

/** E194: höchstens ≈ 60 s Sprache (16 kHz, 16 Bit, mono = 32 KB/s) */
export const SPRACHE_MAX_BYTES = 2 * 1024 * 1024;

/** Nur das Transkript aus dem Umwandeln-Ergebnis (ohne Metadaten-Abschnitte und Hinweis-Zeilen) */
export function transkriptAus(md: string): string {
  const m = /## Transkript[^\n]*\n([\s\S]*?)(?=\n## |$)/.exec(md);
  const t = (m?.[1] ?? '').trim();
  if (!t || t === '(keine Sprache erkannt)') return '';
  // whisper markiert Stille/Geräusche als [BLANK_AUDIO], (Musik) …
  return t.replace(/\[[A-Z_ ]+\]|\((?:Musik|Music|Applaus|Lachen|Stille)\)/gi, '').replace(/\s+/g, ' ').trim();
}
