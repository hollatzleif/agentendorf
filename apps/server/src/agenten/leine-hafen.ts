/**
 * E231 – Hafen-Werkzeuge (Namen und Gruppe; Ausführung in werkzeuge-hafen.ts). Wer sie bekommt: Aktionen mit
 * `werkzeuge: [hafen]`, freie Helfer mit der Fähigkeit „hafen“ und der Bürgermeister. Was es bewusst NICHT gibt:
 * scharf schalten, entschärfen, auszahlen, Wallets/Schlüssel, Leifs Bots löschen, Not-Aus aufheben – das tut nur Leif.
 * hafen_bot_loeschen löscht nur Paper-Bots, die ein Agent selbst angelegt hat (Hafenmeister, E231).
 */
export const HAFEN_WERKZEUGE = ['hafen_uebersicht', 'hafen_bot_lesen', 'hafen_bot_anlegen', 'hafen_bot_aendern', 'hafen_bot_status', 'hafen_backtest', 'hafen_bot_loeschen', 'hafen_notaus'] as const;
export type HafenWerkzeug = (typeof HAFEN_WERKZEUGE)[number];

export function istHafen(name: string): name is HafenWerkzeug {
  return (HAFEN_WERKZEUGE as readonly string[]).includes(name);
}
