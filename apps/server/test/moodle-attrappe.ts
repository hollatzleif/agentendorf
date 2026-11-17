import http from 'node:http';
import type { AddressInfo } from 'node:net';

export const TOKEN = 'abcdef0123456789abcdef0123456789';

interface Datei {
  inhalt: Buffer;
  geaendert: number;
  groesse?: number; // abweichende gemeldete Größe (z. B. 200 MB, ohne sie zu liefern)
  kaputt?: boolean;
}

/** Nachgebauter Moodle-Server (REST + webservice/pluginfile.php), so wie die Moodle-App ihn sieht. */
export async function moodleAttrappe() {
  const s = {
    funktionen: [
      'core_webservice_get_site_info',
      'core_course_get_enrolled_courses_by_timeline_classification',
      'core_course_get_contents',
      'mod_assign_get_assignments',
      'mod_assign_get_submission_status',
      'core_calendar_get_action_events_by_timesort',
    ],
    kurse: [
      { id: 11, fullname: 'Computational Data Analytics', shortname: 'CDA', semester: 'inprogress' },
      { id: 12, fullname: 'Statistik / UE', shortname: 'STAT', semester: 'inprogress' },
      { id: 9, fullname: 'Altes Fach', shortname: 'ALT', semester: 'past' },
    ],
    dateien: new Map<string, Datei>(),
    abschnitte: {} as Record<number, unknown[]>,
    aufgaben: {} as Record<number, unknown[]>,
    abgegeben: new Set<number>(),
    ereignisse: [] as unknown[],
    aufrufe: [] as { funktion: string; params: Record<string, string> }[],
    downloads: [] as string[],
  };
  let basis = '';
  const datei = (pfad: string, d: Datei) => {
    s.dateien.set(pfad, d);
    return {
      type: 'file',
      filename: pfad.split('/').pop(),
      filepath: '/',
      filesize: d.groesse ?? d.inhalt.length,
      // So liefert Moodle die Adresse in Webservice-Antworten: ohne Token, mit forcedownload
      fileurl: `${basis}/webservice/pluginfile.php${encodeURI(pfad)}?forcedownload=1`,
      timemodified: d.geaendert,
    };
  };

  const server = http.createServer((req, res) => {
    const u = new URL(req.url!, basis);
    if (u.pathname.startsWith('/webservice/pluginfile.php')) {
      if (u.searchParams.get('token') !== TOKEN) return void res.writeHead(403).end('{"error":"invalidtoken"}');
      const pfad = decodeURIComponent(u.pathname.slice('/webservice/pluginfile.php'.length));
      const d = s.dateien.get(pfad);
      s.downloads.push(pfad);
      if (!d) return void res.writeHead(404).end();
      if (d.kaputt) return void res.writeHead(500).end();
      return void res.writeHead(200, { 'content-type': 'application/pdf' }).end(d.inhalt);
    }
    if (u.pathname !== '/webservice/rest/server.php' || req.method !== 'POST') return void res.writeHead(404).end();
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const p = Object.fromEntries(new URLSearchParams(body));
      const antwort = (j: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(j));
      if (p.wstoken !== TOKEN) return antwort({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token - token not found' });
      const f = p.wsfunction!;
      s.aufrufe.push({ funktion: f, params: p });
      if (!s.funktionen.includes(f)) return antwort({ exception: 'webservice_access_exception', errorcode: 'accessexception', message: 'Access control exception' });
      switch (f) {
        case 'core_webservice_get_site_info':
          return antwort({ sitename: 'JKU Moodle', userid: 7, fullname: 'Leif Test', functions: s.funktionen.map((name) => ({ name, version: '2024' })) });
        case 'core_course_get_enrolled_courses_by_timeline_classification':
          return antwort({ courses: s.kurse.filter((k) => k.semester === p.classification).map(({ semester: _s, ...k }) => k), nextoffset: 0 });
        case 'core_course_get_contents':
          return antwort(s.abschnitte[Number(p.courseid)] ?? []);
        case 'mod_assign_get_assignments': {
          const ids = Object.entries(p)
            .filter(([k]) => k.startsWith('courseids['))
            .map(([, v]) => Number(v));
          return antwort({ courses: ids.map((id) => ({ id, assignments: s.aufgaben[id] ?? [] })), warnings: [] });
        }
        case 'mod_assign_get_submission_status':
          return antwort({ lastattempt: { submission: { status: s.abgegeben.has(Number(p.assignid)) ? 'submitted' : 'new' } } });
        case 'core_calendar_get_action_events_by_timesort':
          return antwort({ events: s.ereignisse });
      }
      return antwort({ exception: 'x', errorcode: 'unbekannt', message: f });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  basis = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { s, basis, datei, schliessen: () => new Promise<void>((r) => server.close(() => r())) };
}
