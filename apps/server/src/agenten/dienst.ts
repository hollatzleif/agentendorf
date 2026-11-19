import type { ListenName, TodoDienst } from '../todos.js';
import crypto from 'node:crypto';
import type { Ausloeser, ChatDetail, ChatInfo, LaufInfo, LaufStatus, Motor as MotorName, Stufe } from '@dorf/shared';
import type { DB } from '../db.js';
import type { Uhr } from '../uhr.js';
import type { VaultDienst } from '../vault/dienst.js';
import type { Suchindex } from '../vault/suche.js';
import type { LiveHub } from '../live.js';
import { DorfFehler } from '../fehler.js';
import { aktionLaden, eingabenAnwenden, type QuellenFn } from './aktionen.js';
import { ablageOrdner, type RechenraumKlient } from './rechenraum.js';
import type { MoodleBrowserKlient } from './moodle-browser.js';
import type { GmailKlient } from '../post/gmail.js';
import { BUERGERMEISTER_WERKZEUGE, werkzeugeAktuell, werkzeugprofil, type DorfWerkzeug, type HelferFaehigkeit } from './leine.js';
import { Rueckgaengig } from './rueckgaengig.js';
import type { Kontakte } from '../kontakte.js';
import type { GoogleKalender } from '../kalender-google.js';
import type { Kirchturm } from '../kirchturm.js';
import type { Notizen } from '../notizen.js';
import { kostenSchaetzen, motorenLaden, stufenLaden } from './modelle.js';
import { anhaengeLaden, auftragMitAnhaengen, systemPromptBauen } from './kontext.js';
import { wissenLaden } from './gedaechtnis.js';
import { WERKZEUG_DEFINITIONEN, WerkzeugKiste, type KalenderEintrag, type RollenHandler } from './werkzeuge.js';
import type { Ablage } from './automatik.js';
import { Freigaben } from './freigaben.js';
import { AbbruchFehler, type Anhang, type Motor, type Verlauf } from './motor.js';
import { chatSpiegeln, protokollSchreiben } from './protokolle.js';
import { kurztitel } from './hilfen.js';

interface ChatZeile {
  id: string;
  gebaeude: string;
  aktion: string | null;
  titel: string;
  motor: MotorName;
  stufe: Stufe;
  modell: string;
  cc_sitzung: string | null;
  werkzeuge_json: string;
  anhaenge_json: string;
  eingaben_json: string;
  fremdinhalte: number;
  spiegel_pfad: string | null;
  protokoll_pfad: string | null;
  rolle: string | null;
  schreibtisch_id: string | null;
  eltern_chat_id: string | null;
  plan_id: string | null;
  erstellt: number;
  geaendert: number;
}
interface LaufZeile {
  id: string;
  chat_id: string;
  nummer: number;
  motor: MotorName;
  modell: string;
  stufe: Stufe;
  aufwand: string;
  status: LaufStatus;
  ausloeser: Ausloeser;
  auftrag: string;
  erstellt: number;
  start: number | null;
  ende: number | null;
  ein_token: number;
  aus_token: number;
  cache_lesen: number;
  cache_schreiben: number;
  kosten_usd: number;
  fehler: string | null;
}

const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : undefined);
export function laufInfo(l: LaufZeile): LaufInfo {
  return {
    id: l.id,
    chatId: l.chat_id,
    nummer: l.nummer,
    motor: l.motor,
    modell: l.modell,
    stufe: l.stufe,
    status: l.status,
    ausloeser: l.ausloeser,
    auftrag: l.auftrag,
    erstellt: iso(l.erstellt)!,
    start: iso(l.start),
    ende: iso(l.ende),
    einToken: l.ein_token,
    ausToken: l.aus_token,
    cacheLesen: l.cache_lesen,
    cacheSchreiben: l.cache_schreiben,
    kostenUsd: l.kosten_usd,
    fehler: l.fehler ?? undefined,
  };
}

/** Zusätzliche Verknüpfungen eines Chats (Bürgermeister, Helfer, Pläne) */
export interface ChatHerkunft {
  schreibtischId?: string;
  elternChatId?: string;
  planId?: string;
  /** zusätzliche Anhänge (z. B. die Notiz vom Schreibtisch) */
  extraAnhaenge?: string[];
  /** E185: Zusatz zum Auftrag einer Aktion (Auftrag des Bürgermeisters, Ergebnisse der Vorgänger im Plan) */
  zusatz?: string;
}

/** E185: Rückfrage eines Agenten an Leif (Antwort-Knöpfe in Telegram, Antwort landet als Nachricht im Chat) */
export interface RueckfrageInfo {
  id: string;
  chatId: string;
  frage: string;
  optionen: string[];
}

export interface LaufEnde {
  laufId: string;
  chatId: string;
  status: LaufStatus;
  fehler?: string;
  geschrieben: string[];
}

/**
 * Agenten-Kern: legt Chats und Läufe an, hält die Warteschlange (Obergrenzen je Motor aus motoren.md),
 * führt Läufe über den passenden Motor aus und schreibt Chat-Spiegel, Protokoll und Verbrauch.
 */
