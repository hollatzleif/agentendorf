import { LISTEN, todoAusText, wiederholungAusText, type ListenName, type TodoDienst } from '../todos.js';

/** Telegram-Darstellung der Listen; Kurzzeichen für Knöpfe (64 Byte Grenze) */
const LISTEN_KURZ: Record<ListenName, string> = { todo: 't', einkauf: 'e', wunsch: 'w', corps: 'c' };
const LISTEN_ANZEIGE: Record<ListenName, { symbol: string; titel: string; befehl: string }> = {
  todo: { symbol: '🧺', titel: 'To-do-Liste', befehl: '/todo' },
  einkauf: { symbol: '🛒', titel: 'Einkaufsliste', befehl: '/einkauf' },
  wunsch: { symbol: '🎁', titel: 'Wunschliste', befehl: '/einkauf' },
  corps: { symbol: '🛡️', titel: 'Corps-Aufgaben', befehl: '/todo' },
};
import { aufwachEinstellungen, istNacht } from '../aufwachen.js';
import type { Rueckblick } from '../wochenrueckblick.js';
import { belegtMs, jetztDran, minutenText, terminAusText, wocheVerteilen, type KalenderTermin, type TerminAusText } from '@dorf/shared';
import type { Karteikasten } from '../karten.js';
import type { Gewohnheiten } from '../gewohnheiten.js';
import type { Wochenziele } from '../wochenziele.js';
import type { TodoErinnerungen } from '../todo-erinnerungen.js';
import type { Notizen } from '../notizen.js';
import { zeitpunktAus } from '../todo-erinnerungen.js';
import { dateinameBereinigen } from '../vault/pfade.js';
import { tagPlanen } from '../tagesplan.js';
import { STIMMUNGEN, stimmungSetzen } from '../statistik.js';
import { bluete, STUFE_TEXT } from '../bluete.js';
import { ortszeitZuUtc } from '../uni/ical.js';

type PlanBlock = { titel: string; grund: string; start: string; ende: string };
import type { FokusStatistik, NotenStand, Statistik, Suchtreffer, TodoInfo } from '@dorf/shared';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import type { FreigabeInfo, PlanInhalt, TelegramStatus } from '@dorf/shared';
import type { DB } from '../db.js';
import type { VaultDienst } from '../vault/dienst.js';
import type { AgentenDienst, LaufEnde } from '../agenten/dienst.js';
import type { Buergermeister } from '../agenten/buergermeister.js';
import type { Schreibtisch } from '../schreibtisch.js';
import { DorfFehler } from '../fehler.js';
import { MAX_DATEI, type TelegramSchnittstelle } from './api.js';
import { einstellungenLaden } from './einstellungen.js';
import type { AbgleichErgebnis, FaelligeErinnerung, Uni } from '../uni/abgleich.js';
import type { Postbote } from '../post/postbote.js';
import type { Morgenzeitung, Zeitung } from '../morgenzeitung.js';
import type { PostMail } from '@dorf/shared';
import { fristText } from '../uni/text.js';
import { aktionenListe } from '../agenten/aktionen.js';
import type { Uhr } from '../uhr.js';
import { fremdinhaltHuelle } from '../agenten/leine.js';
import { tagVonJetzt } from '../zeit.js';

/** So lange nach dem letzten Austausch gilt eine neue Nachricht als Fortsetzung des Gesprächs */
export const GESPRAECH_MINUTEN = 60;

/** HTML-sicher für Telegram (parse_mode HTML) */
export const h = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface TgNachricht {
  message_id: number;
  chat: { id: number | string; type?: string; first_name?: string; username?: string };
  from?: { id: number; first_name?: string };
  text?: string;
  caption?: string;
  media_group_id?: string;
  photo?: { file_id: string; file_size?: number }[];
  document?: { file_id: string; file_name?: string; file_size?: number };
  voice?: unknown;
  audio?: unknown;
  video_note?: unknown;
  forward_origin?: unknown;
  forward_from?: unknown;
  forward_from_chat?: unknown;
  forward_date?: number;
  reply_to_message?: { message_id: number; text?: string; caption?: string };
}
interface TgUpdate {
  update_id: number;
  message?: TgNachricht;
  callback_query?: { id: string; data?: string; from: { id: number }; message?: TgNachricht };
}

/** So lange gilt die nächste Textnachricht nach ❌ als Grund (ohne direkte Antwort auf die Frage) */
const GRUND_MINUTEN = 10;

const ARTEN: Record<string, string> = {
  datei_loeschen: 'Datei löschen',
  datei_ueberschreiben: 'Datei überschreiben',
  sonstiges: 'Sonstiges',
  lauf_starten: 'Aktion starten',
  plan_ausfuehren: 'Plan ausführen',
  aktion_anlegen: '🧩 Neuer Skill',
  persoenlichkeit_aendern: '🎭 Persönlichkeit',
};

/**
 * Telegram-Bot des Dorfs: nur EIN gekoppelter Chat, Long Polling (kein offener Port).
 * - Freigaben mit signierten Ja/Nein-Knöpfen (wirken genau einmal über freigaben.entscheiden)
 * - Meldungen: Freigaben, Entwürfe, Fehler, beendete Aufgaben (schaltbar in 00_Stadtordnung/telegram.md)
 * - Eingang: Text/Dateien werden zur Aufgabe auf dem Schreibtisch; Weitergeleitetes ist Fremdinhalt.
 */
export class TelegramBot {
  private offset = 0;
  private laeuft = false;
  private abbruch?: AbortController;
  letzterFehler?: string;
  private readonly signaturSchluessel: Buffer;

  constructor(
    private o: {
      uhr: Uhr;
      api: TelegramSchnittstelle;
      chatId: string;
      geheimnis: string;
      appUrl: string;
      db: DB;
      vault: VaultDienst;
      agenten: AgentenDienst;
      schreibtisch: Schreibtisch;
      buergermeister: Buergermeister;
      uni?: Uni;
      postbote?: Postbote;
      morgenzeitung?: Morgenzeitung;
      listen?: Record<ListenName, TodoDienst>;
      /** Nacht 18./19.11.: /karten – Karteikarten wiederholen */
      karten?: Karteikasten;
      /** Nacht 18./19.11.: Gewohnheiten abhaken (Tagesabschluss, /gewohnheiten) */
      gewohnheiten?: Gewohnheiten;
      /** E91: Wochenziele – /ziel */
      wochenziele?: Wochenziele;
      /** E94: Erinnerungen an To-dos – Knöpfe „+1 h“, „Morgen 9:00“ */
      erinnerungen?: TodoErinnerungen;
      /** E95: /notiz */
      notizen?: Notizen;
      /** E100: /woche – Fakten wie im Wochenrückblick (ohne KI) */
      woche?: { fakten(): Promise<{ abschnitte: { titel: string; zeilen: string[] }[] }> };
      /** E104: /statistik */
      statistik?: (tage: number) => Promise<Statistik>;
      /** E108: /suche im Vault */
      suche?: { suchen(q: string, grenze?: number): Suchtreffer[] };
      /** E113: /noten */
      noten?: { stand(): Promise<NotenStand> };
      /** Nacht 18./19.11.: /fokus – Pomodoro starten */
      kirchturm?: { ausfuehren(b: unknown): unknown; fokusStatistik?(): FokusStatistik; zustand?(): { pomodoro: { einstellungen: { tagesZielMin?: number } } } };
      /** Nacht 18./19.11.: /termin – Termin aus Text, eingetragen erst nach Leifs Knopfdruck */
      kalender?: {
        verbunden: boolean;
        inHauptkalender(t: TerminAusText): Promise<{ titel: string }>;
        /** /plan: freie Lücken eines Tages + Blöcke eintragen (nach Leifs Knopfdruck) */
        freiAmTag?(tag: string): Promise<[number, number][]>;
        bloeckeEintragen?(b: unknown): Promise<unknown>;
        /** E105 Prüfungs-Wächter */
        zeitraum?(von: number, bis: number): Promise<{ termine: ({ titel: string } & Partial<KalenderTermin>)[] }>;
        lernplan?(o: { bis: number; stunden: number; dauerMin: number }): Promise<{ gewuenscht: number; bloecke: { start: string; ende: string }[] }>;
      };
      log?: (t: string) => void;
    },
  ) {
    this.signaturSchluessel = crypto.createHmac('sha256', o.geheimnis).update('telegram-knoepfe').digest();
    // Meldungen – nie blockierend: Fehler beim Senden landen nur im Log.
    o.agenten.freigaben.beiNeu.push((f) => void this.freigabeMelden(f).catch((e) => this.fehler(e)));
    o.agenten.freigaben.beiEntscheidung.push((f) => void this.freigabeAktualisieren(f).catch((e) => this.fehler(e)));
    o.agenten.beiLaufEnde.push((e) => void this.laufMelden(e).catch((x) => this.fehler(x)));
    o.buergermeister.beiAbschluss.push((a) => void this.abschlussMelden(a).catch((x) => this.fehler(x)));
    o.uni?.beiAbgleich.push((e) => this.moodleMelden(e).catch((x) => this.fehler(x)));
    o.postbote?.beiNeu.push((m) => this.mailsMelden(m).catch((x) => this.fehler(x)));
    o.morgenzeitung?.beiNeu.push((z) => this.zeitungSenden(z).catch((x) => this.fehler(x)));
  }

  private letzterMoodleFehler: string | null = null;

