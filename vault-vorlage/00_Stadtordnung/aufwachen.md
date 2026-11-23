---
titel: Bürgermeister rund um die Uhr
# Er wacht zu zufälligen Zeiten auf: nach jedem Aufwachen frühestens nach abstand_von_stunden, spätestens nach abstand_bis_stunden wieder.
abstand_von_stunden: 3
abstand_bis_stunden: 7
# Womit der Bürgermeister denkt, wenn er von selbst aufwacht: abo = dein Claude-Abo (kein API-Geld), api = API (zählt ins Budget).
denken_ueber: abo
# Wie viel alle KI-Aufrufe ohne deinen Klick über die API pro Tag höchstens kosten dürfen (US-Dollar) – Post-Einordnung,
# Zeitung, Wochenrückblick, Bank (mit Haiku, meist Cent-Beträge) und mit denken_ueber: api auch der Bürgermeister selbst.
# Ist die Grenze erreicht, wartet bis Mitternacht alles, was API kosten würde.
tagesbudget_usd: 0.5
# Rundgang: Gibt es nichts Neues, arbeitet er von selbst – höchstens alle rundgang_abstand_stunden 1–3 Aktivitäten aus dem Katalog in rundgang.md.
# Seine fälligen eigenen To-dos (Rathaus/buergermeister-todos/) arbeitet er bei jedem Aufwachen ab, auch mit eigene_aufgaben: nein.
eigene_aufgaben: ja
rundgang_abstand_stunden: 3
# Nachts (22–7 Uhr) schreibt der Telegram-Bot nur Dringendes (Fristen in wenigen Stunden); der Rest kommt um 7 Uhr gesammelt.
nachtruhe: ja
# Pläne des Bürgermeisters: Antwortest du nicht innerhalb so vieler Minuten, werden sie automatisch angenommen (0 = nie).
# Gilt nur für Pläne (Helfer starten) – Senden, Löschen, Abgeben und alle anderen Freigaben warten immer auf dich.
plan_automatisch_nach_minuten: 10
---

# Bürgermeister rund um die Uhr

Der Bürgermeister wacht **zu zufälligen Zeiten** auf – alle 3 bis 7 Stunden, Tag und Nacht, nicht zur vollen Stunde. Neue Aufgaben aus der App oder aus Telegram nimmt er sofort an; Notizen aus Obsidian sieht er beim nächsten Aufwachen. Zuerst prüft der Code ohne KI: neue Aufgaben auf dem Schreibtisch, Fristen, Freigaben, hängende Läufe, wichtige Mails. Nur wenn es etwas **Neues** gibt, denkt der Bürgermeister selbst nach – über dein Claude-Abo (`denken_ueber: abo`), also ohne API-Kosten.

Bei jedem Aufwachen arbeitet er **zuerst seine eigene To-do-Liste** ab (`Rathaus/buergermeister-todos/`): Dort hält er nach, was aus deinen Aufträgen noch offen ist. Du siehst die Liste im Rathaus unter „Schreibtisch“.

Gibt es nichts Neues, macht er höchstens alle `rundgang_abstand_stunden` Stunden einen **Rundgang**: Das Dorf wählt 1–3 fällige Aktivitäten aus dem Katalog in `rundgang.md` (Aufträge nachhalten, Vault pflegen, dich kennenlernen, Fristen vorbereiten …) – nur solche, für die es gerade einen Anlass gibt und die ins Restbudget passen; nachts nur stille Pflege. Was er getan hat, steht in `Rathaus/rundgang/`, das Wichtigste einmal am Tag in der Morgenzeitung. Senden, Abgeben, Zahlen und Löschen außerhalb des Rathauses tut er nie.

Helfer, die er von sich aus losschickt, laufen über dein Claude-Abo (claude-code). Der Notschalter in `motoren.md` übersteuert das.
