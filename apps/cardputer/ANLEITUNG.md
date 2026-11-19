# Agentendorf auf dem Cardputer Adv – Firmware 1.0

Beim Einschalten zeigt der Cardputer ein Startmenü:

1. **Fernbedienung** – für die Brille, genau wie bisher (HaloOS 0.3): sucht den Hub per Bluetooth.
2. **Agentendorf** – dein Dorf in der Hosentasche, über WLAN: **Heute**, **To-dos**, **Bürgermeister**,
   **Kirchturm** (Pomodoro, Timer, Wecker), **Kalender**, **Freigaben**, **Fristen**, **Gewohnheiten**,
   **Notiz**, **Post**. Alles als Listen – das 3D-Dorf gibt es hier nicht.

Zwischen den beiden wechselst du über einen kurzen Neustart (dauert etwa zwei Sekunden): in der
Fernbedienung die Seitentaste 3 s halten, im Agentendorf `Esc` auf der Startseite. Der zuletzt benutzte
Punkt ist beim nächsten Einschalten vorgewählt.

![Übersicht](docs/bilder/uebersicht.png)

---

## Aufspielen (Windows-PC, PowerShell)

Du brauchst: den Cardputer, ein USB-C-**Daten**kabel und die Datei `agentendorf-cardputer-1.0.bin`
im Ordner „Downloads“ (sie liegt im Repo unter `apps/cardputer/release/`; auf GitHub: Datei anklicken →
„Download raw file“). Python ist auf dem PC schon da. Jeden Block einzeln kopieren, einfügen, Enter.

**1. Ordner anlegen und Datei hineinlegen**

```powershell
New-Item -ItemType Directory -Force "$HOME\Agentendorf-Cardputer" | Out-Null; Move-Item -Force "$HOME\Downloads\agentendorf-cardputer-1.0.bin" "$HOME\Agentendorf-Cardputer\"; cd "$HOME\Agentendorf-Cardputer"
```

Prüfsumme ansehen – sie muss mit der Zeile in `release/SHA256.txt` übereinstimmen:

```powershell
(Get-FileHash agentendorf-cardputer-1.0.bin -Algorithm SHA256).Hash.ToLower()
```

**2. Flash-Werkzeug einrichten** (einmalig, ca. 1 Minute; landet nur in diesem Ordner)

```powershell
cd "$HOME\Agentendorf-Cardputer"; if (Get-Command py -ErrorAction SilentlyContinue) { py -m venv .venv } else { python -m venv .venv }; .\.venv\Scripts\python.exe -m pip install --quiet esptool==4.8.1
```

**3. Cardputer anschließen** – per USB-C an den PC, einschalten. Verbindung prüfen:

```powershell
.\.venv\Scripts\python.exe -m esptool --chip esp32s3 flash_id
```

Erwartet: `Chip is ESP32-S3` und `Detected flash size: 8MB`.
Kommt `Failed to connect`: **Download-Modus** – Cardputer ausschalten und abziehen, die Taste **G0**
gedrückt halten, wieder einstecken bzw. einschalten, Taste loslassen, Befehl wiederholen.
(Die genaue Lage von G0 steht in der Kurzanleitung von M5Stack.)

**4. Sicherung der jetzigen Software** – alles, was gerade auf dem Cardputer ist (z. B. HaloOS 0.3 samt
Einstellungen), 8 MB, dauert 1–3 Minuten:

```powershell
.\.venv\Scripts\python.exe -m esptool --chip esp32s3 read_flash 0 0x800000 cardputer-sicherung-vor-agentendorf.bin
```

Prüfen – es muss genau `8388608` herauskommen:

```powershell
(Get-Item cardputer-sicherung-vor-agentendorf.bin).Length
```

**5. Agentendorf aufspielen**

```powershell
.\.venv\Scripts\python.exe -m esptool --chip esp32s3 write_flash 0x0 agentendorf-cardputer-1.0.bin
```

