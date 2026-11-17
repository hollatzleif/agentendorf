import { ohneToken } from './moodle.js';

const ENTITAETEN: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', ndash: '–', mdash: '—', hellip: '…', euro: '€' };

export function entitaetenDekodieren(t: string) {
  return t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (g, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : g;
    }
    return ENTITAETEN[e] ?? g;
  });
}

/**
 * Macht aus Moodle-HTML (Aufgabenbeschreibung) schlichtes Markdown.
 * Bewusst einfach: Absätze, Listen, Überschriften, Links. Skripte/Styles fallen weg, Tokens werden aus Links entfernt.
 */
export function htmlZuMarkdown(html: string): string {
  let t = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  t = t.replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_g, href: string, text: string) => {
    const innen = text.replace(/<[^>]+>/g, '').trim();
    const ziel = ohneToken(entitaetenDekodieren(href));
    return /^https?:\/\//.test(ziel) ? `[${innen || ziel}](${ziel.replace(/\)/g, '%29')})` : innen;
  });
  t = t.replace(/<img\s[^>]*alt="([^"]*)"[^>]*>/gi, (_g, alt: string) => `[Bild${alt ? `: ${alt}` : ''}]`).replace(/<img[^>]*>/gi, '[Bild]');
  t = t.replace(/<h([1-6])[^>]*>/gi, (_g, n: string) => `\n\n${'#'.repeat(Math.min(6, Number(n) + 2))} `).replace(/<\/h[1-6]>/gi, '\n\n');
  t = t.replace(/<li[^>]*>/gi, '\n- ').replace(/<\/(ul|ol)>/gi, '\n\n');
  t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|table|blockquote)>/gi, '\n\n');
  t = t.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**').replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '*$2*');
  t = t.replace(/<[^>]+>/g, '');
  t = entitaetenDekodieren(t);
  return t
    .split('\n')
    .map((z) => z.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const FORMAT = new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
/** „Fr., 21.11.2026, 23:59“ – Linzer Zeit */
export function fristText(ms: number | null) {
  return ms == null ? 'ohne Frist' : FORMAT.format(new Date(ms));
}
