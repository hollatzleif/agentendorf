/**
 * Die Leine des Moodle-Browsers: Welche Anfragen der Browser überhaupt stellen darf. Sitzt im Runner (nicht im Modell),
 * jede Anfrage der Seite läuft hier durch (page.route). Grundsatz: lesen ja, verändern nein.
 *
 * - nur Domains aus der Liste (Standard: jku.at und Unterdomains) – alles andere wird abgebrochen
 * - GET/HEAD erlaubt, außer Abmelden und Links mit sesskey (Moodle-Aktionen wie „als erledigt markieren“)
 * - POST nur (a) während der Anmeldung oder (b) an Moodles Ajax-Dienst, wenn ALLE aufgerufenen Funktionen nur lesen
 * - alles andere (Formulare: Abgaben, Forenbeiträge, Tests starten, Einstellungen) wird blockiert
 */

export type Pruefung = { ok: true } | { ok: false; grund: string };

/** Host passt zur Liste (exakt oder Unterdomain); Liste z. B. ['jku.at'] oder ['127.0.0.1'] */
export function hostErlaubt(url: string, hosts: string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const h = u.hostname.toLowerCase();
  return hosts.some((e) => {
    const x = e.trim().toLowerCase();
    return !!x && (h === x || h.endsWith(`.${x}`));
  });
}

const OHNE_NETZ = /^(data|blob|about):/i;
const LESEND = new Set(['get', 'fetch', 'search', 'list', 'view', 'load', 'count', 'check', 'is', 'has', 'can', 'read', 'info']);
const SCHREIBEND = new Set(
  'submit save update delete remove create add post send set start process lock unlock revert copy duplicate upload grade reset toggle mark enrol unenrol accept decline attempt edit move write change request block unblock favourite star hide show mute unmute touch logout confirm complete answer vote rate import export'.split(' '),
);

/** Moodle-Ajax-Funktion, die nur liest? Geprüft werden ganze Wortteile (a_b_c), nicht Teilzeichenfolgen. */
export function nurLesend(methodname: string): boolean {
  const teile = methodname.toLowerCase().split('_');
  return teile.some((t) => LESEND.has(t)) && !teile.some((t) => SCHREIBEND.has(t));
}

/**
 * anmeldung = gerade läuft die Anmeldung; navigation = die Anfrage lädt eine ganze Seite (Formular absenden),
 * kein Skript-Aufruf. Während der Anmeldung ist POST nur als Seitennavigation erlaubt – also das Absenden des
 * Anmeldeformulars, nicht die Ajax-Aufrufe der Seite, die direkt danach lädt.
 */
export function anfragePruefen(a: { methode: string; url: string; daten?: string | null; anmeldung: boolean; navigation?: boolean }, hosts: string[]): Pruefung {
  if (OHNE_NETZ.test(a.url)) return { ok: true };
  if (!hostErlaubt(a.url, hosts)) {
    let host = a.url;
    try {
      host = new URL(a.url).hostname;
    } catch {
      /* bleibt */
    }
    return { ok: false, grund: `fremde Domain ${host}` };
  }
  const u = new URL(a.url);
  const methode = a.methode.toUpperCase();
  if (/\/login\/logout\.php$/i.test(u.pathname)) return { ok: false, grund: 'Abmelden ist gesperrt' };
  if (methode === 'GET' || methode === 'HEAD') {
    if (u.searchParams.has('sesskey') && !a.anmeldung) return { ok: false, grund: 'Moodle-Aktion (sesskey) ist gesperrt' };
    return { ok: true };
  }
  if (methode !== 'POST') return { ok: false, grund: `${methode} ist gesperrt` };
  if (a.anmeldung && a.navigation && !/\/lib\/ajax\//i.test(u.pathname)) return { ok: true };
  if (/\/lib\/ajax\/service(-nologin)?\.php$/i.test(u.pathname)) {
    let aufrufe: unknown;
    try {
      aufrufe = JSON.parse(a.daten ?? '');
    } catch {
      return { ok: false, grund: 'Ajax-Aufruf nicht lesbar' };
    }
    if (!Array.isArray(aufrufe) || !aufrufe.length) return { ok: false, grund: 'Ajax-Aufruf nicht lesbar' };
    for (const x of aufrufe) {
      const name = typeof x === 'object' && x && 'methodname' in x ? String((x as { methodname: unknown }).methodname) : '';
      if (!nurLesend(name)) return { ok: false, grund: `Moodle-Funktion ${name || '(unbekannt)'} verändert etwas – gesperrt` };
    }
    return { ok: true };
  }
  return { ok: false, grund: 'Formular senden ist gesperrt (der Browser liest nur)' };
}
