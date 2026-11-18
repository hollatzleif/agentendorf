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
  const h = u.hostname.toLowerCase();
  // nur https – unverschlüsseltes http nur für die eigene Maschine (Tests)
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && istLokal(h))) return false;
  return hosts.some((e) => {
    const x = e.trim().toLowerCase();
    return !!x && (h === x || h.endsWith(`.${x}`));
  });
}

export const istLokal = (h: string) => h === 'localhost' || /^127\.\d+\.\d+\.\d+$/.test(h);

const OHNE_NETZ = /^(data|blob|about):/i;

/** Kommt „sesskey“ irgendwo in der Abfrage vor (auch verschleiert: %73esskey, „ sesskey“, „sesskey\0x“)? */
function mitSesskey(u: URL) {
  let q = u.search;
  try {
    q = decodeURIComponent(q.replace(/\+/g, ' '));
  } catch {
    /* roh prüfen */
  }
  return /sesskey/i.test(q);
}
const LESEND = new Set(['get', 'fetch', 'search', 'list', 'view', 'load', 'count', 'check', 'is', 'has', 'can', 'read', 'info']);
const SCHREIBEND = new Set(
  'submit save update delete remove create add post send set start process lock unlock revert copy duplicate upload grade reset toggle mark enrol unenrol accept decline attempt edit move write change request block unblock favourite star hide show mute unmute touch logout confirm complete answer vote rate import export'.split(' '),
);

// Moodle-Funktionsnamen beginnen mit der Komponente („Frankenstyle“): core_<Teilsystem>_… oder <Plugin-Typ>_<Plugin>_….
// Die Komponente ist kein Verb – „block_recentlyaccesseditems_get_recent_items“ liest, obwohl „block“ vorkommt.
const PLUGIN_TYPEN = new Set(
  'mod block tool local theme format report gradereport gradeimport gradeexport qtype qbank qbehaviour enrol auth filter message availability assignsubmission assignfeedback quizaccess atto tiny editor dataformat repository portfolio ltisource booktool logstore media plagiarism search customfield paygw aiprovider aiplacement profilefield datafield workshopform mlbackend contenttype fileconverter antivirus communication smsgateway'.split(' '),
);
const TEILSYSTEME = new Set(
  'course user enrol message calendar block completion grades grading files group notes rating comment competency tag badges question cohort role webservice output session navigation courseformat reportbuilder h5p contentbank customfield table form analytics backup blog favourites filters reminders moodlenet payment xapi'.split(' '),
);
function ohneKomponente(teile: string[]) {
  if (teile[0] === 'core') return teile.slice(TEILSYSTEME.has(teile[1] ?? '') ? 2 : 1);
  if (PLUGIN_TYPEN.has(teile[0] ?? '')) return teile.slice(2);
  return teile;
}

/**
 * Moodle-Ajax-Funktion, die nur liest? Geprüft werden ganze Wortteile (a_b_c) NACH der Komponente, nicht Teilzeichenfolgen.
 * Ein lesendes Wort muss vorkommen, kein schreibendes – im Zweifel gesperrt.
 */
export function nurLesend(methodname: string): boolean {
  // Moodle säubert Namen (PARAM_ALPHANUMEXT) – „mar k_all“ würde dort zu „mark_all“. Alles Ungewöhnliche: gesperrt.
  if (!/^[A-Za-z0-9_]{3,120}$/.test(methodname)) return false;
  const teile = ohneKomponente(methodname.toLowerCase().split('_'));
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
    if (mitSesskey(u)) return { ok: false, grund: 'Moodle-Aktion (sesskey) ist gesperrt' };
    // Ajax-Dienst per GET (Moodle erlaubt dort Aufrufe über ?args=…) – nicht prüfbar, also gesperrt
    if (/\/lib\/ajax\//i.test(u.pathname)) return { ok: false, grund: 'Ajax-Aufruf per GET ist gesperrt' };
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
