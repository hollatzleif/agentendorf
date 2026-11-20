// Agentendorf-Klient (hardware-unabhaengig): Einstellungen, WLAN-Automatik, Anfragen an
// /api/geraet/* (Vertrag: apps/cardputer/API.md), Zwischenspeicher fuer "offline, Stand 14:03",
// Warteschlange fuer schreibende Aktionen ohne Netz (X-Vorgang) und der Kirchturm-Waechter.
#pragma once
#include <cstdint>
#include <deque>
#include <map>
#include <string>
#include <vector>

#include "cardo_data.h"
#include "json.h"
#include "net.h"

namespace haloos {

class App;
class Platform;

struct WlanEintrag {
    std::string ssid, passwort;
    bool versteckt = false;   // von Hand angelegt (taucht in der Suche evtl. nie auf): ohne Suche direkt versuchen
};

// Was eine Ansicht auf ihre Anfrage zurueckbekommt
struct Ergebnis {
    int marke = 0;            // von der Ansicht vergeben (welche ihrer Anfragen)
    int status = 0;           // HTTP-Status, 0 = kein Netz
    bool ok = false;          // 2xx und gueltiges JSON
    bool daten = false;       // j ist nutzbar (frisch ODER aus dem Zwischenspeicher)
    bool offline = false;     // Daten stammen aus dem Zwischenspeicher
    std::string stand;        // "14:03" - wann die Daten geholt wurden (nur bei offline)
    std::string fehler;       // Text fuer den Bildschirm, wenn !ok
    Json j;                   // Wurzel der Antwort
};

struct StartInfo {
    bool bekannt = false;
    int todosOffen = 0, todosHeute = 0, freigaben = 0, gewohnheitenOffen = 0;
    std::string terminZeit, terminTitel, version;
    std::string fokusArt, fokusPhase;
    int fokusRestSek = 0;
    uint32_t geholt = 0;      // millis beim Empfang
    bool bmLaeuft = false;
    bool offline = false;
    std::string stand;
};

struct Uhr {
    std::string id, art, titel, phase;
    int64_t endeMs = 0, restMs = 0;
    bool pausiert = false;
    int runde = 0;
};

struct KirchturmStand {
    bool bekannt = false;
    bool offline = false;         // letzter Abruf fehlgeschlagen (Zeiten laufen lokal weiter)
    int64_t jetztMs = 0;          // Serverzeit beim Abruf
    uint32_t geholt = 0;          // millis beim Abruf
    std::vector<Uhr> laufend;
    int fokus = 25, kurz = 5, lang = 15, langNach = 4;
};

struct Wartend {
    std::string vorgang, pfad, koerper, text;
};

class Dorf {
public:
    static constexpr size_t MAX_NETZE = 8;
    static constexpr size_t MAX_WARTEND = 40;
    static constexpr uint32_t KIRCHTURM_MS = 30000, KIRCHTURM_SCHNELL_MS = 15000;
    static constexpr int RSSI_SCHWACH = -85;              // schwaecher: ein anderes bekanntes Netz geht vor
    static constexpr int RSSI_WECHSEL = -75;              // so gut muss ein besseres Netz sein, damit gewechselt wird
    static constexpr uint32_t WECHSEL_PRUEFEN_MS = 180000;   // hoechstens alle 3 min nach einem besseren Netz sehen
    static constexpr uint32_t RUNDEN_PAUSE_MAX_MS = 300000;

    Dorf(Platform& p, Net& n, Clock& c);

    void laden();                          // Einstellungen und Warteschlange aus dem Speicher
    void starten(uint32_t now);            // Agentendorf geoeffnet: WLAN an
    bool aktiv() const { return aktiv_; }
    void tick(App& app, uint32_t now);

