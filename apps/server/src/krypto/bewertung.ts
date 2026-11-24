// E227: Prüfmodule, Bewertung nach Regeln und das Risk-Gate. Alles Code – ein LLM darf nur vorschlagen (bewerten
// liefert dann „buy“), ob gekauft wird, entscheiden Filter und Gate hier.
import type { KryptoEinstellung, KryptoModulSchluessel } from '@dorf/shared';
import { ANGEBOT, type Markt, kurveAusKurs, liquiditaetSol } from './kurve.js';
import type { RugBericht, Schnappschuss } from './quellen.js';

export interface TokenInfo {
  mint: string;
  symbol: string;
  name: string;
  erstellt: number;
  /** Token, die der Entwickler beim Start gekauft hat */
  devToken: number | null;
  creator: string | null;
  /** E234: wie viele ANDERE Tokens derselbe Ersteller in den 24 h davor gestartet hat (aus der eigenen Aufzeichnung) */
  devTokens24h?: number;
}

/** E234: Kaufdruck der letzten 60 s aus dem Echtzeit-Strom (Änderungen der Bonding Curve) */
export interface Echtzeit60 {
  kaeufe: number;
  verkaeufe: number;
  /** SOL rein minus raus */
  nettoSol: number;
}

export interface Signal {
  schluessel: KryptoModulSchluessel;
  /** true = harte Sperre (Filter) */
  sperre: boolean;
  /** Beitrag zur Punktzahl (0–100 gesamt) */
  punkte: number;
  ton: 'gut' | 'schlecht' | 'neutral';
  zeile: string;
}

export function marktAus(s: Schnappschuss): Markt | null {
  if (s.dex === 'pumpfun') return kurveAusKurs(s.preisSol);
  if (s.poolSol && s.poolToken && s.poolSol > 0 && s.poolToken > 0) return { art: 'pool', sol: s.poolSol, token: s.poolToken };
  return null;
}

const prozent = (n: number, d = 1) => `${n.toLocaleString('de-DE', { maximumFractionDigits: d })} %`;
const usd = (n: number) => `$${n >= 1000 ? `${(n / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })}k` : Math.round(n)}`;