export class AgentenDienst {
  private laufend = new Map<string, AbortController>();
  private pumpeLaeuft = false;
  private nochmal = false;
  private idle: Promise<void> = Promise.resolve();
  readonly freigaben: Freigaben;
  /** Sonder-Werkzeuge für Chats mit rolle = buergermeister (setzt der Bürgermeister-Dienst) */
  rollenWerkzeuge?: RollenHandler;
  /** Zuhörer für beendete Läufe (Telegram-Meldungen, Plan-Abschluss, Schreibtisch-Status) */
  readonly beiLaufEnde: ((e: LaufEnde) => void | Promise<void>)[] = [];
  /** Server-Auswahlen für Aktions-Eingaben (z. B. Kurse aus Moodle) – wird beim Zusammenbau gesetzt */
  quellen: QuellenFn = () => [];
  /** Rechenraum (pdflatex/Python ohne Netz) – nur gesetzt, wenn eingerichtet */
  rechenraum?: RechenraumKlient;
  /** Moodle-Browser (eigener Container) – nur für Aktionen mit werkzeuge: [moodle] */
  moodleBrowser?: MoodleBrowserKlient;
  /** Gmail (nur Lesen + Entwürfe) – nur gesetzt, wenn verbunden */
  post?: GmailKlient;
  /** Ablage mit Archiv für Aktionen mit `ablage:` (E60), wird in dorf.ts gesetzt */
  ablage?: Ablage;
  /** Termine für kalender_lesen (Hauptkalender + Uni), wird in dorf.ts gesetzt */
  kalender?: (von: number, bis: number) => Promise<KalenderEintrag[]>;
  /** To-do-Brett (E65) und weitere Listen (Etappe 7) */
  listen?: Record<ListenName, TodoDienst>;
  /** E183: Kirchturm und Tagesnotizen für die Alltags-Werkzeuge (in dorf.ts gesetzt) */
  kirchturm?: Kirchturm;
  notizen?: Notizen;
  /** E185: Termine direkt (Google-Kalender), Adressbuch, „Rückgängig“ statt Freigabe, Rückfragen */
  termine?: GoogleKalender;
  kontakte?: Kontakte;
  readonly rueckgaengig: Rueckgaengig;
  readonly beiRueckfrage: ((r: RueckfrageInfo) => void | Promise<void>)[] = [];

  constructor(
    private db: DB,
    private uhr: Uhr,
    private vault: VaultDienst,
    private suche: Suchindex,
    private hub: LiveHub,
    private motoren: Record<MotorName, Motor>,
  ) {
    this.freigaben = new Freigaben(db, uhr, vault);
    this.freigaben.beiAenderung = () => hub.senden({ typ: 'freigaben.geaendert' });
    this.rueckgaengig = new Rueckgaengig(db, uhr);
    this.rueckgaengig.beiAenderung = () => hub.senden({ typ: 'freigaben.geaendert' });
    this.freigaben.registrieren('lauf_starten', async ({ laufId }) => {
      const r = this.db.prepare("UPDATE laeufe SET status = 'wartend' WHERE id = ? AND status = 'wartet_freigabe'").run(laufId);
      if (r.changes !== 1) throw new Error('Lauf wartet nicht (mehr) auf Freigabe.');
      this.statusMelden(laufId);
      this.anstossen();
      return 'Lauf gestartet.';
    });
    // Läufe, die bei einem Neustart mitten drin waren, sind verloren.
    this.db
      .prepare("UPDATE laeufe SET status = 'fehler', fehler = 'Server wurde während des Laufs neu gestartet.', ende = ? WHERE status = 'laeuft'")
      .run(uhr.jetzt());
    // Review zu E185: Lehnt Leif „Aktion starten“ ab, ist der Lauf abgebrochen – sonst bliebe er für immer auf
    // wartet_freigabe und alles, was im Chat nachgeschoben wurde, wartete ewig.
    this.freigaben.beiEntscheidung.push((f) => {
      if (f.art !== 'lauf_starten' || f.status !== 'abgelehnt') return;
      const laufId = (f.inhalt as { laufId: string }).laufId;
      const r = this.db.prepare("UPDATE laeufe SET status = 'abgebrochen', fehler = 'Leif hat den Start abgelehnt.', ende = ? WHERE id = ? AND status = 'wartet_freigabe'").run(this.uhr.jetzt(), laufId);
      if (r.changes === 1) this.ohneLaufBeendet(laufId);
    });
  }

  /**
   * Nach dem Serverstart: Läufe, die beim Neustart liefen, sind jetzt „fehler“ – was in ihren Chats nachgeschoben wurde,
   * hinge sonst nach jedem Deploy fest (Review zu E185). Übergibt die Warteschlange aller Chats ohne offenen Lauf.
   */
  nachStart() {
    for (const z of this.db.prepare('SELECT DISTINCT chat_id FROM chat_warteschlange').all() as { chat_id: string }[]) {
      try {
        this.schlangeUebergeben(z.chat_id);
      } catch (e) {
        console.error('Warteschlange nach dem Start', e);
      }
    }
    this.anstossen();
  }

  /** Ein Lauf endet, ohne je gelaufen zu sein (abgebrochen, während er wartete): Zuhörer, Warteschlange, nächste Läufe */
  private ohneLaufBeendet(laufId: string) {
    const l = this.laufZeile(laufId);
    this.statusMelden(laufId);
    this.hub.senden({ typ: 'chat.geaendert', chatId: l.chat_id, gebaeude: this.chatZeile(l.chat_id).gebaeude });
    // Zuhörer wie nach jedem Lauf (Plan mit „nach“ wartet sonst ewig auf diesen Helfer) – danach die Warteschlange
    const fertig = (async () => {
      for (const fn of this.beiLaufEnde) {
        try {
          await fn({ laufId, chatId: l.chat_id, status: 'abgebrochen', fehler: 'Abgebrochen, bevor der Lauf begann.', geschrieben: [] });
        } catch (e) {
          console.error('Zuhörer für Laufende fehlgeschlagen', e);
        }
      }
      try {
        this.schlangeUebergeben(l.chat_id);
      } catch (e) {
        console.error('Warteschlange übergeben fehlgeschlagen', e);
      }
      this.anstossen();
    })();
    this.idle = Promise.all([this.idle.catch(() => undefined), fertig]).then(() => undefined);
  }

