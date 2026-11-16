import type { DB } from '../db.js';
import type { VaultDienst } from '../vault/dienst.js';
import { dateiStempel, dauerText, kurztitel, lokaleZeit, zusammenfassungAus } from './hilfen.js';

interface LaufZeile {
  id: string;
  chat_id: string;
  nummer: number;
  motor: string;
  modell: string;
  stufe: string;
  status: string;
  ausloeser: string;
  auftrag: string;
  start: number | null;
  ende: number | null;
  ein_token: number;
  aus_token: number;
  cache_lesen: number;
  cache_schreiben: number;
  kosten_usd: number;
  fehler: string | null;
}
interface ChatZeile {
  id: string;
  gebaeude: string;
  aktion: string | null;
  titel: string;
  erstellt: number;
  protokoll_pfad: string | null;
  spiegel_pfad: string | null;
  spiegel_version: string | null;
}

/**
 * Stadtarchiv: ein Protokoll pro Chat (<Gebäude>/protokolle/), jeder Lauf hängt einen Abschnitt an.
 * Die Fakten (Motor, Modell, Token, Dateien) stammen aus der Datenbank und dem Werkzeug-Log – nicht vom Agenten.
 * Nur die Zusammenfassung schreibt der Agent selbst.
 */
export async function protokollSchreiben(db: DB, vault: VaultDienst, laufId: string, letzteAntwort: string) {
  const l = db.prepare('SELECT * FROM laeufe WHERE id = ?').get(laufId) as LaufZeile;
  const c = db.prepare('SELECT * FROM chats WHERE id = ?').get(l.chat_id) as ChatZeile;
  const pfad = c.protokoll_pfad ?? `${c.gebaeude}/protokolle/${dateiStempel(c.erstellt)}_${kurztitel(c.titel)}.md`;

  const log = db
    .prepare('SELECT werkzeug, pfad, art, erlaubt, ergebnis FROM werkzeug_log WHERE lauf_id = ? ORDER BY id')
    .all(laufId) as { werkzeug: string; pfad: string | null; art: string | null; erlaubt: number; ergebnis: string }[];
  const liste = (art: string) => [...new Set(log.filter((x) => x.art === art && x.erlaubt && x.pfad).map((x) => x.pfad!))];
  const gelesen = liste('gelesen');
  const geschrieben = liste('geschrieben');
  const freigaben = log.filter((x) => x.art === 'freigabe').map((x) => x.ergebnis);
  const verweigert = log.filter((x) => !x.erlaubt).map((x) => `${x.werkzeug}${x.pfad ? ` ${x.pfad}` : ''}: ${x.ergebnis}`);
  const web = log.filter((x) => x.art === 'web').length;
  const zus = zusammenfassungAus(letzteAntwort);
  const wikilink = (p: string) => `[[${p.replace(/\.md$/, '')}]]`;

  const abschnitt = `
## Lauf ${l.nummer} – ${l.start ? lokaleZeit(l.start) : '–'}

| | |
|---|---|
| Status | ${l.status}${l.fehler ? ` (${l.fehler.replace(/\|/g, '/').slice(0, 200)})` : ''} |
| Auslöser | ${l.ausloeser} |
| Motor / Modell | ${l.motor} / ${l.modell} (Stufe ${l.stufe}) |
| Token | ein ${l.ein_token}, aus ${l.aus_token}, Cache gelesen ${l.cache_lesen}, Cache geschrieben ${l.cache_schreiben} |
| Dauer | ${l.start && l.ende ? dauerText(l.ende - l.start) : '–'} |

**Auftrag:** ${l.auftrag.split('\n')[0]!.slice(0, 300)}

**Gelesen:** ${gelesen.length ? gelesen.map(wikilink).join(', ') : '–'}
**Geschrieben:** ${geschrieben.length ? geschrieben.map(wikilink).join(', ') : '–'}
**Freigaben beantragt:** ${freigaben.length ? freigaben.join('; ') : '–'}${web ? `\n**Web-Zugriffe:** ${web}` : ''}${verweigert.length ? `\n**Von der Leine verweigert:** ${verweigert.join('; ')}` : ''}

### Zusammenfassung des Agenten
${zus ?? (l.status === 'fertig' ? '*Der Agent hat keine Zusammenfassung geliefert.*' : '*Lauf nicht regulär beendet.*')}
`;

  const alt = await vault.lesen(pfad).catch(() => null);
  const kopf = `---
titel: ${JSON.stringify(`Protokoll: ${c.titel}`)}
gebaeude: ${c.gebaeude}
aktion: ${c.aktion ?? '–'}
chat: ${c.id}
erstellt: ${new Date(c.erstellt).toISOString()}
---

# Protokoll: ${c.titel}
${c.spiegel_pfad ? `\nChat: ${wikilink(c.spiegel_pfad)}\n` : ''}`;
  const inhalt = alt ? `${alt.inhalt.trimEnd()}\n${abschnitt}` : `${kopf}${abschnitt}`;
  const r = await vault.schreiben(pfad, inhalt, { basisVersion: alt?.version });
  if (!c.protokoll_pfad) db.prepare('UPDATE chats SET protokoll_pfad = ? WHERE id = ?').run(pfad, c.id);
  db.prepare('UPDATE laeufe SET zusammenfassung = ? WHERE id = ?').run(zus, laufId);
  return r.pfad;
}

/** Chat als Markdown in <Gebäude>/chats/ – wird nach jedem Lauf neu geschrieben (Konfliktkopie, falls Leif die Datei geändert hat). */
export async function chatSpiegeln(db: DB, vault: VaultDienst, chatId: string) {
  const c = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId) as ChatZeile & { motor: string; modell: string };
  const pfad = c.spiegel_pfad ?? `${c.gebaeude}/chats/${dateiStempel(c.erstellt)}_${kurztitel(c.titel)}.md`;
  const n = db.prepare("SELECT rolle, text, erstellt FROM nachrichten WHERE chat_id = ? AND rolle != 'werkzeug' ORDER BY id").all(chatId) as {
    rolle: string;
    text: string;
    erstellt: number;
  }[];
  const rolle = (r: string) => (r === 'nutzer' ? '🧑 Leif' : r === 'agent' ? '🤖 Agent' : 'ℹ️ Hinweis');
  const text = `---
titel: ${JSON.stringify(c.titel)}
gebaeude: ${c.gebaeude}
aktion: ${c.aktion ?? '–'}
motor: ${c.motor}
modell: ${c.modell}
chat: ${c.id}
erstellt: ${new Date(c.erstellt).toISOString()}
---

# ${c.titel}

*Dieser Chat wird vom Dorf geschrieben. Fortsetzen in der App.*
${c.protokoll_pfad ? `Protokoll: [[${c.protokoll_pfad.replace(/\.md$/, '')}]]\n` : ''}
${n.map((x) => `### ${rolle(x.rolle)} · ${lokaleZeit(x.erstellt)}\n\n${x.text}\n`).join('\n')}`;
  const r = await vault.schreiben(pfad, text, { basisVersion: c.spiegel_version ?? undefined });
  db.prepare('UPDATE chats SET spiegel_pfad = ?, spiegel_version = ? WHERE id = ?').run(pfad, r.konflikt ? c.spiegel_version : r.version, chatId);
  return pfad;
}