Erwartet am Ende: `Hash of data verified.` und `Hard resetting`. Der Cardputer startet neu und zeigt das
Startmenü. Bleibt der Bildschirm dunkel (nach Download-Modus von Hand): einmal aus- und einschalten.

Was dabei verloren geht: die im Cardputer gespeicherten **Einstellungen der Fernbedienung** (der Hub hat eine
Kopie und schickt sie beim ersten Verbinden zurück). Was bleibt: die Dateien im internen Speicher bzw. auf
der SD-Karte.

## Zurückspielen, falls etwas nicht stimmt

Den Startlader im Chip (ROM) kann keine Firmware überschreiben: Der Download-Modus (Schritt 3) geht
**immer**. Damit lässt sich jederzeit die Sicherung zurückspielen – danach ist der Cardputer exakt wie vorher:

```powershell
cd "$HOME\Agentendorf-Cardputer"; .\.venv\Scripts\python.exe -m esptool --chip esp32s3 write_flash 0x0 cardputer-sicherung-vor-agentendorf.bin
```

Ohne Sicherung: `haloos-cardputer-0.3.bin` genauso an `0x0` schreiben, oder die Werks-Software mit M5Burner
bzw. dem „Cardputer-Adv Easyloader“ von M5Stack (Links auf docs.m5stack.com).

## Später aktualisieren, ohne neu einzurichten

Das volle Abbild (Schritt 5) löscht auch die gespeicherten WLAN-Netze und die Kopplung. Für ein Update von
1.0 auf eine neuere Fassung reicht das Programm allein – WLAN, Kopplung und Warteschlange bleiben:

```powershell
.\.venv\Scripts\python.exe -m esptool --chip esp32s3 write_flash 0x10000 agentendorf-cardputer-1.0-nur-programm.bin
```

(Dateiname der neuen Fassung einsetzen. Nur verwenden, wenn schon eine Agentendorf-Firmware drauf ist.)

---

## Ersteinrichtung

**1. WLAN.** Im Startmenü `2` drücken. Beim ersten Mal erscheint die WLAN-Liste. Netz mit `;` / `.`
wählen, `Enter`, Passwort eintippen, `Enter`. Unten steht „verbinde mit …“, dann „Verbunden ✓“.

- **Handy-Hotspot** geht genauso – er steht in der Liste, sobald er am Handy eingeschaltet ist.
  Der Cardputer kann nur **2,4 GHz**: am iPhone „Kompatibilität maximieren“ einschalten, bei Android im
  Hotspot das 2,4-GHz-Band wählen. Taucht er nicht auf: „Neu suchen“ (unten in der Liste) oder
  „Anderes Netz“ und den Namen von Hand tippen.
- Du kannst **mehrere Netze** speichern (zu Hause, Hotspot, …, bis zu acht). Beim Start verbindet sich der
  Cardputer von selbst mit dem ersten gespeicherten Netz, das gerade da ist.
- Netze mit Anmeldeseite im Browser oder mit Benutzername (eduroam) gehen **nicht**.
- Im Passwortfeld ist `` ` `` ein normales Zeichen; abbrechen dort mit `fn` + `` ` `` (Esc).

**2. Koppeln.** Danach erscheint „Koppeln“:

1. „Dorf-Adresse“ → `Enter` → die Adresse deines Dorfs tippen, z. B. `dorf.beispiel.de` (ohne `https://`,
   das ergänzt der Cardputer; unverschlüsselt verbindet er sich nie).
2. In der Agentendorf-App am Handy oder PC: **Einstellungen → Geräte → „Cardputer koppeln“**. Die App zeigt
   einen 6-stelligen Code (gilt 5 Minuten, nur einmal).
3. Am Cardputer „Code“ → `Enter` → die 6 Ziffern tippen → `Enter`.
4. „Jetzt koppeln“ → `Enter`. Es erscheint „Gekoppelt ✓“ und die Startseite.