    // ---- WLAN
    std::vector<WlanEintrag> netze;        // gespeichert (Reihenfolge = Vorrang)
    std::vector<WlanNetz> funde;           // Ergebnis der letzten Suche
    bool sucht() const { return sucht_; }
    void wlanSuchen(uint32_t now);         // von Hand (WLAN-Ansicht); weckt auch die Automatik wieder auf
    // von Hand verbinden. versteckt = Name wurde getippt ("Anderes Netz")
    void wlanVersuchen(const std::string& ssid, const std::string& passwort, uint32_t now, bool versteckt = false);
    enum class Versuch { Keiner, Laeuft, Ok, Fehler };
    Versuch versuch() const { return versuch_; }
    const std::string& versuchSsid() const { return versuchSsid_; }
    void versuchFertig() { versuch_ = Versuch::Keiner; }
    void netzVergessen(const std::string& ssid);
    bool netzVerschieben(const std::string& ssid, int richtung);   // -1 = hoeherer Vorrang, +1 = tiefer
    int rssi(const std::string& ssid) const;                       // aus der letzten Suche; 0 = nicht gesehen
    bool wlanAutomatik() const { return !kandidaten_.empty(); }    // probiert gerade bekannte Netze durch
    const WlanEintrag* netz(const std::string& ssid) const;
    bool verbunden() { return net_.wlanZustand() == WlanZustand::Verbunden; }
    std::string wlanName() { return net_.wlanName(); }
    WlanZustand wlanZustand() { return net_.wlanZustand(); }

    // ---- Koppeln
    std::string adresse;                   // "dorf.beispiel.de"
    bool gekoppelt() const { return !token_.empty() && !adresse.empty(); }
    bool gesperrt() const { return gesperrt_; }     // Server hat 401 gesagt -> neu koppeln
    void koppeln(const std::string& adresse, const std::string& code, uint32_t besitzer, int marke);
    void koppelnFertig(const std::string& adresse, const std::string& token, uint32_t now);
    void entkoppeln();
    // Eingabe "https://Dorf.Beispiel.de/" -> "dorf.beispiel.de"; "" wenn unbrauchbar
    std::string adresseBereinigen(const std::string& eingabe) const;

    // ---- Anfragen (pfad ohne "/api/geraet", z. B. "/todos?ansicht=offen")
    // Lesen. merken = Antwort im Speicher ablegen und ohne Netz von dort zeigen.
    void holen(const std::string& pfad, uint32_t besitzer, int marke, bool merken = true);
    // Schreiben, das Netz braucht (Antwort geht an die Ansicht).
    void senden(const std::string& pfad, const std::string& koerper, uint32_t besitzer, int marke);
    // Schreiben, das auch ohne Netz klappt: kommt in die Warteschlange und wird nachgeschickt.
    // Rueckgabe false = Warteschlange voll. text = kurze Beschreibung fuer die Anzeige.
    bool einreihen(const std::string& pfad, const std::string& koerper, const std::string& text, uint32_t now);
    // Spracheingabe: Aufnahme-Datei hochladen, Antwort { text } geht an die Ansicht. Braucht Netz (keine
    // Warteschlange). Die Datei loescht der Kern, sobald die Antwort da ist.
    static constexpr const char* SPRACH_DATEI = "sprache.wav";
    static constexpr uint32_t SPRACH_FRIST_MS = 120000;      // Abschreiben dauert ~1,5 x Aufnahmelaenge
    void spracheSenden(uint32_t besitzer, int marke);
    bool spracheLaeuft() const;
    int mikro = 2;                         // Mikrofon-Verstaerkung 1..3 (NVS "mikro")
    void mikroSetzen(int v);
    bool mikroRegister = false;            // 1.3.3: Verstaerkung im Codec statt Software (NVS "mikroreg", Vorgabe aus)
    void mikroRegisterSetzen(bool an);
    const std::deque<Wartend>& wartend() const { return wartend_; }
    uint32_t schreibStand() const { return schreibStand_; }   // zaehlt hoch, wenn etwas beim Server ankam
    void schreibStandErhoehen() { ++schreibStand_; }
    bool beschaeftigt() const { return laeuft_ || !offen_.empty(); }

