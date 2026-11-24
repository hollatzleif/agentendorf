// E227: Zahlen im Hafen
export const sol = (n: number | null | undefined, stellen = 3) => (n == null || !Number.isFinite(n) ? '–' : `${n.toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen })} SOL`);
export const solVz = (n: number | null | undefined, stellen = 3) => (n == null || !Number.isFinite(n) ? '–' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen })}`);
export const usd = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '–' : `$${n.toLocaleString('de-DE', { maximumFractionDigits: n >= 100 ? 0 : 2 })}`);
export const usdKurz = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 })}M` : n >= 1000 ? `$${(n / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })}k` : `$${Math.round(n)}`);
export const prozent = (n: number | null | undefined, stellen = 1) => (n == null || !Number.isFinite(n) ? '–' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toLocaleString('de-DE', { maximumFractionDigits: stellen })} %`);
export const uhrzeit = (ms: number, sekunden = false) => new Date(ms).toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit', ...(sekunden ? { second: '2-digit' } : {}) });
export const stundeWien = (ms: number) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vienna', hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms)));
/** Farbe aus einem Text (Token-Icon) */
export function farbeAus(text: string) {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 65% 45%)`;
}