  /** Morgenzeitung als Telegram-Nachricht (Schalter „morgenzeitung“) */
  async zeitungSenden(z: Zeitung) {
    if (!(await einstellungenLaden(this.o.vault)).morgenzeitung) return;
    const fett = (t: string) => h(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    const teile = [`☀️ <b>Morgenzeitung</b>`];
    if (z.einleitung) teile.push(`<i>${h(z.einleitung)}</i>`);
    for (const a of z.abschnitte) if (a.zeilen.length) teile.push(`<b>${h(a.titel)}</b>\n${a.zeilen.slice(0, 8).map((x) => `• ${fett(x)}`).join('\n')}`);
    let text = teile.join('\n\n');
    text = htmlKuerzen(text, 3700);
    // E101: Schnellknöpfe für den Start in den Tag
    const knoepfe: { text: string; callback_data: string }[] = [];
    // E133: der erste Schritt in den Tag – was passt jetzt?
    const offen = this.o.listen ? (await this.o.listen.todo.liste()).filter((t) => !t.erledigt) : [];
    if (offen.some((t) => t.wichtig || (t.faellig && t.faellig <= this.heuteTag()))) knoepfe.push({ text: '👉 Was zuerst?', callback_data: this.schnellDaten('jetzt') });
    if (this.o.kalender?.verbunden && this.o.kalender.freiAmTag) knoepfe.push({ text: '🧭 Tag planen', callback_data: this.schnellDaten('plan') });
    if (this.o.listen) {
      const heute = this.heuteTag();
      const ueber = offen.filter((t) => t.faellig && t.faellig < heute).length;
      if (ueber) knoepfe.push({ text: `🧹 Aufräumen (${ueber})`, callback_data: this.schnellDaten('aufraeumen') });
    }
    if (this.o.gewohnheiten && (await this.o.gewohnheiten.stand()).gewohnheiten.some((g) => g.heuteFaellig)) knoepfe.push({ text: '🔁 Gewohnheiten', callback_data: this.schnellDaten('gewohnheiten') });
    // höchstens zwei Knöpfe je Zeile – am Handy sonst abgeschnitten
    const zeilen: (typeof knoepfe)[] = [];
    for (let i = 0; i < knoepfe.length; i += 2) zeilen.push(knoepfe.slice(i, i + 2));
    await this.senden(`${text}\n\n<a href="${this.link('/gebaeude/Rathaus?reiter=morgenzeitung')}">Ganze Zeitung</a>`, zeilen.length ? { reply_markup: { inline_keyboard: zeilen } } : {});
  }

  /** E101: Schnellknopf = derselbe Befehl wie getippt (sb:<befehl>:<Signatur>) */
  private schnellDaten(befehl: 'plan' | 'aufraeumen' | 'gewohnheiten' | 'jetzt' | 'verteilen') {
    return `sb:${befehl}:${crypto.createHmac('sha256', this.signaturSchluessel).update(`schnell:${befehl}`).digest('base64url').slice(0, 16)}`;
  }
  private async schnellKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const m = /^sb:(plan|aufraeumen|gewohnheiten|jetzt|verteilen):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    if (!m || !crypto.timingSafeEqual(Buffer.from(m[2]!), Buffer.from(this.schnellDaten(m[1] as 'plan').split(':')[2]!))) {
      this.o.log?.('Telegram: Schnellknopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    await antworten('');
    if (m[1] === 'plan') return this.planBefehl('');
    if (m[1] === 'aufraeumen') return this.aufraeumenZeigen();
    if (m[1] === 'jetzt') return this.jetztBefehl();
    if (m[1] === 'verteilen') return this.verteilenBefehl();
    return this.gewohnheitenSenden();
  }

  /** Wochenrückblick (sonntags) – Schalter wie die Morgenzeitung */
  async rueckblickSenden(r: Rueckblick) {
    if (!(await einstellungenLaden(this.o.vault)).morgenzeitung) return;
    const fett = (t: string) => h(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    const teile = [`🗓️ <b>Wochenrückblick</b> (${h(r.woche.replace('-KW', ' · KW '))})`];
    if (r.einleitung) teile.push(`<i>${h(r.einleitung)}</i>`);
    if (r.vorschlaege.length) teile.push(`<b>Für nächste Woche</b>\n${r.vorschlaege.map((v) => `• ${h(v)}`).join('\n')}`);
    for (const a of r.abschnitte) if (a.zeilen.length) teile.push(`<b>${h(a.titel)}</b>\n${a.zeilen.slice(0, 8).map((x) => `• ${fett(x)}`).join('\n')}`);
    let text = teile.join('\n\n');
    text = htmlKuerzen(text, 3700);
    // E102: Vorschläge als Wochenziel für nächste Woche übernehmen – je ein signierter Knopf
    const knoepfe: { text: string; callback_data: string }[][] = [];
    if (this.o.wochenziele && r.vorschlaege.length) {
      const id = crypto.randomBytes(6).toString('hex');
      const alle = this.vorschlaegeWartend();
      alle[id] = { texte: r.vorschlaege.slice(0, 3), zeit: this.o.uhr.jetzt() };
      this.vorschlaegeWartendSetzen(alle);
      r.vorschlaege.slice(0, 3).forEach((v, i) => knoepfe.push([{ text: knopfText(`🎯 ${v}`), callback_data: this.vorschlagDaten(id, i) }]));
    }
    // E133: gleich die nächste Woche verteilen
    if (this.o.listen) knoepfe.push([{ text: '🗓️ Woche verteilen', callback_data: this.schnellDaten('verteilen') }]);
    await this.proaktiv(`${text}\n<a href="${this.link('/gebaeude/Rathaus?reiter=woche')}">Ganzer Rückblick</a> · <a href="${this.link('/planen')}">🗓️ Woche planen</a>${knoepfe.length > 1 ? '\n\n<i>🎯 antippen = als Ziel für nächste Woche übernehmen:</i>' : ''}`, knoepfe.length ? { reply_markup: { inline_keyboard: knoepfe } } : {});
  }

  private vorschlagDaten(id: string, i: number) {
    return `wv:${id}:${i}:${crypto.createHmac('sha256', this.signaturSchluessel).update(`vorschlag:${id}:${i}`).digest('base64url').slice(0, 16)}`;
  }
  private vorschlaegeWartend(): Record<string, { texte: string[]; zeit: number }> {
    const w = (this.o.db.prepare("SELECT wert FROM dorf_stand WHERE schluessel = 'telegram_vorschlaege'").get() as { wert: string } | undefined)?.wert;
    return w ? JSON.parse(w) : {};
  }
  private vorschlaegeWartendSetzen(x: Record<string, { texte: string[]; zeit: number }>) {
    const jetzt = this.o.uhr.jetzt();
    const rest = Object.entries(x).filter(([, v]) => jetzt - v.zeit < 8 * 86_400_000).slice(-5);
    this.o.db.prepare("INSERT OR REPLACE INTO dorf_stand (schluessel, wert) VALUES ('telegram_vorschlaege', ?)").run(JSON.stringify(Object.fromEntries(rest)));
  }
  private async vorschlagKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const m = /^wv:([0-9a-f]{12}):(\d):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    if (!m || !this.o.wochenziele || !crypto.timingSafeEqual(Buffer.from(m[3]!), Buffer.from(this.vorschlagDaten(m[1]!, Number(m[2])).split(':')[3]!))) {
      this.o.log?.('Telegram: Vorschlag-Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    const text = this.vorschlaegeWartend()[m[1]!]?.texte[Number(m[2])];
    if (!text) return antworten('Dieser Vorschlag ist abgelaufen.');
    // sonntags gehört er in die neue Woche, ab Montag in die laufende
    const sonntag = new Date(`${this.heuteTag()}T12:00:00Z`).getUTCDay() === 0;
    try {
      await this.o.wochenziele.hinzufuegen(text, sonntag ? 1 : 0);
      return antworten(`🎯 Wochenziel${sonntag ? ' für nächste Woche' : ''} gesetzt.`);
    } catch (e) {
      return antworten((e as Error).message.slice(0, 190));
    }
  }

  /** Wichtige neue Mails – nur mit Schalter „mails“ (standardmäßig aus: Leifs Mail-Assistent meldet schon) */
  async mailsMelden(m: PostMail[]) {
    if (!(await einstellungenLaden(this.o.vault)).mails) return;
    const zeilen = m.slice(0, 8).map((x) => `• ${h(x.von)}: <b>${h(x.betreff)}</b>${x.zusammenfassung ? `\n  ${h(x.zusammenfassung)}` : ''}`);
    await this.proaktiv(`📬 <b>${m.length === 1 ? 'Wichtige Mail' : `${m.length} wichtige Mails`}</b>\n${zeilen.join('\n')}\n<a href="${this.link('/gebaeude/Post')}">Zur Post</a>`);
  }

  /** Neues aus Moodle (Schalter „moodle“); ein Abgleich-Fehler wird nur gemeldet, wenn er neu ist (nicht alle 3 Stunden derselbe). */
  async moodleMelden(e: AbgleichErgebnis) {
    const k = await einstellungenLaden(this.o.vault);
    if (!e.ok) {
      if (k.fehler && e.fehler !== this.letzterMoodleFehler) await this.proaktiv(`❌ <b>Moodle-Abgleich fehlgeschlagen</b>\n${h((e.fehler ?? '').slice(0, 500))}`);
      this.letzterMoodleFehler = e.fehler;
      return;
    }
    this.letzterMoodleFehler = null;
    if (!k.moodle || (!e.neueDateien && !e.neueFristen.length)) return;
    const teile = [
      e.neueDateien ? `${e.neueDateien} ${e.neueDateien === 1 ? 'Datei' : 'Dateien'}` : '',
      e.neueFristen.length ? `${e.neueFristen.length} ${e.neueFristen.length === 1 ? 'Frist' : 'Fristen'}` : '',
    ].filter(Boolean);
    const abgaben = e.neueFristen
      .slice(0, 8)
      .map((a) => `• ${h(a.titel)}${a.kurs ? ` (${h(a.kurs)})` : ''} – ${a.frist == null ? 'ohne Frist' : h(fristText(a.frist))}`)
      .join('\n');
    await this.proaktiv(`🎓 <b>Neu in Moodle:</b> ${teile.join(', ')}${abgaben ? `\n${abgaben}` : ''}\n<a href="${this.link('/gebaeude/Uni')}">Zur Uni</a>`);
  }

  private fehler(e: unknown) {
    this.letzterFehler = (e as Error).message;
    this.o.log?.(`Telegram: ${this.letzterFehler}`);
  }

  status(einstellungen: TelegramStatus['einstellungen']): TelegramStatus {
    return { tokenGesetzt: true, chatGekoppelt: true, laeuft: this.laeuft, letzterFehler: this.letzterFehler, einstellungen };
  }

  // ---- Polling --------------------------------------------------------------------------------

  private erinnerungsTakt?: NodeJS.Timeout;

  /** Befehlsmenü („/“ in Telegram) – reine Anzeige, Fehler sind egal */
  static readonly BEFEHLE = [
    { command: 'status', description: 'Was läuft gerade' },
    { command: 'heute', description: 'Dein Tag: Wetter, Termine, Fristen' },
    { command: 'fristen', description: 'Abgaben und Prüfungen der nächsten 7 Tage' },
    { command: 'freigaben', description: 'Offene Freigaben' },
    { command: 'moodle', description: 'In Moodle nachschauen lassen: /moodle <Fach> [Frage]' },
    { command: 'aktion', description: 'Skill starten: /aktion <Name> (ohne Name: Liste)' },
    { command: 'todo', description: 'To-do-Liste (abhaken per Knopf) – /todo <Text> legt eins an' },
    { command: 'einkauf', description: 'Einkaufsliste (abhaken im Laden) – /einkauf <Text> setzt etwas drauf' },
    { command: 'termin', description: 'Termin in den Kalender: /termin morgen 14 Uhr Zahnarzt' },
    { command: 'woche', description: 'Deine Woche: Ziele, Termine, Fristen, Fälliges' },
    { command: 'noten', description: 'Notenschnitt und ECTS' },
    { command: 'suche', description: 'Im Vault suchen: /suche <Begriff>' },
    { command: 'statistik', description: 'Die letzten 7 Tage: Erledigtes, Fokus, Gewohnheiten' },
    { command: 'aufraeumen', description: 'Überfällige To-dos nacheinander: heute, morgen, nächste Woche, erledigt' },
    { command: 'notiz', description: 'Gedanken festhalten: /notiz <Text> (Tagesnotiz im Rathaus)' },
    { command: 'erinner', description: 'Erinnerung: /erinner morgen 9 Uhr Mama anrufen, /erinner in 30 min Wäsche' },
    { command: 'plan', description: 'Tag planen: To-dos als Blöcke in freie Lücken – /plan morgen' },
    { command: 'karten', description: 'Karteikarten wiederholen: /karten [Fach]' },
    { command: 'jetzt', description: 'Was passt jetzt? Ein To-do für die Zeit bis zum nächsten Termin' },
    { command: 'verteilen', description: 'To-dos ohne Datum auf die Woche verteilen (Vorschlag)' },
    { command: 'fokus', description: 'Pomodoro starten: /fokus [Thema]' },
    { command: 'ziel', description: 'Wochenziele: /ziel <Text> setzt eins, /ziel zeigt sie zum Abhaken' },
    { command: 'gewohnheiten', description: 'Gewohnheiten heute abhaken' },
    { command: 'neu', description: 'Nächste Nachricht wird eine neue Aufgabe' },
    { command: 'hilfe', description: 'Was der Bot kann' },
  ];

  starten() {
    if (this.laeuft) return;
    this.laeuft = true;
    void this.o.api.aufruf('setMyCommands', { commands: TelegramBot.BEFEHLE }).catch(() => undefined);
    void this.schleife();
    // Erinnerungen an Fristen: alle 10 Minuten nachsehen (nur Datenbank, kein Netz außer Telegram)
    this.erinnerungsTakt = setInterval(() => {
      void this.erinnerungenSenden().catch((e) => this.fehler(e));
      void this.nachtNachholen().catch((e) => this.fehler(e));
      void this.abendSenden().catch((e) => this.fehler(e));
      void this.pruefungsWaechter().catch((e) => this.fehler(e));
    }, 10 * 60_000);
    this.erinnerungsTakt.unref();
  }

  stoppen() {
    this.laeuft = false;
    this.abbruch?.abort();
    if (this.erinnerungsTakt) clearInterval(this.erinnerungsTakt);
  }

  // ---- Erinnerungen an Fristen ------------------------------------------------------------------

  erledigtSignatur(fristId: string) {
    return crypto.createHmac('sha256', this.signaturSchluessel).update(`erledigt:${fristId}`).digest('base64url').slice(0, 16);
  }

  private erinnerungsText(e: Pick<FaelligeErinnerung, 'titel' | 'kurs' | 'art' | 'frist' | 'stufe'>) {
    const was = e.art === 'test' ? 'Test' : 'Abgabe';
    const kopf =
      e.stufe === 'danach'
        ? `❓ <b>Frist vorbei – erledigt?</b>`
        : `⏰ <b>${was} in ${e.stufe === '3t' ? '3 Tagen' : e.stufe === '1t' ? '1 Tag' : 'wenigen Stunden'}</b>`;
    return `${kopf}\n${h(e.titel)}${e.kurs ? ` (${h(e.kurs)})` : ''}\nFrist: ${h(fristText(e.frist))}`;
  }

  /** Schickt fällige Erinnerungen – jede genau einmal (erst nach erfolgreichem Senden vermerkt). */
  async erinnerungenSenden() {
    if (!this.o.uni || !(await einstellungenLaden(this.o.vault)).erinnerungen) return 0;
    let n = 0;
    const nacht = await this.nachtruhe();
    for (const e of this.o.uni.faelligeErinnerungen()) {
      // nachts nur, was in wenigen Stunden fällig ist – der Rest kommt (als dringendste Stufe) nach 7 Uhr
      if (nacht && e.stufe !== '3h') continue;
      // E64 Frist-Wächter: kurz vor der Frist (1 Tag / wenige Stunden) kann der Bürgermeister vorbereiten – abgeben tut Leif
      const knoepfe = [{ text: '✅ Erledigt', callback_data: `e:${e.id}:${this.erledigtSignatur(e.id)}` }];
      if (e.stufe === '1t' || e.stufe === '3h') knoepfe.push({ text: '🧑‍💼 Vorbereiten lassen', callback_data: `v:${e.id}:${this.vorbereitenSignatur(e.id)}` });
      await this.senden(`${this.erinnerungsText(e)}\n<a href="${this.link('/gebaeude/Uni')}">Zur Uni</a>`, {
        reply_markup: { inline_keyboard: [knoepfe] },
      });
      this.o.uni.erinnerungGesendet(e);
      n++;
    }
    return n;
  }

  vorbereitenSignatur(fristId: string) {
    return crypto.createHmac('sha256', this.signaturSchluessel).update(`vorbereiten:${fristId}`).digest('base64url').slice(0, 16);
  }

  /** Frist-Wächter: Schreibtisch-Aufgabe für den Bürgermeister – vorbereiten, was geht; abgeben nie (E64) */
  private async vorbereitenKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const m = /^v:((?:(?:ical|gfrist|gpfl):[0-9a-f]{32})|(?:assign|event):\d{1,12}):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    if (!m || !this.o.uni || !crypto.timingSafeEqual(Buffer.from(m[2]!), Buffer.from(this.vorbereitenSignatur(m[1]!)))) {
      this.o.log?.('Telegram: Vorbereiten-Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    const f = this.o.uni.fristen().find((x) => x.id === m[1]);
    if (!f) return antworten('Diese Frist gibt es nicht mehr.');
    if (f.abgegeben) return antworten('Schon erledigt.');
    const was = f.art === 'test' ? 'Prüfung/Test' : 'Abgabe';
    const text = `Frist-Wächter: ${was} bald fällig – bitte vorbereiten, was sinnvoll ist.

${fremdinhaltHuelle('frist', `${was}: ${f.titel}${f.kurs ? ` (${f.kurs})` : ''}\nFrist: ${f.frist ? fristText(Date.parse(f.frist)) : 'unbekannt'}${f.pfad ? `\nOrdner: ${f.pfad}` : ''}`)}

Schau, was es dafür im Vault gibt (Uni/faecher/…, aufgaben/, entwuerfe/). Bei einer Abgabe mit Angabe im Kursordner: Helfer mit „Abgabe bearbeiten“; bei einer Prüfung: „Lernen“ für das Fach. Fehlt die Angabe, lass sie mit „Moodle durchsehen“ holen. Abgeben tut Leif immer selbst.`;
    try {
      const a = await this.o.schreibtisch.anlegen({ text, quelle: 'telegram' });
      const r = await this.o.buergermeister.starten(a.id, 'klick');
      await antworten('Der Bürgermeister kümmert sich.');
      await this.senden(`🧑‍💼 Der Bürgermeister bereitet „${h(f.titel)}“ vor. <a href="${this.link(`/chats/${r.chatId}`)}">Chat öffnen</a>`, {}, r.chatId);
    } catch (e) {
      await antworten(`Fehler: ${(e as Error).message}`.slice(0, 190));
    }
  }

  private async erledigtKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const m = /^e:((?:(?:ical|gfrist|gpfl):[0-9a-f]{32})|(?:assign|event):\d{1,12}):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    if (!m || !this.o.uni || !crypto.timingSafeEqual(Buffer.from(m[2]!), Buffer.from(this.erledigtSignatur(m[1]!)))) {
      this.o.log?.('Telegram: Erledigt-Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    try {
      this.o.uni.erledigtSetzen(m[1]!, true);
    } catch {
      return antworten('Diese Frist gibt es nicht mehr.');
    }
    await antworten('Abgehakt.');
    if (q.message)
      await this.o.api
        .aufruf('editMessageText', {
          chat_id: q.message.chat.id,
          message_id: q.message.message_id,
          text: `${(q.message.text ?? '').split('\nZur Uni')[0]}\n\n✅ Erledigt`.slice(0, 4000),
          link_preview_options: { is_disabled: true },
        })
        .catch(() => undefined);
  }

  private async schleife() {
    let warte = 2000;
    while (this.laeuft) {
      this.abbruch = new AbortController();
      try {
        const updates = await this.o.api.aufruf<TgUpdate[]>(
          'getUpdates',
          { offset: this.offset, timeout: 50, allowed_updates: ['message', 'callback_query'] },
          AbortSignal.any([this.abbruch.signal, AbortSignal.timeout(70_000)]),
        );
        warte = 2000;
        for (const u of updates) {
          this.offset = Math.max(this.offset, u.update_id + 1);
          await this.verarbeiten(u).catch((e) => this.fehler(e));
        }
      } catch (e) {
        if (!this.laeuft) break;
        this.fehler(e);
        await new Promise((r) => setTimeout(r, warte));
        warte = Math.min(warte * 2, 60_000);
      }
    }
  }

  // ---- Eingang --------------------------------------------------------------------------------

  private istLeif(chatId: number | string | undefined) {
    return chatId !== undefined && String(chatId) === this.o.chatId;
  }

  async verarbeiten(u: TgUpdate) {
    if (u.callback_query) return this.knopf(u.callback_query);
    const m = u.message;
    if (!m) return;
    if (!this.istLeif(m.chat.id)) {
      this.o.log?.(`Telegram: Nachricht aus fremdem Chat ${m.chat.id} ignoriert.`);
      return;
    }
    let text = (m.text ?? m.caption ?? '').trim();
    // E115: Foto/Datei mit Bildunterschrift „notiz: …“ → in die Tagesnotiz (Bild daneben im Vault), nicht als Aufgabe
    const bildNotiz = /^notiz\s*:\s*([\s\S]*)$/i.exec(m.caption ?? '');
    const weitergeleitet = !!(m.forward_origin || m.forward_from || m.forward_from_chat || m.forward_date);
    if (bildNotiz && (m.photo?.length || m.document) && this.o.notizen && !weitergeleitet) {
      // Album: Telegram schickt jedes Bild einzeln, nur eins trägt die Bildunterschrift – die anderen gehören dazu (Review)
      if (m.media_group_id) this.notizAlben.set(m.media_group_id, this.o.uhr.jetzt());
      return this.notizMitDatei(m, bildNotiz[1]!.trim());
    }
    if (m.media_group_id && !m.caption && (m.photo?.length || m.document) && this.o.notizen && !weitergeleitet) {
      const seit = this.notizAlben.get(m.media_group_id);
      if (seit != null && this.o.uhr.jetzt() - seit < 60_000) return this.notizMitDatei(m, '');
    }
    // E103: „todo: …“, „notiz: …“, „ziel: …“, „einkauf: …“ wie der Befehl – nur Leifs eigene Textnachricht, nie Weitergeleitetes
    const kurz = /^(todo|notiz|ziel|einkauf)\s*:\s*(\S[\s\S]*)$/i.exec(text);
    if (kurz && m.text && !(m.forward_origin || m.forward_from || m.forward_from_chat || m.forward_date)) text = `/${kurz[1]!.toLowerCase()} ${kurz[2]!}`;
    if (text.startsWith('/')) {
      this.grundFrageSetzen(null); // ein Befehl beendet die Frage nach dem Grund
      const b = text.split(/\s/)[0]!.split('@')[0]!.toLowerCase();
      if (b === '/moodle') return this.moodleBefehl(text.slice(text.split(/\s/)[0]!.length).trim());
      if (b === '/aktion') return this.aktionBefehl(text.slice(text.split(/\s/)[0]!.length).trim());
      if (b === '/todo') return this.todoBefehl(text.slice(text.split(/\s/)[0]!.length).trim());
      if (b === '/einkauf') return this.todoBefehl(text.slice(text.split(/\s/)[0]!.length).trim(), 'einkauf');
      if (b === '/termin') return this.terminBefehl(text.slice(text.split(/\s/)[0]!.length).trim());
      if (b === '/gewohnheiten' || b === '/gewohnheit') return this.gewohnheitenSenden();
      if (b === '/woche') return this.wocheSenden();
      if (b === '/statistik') return this.statistikSenden();
      if (b === '/noten') return this.notenSenden();
      if (b === '/suche' || b === '/s') return this.sucheSenden(text.slice(text.split(/\s/)[0]!.length).trim());
      if (b === '/aufraeumen' || b === '/aufräumen') return this.aufraeumenZeigen();
      if (b === '/notiz' || b === '/n') return this.notizBefehl(text.slice(text.split(/\s/)[0]!.length).trim());
      if (b === '/erinner' || b === '/erinnere' || b === '/erinnerung') return this.erinnerBefehl(text.slice(text.split(/\s/)[0]!.length).trim());
      if (b === '/ziel' || b === '/ziele') return this.zielBefehl(text.slice(text.split(/\s/)[0]!.length).trim());
      if (b === '/plan') return this.planBefehl(text.slice(text.split(/\s/)[0]!.length).trim());
      if (b === '/karten') return this.kartenBefehl(text.slice(text.split(/\s/)[0]!.length).trim());
      if (b === '/jetzt') return this.jetztBefehl();
      if (b === '/verteilen') return this.verteilenBefehl();
      if (b === '/fokus') return this.fokusBefehl(text.slice(text.split(/\s/)[0]!.length).trim());
      if (b !== '/neu') return this.befehl(b);
      // „/neu“ beendet das laufende Gespräch; „/neu <Text>“ legt gleich eine neue Aufgabe an
      this.verlaufMerken(m.message_id, '');
      text = text.slice(text.split(/\s/)[0]!.length).trim();
      if (!text && !m.document && !m.photo?.length) return this.senden('🆕 Okay – deine nächste Nachricht wird eine neue Aufgabe.');
      return this.neueAufgabe(m, text);
    }
    if (m.voice || m.audio || m.video_note) return this.senden('🎙️ Sprachnachrichten kann das Dorf noch nicht verarbeiten. Schreib mir die Aufgabe bitte als Text.');

    // Reiner Text (nicht weitergeleitet, keine Datei) kann ein laufendes Gespräch fortsetzen.
    // Weitergeleitetes und Dateien werden immer neue Aufgaben – Fremdinhalt kommt nie direkt in einen Auftrag.
    const fremd = !!(m.forward_origin || m.forward_from || m.forward_from_chat || m.forward_date);
    // E64: Antwort auf „Warum abgelehnt?“ → Grund an die Freigabe (und damit an den Bürgermeister)
    if (text && !fremd && !m.document && !m.photo?.length) {
      const frage = this.grundFrage();
      const passt = frage && (m.reply_to_message ? m.reply_to_message.message_id === frage.messageId : this.o.uhr.jetzt() - frage.zeit < GRUND_MINUTEN * 60_000);
      if (frage && passt) return this.grundAnnehmen(frage.freigabeId, text);
    }
    if (text && !fremd && !m.document && !m.photo?.length) {
      const chatId = this.gespraechFinden(m);
      if (chatId) return this.fortsetzen(m, chatId, text);
    }
    return this.neueAufgabe(m, text);
  }

  private async fortsetzen(m: TgNachricht, chatId: string, text: string) {
    let c: ReturnType<AgentenDienst['chatZeile']>;
    try {
      c = this.o.agenten.chatZeile(chatId);
    } catch {
      return this.neueAufgabe(m, text);
    }
    try {
      this.o.agenten.nachrichtSenden(chatId, text, 'klick');
    } catch (e) {
      if (e instanceof DorfFehler && e.status === 409)
        return this.senden(`⏳ Im Gespräch „${h(c.titel)}“ wird gerade noch gearbeitet. Schick deine Nachricht gleich nochmal – oder <code>/neu …</code> für eine neue Aufgabe.`);
      return this.senden(`⚠️ Konnte die Nachricht nicht weitergeben: ${h((e as Error).message)}`);
    }
    this.verlaufMerken(m.message_id, chatId);
    await this.senden(`↪️ Weiter im Gespräch: <b>${h(c.titel)}</b> · <a href="${this.link(`/chats/${chatId}`)}">Chat öffnen</a>\n<i>/neu startet eine neue Aufgabe</i>`, {}, chatId);
  }

  private async neueAufgabe(m: TgNachricht, textRoh: string) {
    let text = textRoh;
    const anhaenge: string[] = [];
    try {
      const datei = m.document ?? (m.photo?.length ? { ...m.photo[m.photo.length - 1]!, file_name: `foto-${m.message_id}.jpg` } : undefined);
      if (datei) {
        if ((datei.file_size ?? 0) > MAX_DATEI) return this.senden('📎 Die Datei ist größer als 20 MB – so große Dateien kann ein Bot nicht laden. Lade sie bitte in der App hoch.');
        const d = await this.o.api.dateiLaden(datei.file_id);
        anhaenge.push(await this.o.schreibtisch.anhangSpeichern(datei.file_name ?? d.name, Readable.from(d.inhalt)));
      }
      if (!text && !anhaenge.length) return;
      const fremd = !!(m.forward_origin || m.forward_from || m.forward_from_chat || m.forward_date);
      // Antwort auf eine Dorf-Nachricht ohne zugehörigen Chat (z. B. Erinnerung): deren Text als Bezug mitgeben – als Daten
      const bezug = !fremd && m.reply_to_message ? (m.reply_to_message.text ?? m.reply_to_message.caption ?? '').trim() : '';
      if (bezug) text = `${text}\n\n---\nBezug – die Nachricht des Dorfs, auf die Leif antwortet:\n${fremdinhaltHuelle('telegram-bezug', bezug.slice(0, 2000))}`;
      const a = await this.o.schreibtisch.anlegen({ text, quelle: 'telegram', fremd, anhaenge });
      const r = await this.o.buergermeister.starten(a.id, 'klick');
      this.verlaufMerken(m.message_id, r.chatId);
      await this.senden(
        `📥 Neue Aufgabe auf dem Schreibtisch: <b>${h(a.titel)}</b>${fremd ? '\n(weitergeleitet – wird als Fremdinhalt behandelt)' : ''}\nDer Bürgermeister kümmert sich. <a href="${this.link(`/chats/${r.chatId}`)}">Chat öffnen</a>\n<i>Antworte einfach – das Gespräch läuft ${GESPRAECH_MINUTEN} Minuten weiter.</i>`,
        {},
        r.chatId,
      );
    } catch (e) {
      await this.senden(`⚠️ Konnte die Aufgabe nicht anlegen: ${h((e as Error).message)}`);
    }
  }

  private async befehl(b: string) {
    if (b === '/start' || b === '/hilfe' || b === '/help')
      return this.senden(
        `🏡 <b>Agentendorf</b>\nSchick mir eine Aufgabe als Text (oder Foto/Datei mit Beschreibung) – sie landet auf dem Schreibtisch des Bürgermeisters. Weiterschreiben setzt das Gespräch fort (bis ${GESPRAECH_MINUTEN} Minuten nach dem letzten Austausch); antwortest du auf eine bestimmte Nachricht, geht es in genau diesem Chat weiter.\n\n<b>📅 Planen</b>\n/heute – dein Tag · /woche – die nächsten 7 Tage\n/plan [morgen] – To-dos in freie Kalenderlücken\n/verteilen – To-dos ohne Datum auf die Woche verteilen\n/fristen – Abgaben und Prüfungen (7 Tage)\n/termin &lt;wann&gt; &lt;was&gt; – Termin eintragen (mit Bestätigung)\n\n<b>✅ Erledigen</b>\n/todo [Text] – To-do-Liste bzw. neues To-do (auch „… jeden Montag“)\n/einkauf [Text] – Einkaufsliste\n/erinner &lt;wann&gt; &lt;was&gt; – Erinnerung (läutet im Kirchturm)\n/aufraeumen – Überfälliges neu einplanen\n/jetzt – was jetzt passt (mit 🍅 Los) · /fokus [Thema] – Pomodoro starten\n/gewohnheiten – heute abhaken · /ziel [Text] – Wochenziele\n\n<b>🎓 Lernen</b>\n/karten [Fach] – Karteikarten · /moodle &lt;Fach&gt; [Frage] – in Moodle nachsehen\n/noten – Notenschnitt und ECTS\n\n<b>📝 Festhalten &amp; Finden</b>\n/notiz &lt;Text&gt; – Tagesnotiz · /suche &lt;Begriff&gt; – im Vault suchen\n/statistik – die letzten 7 Tage\n\n<b>🏛️ Dorf</b>\n/status – was läuft · /freigaben – offene Freigaben\n/aktion [Name] – Skill starten · /neu – nächste Nachricht = neue Aufgabe\n/hilfe – diese Hilfe\n\n<i>Tipp: „todo: …“, „notiz: …“, „ziel: …“, „einkauf: …“ gehen auch ohne Schrägstrich – ein Foto mit „notiz: …“ landet samt Bild in der Tagesnotiz.</i>`,
      );
    if (b === '/status') {
      const aktiv = this.o.agenten.aktiveLaeufe();
      const offen = this.o.agenten.freigaben.anzahlOffen();
      const zeilen = aktiv.slice(0, 10).map((l) => {
        const c = this.o.agenten.chatZeile(l.chatId);
        return `• ${h(c.titel)} – ${l.status === 'laeuft' ? 'läuft' : l.status === 'wartend' ? 'wartet' : 'wartet auf Freigabe'}`;
      });
      return this.senden(`📊 <b>Status</b>\n${zeilen.length ? zeilen.join('\n') : 'Gerade arbeitet niemand.'}\n\n✉️ Offene Freigaben: ${offen}`);
    }
    if (b === '/heute') {
      // Tagesüberblick wie in der Morgenzeitung (Wetter, Termine, Fristen) – jederzeit, ohne KI und ohne Speichern
      if (!this.o.morgenzeitung) return this.senden('Der Tagesüberblick ist gerade nicht verfügbar.');
      const z = await this.o.morgenzeitung.fakten();
      const fett = (t: string) => h(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      const teile = z.abschnitte
        .filter((a) => a.titel === 'Heute' || a.titel === 'Fristen (7 Tage)' || a.titel === 'Wartet auf dich')
        .map((a) => `<b>${h(a.titel)}</b>\n${a.zeilen.length ? a.zeilen.slice(0, 10).map((x) => `• ${fett(x)}`).join('\n') : '–'}`);
      return this.senden(`📅 <b>Dein Tag</b>\n\n${teile.join('\n\n')}\n\n<a href="${this.link('/gebaeude/Rathaus?reiter=morgenzeitung')}">Morgenzeitung</a>`);
    }
    if (b === '/fristen') {
      const jetzt = this.o.uhr.jetzt();
      const liste = (this.o.uni?.fristen() ?? [])
        .filter((f) => (f.art === 'abgabe' || f.art === 'test') && !f.abgegeben && f.frist && Date.parse(f.frist) < jetzt + 7 * 86_400_000)
        .slice(0, 10);
      if (!liste.length) return this.senden('🎉 Keine offenen Abgaben oder Prüfungen in den nächsten 7 Tagen.');
      const zeilen = liste.map((f) => `• <b>${h(fristText(Date.parse(f.frist!)))}</b> · ${f.art === 'test' ? 'Prüfung' : 'Abgabe'} · ${h(f.titel)}${f.kurs ? ` (${h(f.kurs)})` : ''}`);
      return this.senden(`⏰ <b>Fristen (7 Tage)</b>\n${zeilen.join('\n')}\n<a href="${this.link('/gebaeude/Uni')}">Zur Uni</a>`, {
        reply_markup: {
          inline_keyboard: liste.map((f) => [{ text: `✅ ${Array.from(f.titel).slice(0, 40).join('')}`, callback_data: `e:${f.id}:${this.erledigtSignatur(f.id)}` }]),
        },
      });
    }
    if (b === '/freigaben') {
      const offen = this.o.agenten.freigaben.liste('offen');
      if (!offen.length) return this.senden('✉️ Keine offenen Freigaben.');
      for (const f of offen.slice(0, 10)) await this.freigabeMelden(f, true);
      return;
    }
    return this.senden('Unbekannter Befehl. /hilfe zeigt, was geht.');
  }

  /** /moodle <Fach> [Frage] – „Moodle durchsehen“ direkt vom Handy starten (Leifs Auftrag → über sein Abo) */
  /** /aktion [Name] – Skills, die ohne Eingaben (oder mit Standardwerten) laufen, vom Handy starten */
  private async aktionBefehl(rest: string) {
    const startbar = (await aktionenListe(this.o.vault)).filter((a) => !a.fehler && a.rolle !== 'buergermeister' && a.eingaben.every((e) => !e.pflicht || e.standard));
    if (!rest) {
      if (!startbar.length) return this.senden('Keine Aktion lässt sich ohne Eingaben starten.');
      const zeilen = startbar.slice(0, 30).map((a) => `• <code>/aktion ${h(a.name)}</code> – ${h(a.gebaeude)}${a.zeitplan ? ` · ⏰ ${h(a.zeitplan)}` : ''}`);
      return this.senden(`🧩 <b>Aktionen zum Starten</b>\n${zeilen.join('\n')}`);
    }
    const klein = rest.toLowerCase();
    const treffer = startbar.filter((a) => a.name.toLowerCase() === klein || a.id.toLowerCase() === klein);
    const a = treffer[0] ?? (startbar.filter((x) => x.name.toLowerCase().includes(klein)).length === 1 ? startbar.find((x) => x.name.toLowerCase().includes(klein)) : undefined);
    if (!a) return this.senden(`Keine eindeutige Aktion „${h(rest)}“. /aktion zeigt die Liste.`);
    const r = await this.o.agenten.aktionStarten(a.id, {}, 'klick');
    return this.senden(`▶️ Gestartet: <b>${h(a.name)}</b> (${h(a.gebaeude)})\n<a href="${this.link(`/chats/${r.chatId}`)}">Chat öffnen</a>`, {}, r.chatId);
  }

  private async moodleBefehl(rest: string) {
    if (!this.o.agenten.moodleBrowser) return this.senden('🌐 Der Moodle-Browser ist noch nicht eingerichtet. Auf dem Server: <code>dorf moodle-browser-zugang</code>');
    const faecher = this.o.uni?.faecher() ?? [];
    if (!faecher.length) return this.senden('🎓 Noch keine Fächer – leg in der App unter Uni → Studium eins an.');
    const klein = rest.toLowerCase();
    // längster passender Fachname/-titel am Anfang, sonst eindeutiger Treffer des ersten Worts
    const kandidaten = faecher.flatMap((f) => [f.name, f.titel].map((n) => ({ f, n: n.toLowerCase() })));
    let treffer = kandidaten.filter((k) => klein === k.n || klein.startsWith(`${k.n} `)).sort((a, b) => b.n.length - a.n.length)[0];
    let frage = treffer ? rest.slice(treffer.n.length).trim() : '';
    if (!treffer && rest) {
      const wort = klein.split(/\s+/)[0]!;
      const passend = [...new Set(kandidaten.filter((k) => k.n.includes(wort)).map((k) => k.f))];
      if (passend.length === 1) {
        treffer = { f: passend[0]!, n: wort };
        frage = rest.slice(wort.length).trim();
      }
    }
    if (!treffer)
      return this.senden(`🌐 Welches Fach? Zum Beispiel:\n${faecher.slice(0, 12).map((f) => `<code>/moodle ${h(f.name)}</code>`).join('\n')}\n\nDanach optional deine Frage, z. B. „was muss ich bis Donnerstag vorbereiten?“`);
    try {
      const r = await this.o.agenten.aktionStarten('Uni/moodle-durchsehen', { fach: treffer.f.name, frage }, 'klick');
      return this.senden(`🌐 Ich schaue in Moodle nach: <b>${h(treffer.f.titel)}</b>${frage ? `\n<i>${h(frage.slice(0, 300))}</i>` : ''}\n<a href="${this.link(`/chats/${r.chatId}`)}">Chat öffnen</a>`, {}, r.chatId);
    } catch (e) {
      return this.senden(`⚠️ Konnte nicht starten: ${h((e as Error).message)}`);
    }
  }

  // ---- Knöpfe ---------------------------------------------------------------------------------

  signatur(id: string, antwort: 'j' | 'n') {
    return crypto.createHmac('sha256', this.signaturSchluessel).update(`${id}:${antwort}`).digest('base64url').slice(0, 16);
  }

  private knoepfe(id: string) {
    return {
      inline_keyboard: [
        [
          { text: '✅ Ja', callback_data: `f:${id}:j:${this.signatur(id, 'j')}` },
          { text: '❌ Nein', callback_data: `f:${id}:n:${this.signatur(id, 'n')}` },
        ],
      ],
    };
  }

  private async knopf(q: NonNullable<TgUpdate['callback_query']>) {
    const antworten = (text: string) => this.o.api.aufruf('answerCallbackQuery', { callback_query_id: q.id, text }).catch(() => undefined);
    if (!this.istLeif(q.from.id) && !this.istLeif(q.message?.chat.id)) return antworten('Nicht erlaubt.');
    if (q.data?.startsWith('e:')) return this.erledigtKnopf(q, antworten);
    if (q.data?.startsWith('v:')) return this.vorbereitenKnopf(q, antworten);
    if (q.data?.startsWith('t:') || q.data?.startsWith('l:')) return this.todoKnopf(q, antworten);
    if (q.data?.startsWith('k:')) return this.terminKnopf(q, antworten);
    if (q.data?.startsWith('p:')) return this.planKnopf(q, antworten);
    if (q.data?.startsWith('vt:')) return this.verteilenKnopf(q, antworten);
    if (q.data?.startsWith('kk:')) return this.karteKnopf(q, antworten);
    if (q.data?.startsWith('st:')) return this.sternKnopf(q, antworten);
    if (q.data?.startsWith('gw:')) return this.gewohnheitKnopf(q, antworten);
    if (q.data?.startsWith('zl:')) return this.zielKnopf(q, antworten);
    if (q.data?.startsWith('er:')) return this.erinnerKnopf(q, antworten);
    if (q.data?.startsWith('ar:')) return this.aufraeumenKnopf(q, antworten);
    if (q.data?.startsWith('sb:')) return this.schnellKnopf(q, antworten);
    if (q.data?.startsWith('wv:')) return this.vorschlagKnopf(q, antworten);
    if (q.data?.startsWith('pw:')) return this.pruefungKnopf(q, antworten);
    if (q.data?.startsWith('jl:')) return this.jetztKnopf(q, antworten);
    if (q.data?.startsWith('sm:')) return this.stimmungKnopf(q, antworten);
    const m = /^f:([0-9a-f-]{36}):([jn]):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    if (!m || !crypto.timingSafeEqual(Buffer.from(m[3]!), Buffer.from(this.signatur(m[1]!, m[2] as 'j' | 'n')))) {
      this.o.log?.('Telegram: Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    try {
      const f = await this.o.agenten.freigaben.entscheiden(m[1]!, m[2] === 'j');
      await antworten(f.status === 'abgelehnt' ? 'Abgelehnt.' : f.status === 'fehlgeschlagen' ? 'Ausführung fehlgeschlagen.' : 'Erledigt.');
      if (f.status === 'abgelehnt') await this.grundErfragen(f);
    } catch (e) {
      if (e instanceof DorfFehler && e.status === 409) {
        await antworten('Diese Freigabe wurde schon entschieden.');
        await this.freigabeAktualisieren(this.o.agenten.freigaben.holen(m[1]!));
      } else await antworten(`Fehler: ${(e as Error).message}`.slice(0, 190));
    }
  }

  // ---- To-do-Brett (E65) und weitere Listen (Etappe 7) ------------------------------------------

  private todoKennung(pfad: string) {
    return crypto.createHash('sha256').update(pfad).digest('hex').slice(0, 12);
  }
  /** Signatur eines Abhak-Knopfs; die To-do-Liste behält ihr altes Format (ältere Nachrichten bleiben gültig) */
  todoSignatur(kennung: string, liste: ListenName = 'todo') {
    return crypto
      .createHmac('sha256', this.signaturSchluessel)
      .update(liste === 'todo' ? `todo:${kennung}` : `liste:${liste}:${kennung}`)
      .digest('base64url')
      .slice(0, 16);
  }
  private knopfDaten(liste: ListenName, kennung: string) {
    return liste === 'todo' ? `t:${kennung}:${this.todoSignatur(kennung)}` : `l:${LISTEN_KURZ[liste]}:${kennung}:${this.todoSignatur(kennung, liste)}`;
  }

  /** E119: „ ☑ 2/5 → nächster Schritt“ */
  static schrittText(t: { schritte?: { text: string; erledigt: boolean }[] }) {
    const s = t.schritte;
    if (!s?.length) return '';
    const naechster = s.find((x) => !x.erledigt);
    return ` <i>☑ ${s.filter((x) => x.erledigt).length}/${s.length}${naechster ? ` → ${h(naechster.text.slice(0, 60))}` : ''}</i>`;
  }

  private async todoListeText(liste: ListenName) {
    const a = LISTEN_ANZEIGE[liste];
    const offen = (await this.o.listen![liste].liste()).filter((t) => !t.erledigt);
    if (!offen.length) return { text: `${a.symbol} <b>${a.titel}</b>\nNichts offen. 🎉\n<i>${a.befehl} &lt;Text&gt; legt einen Eintrag an.</i>`, knoepfe: [] as { text: string; callback_data: string }[][] };
    const zeilen = offen.slice(0, 25).map((t) => `• ${t.wichtig ? '⭐ ' : ''}${h(t.titel)}${t.gruppe ? ` <i>[${h(t.gruppe)}]</i>` : ''}${t.faellig ? ` <i>(bis ${h(t.faellig)})</i>` : ''}${t.dauer ? ` <i>⏱ ${t.dauer} min</i>` : ''}${TelegramBot.schrittText(t)}`);
    const knoepfe = offen.slice(0, 12).map((t) => [{ text: knopfText(`✅ ${t.titel}`), callback_data: this.knopfDaten(liste, this.todoKennung(t.pfad)) }]);
    return {
      text: `${a.symbol} <b>${a.titel}</b> (${offen.length} offen)\n${zeilen.join('\n')}${offen.length > 25 ? '\n…' : ''}\n<a href="${this.link(`/?g=${encodeURIComponent(LISTEN[liste].gebaeude)}`)}">Öffnen</a>`,
      knoepfe,
    };
  }

  private async todoBefehl(rest: string, liste: ListenName = 'todo') {
    if (!this.o.listen) return this.senden('Die Listen sind nicht eingerichtet.');
    if (rest) {
      try {
        const heute = new Date(this.o.uhr.jetzt()).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
        // „… 30 min jeden Montag“ und „… jeden Montag 30 min“ (E120)
        const t = await this.o.listen[liste].anlegen(liste === 'todo' ? todoAusText(rest, heute) : wiederholungAusText(rest.slice(0, 200), heute), 'Telegram');
        return this.senden(`${LISTEN_ANZEIGE[liste].symbol} Auf die ${LISTEN[liste].titel}: <b>${h(t.titel)}</b>${t.wiederholen ? ` · 🔁 ${h(t.wiederholen)}${t.faellig ? ` ab ${h(t.faellig)}` : ''}` : ''}${t.dauer ? ` · ⏱ ${t.dauer} min` : ''}`);
      } catch (e) {
        return this.senden(`⚠️ ${h((e as Error).message)}`);
      }
    }
    const l = await this.todoListeText(liste);
    return this.senden(l.text, l.knoepfe.length ? { reply_markup: { inline_keyboard: l.knoepfe } } : {});
  }

  private async todoKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const alt = /^t:([0-9a-f]{12}):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    const neu = /^l:([a-z]):([0-9a-f]{12}):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    const liste: ListenName | undefined = alt ? 'todo' : neu ? (Object.entries(LISTEN_KURZ).find(([, k]) => k === neu[1])?.[0] as ListenName | undefined) : undefined;
    const kennung = alt?.[1] ?? neu?.[2];
    const sig = alt?.[2] ?? neu?.[3];
    if (!liste || !kennung || !sig || !this.o.listen || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(this.todoSignatur(kennung, liste)))) {
      this.o.log?.('Telegram: Listen-Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    const dienst = this.o.listen[liste];
    const t = (await dienst.liste()).find((x) => this.todoKennung(x.pfad) === kennung);
    if (!t) return antworten('Diesen Eintrag gibt es nicht mehr.');
    if (!t.erledigt) await dienst.aendern(t.pfad, { erledigt: true });
    await antworten(`Erledigt: ${t.titel}`.slice(0, 190));
    if (q.message) {
      const l = await this.todoListeText(liste);
      await this.o.api
        .aufruf('editMessageText', {
          chat_id: q.message.chat.id,
          message_id: q.message.message_id,
          text: l.text,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...(l.knoepfe.length ? { reply_markup: { inline_keyboard: l.knoepfe } } : {}),
        })
        .catch(() => undefined);
    }
  }

  // ---- /termin (Nacht 18./19.11.) ---------------------------------------------------------------

  private terminSignatur(id: string) {
    return crypto.createHmac('sha256', this.signaturSchluessel).update(`termin:${id}`).digest('base64url').slice(0, 16);
  }
  private terminWartend(): Record<string, { termin: TerminAusText; zeit: number }> {
    const w = (this.o.db.prepare("SELECT wert FROM dorf_stand WHERE schluessel = 'telegram_termine'").get() as { wert: string } | undefined)?.wert;
    return w ? JSON.parse(w) : {};
  }
  private terminWartendSetzen(x: Record<string, { termin: TerminAusText; zeit: number }>) {
    // höchstens 20, älter als ein Tag fällt weg
    const jetzt = this.o.uhr.jetzt();
    const rest = Object.entries(x)
      .filter(([, v]) => jetzt - v.zeit < 86_400_000)
      .slice(-20);
    this.o.db.prepare("INSERT OR REPLACE INTO dorf_stand (schluessel, wert) VALUES ('telegram_termine', ?)").run(JSON.stringify(Object.fromEntries(rest)));
  }
  static terminText(t: TerminAusText) {
    const tag = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
    const wann = t.ganztags ? `${tag(t.start)} (ganztags)` : `${tag(t.start)}, ${t.start.slice(11)}–${t.ende.slice(11)}`;
    return `<b>${h(t.titel)}</b>\n${wann}${t.ort ? `\n📍 ${h(t.ort)}` : ''}`;
  }

  private async terminBefehl(rest: string) {
    if (!rest)
      return this.senden('📅 <b>/termin</b> &lt;wann&gt; &lt;was&gt;\nz. B. <i>/termin morgen 14 Uhr Zahnarzt</i>, <i>/termin Fr 9-11 Lernen Mathe</i>, <i>/termin 20.11. 18:30 Kneipe @Corpshaus</i>');
    if (!this.o.kalender?.verbunden) return this.senden('📅 Der Google-Kalender ist noch nicht verbunden (auf dem Server: dorf gmail-anmelden, mit Kalender).');
    const t = terminAusText(rest, this.o.uhr.jetzt());
    if (!t) return this.senden('📅 Das habe ich nicht verstanden – z. B. <i>/termin morgen 14 Uhr Zahnarzt</i>.');
    const id = crypto.randomBytes(6).toString('hex');
    this.terminWartendSetzen({ ...this.terminWartend(), [id]: { termin: t, zeit: this.o.uhr.jetzt() } });
    return this.senden(`📅 So eintragen?\n${TelegramBot.terminText(t)}`, {
      reply_markup: { inline_keyboard: [[{ text: '✅ Eintragen', callback_data: `k:${id}:${this.terminSignatur(id)}` }]] },
    });
  }

  private async terminKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const m = /^k:([0-9a-f]{12}):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    if (!m || !crypto.timingSafeEqual(Buffer.from(m[2]!), Buffer.from(this.terminSignatur(m[1]!)))) {
      this.o.log?.('Telegram: Termin-Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    const alle = this.terminWartend();
    const w = alle[m[1]!];
    if (!w || !this.o.kalender) return antworten('Schon eingetragen oder abgelaufen.');
    delete alle[m[1]!];
    this.terminWartendSetzen(alle);
    try {
      await this.o.kalender.inHauptkalender(w.termin);
    } catch (e) {
      return antworten(`Fehler: ${(e as Error).message}`.slice(0, 190));
    }
    await antworten('Eingetragen.');
    if (q.message)
      await this.o.api
        .aufruf('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: `📅 Eingetragen:\n${TelegramBot.terminText(w.termin)}`, parse_mode: 'HTML' })
        .catch(() => undefined);
  }

  // ---- /plan (Nacht 18./19.11.): Tag planen wie in der App, eingetragen wird erst per Knopf --------

  private planSignatur(teil: string) {
    return crypto.createHmac('sha256', this.signaturSchluessel).update(`plan:${teil}`).digest('base64url').slice(0, 16);
  }
  private planWartend(): Record<string, { bloecke: PlanBlock[]; eingetragen: number[]; zeit: number }> {
    const w = (this.o.db.prepare("SELECT wert FROM dorf_stand WHERE schluessel = 'telegram_plaene'").get() as { wert: string } | undefined)?.wert;
    return w ? JSON.parse(w) : {};
  }
  private planWartendSetzen(x: Record<string, { bloecke: PlanBlock[]; eingetragen: number[]; zeit: number }>) {
    const jetzt = this.o.uhr.jetzt();
    const rest = Object.entries(x)
      .filter(([, v]) => jetzt - v.zeit < 86_400_000)
      .slice(-10);
    this.o.db.prepare("INSERT OR REPLACE INTO dorf_stand (schluessel, wert) VALUES ('telegram_plaene', ?)").run(JSON.stringify(Object.fromEntries(rest)));
  }
  private static uhrzeit(iso: string) {
    return new Date(iso).toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' });
  }
  private planTastatur(id: string, p: { bloecke: PlanBlock[]; eingetragen: number[] }) {
    const k = (teil: string) => `p:${teil}:${this.planSignatur(teil)}`;
    const zeilen = p.bloecke.map((b, i) => [
      { text: knopfText(`${p.eingetragen.includes(i) ? '✅' : '➕'} ${TelegramBot.uhrzeit(b.start)} ${b.titel}`), callback_data: k(`${id}:${i}`) },
    ]);
    if (p.eingetragen.length < p.bloecke.length) zeilen.push([{ text: '📅 Alle eintragen', callback_data: k(`${id}:a`) }]);
    return zeilen;
  }

  private async planBefehl(rest: string) {
    const k = this.o.kalender;
    if (!k?.verbunden || !k.freiAmTag || !k.bloeckeEintragen) return this.senden('🧭 Dafür braucht es den Google-Kalender (auf dem Server: dorf gmail-anmelden, mit Kalender).');
    if (!this.o.listen) return this.senden('Das To-do-Brett ist nicht eingerichtet.');
    const morgen = /^morgen$/i.test(rest);
    if (rest && !morgen) return this.senden('🧭 <b>/plan</b> plant heute, <b>/plan morgen</b> den nächsten Tag.');
    const tag = tagVonJetzt(this.o.uhr.jetzt(), morgen ? 1 : 0);
    const frei = await k.freiAmTag(tag);
    const bloecke = tagPlanen({ todos: await this.o.listen.todo.liste(), heute: tag, frei }).map((b) => ({
      titel: b.titel,
      grund: b.grund,
      start: new Date(b.start).toISOString(),
      ende: new Date(b.ende).toISOString(),
    }));
    if (!bloecke.length) return this.senden(`🧭 ${morgen ? 'Morgen' : 'Heute'} gibt es nichts einzuplanen – keine offenen To-dos mit passender Lücke im Kalender.`);
    const id = crypto.randomBytes(6).toString('hex');
    const p = { bloecke, eingetragen: [] as number[], zeit: this.o.uhr.jetzt() };
    this.planWartendSetzen({ ...this.planWartend(), [id]: p });
    const liste = bloecke.map((b) => `• ${TelegramBot.uhrzeit(b.start)}–${TelegramBot.uhrzeit(b.ende)} <b>${h(b.titel)}</b> <i>(${h(b.grund)})</i>`).join('\n');
    return this.senden(`🧭 <b>Vorschlag für ${morgen ? 'morgen' : 'heute'}</b>\n${liste}\n\nAntippen trägt den Block in deinen Kalender ein.`, { reply_markup: { inline_keyboard: this.planTastatur(id, p) } });
  }

  private async planKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const m = /^p:([0-9a-f]{12}):(a|\d{1,2}):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    if (!m || !crypto.timingSafeEqual(Buffer.from(m[3]!), Buffer.from(this.planSignatur(`${m[1]}:${m[2]}`)))) {
      this.o.log?.('Telegram: Plan-Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    const alle = this.planWartend();
    const p = alle[m[1]!];
    if (!p || !this.o.kalender?.bloeckeEintragen) return antworten('Dieser Vorschlag ist abgelaufen – /plan macht einen neuen.');
    const nr = m[2] === 'a' ? p.bloecke.map((_, i) => i).filter((i) => !p.eingetragen.includes(i)) : [Number(m[2])].filter((i) => i < p.bloecke.length && !p.eingetragen.includes(i));
    if (!nr.length) return antworten('Schon eingetragen.');
    // erst vermerken, dann eintragen – ein Doppelklick trägt nichts doppelt ein
    p.eingetragen.push(...nr);
    this.planWartendSetzen(alle);
    try {
      await this.o.kalender.bloeckeEintragen(nr.map((i) => ({ titel: p.bloecke[i]!.titel, start: p.bloecke[i]!.start, ende: p.bloecke[i]!.ende })));
    } catch (e) {
      p.eingetragen = p.eingetragen.filter((i) => !nr.includes(i));
      this.planWartendSetzen(alle);
      return antworten(`Fehler: ${(e as Error).message}`.slice(0, 190));
    }
    await antworten(nr.length === 1 ? 'Eingetragen.' : `${nr.length} Blöcke eingetragen.`);
    if (q.message)
      await this.o.api
        .aufruf('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: this.planTastatur(m[1]!, p) } })
        .catch(() => undefined);
  }

  // ---- E128: /verteilen – „Woche verteilen“ (E126) am Handy -----------------------------------------

  private verteilenWartend(): Record<string, { v: { pfad: string; titel: string; tag: string; dauer: number; version?: string }[]; uebernommen: number[]; zeit: number }> {
    const w = (this.o.db.prepare("SELECT wert FROM dorf_stand WHERE schluessel = 'telegram_verteilen'").get() as { wert: string } | undefined)?.wert;
    return w ? JSON.parse(w) : {};
  }
  private verteilenWartendSetzen(x: ReturnType<TelegramBot['verteilenWartend']>) {
    const jetzt = this.o.uhr.jetzt();
    const rest = Object.entries(x)
      .filter(([, v]) => jetzt - v.zeit < 2 * 86_400_000)
      .slice(-5);
    this.o.db.prepare("INSERT OR REPLACE INTO dorf_stand (schluessel, wert) VALUES ('telegram_verteilen', ?)").run(JSON.stringify(Object.fromEntries(rest)));
  }
  private verteilenTastatur(id: string, p: { v: { titel: string; tag: string }[]; uebernommen: number[] }) {
    const k = (teil: string) => `vt:${teil}:${this.planSignatur(`vt:${teil}`)}`;
    const zeilen = p.v.slice(0, 12).map((x, i) => [{ text: knopfText(`${p.uebernommen.includes(i) ? '✅' : '➕'} ${TelegramBot.tagKurz(x.tag)} ${x.titel}`), callback_data: k(`${id}:${i}`) }]);
    if (p.uebernommen.length < Math.min(12, p.v.length)) zeilen.push([{ text: '🗓️ Alle übernehmen', callback_data: k(`${id}:a`) }]);
    return zeilen;
  }
  private static tagKurz(tag: string) {
    return new Date(`${tag}T12:00:00Z`).toLocaleDateString('de-AT', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });
  }

  private async verteilenBefehl() {
    if (!this.o.listen) return this.senden('Die To-do-Liste ist nicht eingerichtet.');
    const jetzt = this.o.uhr.jetzt();
    const heute = tagVonJetzt(jetzt, 0);
    const wt = (new Date(`${heute}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = Montag
    // sonntags wird die nächste Woche geplant, sonst der Rest dieser Woche
    const tage = wt === 6 ? Array.from({ length: 7 }, (_, i) => tagVonJetzt(jetzt, i + 1)) : Array.from({ length: 7 - wt }, (_, i) => tagVonJetzt(jetzt, i));
    const grenze = (tag: string, std: number) => ortszeitZuUtc(...(tag.split('-').map(Number) as [number, number, number]), std, 0, 0, 'Europe/Vienna');
    let termine: KalenderTermin[] = [];
    if (this.o.kalender?.zeitraum) {
      const z = await this.o.kalender.zeitraum(grenze(tage[0]!, 0), grenze(tage.at(-1)!, 0) + 86_400_000).catch(() => null);
      termine = (z?.termine ?? []).filter((t): t is KalenderTermin => typeof t.start === 'string' && typeof t.ende === 'string' && typeof t.ganztags === 'boolean');
    }
    const iv = termine.filter((t) => !t.ganztags).map((t) => [Date.parse(t.start), Date.parse(t.ende)] as [number, number]);
    const todos = (await this.o.listen.todo.liste()).filter((t) => !t.erledigt);
    // wiederkehrende To-dos nicht verschieben – die Serie rechnet vom Fälligkeitsdatum weiter (Review)
    const eingang = todos.filter((t) => !t.faellig || (t.faellig < heute && !t.wiederholen));
    if (!eingang.length) return this.senden('📥 Nichts ohne Datum oder überfällig – deine Woche ist verteilt. 🎉');
    const v = wocheVerteilen({
      eingang,
      heute,
      tage: tage.map((tag) => {
        // heute zählt nur die Zeit ab jetzt (frühestens 8 Uhr) – um 22:30 ist nichts mehr frei (Review)
        const von = Math.max(grenze(tag, 8), tag === heute ? jetzt : 0);
        const bis = grenze(tag, 22);
        return {
          tag,
          freiMin: Math.max(0, Math.round((bis - von - belegtMs(iv, von, bis)) / 60_000)),
          geplantMin: todos.filter((t) => t.faellig === tag).reduce((s2, t) => s2 + (t.dauer ?? 30), 0),
        };
      }),
    })
      .slice(0, 12)
      .map((x) => ({ ...x, version: todos.find((t) => t.pfad === x.pfad)?.version }));
    if (!v.length) return this.senden(`📥 ${eingang.length} To-dos warten, aber ${wt === 6 ? 'nächste Woche' : 'diese Woche'} ist kein Platz mehr frei (70 % der freien Zeit sind schon verplant). Lieber etwas streichen oder später einplanen.`);
    const id = crypto.randomBytes(6).toString('hex');
    const p = { v, uebernommen: [] as number[], zeit: jetzt };
    this.verteilenWartendSetzen({ ...this.verteilenWartend(), [id]: p });
    const rest = eingang.length - v.length;
    return this.senden(
      `🗓️ <b>Vorschlag: ${wt === 6 ? 'nächste Woche' : 'Rest der Woche'}</b>\n${v
        .slice(0, 12)
        .map((x) => `• ${TelegramBot.tagKurz(x.tag)} – ${h(x.titel)} <i>(⏱ ${minutenText(x.dauer)})</i>`)
        .join('\n')}${rest > 0 ? `\n<i>${rest} passen nicht mehr hinein.</i>` : ''}\n\nAntippen setzt das Fälligkeitsdatum.`,
      { reply_markup: { inline_keyboard: this.verteilenTastatur(id, p) } },
    );
  }

  private async verteilenKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const m = /^vt:([0-9a-f]{12}):(a|\d{1,2}):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    if (!m || !crypto.timingSafeEqual(Buffer.from(m[3]!), Buffer.from(this.planSignatur(`vt:${m[1]}:${m[2]}`)))) {
      this.o.log?.('Telegram: Verteilen-Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    const alle = this.verteilenWartend();
    const p = alle[m[1]!];
    if (!p || !this.o.listen) return antworten('Dieser Vorschlag ist abgelaufen – /verteilen macht einen neuen.');
    const nr = m[2] === 'a' ? p.v.slice(0, 12).map((_, i) => i).filter((i) => !p.uebernommen.includes(i)) : [Number(m[2])].filter((i) => i < p.v.length && !p.uebernommen.includes(i));
    if (!nr.length) return antworten('Schon übernommen.');
    p.uebernommen.push(...nr);
    this.verteilenWartendSetzen(alle);
    let ok = 0;
    for (const i of nr) {
      const x = p.v[i]!;
      try {
        // abgelaufener Vorschlag (Tag vorbei) oder inzwischen geändert (basisVersion → 409): nicht anwenden (Review)
        if (x.tag < tagVonJetzt(this.o.uhr.jetzt(), 0)) throw new Error('Tag ist schon vorbei');
        await this.o.listen.todo.aendern(x.pfad, { faellig: x.tag }, x.version);
        ok++;
      } catch (e) {
        p.uebernommen = p.uebernommen.filter((j) => j !== i);
        this.o.log?.(`Telegram /verteilen: ${(e as Error).message}`);
      }
    }
    this.verteilenWartendSetzen(alle);
    await antworten(ok === nr.length ? (ok === 1 ? 'Eingeplant.' : `${ok} eingeplant.`) : `${ok} von ${nr.length} eingeplant – der Rest wurde inzwischen geändert oder der Tag ist vorbei. /verteilen macht einen neuen Vorschlag.`);
    if (q.message)
      await this.o.api
        .aufruf('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: this.verteilenTastatur(m[1]!, p) } })
        .catch(() => undefined);
  }

  // ---- /karten und /fokus (Nacht 18./19.11.) -----------------------------------------------------

  private karteSignatur(teil: string) {
    return crypto.createHmac('sha256', this.signaturSchluessel).update(`karte:${teil}`).digest('base64url').slice(0, 16);
  }
  /** Knopf: kk:<Fach-Nr>:<Karten-Id>:<a|n|s|g|l>:<Signatur> – a = Antwort zeigen */
  private karteDaten(nr: number, id: string, b: string) {
    const teil = `${nr}:${id}:${b}`;
    return `kk:${teil}:${this.karteSignatur(teil)}`;
  }
  private async kartenFaecher() {
    return (await this.o.karten!.uebersicht()).map((f) => f.fach);
  }

  private async karteZeigen(nr: number, fach: string, ziel?: { chat: number | string; message: number }) {
    const k = (await this.o.karten!.faellig(fach, 1))[0];
    const text = k ? `🃏 <b>${h(fach)}</b>${k.neu ? ' · neu' : ''}\n\n${h(k.frage)}` : `🃏 <b>${h(fach)}</b>\nFertig für heute. 🎉`;
    const extra = k ? { reply_markup: { inline_keyboard: [[{ text: 'Antwort zeigen', callback_data: this.karteDaten(nr, k.id, 'a') }]] } } : {};
    if (ziel) return this.o.api.aufruf('editMessageText', { chat_id: ziel.chat, message_id: ziel.message, text, parse_mode: 'HTML', ...extra }).catch(() => undefined);
    return this.senden(text, extra);
  }

  private async kartenBefehl(rest: string) {
    if (!this.o.karten) return this.senden('Karteikarten sind nicht eingerichtet.');
    const ueb = await this.o.karten.uebersicht();
    if (!ueb.length) return this.senden('🃏 Noch keine Karteikarten. In der App: Uni → Aktionen → „Karteikarten erstellen“.');
    const f = rest ? ueb.find((x) => x.fach.toLowerCase().includes(rest.toLowerCase())) : ueb.filter((x) => x.faellig).sort((a, b) => b.faellig - a.faellig)[0];
    if (!f) {
      const zeilen = ueb.map((x) => `• ${h(x.fach)}: <b>${x.faellig}</b> dran`);
      return this.senden(`🃏 <b>Karteikarten</b>\n${zeilen.join('\n')}\n\n<i>/karten &lt;Fach&gt; zum Lernen</i>`);
    }
    return this.karteZeigen(ueb.findIndex((x) => x.fach === f.fach), f.fach);
  }

  private async karteKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const m = /^kk:(\d{1,3}):([0-9a-f]{20}):([ansgl]):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    if (!m || !this.o.karten || !crypto.timingSafeEqual(Buffer.from(m[4]!), Buffer.from(this.karteSignatur(`${m[1]}:${m[2]}:${m[3]}`)))) {
      this.o.log?.('Telegram: Karten-Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    const nr = Number(m[1]);
    const fach = (await this.kartenFaecher())[nr];
    const karte = fach ? (await this.o.karten.karten(fach)).find((x) => x.id === m[2]) : undefined;
    if (!fach || !karte) return antworten('Diese Karte gibt es nicht mehr.');
    const ziel = q.message ? { chat: q.message.chat.id, message: q.message.message_id } : undefined;
    if (m[3] === 'a') {
      await antworten('');
      const knopf = (t: string, b: string) => ({ text: t, callback_data: this.karteDaten(nr, karte.id, b) });
      if (ziel)
        await this.o.api
          .aufruf('editMessageText', {
            chat_id: ziel.chat,
            message_id: ziel.message,
            text: `🃏 <b>${h(fach)}</b>\n\n${h(karte.frage)}\n\n<b>Antwort:</b>\n${h(karte.antwort)}`,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[knopf('Nochmal', 'n'), knopf('Schwer', 's'), knopf('Gut', 'g'), knopf('Leicht', 'l')]] },
          })
          .catch(() => undefined);
      return;
    }
    const b = ({ n: 'nochmal', s: 'schwer', g: 'gut', l: 'leicht' } as const)[m[3] as 'n' | 's' | 'g' | 'l'];
    await this.o.karten.antworten(fach, karte.id, b);
    await antworten(b === 'nochmal' ? 'Kommt gleich wieder.' : 'Weiter!');
    await this.karteZeigen(nr, fach, ziel);
  }

  // ---- Tagesabschluss 21:00 (Nacht 18./19.11.) ----------------------------------------------------

  /** 21:00–21:59 Linz, einmal am Tag (Schalter „abend“) – wird vom 10-min-Takt aufgerufen */
  async abendSenden(erzwingen = false) {
    if (!this.o.listen || !(await einstellungenLaden(this.o.vault)).abend) return false;
    const jetzt = this.o.uhr.jetzt();
    const tag = new Date(jetzt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
    const stunde = Number(new Date(jetzt).toLocaleString('en-GB', { timeZone: 'Europe/Vienna', hour: '2-digit', hour12: false }));
    const schon = (this.o.db.prepare("SELECT wert FROM dorf_stand WHERE schluessel = 'telegram_abend'").get() as { wert: string } | undefined)?.wert;
    if (!erzwingen && (stunde !== 21 || schon === tag)) return false;
    this.o.db.prepare("INSERT OR REPLACE INTO dorf_stand (schluessel, wert) VALUES ('telegram_abend', ?)").run(tag);
    const alle = await this.o.listen.todo.liste();
    const erledigt = alle.filter((t) => t.erledigt && t.erledigtAm && new Date(t.erledigtAm).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' }) === tag);
    const fokus = this.o.kirchturm?.fokusStatistik?.();
    const karten = this.o.karten ? (await this.o.karten.uebersicht()).reduce((s2, f) => s2 + f.faellig, 0) : 0;
    const morgen = tagVonJetzt(jetzt, 1);
    const fristen = (this.o.uni?.fristen() ?? []).filter((f) => (f.art === 'abgabe' || f.art === 'test') && !f.abgegeben && f.frist && new Date(f.frist).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' }) === morgen);
    const z = [`🌙 <b>Tagesabschluss</b>`];
    z.push(erledigt.length ? `✓ <b>${erledigt.length}</b> erledigt: ${erledigt.slice(0, 6).map((t) => h(t.titel)).join(', ')}` : '✓ Heute nichts abgehakt – morgen ist ein neuer Tag.');
    const ziel = this.o.kirchturm?.zustand?.().pomodoro.einstellungen.tagesZielMin ?? 0;
    if (fokus?.heuteMin || ziel)
      z.push(
        `🍅 ${fokus?.heuteMin ?? 0} min Fokus${ziel ? (fokus && fokus.heuteMin >= ziel ? ` – 🎯 Ziel (${ziel} min) erreicht` : ` von ${ziel} min Ziel`) : ''}${fokus && fokus.serie > 1 ? ` · ${fokus.serie} Tage in Folge 🔥` : ''}`,
      );
    if (karten) z.push(`🃏 ${karten} Karteikarten noch dran – /karten`);
    const ueberfaellig = alle.filter((t) => !t.erledigt && t.faellig && t.faellig < tag).length;
    if (ueberfaellig) z.push(`⚠️ ${ueberfaellig} überfällig – /aufraeumen plant sie in einer Minute neu`);
    if (fristen.length) z.push(`⏰ Morgen fällig: ${fristen.map((f) => h(f.titel)).join(', ')}`);
    z.push('\n⭐ <b>Was ist morgen wichtig?</b> Tipp an, was oben auf deiner Liste stehen soll:');
    const t = this.sternAuswahl(alle, morgen);
    const ok = !!(await this.senden(z.join('\n'), { reply_markup: { inline_keyboard: t } }));
    if (ok) await this.gewohnheitenSenden(true).catch((e) => this.fehler(e));
    if (ok) await this.stimmungFragen(tag).catch((e) => this.fehler(e));
    return ok;
  }

  // ---- /woche (E100) ----------------------------------------------------------------------------------

  private async wocheSenden() {
    if (!this.o.woche) return this.senden('Der Wochenüberblick ist gerade nicht verfügbar.');
    const f = await this.o.woche.fakten();
    const fett = (t: string) => h(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    const teil = (titel: string, anzeige: string) => {
      const a = f.abschnitte.find((x) => x.titel === titel);
      // mitten in der Woche ist ein offenes Ziel noch nicht „verfehlt“
      return a && a.zeilen.length ? `<b>${anzeige}</b>\n${a.zeilen.slice(0, 14).map((z) => `• ${fett(z.replace(/^✗ /, '☐ '))}`).join('\n')}` : null;
    };
    const teile = [teil('Wochenziele', '🎯 Wochenziele'), teil('Nächste Woche', '📅 Die nächsten 7 Tage'), teil('Gewohnheiten', '🔁 Gewohnheiten (7 Tage)')].filter(Boolean);
    return this.senden(`🗓️ <b>Deine Woche</b>\n\n${teile.length ? teile.join('\n\n') : 'Nichts geplant – ein guter Moment für /ziel.'}`);
  }

  // ---- Prüfungs-Wächter (E105) -----------------------------------------------------------------------

  // ---- E123: /jetzt – ein To-do für die Lücke bis zum nächsten Termin ------------------------------

  private jetztDaten(k: string) {
    return `jl:${k}:${crypto.createHmac('sha256', this.signaturSchluessel).update(`jetzt:${k}`).digest('base64url').slice(0, 16)}`;
  }

  private async jetztBefehl() {
    if (!this.o.listen) return this.senden('Die To-do-Liste ist nicht eingerichtet.');
    const jetzt = this.o.uhr.jetzt();
    const teile = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(jetzt)).map((x) => [x.type, x.value]));
    const heute = `${teile.year}-${teile.month}-${teile.day}`;
    const jetztMin = Number(teile.hour) * 60 + Number(teile.minute);
    const beginn = ortszeitZuUtc(Number(teile.year), Number(teile.month), Number(teile.day), 0, 0, 0, 'Europe/Vienna');
    let termine: KalenderTermin[] = [];
    if (this.o.kalender?.zeitraum) {
      const z = await this.o.kalender.zeitraum(beginn, beginn + 86_400_000).catch(() => null);
      termine = (z?.termine ?? []).filter((t): t is KalenderTermin => typeof t.start === 'string' && typeof t.ende === 'string' && typeof t.ganztags === 'boolean');
    }
    const fokus = new Map((this.o.db.prepare('SELECT todo, SUM(minuten) AS m FROM fokus_sitzungen WHERE todo IS NOT NULL GROUP BY todo').all() as { todo: string; m: number }[]).map((x) => [x.todo, Math.round(x.m)]));
    const todos = (await this.o.listen.todo.liste()).map((t) => (fokus.get(t.pfad) ? { ...t, fokusMin: fokus.get(t.pfad) } : t));
    const d = jetztDran({ todos, termine, jetzt, jetztMin, heute });
    if (!d) return this.senden(jetztMin >= 22 * 60 ? '🌙 Feierabend – für heute ist nichts mehr dran.' : '👉 Gerade passt nichts Dringendes hinein (Termin läuft, zu wenig Zeit oder nichts fällig). Zeit für dich. 🌿');
    const luecke = d.bis ? `${minutenText(d.luecke)} bis ${h(d.bis.titel)}` : `${minutenText(d.luecke)} bis 22 Uhr`;
    return this.senden(
      `👉 <b>Jetzt dran:</b> ${h(d.todo.titel)}${d.schritt ? `\nnächster Schritt: ${h(d.schritt)}` : ''}\n<i>${d.passt ? `passt in die ${luecke}` : `für einen 🍅 reicht's (${luecke})`}${d.todo.dauer ? ` · ⏱ ${minutenText(d.todo.dauer)}` : ''}</i>`,
      { reply_markup: { inline_keyboard: [[{ text: '🍅 Los', callback_data: this.jetztDaten(this.todoKennung(d.todo.pfad)) }]] } },
    );
  }

  private async jetztKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const m = /^jl:([0-9a-f]{12}):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    if (!m || !crypto.timingSafeEqual(Buffer.from(m[2]!), Buffer.from(this.jetztDaten(m[1]!).split(':')[2]!))) {
      this.o.log?.('Telegram: Jetzt-Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    const t = (await this.o.listen?.todo.liste())?.find((x) => this.todoKennung(x.pfad) === m[1] && !x.erledigt);
    if (!t || !this.o.kirchturm) return antworten('Dieses To-do gibt es nicht mehr.');
    this.o.kirchturm.ausfuehren({ befehl: 'pomodoro_fuer', titel: t.titel.slice(0, 200), ...(t.gruppe ? { gruppe: t.gruppe } : {}), pfad: t.pfad });
    await antworten('🍅 Läuft!');
    return this.senden(`🍅 Fokus läuft: <b>${h(t.titel)}</b> – ich halte Meldungen zurück, bis die Arbeitsphase vorbei ist.`);
  }

  private pruefungDaten(k: string, std: number) {
    return `pw:${k}:${std}:${crypto.createHmac('sha256', this.signaturSchluessel).update(`pruefung:${k}:${std}`).digest('base64url').slice(0, 16)}`;
  }

  /**
   * Einmal je Prüfung (To-do „Prüfung: …“ in 3–14 Tagen) fragen, wenn im Kalender noch kein „📚 …<Name>“-Block steht.
   * Tagsüber (9–20 Uhr), nie nachts; gemerkt wird je Pfad+Datum, damit eine verschobene Prüfung neu zählt.
   */
  async pruefungsWaechter() {
    const k = this.o.kalender;
    if (!this.o.listen || !k?.verbunden || !k.zeitraum || !k.lernplan) return 0;
    const jetzt = this.o.uhr.jetzt();
    const stunde = Number(new Date(jetzt).toLocaleString('en-GB', { timeZone: 'Europe/Vienna', hour: '2-digit', hour12: false }));
    if (stunde < 9 || stunde >= 20) return 0;
    // während einer Fokusphase nicht stören – die Frage kommt im nächsten Takt (sie trägt Knöpfe, die Sammelnachricht nicht)
    if (this.fokusAktiv()) return 0;
    const gemeldet = new Set<string>(JSON.parse((this.o.db.prepare("SELECT wert FROM dorf_stand WHERE schluessel = 'telegram_pruefungen'").get() as { wert: string } | undefined)?.wert ?? '[]'));
    const von = this.heuteTag(3);
    const bis = this.heuteTag(14);
    let n = 0;
    for (const t of await this.o.listen.todo.liste()) {
      if (t.erledigt || !t.faellig || !/^Prüfung:\s*/i.test(t.titel) || t.faellig < von || t.faellig > bis) continue;
      const schluessel = `${t.pfad}|${t.faellig}`;
      if (gemeldet.has(schluessel)) continue;
      gemeldet.add(schluessel);
      // sofort merken – fällt das Senden aus, kommt dieselbe Frage nicht im nächsten Takt nochmal (Review)
      this.o.db.prepare("INSERT OR REPLACE INTO dorf_stand (schluessel, wert) VALUES ('telegram_pruefungen', ?)").run(JSON.stringify([...gemeldet].slice(-100)));
      const name = t.titel.replace(/^Prüfung:\s*/i, '');
      const tagMs = ortszeitZuUtc(...(t.faellig.split('-').map(Number) as [number, number, number]), 0, 0, 0, 'Europe/Vienna');
      const termine = await k.zeitraum(jetzt, tagMs).catch(() => null);
      if (!termine || termine.termine.some((x) => x.titel.startsWith('📚') && x.titel.toLowerCase().includes(name.toLowerCase()))) continue;
      const tage = Math.round((Date.parse(`${t.faellig}T12:00:00Z`) - Date.parse(`${this.heuteTag()}T12:00:00Z`)) / 86_400_000);
      const kk = this.todoKennung(t.pfad);
      await this.senden(`📚 <b>${h(name)}</b> ist in ${tage} Tagen (${h(t.faellig)}) – im Kalender steht noch keine Lernzeit dafür.\nSoll ich einen Lernplan bis zum Vorabend vorschlagen?`, {
        reply_markup: { inline_keyboard: [[6, 10, 15].map((std) => ({ text: `${std} h`, callback_data: this.pruefungDaten(kk, std) }))] },
      });
      n++;
    }
    this.o.db.prepare("INSERT OR REPLACE INTO dorf_stand (schluessel, wert) VALUES ('telegram_pruefungen', ?)").run(JSON.stringify([...gemeldet].slice(-100)));
    return n;
  }

  private async pruefungKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const m = /^pw:([0-9a-f]{12}):(6|10|15):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    const k = this.o.kalender;
    if (!m || !this.o.listen || !k?.lernplan || !crypto.timingSafeEqual(Buffer.from(m[3]!), Buffer.from(this.pruefungDaten(m[1]!, Number(m[2])).split(':')[3]!))) {
      this.o.log?.('Telegram: Prüfungs-Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    const t = (await this.o.listen.todo.liste()).find((x) => this.todoKennung(x.pfad) === m[1]);
    if (!t?.faellig) return antworten('Diese Prüfung gibt es nicht mehr.');
    await antworten('Suche freie Zeiten …');
    const name = t.titel.replace(/^Prüfung:\s*/i, '');
    const bis = ortszeitZuUtc(...(t.faellig.split('-').map(Number) as [number, number, number]), 0, 0, 0, 'Europe/Vienna');
    const plan = await k.lernplan({ bis, stunden: Number(m[2]), dauerMin: 90 });
    if (!plan.bloecke.length) return this.senden(`📚 Bis ${h(t.faellig)} ist zwischen 9 und 20 Uhr keine passende Lücke mehr frei.`);
    const bloecke = plan.bloecke.map((b) => ({ titel: `Lernen: ${name}`, grund: name, start: b.start, ende: b.ende }));
    const id = crypto.randomBytes(6).toString('hex');
    const p = { bloecke, eingetragen: [] as number[], zeit: this.o.uhr.jetzt() };
    this.planWartendSetzen({ ...this.planWartend(), [id]: p });
    const tag = (iso: string) => new Date(iso).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', weekday: 'short', day: '2-digit', month: '2-digit' });
    const liste = bloecke.map((b) => `• ${tag(b.start)} ${TelegramBot.uhrzeit(b.start)}–${TelegramBot.uhrzeit(b.ende)}`).join('\n');
    const hinweis = plan.bloecke.length < plan.gewuenscht ? `\n<i>Nur ${plan.bloecke.length} von ${plan.gewuenscht} Blöcken passen hinein.</i>` : '';
    return this.senden(`📚 <b>Lernplan ${h(name)}</b> (${m[2]} h, je 1,5 h)\n${liste}${hinweis}\n\nAntippen trägt den Block in deinen Kalender ein.`, { reply_markup: { inline_keyboard: this.planTastatur(id, p) } });
  }

  // ---- Stimmung (E107) -------------------------------------------------------------------------------

  private stimmungDaten(tag: string, wert: number) {
    return `sm:${tag}:${wert}:${crypto.createHmac('sha256', this.signaturSchluessel).update(`stimmung:${tag}:${wert}`).digest('base64url').slice(0, 16)}`;
  }
  async stimmungFragen(tag: string) {
    return this.senden('💭 <b>Wie war dein Tag?</b>', { reply_markup: { inline_keyboard: [STIMMUNGEN.map((e, i) => ({ text: e, callback_data: this.stimmungDaten(tag, i + 1) }))] } });
  }
  private async stimmungKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const m = /^sm:(\d{4}-\d{2}-\d{2}):([1-5]):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    if (!m || !crypto.timingSafeEqual(Buffer.from(m[3]!), Buffer.from(this.stimmungDaten(m[1]!, Number(m[2])).split(':')[3]!))) {
      this.o.log?.('Telegram: Stimmungs-Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    stimmungSetzen(this.o.db, m[1]!, Number(m[2]), this.o.uhr.jetzt());
    await antworten('Danke – gute Nacht! 🌙');
    if (q.message)
      await this.o.api
        .aufruf('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: `💭 Dein Tag: ${STIMMUNGEN[Number(m[2]) - 1]}`, parse_mode: 'HTML' })
        .catch(() => undefined);
  }

  // ---- /noten (E113) ----------------------------------------------------------------------------------

  private async notenSenden() {
    if (!this.o.noten) return this.senden('Die Notenliste ist gerade nicht verfügbar.');
    const n = await this.o.noten.stand();
    if (!n.faecher.length) return this.senden(`🎓 Noch keine Noten eingetragen – in der App unter <a href="${h(this.link('/gebaeude/Uni?reiter=noten'))}">Uni → Noten</a>.`);
    const komma = (x: number) => String(x).replace('.', ',');
    const z = [`🎓 <b>Noten & ECTS</b>`, `Schnitt: <b>${n.schnitt == null ? '–' : komma(n.schnitt)}</b> · ${komma(n.ectsBestanden)} ECTS bestanden${n.zielEcts ? ` von ${n.zielEcts} (${Math.round((n.ectsBestanden / n.zielEcts) * 100)} %)` : ''}${n.ectsOffen ? ` · ${komma(n.ectsOffen)} offen` : ''}`, ''];
    for (const f of n.faecher.slice(0, 25)) z.push(`• ${h(f.fach)} – ${f.note == null ? 'offen' : f.note === 'bestanden' ? '✓ bestanden' : `Note ${f.note}`} (${komma(f.ects)} ECTS)`);
    return this.senden(z.join('\n'));
  }

  // ---- /suche (E108) ----------------------------------------------------------------------------------

  private async sucheSenden(q: string) {
    if (!this.o.suche) return this.senden('Die Suche ist gerade nicht verfügbar.');
    if (!q) return this.senden('🔎 <b>/suche</b> &lt;Begriff&gt; – z. B. <i>/suche Eigenwert</i>');
    const t = this.o.suche.suchen(q.slice(0, 200), 8);
    if (!t.length) return this.senden(`🔎 Nichts gefunden für „${h(q)}“.`);
    // Ausschnitte stammen aus Vault-Dateien (auch Fremdinhalt) – nur als Text, ohne Formatierung
    const z = t.map((x) => `• <a href="${h(this.link(`/bibliothek?pfad=${encodeURIComponent(x.pfad)}&q=${encodeURIComponent(q)}`))}">${h(x.titel)}</a>\n  <i>${h(x.pfad)}</i>`);
    return this.senden(`🔎 <b>${h(q)}</b> – ${t.length} ${t.length === 1 ? 'Treffer' : 'Treffer'}\n${z.join('\n')}`);
  }

  // ---- /statistik (E104) -----------------------------------------------------------------------------

  /** ▁▂▃▄▅▆▇█ je Tag (0 = ·) */
  static balken(werte: number[]) {
    const max = Math.max(...werte, 1);
    return werte.map((v) => (v <= 0 ? '·' : '▁▂▃▄▅▆▇█'[Math.min(7, Math.ceil((v / max) * 8) - 1)]!)).join('');
  }

  private async statistikSenden() {
    if (!this.o.statistik) return this.senden('Die Statistik ist gerade nicht verfügbar.');
    const s = await this.o.statistik(7);
    const t = s.tage;
    const wt = t.map((x) => 'SMDMDFS'[new Date(`${x.tag}T12:00:00Z`).getUTCDay()]).join('');
    const std = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
    const gwF = t.reduce((a, x) => a + x.gewohnheitenFaellig, 0);
    const gwE = t.reduce((a, x) => a + x.gewohnheitenErledigt, 0);
    const z = [
      `📊 <b>Die letzten 7 Tage</b>`,
      `<code>${wt}</code>`,
      `<code>${TelegramBot.balken(t.map((x) => x.erledigt))}</code> ☑️ ${s.summen.erledigt} erledigt`,
      `<code>${TelegramBot.balken(t.map((x) => x.fokusMin))}</code> 🍅 ${std(s.summen.fokusMin)} Fokus`,
    ];
    if (gwF) z.push(`<code>${TelegramBot.balken(t.map((x) => (x.gewohnheitenFaellig ? x.gewohnheitenErledigt / x.gewohnheitenFaellig : 0)))}</code> 🔁 ${gwE}/${gwF} Gewohnheiten`);
    if (s.summen.stimmungSchnitt != null) z.push(`<code>${TelegramBot.balken(t.map((x) => x.stimmung ?? 0))}</code> 💭 Stimmung Ø ${String(s.summen.stimmungSchnitt).replace('.', ',')}`);
    const b = bluete(s, await this.o.wochenziele?.lesen().catch(() => undefined));
    z.push(`\n${s.summen.aktiveTage}/7 aktive Tage · Dein Dorf: ${STUFE_TEXT[b.stufe]}${b.fahne ? ' 🚩' : ''} · <a href="${this.link('/gebaeude/Rathaus?reiter=statistik')}">Statistik</a>`);
    return this.senden(z.join('\n'));
  }

  // ---- Überfälliges aufräumen (E97) ------------------------------------------------------------------

  private aufraeumenDaten(k: string, a: string) {
    return `ar:${k}:${a}:${crypto.createHmac('sha256', this.signaturSchluessel).update(`aufraeumen:${k}:${a}`).digest('base64url').slice(0, 16)}`;
  }
  private heuteTag(plusTage = 0) {
    return tagVonJetzt(this.o.uhr.jetzt(), plusTage);
  }
  private async aufraeumenText(): Promise<{ text: string; extra: Record<string, unknown> }> {
    const heute = this.heuteTag();
    const offen = (await this.o.listen!.todo.liste()).filter((t) => !t.erledigt && t.faellig && t.faellig < heute);
    const t = offen[0];
    if (!t) return { text: '🧹 Nichts überfällig – alles im Plan. 🎉', extra: {} };
    const k = this.todoKennung(t.pfad);
    const tage = Math.round((Date.parse(`${heute}T12:00:00Z`) - Date.parse(`${t.faellig}T12:00:00Z`)) / 86_400_000);
    return {
      text: `🧹 <b>Aufräumen</b> · noch ${offen.length}\n\n<b>${h(t.titel)}</b>\n<i>seit ${tage} ${tage === 1 ? 'Tag' : 'Tagen'} überfällig (${h(t.faellig!)})</i>`,
      extra: {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📌 Heute', callback_data: this.aufraeumenDaten(k, 'h') },
              { text: '➡️ Morgen', callback_data: this.aufraeumenDaten(k, 'm') },
              { text: '📆 Nächste Woche', callback_data: this.aufraeumenDaten(k, 'w') },
            ],
            [
              { text: '✅ Erledigt', callback_data: this.aufraeumenDaten(k, 'e') },
              { text: '➖ Ohne Datum', callback_data: this.aufraeumenDaten(k, 'o') },
              { text: '🗑 Löschen', callback_data: this.aufraeumenDaten(k, 'l') },
            ],
          ],
        },
      },
    };
  }

  private async aufraeumenZeigen() {
    if (!this.o.listen) return this.senden('Die Listen sind nicht eingerichtet.');
    const a = await this.aufraeumenText();
    return this.senden(a.text, a.extra);
  }

  private async aufraeumenKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const m = /^ar:([0-9a-f]{12}):([hmweol]):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    const soll = m ? this.aufraeumenDaten(m[1]!, m[2]!).split(':')[3]! : '';
    if (!m || !this.o.listen || !crypto.timingSafeEqual(Buffer.from(m[3]!), Buffer.from(soll))) {
      this.o.log?.('Telegram: Aufräumen-Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    const dienst = this.o.listen.todo;
    const t = (await dienst.liste()).find((x) => this.todoKennung(x.pfad) === m[1]);
    if (t && !t.erledigt) {
      // nächste Woche = kommender Montag
      const wt = new Date(`${this.heuteTag()}T12:00:00Z`).getUTCDay();
      const montag = this.heuteTag(((8 - wt) % 7) || 7);
      const a = m[2]!;
      if (a === 'l') await dienst.loeschen(t.pfad);
      else
        await dienst.aendern(t.pfad, a === 'e' ? { erledigt: true } : a === 'o' ? { faellig: '' } : { faellig: a === 'h' ? this.heuteTag() : a === 'm' ? this.heuteTag(1) : montag });
      await antworten({ h: 'Für heute.', m: 'Auf morgen.', w: `Auf ${montag}.`, e: 'Erledigt.', o: 'Ohne Datum.', l: 'Gelöscht (Papierkorb).' }[a]!);
    } else await antworten('Schon erledigt.');
    if (q.message) {
      const n = await this.aufraeumenText();
      await this.o.api.aufruf('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: n.text, parse_mode: 'HTML', ...n.extra }).catch(() => undefined);
    }
  }

  // ---- Notizen (E95) ---------------------------------------------------------------------------------

  /** media_group_id → Zeitpunkt der „notiz:“-Bildunterschrift (weitere Bilder desselben Albums gehören zur Notiz) */
  private notizAlben = new Map<string, number>();

  private async notizMitDatei(m: TgNachricht, text: string) {
    for (const [k, t] of this.notizAlben) if (this.o.uhr.jetzt() - t > 120_000) this.notizAlben.delete(k);
    const datei = m.document ?? { ...m.photo![m.photo!.length - 1]!, file_name: 'foto.jpg' };
    if ((datei.file_size ?? 0) > MAX_DATEI) return this.senden('📎 Die Datei ist größer als 20 MB – so große Dateien kann ein Bot nicht laden.');
    try {
      const d = await this.o.api.dateiLaden(datei.file_id);
      const zp = zeitpunktAus(this.o.uhr.jetzt());
      // message_id im Namen: zwei Dateien gleichen Namens in derselben Minute überschreiben sich nicht (Review)
      const name = dateinameBereinigen(`${zp.slice(0, 10)}_${zp.slice(11).replace(':', '')}_${m.message_id}_${datei.file_name ?? d.name}`);
      const pfad = `Rathaus/notizen/anhaenge/${name}`;
      await this.o.vault.schreiben(pfad, d.inhalt, { nurNeu: true });
      const r = await this.o.notizen!.hinzufuegen(`${text ? `${text} ` : ''}![[${pfad}]]`, 'Telegram');
      return this.senden(`📝 Notiert – mit ${m.document ? 'Datei' : 'Foto'} (${h(r.pfad)}).`);
    } catch (e) {
      return this.senden(`⚠️ Konnte die Notiz nicht speichern: ${h((e as Error).message)}`);
    }
  }

  private async notizBefehl(rest: string) {
    if (!this.o.notizen) return this.senden('Notizen sind nicht eingerichtet.');
    if (!rest) {
      const n = await this.o.notizen.heute();
      return this.senden(n.zeilen.length ? `📝 <b>Notizen heute</b>\n${n.zeilen.slice(-15).map((z) => h(z.replace(/^- /, ''))).join('\n')}` : '📝 Heute noch keine Notizen. <i>/notiz &lt;Text&gt;</i> hält etwas fest.');
    }
    const r = await this.o.notizen.hinzufuegen(rest, 'Telegram');
    return this.senden(`📝 Notiert (${h(r.pfad)}).`);
  }

  // ---- Erinnerungen an To-dos (E94) ----------------------------------------------------------------

  private erinnerDaten(k: string, a: 'e' | 's' | 'm') {
    return `er:${k}:${a}:${crypto.createHmac('sha256', this.signaturSchluessel).update(`erinnerung:${k}:${a}`).digest('base64url').slice(0, 16)}`;
  }

  /** Zur Erinnerungszeit (wird von TodoErinnerungen aufgerufen) – auch nachts: die Zeit hat Leif selbst gewählt */
  async erinnerungSenden(t: TodoInfo) {
    const k = this.todoKennung(t.pfad);
    return this.senden(`🔔 <b>Erinnerung</b>\n${h(t.titel)}${t.notiz ? `\n<i>${h(t.notiz.slice(0, 300))}</i>` : ''}`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Erledigt', callback_data: this.erinnerDaten(k, 'e') },
            { text: '⏰ +1 h', callback_data: this.erinnerDaten(k, 's') },
            { text: '🌅 Morgen 9:00', callback_data: this.erinnerDaten(k, 'm') },
          ],
        ],
      },
    });
  }

  /** E99: Pomodoro-Folge an einem To-do fertig → „Erledigt?“ (Knopf wie bei der Erinnerung) */
  async fokusFertigFragen(pfad: string, titel: string) {
    const k = this.todoKennung(pfad);
    return this.senden(`🍅 <b>Fokus geschafft</b>: ${h(titel)}\nIst das To-do damit erledigt?`, {
      reply_markup: { inline_keyboard: [[{ text: '✅ Ja, erledigt', callback_data: this.erinnerDaten(k, 'e') }]] },
    });
  }

  private async erinnerKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const m = /^er:([0-9a-f]{12}):([esm]):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    const soll = m ? this.erinnerDaten(m[1]!, m[2] as 'e' | 's' | 'm').split(':')[3]! : '';
    if (!m || !this.o.listen || !crypto.timingSafeEqual(Buffer.from(m[3]!), Buffer.from(soll))) {
      this.o.log?.('Telegram: Erinnerungs-Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    // alle Listen (Erinnerungen gibt es auch in Einkauf, Wunsch, Corps)
    let dienst = this.o.listen.todo;
    let t: TodoInfo | undefined;
    for (const d of Object.values(this.o.listen)) {
      t = (await d.liste()).find((x) => this.todoKennung(x.pfad) === m[1]);
      if (t) {
        dienst = d;
        break;
      }
    }
    if (!t) return antworten('Dieses To-do gibt es nicht mehr.');
    let text: string;
    if (m[2] === 'e') {
      if (!t.erledigt) await dienst.aendern(t.pfad, { erledigt: true });
      text = `✅ Erledigt: <b>${h(t.titel)}</b>`;
    } else {
      const ziel = m[2] === 's' ? { minuten: 60 } : { zeitpunkt: this.o.erinnerungen!.morgenFrueh() };
      const neu = await this.o.erinnerungen!.verschieben(t.pfad, ziel);
      text = `⏰ <b>${h(t.titel)}</b> – ich erinnere dich ${TelegramBot.zeitpunktText(neu.erinnerung!, this.o.uhr.jetzt())} wieder.`;
    }
    await antworten(m[2] === 'e' ? 'Erledigt.' : 'Verschoben.');
    if (q.message) await this.o.api.aufruf('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text, parse_mode: 'HTML' }).catch(() => undefined);
  }

  static zeitpunktText(z: string, jetzt: number) {
    const heute = zeitpunktAus(jetzt).slice(0, 10);
    const morgen = tagVonJetzt(jetzt, 1);
    const tag = z.slice(0, 10);
    const wann = tag === heute ? 'heute' : tag === morgen ? 'morgen' : `am ${new Date(`${tag}T12:00:00Z`).toLocaleDateString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' })}`;
    return `${wann} um ${z.slice(11)}`;
  }

  /** /erinner morgen 9 Uhr Mama anrufen · /erinner in 30 min Wäsche · /erinner Fr 14:00 Bericht */
  private async erinnerBefehl(rest: string) {
    if (!this.o.listen || !this.o.erinnerungen) return this.senden('Erinnerungen sind nicht eingerichtet.');
    if (!rest) return this.senden('🔔 <b>/erinner</b> &lt;wann&gt; &lt;was&gt;\nz. B. <i>/erinner morgen 9 Uhr Mama anrufen</i>, <i>/erinner in 30 min Wäsche aufhängen</i>, <i>/erinner Fr 14:00 Bericht abgeben</i>');
    const jetzt = this.o.uhr.jetzt();
    let titel: string | undefined;
    let zp: string | undefined;
    const relativ = /^in (\d{1,4}) ?(min|minuten|minute|h|std|stunden?|stunde)\b\s*(.*)$/i.exec(rest);
    if (relativ) {
      const n = Number(relativ[1]) * (/^(h|std|stunde)/i.test(relativ[2]!) ? 60 : 1);
      zp = zeitpunktAus(jetzt + n * 60_000);
      titel = relativ[3]!.trim();
    } else {
      const t = terminAusText(rest, jetzt);
      if (t && !t.ganztags) {
        zp = t.start.slice(0, 16);
        titel = t.titel;
      }
    }
    if (!zp || !titel) return this.senden('🔔 Das habe ich nicht verstanden – z. B. <i>/erinner morgen 9 Uhr Mama anrufen</i> oder <i>/erinner in 30 min Wäsche</i>.');
    if (zp <= zeitpunktAus(jetzt)) return this.senden('🔔 Dieser Zeitpunkt ist schon vorbei.');
    const neu = await this.o.listen.todo.anlegen({ titel: titel.slice(0, 200), faellig: zp.slice(0, 10), erinnerung: zp }, 'Telegram');
    return this.senden(`🔔 Erinnerung ${TelegramBot.zeitpunktText(zp, jetzt)}: <b>${h(neu.titel)}</b>\n<i>Steht auch auf deiner To-do-Liste.</i>`);
  }

  // ---- Wochenziele (E91) --------------------------------------------------------------------------

  private zielDaten(woche: string, nr: number, text: string) {
    const teil = `${woche}:${nr}:${crypto.createHash('sha256').update(text).digest('hex').slice(0, 8)}`;
    return `zl:${teil}:${crypto.createHmac('sha256', this.signaturSchluessel).update(`ziel:${teil}`).digest('base64url').slice(0, 16)}`;
  }
  private zielTastatur(s: { woche: string; ziele: { text: string; erledigt: boolean }[] }) {
    return s.ziele.map((z, i) => [{ text: knopfText(`${z.erledigt ? '✅' : '⬜'} ${z.text}`), callback_data: this.zielDaten(s.woche, i, z.text) }]);
  }

  private async zielBefehl(rest: string) {
    const w = this.o.wochenziele;
    if (!w) return this.senden('Wochenziele sind nicht eingerichtet.');
    if (rest) {
      try {
        await w.hinzufuegen(rest);
      } catch (e) {
        return this.senden(`🎯 ${h((e as Error).message)}`);
      }
    }
    const s = await w.stand();
    if (!s.ziele.length) return this.senden('🎯 Noch keine Wochenziele. Setz eins mit <i>/ziel Blatt 6 abgeben</i> – drei reichen.');
    const fertig = s.ziele.filter((z) => z.erledigt).length;
    return this.senden(`🎯 <b>Wochenziele ${h(s.woche.replace('-KW', ' · KW '))}</b> – ${fertig}/${s.ziele.length} erreicht${rest ? '\n✓ hinzugefügt' : ''}`, {
      reply_markup: { inline_keyboard: this.zielTastatur(s) },
    });
  }

  private async zielKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const m = /^zl:(\d{4}-KW\d{2}):(\d{1,2}):([0-9a-f]{8}):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    const w = this.o.wochenziele;
    if (!m || !w || this.zielSignaturFalsch(m)) {
      this.o.log?.('Telegram: Ziel-Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    const s = await w.stand();
    const nr = Number(m[2]);
    const z = s.ziele[nr];
    if (s.woche !== m[1] || !z || crypto.createHash('sha256').update(z.text).digest('hex').slice(0, 8) !== m[3]) return antworten('Die Ziele haben sich geändert – /ziel zeigt sie neu.');
    const neu = await w.haken(nr, !z.erledigt);
    await antworten(z.erledigt ? 'Wieder offen.' : '🎯 Erreicht!');
    if (q.message)
      await this.o.api
        .aufruf('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: this.zielTastatur(neu) } })
        .catch(() => undefined);
  }
  private zielSignaturFalsch(m: RegExpExecArray) {
    const soll = crypto.createHmac('sha256', this.signaturSchluessel).update(`ziel:${m[1]}:${m[2]}:${m[3]}`).digest('base64url').slice(0, 16);
    return !crypto.timingSafeEqual(Buffer.from(m[4]!), Buffer.from(soll));
  }

  // ---- Gewohnheiten (Nacht 18./19.11.) ------------------------------------------------------------

  private gewohnheitKennung(name: string) {
    return crypto.createHash('sha256').update(name).digest('hex').slice(0, 12);
  }
  private gewohnheitSignatur(k: string) {
    return crypto.createHmac('sha256', this.signaturSchluessel).update(`gewohnheit:${k}`).digest('base64url').slice(0, 16);
  }
  /** Review: Knopf trägt den Tag (JJJJMMTT) – ein Tipp nach Mitternacht auf die Nachricht von gestern hakt gestern ab */
  private gewohnheitDaten(k: string, tag: string) {
    const t = tag.replace(/-/g, '');
    return `gw:${k}:${t}:${crypto.createHmac('sha256', this.signaturSchluessel).update(`gewohnheit:${k}:${t}`).digest('base64url').slice(0, 16)}`;
  }
  private async gewohnheitKnoepfe(tag = this.heuteTag()) {
    if (tag !== this.heuteTag())
      return (await this.o.gewohnheiten!.standAm(tag)).map((g) => {
        const k = this.gewohnheitKennung(g.name);
        return [{ text: knopfText(`${g.erledigt ? '✅' : '⬜'} ${g.symbol} ${g.name}`), callback_data: this.gewohnheitDaten(k, tag) }];
      });
    const s = await this.o.gewohnheiten!.stand();
    return s.gewohnheiten
      .filter((g) => g.heuteFaellig)
      .map((g) => {
        const k = this.gewohnheitKennung(g.name);
        const zusatz = g.wocheStand ? ` · ${g.wocheStand.erledigt}/${g.wocheStand.ziel} diese Woche` : g.serie > 1 ? ` · 🔥 ${g.serie}` : '';
        return [{ text: knopfText(`${g.heuteErledigt ? '✅' : '⬜'} ${g.symbol} ${g.name}${zusatz}`), callback_data: this.gewohnheitDaten(k, tag) }];
      });
  }

  /** E106: eine Gewohnheit mit Uhrzeit ist dran – Nachricht mit genau ihrem Abhak-Knopf */
  async gewohnheitErinnern(name: string) {
    const g = (await this.o.gewohnheiten?.stand())?.gewohnheiten.find((x) => x.name === name);
    if (!g) return;
    const k = this.gewohnheitKennung(g.name);
    return this.senden(`🔁 ${h(g.symbol)} <b>${h(g.name)}</b> – Zeit dafür!${g.serie > 1 ? ` (🔥 ${g.serie})` : ''}`, {
      reply_markup: { inline_keyboard: [[{ text: knopfText(`⬜ ${g.symbol} ${g.name}`), callback_data: this.gewohnheitDaten(k, this.heuteTag()) }]] },
    });
  }

  /** Heute fällige Gewohnheiten mit Abhak-Knöpfen. still = nichts senden, wenn es keine gibt (Tagesabschluss). */
  async gewohnheitenSenden(still = false) {
    if (!this.o.gewohnheiten) return still ? undefined : this.senden('Gewohnheiten sind nicht eingerichtet.');
    const k = await this.gewohnheitKnoepfe();
    if (!k.length) return still ? undefined : this.senden(`🔁 Heute ist keine Gewohnheit dran. Anlegen kannst du sie in der App unter <a href="${this.link('/heute')}">Mein Tag</a>.`);
    return this.senden('🔁 <b>Gewohnheiten heute</b> – antippen zum Abhaken:', { reply_markup: { inline_keyboard: k } });
  }

  private async gewohnheitKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const neu = /^gw:([0-9a-f]{12}):(\d{8}):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    const alt = /^gw:([0-9a-f]{12}):([A-Za-z0-9_-]{16})$/.exec(q.data ?? ''); // Knöpfe von vor der Umstellung: heute
    const k = neu?.[1] ?? alt?.[1];
    const tag = neu ? `${neu[2]!.slice(0, 4)}-${neu[2]!.slice(4, 6)}-${neu[2]!.slice(6, 8)}` : this.heuteTag();
    const soll = neu ? this.gewohnheitDaten(neu[1]!, tag).split(':')[3]! : alt ? this.gewohnheitSignatur(alt[1]!) : '';
    const ist = neu?.[3] ?? alt?.[2];
    if (!k || !ist || !this.o.gewohnheiten || !crypto.timingSafeEqual(Buffer.from(ist), Buffer.from(soll))) {
      this.o.log?.('Telegram: Gewohnheits-Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    if (tag > this.heuteTag()) return antworten('Ungültiger Knopf.');
    const g = (await this.o.gewohnheiten.standAm(tag)).find((x) => this.gewohnheitKennung(x.name) === k) ?? (await this.o.gewohnheiten.liste()).gewohnheiten.map((x) => ({ name: x.name, symbol: x.symbol, erledigt: false })).find((x) => this.gewohnheitKennung(x.name) === k);
    if (!g) return antworten('Diese Gewohnheit gibt es nicht mehr.');
    await this.o.gewohnheiten.haken(g.name, !g.erledigt, tag);
    await antworten(g.erledigt ? 'Wieder offen.' : `${g.symbol} Erledigt${tag !== this.heuteTag() ? ` (für ${tag})` : ''}!`);
    if (q.message)
      await this.o.api
        .aufruf('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: await this.gewohnheitKnoepfe(tag) } })
        .catch(() => undefined);
  }

  private sternSignatur(k: string) {
    return crypto.createHmac('sha256', this.signaturSchluessel).update(`stern:${k}`).digest('base64url').slice(0, 16);
  }
  private sternAuswahl(alle: TodoInfo[], morgen: string) {
    const offen = alle.filter((t) => !t.erledigt).sort((a, b) => Number(!!b.wichtig) - Number(!!a.wichtig) || (a.faellig ?? '9999').localeCompare(b.faellig ?? '9999'));
    return offen.slice(0, 8).map((t) => {
      const k = this.todoKennung(t.pfad);
      return [{ text: knopfText(`${t.wichtig ? '⭐' : '☆'} ${t.titel}${t.faellig && t.faellig <= morgen ? ` (${t.faellig === morgen ? 'morgen' : 'fällig'})` : ''}`), callback_data: `st:${k}:${this.sternSignatur(k)}` }];
    });
  }

  private async sternKnopf(q: NonNullable<TgUpdate['callback_query']>, antworten: (t: string) => Promise<unknown>) {
    const m = /^st:([0-9a-f]{12}):([A-Za-z0-9_-]{16})$/.exec(q.data ?? '');
    if (!m || !this.o.listen || !crypto.timingSafeEqual(Buffer.from(m[2]!), Buffer.from(this.sternSignatur(m[1]!)))) {
      this.o.log?.('Telegram: Stern-Knopf mit ungültiger Signatur abgelehnt.');
      return antworten('Ungültiger Knopf.');
    }
    const alle = await this.o.listen.todo.liste();
    const t = alle.find((x) => this.todoKennung(x.pfad) === m[1]);
    if (!t) return antworten('Dieses To-do gibt es nicht mehr.');
    await this.o.listen.todo.aendern(t.pfad, { wichtig: !t.wichtig });
    await antworten(t.wichtig ? 'Nicht mehr wichtig.' : '⭐ Wichtig für morgen.');
    if (q.message) {
      const neu = await this.o.listen.todo.liste();
      const morgen = tagVonJetzt(this.o.uhr.jetzt(), 1);
      await this.o.api
        .aufruf('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: this.sternAuswahl(neu, morgen) } })
        .catch(() => undefined);
    }
  }

  private async fokusBefehl(rest: string) {
    if (!this.o.kirchturm) return this.senden('Der Kirchturm ist nicht eingerichtet.');
    try {
      this.o.kirchturm.ausfuehren(rest ? { befehl: 'pomodoro_fuer', titel: rest.slice(0, 200) } : { befehl: 'pomodoro', aktion: 'start' });
    } catch (e) {
      return this.senden(`⚠️ ${h((e as Error).message)}`);
    }
    return this.senden(`🍅 Fokus läuft${rest ? `: <b>${h(rest)}</b>` : ''}. Bis die Runde um ist, halte ich Meldungen zurück (Nicht stören).`);
  }

  // ---- Bank (Etappe 7) --------------------------------------------------------------------------

  /** Budget-Warnung (schaltbar: bank); nachts gesammelt */
  async bankMelden(text: string) {
    if (!(await einstellungenLaden(this.o.vault)).bank) return;
    await this.proaktiv(`${h(text)}\n<a href="${this.link('/?g=Bank')}">Zur Bank</a>`);
  }

  /** E73: Saxo-Sitzung beendet → neu verbinden (Schalter wie Bank: Geld) */
  async saxoMelden(text: string) {
    if (!(await einstellungenLaden(this.o.vault)).bank) return;
    await this.proaktiv(`${h(text)}\n<a href="${this.link('/?g=Boerse')}">Zur Börse</a>`);
  }

  // ---- Ablehnen mit Begründung (E64) ----------------------------------------------------------

  private grundFrage() {
    const w = (this.o.db.prepare("SELECT wert FROM dorf_stand WHERE schluessel = 'telegram_grund_frage'").get() as { wert: string } | undefined)?.wert;
    return w ? (JSON.parse(w) as { messageId: number; freigabeId: string; zeit: number }) : null;
  }
  private grundFrageSetzen(f: { messageId: number; freigabeId: string; zeit: number } | null) {
    if (!f) this.o.db.prepare("DELETE FROM dorf_stand WHERE schluessel = 'telegram_grund_frage'").run();
    else
      this.o.db
        .prepare("INSERT INTO dorf_stand (schluessel, wert) VALUES ('telegram_grund_frage', ?) ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert")
        .run(JSON.stringify(f));
  }

  private async grundErfragen(f: FreigabeInfo) {
    const r = await this.senden(
      `❌ <b>Abgelehnt:</b> ${h(f.titel)}
Magst du kurz sagen, warum? Antworte einfach mit einem Satz – ${f.chatId ? 'der Bürgermeister macht dann einen besseren Vorschlag und merkt es sich' : 'ich vermerke es an der Freigabe'}.
<i>(Keine Lust? Einfach ignorieren.)</i>`,
    );
    if (typeof r?.message_id === 'number') this.grundFrageSetzen({ messageId: r.message_id, freigabeId: f.id, zeit: this.o.uhr.jetzt() });
  }

  private async grundAnnehmen(freigabeId: string, grund: string) {
    this.grundFrageSetzen(null);
    try {
      const f = await this.o.agenten.freigaben.grundNachreichen(freigabeId, grund);
      await this.senden(`📝 Danke – ${f.chatId ? 'der Bürgermeister bekommt deinen Grund und überlegt neu.' : 'vermerkt.'}`, {}, f.chatId ?? undefined);
    } catch (e) {
      await this.senden(`⚠️ ${h((e as Error).message)}`);
    }
  }

  // ---- Meldungen ------------------------------------------------------------------------------

  // ---- Nachtruhe (22–7 Uhr Linz): nur Dringendes sofort, der Rest gesammelt um 7 Uhr (E56) -------------

  /** Nacht ODER Fokus (Pomodoro-Arbeitsphase mit „Nicht stören“): nur Dringendes sofort, der Rest gesammelt */
  fokusAktiv: () => boolean = () => false;
  private async nachtruhe() {
    if (this.fokusAktiv()) return true;
    return istNacht(this.o.uhr.jetzt()) && (await aufwachEinstellungen(this.o.vault)).nachtruhe;
  }
  private nachtListe(): { text: string; freigabe?: string; fokus?: boolean }[] {
    const w = (this.o.db.prepare("SELECT wert FROM dorf_stand WHERE schluessel = 'telegram_nacht'").get() as { wert: string } | undefined)?.wert;
    return w ? (JSON.parse(w) as { text: string; freigabe?: string; fokus?: boolean }[]) : [];
  }
  private nachtListeSetzen(l: { text: string; freigabe?: string; fokus?: boolean }[]) {
    this.o.db
      .prepare("INSERT INTO dorf_stand (schluessel, wert) VALUES ('telegram_nacht', ?) ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert")
      .run(JSON.stringify(l.slice(-50)));
  }

  /** Meldung, die Leif nicht selbst angestoßen hat: nachts gesammelt statt gesendet */
  private async proaktiv(text: string, extra: Record<string, unknown> = {}, gehoertZuChat?: string) {
    if (await this.nachtruhe()) {
      this.nachtListeSetzen([...this.nachtListe(), { text, ...(this.fokusAktiv() && !istNacht(this.o.uhr.jetzt()) ? { fokus: true } : {}) }]);
      return null;
    }
    return this.senden(text, extra, gehoertZuChat);
  }

  /** Nach der Nachtruhe: Gesammeltes in einer Nachricht, wartende Freigaben mit Knöpfen */
  async nachtNachholen() {
    const l = this.nachtListe();
    if (!l.length || (await this.nachtruhe())) return 0;
    // der Link am Ende (Chat öffnen, Zur Uni …) bleibt als kurzes „· öffnen“ – so kommt Leif direkt hin
    const texte = l
      .filter((x) => !x.freigabe)
      .map((x) => {
        const link = /\n(<a href="[^"]*">)[^<]*<\/a>$/.exec(x.text);
        const rumpf = kuerzen(link ? x.text.slice(0, link.index) : x.text, 1100);
        return link ? `${rumpf} · ${link[1]}öffnen</a>` : rumpf;
      });
    if (texte.length) {
      // ganze Meldungen, nie mitten in einem HTML-Tag abschneiden (sonst lehnt Telegram die Nachricht ab)
      const kopf = l.every((x) => x.fokus) ? `🍅 <b>Während deiner Fokuszeit</b> (${texte.length})` : `🌙 <b>Über Nacht</b> (${texte.length})`;
      const teile: string[] = [];
      let laenge = kopf.length;
      for (const t of texte) {
        if (laenge + t.length + 2 > 3600) break;
        teile.push(t);
        laenge += t.length + 2;
      }
      const rest = texte.length - teile.length;
      await this.senden(
        `${kopf}\n\n${teile.join('\n\n')}${rest ? `\n\n… und ${rest} weitere – <a href="${this.link('/gebaeude/Rathaus?reiter=alle-chats')}">Alle Chats</a>` : ''}`,
      );
    }
    // erst NACH dem Senden austragen – schlägt es fehl, bleibt alles für den nächsten Versuch; neu Dazugekommenes bleibt
    this.nachtListeSetzen(this.nachtListe().slice(l.length));
    for (const x of l.filter((y) => y.freigabe)) {
      const f = this.o.agenten.freigaben.liste('offen').find((y) => y.id === x.freigabe);
      if (f) await this.freigabeMelden(f, true);
    }
    return l.length;
  }

  private link(pfad: string) {
    return `${this.o.appUrl}${pfad}`;
  }

  async senden(text: string, extra: Record<string, unknown> = {}, gehoertZuChat?: string) {
    const r = await this.o.api.aufruf<{ message_id: number }>('sendMessage', {
      chat_id: this.o.chatId,
      text: htmlKuerzen(text, 4000),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...extra,
    });
    // Merken, zu welchem Dorf-Chat die Nachricht gehört – eine Antwort darauf setzt genau diesen Chat fort
    if (gehoertZuChat && typeof r?.message_id === 'number') this.verlaufMerken(r.message_id, gehoertZuChat);
    return r;
  }

  private verlaufMerken(messageId: number, chatId: string) {
    this.o.db
      .prepare(
        `INSERT INTO telegram_verlauf (message_id, chat_id, zeit, nr) VALUES (?, ?, ?, (SELECT COALESCE(MAX(nr), 0) + 1 FROM telegram_verlauf))
         ON CONFLICT(message_id) DO UPDATE SET chat_id = excluded.chat_id, zeit = excluded.zeit, nr = excluded.nr`,
      )
      .run(messageId, chatId, this.o.uhr.jetzt());
  }

  /**
   * Wohin gehört eine neue Textnachricht?
   * 1. Antwort auf eine Bot-Nachricht → deren Chat.
   * 2. Sonst: das laufende Gespräch mit dem Bürgermeister, wenn der letzte Austausch < GESPRAECH_MINUTEN her ist
   *    und danach kein /neu kam.
   * 3. Sonst: neue Aufgabe.
   */
  private gespraechFinden(m: TgNachricht): string | null {
    const db = this.o.db;
    if (m.reply_to_message) {
      const z = db.prepare('SELECT chat_id FROM telegram_verlauf WHERE message_id = ?').get(m.reply_to_message.message_id) as { chat_id: string } | undefined;
      return z?.chat_id || null;
    }
    const letzte = db.prepare('SELECT chat_id, zeit FROM telegram_verlauf ORDER BY nr DESC LIMIT 1').get() as { chat_id: string; zeit: number } | undefined;
    if (!letzte?.chat_id || this.o.uhr.jetzt() - letzte.zeit > GESPRAECH_MINUTEN * 60_000) return null;
    // fortgesetzt wird das Gespräch mit dem Bürgermeister (nicht ein Helfer-Chat, zu dem zuletzt eine Meldung kam)
    const c = db.prepare('SELECT id, rolle, eltern_chat_id FROM chats WHERE id = ?').get(letzte.chat_id) as { id: string; rolle: string | null; eltern_chat_id: string | null } | undefined;
    if (!c) return null;
    const ziel = c.rolle === 'buergermeister' ? c.id : c.eltern_chat_id;
    return ziel ?? null;
  }

  private freigabeText(f: FreigabeInfo) {
    if (f.art === 'plan_ausfuehren') {
      const p = f.inhalt as PlanInhalt;
      const teile = p.teilaufgaben.map((t, i) => `${i + 1}. ${h(t.titel)} – ${h(t.gebaeude)} (${t.aktion ? h(t.aktion) : 'freier Helfer'}, ${t.stufe})`);
      return `📋 <b>Plan des Bürgermeisters</b>\n${h(p.zusammenfassung)}\n\n${teile.join('\n')}\n\n${h(p.hinweis)}${p.begruendung ? `\n\n<i>${h(p.begruendung.slice(0, 600))}</i>` : ''}`;
    }
    const i = f.inhalt as { pfad?: string; beschreibung?: string; inhalt?: string };
    return `✉️ <b>Freigabe: ${h(f.titel)}</b>\n${ARTEN[f.art] ?? h(f.art)} · ${h(f.gebaeude)}${i.pfad ? `\nDatei: <code>${h(i.pfad)}</code>` : ''}${i.beschreibung ? `\n${h(i.beschreibung)}` : ''}${f.begruendung ? `\n\n<i>${h(f.begruendung.slice(0, 600))}</i>` : ''}${f.art === 'persoenlichkeit_aendern' && i.inhalt ? `\n\n<pre>${h(i.inhalt.replace(/^---[\s\S]*?---\s*/, '').slice(0, 1500))}</pre>` : ''}`;
  }

  private async freigabeMelden(f: FreigabeInfo, immer = false) {
    if (!immer && !(await einstellungenLaden(this.o.vault)).freigaben) return;
    if (f.status !== 'offen') return;
    if (!immer && (await this.nachtruhe())) {
      this.nachtListeSetzen([...this.nachtListe(), { text: '', freigabe: f.id }]);
      return;
    }
    const r = await this.senden(
      `${this.freigabeText(f)}\n\n<a href="${this.link('/gebaeude/Rathaus?reiter=freigaben')}">In der App ansehen</a>`,
      { reply_markup: this.knoepfe(f.id) },
      f.chatId ?? undefined,
    );
    this.o.db
      .prepare('INSERT INTO telegram_nachrichten (freigabe_id, chat_id, message_id) VALUES (?, ?, ?) ON CONFLICT(freigabe_id) DO UPDATE SET message_id = excluded.message_id')
      .run(f.id, this.o.chatId, r.message_id);
  }

  /** Nach der Entscheidung (in App oder Telegram): Knöpfe weg, Ergebnis rein. */
  private async freigabeAktualisieren(f: FreigabeInfo) {
    const n = this.o.db.prepare('SELECT chat_id, message_id FROM telegram_nachrichten WHERE freigabe_id = ?').get(f.id) as { chat_id: string; message_id: number } | undefined;
    if (!n) return;
    const ergebnis =
      f.status === 'abgelehnt' ? '❌ Abgelehnt' : f.status === 'fehlgeschlagen' ? `⚠️ Fehlgeschlagen: ${h(f.ergebnis ?? '')}` : `✅ Angenommen${f.automatisch ? ' (automatisch – keine Antwort)' : ''}${f.ergebnis ? ` – ${h(f.ergebnis)}` : ''}`;
    await this.o.api
      .aufruf('editMessageText', {
        chat_id: n.chat_id,
        message_id: n.message_id,
        text: `${this.freigabeText(f)}\n\n<b>${ergebnis}</b>`.slice(0, 4000),
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      })
      .catch(() => undefined); // z. B. „message is not modified“
  }

  private async laufMelden(e: LaufEnde) {
    if (e.status === 'abgebrochen') return;
    const k = await einstellungenLaden(this.o.vault);
    const c = this.o.agenten.chatZeile(e.chatId);
    const link = `<a href="${this.link(`/chats/${c.id}`)}">Chat öffnen</a>`;
    if (e.status === 'fehler') {
      if (k.fehler) await this.proaktiv(`❌ <b>Fehler</b>: ${h(c.titel)}\n${h((e.fehler ?? '').slice(0, 500))}\n${link}`, {}, c.id);
      return;
    }
    // Von selbst aufgewacht und nichts getan → keine Meldung (Leif will nur hören, wenn etwas passiert ist)
    if (c.rolle === 'buergermeister' && c.schreibtisch_id) {
      const quelle = (this.o.db.prepare('SELECT quelle FROM schreibtisch WHERE id = ?').get(c.schreibtisch_id) as { quelle: string } | undefined)?.quelle;
      const getan = this.o.db
        .prepare("SELECT 1 FROM werkzeug_log WHERE lauf_id = ? AND erlaubt = 1 AND werkzeug IN ('helfer_starten', 'plan_vorlegen', 'vault_schreiben', 'freigabe_beantragen') LIMIT 1")
        .get(e.laufId);
      if (quelle === 'aufwachen' && !getan) return;
    }
    // Wartet ein Plan auf Freigabe, kommt die Plan-Nachricht mit Knöpfen – keine zweite Meldung.
    if (c.rolle === 'buergermeister' && this.o.db.prepare("SELECT 1 FROM plaene WHERE chat_id = ? AND status = 'wartet'").get(c.id)) return;
    if (e.geschrieben.length && k.entwuerfe) {
      const dateien = e.geschrieben.slice(0, 5).map((p) => `• <code>${h(p)}</code>`).join('\n');
      await this.proaktiv(`📝 <b>Fertig mit Entwurf</b>: ${h(c.titel)}\n${dateien}\n${link}`, {}, c.id);
      return;
    }
    if (k.beendet) {
      const antwort = (this.o.db.prepare("SELECT text FROM nachrichten WHERE lauf_id = ? AND rolle = 'agent' ORDER BY id DESC LIMIT 1").get(e.laufId) as { text: string } | undefined)?.text ?? '';
      const kurz = antwort.split(/^##\s*Zusammenfassung/m)[0]!.trim().slice(0, 600);
      await this.proaktiv(`✅ <b>Fertig</b>: ${h(c.titel)}${kurz ? `\n\n${h(kurz)}${antwort.length > 600 ? ' …' : ''}` : ''}\n${link}`, {}, c.id);
    }
  }

  private async abschlussMelden(a: { chatId: string; titel: string; text: string }) {
    const k = await einstellungenLaden(this.o.vault);
    if (!k.beendet) return;
    const zeilen = a.text
      .split('\n')
      .filter((z) => z.startsWith('- '))
      .map((z) => h(z.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/ · \[\[[^\]]*\]\]/g, '')))
      .join('\n');
    await this.proaktiv(`🏁 <b>Aufgabe erledigt</b>: ${h(a.titel)}\n${zeilen}\n<a href="${this.link(`/chats/${a.chatId}`)}">Chat öffnen</a>`, {}, a.chatId);
  }
}

/** Lange HTML-Meldung als Klartext kürzen – ohne halbe Tags oder Entities */
function kuerzen(t: string, max: number) {
  if (t.length <= max) return t;
  return `${t
    .replace(/<[^>]+>/g, '')
    .slice(0, max - 2)
    .replace(/&[^;\s]*$/, '')} …`;
}

/** Knopftext höchstens 60 Zeichen – nach Zeichen (nicht UTF-16-Einheiten), damit kein Emoji zerteilt wird (Review) */
export function knopfText(t: string) {
  const z = Array.from(t);
  return z.length > 60 ? z.slice(0, 60).join('') : t;
}

/**
 * HTML für Telegram kürzen, ohne ein Tag oder eine Entität zu zerschneiden (Review): an der letzten ganzen Zeile
 * abschneiden – unsere Texte öffnen und schließen Tags je Zeile. Notfalls (eine einzige lange Zeile) als reiner Text.
 */
export function htmlKuerzen(text: string, max: number) {
  if (text.length <= max) return text;
  const schnitt = text.lastIndexOf('\n', max - 2);
  if (schnitt > max / 2) return `${text.slice(0, schnitt)}\n…`;
  return `${text.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').slice(0, max - 20).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')} …`;
}
