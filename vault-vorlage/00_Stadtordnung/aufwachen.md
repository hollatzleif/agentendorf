---
titel: Bürgermeister rund um die Uhr
# Er wacht zu zufälligen Zeiten auf: nach jedem Aufwachen frühestens nach abstand_von_stunden, spätestens nach abstand_bis_stunden wieder.
abstand_von_stunden: 3
abstand_bis_stunden: 7
# Wie viel die KI-Läufe ohne deinen Klick (Aufwachen, Rundgänge, Post-Einordnung, Zeitung) pro Tag kosten dürfen (US-Dollar, API).
# Ist die Grenze erreicht, prüft der Bürgermeister bis Mitternacht nur noch ohne KI.
tagesbudget_usd: 5
# Rundgang: Gibt es nichts Neues, schaut er sich alle paar Stunden selbst um – bereitet etwas vor, schlägt Aufräumen vor oder legt sich wieder hin.
eigene_aufgaben: ja
rundgang_abstand_stunden: 3
# Nachts (22–7 Uhr) schreibt der Telegram-Bot nur Dringendes (Fristen in wenigen Stunden); der Rest kommt um 7 Uhr gesammelt.
nachtruhe: ja
# Pläne des Bürgermeisters: Antwortest du nicht innerhalb so vieler Minuten, werden sie automatisch angenommen (0 = nie).
# Gilt nur für Pläne (Helfer starten) – Senden, Löschen, Abgeben und alle anderen Freigaben warten immer auf dich.
plan_automatisch_nach_minuten: 10
---

# Bürgermeister rund um die Uhr

Der Bürgermeister wacht **zu zufälligen Zeiten** auf – alle 3 bis 7 Stunden, Tag und Nacht, nicht zur vollen Stunde. Neue Aufgaben aus der App oder aus Telegram nimmt er sofort an; Notizen aus Obsidian sieht er beim nächsten Aufwachen. Zuerst prüft der Code ohne KI: neue Aufgaben auf dem Schreibtisch, Fristen, Freigaben, hängende Läufe, wichtige Mails. Nur wenn es etwas **Neues** gibt, denkt der Bürgermeister selbst nach (API, kleines Budget).

Gibt es nichts Neues, macht er höchstens alle `rundgang_abstand_stunden` Stunden einen **Rundgang**: Er schaut sich im Dorf um und tut höchstens eine sinnvolle Sache – z. B. einen Helfer losschicken, der etwas vorbereitet (läuft über dein Abo), oder Vorschläge zum Aufräumen als Notiz ablegen. Löschen oder Abgeben tut er nie; dafür braucht es deine Freigabe.

Helfer, die er von sich aus losschickt, laufen über dein Claude-Abo (claude-code). Der Notschalter in `motoren.md` übersteuert das.
