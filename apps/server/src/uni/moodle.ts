import crypto from 'node:crypto';

/** Schnittstelle zum Moodle-Webservice (REST, Token wie die Moodle-App). */
export interface MoodleKlient {
  basis: string;
  aufruf<T>(funktion: string, params?: Record<string, unknown>): Promise<T>;
  /** Lädt eine Datei (fileurl aus Moodle). Nur URLs der eigenen Moodle-Instanz – das Token geht nie woandershin. */
  dateiLaden(fileurl: string, maxBytes: number): Promise<Buffer>;
}

export class MoodleFehler extends Error {
  constructor(
    public funktion: string,
    public code: string,
    meldung: string,
  ) {
    super(`Moodle ${funktion}: ${meldung} (${code})`);
  }
}

/** Moodle erwartet verschachtelte Parameter als form-Felder: courseids[0]=1, options[0][name]=x */
export function formFelder(params: Record<string, unknown>, praefix = '', aus = new URLSearchParams()) {
  for (const [k, w] of Object.entries(params)) {
    const name = praefix ? `${praefix}[${k}]` : k;
    if (w === undefined || w === null) continue;
    if (typeof w === 'object') formFelder(w as Record<string, unknown>, name, aus);
    else aus.append(name, typeof w === 'boolean' ? (w ? '1' : '0') : String(w));
  }
  return aus;
}

/** Entfernt das Token aus einer URL (für alles, was in den Vault oder ins Log geht). */
export function ohneToken(url: string) {
  try {
    const u = new URL(url);
    u.searchParams.delete('token');
    u.searchParams.delete('wstoken');
    return u.toString();
  } catch {
    return url.replace(/([?&])(ws)?token=[^&]*/g, '$1').replace(/[?&]$/, '');
  }
}

export function moodleKlient(basis: string, token: string): MoodleKlient {
  const wurzel = basis.replace(/\/$/, '');
  return {
    basis: wurzel,
    async aufruf<T>(funktion: string, params: Record<string, unknown> = {}) {
      const body = formFelder({ wstoken: token, wsfunction: funktion, moodlewsrestformat: 'json', ...params });
      const r = await fetch(`${wurzel}/webservice/rest/server.php`, { method: 'POST', body, signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new MoodleFehler(funktion, `http_${r.status}`, `HTTP ${r.status}`);
      const j = (await r.json()) as T & { exception?: string; errorcode?: string; message?: string };
      if (j && typeof j === 'object' && 'exception' in j && j.exception) throw new MoodleFehler(funktion, j.errorcode ?? 'unbekannt', j.message ?? j.exception);
      return j;
    },
    async dateiLaden(fileurl: string, maxBytes: number) {
      const u = new URL(fileurl);
      if (u.origin !== new URL(wurzel).origin) throw new MoodleFehler('datei', 'fremde_adresse', `Datei liegt nicht auf ${wurzel} – nicht geladen`);
      // pluginfile.php → webservice/pluginfile.php (nur dort gilt das Token)
      if (u.pathname.includes('/pluginfile.php') && !u.pathname.includes('/webservice/pluginfile.php'))
        u.pathname = u.pathname.replace('/pluginfile.php', '/webservice/pluginfile.php');
      u.searchParams.set('token', token);
      const r = await fetch(u, { signal: AbortSignal.timeout(300_000) });
      if (!r.ok) throw new MoodleFehler('datei', `http_${r.status}`, `HTTP ${r.status}`);
      const laenge = Number(r.headers.get('content-length') ?? 0);
      if (laenge > maxBytes) throw new MoodleFehler('datei', 'zu_gross', `${Math.round(laenge / 1048576)} MB`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > maxBytes) throw new MoodleFehler('datei', 'zu_gross', `${Math.round(buf.length / 1048576)} MB`);
      // Moodle antwortet bei Fehlern manchmal mit JSON statt der Datei
      if (r.headers.get('content-type')?.includes('application/json') && buf.length < 2000 && buf.toString().includes('"error'))
        throw new MoodleFehler('datei', 'antwort', buf.toString().slice(0, 200));
      return buf;
    },
  };
}

/**
 * Token aus der Weiterleitung von launch.php: moodlemobile://token=BASE64(md5(wwwroot+passport):::token[:::privattoken]).
 * Die Signatur beweist, dass die Adresse zu genau diesem Anmeldevorgang gehört.
 */
export function tokenAusLaunch(adresse: string, wwwroot: string, passport: string): { token: string } {
  const m = /token=([A-Za-z0-9+/=_-]+)/.exec(adresse.trim());
  if (!m) throw new Error('In der Adresse steht kein token=… – bitte die vollständige moodlemobile://-Adresse einfügen.');
  const roh = Buffer.from(m[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const teile = roh.split(':::');
  if (teile.length < 2 || !teile[1]) throw new Error('Die Adresse enthält kein gültiges Token.');
  const erwartet = crypto.createHash('md5').update(wwwroot.replace(/\/$/, '') + passport).digest('hex');
  if (teile[0] !== erwartet) throw new Error('Signatur passt nicht: Die Adresse stammt nicht aus diesem Anmeldevorgang. Bitte den Vorgang neu starten.');
  if (!/^[a-zA-Z0-9]{16,64}$/.test(teile[1])) throw new Error('Das Token hat ein unerwartetes Format.');
  return { token: teile[1] };
}

/** Funktionen, die das Dorf braucht (die letzten beiden sind optional) */
export const PFLICHT_FUNKTIONEN = [
  'core_webservice_get_site_info',
  'core_course_get_enrolled_courses_by_timeline_classification',
  'core_course_get_contents',
  'mod_assign_get_assignments',
];
export const OPTIONALE_FUNKTIONEN = ['mod_assign_get_submission_status', 'core_calendar_get_action_events_by_timesort'];

export interface SiteInfo {
  sitename: string;
  userid: number;
  fullname: string;
  functions?: { name: string }[];
}

export async function verbindungPruefen(k: MoodleKlient) {
  const s = await k.aufruf<SiteInfo>('core_webservice_get_site_info');
  const vorhanden = new Set((s.functions ?? []).map((f) => f.name));
  // Ältere Moodles liefern die Liste nicht vollständig – dann nur prüfen, was wirklich fehlt, wenn eine Liste da ist.
  const fehlend = s.functions?.length ? PFLICHT_FUNKTIONEN.filter((f) => !vorhanden.has(f)) : [];
  const optionalFehlend = s.functions?.length ? OPTIONALE_FUNKTIONEN.filter((f) => !vorhanden.has(f)) : [];
  return { nutzer: s.fullname, seite: s.sitename, userid: s.userid, fehlend, optionalFehlend };
}
