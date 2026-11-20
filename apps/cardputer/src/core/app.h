// Startmenue und Agentendorf-App fuer den Cardputer (hardware-unabhaengig, laeuft auch im PC-Test).
//
// Startmenue:  1 Fernbedienung (fuer die Brille, sucht den Hub per Bluetooth)
//              2 Agentendorf   (To-dos, Buergermeister, Kirchturm ... ueber WLAN, core/dorf.*)
// Die Ansichten liegen auf einem Stapel (push/pop). Gemeinsame Bausteine (Listen, Texteingabe,
// Rueckfrage, Datumswahl): core/ui.h. Die Agentendorf-Ansichten: core/dorf_ansichten.cpp.
#pragma once
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "cardo_data.h"
#include "dorf.h"
#include "gfx.h"
#include "net.h"
#include "remote_core.h"

namespace haloos {

constexpr const char* FIRMWARE_VERSION = "1.3.3";

enum class Sound { FocusStart, ShortBreak, LongBreak, BreakEnd, AllDone, Test };

class Platform {
public:
    virtual ~Platform() = default;
    virtual void play(Sound s, int volume) = 0;          // volume 1..3
    virtual uint32_t random() = 0;
    virtual int battery() const = 0;                     // Prozent, -1 = unbekannt
    virtual void startRemote() = 0;                      // Menuepunkt 1: Bluetooth an
    virtual void startDorf() = 0;                        // Menuepunkt 2: WLAN an (Bluetooth bleibt aus)
    virtual void restart() = 0;                          // Neustart ins Startmenue (Wechsel des Modus)
    // Dauerhafte Einstellungen (NVS): WLAN-Netze, Dorf-Adresse, Schluessel, zuletzt gewaehlter Modus
    virtual std::string setting(const std::string& key) = 0;
    virtual void setSetting(const std::string& key, const std::string& value) = 0;
    // Dateien (SD-Karte, sonst interner Speicher): Warteschlange und Zwischenspeicher
    virtual bool readFile(const std::string& name, std::string& out) = 0;
    virtual bool writeFile(const std::string& name, const std::string& data) = 0;
    virtual std::string storageName() const = 0;         // "SD-Karte" oder "intern"
    virtual void removeFile(const std::string& name) = 0;
    virtual uint32_t freeHeap() const { return 0; }      // freier Arbeitsspeicher in Bytes (0 = unbekannt)
    // Mikrofon (Spracheingabe): nimmt als WAV (PCM 16 Bit, mono, 16 kHz) direkt in eine Datei auf - nie ins RAM.
    // Waehrend der Aufnahme bleibt der Lautsprecher stumm (beide haengen am selben Codec).
    virtual int aufnahmeMaxSek() = 0;                             // wie lange Platz ist (0 = kein Mikrofon/kein Platz)
    virtual bool aufnahmeStart(const std::string& name) = 0;
    virtual int aufnahmePegel() = 0;                              // 0..100, laufender Pegel (in dB: -54..0 dBFS)
    virtual bool aufnahmeStopp(bool behalten) = 0;                // Datei abschliessen (false = verwerfen/Fehler)
    virtual std::string aufnahmeGrund() { return ""; }            // warum Start/Stopp scheiterte (fuer die Meldung)
    virtual int hochladenProzent() { return -1; }                 // Aufnahme wird gesendet: 0..100, sonst -1
    virtual void mikroStufe(int stufe) = 0;                       // Verstaerkung 1 leise, 2 normal, 3 laut
    // 1.3.3: Verstaerkung im Codec (ES8311-Register) statt nur in Software – kann am Geraet Ton verhindern, darum abschaltbar
    virtual void mikroRegister(bool an) { (void)an; }
    // 1.3.3: Mikrofon-Test – nimmt auf, ohne zu speichern; zeigt, ob und wie viel Ton ankommt
    struct MikroStand {
        bool laeuft = false;
        int puffer = 0;          // fertige Puffer (je 256 ms) seit dem Start
        int pegel = 0;           // aktueller Pegel 0..100 (dB-Skala)
        std::string grund;       // warum der Test nicht laeuft / abbrach
    };
    virtual bool mikroTestStart() { return false; }
    virtual MikroStand mikroTestStand() { return {}; }
    virtual void mikroTestStopp() {}
};

// Pegel als Balken: in dB, damit normale Sprache (-30..-10 dBFS) sichtbar ausschlaegt. roh = Spitzenwert 0..32767;
// -54 dBFS = 0 %, 0 dBFS = 100 %
int pegelProzent(int roh);

enum class K { Char, Enter, Del, Esc, Up, Down, Left, Right, Tab };   // Tab = in Textfeldern: Spracheingabe
struct Input {
    K k;
    std::string ch;   // bei K::Char das Zeichen (UTF-8)
};

// ------------------------------------------------------------------ Ansichten
class App;

class View {
public:
    virtual ~View() = default;
    uint32_t kennung = 0;                              // vergibt App::push (Adresse fuer Netz-Antworten)
    virtual void draw(Gfx& g, App& app, uint32_t now) = 0;
    virtual void key(const Input& in, App& app, uint32_t now) = 0;
    virtual bool animated() const { return false; }    // zweimal je Sekunde neu zeichnen
    virtual uint32_t animMs() const { return 500; }    // ... oder schneller (Pegel bei der Aufnahme)
    virtual bool wach() const { return false; }        // Bildschirm hell halten (Aufnahme laeuft)
    virtual void tick(App&, uint32_t) {}               // nur fuer die oberste Ansicht
    virtual void netz(App&, const Ergebnis&, uint32_t) {}   // Antwort auf eine eigene Anfrage
    virtual std::string auswahl() const { return ""; }    // Text der gewaehlten Zeile (fuer Tests)
};

class App {
public:
    App(Platform& p, Net& n, Clock& c);
    void begin(uint32_t now);
    void input(const Input& in, uint32_t now);
    void tick(uint32_t now);
    void render(Gfx& g, uint32_t now);
    bool needsRender(uint32_t now);
    int brightness(uint32_t now) const;   // 0 aus, 25 gedimmt, 100 hell

