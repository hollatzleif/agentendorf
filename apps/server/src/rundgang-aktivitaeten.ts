import path from 'node:path';
import matter from 'gray-matter';
import type { TodoInfo, UniFach, UniFrist } from '@dorf/shared';
import type { Aktivitaet, RundgangQuellen } from './rundgang.js';
import type { VaultDienst } from './vault/dienst.js';
import { aktionenListe } from './agenten/aktionen.js';
import { adresseZerlegen, Kontakte, KONTAKTE_PFAD } from './kontakte.js';
import { faelligAm, GEWOHNHEITEN_PFAD, proWoche } from './gewohnheiten.js';
import { fokusNachTageszeit } from './statistik.js';
import { kalenderwoche } from './wochenrueckblick.js';
import { ortszeitZuUtc } from './uni/ical.js';
import { einzeilig, fristText } from './uni/text.js';
import { tagIn, tagPlus, uhrzeitIn, ZONE_WIEN } from './zeit.js';

/**
 * E200: die übrigen Aktivitäten aus docs/buergermeister-aktivitaeten.md – nach Nutzen sortiert (Reihenfolge = Rang bei
 * Gleichstand). Wie in E192 sammelt der Code zu jeder die Fakten ohne KI; ohne Anlass wird sie nicht gewählt. Die
 * Fakten-Sammler schließen aus, was schon erledigt ist (Marker in der To-do-Notiz, vorhandene Datei, „seit“ = letzter
 * Lauf), damit dieselbe Lage nicht jeden Tag einen bezahlten Lauf auslöst.
 * Leine wie immer: Schreiben nur in Rathaus/, auf Leifs Listen (Papierkorb), als Mail-Entwurf oder mit „Rückgängig“.
 */
const STUNDE = 3_600_000;
const TAG = 24 * STUNDE;
const kurz = (t: string, n = 100) => einzeilig(t, n);
const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;
const wochentagVon = (tag: string) => new Date(`${tag}T12:00:00Z`).getUTCDay();
const stundeIn = (ms: number) => Number(uhrzeitIn(ms).slice(0, 2));

/** Beginn eines Kalendertags in Wien (ms) */
export function tagBeginn(tag: string) {
  const [j, m, t] = tag.split('-').map(Number) as [number, number, number];
  return ortszeitZuUtc(j, m, t, 0, 0, 0, ZONE_WIEN);
}

/** Vormonat als JJJJ-MM */
export function vormonat(tag: string) {
  const [j, m] = tag.split('-').map(Number) as [number, number];
  return m === 1 ? `${j - 1}-12` : `${j}-${String(m - 1).padStart(2, '0')}`;
}

const AUSGELASSEN = new Set(['protokolle', 'chats', 'archiv', 'node_modules']);
/** Alle Dateien im Vault (ohne Protokolle, Chats, Archive und Versteckte) – höchstens max */
export async function vaultDateien(vault: VaultDienst, max = 5000): Promise<string[]> {
  const alle: string[] = [];
  const laufen = async (rel: string) => {
    if (alle.length >= max) return;
    for (const n of await vault.namen(rel).catch(() => [])) {
      const k = rel ? `${rel}/${n.name}` : n.name;
      if (n.ordner) {
        if (!AUSGELASSEN.has(n.name)) await laufen(k);
      } else if (alle.length < max) alle.push(k);
    }
  };
  await laufen('');
  return alle;
}

/** Dateinamen in einem Ordner (leer, wenn es ihn nicht gibt) */
async function namenIn(vault: VaultDienst, ordner: string) {
  return (await vault.namen(ordner).catch(() => [])).filter((n) => n.datei).map((n) => n.name);
}

/** Zu welchem Fach gehört eine Frist? Ordner aus Moodle, sonst Kurs- oder Titelname. */
export function fachZuFrist(faecher: UniFach[], f: Pick<UniFrist, 'pfad' | 'kurs' | 'titel'>): UniFach | null {
  if (f.pfad) {
    const p = faecher.find((x) => f.pfad === x.ordner || f.pfad!.startsWith(`${x.ordner}/`));
    if (p) return p;
  }
  const kurs = norm(f.kurs);
  const titel = norm(f.titel);
  return (
    faecher.find((x) => {
      const namen = [norm(x.name), norm(x.titel)].filter((n) => n.length >= 3);
      return namen.some((n) => (kurs && (kurs.includes(n) || n.includes(kurs))) || titel.includes(n));
    }) ?? null
  );
}

/** Marker in einer To-do-Notiz („Nachfass-Entwurf 2026-11-20 …“) – jüngstes Datum oder null */
function markerDatum(notiz: string | undefined, wort: string) {
  const d = [...(notiz ?? '').matchAll(new RegExp(`${wort} (\\d{4}-\\d{2}-\\d{2})`, 'g'))].map((m) => m[1]!).sort();
  return d.at(-1) ?? null;
}

/** „TT.MM.JJJJ“ bzw. „TT.MM.JJJJ HH:MM“ (Postbote) → JJJJ-MM-TT */
export function mailFristTag(frist: string | null | undefined) {
  const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(frist ?? '');
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null;
}

/** Vereinigte Minuten mehrerer Zeitspannen innerhalb [von, bis] */
function minutenBelegt(spannen: { start: number; ende: number }[], von: number, bis: number) {
  const s = spannen
    .map((x) => ({ start: Math.max(x.start, von), ende: Math.min(x.ende, bis) }))
    .filter((x) => x.ende > x.start)
    .sort((a, b) => a.start - b.start);
  let summe = 0;
  let ende = -Infinity;
  for (const x of s) {
    if (x.start > ende) {
      summe += x.ende - x.start;
      ende = x.ende;
    } else if (x.ende > ende) {
      summe += x.ende - ende;
      ende = x.ende;
    }
  }
  return Math.round(summe / 60_000);
}

