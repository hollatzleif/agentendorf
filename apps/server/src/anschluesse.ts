import type { Anschluss } from '@dorf/shared';
import type { Konfig } from './konfig.js';

/**
 * Anschlüsse (E109): was ist verbunden, was fehlt – und mit welchem Befehl auf dem Server man es einrichtet.
 * Nur Ja/Nein und Hinweise, nie Geheimnisse oder Teile davon.
 */
export function anschluesse(k: Konfig, live: { kalenderVerbunden: boolean; saxo?: { eingerichtet: boolean; verbunden: boolean } }): Anschluss[] {
  const a: Anschluss[] = [
    { name: 'KI (API-Schlüssel)', symbol: '🧠', ok: !!k.anthropicApiKey || k.motorAttrappe, wofuer: 'Bürgermeister-Runden, Morgenzeitung, Einordnung von Mails', befehl: 'dorf api-schluessel' },
    { name: 'Werkstatt (Claude-Abo)', symbol: '🛠️', ok: !!k.werkstattGeheimnis || k.motorAttrappe, wofuer: 'Helfer und Skills mit claude-code', befehl: 'dorf claude-anmelden' },
    { name: 'Telegram', symbol: '📱', ok: !!(k.telegramToken && k.telegramChatId), wofuer: 'Meldungen, Erinnerungen, /todo, /plan …', befehl: 'dorf telegram-einrichten' },
    { name: 'Gmail', symbol: '📬', ok: !!k.gmail, wofuer: 'Post-Eingang, Antwort-Entwürfe, Rechnungen', befehl: 'dorf gmail-anmelden' },
    {
      name: 'Google-Kalender',
      symbol: '📅',
      ok: live.kalenderVerbunden,
      teilweise: !live.kalenderVerbunden && !!k.googleTermineIcs,
      wofuer: 'Kalender auf dem Marktplatz, Tag planen, Lernplan, Prüfungs-Wächter',
      befehl: 'dorf gmail-anmelden',
      hinweis: live.kalenderVerbunden ? undefined : 'In der Google Cloud die „Google Calendar API“ aktivieren, dann die Anmeldung wiederholen (fragt Mail und Kalender an).',
    },
    { name: 'Uni-Fristen (Google-Kalender)', symbol: '🎓', ok: !!(k.googleFristenIcs || k.googlePflichtIcs), wofuer: 'Abgaben und Prüfungen, Uni-To-dos, Erinnerungen', befehl: 'dorf moodle-kalender' },
    { name: 'Moodle-Browser', symbol: '🌐', ok: !!k.browserGeheimnis, wofuer: 'Agenten lesen in Moodle nach (/moodle)', befehl: 'dorf moodle-browser-zugang' },
    { name: 'Börse (EODHD)', symbol: '📈', ok: !!k.eodhdSchluessel, wofuer: 'Kurse für Depot und Watchlist', befehl: 'dorf boerse-schluessel' },
    {
      name: 'Saxo',
      symbol: '🇨🇭',
      ok: !!live.saxo?.verbunden,
      teilweise: !!live.saxo?.eingerichtet && !live.saxo.verbunden,
      wofuer: 'Echter Depotwert und Rendite (nur lesen)',
      befehl: 'dorf saxo-einrichten',
      hinweis: live.saxo?.eingerichtet && !live.saxo.verbunden ? 'App-Schlüssel ist da – jetzt in der Börse „Mit Saxo verbinden“ antippen.' : undefined,
    },
  ];
  return a;
}