    // fuer die Ansichten
    Platform& platform;
    Clock& clock;
    Dorf dorf;
    void push(std::unique_ptr<View> v);
    void pop();
    void replace(std::unique_ptr<View> v);
    void popTo(size_t depth);
    size_t depth() const { return stack_.size(); }
    size_t dorfTiefe() const { return dorfTiefe_; }     // Stapelhoehe mit der Agentendorf-Startseite oben
    View* ansicht(uint32_t kennung) const;              // nullptr, wenn schon geschlossen
    bool lebt(uint32_t kennung) const { return ansicht(kennung) != nullptr; }
    void zustellen(uint32_t kennung, const Ergebnis& e, uint32_t now);
    void toast(const std::string& msg, uint32_t now);
    void wake(uint32_t now, uint32_t ms); // Display fuer ms hell
    void neuZeichnen() { dirty_ = true; }
    std::string auswahl() const { return stack_.empty() ? "" : stack_.back()->auswahl(); }
    int64_t today(uint32_t now) const;    // lokales Datum
    void openDorf(uint32_t now);
    void neuKoppeln(uint32_t now);        // Server sagt 401: Hinweis zeigen

    // gemeinsame Zeichenteile
    void header(Gfx& g, const std::string& title, uint32_t now, const std::string& right = "");
    void footer(Gfx& g, const std::string& hint, Color c = col::GREY);

private:
    std::vector<std::unique_ptr<View>> stack_;
    std::vector<std::unique_ptr<View>> graveyard_;   // geschlossene Ansichten erst spaeter loeschen
    std::string toast_;
    uint32_t now_ = 0;
    uint32_t toastUntil_ = 0, lastInput_ = 0, wakeUntil_ = 0, lastDraw_ = 0, naechsteKennung_ = 1;
    size_t dorfTiefe_ = 0;
    bool dirty_ = true;
};

// Bildschirm im Fernbedienungs-Modus
void drawRemoteScreen(Gfx& g, const Screen& s, const std::string& syncStatus, const std::string& clock,
                      bool holdHint);

// Uhrzeit-Eingabe deuten: "15", "930", "1530", "15:30", "15.30" -> "HH:MM"; "" -> "" (ganztaegig)
bool parseTimeInput(const std::string& in, std::string& out);
// Text in Zeilen umbrechen (hoechstens maxLines, Rest gekuerzt)
std::vector<std::string> wrapText(const Font& f, const std::string& s, int width, int maxLines);
// Umbruch ohne Kopien: Liste von (Start, Laenge) im Text; beachtet Zeilenwechsel, trennt ueberlange Woerter
std::vector<std::pair<uint32_t, uint32_t>> umbruch(const Font& f, const std::string& s, int width);

}  // namespace haloos