/** Prüfmodule, die aus den Daten einer Beobachtung ein Signal machen (Rug, Dev, Bundle, Holder, Volumen, Sniper) */
export function pruefen(e: KryptoEinstellung, t: TokenInfo, s: Schnappschuss, rug: RugBericht | null, jetzt: number, echtzeit?: Echtzeit60 | null): Signal[] {
  const f = e.filter;
  const r: Signal[] = [];
  const gefahr = rug?.risiken.filter((x) => x.stufe === 'danger') ?? [];
  // Rug-Filter
  if (!rug) r.push({ schluessel: 'rug', sperre: true, punkte: 0, ton: 'neutral', zeile: 'warte auf RugCheck' });
  else {
    const score = rug.scoreNormiert ?? 100;
    const zuHoch = score > f.maxRugScore;
    const gefaehrlich = f.keineGefahr && gefahr.length > 0;
    r.push({ schluessel: 'rug', sperre: zuHoch || gefaehrlich, punkte: zuHoch || gefaehrlich ? 0 : 15, ton: zuHoch || gefaehrlich ? 'schlecht' : 'gut', zeile: `Score ${score}${gefahr.length ? ` · ${gefahr.length}× danger` : ''}${zuHoch ? ` > ${f.maxRugScore}` : ''}` });
  }
  // Dev-Check: Anteil des Entwicklers beim Start + RugCheck „Creator history“
  const devProzent = t.devToken != null ? (t.devToken / ANGEBOT) * 100 : null;
  const devHistorie = rug?.risiken.some((x) => /creator/i.test(x.name) && /rug/i.test(x.name)) ?? false;
  const devZuViel = devProzent != null && devProzent > f.maxDevProzent;
  // E234: Serien-Ersteller (viele Tokens in 24 h) – meist Rug-Fabriken
  const serie = t.devTokens24h != null && t.devTokens24h > (f.maxDevTokens24h ?? 3);
  const devSchlecht = devZuViel || devHistorie || serie;
  r.push({ schluessel: 'dev', sperre: devSchlecht, punkte: devSchlecht ? 0 : 10, ton: devSchlecht ? 'schlecht' : 'gut', zeile: `${devProzent == null ? 'Dev ?' : `Dev ${prozent(devProzent)}`}${t.devTokens24h ? ` · ${t.devTokens24h} Tokens/24h` : ''}${devHistorie ? ' · hat schon gerugged' : ''}` });
  // Bundle-Scan: RugCheck-Risiken zu Bundles/Insidern
  const bundle = rug?.risiken.filter((x) => /bundle|insider|sniper/i.test(x.name)) ?? [];
  r.push({ schluessel: 'bundle', sperre: bundle.some((x) => x.stufe === 'danger'), punkte: bundle.length ? 0 : 5, ton: bundle.length ? 'schlecht' : rug ? 'gut' : 'neutral', zeile: bundle.length ? bundle.map((x) => x.name).join(', ').slice(0, 40) : rug ? 'keine Bundles gemeldet' : '–' });
  // Holder-Map: größter Halter
  const einzel = rug?.risiken.find((x) => /single holder/i.test(x.name));
  const top = einzel ? Number.parseFloat(einzel.wert.replace(',', '.')) : null;
  const konzentriert = rug?.risiken.some((x) => /holder concentration|top 10/i.test(x.name)) ?? false;
  const topZuViel = top != null && Number.isFinite(top) && top > f.maxTopHalterProzent;
  r.push({ schluessel: 'holder', sperre: topZuViel, punkte: topZuViel ? 0 : konzentriert ? 3 : 10, ton: topZuViel ? 'schlecht' : konzentriert ? 'neutral' : 'gut', zeile: top != null && Number.isFinite(top) ? `Top-Halter ${prozent(top)}${konzentriert ? ' · Top 10 > 50 %' : ''}` : konzentriert ? 'Top 10 > 50 %' : 'verteilt' });
  // Volume-Flow
  const verhaeltnis = s.verkaeufeM5 > 0 ? s.kaeufeM5 / s.verkaeufeM5 : s.kaeufeM5 > 0 ? 9 : 0;
  // E234: Kaufdruck der letzten 60 s aus dem Strom (nur wenn ≥ 3 Trades gesehen – sonst keine Aussage, keine Sperre)
  const ez = echtzeit && echtzeit.kaeufe + echtzeit.verkaeufe >= 3 ? echtzeit : null;
  const ezVerhaeltnis = ez ? (ez.verkaeufe > 0 ? ez.kaeufe / ez.verkaeufe : 9) : null;
  const ezZuSchwach = ezVerhaeltnis != null && (f.minEchtzeitKaufVerhaeltnis ?? 0) > 0 && ezVerhaeltnis < (f.minEchtzeitKaufVerhaeltnis ?? 0);
  const volOk = s.volumenUsdM5 >= f.minVolumenUsdM5 && s.kaeufeM5 >= f.minKaeufeM5 && verhaeltnis >= f.minKaufVerhaeltnis && !ezZuSchwach;
  const ezPunkte = ez ? Math.max(-5, Math.min(10, ez.nettoSol * 2 + (ezVerhaeltnis! - 1) * 2)) : 0;
  const volPunkte = volOk ? Math.max(0, Math.min(30, 10 + Math.log10(Math.max(1, s.volumenUsdM5 / Math.max(1, f.minVolumenUsdM5))) * 10 + Math.min(10, (verhaeltnis - 1) * 5)) + ezPunkte) : 0;
  r.push({ schluessel: 'volumen', sperre: !volOk, punkte: Math.round(volPunkte), ton: volOk ? 'gut' : 'schlecht', zeile: `${usd(s.volumenUsdM5)}/5m · ${s.kaeufeM5}↑ ${s.verkaeufeM5}↓${ez ? ` · 60s ${ez.kaeufe}↑ ${ez.verkaeufe}↓ ${ez.nettoSol >= 0 ? '+' : ''}${ez.nettoSol.toFixed(2)} SOL` : ''}` });
  // Sniper = Einstiegsfenster: Alter, Marktwert, Liquidität, Schwung
  const alter = Math.round((jetzt - t.erstellt) / 1000);
  const mw = s.marktwertUsd ?? 0;
  const markt = marktAus(s);
  const liq = markt ? liquiditaetSol(markt) : 0;
  const imFenster = alter >= f.minAlterSek && alter <= f.maxAlterSek && mw >= f.minMarketCapUsd && mw <= f.maxMarketCapUsd && liq >= f.minLiquiditaetSol && !!markt;
  const schwung = s.aenderungM5 ?? 0;
  r.push({ schluessel: 'sniper', sperre: !imFenster, punkte: imFenster ? Math.round(Math.max(0, Math.min(30, 10 + schwung / 3))) : 0, ton: imFenster ? (schwung > 0 ? 'gut' : 'neutral') : 'schlecht', zeile: `${alter < 120 ? `${alter}s` : `${Math.round(alter / 60)}m`} · MC ${usd(mw)} · ${liq.toFixed(1)} SOL${schwung ? ` · ${schwung > 0 ? '+' : ''}${prozent(schwung, 0)}` : ''}` });
  return r;
}

/** Punkte aus den Signalen (0–100); null = gesperrt */
export function punkte(signale: Signal[]): number | null {
  if (signale.some((s) => s.sperre)) return null;
  return Math.min(100, signale.reduce((x, s) => x + s.punkte, 0));
}

export interface BotLage {
  kasseSol: number;
  offen: number;
  heuteSol: number;
  haeltSchon: boolean;
  notaus: boolean;
}

/** Positionsgröße: der kleinere Wert aus Einsatz je Trade und Prozent des freien Kapitals */
export function positionsGroesse(e: KryptoEinstellung, kasseSol: number) {
  return Math.max(0, Math.min(e.limits.einsatzProTradeSol, (kasseSol * e.limits.positionProzent) / 100));
}

/** Risk-Gate: darf gekauft werden? (Grund, wenn nicht) */
export function gate(e: KryptoEinstellung, l: BotLage, groesseSol: number): { erlaubt: boolean; grund: string } {
  if (l.notaus) return { erlaubt: false, grund: 'Not-Aus aktiv' };
  if (l.haeltSchon) return { erlaubt: false, grund: 'Token schon im Bestand' };
  if (l.offen >= e.limits.maxOffen) return { erlaubt: false, grund: `${l.offen}/${e.limits.maxOffen} Positionen offen` };
  if (l.heuteSol <= -e.limits.maxTagesverlustSol) return { erlaubt: false, grund: `Tagesverlust ${l.heuteSol.toFixed(3)} SOL erreicht` };
  if (groesseSol < 0.01) return { erlaubt: false, grund: 'zu wenig Kapital' };
  // Puffer für Netzgebühren
  if (groesseSol + 0.01 > l.kasseSol) return { erlaubt: false, grund: 'Kapital reicht nicht' };
  return { erlaubt: true, grund: `${groesseSol.toFixed(3)} SOL frei` };
}
