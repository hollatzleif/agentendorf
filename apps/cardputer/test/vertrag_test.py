"""Vertragsprüfung: Antworten der ECHTEN Geräte-API (laufender Dorf-Server) gegen den Nachbau (testserver.py),
gegen den die Firmware getestet ist. Verglichen wird die Form (Felder und Typen), nicht der Inhalt.

Aufruf (Server läuft, z. B. apps/web/e2e/server-starten.sh):
    python3 test/vertrag_test.py http://127.0.0.1:3999 'e2e-Passwort-sehr-lang-1'
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from http.cookiejar import CookieJar

import testserver

FEHLER: list[str] = []


def anfrage(basis: str, methode: str, pfad: str, daten: dict | None = None, kopf: dict | None = None, oeffner=None):
    k = {"Content-Type": "application/json", **(kopf or {})}
    req = urllib.request.Request(basis + pfad, method=methode, headers=k,
                                 data=None if daten is None else json.dumps(daten).encode())
    try:
        with (oeffner or urllib.request.urlopen)(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def form(x, tiefe=0):
    """Form eines JSON-Werts: Typen, bei Objekten die Schlüssel, bei Listen die Form des ersten Elements."""
    if isinstance(x, dict):
        return {k: form(v, tiefe + 1) for k, v in sorted(x.items())}
    if isinstance(x, list):
        return [form(x[0], tiefe + 1)] if x else []
    if isinstance(x, bool):
        return "bool"
    if isinstance(x, (int, float)):
        return "zahl"
    if x is None:
        return "null"
    return "text"


# laut API.md optional („können fehlen“) bzw. null erlaubt – die Firmware muss beides vertragen
OPTIONAL = {"zeit", "id", "ort", "ende", "phase", "runde", "endeMs", "restMs", "faellig"}


def vergleichen(name: str, echt, nachbau, pfad=""):
    """Alles, was der Nachbau liefert (und die Firmware also lesen könnte), muss es im echten Server mit gleichem Typ geben."""
    if echt == "null":
        return
    if isinstance(nachbau, dict):
        if not isinstance(echt, dict):
            FEHLER.append(f"{name}{pfad}: Objekt erwartet, echt {echt!r}")
            return
        for k, v in nachbau.items():
            if k not in echt:
                if k in OPTIONAL:
                    continue
                FEHLER.append(f"{name}{pfad}.{k}: fehlt im echten Server")
            else:
                vergleichen(name, echt[k], v, f"{pfad}.{k}")
    elif isinstance(nachbau, list):
        if not isinstance(echt, list):
            FEHLER.append(f"{name}{pfad}: Liste erwartet, echt {echt!r}")
        elif nachbau and echt:
            vergleichen(name, echt[0], nachbau[0], pfad + "[0]")
    elif nachbau != echt and "null" not in (nachbau, echt):
        FEHLER.append(f"{name}{pfad}: Typ {nachbau} (Nachbau) ≠ {echt} (echt)")


def main() -> int:
    basis, passwort = sys.argv[1].rstrip("/"), sys.argv[2]
    # --- Nachbau starten
    server, _dorf = testserver.starten(0)
    nb = f"http://127.0.0.1:{server.server_address[1]}"
    nb_token = anfrage(nb, "POST", "/api/geraet/koppeln", {"code": "123456", "name": "Cardputer"})[1]["token"]

    # --- echter Server: anmelden (Cookie), Code holen, koppeln
    jar = CookieJar()
    oeffner = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar)).open
    herkunft = {"Origin": basis}
    s, _ = anfrage(basis, "POST", "/api/anmeldung", {"passwort": passwort}, herkunft, oeffner)
    assert s == 200, f"Anmeldung {s}"
    s, k = anfrage(basis, "POST", "/api/geraete/kopplung", {}, herkunft, oeffner)
    assert s == 200 and len(k["code"]) == 6, (s, k)
    s, r = anfrage(basis, "POST", "/api/geraet/koppeln", {"code": k["code"], "name": "Cardputer"})
    assert s == 200 and len(r["token"]) == 64, (s, r)
    echt_kopf = {"Authorization": "Bearer " + r["token"]}
    nb_kopf = {"Authorization": "Bearer " + nb_token}

    def beide(methode, pfad, daten=None):
        se, e = anfrage(basis, methode, pfad, daten, echt_kopf)
        sn, n = anfrage(nb, methode, pfad, daten, nb_kopf)
        if se // 100 != 2:
            FEHLER.append(f"{methode} {pfad}: echter Server {se} {e}")
        return se, e, sn, n

    # Testdaten im echten Dorf anlegen (über die Geräte-API selbst)
    for t in ["Vertrag Eins morgen !", "Vertrag Zwei heute"]:
        beide("POST", "/api/geraet/todos", {"text": t})
    beide("POST", "/api/geraet/notiz", {"text": "Vertragsprüfung"})
    beide("POST", "/api/geraet/kirchturm", {"aktion": "timer", "minuten": 10, "titel": "Tee"})
    beide("POST", "/api/geraet/kirchturm", {"aktion": "pomodoro", "titel": "Mathe"})

    for pfad in ["/api/geraet/start", "/api/geraet/heute", "/api/geraet/todos?ansicht=offen", "/api/geraet/todos?ansicht=heute",
                 "/api/geraet/termine?tage=14", "/api/geraet/kirchturm", "/api/geraet/freigaben", "/api/geraet/gewohnheiten",
                 "/api/geraet/fristen", "/api/geraet/post", "/api/geraet/buergermeister"]:
        _, e, _, n = beide("GET", pfad)
        vergleichen("GET " + pfad, form(e), form(n))

    # Schreiben: To-do abhaken, Schritt, Kirchturm-Aktionen, Einstellungen, Bürgermeister, Freigaben
    _, todos, _, nb_todos = beide("GET", "/api/geraet/todos?ansicht=offen")
    tid = todos["todos"][0]["id"]
    for pfad, daten in [("/api/geraet/todos/erledigt", {"id": tid, "erledigt": True}),
                        ("/api/geraet/todos/erledigt", {"id": tid, "erledigt": False}),
                        ("/api/geraet/kirchturm/einstellungen", {"fokus": 30, "kurz": 5, "lang": 15, "langNach": 4})]:
        se, e = anfrage(basis, "POST", pfad, daten, echt_kopf)
        if se != 200 or e != {"ok": True}:
            FEHLER.append(f"POST {pfad}: {se} {e}")
    _, kt, _, _ = beide("GET", "/api/geraet/kirchturm")
    for l in [x for x in kt["laufend"] if x["art"] in ("pomodoro", "timer")]:   # wie die Firmware: Wecker nur löschen
        for akt in ["pause", "weiter"]:
            se, e = anfrage(basis, "POST", "/api/geraet/kirchturm", {"aktion": akt, "id": l["id"]}, echt_kopf)
            if se != 200:
                FEHLER.append(f"kirchturm {akt} {l['art']}: {se} {e}")
    se, e = anfrage(basis, "POST", "/api/geraet/kirchturm", {"aktion": "wecker", "zeit": "07:30"}, echt_kopf)
    if se != 200:
        FEHLER.append(f"kirchturm wecker: {se} {e}")
    se, e = anfrage(basis, "POST", "/api/geraet/termine", {"titel": "Vertrag", "datum": "2026-12-24", "zeit": "15:30", "dauerMin": 60}, echt_kopf)
    print(f"  Termin anlegen (ohne Google im Test): {se} {e}")

    _, b, _, nbb = beide("POST", "/api/geraet/buergermeister", {"text": "Hallo Bürgermeister"})
    vergleichen("POST /buergermeister", form(b), form(nbb))
    import time
    for _ in range(40):
        _, chat = anfrage(basis, "GET", f"/api/geraet/buergermeister/{b['chatId']}", None, echt_kopf)
        if chat["status"] != "laeuft":
            break
        time.sleep(0.5)
    _, nbchat = anfrage(nb, "GET", f"/api/geraet/buergermeister/{nbb['chatId']}", None, nb_kopf)
    vergleichen("GET /buergermeister/<id>", form(chat), form(nbchat))
    print(f"  Bürgermeister (Attrappe): status={chat['status']}, {len(chat['nachrichten'])} Nachrichten")

    # Idempotenz und Sperren
    kopf2 = {**echt_kopf, "X-Vorgang": "vertrag-0123456789"}
    vorher = len(anfrage(basis, "GET", "/api/geraet/todos?ansicht=offen", None, echt_kopf)[1]["todos"])
    for _ in range(2):
        anfrage(basis, "POST", "/api/geraet/todos", {"text": "Einmalig"}, kopf2)
    nachher = len(anfrage(basis, "GET", "/api/geraet/todos?ansicht=offen", None, echt_kopf)[1]["todos"])
    if nachher != vorher + 1:
        FEHLER.append(f"X-Vorgang: {nachher - vorher} statt 1 angelegt")
    se, _ = anfrage(basis, "GET", "/api/geraet/start", None, {"Authorization": "Bearer " + "0" * 64})
    if se != 401:
        FEHLER.append(f"falscher Schlüssel: {se} statt 401")

    server.shutdown()
    if FEHLER:
        print("VERTRAG VERLETZT:")
        for f in FEHLER:
            print("  -", f)
        return 1
    print("Vertrag eingehalten: echte Geräte-API passt zum Nachbau der Firmware.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
