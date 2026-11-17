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
import { BUERGERMEISTER_WERKZEUGE, LESE_WERKZEUGE, werkzeugprofil, type DorfWerkzeug } from './leine.js';
import { kostenSchaetzen, motorenLaden, stufenLaden } from './modelle.js';
import { anhaengeLaden, auftragMitAnhaengen, systemPromptBauen } from './kontext.js';
import { WerkzeugKiste, type RollenHandler } from './werkzeuge.js';
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
  }

  /** Startet eine Aktion: neuer Chat + erster Lauf. */
  async aktionStarten(
    aktionId: string,
    eingaben: Record<string, string>,
    ausloeser: Ausloeser = 'klick',
    herkunft: ChatHerkunft = {},
  ): Promise<{ chatId: string; laufId: string }> {
    const a = await aktionLaden(this.vault, aktionId);
    const { prompt, anhaenge, werte } = eingabenAnwenden(a, eingaben, this.quellen);
    const profil = werkzeugprofil(a); // wirft bei Widerspruch (Web + Fremdinhalte)
    const erstesFeld = Object.values(werte).find((w) => w.trim()) ?? '';
    const titel = `${a.name}${erstesFeld ? `: ${erstesFeld.replace(/\s+/g, ' ').slice(0, 60)}` : ''}`;
    const werkzeugListe: string[] = [...profil.dorf, ...(a.rolle === 'buergermeister' ? BUERGERMEISTER_WERKZEUGE : []), ...(profil.web ? ['web'] : [])];
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
   * Freier Helfer (ohne Aktionsdatei): arbeitet im Zielgebäude nach dessen Arbeitsanweisung,
   * mit Standard-Werkzeugen (lesen, schreiben im Gebäude, Freigaben) – kein Web. Motor: claude-code (zählt als Leifs Klick).
   */
  async helferStarten(o: { gebaeude: string; titel: string; auftrag: string; stufe: Stufe; ausloeser: Ausloeser; herkunft: ChatHerkunft }) {
    const werkzeuge: DorfWerkzeug[] = [...LESE_WERKZEUGE, 'freigabe_beantragen', 'vault_schreiben'];
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

${o.auftrag}

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

  /** Setzt einen Chat mit einer neuen Nachricht von Leif fort. */
  nachrichtSenden(chatId: string, text: string, ausloeser: Ausloeser = 'klick') {
    const c = this.chatZeile(chatId);
    if (!text.trim()) throw new DorfFehler(400, 'Nachricht ist leer.');
    const offen = this.db.prepare("SELECT 1 FROM laeufe WHERE chat_id = ? AND status IN ('wartet_freigabe', 'wartend', 'laeuft')").get(chatId);
    if (offen) throw new DorfFehler(409, 'In diesem Chat läuft gerade noch etwas.');
    const laufId = this.laufAnlegen(c.id, text, ausloeser, false);
    this.anstossen();
    return { laufId };
  }

  abbrechen(laufId: string) {
    const l = this.laufZeile(laufId);
    if (l.status === 'wartend' || l.status === 'wartet_freigabe') {
      this.db.prepare("UPDATE laeufe SET status = 'abgebrochen', ende = ? WHERE id = ?").run(this.uhr.jetzt(), laufId);
      this.statusMelden(laufId);
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
      const werkzeugListe = JSON.parse(c.werkzeuge_json) as string[];
      const profil = { dorf: werkzeugListe.filter((w) => w !== 'web') as DorfWerkzeug[], web: werkzeugListe.includes('web') };
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
        },
        c.rolle === 'buergermeister' ? this.rollenWerkzeuge : undefined,
      );
      kiste.beiAufruf = (name, erlaubt, kurz) => this.hub.senden({ typ: 'lauf.werkzeug', laufId, chatId: c.id, name, erlaubt, kurz });

      const aktionName = c.aktion ? c.aktion.split('/')[1]! : c.eltern_chat_id ? 'Helfer des Bürgermeisters' : 'Chat';
      const system = await systemPromptBauen(this.vault, { gebaeude: c.gebaeude, aktionName, profil, jetzt: this.uhr.jetzt(), motor: l.motor, stufe: c.stufe });
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

      for await (const e of motor.starten({ laufId, chatId: c.id, modell: c.modell, aufwand: s.aufwand, system, nachricht, anhaenge, verlauf, werkzeuge: kiste, web: profil.web, signal: ac.signal, liveText: (text) => this.hub.senden({ typ: 'lauf.text', laufId, chatId: c.id, text }) })) {
        switch (e.typ) {
          case 'text':
            this.hub.senden({ typ: 'lauf.text', laufId, chatId: c.id, text: e.text });
            break;
          case 'nachricht':
            this.db
              .prepare('INSERT INTO nachrichten (chat_id, lauf_id, rolle, text, roh_json, motor, erstellt) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .run(c.id, laufId, e.rolle, e.text, e.roh === undefined ? null : JSON.stringify(e.roh), l.motor, this.uhr.jetzt());
            if (e.rolle === 'agent') letzteAntwort = e.text;
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
      this.db.prepare('UPDATE laeufe SET status = ?, fehler = ?, ende = ? WHERE id = ?').run(status, fehler, this.uhr.jetzt(), laufId);
      this.db.prepare('UPDATE chats SET geaendert = ? WHERE id = ?').run(this.uhr.jetzt(), c.id);
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
    return { ...this.chatInfo(c, laeufe.at(-1)?.status), nachrichten, laeufe };
  }

  aktiveLaeufe(): LaufInfo[] {
    return (this.db.prepare("SELECT * FROM laeufe WHERE status IN ('wartet_freigabe', 'wartend', 'laeuft') ORDER BY erstellt").all() as LaufZeile[]).map(laufInfo);
  }
}

export { kurztitel };
