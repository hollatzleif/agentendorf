import type { TodoInfo } from '@dorf/shared';
import type { Uhr } from './uhr.js';
import type { TodoDienst } from './todos.js';
import { ortszeitZuUtc } from './uni/ical.js';
import { tagVonJetzt } from './zeit.js';

/**
 * Erinnerungen an To-dos (E94): Ein To-do mit `erinnerung: JJJJ-MM-TTTHH:MM` (Ortszeit Wien) läutet zur Zeit
 * im Kirchturm (Programm: Glocke + Systemmeldung, App: Hinweis) und schickt eine Telegram-Nachricht mit
 * „Erledigt“, „+1 h“ und „Morgen 9:00“. Jeder Zeitpunkt läutet genau einmal (Vermerk `erinnert`);
 * wer verschiebt, setzt einen neuen Zeitpunkt. Was mehr als 12 h verpasst wurde (Server aus), läutet nicht mehr.
 */
const ZONE = 'Europe/Vienna';
const VERPASST_HOECHSTENS = 12 * 3_600_000;

export const zeitpunktMs = (z: string) => {
  const [d, t] = z.split('T') as [string, string];
  const [j, mo, ta] = d.split('-').map(Number) as [number, number, number];
  const [h, mi] = t.split(':').map(Number) as [number, number];
  return ortszeitZuUtc(j, mo, ta, h, mi, 0, ZONE);
};
export const zeitpunktAus = (ms: number) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};

export class TodoErinnerungen {
  /** Telegram u. a. – bekommt das To-do, dessen Zeit gekommen ist */
  readonly beiErinnerung: ((t: TodoInfo) => Promise<unknown> | void)[] = [];
  private laeuft = false;
  private takt?: NodeJS.Timeout;

  /** E106: Gewohnheit mit Uhrzeit ist dran (Telegram schickt den Abhak-Knopf) */
  readonly beiGewohnheit: ((name: string) => Promise<unknown> | void)[] = [];

  constructor(private o: { todos: TodoDienst; /** Review: auch Einkauf, Wunsch, Corps – erinnerung gibt es in jeder Liste */ weitereListen?: TodoDienst[]; uhr: Uhr; gewohnheiten?: { faelligeErinnerungen(): Promise<{ name: string; symbol: string; uhrzeit?: string }[]>; stand(): Promise<{ gewohnheiten: { name: string; heuteErledigt: boolean }[] }> }; kirchturm?: { erinnern(e: { bezugId: string; titel: string; text: string; schlummern?: boolean }): void; erinnerungAus(bezugId: string): void }; log?: (t: string) => void }) {}

  private dienste() {
    return [this.o.todos, ...(this.o.weitereListen ?? []).filter((x) => x !== this.o.todos)];
  }

  starten() {
    this.takt = setInterval(() => void this.pruefen().catch((e) => this.o.log?.(`Erinnerungen: ${(e as Error).message}`)), 30_000);
    this.takt.unref();
  }
  stoppen() {
    if (this.takt) clearInterval(this.takt);
  }

  async pruefen() {
    if (this.laeuft) return 0;
    this.laeuft = true;
    try {
      const jetzt = this.o.uhr.jetzt();
      let n = 0;
      for (const dienst of this.dienste()) for (const t of await dienst.liste()) {
        if (t.erledigt && t.erinnerung) this.o.kirchturm?.erinnerungAus(t.pfad);
        if (t.erledigt || !t.erinnerung || t.erinnert === t.erinnerung) continue;
        const ms = zeitpunktMs(t.erinnerung);
        if (ms > jetzt) continue;
        // erst vermerken, dann läuten – lieber einmal zu wenig als jede halbe Minute
        await dienst.erinnertMarkieren(t.pfad, t.erinnerung);
        if (jetzt - ms > VERPASST_HOECHSTENS) continue;
        n++;
        const uhrzeit = t.erinnerung.slice(11);
        this.o.kirchturm?.erinnern({ bezugId: t.pfad, titel: t.titel, text: `Erinnerung für ${uhrzeit} Uhr${t.faellig ? ` · fällig ${t.faellig}` : ''}` });
        for (const fn of this.beiErinnerung) await Promise.resolve(fn(t)).catch((e) => this.o.log?.(`Erinnerung senden: ${(e as Error).message}`));
      }
      if (this.o.gewohnheiten && this.o.kirchturm)
        for (const g of (await this.o.gewohnheiten.stand()).gewohnheiten) if (g.heuteErledigt) this.o.kirchturm.erinnerungAus(`gewohnheit:${g.name}`);
      for (const g of (await this.o.gewohnheiten?.faelligeErinnerungen()) ?? []) {
        n++;
        this.o.kirchturm?.erinnern({ bezugId: `gewohnheit:${g.name}`, titel: `${g.symbol} ${g.name}`, text: `Gewohnheit für ${g.uhrzeit} Uhr – noch nicht abgehakt.`, schlummern: false });
        for (const fn of this.beiGewohnheit) await Promise.resolve(fn(g.name)).catch((e) => this.o.log?.(`Gewohnheit melden: ${(e as Error).message}`));
      }
      return n;
    } finally {
      this.laeuft = false;
    }
  }

  /** Später erinnern: +minuten ab jetzt, oder zu einem festen Zeitpunkt */
  async verschieben(pfad: string, ziel: { minuten: number } | { zeitpunkt: string }) {
    const zp = 'zeitpunkt' in ziel ? ziel.zeitpunkt : zeitpunktAus(this.o.uhr.jetzt() + ziel.minuten * 60_000);
    this.o.kirchturm?.erinnerungAus(pfad);
    const dienst = this.dienste().find((x) => pfad.startsWith(`${x.ordner}/`)) ?? this.o.todos;
    return dienst.aendern(pfad, { erinnerung: zp });
  }

  /** Morgen 9:00 (Ortszeit) */
  morgenFrueh() {
    return `${tagVonJetzt(this.o.uhr.jetzt(), 1)}T09:00`;
  }
}
