import type { Wochenziele as WochenzieleAntwort } from '@dorf/shared';
import type { Uhr } from './uhr.js';
import type { VaultDienst } from './vault/dienst.js';
import type { LiveHub } from './live.js';
import { DorfFehler } from './fehler.js';
import { kalenderwoche } from './wochenrueckblick.js';
import { tagVonJetzt } from './zeit.js';

/**
 * Wochenziele (E91): je Kalenderwoche eine Obsidian-Checkliste `Rathaus/wochenziele/JJJJ-KWnn.md`
 * („- [ ] Ziel“ / „- [x] Ziel“). Höchstens 7 Ziele – wenige, die zählen. Alles andere in der Datei bleibt unangetastet.
 */
export const ZIELE_ORDNER = 'Rathaus/wochenziele';
export const MAX_ZIELE = 7;
const ZEILE = /^(\s*[-*]\s+\[)([ xX])(\]\s+)(.+?)\s*$/;

const tagIn = (ms: number) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });

export function zieleLesen(text: string) {
  const aus: { text: string; erledigt: boolean; zeile: number }[] = [];
  text.split(/\r?\n/).forEach((z, i) => {
    const m = ZEILE.exec(z);
    if (m) aus.push({ text: m[4]!, erledigt: m[2] !== ' ', zeile: i });
  });
  return aus;
}

export class Wochenziele {
  constructor(private o: { uhr: Uhr; vault: VaultDienst; hub: LiveHub }) {}

  woche(versatzWochen = 0) {
    return kalenderwoche(tagVonJetzt(this.o.uhr.jetzt(), 7 * versatzWochen));
  }
  pfad(woche = this.woche()) {
    return `${ZIELE_ORDNER}/${woche}.md`;
  }

  async lesen(woche = this.woche()): Promise<WochenzieleAntwort & { version?: string; inhalt?: string }> {
    const d = await this.o.vault.lesen(this.pfad(woche)).catch(() => null);
    return { woche, pfad: this.pfad(woche), ziele: d ? zieleLesen(d.inhalt).map(({ text, erledigt }) => ({ text, erledigt })) : [], ...(d ? { version: d.version, inhalt: d.inhalt } : {}) };
  }

  /** Antwort für App/Telegram: diese Woche + Bilanz der letzten */
  async stand() {
    const jetzt = await this.lesen();
    const letzte = await this.lesen(this.woche(-1));
    const naechste = await this.lesen(this.woche(1));
    return { woche: jetzt.woche, pfad: jetzt.pfad, ziele: jetzt.ziele, letzte: { woche: letzte.woche, ziele: letzte.ziele }, naechste: { woche: naechste.woche, ziele: naechste.ziele } };
  }

  private async aendern(f: (zeilen: string[], ziele: ReturnType<typeof zieleLesen>) => void, woche = this.woche()) {
    const a = await this.lesen(woche);
    const zeilen = a.inhalt ? a.inhalt.split(/\r?\n/) : [`# Wochenziele ${a.woche.replace('-KW', ' · KW ')}`, ''];
    f(zeilen, zieleLesen(zeilen.join('\n')));
    const neu = zeilen.join('\n').replace(/\n*$/, '\n');
    const r = await this.o.vault.schreiben(a.pfad, neu, a.version ? { basisVersion: a.version } : { nurNeu: true });
    if (r.konflikt) throw new DorfFehler(409, 'Die Wochenziele wurden gerade woanders geändert – bitte neu laden.');
    this.o.hub.senden({ typ: 'todos.geaendert', liste: 'wochenziele' });
    return this.stand();
  }

  /** versatzWochen: 1 = nächste Woche (Vorschläge aus dem Wochenrückblick am Sonntag) */
  hinzufuegen(textRoh: string, versatzWochen = 0) {
    const text = textRoh.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!text) throw new DorfFehler(400, 'Das Ziel ist leer.');
    return this.aendern((zeilen, ziele) => {
      if (ziele.length >= MAX_ZIELE) throw new DorfFehler(409, `Höchstens ${MAX_ZIELE} Ziele pro Woche – weniger ist mehr.`);
      if (ziele.some((z) => z.text.toLowerCase() === text.toLowerCase())) throw new DorfFehler(409, 'Dieses Ziel steht schon drauf.');
      const nach = ziele.length ? ziele.at(-1)!.zeile + 1 : zeilen.length - (zeilen.at(-1) === '' ? 1 : 0);
      zeilen.splice(nach, 0, `- [ ] ${text}`);
    }, this.woche(versatzWochen));
  }

  /** text: was die App/der Knopf angezeigt hat – passt er nicht mehr zur Nummer, lieber 409 als das falsche Ziel (Review) */
  haken(nr: number, erledigt: boolean, text?: string) {
    return this.aendern((zeilen, ziele) => {
      const z = ziele[nr];
      if (!z) throw new DorfFehler(404, 'Dieses Ziel gibt es nicht (mehr).');
      if (text != null && z.text !== text) throw new DorfFehler(409, 'Die Wochenziele wurden inzwischen geändert – bitte neu laden.');
      zeilen[z.zeile] = zeilen[z.zeile]!.replace(ZEILE, (_, a: string, _b: string, c: string, t: string) => `${a}${erledigt ? 'x' : ' '}${c}${t}`);
    });
  }

  entfernen(nr: number, text?: string) {
    return this.aendern((zeilen, ziele) => {
      const z = ziele[nr];
      if (!z) throw new DorfFehler(404, 'Dieses Ziel gibt es nicht (mehr).');
      if (text != null && z.text !== text) throw new DorfFehler(409, 'Die Wochenziele wurden inzwischen geändert – bitte neu laden.');
      zeilen.splice(z.zeile, 1);
    });
  }

  /** Morgenzeitung: die offenen Ziele der Woche (oder ein Anstoß am Montag) */
  async zeitungsZeilen(): Promise<string[]> {
    const s = await this.lesen();
    if (!s.ziele.length) {
      const wt = new Date(`${tagIn(this.o.uhr.jetzt())}T12:00:00Z`).getUTCDay();
      return wt === 1 ? ['Noch keine Wochenziele – welche 3 Dinge sollen diese Woche fertig werden? (App „Heute“ oder /ziel in Telegram)'] : [];
    }
    const fertig = s.ziele.filter((z) => z.erledigt).length;
    return [`${fertig}/${s.ziele.length} erreicht · offen: ${s.ziele.filter((z) => !z.erledigt).map((z) => z.text).join('; ') || '– alles erledigt 🎉'}`];
  }

  /** Wochenrückblick (sonntags): Bilanz dieser Woche */
  async rueckblickZeilen(): Promise<string[]> {
    const s = await this.lesen();
    if (!s.ziele.length) return ['Diese Woche ohne Wochenziele – nächste Woche 3 festlegen?'];
    return [`**${s.ziele.filter((z) => z.erledigt).length}/${s.ziele.length}** erreicht`, ...s.ziele.map((z) => `${z.erledigt ? '✓' : '✗'} ${z.text}`)];
  }
}