    // ---- Uebersicht und Kirchturm
    StartInfo start;
    void startHolen(uint32_t now);
    KirchturmStand kirchturm;
    void kirchturmHolen(uint32_t now) { kirchturmFaellig_ = now; }
    void kirchturmSchnell(uint32_t now) { schnellBis_ = now + 20000; }   // Kirchturm-Ansicht ist offen
    int64_t restMs(const Uhr& u, uint32_t now) const;
    void kirchturmAktion(const std::string& koerper, uint32_t besitzer, int marke);
    bool alarm() const { return !alarm_.empty(); }
    std::string alarmText() const;
    void alarmLeise(uint32_t now);         // Taste gedrueckt: quittieren
    int lautstaerke = 2;                   // 1 leise, 2 mittel, 3 laut
    void lautstaerkeSetzen(int v);
    void schlangeJetzt(uint32_t now) { schlangeFaellig_ = now; schlangePause_ = 5000; }

    std::string standText(int64_t utc, int offsetMin, uint32_t now) const;   // "14:03" bzw. "18.11. 14:03"

private:
    enum class Art { Ansicht, Koppeln, Schlange, Kirchturm, Start, Still };
    struct Offen {
        Anfrage a;
        Art art = Art::Ansicht;
        uint32_t besitzer = 0;
        int marke = 0;
        bool merken = false;
    };
    void einstellen(Offen o);
    void abschicken(App& app, uint32_t now);
    void antwort(App& app, const Offen& o, const Antwort& r, uint32_t now);
    void kirchturmLesen(App& app, const Json& j, uint32_t now);
    void kirchturmTick(App& app, uint32_t now);
    void wlanTick(uint32_t now);
    void netzeSpeichern();
    void schlangeSpeichern();
    std::string vorgangNeu();
    std::string dateiName(const std::string& pfad) const;
    std::string basis() const;

    Platform& platform_;
    Net& net_;
    Clock& clock_;
    bool aktiv_ = false;
    std::string token_;
    bool gesperrt_ = false;

    // WLAN
    // Automatik: Suche -> Kandidaten (gesehene nach Vorrang, dann nicht gesehene direkt) der Reihe nach,
    // danach Pause (wird laenger: 15 s ... 5 min), damit der Akku ohne bekanntes Netz nicht leergefunkt wird.
    struct Kandidat {
        std::string ssid;
        uint32_t frist;       // so lange darf der Versuch dauern
    };
    void rundeBeginnen(uint32_t now);                 // Kandidaten aus der letzten Suche bauen
    void naechsterKandidat(uint32_t now);
    void rundeVorbei(uint32_t now);
    int vorrang(const std::string& ssid) const;       // Platz in netze, -1 = unbekannt
    bool sucht_ = false, autoSuche_ = false, wechselSuche_ = false;
    uint32_t naechsteSuche_ = 0, verbindetSeit_ = 0, suchtSeit_ = 0, rundenPause_ = 15000, wechselFaellig_ = 0;
    bool verbindet_ = false, warVerbunden_ = false;
    std::vector<Kandidat> kandidaten_;
    size_t kandidatPos_ = 0;
    std::string vonHand_;     // von Hand gewaehltes Netz: solange verbunden, kein automatischer Wechsel
    bool versuchVersteckt_ = false;
    Versuch versuch_ = Versuch::Keiner;
    std::string versuchSsid_, versuchPasswort_;
    uint32_t versuchSeit_ = 0;

    // Anfragen
    std::deque<Offen> offen_;
    bool laeuft_ = false;
    Offen aktuell_;
    uint32_t gestartet_ = 0, naechsteId_ = 1;
    std::map<std::string, uint32_t> gemerkt_;   // Datei -> Pruefsumme (nur bei Aenderung schreiben)

    // Warteschlange
    std::deque<Wartend> wartend_;
    uint32_t schlangeFaellig_ = 0, schlangePause_ = 5000;
    bool schlangeLaeuft_ = false;
    uint32_t schreibStand_ = 0;

    // Kirchturm
    uint32_t kirchturmFaellig_ = 0, schnellBis_ = 0, letzterTon_ = 0, alarmTon_ = 0, alarmSeit_ = 0;
    bool kirchturmLaeuft_ = false;
    std::vector<std::pair<std::string, std::string>> alarm_;   // id, Titel
    std::vector<std::string> quittiert_, abgelaufen_;
};

}  // namespace haloos