  /** Startet eine Aktion: neuer Chat + erster Lauf. */
  async aktionStarten(
    aktionId: string,
    eingaben: Record<string, string>,
    ausloeser: Ausloeser = 'klick',
    herkunft: ChatHerkunft = {},
  ): Promise<{ chatId: string; laufId: string }> {
    const a = await aktionLaden(this.vault, aktionId);
    const { prompt: rohPrompt, anhaenge, werte, ablage } = eingabenAnwenden(a, eingaben, this.quellen);
    // Ablage (E60): Entwurfsname und Hinweise vom Code; der Tausch passiert erst nach erfolgreichem Lauf
    const abl = this.ablage?.vorbereiten(a, ablage) ?? null;
    const mitZusatz = herkunft.zusatz?.trim() ? `${rohPrompt}\n\n---\nZusatz vom Bürgermeister zu diesem Auftrag:\n${herkunft.zusatz.trim()}` : rohPrompt;
    const prompt = abl ? `${mitZusatz}\n${abl.zusatz}` : mitZusatz;
    const profil = werkzeugprofil(a);
    const erstesFeld = Object.values(werte).find((w) => w.trim()) ?? '';
    const titel = `${a.name}${erstesFeld ? `: ${erstesFeld.replace(/\s+/g, ' ').slice(0, 60)}` : ''}`;
    // E185: Der Bürgermeister erledigt Kurzes selbst – Post, Kalender, Adressbuch und Web hat er immer (unabhängig von der Aktionsdatei)
    const bm = a.rolle === 'buergermeister';
    const werkzeugListe: string[] = [...new Set([...profil.dorf, ...(bm ? BUERGERMEISTER_WERKZEUGE : []), ...(profil.web || bm ? ['web'] : [])])];
    const chatId = await this.chatAnlegen({
      gebaeude: a.gebaeude,
      aktion: a.id,
      titel,
      motor: a.motor,
      stufe: a.stufe,
      werte,
      anhaenge: [...anhaenge, ...(herkunft.extraAnhaenge ?? [])],
      werkzeuge: werkzeugListe,
      fremdinhalte: a.fremdinhalte,
      rolle: a.rolle,
      herkunft,
    });
    const laufId = this.laufAnlegen(chatId, prompt, ausloeser, a.freigabeVorStart);
    if (abl) this.ablage!.merken(laufId, abl.ziel, abl.entwurf);
    if (a.freigabeVorStart) {
      await this.freigaben.beantragen({
        art: 'lauf_starten',
        titel: `Aktion starten: ${titel}`,
        begruendung: 'Diese Aktion verlangt vor dem Start Leifs Freigabe (freigabe_vor_start).',
        inhalt: { laufId },
        gebaeude: a.gebaeude,
        laufId,
        chatId,
      });
    }
    this.hub.senden({ typ: 'chat.geaendert', chatId, gebaeude: a.gebaeude });
    this.anstossen();
    return { chatId, laufId };
  }

