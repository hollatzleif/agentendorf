// E249: Diagnose im laufenden Kryptowerk – CPU-Profil über den eingebauten Inspector (in-process, kein offener Port, kein Netz).
// Aufruf nur über GET /diagnose (Bearer wie alle Routen); liefert eine Text-Übersicht der Funktionen mit der meisten Eigenzeit.
import { Session } from 'node:inspector';

interface ProfilKnoten {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  hitCount?: number;
  children?: number[];
}
interface Profil {
  nodes: ProfilKnoten[];
  startTime: number;
  endTime: number;
  samples?: number[];
  timeDeltas?: number[];
}

function post<T>(s: Session, methode: string, params?: object): Promise<T> {
  return new Promise((ok, fehler) => s.post(methode, params ?? {}, (e, r) => (e ? fehler(e) : ok(r as T))));
}

/** CPU-Profil über `ms` Millisekunden; Eigenzeit je Funktion (und je Datei), die teuersten zuerst */
export async function cpuProfil(ms: number, oben = 40): Promise<string> {
  const s = new Session();
  s.connect();
  try {
    await post(s, 'Profiler.enable');
    await post(s, 'Profiler.setSamplingInterval', { interval: 1000 });
    await post(s, 'Profiler.start');
    await new Promise((r) => setTimeout(r, ms));
    const { profile } = await post<{ profile: Profil }>(s, 'Profiler.stop');
    return auswerten(profile, oben);
  } finally {
    s.disconnect();
  }
}

export function auswerten(p: Profil, oben = 40): string {
  // Eigenzeit je Knoten aus samples/timeDeltas (genauer als hitCount × Intervall)
  const zeit = new Map<number, number>();
  const samples = p.samples ?? [];
  const deltas = p.timeDeltas ?? [];
  for (let i = 0; i < samples.length; i++) zeit.set(samples[i]!, (zeit.get(samples[i]!) ?? 0) + (deltas[i + 1] ?? deltas[i] ?? 0));
  const gesamt = (p.endTime - p.startTime) / 1000;
  const jeFunktion = new Map<string, number>();
  const jeDatei = new Map<string, number>();
  let leerlauf = 0;
  for (const n of p.nodes) {
    const t = (zeit.get(n.id) ?? 0) / 1000;
    if (!t) continue;
    const f = n.callFrame;
    if (f.functionName === '(idle)') {
      leerlauf += t;
      continue;
    }
    const datei = f.url ? f.url.replace(/^.*\//, '') : '(intern)';
    const name = `${f.functionName || '(anonym)'} ${datei}:${f.lineNumber + 1}`;
    jeFunktion.set(name, (jeFunktion.get(name) ?? 0) + t);
    jeDatei.set(datei, (jeDatei.get(datei) ?? 0) + t);
  }
  const zeile = ([k, v]: [string, number]) => `${v.toFixed(0).padStart(7)} ms  ${((v / gesamt) * 100).toFixed(1).padStart(5)} %  ${k}`;
  return [
    `Profil über ${(gesamt / 1000).toFixed(1).replace(".", ",")} s – Leerlauf ${((leerlauf / gesamt) * 100).toFixed(0)} %`,
    '',
    'Eigenzeit je Funktion:',
    ...[...jeFunktion].sort((a, b) => b[1] - a[1]).slice(0, oben).map(zeile),
    '',
    'Eigenzeit je Datei:',
    ...[...jeDatei].sort((a, b) => b[1] - a[1]).slice(0, 12).map(zeile),
  ].join('\n');
}