„Code falsch oder abgelaufen“: in der App einen neuen Code holen. „Dorf nicht erreichbar“: Adresse prüfen.

Später findest du alles unter **Einstellungen** (letzter Punkt der Startseite): WLAN-Netze verwalten
(`Del` = vergessen, `/` = Passwort neu eingeben), neu koppeln, Gerät entkoppeln, Warteschlange, Lautstärke.
Sperrst du den Cardputer in der App (Einstellungen → Geräte), zeigt er „Neu koppeln“.

## Bedienung

| Taste | Wirkung |
|---|---|
| `;` `.` (Pfeile hoch/runter) | auswählen · in Texten blättern |
| Enter oder Leertaste | öffnen, abhaken, bestätigen |
| `/` (Pfeil rechts) | To-do: Details mit Teilschritten · Pomodoro: nächste Phase · Einstellungen: Wert + |
| `,` (Pfeil links) | zurück · Einstellungen: Wert − |
| `` ` `` (Esc) | zurück · auf der Agentendorf-Startseite: zum Startmenü (mit Rückfrage, Neustart) |
| del | löschen bzw. stoppen (mit Rückfrage) · im Textfeld: Zeichen löschen |
| tab | To-dos: zwischen „offen“ und „heute“ wechseln · Kirchturm: Menü |
| opt + a / o / u / s | ä ö ü ß (mit Shift: Ä Ö Ü) · opt + e = € |
| einfach lostippen | To-dos: neues To-do · Bürgermeister: neue Nachricht |
| irgendeine Taste, wenn der Kirchturm läutet | Klingeln quittieren |
| Seitentaste | Bildschirm wecken · im Fernbedienungs-Modus 3 s halten: Startmenü |

Der grüne Punkt oben neben der Uhr heißt „WLAN verbunden“ (gelb: verbindet, rot: getrennt).

**To-dos.** Text tippen und `Enter` – das Dorf deutet ihn wie in der App: „Mathe Übung 3 morgen !“ wird
ein wichtiges To-do für morgen (`morgen`, `fr`, `24.12.`, `30 min`, `!`). `Enter` hakt ab, `/` zeigt die
Teilschritte (einzeln abhakbar), `del` löscht (Papierkorb im Dorf).

**Bürgermeister.** „Neues Gespräch“ oder einfach lostippen, `Enter` schickt ab. Oben steht „denkt …“, der
Cardputer fragt alle 3 Sekunden nach. Die Antwort erscheint umgebrochen, `;` / `.` blättern. Zum Antworten
wieder tippen. `Esc` verlässt das Gespräch – der Bürgermeister arbeitet weiter, das Gespräch steht in der Liste.

**Kirchturm.** `Enter` startet einen Pomodoro bzw. pausiert ihn, `/` springt zur nächsten Phase, `del` stoppt.
`t` = Timer (Minuten tippen, z. B. `10` oder `4 Tee`), `w` = Wecker (`730`, `7:30`), `e` = Pomodoro-Zeiten
und Lautstärke, `tab` = Menü mit allem. Laufen mehrere Uhren, wechseln `;` / `.` zwischen ihnen. Die Uhren
laufen im Dorf – am Handy gestartete erscheinen auch hier. Läutet es, piept der Cardputer, der Bildschirm
wird hell, eine beliebige Taste quittiert. Das klappt in jeder Ansicht des Agentendorfs (er sieht alle
30 Sekunden nach), nicht aber im Startmenü oder in der Fernbedienung.

**Kalender.** Die nächsten 14 Tage. „+ Neuer Termin“ → Titel → Tag (Pfeile: ±1 Tag / ±1 Woche, oder tippen:
`2412` = 24.12.) → Uhrzeit (`15`, `930`, `1530` oder `15:30`; leer = ganztägig). Mit Uhrzeit dauert der
Termin 60 Minuten. Er landet im Marktplatz-Kalender. Löschen und Ändern geht nur in der App.

**Freigaben.** `Enter` öffnet den Antrag, `;` / `.` blättern. `Enter` = Ja (mit Rückfrage), `n` oder `del` =
Nein – danach kannst du eine Begründung tippen (oder leer lassen).

**Heute, Fristen, Post** sind zum Lesen (`Enter` zeigt Details); in „Heute“ und „Gewohnheiten“ hakt `Enter` ab.
**Notiz**: tippen, `Enter` – landet in der Tagesnotiz.

**Ohne Netz.** Listen zeigen den letzten Stand, unten steht gelb „offline, Stand 14:03“. To-dos anlegen und
abhaken, Teilschritte, Gewohnheiten und Notizen merkt sich der Cardputer („… – wird nachgeschickt“) und
schickt sie, sobald das Dorf wieder erreichbar ist – auch nach dem Ausschalten. Doppelt ankommen kann nichts.
Alles andere (Bürgermeister, Freigaben, Termine, Kirchturm stellen, löschen) braucht Netz.

**Uhrzeit.** Kommt vom Dorf, sobald die Startseite geladen ist. **Bildschirm:** nach 30 s gedimmt, nach
2 Minuten aus; die erste Taste weckt nur. Das WLAN bleibt dabei an – für lange Akkulaufzeit ausschalten.

## Was geprüft ist – und was nicht

- **Geprüft (am PC, mit genau dem Code, der auf dem Cardputer läuft):** Startmenü, WLAN-Einrichtung, Koppeln,
  alle Ansichten und Abläufe oben, die Warteschlange ohne Netz (auch: Antwort geht verloren, es kommt trotzdem
  nur einmal an; Neustart dazwischen), „offline, Stand …“, das Läuten im Hintergrund, 401 → „Neu koppeln“ –
  115 Prüfungen gegen einen nachgebauten Server, der sich an die Schnittstellen-Beschreibung (`API.md`) hält.
  Die Bilder stammen aus diesem Test.
- **Übersetzt** mit der offiziellen ESP32-S3-Werkzeugkette (Arduino-Core 2.0.17), eigener Code ohne Warnungen;
  das Programm belegt 46 % des Platzes.
- **Noch nie auf einem echten Cardputer gelaufen.** Am PC nicht prüfbar und deshalb zuerst ansehen:
  - **WLAN und HTTPS:** Verbindet er sich (auch mit dem Hotspot)? Klappt das Koppeln mit deinem Dorf? Die
    Zertifikatsprüfung kennt Let's Encrypt und ZeroSSL – stellt dein Dorf ein anderes Zertifikat aus,
    erscheint „Dorf nicht erreichbar“.
  - **Arbeitsspeicher:** WLAN und Verschlüsselung brauchen viel davon. Unter Einstellungen steht ganz unten
    „… KB RAM frei“ – sag mir die Zahl, wenn etwas hängt oder neu startet (z. B. bei sehr langen
    Bürgermeister-Antworten).
  - **Geschwindigkeit:** Die erste Anfrage nach dem Verbinden dauert ein paar Sekunden.
  - **Echter Server:** Getestet ist gegen den Nachbau. Weicht das echte Dorf von `API.md` ab, zeigt der
    Cardputer an der Stelle leere Felder oder „Fehler …“.
  - Wie schon bei HaloOS: opt-Umlaute, Lautsprecher-Lautstärke, SD-Karte, Farben.
- Die **Fernbedienung** ist unverändert übernommen, aber in dieser Firmware ebenfalls nicht am Gerät getestet.
- Das Ablaufdatum von Zertifikaten prüft der Cardputer nicht (Einschränkung der verwendeten Bibliothek);
  Aussteller und Name werden geprüft.
- WLAN-Passwörter und der Geräteschlüssel liegen unverschlüsselt im Cardputer. Geht er verloren: in der App
  unter Einstellungen → Geräte sperren.