const stunden = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} h`;

/** Termine und fällige To-dos eines Tages (für „Volle Tage“ und die Wochenvorschau) */
function tagesLast(tag: string, termineAlle: { start: number; ende: number | null; ganztags: boolean; titel: string; quelle: string; erledigt?: boolean }[], todos: TodoInfo[]) {
  const von = tagBeginn(tag);
  const bis = tagBeginn(tagPlus(tag, 1));
  const termine = termineAlle.filter((t) => !t.erledigt && t.start < bis && (t.ende ?? t.start) >= von).sort((a, b) => a.start - b.start);
  // nur, was Zeit braucht: Termine mit Dauer zwischen 7 und 22 Uhr
  const terminMin = minutenBelegt(
    termine.filter((t) => !t.ganztags && t.ende).map((t) => ({ start: t.start, ende: t.ende! })),
    von + 7 * STUNDE,
    von + 22 * STUNDE,
  );
  const faellig = todos.filter((t) => t.faellig === tag);
  const todoMin = faellig.reduce((s, t) => s + (t.dauer ?? 30), 0);
  return { termine, terminMin, faellig, todoMin };
}

// ---- Katalog-Teil E200 ------------------------------------------------------------------------------

export const WEITERE_AKTIVITAETEN: Aktivitaet[] = [
  {
    id: 'wartet-nachfassen',
    titel: '„Wartet auf …“ nachfassen',
    gruppe: 'Aufträge',
    haeufigkeit: 'täglich',
    gewicht: 'mittel',
    nachts: true,
    ergebnis: 'Nachfass-Entwurf in Gmail (nie gesendet), Hinweis in der Notiz des To-dos',
    auftrag:
      'Bei diesen To-dos wartet Leif auf jemanden, und der Nachfass-Tag ist erreicht. Je To-do (höchstens drei): Finde heraus, an wen es geht (kontakt_suchen mit dem Namen aus „wartet auf“) und worum (post_suchen nach dem Thema, letzte Mail mit post_lesen). Sind Adresse und Anlass klar, leg einen kurzen, höflichen Nachfass-Entwurf an – als Antwort auf die letzte Mail (post_entwurf) oder neu (post_entwurf_neu); gesendet wird nie. Danach ergänzt du die Notiz des To-dos (todo_bearbeiten, nur das Feld notiz, vorhandene Notiz erhalten) um die Zeile „Nachfass-Entwurf JJJJ-MM-TT liegt in Gmail bereit (an …)“. Ist unklar, an wen oder worum es geht: kein Entwurf, sondern die Zeile „Nachfass-Entwurf JJJJ-MM-TT: nicht angelegt – <was fehlt>“. Titel, Datum, „wartet“ und Haken fasst du nicht an.',
    fakten: async (q) => {
      if (!q.todos) return null;
      const heute = tagIn(q.uhr.jetzt());
      const t = (await q.todos.liste())
        .filter((x) => !x.erledigt && x.wartet && x.faellig && x.faellig <= heute)
        .filter((x) => {
          const zuletzt = markerDatum(x.notiz, 'Nachfass-Entwurf');
          return !zuletzt || zuletzt < tagPlus(heute, -7);
        })
        .slice(0, 6);
      return t.length ? t.map((x) => `„${kurz(x.titel, 80)}“ – wartet auf ${kurz(x.wartet!, 60)}${x.wartetSeit ? ` seit ${x.wartetSeit.slice(0, 10)}` : ''} – Nachfass-Tag ${x.faellig} – ${x.pfad}`) : null;
    },
  },
  {
    id: 'mail-fristen',
    titel: 'Fristen aus Mails sichern',
    gruppe: 'Post',
    haeufigkeit: 'täglich',
    gewicht: 'klein',
    nachts: true,
    ergebnis: 'To-do mit Fälligkeit auf Leifs Liste',
    auftrag:
      'In diesen Mails hat der Postbote eine Frist erkannt, und auf Leifs Listen steht dazu noch nichts. Je Mail (höchstens drei; vorher todo_liste prüfen, bei Corps-Mails auch die Liste corps): Lies sie kurz (post_lesen). Ist die Frist echt und betrifft Leif (Anmeldung, Rückmeldung, Abgabe, Zahlung, Zusage), leg ein To-do an – Titel mit dem, was zu tun ist; faellig = Tag der Frist (bei Anmeldungen einen Tag früher); in der Notiz Absender, Betreff und mail_id. Werbung, Rabatt-Aktionen und Fristen, die nur informieren, lässt du weg. Du antwortest, zahlst und meldest nichts an.',
    fakten: async (q, seit) => {
      const jetzt = q.uhr.jetzt();
      const heute = tagIn(jetzt);
      const mails = q.db
        .prepare(
          `SELECT id, von, betreff, frist FROM post_mails
           WHERE frist IS NOT NULL AND frist != '' AND rechnung_todo IS NULL AND eingeordnet IS NOT NULL AND eingeordnet >= ? AND datum >= ?
           ORDER BY datum DESC LIMIT 40`,
        )
        .all(seit, jetzt - 21 * TAG) as { id: string; von: string; betreff: string; frist: string }[];
      if (!mails.length) return null;
      const offen = (await q.todos?.liste().catch(() => [])) ?? [];
      const bekannt = offen.filter((t) => !t.erledigt).map((t) => norm(`${t.titel} ${t.notiz ?? ''}`));
      const z = mails
        .filter((m) => {
          const tag = mailFristTag(m.frist);
          if (!tag || tag < heute) return false;
          const b = norm(m.betreff).slice(0, 40);
          return !bekannt.some((t) => t.includes(norm(m.id)) || (b.length >= 8 && t.includes(b)));
        })
        .slice(0, 6);
      return z.length ? z.map((m) => `Frist ${kurz(m.frist, 20)} · ${kurz(m.von, 60)} – „${kurz(m.betreff)}“ (mail_id ${m.id})`) : null;
    },
  },
  {
    id: 'abgaben-nachlese',
    titel: 'Abgaben-Nachlese',
    gruppe: 'Uni',
    haeufigkeit: 'täglich',
    gewicht: 'klein',
    nachts: true,
    ergebnis: 'Zeile „Nachlese …“ in der Notiz des Uni-To-dos, ggf. „Für Leif“',
    auftrag:
      'Die Frist dieser Abgaben bzw. Prüfungen ist seit zwei bis sieben Tagen vorbei, Leifs To-do dazu ist aber nicht abgehakt. Sieh je Punkt im Fachordner nach (vault_liste/vault_lesen: neueste „moodle-stand“-Notiz, aufgaben/, abgegeben/): Spricht etwas dafür, dass abgegeben wurde? Ergänze die Notiz des To-dos (todo_bearbeiten, nur das Feld notiz, Vorhandenes erhalten) um die Zeile „Nachlese JJJJ-MM-TT: …“ – „laut <Quelle> abgegeben, bitte abhaken“ oder „keine Abgabe gefunden – abgegeben? Sonst Nachfrist klären“; bei Prüfungen „Note in Uni/noten.md eintragen, sobald sie da ist“. Du hakst nichts ab und gibst nichts ab. Fehlt vermutlich eine Abgabe, nenn sie in „Für Leif“.',
    fakten: async (q) => {
      if (!q.todos) return null;
      const jetzt = q.uhr.jetzt();
      const reihen = q.db
        .prepare(
          `SELECT u.pfad, u.frist, f.titel, f.kurs, f.art, f.abgegeben FROM uni_todos u LEFT JOIN moodle_fristen f ON f.id = u.frist_id
           WHERE u.frist BETWEEN ? AND ? ORDER BY u.frist LIMIT 20`,
        )
        .all(jetzt - 7 * TAG, jetzt - 36 * STUNDE) as { pfad: string; frist: number; titel: string | null; kurs: string | null; art: string | null; abgegeben: number | null }[];
      const z: string[] = [];
      for (const r of reihen) {
        if (r.abgegeben) continue;
        const t = await q.todos.holen(r.pfad).catch(() => null);
        if (!t || t.erledigt || markerDatum(t.notiz, 'Nachlese')) continue;
        z.push(`${r.art === 'test' ? 'Prüfung' : 'Abgabe'} „${kurz(r.titel ?? t.titel, 80)}“${r.kurs ? ` (${kurz(r.kurs, 40)})` : ''} – Frist war ${fristText(r.frist)} – To-do noch offen: ${t.pfad}`);
      }
      return z.length ? z.slice(0, 6) : null;
    },
  },
  {
    id: 'pruefungs-countdown',
    titel: 'Prüfungs-Countdown',
    gruppe: 'Uni',
    haeufigkeit: 'täglich',
    gewicht: 'mittel',
    nachts: true,
    ergebnis: 'Rathaus/vorbereitung/JJJJ-MM-TT_HHMM_<fach>-pruefungsplan.md (Vorschlag, nichts eingetragen)',
    auftrag:
      'Für diese Prüfung ist eine Countdown-Stufe erreicht. Stufe 14 Tage: Schreib einen Lernplan-Vorschlag nach Rathaus/vorbereitung/ (Dateiname nach Schema, endet auf „-pruefungsplan.md“) – Prüfungsstoff aus dem Fachordner (folien/, Kursübersicht, Uni/lernziele.md), verteilt als Themen × Tage bis zur Prüfung, mit Wiederholungstagen und einem Puffertag. Mit freie_zeiten siehst du, wo Platz ist – du trägst aber NICHTS ein (Leif übernimmt den Plan mit „Lernplan“ in der App). Stufe 7 und 3 Tage: Gibt es den Plan schon (vault_liste Rathaus/vorbereitung/), ergänze ihn mit vault_aendern um „Stand JJJJ-MM-TT: was noch fehlt, worauf jetzt der Fokus liegt“ (Karteikarten, Lernsitzungen); sonst leg einen kurzen an. Starte weder „Lernen“ noch einen Helfer.',
    fakten: async (q, seit) => {
      const jetzt = q.uhr.jetzt();
      const stufen = [14, 7, 3];
      const z: string[] = [];
      for (const f of q.uni.fristen().filter((x) => x.art === 'test' && !x.abgegeben && x.frist)) {
        const t = Date.parse(f.frist!);
        const rest = (t - jetzt) / TAG;
        const stufe = stufen.find((s, i) => rest <= s && rest > (stufen[i + 1] ?? 1));
        // diese Stufe war beim letzten Lauf schon erreicht → schon erledigt
        if (!stufe || (t - seit) / TAG <= stufe) continue;
        z.push(`Prüfung „${kurz(f.titel)}“${f.kurs ? ` (${kurz(f.kurs, 40)})` : ''} – ${fristText(t)} · Stufe: ${stufe} Tage vorher${f.pfad ? ` · Ordner: ${f.pfad}` : ''}`);
      }
      return z.length ? z.slice(0, 3) : null;
    },
  },
  {
    id: 'helfer-gegenlesen',
    titel: 'Helfer-Ergebnisse gegenlesen',
    gruppe: 'Aufträge',
    haeufigkeit: 'täglich',
    gewicht: 'klein',
    nachts: true,
    ergebnis: 'eigene To-do-Liste, höchstens ein neuer Versuch',
    auftrag:
      'Diese Helfer sind fertig, aber ihr Ergebnis sieht unvollständig aus (keine Datei abgelegt oder Datei fast leer). Je Helfer: Lies das Protokoll bzw. den Chat (vault_suchen nach dem Titel in <Gebäude>/protokolle/) und die genannte Datei. Ist das Ergebnis doch brauchbar (z. B. steht es in der Antwort), tu nichts. Fehlt es wirklich, halte Ursache und Stand als eigenes To-do fest (meine_todos_anlegen mit wieder_am, Bezug: Titel des Helfers). Höchstens EIN neuer Versuch (helfer_starten mit klarerem Auftrag) – nur wenn die Ursache klar behoben ist und nie für „Abgabe bearbeiten“ oder „Lernen“. Fehlt Leif ein angekündigtes Ergebnis, sag es in „Für Leif“.',
    fakten: async (q, seit) => {
      const jetzt = q.uhr.jetzt();
      const helfer = q.db
        .prepare(
          `SELECT c.id, c.titel, c.gebaeude, c.aktion, c.werkzeuge_json AS w FROM chats c JOIN laeufe l ON l.chat_id = c.id
           WHERE c.eltern_chat_id IS NOT NULL AND l.status = 'fertig' AND l.ende >= ? AND l.nummer = (SELECT MAX(nummer) FROM laeufe x WHERE x.chat_id = c.id)
           ORDER BY l.ende DESC LIMIT 10`,
        )
        .all(Math.max(seit, jetzt - 2 * TAG)) as { id: string; titel: string; gebaeude: string; aktion: string | null; w: string }[];
      const z: string[] = [];
      for (const h of helfer) {
        const dateien = (q.db.prepare("SELECT DISTINCT pfad FROM werkzeug_log WHERE chat_id = ? AND art = 'geschrieben' AND erlaubt = 1 AND pfad IS NOT NULL").all(h.id) as { pfad: string }[]).map((x) => x.pfad);
        const name = `„${kurz(h.titel, 80)}“ (${h.gebaeude}${h.aktion ? `, ${h.aktion}` : ''})`;
        if (!dateien.length) {
          if (/"vault_schreiben"/.test(h.w)) z.push(`${name} – fertig, aber keine Datei abgelegt`);
          continue;
        }
        for (const p of dateien.filter((x) => x.endsWith('.md')).slice(0, 5)) {
          const d = await q.vault.lesen(p).catch(() => null);
          if (!d) continue; // verschoben/abgelegt – kein Befund
          const rumpf = d.inhalt.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
          if (rumpf.length < 200) z.push(`${name} – Datei fast leer (${rumpf.length} Zeichen): ${p}`);
        }
      }
      return z.length ? z.slice(0, 6) : null;
    },
  },
  {
    id: 'volle-tage',
    titel: 'Volle Tage erkennen',
    gruppe: 'Kalender',
    haeufigkeit: 'täglich',
    gewicht: 'klein',
    nachts: true,
    ergebnis: 'Zeile in Leifs Tagesnotiz (Rathaus/notizen/)',
    auftrag:
      'An diesen Tagen ist mehr geplant, als in einen Tag passt (über sechs Stunden Termine und fällige To-dos). Schlag je Tag vor, was sich verschieben ließe – zuerst To-dos ohne ⭐ und ohne harte Frist; nie Prüfungen, Abgaben oder Termine mit anderen Menschen. Schreib den Vorschlag als EINE Zeile je Tag in Leifs Tagesnotiz (notiz_anlegen, z. B. „Mittwoch voll (7:30 h): Vorschlag – ‚X‘ auf Freitag, ‚Y‘ auf nächste Woche“). Du verschiebst selbst nichts: keine Fälligkeit und keinen Termin ändern.',
    fakten: async (q, seit) => {
      const jetzt = q.uhr.jetzt();
      const heute = tagIn(jetzt);
      // morgen und übermorgen – ohne die Tage, die der letzte Lauf schon angesehen hat
      const bisher = seit ? tagPlus(tagIn(seit), 2) : '';
      const tage = [tagPlus(heute, 1), tagPlus(heute, 2)].filter((t) => t > bisher);
      if (!tage.length) return null;
      const termine = q.kalender ? await q.kalender(tagBeginn(tage[0]!), tagBeginn(tagPlus(tage.at(-1)!, 1))) : [];
      const todos = ((await q.todos?.liste()) ?? []).filter((t) => !t.erledigt && !t.wartet);
      const z: string[] = [];
      for (const tag of tage) {
        const l = tagesLast(tag, termine, todos);
        if (l.terminMin + l.todoMin <= 360) continue;
        z.push(`${WOCHENTAGE[wochentagVon(tag)]} ${tag}: ${stunden(l.terminMin + l.todoMin)} – Termine ${stunden(l.terminMin)}, ${l.faellig.length} fällige To-dos (~${stunden(l.todoMin)})`);
        for (const t of l.termine.slice(0, 8)) z.push(`  Termin ${t.ganztags ? 'ganztägig' : `${uhrzeitIn(t.start)}${t.ende ? `–${uhrzeitIn(t.ende)}` : ''}`} · ${t.quelle}: ${kurz(t.titel, 70)}`);
        for (const t of l.faellig.slice(0, 8)) z.push(`  To-do „${kurz(t.titel, 70)}“${t.wichtig ? ' ⭐' : ''}${t.dauer ? ` (${t.dauer} min)` : ' (ohne Schätzung: 30 min)'} – ${t.pfad}`);
      }
      return z.length ? z : null;
    },
  },
  {
    id: 'dauer-schaetzen',
    titel: 'Dauer schätzen',
    gruppe: 'To-dos',
    haeufigkeit: 'wöchentlich',
    gewicht: 'klein',
    nachts: true,
    ergebnis: 'Feld „dauer“ an Leifs To-dos',
    auftrag:
      'Diese To-dos der nächsten sieben Tage haben keine geschätzte Dauer – „Tag planen“ und „Heute“ rechnen dann falsch. Schätze je To-do realistisch (5–600 Minuten, auf 5 Minuten gerundet; Teilschritte und Notiz helfen; im Zweifel eher großzügig) und trag die Schätzung mit todo_bearbeiten ein – NUR das Feld dauer. Titel, Datum, Notiz und Haken bleiben.',
    fakten: async (q) => {
      if (!q.todos) return null;
      const heute = tagIn(q.uhr.jetzt());
      const bis = tagPlus(heute, 7);
      const t = (await q.todos.liste()).filter((x) => !x.erledigt && !x.wartet && !x.dauer && x.faellig && x.faellig >= heute && x.faellig <= bis).slice(0, 12);
      return t.length >= 2 ? t.map((x) => `„${kurz(x.titel, 80)}“ – fällig ${x.faellig}${x.schritte?.length ? ` – ${x.schritte.length} Teilschritte` : ''} – ${x.pfad}`) : null;
    },
  },
  {
    id: 'altklausuren',
    titel: 'Altklausuren-Lücken',
    gruppe: 'Uni',
    haeufigkeit: 'wöchentlich',
    gewicht: 'klein',
    nachts: true,
    ergebnis: 'To-do „Altklausuren besorgen: <Fach>“',
    auftrag:
      'Für diese Fächer steht eine Prüfung an, aber im Ordner altklausuren/ liegt nichts. Leg je Fach EIN To-do an (vorher todo_liste prüfen): Titel „Altklausuren besorgen: <Fach>“, fällig etwa drei Wochen vor der Prüfung (frühestens morgen); in der Notiz, wo es sie üblicherweise gibt (Moodle-Kurs, Studienvertretung der ÖH, Kolleg:innen aus dem Kurs) und dass sie nach <Fachordner>/altklausuren/ gehören. Du lädst selbst nichts aus dem Netz in den Vault.',
    fakten: async (q) => {
      const jetzt = q.uhr.jetzt();
      const faecher = q.uni.faecher();
      const offen = ((await q.todos?.liste().catch(() => [])) ?? []).filter((t) => !t.erledigt && /altklausur/i.test(t.titel)).map((t) => norm(t.titel));
      const gesehen = new Set<string>();
      const z: string[] = [];
      for (const f of q.uni.fristen().filter((x) => x.art === 'test' && !x.abgegeben && x.frist && Date.parse(x.frist) > jetzt + 3 * TAG && Date.parse(x.frist) < jetzt + 45 * TAG)) {
        const fach = fachZuFrist(faecher, f);
        if (!fach || gesehen.has(fach.ordner)) continue;
        gesehen.add(fach.ordner);
        if ((await namenIn(q.vault, `${fach.ordner}/altklausuren`)).length) continue;
        if (offen.some((t) => t.includes(norm(fach.name)) || t.includes(norm(fach.titel)))) continue;
        z.push(`${kurz(fach.titel, 60)}: Prüfung „${kurz(f.titel, 80)}“ – ${fristText(Date.parse(f.frist!))} · ${fach.ordner}/altklausuren/ ist leer`);
      }
      return z.length ? z.slice(0, 4) : null;
    },
  },
  {
    id: 'moodle-neues',
    titel: 'Neue Moodle-Inhalte prüfen',
    gruppe: 'Uni',
    haeufigkeit: 'wöchentlich',
    gewicht: 'klein',
    nachts: true,
    ergebnis: 'Uni/faecher/<Fach>/…_moodle-stand.md (Helfer „Moodle durchsehen“ über Leifs Abo)',
    auftrag:
      'Starte für das genannte Fach EINEN Helfer mit der Aktion „Moodle durchsehen“ (Gebäude Uni, Eingabe fach = der genannte Ordnername; aktionen_liste zeigt die genaue Eingabe). Er läuft über Leifs Abo und liest nur. Läuft für das Fach schon ein Chat mit dieser Aktion, tu nichts.',
    fakten: async (q) => {
      if (!q.moodleBereit?.()) return null;
      const aktion = (await aktionenListe(q.vault).catch(() => [])).find((a) => a.id === 'Uni/moodle-durchsehen' && !a.fehler);
      if (!aktion) return null;
      const jetzt = q.uhr.jetzt();
      const faecher = q.uni.faecher();
      const naechste = q.uni
        .fristen()
        .filter((f) => (f.art === 'abgabe' || f.art === 'test') && !f.abgegeben && f.frist && Date.parse(f.frist) > jetzt && Date.parse(f.frist) < jetzt + 14 * TAG)
        .sort((a, b) => Date.parse(a.frist!) - Date.parse(b.frist!));
      for (const f of naechste) {
        const fach = fachZuFrist(faecher, f);
        if (!fach) continue;
        const letzte = (q.db.prepare("SELECT MAX(erstellt) AS e FROM chats WHERE aktion = 'Uni/moodle-durchsehen' AND eingaben_json LIKE ?").get(`%"fach":${JSON.stringify(fach.name)}%`) as { e: number | null }).e;
        if (letzte && letzte > jetzt - 6 * TAG) continue;
        return [`Fach (Ordnername): ${fach.name}`, `Nächste Frist: „${kurz(f.titel, 80)}“ – ${fristText(Date.parse(f.frist!))}`, `Letzte Durchsicht: ${letzte ? tagIn(letzte) : 'noch nie'}`];
      }
      return null;
    },
  },
  {
    id: 'wochenvorschau',
    titel: 'Wochenvorschau',
    gruppe: 'Kalender',
    haeufigkeit: 'wöchentlich',
    gewicht: 'klein',
    nachts: true,
    ergebnis: 'Rathaus/vorbereitung/JJJJ-MM-TT_HHMM_wochenvorschau-JJJJ-kwNN.md',
    auftrag:
      'Schreib Leif die Vorschau auf die kommende Woche als EINE Seite nach Rathaus/vorbereitung/ (Dateiname nach Schema, endet auf den genannten Namen): oben drei Sätze, worauf es diese Woche ankommt; dann je Tag Termine, Fristen und fällige To-dos; die zwei engsten Tage markieren; große To-dos, für die noch kein Platz ist, nennen. Du änderst nichts an Terminen oder Fälligkeiten – das macht Leif beim Wochenplanen (/planen). In „Für Leif“: der eine Satz, worauf es ankommt.',
    fakten: async (q) => {
      const jetzt = q.uhr.jetzt();
      const heute = tagIn(jetzt);
      const wt = wochentagVon(heute);
      const h = stundeIn(jetzt);
      // nur von Samstagmittag bis Montag 10 Uhr – dann ist es eine Vorschau
      if (!((wt === 6 && h >= 12) || wt === 0 || (wt === 1 && h < 10))) return null;
      const montag = wt === 1 ? heute : tagPlus(heute, wt === 0 ? 1 : 2);
      const marke = `wochenvorschau-${kalenderwoche(montag).toLowerCase()}`;
      if ((await namenIn(q.vault, 'Rathaus/vorbereitung')).some((n) => n.includes(marke))) return null;
      const termine = q.kalender ? (await q.kalender(tagBeginn(montag), tagBeginn(tagPlus(montag, 7)))).filter((t) => !t.erledigt).sort((a, b) => a.start - b.start) : [];
      const sonntag = tagPlus(montag, 6);
      const todos = ((await q.todos?.liste()) ?? []).filter((t) => !t.erledigt && !t.wartet && t.faellig && t.faellig >= montag && t.faellig <= sonntag);
      const wichtigOhneTag = ((await q.todos?.liste()) ?? []).filter((t) => !t.erledigt && t.wichtig && !t.faellig);
      if (!termine.length && !todos.length && !wichtigOhneTag.length) return null;
      const z = [`Woche ${kalenderwoche(montag)}: ${montag} bis ${sonntag} – Dateiname endet auf „_${marke}.md“`];
      for (let i = 0; i < 7; i++) {
        const tag = tagPlus(montag, i);
        const l = tagesLast(tag, termine, todos);
        if (l.termine.length || l.faellig.length) z.push(`${WOCHENTAGE[wochentagVon(tag)]} ${tag}: ${l.termine.length} Termine (${stunden(l.terminMin)}), ${l.faellig.length} To-dos (~${stunden(l.todoMin)})`);
      }
      for (const t of termine.slice(0, 25)) z.push(`Termin ${tagIn(t.start)} ${t.ganztags ? 'ganztägig' : uhrzeitIn(t.start)} · ${t.quelle}: ${kurz(t.titel, 70)}`);
      for (const t of todos.slice(0, 15)) z.push(`To-do „${kurz(t.titel, 70)}“ – fällig ${t.faellig}${t.dauer ? ` (${t.dauer} min)` : ''}${t.wichtig ? ' ⭐' : ''}`);
      for (const t of wichtigOhneTag.slice(0, 5)) z.push(`⭐ ohne Datum: „${kurz(t.titel, 70)}“`);
      return z;
    },
  },
  {
    id: 'adressbuch-pflegen',
    titel: 'Adressbuch pflegen',
    gruppe: 'Lernen',
    haeufigkeit: 'wöchentlich',
    gewicht: 'klein',
    nachts: true,
    ergebnis: `${KONTAKTE_PFAD} (nur Name, Adresse, Rolle)`,
    auftrag:
      'Diese Absender schreiben Leif öfter Wichtiges, stehen aber nicht in seinem Adressbuch. Trag die ein, die Leif sicher wieder anschreiben wird (Lehrende, Ämter, Prüfungsamt, Corps, Vermieter, Arbeitgeber) – mit kontakt_merken: Name, Adresse und eine kurze Rolle („Lehrende CDA, JKU“). Automaten, Shops und Werbung lässt du weg. Nur Name, Adresse und Rolle – keine Mailinhalte.',
    fakten: async (q, seit) => {
      const jetzt = q.uhr.jetzt();
      const mails = q.db.prepare('SELECT von, kategorie, betreff, datum FROM post_mails WHERE wichtig = 1 AND datum >= ? ORDER BY datum DESC LIMIT 500').all(jetzt - 60 * TAG) as {
        von: string;
        kategorie: string | null;
        betreff: string;
        datum: number;
      }[];
      if (!mails.length) return null;
      const buch = new Set((await new Kontakte({ db: q.db, vault: q.vault }).adressbuch()).map((k) => k.adresse));
      const gruppen = new Map<string, { name: string; n: number; neu: number; kategorie: string | null; betreff: string }>();
      for (const m of mails) {
        const a = adresseZerlegen(m.von);
        if (!a || buch.has(a.adresse) || /no-?reply|mailer-daemon|notification|benachrichtigung|newsletter|info@/i.test(a.adresse)) continue;
        const g = gruppen.get(a.adresse) ?? { name: a.name, n: 0, neu: 0, kategorie: m.kategorie, betreff: m.betreff };
        g.n++;
        g.neu = Math.max(g.neu, m.datum);
        gruppen.set(a.adresse, g);
      }
      const z = [...gruppen.entries()]
        .filter(([, g]) => g.n >= 2 && g.neu >= seit)
        .sort((a, b) => b[1].n - a[1].n)
        .slice(0, 8)
        .map(([adresse, g]) => `${kurz(g.name || '–', 60)} <${adresse}> – ${g.n} wichtige Mails in 60 Tagen${g.kategorie ? ` · ${kurz(g.kategorie, 30)}` : ''} · zuletzt „${kurz(g.betreff, 60)}“`);
      return z.length ? z : null;
    },
  },
  {
    id: 'gewohnheiten-reissen',
    titel: 'Gewohnheiten, die reißen',
    gruppe: 'Gewohnheiten',
    haeufigkeit: 'wöchentlich',
    gewicht: 'klein',
    nachts: true,
    ergebnis: 'Rundgang-Protokoll („Für Leif“ in der Morgenzeitung)',
    auftrag:
      'Diese Gewohnheiten von Leif sind in den letzten zwei Wochen unter die Hälfte gefallen. Überleg je Gewohnheit (höchstens zwei) EINEN konkreten Vorschlag, der sie leichter macht: kleiner anfangen, andere Uhrzeit, an etwas Bestehendes koppeln oder seltener (z. B. „3x pro woche“). Nenn das in „Für Leif“ – ein Satz je Gewohnheit, freundlich, ohne Vorwurf. Du änderst Marktplatz/gewohnheiten.md nicht und legst keine To-dos an.',
    fakten: async (q) => {
      if (!q.gewohnheiten) return null;
      const { gewohnheiten } = await q.gewohnheiten.liste();
      if (!gewohnheiten.length) return null;
      const jetzt = q.uhr.jetzt();
      const heute = tagIn(jetzt);
      const ab = tagPlus(heute, -14);
      const st = await q.vault.stat(GEWOHNHEITEN_PFAD).catch(() => null);
      const dateiAlt = !!st && st.mtimeMs <= jetzt - 14 * TAG;
      const z: string[] = [];
      for (const g of gewohnheiten) {
        const tage = (q.db.prepare('SELECT tag FROM gewohnheit_log WHERE name = ? ORDER BY tag').all(g.name) as { tag: string }[]).map((x) => x.tag);
        // erst ab zwei Wochen Bestand beurteilen (sonst wäre jede neue Gewohnheit „gerissen“)
        if (!dateiAlt && !(tage[0] && tage[0] <= ab)) continue;
        const zeitraum = Array.from({ length: 14 }, (_, i) => tagPlus(ab, i));
        const pro = proWoche(g);
        const soll = pro ? pro * 2 : zeitraum.filter((t) => faelligAm(g, t)).length;
        const ist = tage.filter((t) => t >= ab && t < heute).length;
        if (soll >= 2 && ist / soll < 0.5) z.push(`${g.symbol} ${kurz(g.name, 60)} (${Array.isArray(g.tage) ? g.tage.join(', ') : g.tage}${g.uhrzeit ? `, ${g.uhrzeit}` : ''}): ${ist} von ${soll} in 14 Tagen`);
      }
      return z.length ? z.slice(0, 6) : null;
    },
  },
  {
    id: 'fach-steckbriefe',
    titel: 'Fach-Steckbriefe',
    gruppe: 'Uni',
    haeufigkeit: 'wöchentlich',
    gewicht: 'klein',
    nachts: true,
    ergebnis: 'Rathaus/wissen/JJJJ-MM-TT_HHMM_faecher.md (eine Zeile je Fach)',
    auftrag:
      'Leg für jedes genannte Fach EINE Zeile Wissen an: wer lehrt (aus Moodle-Stand-Notizen, Kursübersicht, Mails), wie abgegeben wird, Prüfungsart und -termin, wo die Unterlagen liegen (Ordner). Was du nicht findest: „unbekannt“ – erfinde nichts, aber lass kein genanntes Fach aus (sonst gilt es nicht als erfasst). Gibt es die Steckbrief-Datei schon, ergänze sie mit vault_aendern; sonst leg sie neu an (Tabelle Fach | Lehrende | Abgabe | Prüfung | Unterlagen). Helfer bekommen diese Datei später als Hintergrund.',
    fakten: async (q) => {
      const faecher = q.uni.faecher();
      if (!faecher.length) return null;
      const datei = (await namenIn(q.vault, 'Rathaus/wissen')).filter((n) => /_faecher\.md$/.test(n)).sort().at(-1);
      const text = norm(datei ? ((await q.vault.lesen(`Rathaus/wissen/${datei}`).catch(() => null))?.inhalt ?? '') : '');
      const fehlen = faecher.filter((f) => !text.includes(norm(f.name)) && !text.includes(norm(f.titel)));
      if (!fehlen.length) return null;
      return [
        `Steckbrief-Datei: ${datei ? `Rathaus/wissen/${datei} (mit vault_aendern ergänzen)` : 'noch keine – neu anlegen als Rathaus/wissen/JJJJ-MM-TT_HHMM_faecher.md'}`,
        ...fehlen.slice(0, 10).map((f) => `Fehlt: ${kurz(f.titel, 80)} – ${f.ordner}`),
      ];
    },
  },
  {
    id: 'moodle-einsortieren',
    titel: 'Moodle-Downloads einsortieren',
    gruppe: 'Uni',
    haeufigkeit: 'wöchentlich',
    gewicht: 'klein',
    nachts: true,
    ergebnis: 'Rathaus/aufraeumen/JJJJ-MM-TT_HHMM_moodle-einsortieren.md (Vorschläge; Leif verschiebt)',
    auftrag:
      'In Uni/moodle/ liegen Dateien, die beim Herunterladen keinem Fach zugeordnet wurden. Ordne jede einem Fach zu (Dateiname, bei Bedarf kurz hineinlesen) und schreib EINE Notiz nach Rathaus/aufraeumen/ (Dateiname endet auf „_moodle-einsortieren.md“): Tabelle Datei (als Link) | Fach | Zielordner (Uni/faecher/<Fach>/folien/, …/aufgaben/ oder …/altklausuren/). Leif verschiebt in Obsidian. Unklare Dateien: „Fach unklar“. Du verschiebst außerhalb des Rathauses nichts.',
    fakten: async (q, seit) => {
      const dateien: { pfad: string; zeit: number }[] = [];
      for (const n of await q.vault.namen('Uni/moodle').catch(() => [])) {
        const unter = n.ordner ? (await namenIn(q.vault, `Uni/moodle/${n.name}`)).map((x) => `Uni/moodle/${n.name}/${x}`) : [`Uni/moodle/${n.name}`];
        for (const p of unter) dateien.push({ pfad: p, zeit: (await q.vault.stat(p).catch(() => null))?.mtimeMs ?? 0 });
      }
      if (!dateien.some((d) => d.zeit > seit)) return null;
      return [...dateien.slice(0, 25).map((d) => d.pfad), `Fächer: ${q.uni.faecher().map((f) => f.name).join(', ') || 'keine'}`];
    },
  },
  {
    id: 'tagesrhythmus',
    titel: 'Tagesrhythmus lernen',
    gruppe: 'Lernen',
    haeufigkeit: 'monatlich',
    gewicht: 'klein',
    nachts: true,
    ergebnis: 'Rathaus/memory.md, Abschnitt „Leifs Vorlieben und Arbeitsweise“ (alte Fassung im Archiv)',
    auftrag:
      'Hier steht, wann Leif in den letzten vier Wochen konzentriert gearbeitet und To-dos erledigt hat. Leite daraus höchstens drei Regeln ab („konzentriert am besten 9–11 Uhr“, „freitags wenig“, „abends eher Kleinkram“) und pflege sie im Abschnitt „## Leifs Vorlieben und Arbeitsweise“ deines Gedächtnisses (gedaechtnis_schreiben, GANZE Datei; alle anderen Abschnitte bleiben). Nur Muster, die die Zahlen klar tragen; Stehendes aktualisieren statt doppeln. Gibt es nichts Neues, fass das Gedächtnis nicht an.',
    fakten: async (q) => {
      const jetzt = q.uhr.jetzt();
      const { fokusJeStunde, besteZeit } = fokusNachTageszeit(q.db, jetzt, 28);
      const fokus = fokusJeStunde.reduce((a, b) => a + b, 0);
      const erledigt = ((await q.todos?.liste({ alleErledigten: true }).catch(() => [])) ?? []).filter((t) => t.erledigt && t.erledigtAm && Date.parse(t.erledigtAm) >= jetzt - 28 * TAG);
      if (fokus < 120 && erledigt.length < 15) return null;
      const spannen: [string, number, number][] = [
        ['früh (5–9)', 5, 9],
        ['vormittags (9–12)', 9, 12],
        ['mittags (12–14)', 12, 14],
        ['nachmittags (14–18)', 14, 18],
        ['abends (18–22)', 18, 22],
      ];
      const inSpanne = (h: number, von: number, bis: number) => h >= von && h < bis;
      const fokusText = spannen.map(([n, v, b]) => `${n} ${fokusJeStunde.slice(v, b).reduce((a, x) => a + x, 0)} min`).join(' · ');
      const stundenErledigt = erledigt.map((t) => stundeIn(Date.parse(t.erledigtAm!)));
      const erledigtText = spannen.map(([n, v, b]) => `${n} ${stundenErledigt.filter((h) => inSpanne(h, v, b)).length}`).join(' · ');
      const jeTag = WOCHENTAGE.map((w, i) => `${w} ${erledigt.filter((t) => wochentagVon(tagIn(Date.parse(t.erledigtAm!))) === i).length}`).join(' · ');
      const stimmung = q.db.prepare('SELECT AVG(wert) AS s, COUNT(*) AS n FROM stimmung WHERE zeit >= ?').get(jetzt - 28 * TAG) as { s: number | null; n: number };
      return [
        `Fokus in 4 Wochen: ${fokus} min; beste 2-Stunden-Spanne: ${besteZeit ? `${besteZeit.von}–${besteZeit.bis} Uhr` : 'zu wenig Daten'}`,
        `Fokus je Tageszeit: ${fokusText}`,
        `Erledigte To-dos (${erledigt.length}) je Tageszeit: ${erledigtText}`,
        `Erledigte To-dos je Wochentag: ${jeTag}`,
        ...(stimmung.n ? [`Stimmung: ${stimmung.n} Einträge, Schnitt ${stimmung.s!.toFixed(1)} von 5`] : []),
      ];
    },
  },
  {
    id: 'monatsrueckblick',
    titel: 'Monatsrückblick',
    gruppe: 'Rückblick',
    haeufigkeit: 'monatlich',
    gewicht: 'mittel',
    nachts: true,
    ergebnis: 'Rathaus/rueckblick/JJJJ-MM-TT_HHMM_monatsrueckblick-JJJJ-MM.md',
    auftrag:
      'Schreib den Rückblick auf den vergangenen Monat als EINE Seite nach Rathaus/rueckblick/ (Dateiname nach Schema, endet auf den genannten Namen): was geschafft wurde (die großen Dinge, nicht jede Kleinigkeit), wie viel Fokus, wie Gewohnheiten und Stimmung liefen, was liegen blieb, und zwei, drei Beobachtungen für den neuen Monat. Lies dazu die genannten Wochenrückblicke. Keine Beträge aus der Bank, keine Noten. In „Für Leif“: ein Satz, was diesen Monat gut lief.',
    fakten: async (q) => {
      const jetzt = q.uhr.jetzt();
      const heute = tagIn(jetzt);
      if (Number(heute.slice(8)) > 7) return null;
      const monat = vormonat(heute);
      const marke = `monatsrueckblick-${monat}`;
      if ((await namenIn(q.vault, 'Rathaus/rueckblick')).some((n) => n.includes(marke))) return null;
      const von = tagBeginn(`${monat}-01`);
      const bis = tagBeginn(`${heute.slice(0, 7)}-01`);
      const erledigt = ((await q.todos?.liste({ alleErledigten: true }).catch(() => [])) ?? []).filter((t) => t.erledigt && t.erledigtAm && Date.parse(t.erledigtAm) >= von && Date.parse(t.erledigtAm) < bis);
      const fokus = Math.round((q.db.prepare('SELECT COALESCE(SUM(minuten), 0) AS m FROM fokus_sitzungen WHERE start >= ? AND start < ?').get(von, bis) as { m: number }).m);
      const haken = (q.db.prepare('SELECT COUNT(*) AS n FROM gewohnheit_log WHERE tag >= ? AND tag < ?').get(`${monat}-01`, `${heute.slice(0, 7)}-01`) as { n: number }).n;
      const auftraege = (q.db.prepare("SELECT COUNT(*) AS n FROM schreibtisch WHERE status IN ('erledigt', 'beantwortet') AND geaendert >= ? AND geaendert < ?").get(von, bis) as { n: number }).n;
      const wochen = new Set<string>();
      for (let t = `${monat}-01`; t < `${heute.slice(0, 7)}-01`; t = tagPlus(t, 1)) wochen.add(kalenderwoche(t));
      const rueckblicke = (await namenIn(q.vault, 'Rathaus/wochenrueckblick')).filter((n) => wochen.has(n.replace(/\.md$/, ''))).map((n) => `Rathaus/wochenrueckblick/${n}`);
      if (!erledigt.length && !fokus && !rueckblicke.length) return null;
      return [
        `Monat ${monat} – Dateiname endet auf „_${marke}.md“`,
        `Erledigte To-dos: ${erledigt.length}${erledigt.length ? `, z. B. ${erledigt.slice(0, 8).map((t) => `„${kurz(t.titel, 50)}“`).join(', ')}` : ''}`,
        `Fokus: ${fokus} min · Gewohnheiten abgehakt: ${haken}× · erledigte Aufträge auf dem Schreibtisch: ${auftraege}`,
        `Wochenrückblicke: ${rueckblicke.join(', ') || 'keine'}`,
      ];
    },
  },
  {
    id: 'auftraege-verdichten',
    titel: 'Erledigte Aufträge verdichten',
    gruppe: 'Rückblick',
    haeufigkeit: 'monatlich',
    gewicht: 'mittel',
    nachts: true,
    ergebnis: 'Rathaus/rueckblick/JJJJ-MM-TT_HHMM_auftraege-JJJJ-MM.md',
    auftrag:
      'Fass die erledigten Aufträge des vergangenen Monats auf EINER Seite zusammen (Rathaus/rueckblick/, Dateiname nach Schema, endet auf den genannten Namen): je Auftrag eine Zeile – was Leif wollte, was herauskam, wo das Ergebnis liegt (Link). Ähnliche Aufträge gruppierst du. Lies nur dort ins Protokoll, wo der Titel nicht reicht. Du löschst und verschiebst nichts.',
    fakten: async (q) => {
      const jetzt = q.uhr.jetzt();
      const heute = tagIn(jetzt);
      if (Number(heute.slice(8)) > 10) return null;
      const monat = vormonat(heute);
      const marke = `auftraege-${monat}`;
      if ((await namenIn(q.vault, 'Rathaus/rueckblick')).some((n) => n.includes(marke))) return null;
      const a = q.db
        .prepare(
          `SELECT s.titel, s.status, s.geaendert, c.protokoll_pfad AS p FROM schreibtisch s LEFT JOIN chats c ON c.id = s.chat_id
           WHERE s.status IN ('erledigt', 'beantwortet') AND s.quelle != 'aufwachen' AND s.geaendert >= ? AND s.geaendert < ? ORDER BY s.geaendert LIMIT 40`,
        )
        .all(tagBeginn(`${monat}-01`), tagBeginn(`${heute.slice(0, 7)}-01`)) as { titel: string; status: string; geaendert: number; p: string | null }[];
      if (a.length < 5) return null;
      return [`Monat ${monat} – Dateiname endet auf „_${marke}.md“`, ...a.map((x) => `${tagIn(x.geaendert)} „${kurz(x.titel, 80)}“ (${x.status})${x.p ? ` – Protokoll: ${x.p}` : ''}`)];
    },
  },
  {
    id: 'rathaus-ablage',
    titel: 'Rathaus aufräumen',
    gruppe: 'Vault',
    haeufigkeit: 'monatlich',
    gewicht: 'klein',
    nachts: true,
    ergebnis: 'Rathaus/ablage/JJJJ-MM/ (jede Verschiebung mit „Rückgängig“)',
    auftrag:
      'Diese Notizen im Rathaus sind über 30 Tage alt. Verschieb jede mit vault_verschieben an das genannte Ziel in Rathaus/ablage/JJJJ-MM/ (Leif kann jede Verschiebung zurücknehmen). Nur genau diese Dateien – nie etwas aus schreibtisch/, protokolle/, chats/, notizen/, rundgang/, wissen/ oder memory.md. Gehört eine davon zu einer Frist, die noch nicht vorbei ist, oder steht sie auf deiner eigenen To-do-Liste, lass sie liegen.',
    fakten: async (q) => {
      const grenze = tagPlus(tagIn(q.uhr.jetzt()), -30);
      const z: string[] = [];
      for (const ordner of ['Rathaus/vorbereitung', 'Rathaus/recherche', 'Rathaus/aufraeumen']) {
        for (const n of (await namenIn(q.vault, ordner)).sort()) {
          const m = /^(\d{4}-\d{2}-\d{2})_\d{4}_.+\.md$/.exec(n);
          if (m && m[1]! < grenze) z.push(`${ordner}/${n} → Rathaus/ablage/${m[1]!.slice(0, 7)}/${n}`);
        }
      }
      return z.length >= 5 ? z.slice(0, 15) : null;
    },
  },
  {
    id: 'verwaiste-notizen',
    titel: 'Verwaiste Notizen finden',
    gruppe: 'Vault',
    haeufigkeit: 'monatlich',
    gewicht: 'klein',
    nachts: true,
    ergebnis: 'Rathaus/aufraeumen/JJJJ-MM-TT_HHMM_verwaiste-notizen.md (nur Vorschläge)',
    auftrag:
      'Auf diese Notizen verweist keine andere Notiz, und sie wurden seit über 60 Tagen nicht geändert. Sieh dir die Notizen kurz an (vault_lesen) und schreib EINE Notiz nach Rathaus/aufraeumen/ (Dateiname endet auf „_verwaiste-notizen.md“): je Notiz ein Vorschlag – „verlinken von <passender Notiz>“, „ins Archiv“ oder „kann weg“ (nur bei leeren oder überholten). Leif entscheidet in Obsidian. Du änderst, verschiebst und löschst außerhalb des Rathauses nichts.',
    fakten: async (q) => {
      const jetzt = q.uhr.jetzt();
      const alle = await vaultDateien(q.vault);
      const md = alle.filter((p) => p.endsWith('.md') && !/\.(sync-conflict-|konflikt-)/.test(p));
      const ziele = new Set<string>();
      for (const p of md) {
        const st = await q.vault.stat(p).catch(() => null);
        if (!st?.isFile() || st.size > 300_000) continue;
        const text = (await q.vault.text(p, { max: 300_000 }).catch(() => null)) ?? '';
        for (const m of text.matchAll(/\[\[([^\]|#^]+)/g)) ziele.add(path.posix.basename(m[1]!.trim().toLowerCase()).replace(/\.md$/, ''));
        for (const m of text.matchAll(/\]\(([^)\s]+?\.md)\)/g)) ziele.add(path.posix.basename(decodeURIComponent(m[1]!).toLowerCase()).replace(/\.md$/, ''));
      }
      const ausnahme = (p: string) =>
        !p.includes('/') ||
        /^(00_Stadtordnung|Rathaus|Marktplatz\/todos|Einkaufsladen\/(liste|wunschliste)|Corpshaus\/aufgaben|Post\/eingang)\//.test(p) ||
        /\/(aktionen|vorlagen|anhaenge|lernsitzungen)\//.test(p) ||
        /\/(gebaeude|karten|einstellungen|depot|noten|lernziele|gewohnheiten)\.md$/.test(p) ||
        /\/00_[^/]+\.md$/.test(p);
      const z: { p: string; zeit: number }[] = [];
      for (const p of md) {
        if (ausnahme(p) || ziele.has(path.posix.basename(p, '.md').toLowerCase())) continue;
        const st = await q.vault.stat(p).catch(() => null);
        if (st && st.mtimeMs < jetzt - 60 * TAG) z.push({ p, zeit: st.mtimeMs });
      }
      return z.length ? z.sort((a, b) => a.zeit - b.zeit).slice(0, 15).map((x) => `${x.p} – zuletzt geändert ${tagIn(x.zeit)}`) : null;
    },
  },
  {
    id: 'tags-vereinheitlichen',
    titel: 'Tags vereinheitlichen',
    gruppe: 'Vault',
    haeufigkeit: 'monatlich',
    gewicht: 'klein',
    nachts: true,
    ergebnis: 'Rathaus/aufraeumen/JJJJ-MM-TT_HHMM_tags.md (Zuordnung alt → neu; Leif ersetzt)',
    auftrag:
      'Diese Tags kommen in Leifs Vault in mehreren Schreibweisen vor. Schlag je Gruppe EINE Schreibweise vor (meist die häufigste) und nenn verwandte Tags, die vermutlich dasselbe meinen (z. B. #studium und #uni). Schreib das als EINE Notiz nach Rathaus/aufraeumen/ (Dateiname endet auf „_tags.md“) mit einer Tabelle alt → neu und der Zahl der Dateien – Leif ersetzt in Obsidian. Du änderst keine Dateien außerhalb des Rathauses.',
    fakten: async (q) => {
      const md = (await vaultDateien(q.vault)).filter((p) => p.endsWith('.md') && !/^(00_Stadtordnung|Rathaus)\/|\/(aktionen|vorlagen)\/|\/gebaeude\.md$/.test(p));
      const zaehler = new Map<string, Map<string, Set<string>>>();
      const merken = (tag: string, datei: string) => {
        if (/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(tag)) return; // Farbcodes
        const k = tag.toLowerCase();
        const g = zaehler.get(k) ?? new Map<string, Set<string>>();
        g.set(tag, (g.get(tag) ?? new Set()).add(datei));
        zaehler.set(k, g);
      };
      for (const p of md) {
        const st = await q.vault.stat(p).catch(() => null);
        if (!st?.isFile() || st.size > 300_000) continue;
        const text = (await q.vault.text(p, { max: 300_000 }).catch(() => null)) ?? '';
        let kopf: Record<string, unknown> = {};
        try {
          kopf = matter(text, {}).data;
        } catch {
          /* kaputter Kopf: nur Text */
        }
        const tags = kopf.tags ?? kopf.tag;
        for (const t of Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(/[,\s]+/) : []) if (typeof t === 'string' && t.trim()) merken(t.trim().replace(/^#/, ''), p);
        const rumpf = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
        for (const m of rumpf.matchAll(/(^|\s)#([\p{L}][\p{L}\p{N}_/-]{0,40})/gu)) merken(m[2]!, p);
      }
      const z = [...zaehler.values()]
        .filter((g) => g.size > 1)
        .slice(0, 12)
        .map((g) =>
          [...g.entries()]
            .sort((a, b) => b[1].size - a[1].size)
            .map(([t, d]) => `#${t} (${d.size}×, z. B. ${[...d][0]})`)
            .join(' · '),
        );
      return z.length ? z : null;
    },
  },
  {
    id: 'newsletter-flut',
    titel: 'Newsletter-Flut melden',
    gruppe: 'Post',
    haeufigkeit: 'monatlich',
    gewicht: 'klein',
    nachts: true,
    ergebnis: 'Rathaus/aufraeumen/JJJJ-MM-TT_HHMM_newsletter.md (Leif bestellt selbst ab)',
    auftrag:
      'Diese Absender haben Leif in den letzten 30 Tagen viele Mails geschickt, von denen keine wichtig war. Schreib EINE kurze Notiz nach Rathaus/aufraeumen/ (Dateiname endet auf „_newsletter.md“): je Absender Anzahl, worum es geht (Kategorie) und deine Einschätzung – „abbestellen?“, „behalten (nützlich)“ oder „Filter in Gmail?“. Du bestellst nichts ab, markierst und löschst keine Mails und öffnest keine Abmelde-Links.',
    fakten: async (q) => {
      const mails = q.db.prepare('SELECT von, wichtig, kategorie FROM post_mails WHERE datum >= ? AND eingeordnet IS NOT NULL').all(q.uhr.jetzt() - 30 * TAG) as {
        von: string;
        wichtig: number | null;
        kategorie: string | null;
      }[];
      const g = new Map<string, { n: number; wichtig: number; kategorie: string | null; name: string }>();
      for (const m of mails) {
        const a = adresseZerlegen(m.von);
        const k = a?.adresse ?? m.von.toLowerCase();
        const x = g.get(k) ?? { n: 0, wichtig: 0, kategorie: m.kategorie, name: a?.name ?? '' };
        x.n++;
        x.wichtig += m.wichtig ? 1 : 0;
        g.set(k, x);
      }
      const z = [...g.entries()]
        .filter(([, x]) => x.n >= 8 && !x.wichtig)
        .sort((a, b) => b[1].n - a[1].n)
        .slice(0, 10)
        .map(([k, x]) => `${kurz(x.name || '–', 50)} <${kurz(k, 80)}> – ${x.n} Mails in 30 Tagen, keine wichtig${x.kategorie ? ` · ${kurz(x.kategorie, 30)}` : ''}`);
      return z.length ? z : null;
    },
  },
  {
    id: 'jku-fristen',
    titel: 'Förderungen und Fristen der JKU',
    gruppe: 'Recherche',
    haeufigkeit: 'monatlich',
    gewicht: 'gross',
    nachts: false,
    ergebnis: 'Rathaus/recherche/JJJJ-MM-TT_HHMM_jku-fristen.md, höchstens zwei To-dos',
    auftrag:
      'Recherchiere im Web (höchstens 6 Abrufe, nur offizielle Seiten wie jku.at, oeh.jku.at, oead.at, stipendium.at, studienbeihilfe.at), welche Fristen und Förderungen für Studierende der JKU Linz in den nächsten zwei Monaten anstehen: Fortsetzungsmeldung und ÖH-Beitrag bzw. Studienbeitrag, Prüfungsanmeldungen, Leistungs- und Förderungsstipendien, Studienbeihilfe, Auslandssemester (Bewerbungsfristen). Schreib EINE Notiz nach Rathaus/recherche/ (Dateiname endet auf „_jku-fristen.md“): Frist | Was | für wen | Quelle (Link). Für echte, Leif betreffende Fristen in den nächsten 30 Tagen je ein To-do (höchstens zwei, vorher todo_liste prüfen). Keine privaten Daten in Suchanfragen; du stellst keine Anträge.',
    fakten: async (q) => {
      const heute = tagIn(q.uhr.jetzt());
      const letzte = (await namenIn(q.vault, 'Rathaus/recherche')).filter((n) => /_jku-fristen\.md$/.test(n)).sort().at(-1);
      if (letzte && letzte.slice(0, 10) >= tagPlus(heute, -25)) return null;
      const [j, m] = heute.split('-').map(Number) as [number, number];
      const phase =
        m >= 10 ? `Wintersemester ${j}/${String(j + 1).slice(2)}` : m === 1 ? `Wintersemester ${j - 1}/${String(j).slice(2)}` : m === 2 ? 'zwischen den Semestern (Sommersemester ab März)' : m <= 6 ? `Sommersemester ${j}` : 'Sommerferien (Wintersemester ab Oktober)';
      return [`Heute: ${heute} – ${phase}`, `Letzte Notiz dazu: ${letzte ? `Rathaus/recherche/${letzte}` : 'keine'}`];
    },
  },
];
