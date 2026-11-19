// Netz-Schnittstelle fuer die Agentendorf-App: WLAN und HTTP(S)-Anfragen.
//
// Die App (core/) kennt nur diese Schnittstelle. Auf dem Cardputer steckt dahinter WiFi +
// WiFiClientSecure in einer eigenen FreeRTOS-Aufgabe (src/main.cpp), im PC-Test einfache
// Sockets gegen den Testserver (host/dorf_host.cpp). Es laeuft immer nur EINE Anfrage; die
// Reihenfolge und das Wiederholen regelt core/dorf.cpp.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace haloos {

struct WlanNetz {
    std::string ssid;
    int rssi = -100;      // dBm
    bool offen = false;   // ohne Passwort
};

enum class WlanZustand { Aus, Getrennt, Verbindet, Verbunden, Fehler };

struct Anfrage {
    uint32_t id = 0;
    bool post = false;
    std::string basis;     // "https://dorf.beispiel.de" (im PC-Test auch "http://127.0.0.1:8123")
    std::string pfad;      // "/api/geraet/start"
    std::string token;     // leer = ohne Authorization (nur beim Koppeln)
    std::string koerper;   // JSON bei POST
    std::string vorgang;   // X-Vorgang (leer = keine)
    // Hochladen einer Datei statt koerper (Spracheingabe): Name wie bei Platform::readFile. Die Netz-Schicht
    // schickt sie stueckweise (nie ganz im Speicher) mit diesem Content-Type.
    std::string datei, inhaltTyp;
    uint32_t fristMs = 0;  // so lange darf die Antwort auf sich warten lassen (0 = ueblich, ~10 s)
};

struct Antwort {
    uint32_t id = 0;
    int status = 0;        // HTTP-Status; 0 = keine Verbindung / Zeit abgelaufen / TLS-Fehler
    std::string koerper;
    int wartenSek = 0;     // Retry-After (bei 429)
    std::string grund;     // bei status 0: kurzer Text fuers Protokoll
};

class Net {
public:
    virtual ~Net() = default;

    // WLAN (alles ohne zu blockieren)
    virtual void wlanSuchen() = 0;                                   // Suche starten
    virtual bool wlanGefunden(std::vector<WlanNetz>& netze) = 0;     // true = Suche fertig, Ergebnis in netze
    virtual void wlanVerbinden(const std::string& ssid, const std::string& passwort) = 0;
    virtual void wlanTrennen() = 0;
    virtual WlanZustand wlanZustand() = 0;
    virtual std::string wlanName() = 0;                              // verbundenes Netz oder ""

    // HTTP: start() nimmt eine Anfrage an (false = es laeuft noch eine), poll() liefert die Antwort.
    // Die Umsetzung garantiert eine Antwort nach spaetestens ~20 s bzw. fristMs + ~30 s (status 0 bei Fehler).
    virtual bool start(const Anfrage& a) = 0;
    virtual bool poll(Antwort& out) = 0;
    virtual bool nurHttps() const { return true; }                   // PC-Test: false
};

}  // namespace haloos
