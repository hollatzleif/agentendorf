# Geräte-API des Agentendorfs (Cardputer)

Der Cardputer spricht nur mit `/api/geraet/*`. Alles ist JSON (UTF-8), immer über HTTPS.
Die Antworten sind bewusst klein gehalten (der Cardputer hat kein PSRAM): Listen sind begrenzt, Texte
gekürzt, Markdown ist entfernt.

## Anmeldung

- `POST /api/geraet/koppeln` **ohne** Schlüssel. Eingabe: `{ "code": "123456", "name": "Cardputer" }`.
  Antwort: `{ "token": "<64 Hex-Zeichen>", "name": "Cardputer" }`.
  - Den Code zeigt die App unter Einstellungen → Geräte → „Cardputer koppeln“ (6 Ziffern, 5 min gültig, nur einmal).
  - Fehler: 401 (Code falsch/abgelaufen), 429 (zu viele Versuche, `Retry-After`).
- Alle anderen Aufrufe: Kopfzeile `Authorization: Bearer <token>`.
  - 401 = Schlüssel ungültig oder in der App gesperrt → Cardputer zeigt „Neu koppeln“.
- Schreibende Aufrufe (POST) dürfen `X-Vorgang: <id>` mitschicken (8–64 Zeichen, z. B. Zufalls-Hex).
  Kommt dieselbe id noch einmal (Wiederholung nach Funkloch), antwortet der Server mit der gespeicherten
  Antwort und führt nichts doppelt aus (7 Tage gemerkt).
- Fehler haben immer die Form `{ "fehler": "Text für den Bildschirm" }`.

## Übersicht

`GET /api/geraet/start`
```json
{
  "zeit": 1763560000,            // Unix-Sekunden (UTC) – stellt die Uhr
  "offsetMin": 60,               // Wien: 60 im Winter, 120 im Sommer
  "version": "abc1234",
  "todosOffen": 12, "todosHeute": 4, "freigaben": 1, "gewohnheitenOffen": 2,
  "termin": { "zeit": "14:00", "titel": "Mathe VO" },   // nächster Termin heute oder null
  "fokus": { "art": "pomodoro", "phase": "fokus", "restSek": 1260 },  // laufender Kirchturm oder null
  "buergermeister": { "laeuft": false }
}
```

`GET /api/geraet/heute` → `{ "zeilen": [ { "art": "termin|todo|frist|gewohnheit", "text": "…", "zeit": "14:00", "id": "…", "erledigt": false } ] }`
(höchstens 40 Zeilen, sortiert wie „Heute“ in der App; `zeit` und `id` können fehlen)

## To-dos

- `GET /api/geraet/todos?ansicht=offen|heute|erledigt` →
  `{ "todos": [ { "id": "…", "titel": "…", "faellig": "2026-11-20" | null, "wichtig": true, "erledigt": false,
     "schritte": [ { "text": "…", "erledigt": false } ] } ] }` (höchstens 60, Titel ≤ 120 Zeichen, ≤ 12 Schritte)
- `POST /api/geraet/todos` `{ "text": "Mathe Übung 3 morgen !" }` → `{ "todo": { … } }`
  (der Text wird wie in der App gedeutet: „morgen“, „fr“, „24.12.“, „!“ = wichtig, „30 min“ …)
- `POST /api/geraet/todos/erledigt` `{ "id": "…", "erledigt": true }` → `{ "ok": true }`
- `POST /api/geraet/todos/schritt` `{ "id": "…", "index": 0, "erledigt": true }` → `{ "ok": true }`
- `POST /api/geraet/todos/loeschen` `{ "id": "…" }` → `{ "ok": true }` (Papierkorb)

## Kalender

- `GET /api/geraet/termine?tage=14` →
  `{ "termine": [ { "datum": "2026-11-20", "zeit": "14:00", "ende": "15:30", "titel": "…", "ort": "…" } ] }`
  (`zeit` leer = ganztägig; höchstens 60)
- `POST /api/geraet/termine` `{ "titel": "…", "datum": "2026-11-24", "zeit": "15:30", "dauerMin": 60 }` → `{ "ok": true }`
  (`zeit` leer oder fehlend = ganztägig; legt im Marktplatz-Kalender an, ohne Einladungen)