  private async chatAnlegen(o: {
    gebaeude: string;
    aktion: string | null;
    titel: string;
    motor: MotorName;
    stufe: Stufe;
    werte: Record<string, string>;
    anhaenge: string[];
    werkzeuge: string[];
    fremdinhalte: boolean;
    rolle?: string;
    herkunft: ChatHerkunft;
  }) {
    const stufen = await stufenLaden(this.vault);
    const jetzt = this.uhr.jetzt();
    const chatId = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO chats (id, gebaeude, aktion, titel, motor, stufe, modell, eingaben_json, anhaenge_json, werkzeuge_json, fremdinhalte,
                            rolle, schreibtisch_id, eltern_chat_id, plan_id, erstellt, geaendert)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        chatId,
        o.gebaeude,
        o.aktion,
        o.titel,
        o.motor,
        o.stufe,
        stufen.stufen[o.stufe].modell,
        JSON.stringify(o.werte),
        JSON.stringify(o.anhaenge),
        JSON.stringify(o.werkzeuge),
        o.fremdinhalte ? 1 : 0,
        o.rolle ?? null,
        o.herkunft.schreibtischId ?? null,
        o.herkunft.elternChatId ?? null,
        o.herkunft.planId ?? null,
        jetzt,
        jetzt,
      );
    return chatId;
  }

  /**
   * Freier Helfer (ohne Aktionsdatei): arbeitet im Zielgebäude nach dessen Arbeitsanweisung – Vault, To-dos, Alltag;
   * mit `faehigkeiten` zusätzlich Web, Post, Kalender, Moodle oder Rechenraum (E185). Motor: claude-code.
   */
  async helferStarten(o: { gebaeude: string; titel: string; auftrag: string; stufe: Stufe; ausloeser: Ausloeser; herkunft: ChatHerkunft; faehigkeiten?: HelferFaehigkeit[] }) {
    const f = o.faehigkeiten ?? [];
    const profil = werkzeugprofil({ werkzeuge: ['vault_lesen', 'vault_suchen', 'vault_schreiben', ...f], fremdinhalte: false });
    const werkzeuge: string[] = [...profil.dorf, ...(profil.web ? ['web'] : [])];
    const chatId = await this.chatAnlegen({
      gebaeude: o.gebaeude,
      aktion: null,
      titel: `Helfer: ${o.titel.slice(0, 80)}`,
      motor: 'claude-code',
      stufe: o.stufe,
      werte: {},
      anhaenge: o.herkunft.extraAnhaenge ?? [],
      werkzeuge,
      fremdinhalte: false,
      herkunft: o.herkunft,
    });
    const prompt = `Du bist ein Helfer des Bürgermeisters im Gebäude ${o.gebaeude}.

Auftrag: ${o.titel}

${o.auftrag}${o.herkunft.zusatz?.trim() ? `\n\n${o.herkunft.zusatz.trim()}` : ''}

Erledige genau diesen Auftrag. Lege Ergebnisse als Notiz in ${o.gebaeude}/ ab und nenne den Pfad in deiner Zusammenfassung.`;
    const laufId = this.laufAnlegen(chatId, prompt, o.ausloeser, false);
    this.hub.senden({ typ: 'chat.geaendert', chatId, gebaeude: o.gebaeude });
    this.anstossen();
    return { chatId, laufId };
  }

  /** Hinweis in einen Chat schreiben (z. B. Abschluss eines Plans). Wird nicht Teil des Modell-Verlaufs. */
  async hinweisSchreiben(chatId: string, text: string) {
    const c = this.chatZeile(chatId);
    this.db
      .prepare("INSERT INTO nachrichten (chat_id, lauf_id, rolle, text, motor, erstellt) VALUES (?, NULL, 'hinweis', ?, ?, ?)")
      .run(chatId, text, c.motor, this.uhr.jetzt());
    this.db.prepare('UPDATE chats SET geaendert = ? WHERE id = ?').run(this.uhr.jetzt(), chatId);
    await chatSpiegeln(this.db, this.vault, chatId).catch(() => undefined);
    this.hub.senden({ typ: 'chat.geaendert', chatId, gebaeude: c.gebaeude });
  }

  /**
   * Setzt einen Chat mit einer neuen Nachricht fort. Läuft dort gerade etwas, kommt sie in die Warteschlange (E185) und
   * wird nach dem aktuellen Schritt übergeben – nichts geht verloren, weder Leifs Nachschub noch Meldungen des Dorfs.
   */
  nachrichtSenden(chatId: string, text: string, ausloeser: Ausloeser = 'klick'): { laufId?: string; wartend?: number } {
    const c = this.chatZeile(chatId);
    if (!text.trim()) throw new DorfFehler(400, 'Nachricht ist leer.');
    const offen = this.offenerLauf(chatId);
    // Auch einreihen, wenn noch Älteres wartet (der Lauf ist gerade zu Ende, die Schlange aber noch nicht übergeben) –
    // sonst käme die neue Nachricht vor den älteren dran (Review zu E185).
    if (offen || this.wartend(chatId).length) {
      this.db.prepare('INSERT INTO chat_warteschlange (chat_id, text, ausloeser, erstellt) VALUES (?, ?, ?, ?)').run(chatId, text, ausloeser, this.uhr.jetzt());
      if (!offen) {
        // kein Lauf mehr offen: gleich alles in der richtigen Reihenfolge übergeben
        this.schlangeUebergeben(chatId);
        this.anstossen();
        return { laufId: (this.db.prepare('SELECT id FROM laeufe WHERE chat_id = ? ORDER BY nummer DESC LIMIT 1').get(chatId) as { id: string }).id };
      }
      this.hub.senden({ typ: 'chat.geaendert', chatId, gebaeude: c.gebaeude });
      return { wartend: this.wartend(chatId).length };
    }
    const laufId = this.laufAnlegen(c.id, text, ausloeser, false);
    this.anstossen();
    return { laufId };
  }

  private offenerLauf(chatId: string) {
    return !!this.db.prepare("SELECT 1 FROM laeufe WHERE chat_id = ? AND status IN ('wartet_freigabe', 'wartend', 'laeuft')").get(chatId);
  }

  wartend(chatId: string) {
    return (this.db.prepare('SELECT id, text, erstellt FROM chat_warteschlange WHERE chat_id = ? ORDER BY id').all(chatId) as { id: number; text: string; erstellt: number }[]).map((w) => ({
      id: w.id,
      text: w.text,
      erstellt: iso(w.erstellt)!,
    }));
  }

  /** Eine wartende Nachricht wieder herausnehmen (Leif hat es sich anders überlegt) */
  wartendeLoeschen(chatId: string, id: number) {
    const c = this.chatZeile(chatId);
    const r = this.db.prepare('DELETE FROM chat_warteschlange WHERE chat_id = ? AND id = ?').run(chatId, id);
    if (r.changes !== 1) throw new DorfFehler(404, 'Diese Nachricht wartet nicht mehr – sie wurde schon übergeben.');
    this.hub.senden({ typ: 'chat.geaendert', chatId, gebaeude: c.gebaeude });
  }

  /** Nimmt alles Wartende eines Chats heraus (atomar) – für den nächsten Lauf oder als Nachschub in den laufenden */
  private schlangeNehmen(chatId: string) {
    return this.db.transaction(() => {
      const z = this.db.prepare('SELECT id, text, ausloeser FROM chat_warteschlange WHERE chat_id = ? ORDER BY id').all(chatId) as { id: number; text: string; ausloeser: Ausloeser }[];
      if (z.length) this.db.prepare('DELETE FROM chat_warteschlange WHERE chat_id = ?').run(chatId);
      return z;
    })();
  }

  /** Nach einem Lauf: Wartendes gesammelt als EINEN neuen Lauf übergeben */
  private schlangeUebergeben(chatId: string) {
    if (this.offenerLauf(chatId)) return;
    const z = this.schlangeNehmen(chatId);
    if (!z.length) return;
    const text = z.length === 1 ? z[0]!.text : z.map((x, i) => `Nachricht ${i + 1}:\n${x.text}`).join('\n\n---\n\n');
    this.laufAnlegen(chatId, text, z.some((x) => x.ausloeser !== 'zeitplan') ? 'klick' : 'zeitplan', false);
  }

  /** E185: Rückfrage eines Agenten – als Hinweis im Chat, Zuhörer (Telegram) schicken Knöpfe */
  async rueckfrageStellen(f: { chatId: string; frage: string; optionen: string[] }) {
    const id = crypto.randomUUID().slice(0, 12);
    this.db.prepare('INSERT INTO rueckfragen (id, chat_id, frage, optionen_json, erstellt) VALUES (?, ?, ?, ?, ?)').run(id, f.chatId, f.frage, JSON.stringify(f.optionen), this.uhr.jetzt());
    await this.hinweisSchreiben(f.chatId, `❓ **Rückfrage:** ${f.frage}${f.optionen.length ? `\n\n${f.optionen.map((o) => `- ${o}`).join('\n')}` : ''}\n\n_Antworte einfach hier im Chat._`);
    for (const fn of this.beiRueckfrage) await Promise.resolve(fn({ id, ...f })).catch((e) => console.error('Rückfrage-Zuhörer fehlgeschlagen', e));
  }

  /** Antwort per Knopf: genau einmal, landet als Leifs Nachricht im Chat */
  rueckfrageBeantworten(id: string, nr: number) {
    const z = this.db.prepare('SELECT chat_id, optionen_json FROM rueckfragen WHERE id = ?').get(id) as { chat_id: string; optionen_json: string } | undefined;
    const antwort = z ? (JSON.parse(z.optionen_json) as string[])[nr] : undefined;
    if (!z || antwort === undefined) throw new DorfFehler(404, 'Diese Rückfrage gibt es nicht.');
    const r = this.db.prepare('UPDATE rueckfragen SET antwort = ? WHERE id = ? AND antwort IS NULL').run(antwort, id);
    if (r.changes !== 1) throw new DorfFehler(409, 'Schon beantwortet.');
    this.nachrichtSenden(z.chat_id, antwort, 'klick');
    return { chatId: z.chat_id, antwort };
  }

  abbrechen(laufId: string) {
    const l = this.laufZeile(laufId);
    if (l.status === 'wartend' || l.status === 'wartet_freigabe') {
      const r = this.db.prepare("UPDATE laeufe SET status = 'abgebrochen', ende = ? WHERE id = ? AND status IN ('wartend', 'wartet_freigabe')").run(this.uhr.jetzt(), laufId);
      if (r.changes === 1) this.ohneLaufBeendet(laufId);
      return;
    }
    if (l.status !== 'laeuft') throw new DorfFehler(409, 'Dieser Lauf ist schon beendet.');
    this.laufend.get(laufId)?.abort();
  }

  private laufAnlegen(chatId: string, auftrag: string, ausloeser: Ausloeser, wartetFreigabe: boolean) {
    const c = this.chatZeile(chatId);
    const id = crypto.randomUUID();
    const nummer = ((this.db.prepare('SELECT MAX(nummer) AS n FROM laeufe WHERE chat_id = ?').get(chatId) as { n: number | null }).n ?? 0) + 1;
    this.db
      .prepare(
        `INSERT INTO laeufe (id, chat_id, nummer, motor, modell, stufe, aufwand, status, ausloeser, auftrag, erstellt)
         VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)`,
      )
      .run(id, chatId, nummer, c.motor, c.modell, c.stufe, wartetFreigabe ? 'wartet_freigabe' : 'wartend', ausloeser, auftrag, this.uhr.jetzt());
    this.statusMelden(id);
    return id;
  }

  /** Startet wartende Läufe, solange die Obergrenzen es erlauben. */
  anstossen() {
    if (this.pumpeLaeuft) {
      this.nochmal = true;
      return;
    }
    this.pumpeLaeuft = true;
    this.idle = (async () => {
      try {
        do {
          this.nochmal = false;
          const k = await motorenLaden(this.vault);
          const wartend = this.db.prepare("SELECT * FROM laeufe WHERE status = 'wartend' ORDER BY erstellt").all() as LaufZeile[];
          for (const l of wartend) {
            const motor = this.effektiverMotor(l, k.alleAuf);
            const aktiv = (this.db.prepare("SELECT COUNT(*) AS n FROM laeufe WHERE status = 'laeuft' AND motor = ?").get(motor) as { n: number }).n;
            if (aktiv >= k.parallel[motor]) continue;
            const r = this.db.prepare("UPDATE laeufe SET status = 'laeuft', motor = ?, start = ? WHERE id = ? AND status = 'wartend'").run(motor, this.uhr.jetzt(), l.id);
            if (r.changes === 1) void this.ausfuehren(l.id);
          }
        } while (this.nochmal);
      } finally {
        this.pumpeLaeuft = false;
      }
    })();
  }

  /** Zeitgesteuerte Läufe laufen immer über die API (Abo nur für Leifs Klicks). Der Notschalter übersteuert alles. */
  private effektiverMotor(l: LaufZeile, alleAuf: 'keiner' | MotorName): MotorName {
    if (alleAuf !== 'keiner') return alleAuf;
    if (l.ausloeser === 'zeitplan') return 'api';
    return l.motor;
  }

  /** Beim Herunterfahren: wartet, bis die Warteschlange gerade nichts mehr in der Datenbank tut. */
  async ruhe() {
    await this.idle.catch(() => undefined);
  }

  /** Für Tests: wartet, bis keine Läufe mehr laufen oder warten. */
  async leerlauf(maxMs = 10_000) {
    const ende = Date.now() + maxMs;
    while (Date.now() < ende) {
      await this.idle;
      const n = (this.db.prepare("SELECT COUNT(*) AS n FROM laeufe WHERE status IN ('wartend', 'laeuft')").get() as { n: number }).n;
      if (n === 0 && this.laufend.size === 0) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('Leerlauf nicht erreicht');
  }

  private async ausfuehren(laufId: string) {
    const ac = new AbortController();
    this.laufend.set(laufId, ac);
    this.statusMelden(laufId);
    let letzteAntwort = '';
    // Nachschub, den der Motor schon genommen hat, auf den das Modell aber noch nicht geantwortet hat (Review zu E185)
    let nachschubOffen: { text: string; ausloeser: Ausloeser }[] = [];
    const t = { ein: 0, aus: 0, cacheLesen: 0, cacheSchreiben: 0, kosten: 0 as number | undefined };
    let status: LaufStatus = 'fertig';
    let fehler: string | null = null;
    const l = this.laufZeile(laufId);
    const c = this.chatZeile(l.chat_id);
    try {
      const stufen = await stufenLaden(this.vault);
      const s = stufen.stufen[c.stufe];
      // Das Modell steht im Chat fest; der Aufwand kommt aus der aktuellen Stufe.
      this.db.prepare('UPDATE laeufe SET aufwand = ?, modell = ? WHERE id = ?').run(s.aufwand, c.modell, laufId);
      const motor = this.motoren[l.motor];
      const werkzeugListe = werkzeugeAktuell(JSON.parse(c.werkzeuge_json) as string[], (n) => n in WERKZEUG_DEFINITIONEN);
      const profil = { dorf: werkzeugListe.filter((w) => w !== 'web') as DorfWerkzeug[], web: werkzeugListe.includes('web') };
      // Bürgermeister (E61): Gedächtnis und Persönlichkeit einmal lesen – für den Prompt und als bekannte Fassung
      const wissen = c.rolle === 'buergermeister' ? await wissenLaden(this.vault) : null;
      const kiste = new WerkzeugKiste(
        this.db,
        this.uhr,
        this.vault,
        this.suche,
        this.freigaben,
        {
          laufId,
          chatId: c.id,
          gebaeude: c.gebaeude,
          erlaubt: profil.dorf,
          rechenraum:
            this.rechenraum && profil.dorf.includes('rechenraum_befehl')
              ? { klient: this.rechenraum, ablage: ablageOrdner({ gebaeude: c.gebaeude, titel: c.titel, erstellt: c.erstellt, eingaben: JSON.parse(c.eingaben_json || '{}') }) }
              : undefined,
          post: profil.dorf.includes('post_lesen') || profil.dorf.includes('post_entwurf_neu') ? this.post : undefined,
          moodle: this.moodleBrowser && profil.dorf.includes('moodle_oeffnen') ? this.moodleBrowser : undefined,
          kalender: profil.dorf.includes('kalender_lesen') ? this.kalender : undefined,
          wissen: wissen ? { gedaechtnisVersion: wissen.gedaechtnisVersion } : undefined,
          listen: this.listen,
          kirchturm: this.kirchturm,
          notizen: this.notizen,
          fremdinhalte: !!c.fremdinhalte,
          web: profil.web,
          termine: this.termine,
          kontakte: this.kontakte,
          rueckgaengig: this.rueckgaengig,
          rueckfrage: (f) => this.rueckfrageStellen(f),
        },
        c.rolle === 'buergermeister' ? this.rollenWerkzeuge : undefined,
      );
      kiste.beiAufruf = (name, erlaubt, kurz) => this.hub.senden({ typ: 'lauf.werkzeug', laufId, chatId: c.id, name, erlaubt, kurz });

      const aktionName = c.aktion ? c.aktion.split('/')[1]! : c.eltern_chat_id ? 'Helfer des Bürgermeisters' : 'Chat';
      const system = await systemPromptBauen(this.vault, { gebaeude: c.gebaeude, aktionName, profil, jetzt: this.uhr.jetzt(), motor: l.motor, stufe: c.stufe, wissen });
      let anhaenge: Anhang[] = [];
      let nachricht = l.auftrag;
      const muster = JSON.parse(c.anhaenge_json) as string[];
      if (l.nummer === 1 && muster.length) {
        const geladen = await anhaengeLaden(this.vault, muster, !!c.fremdinhalte);
        anhaenge = geladen.anhaenge;
        nachricht = auftragMitAnhaengen(l.auftrag, anhaenge, geladen.fehlend, !!c.fremdinhalte);
      } else if (l.nummer === 1 && c.fremdinhalte) {
        nachricht = auftragMitAnhaengen(l.auftrag, [], [], true);
      }
      const verlauf = this.verlaufFuer(c, l.motor);

      for await (const e of motor.starten({ laufId, chatId: c.id, modell: c.modell, aufwand: s.aufwand, system, nachricht, anhaenge, verlauf, werkzeuge: kiste, web: profil.web, signal: ac.signal, nachschub: () => {
        const z = this.schlangeNehmen(c.id);
        nachschubOffen.push(...z);
        return z.map((x) => x.text);
      }, liveText: (text) => this.hub.senden({ typ: 'lauf.text', laufId, chatId: c.id, text }) })) {
        switch (e.typ) {
          case 'text':
            this.hub.senden({ typ: 'lauf.text', laufId, chatId: c.id, text: e.text });
            break;
          case 'nachricht':
            this.db
              .prepare('INSERT INTO nachrichten (chat_id, lauf_id, rolle, text, roh_json, motor, erstellt) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .run(c.id, laufId, e.rolle, e.text, e.roh === undefined ? null : JSON.stringify(e.roh), l.motor, this.uhr.jetzt());
            if (e.rolle === 'agent') {
              letzteAntwort = e.text;
              nachschubOffen = []; // das Modell hat nach dem Nachschub geantwortet
            }
            this.hub.senden({ typ: 'chat.geaendert', chatId: c.id, gebaeude: c.gebaeude });
            break;
          case 'verbrauch':
            t.ein += e.ein;
            t.aus += e.aus;
            t.cacheLesen += e.cacheLesen;
            t.cacheSchreiben += e.cacheSchreiben;
            this.db
              .prepare('UPDATE laeufe SET ein_token = ?, aus_token = ?, cache_lesen = ?, cache_schreiben = ?, kosten_usd = ? WHERE id = ?')
              .run(t.ein, t.aus, t.cacheLesen, t.cacheSchreiben, kostenSchaetzen(stufen.preise, c.modell, t), laufId);
            break;
          case 'sitzung':
            this.db.prepare('UPDATE chats SET cc_sitzung = ? WHERE id = ?').run(e.id, c.id);
            break;
        }
      }
    } catch (e) {
      if (e instanceof AbbruchFehler || ac.signal.aborted) {
        status = 'abgebrochen';
        fehler = 'Von Leif abgebrochen.';
      } else {
        status = 'fehler';
        fehler = (e as Error).message?.slice(0, 1000) ?? String(e);
      }
      this.db
        .prepare("INSERT INTO nachrichten (chat_id, lauf_id, rolle, text, motor, erstellt) VALUES (?, ?, 'hinweis', ?, ?, ?)")
        .run(c.id, laufId, status === 'abgebrochen' ? 'Lauf abgebrochen.' : `Fehler: ${fehler}`, l.motor, this.uhr.jetzt());
    } finally {
      // Scheitert oder endet der Lauf, bevor das Modell auf den Nachschub geantwortet hat, kommt er zurück an den ANFANG der
      // Schlange – so gibt es einen Folgelauf, und Leifs Nachtrag bleibt nicht ohne Antwort.
      if (nachschubOffen.length) {
        this.db.transaction(() => {
          const rest = this.db.prepare('SELECT text, ausloeser, erstellt FROM chat_warteschlange WHERE chat_id = ? ORDER BY id').all(c.id) as { text: string; ausloeser: string; erstellt: number }[];
          this.db.prepare('DELETE FROM chat_warteschlange WHERE chat_id = ?').run(c.id);
          const neu = this.db.prepare('INSERT INTO chat_warteschlange (chat_id, text, ausloeser, erstellt) VALUES (?, ?, ?, ?)');
          for (const x of nachschubOffen) neu.run(c.id, x.text, x.ausloeser, this.uhr.jetzt());
          for (const x of rest) neu.run(c.id, x.text, x.ausloeser, x.erstellt);
        })();
      }
      this.db.prepare('UPDATE laeufe SET status = ?, fehler = ?, ende = ? WHERE id = ?').run(status, fehler, this.uhr.jetzt(), laufId);
      this.db.prepare('UPDATE chats SET geaendert = ? WHERE id = ?').run(this.uhr.jetzt(), c.id);
      // Browser-Seite dieses Laufs schließen (die Moodle-Anmeldung bleibt im Browser erhalten)
      if (this.moodleBrowser && (JSON.parse(c.werkzeuge_json) as string[]).includes('moodle_oeffnen')) void this.moodleBrowser.schliessen(laufId);
      try {
        await chatSpiegeln(this.db, this.vault, c.id);
        await protokollSchreiben(this.db, this.vault, laufId, letzteAntwort);
      } catch (e) {
        console.error('Protokoll/Spiegel fehlgeschlagen', e);
      }
      const geschrieben = (
        this.db
          .prepare("SELECT DISTINCT pfad FROM werkzeug_log WHERE lauf_id = ? AND art = 'geschrieben' AND erlaubt = 1 AND pfad IS NOT NULL")
          .all(laufId) as { pfad: string }[]
      ).map((r) => r.pfad);
      for (const fn of this.beiLaufEnde) {
        try {
          await fn({ laufId, chatId: c.id, status, fehler: fehler ?? undefined, geschrieben });
        } catch (e) {
          console.error('Zuhörer für Laufende fehlgeschlagen', e);
        }
      }
      this.laufend.delete(laufId);
      this.statusMelden(laufId);
      // E185: was Leif (oder das Dorf) während des Laufs nachgeschoben hat, kommt jetzt dran
      try {
        this.schlangeUebergeben(c.id);
      } catch (e) {
        console.error('Warteschlange übergeben fehlgeschlagen', e);
      }
      this.hub.senden({ typ: 'chat.geaendert', chatId: c.id, gebaeude: c.gebaeude });
      this.hub.senden({ typ: 'verbrauch.geaendert' });
      this.anstossen();
    }
  }

  /** Verlauf für den Motor: unveränderte API-Nachrichten bzw. claude-code-Sitzung; bei Motorwechsel als Text. */
  private verlaufFuer(c: ChatZeile, motor: MotorName): Verlauf {
    const n = this.db.prepare("SELECT rolle, text, roh_json, motor FROM nachrichten WHERE chat_id = ? AND rolle IN ('nutzer', 'agent', 'werkzeug') ORDER BY id").all(c.id) as {
      rolle: string;
      text: string;
      roh_json: string | null;
      motor: string;
    }[];
    const fremdMotor = n.some((x) => x.motor !== motor);
    const textVerlauf = fremdMotor
      ? n
          .filter((x) => x.rolle !== 'werkzeug')
          .map((x) => `${x.rolle === 'nutzer' ? 'Leif' : 'Agent'}: ${x.text}`)
          .join('\n\n')
      : undefined;
    if (fremdMotor) return { apiNachrichten: [], textVerlauf };
    return {
      apiNachrichten: motor === 'api' ? n.filter((x) => x.roh_json).map((x) => JSON.parse(x.roh_json!)) : [],
      ccSitzung: motor === 'claude-code' ? (c.cc_sitzung ?? undefined) : undefined,
    };
  }

  private statusMelden(laufId: string) {
    const l = this.laufZeile(laufId);
    this.hub.senden({ typ: 'lauf.status', laufId, chatId: l.chat_id, status: l.status });
  }

  chatZeile(id: string) {
    const c = this.db.prepare('SELECT * FROM chats WHERE id = ?').get(id) as ChatZeile | undefined;
    if (!c) throw new DorfFehler(404, 'Chat nicht gefunden.');
    return c;
  }
  private laufZeile(id: string) {
    const l = this.db.prepare('SELECT * FROM laeufe WHERE id = ?').get(id) as LaufZeile | undefined;
    if (!l) throw new DorfFehler(404, 'Lauf nicht gefunden.');
    return l;
  }

  chatListe(f: { gebaeude?: string; q?: string } = {}): ChatInfo[] {
    const rows = this.db
      .prepare(
        `SELECT c.*, (SELECT status FROM laeufe WHERE chat_id = c.id ORDER BY nummer DESC LIMIT 1) AS lauf_status
         FROM chats c WHERE (? IS NULL OR gebaeude = ?) AND (? IS NULL OR titel LIKE ?) ORDER BY geaendert DESC LIMIT 300`,
      )
      .all(f.gebaeude ?? null, f.gebaeude ?? null, f.q ?? null, `%${f.q ?? ''}%`) as (ChatZeile & { lauf_status: LaufStatus | null })[];
    return rows.map((c) => this.chatInfo(c, c.lauf_status ?? undefined));
  }

  private chatInfo(c: ChatZeile, status?: LaufStatus): ChatInfo {
    return {
      id: c.id,
      gebaeude: c.gebaeude,
      aktion: c.aktion ?? undefined,
      titel: c.titel,
      motor: c.motor,
      stufe: c.stufe,
      modell: c.modell,
      erstellt: iso(c.erstellt)!,
      geaendert: iso(c.geaendert)!,
      status,
      spiegelPfad: c.spiegel_pfad ?? undefined,
      protokollPfad: c.protokoll_pfad ?? undefined,
      rolle: c.rolle ?? undefined,
      schreibtischId: c.schreibtisch_id ?? undefined,
      elternChatId: c.eltern_chat_id ?? undefined,
      planId: c.plan_id ?? undefined,
    };
  }

  chatDetail(id: string): ChatDetail {
    const c = this.chatZeile(id);
    const laeufe = (this.db.prepare('SELECT * FROM laeufe WHERE chat_id = ? ORDER BY nummer').all(id) as LaufZeile[]).map(laufInfo);
    const nachrichten = (
      this.db.prepare('SELECT id, lauf_id, rolle, text, erstellt FROM nachrichten WHERE chat_id = ? ORDER BY id').all(id) as {
        id: number;
        lauf_id: string | null;
        rolle: 'nutzer' | 'agent' | 'werkzeug' | 'hinweis';
        text: string;
        erstellt: number;
      }[]
    ).map((n) => ({ id: n.id, laufId: n.lauf_id ?? undefined, rolle: n.rolle, text: n.text, erstellt: iso(n.erstellt)! }));
    return { ...this.chatInfo(c, laeufe.at(-1)?.status), nachrichten, laeufe, wartend: this.wartend(id) };
  }

  aktiveLaeufe(): LaufInfo[] {
    return (this.db.prepare("SELECT * FROM laeufe WHERE status IN ('wartet_freigabe', 'wartend', 'laeuft') ORDER BY erstellt").all() as LaufZeile[]).map(laufInfo);
  }
}

export { kurztitel };