## Kirchturm (Pomodoro, Timer, Wecker)

Die Uhren laufen auf dem Server – der Cardputer zeigt sie nur an und piept.

- `GET /api/geraet/kirchturm` →
```json
{
  "jetztMs": 1763560000123,
  "laufend": [ { "id": "…", "art": "pomodoro|timer|wecker|stoppuhr", "titel": "…",
                 "phase": "fokus|kurz|lang", "endeMs": 1763561260000, "pausiert": false, "restMs": 1260000,
                 "runde": 2 } ],
  "klingelt": [ { "id": "…", "titel": "Pause vorbei" } ],
  "pomodoro": { "fokus": 25, "kurz": 5, "lang": 15, "langNach": 4 }
}
```
- `POST /api/geraet/kirchturm` `{ "aktion": "pomodoro", "titel": "Mathe" }` · `{ "aktion": "timer", "minuten": 10, "titel": "Tee" }` ·
  `{ "aktion": "wecker", "zeit": "07:30" }` · `{ "aktion": "stopp|pause|weiter|naechste|leise", "id": "…" }` → `{ "ok": true }`
  (`leise` = Klingeln quittieren)
- `POST /api/geraet/kirchturm/einstellungen` `{ "fokus": 25, "kurz": 5, "lang": 15, "langNach": 4 }` → `{ "ok": true }`

## Bürgermeister

- `POST /api/geraet/buergermeister` `{ "text": "…", "chatId": "…" }` → `{ "chatId": "…" }`
  (ohne `chatId` = neues Gespräch, mit = weiterreden; der Bürgermeister startet sofort)
- `GET /api/geraet/buergermeister/<chatId>` →
  `{ "status": "laeuft|fertig|fehler|wartet", "nachrichten": [ { "von": "du|bm", "text": "…" } ] }`
  (die letzten 20, Text ≤ 1500 Zeichen, ohne Markdown). Solange `laeuft`, alle 3 s neu fragen.
- `GET /api/geraet/buergermeister` → `{ "chats": [ { "chatId": "…", "titel": "…", "status": "…", "zeit": "14:03" } ] }` (die letzten 10)

## Freigaben

- `GET /api/geraet/freigaben` → `{ "freigaben": [ { "id": "…", "titel": "…", "gebaeude": "…", "text": "…" } ] }` (Text ≤ 600 Zeichen)
- `POST /api/geraet/freigaben/entscheiden` `{ "id": "…", "entscheidung": "ja|nein", "begruendung": "…" }` → `{ "ok": true }`

## Weiteres

- `GET /api/geraet/gewohnheiten` → `{ "gewohnheiten": [ { "name": "…", "erledigt": false, "serie": 5 } ] }`
- `POST /api/geraet/gewohnheiten` `{ "name": "…", "erledigt": true }` → `{ "ok": true }`
- `POST /api/geraet/notiz` `{ "text": "…" }` → `{ "ok": true }` (Tagesnotiz)
- `GET /api/geraet/fristen` → `{ "fristen": [ { "titel": "…", "fach": "…", "faellig": "2026-11-20T23:59:00+01:00", "erledigt": false } ] }` (14 Tage)
- `GET /api/geraet/post` → `{ "mails": [ { "von": "…", "betreff": "…", "zusammenfassung": "…", "antwortNoetig": true } ] }` (heute + gestern, höchstens 20)

## Spracheingabe (E194)

- `POST /api/geraet/sprache` – Körper: eine WAV-Datei (PCM 16 Bit, mono, 16 kHz; `Content-Type: audio/wav`), höchstens 2 MB
  (≈ 60 s). Antwort: `{ "text": "erkannter Text" }` (leer, wenn nichts verstanden wurde).
  - Abgeschrieben wird auf dem Server im Rechenraum (whisper.cpp, Deutsch zuerst), ohne Cloud. Dauer etwa 1,5 × Länge der Aufnahme.
  - Fehler: 413 (zu lang/zu groß), 503 (Spracherkennung gerade nicht verfügbar), 400 (kein gültiges WAV).
  - Die Aufnahme wird nach dem Abschreiben gelöscht, nicht im Vault gespeichert.
