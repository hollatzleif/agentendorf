// Agentendorf-Firmware fuer den M5Stack Cardputer Adv - Version 1.2 (auf Basis von HaloOS 0.3).
//
// Beim Einschalten erscheint ein Startmenue:
//   1 Fernbedienung  - wie HaloOS 0.3: meldet Tasten, Akku und Bewegung per Bluetooth an den Hub der Brille
//                      und gleicht dabei die Cardo-Daten mit dem Hub ab (unveraendert uebernommen)
//   2 Agentendorf    - To-dos, Buergermeister, Kirchturm, Kalender, Freigaben ... ueber WLAN und HTTPS
//                      (Vertrag: API.md). Bluetooth wird in diesem Modus NICHT gestartet - der Speicher
//                      gehoert WLAN und TLS.
// Zurueck ins Startmenue ist immer ein Neustart: im Fernbedienungs-Modus die Seitentaste 3 Sekunden
// halten, im Agentendorf Esc auf der Startseite. Der zuletzt gewaehlte Modus steht als Merker im NVS
// und ist beim naechsten Start vorgewaehlt.
//
// Die Logik steckt in core/ (laeuft auch auf dem PC: host/dorf_host.cpp). Diese Datei verbindet sie nur
// mit der Hardware. Bauen: tools/build.sh, aufspielen: ANLEITUNG.md

#include <M5Cardputer.h>
#include <NimBLEDevice.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <SD.h>
#include <SPI.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#include <bitset>
#include <cstring>
#include <deque>

#include "core/app.h"
#include "core/remote_core.h"
#include "haloos_protocol.h"
#include "zertifikate.h"

using namespace haloos;

namespace {

constexpr uint32_t BATTERY_INTERVAL_MS = 30000;
constexpr uint32_t LOOP_DELAY_MS = 5;
constexpr uint32_t SIDE_HOLD_MENU_MS = 3000;
constexpr uint8_t BRIGHT_FULL = 90, BRIGHT_DIM = 18;   // 0..255

// SD-Karte am Cardputer (M5Cardputer/examples/Basic/sdcard)
constexpr int SD_SCK = 40, SD_MISO = 39, SD_MOSI = 14, SD_CS = 12;
const char* const DIR = "/haloos";
const char* const FILE_MAIN = "/haloos/cardo.txt";
const char* const FILE_TMP = "/haloos/cardo.tmp";
const char* const FILE_BAK = "/haloos/cardo.bak";

Gfx g_gfx;
Store g_store;      // Cardo-Daten: nur noch fuer den Abgleich mit dem Hub im Fernbedienungs-Modus
Clock g_clock;
SyncLink g_link(g_store, g_clock);
fs::FS* g_fs = nullptr;
bool g_sd = false;
int g_battery = -1;
bool g_charging = false;

enum class Mode { App, Remote };
Mode g_mode = Mode::App;

// ------------------------------------------------------------------ Speicher
void mountStorage() {
    SPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);
    if (SD.begin(SD_CS, SPI, 25000000) && SD.cardType() != CARD_NONE) {
        g_fs = &SD;
        g_sd = true;
    } else if (LittleFS.begin(true)) {   // ohne SD-Karte: interner Speicher (wird beim ersten Mal formatiert)
        g_fs = &LittleFS;
    }
    if (g_fs && !g_fs->exists(DIR)) g_fs->mkdir(DIR);
}

bool readFile(const char* path, std::string& out) {
    if (!g_fs || !g_fs->exists(path)) return false;
    File f = g_fs->open(path, FILE_READ);
    if (!f) return false;
    out.clear();
    out.reserve(f.size());
    uint8_t buf[256];
    while (f.available()) {
        const int n = f.read(buf, sizeof buf);
        if (n <= 0) break;
        out.append(reinterpret_cast<const char*>(buf), n);
    }
    f.close();
    return true;
}

// Sicher schreiben: erst in eine neue Datei, dann umbenennen. bak = die alte Fassung aufbewahren
bool writeFileSafe(const char* path, const char* tmp, const char* bak, const std::string& data) {
    if (!g_fs) return false;
    File f = g_fs->open(tmp, FILE_WRITE);
    if (!f) return false;
    const size_t n = f.write(reinterpret_cast<const uint8_t*>(data.data()), data.size());
    f.close();
    if (n != data.size()) return false;
    if (g_fs->exists(path)) {
        if (bak != nullptr) {
            if (g_fs->exists(bak)) g_fs->remove(bak);
            g_fs->rename(path, bak);
        } else {
            g_fs->remove(path);
        }
    }
    return g_fs->rename(tmp, path);
}

bool writeFile(const std::string& data) { return writeFileSafe(FILE_MAIN, FILE_TMP, FILE_BAK, data); }

void loadStore(uint32_t now) {
    std::string text;
    if (!(readFile(FILE_MAIN, text) && g_store.load(text))) {
        if (readFile(FILE_BAK, text)) g_store.load(text);
    }
    g_clock.restore(g_store.savedUtc, g_store.savedOffset, now);
}

// ------------------------------------------------------------------ Ton (nicht blockierend)
struct Note {
    uint16_t hz, ms, gap;
};
std::deque<Note> g_notes;
uint32_t g_next_note = 0;

void queueSound(Sound s) {
    static const Note FOCUS[] = {{523, 110, 30}, {659, 110, 30}, {784, 220, 0}};
    static const Note SHORT_B[] = {{784, 150, 40}, {659, 260, 0}};
    static const Note LONG_B[] = {{784, 140, 40}, {659, 140, 40}, {523, 140, 40}, {392, 360, 0}};
    static const Note BREAK_END[] = {{880, 90, 70}, {880, 90, 70}, {1047, 260, 0}};
    static const Note DONE[] = {{523, 120, 30}, {659, 120, 30}, {784, 120, 30}, {1047, 420, 0}};
    static const Note TEST[] = {{660, 120, 40}, {880, 160, 0}};
    const Note* seq = TEST;
    size_t n = 2;
    switch (s) {
        case Sound::FocusStart: seq = FOCUS; n = 3; break;
        case Sound::ShortBreak: seq = SHORT_B; n = 2; break;
        case Sound::LongBreak: seq = LONG_B; n = 4; break;
        case Sound::BreakEnd: seq = BREAK_END; n = 3; break;
        case Sound::AllDone: seq = DONE; n = 4; break;
        default: break;
    }
    g_notes.clear();
    for (size_t i = 0; i < n; ++i) g_notes.push_back(seq[i]);
    g_next_note = 0;
}

// ------------------------------------------------------------------ Mikrofon (Spracheingabe)
// Cardputer Adv: Mikrofon und Lautsprecher haengen am selben Codec (ES8311) und teilen sich die I2S-Leitungen
// BCK = G41 und WS = G43 (M5Unified.inl: board_M5CardputerADV, _microphone_enabled_cb_cardputer_adv setzt den
// Codec zurueck und schaltet den ADC ein). Deshalb wie im Beispiel der Bibliothek (M5Cardputer/examples/Basic/
// mic_wav_record): Speaker.end() -> Mic.begin() -> aufnehmen -> Mic.end() -> Speaker.begin(). Toene sind solange aus.
//
// Kein PSRAM: Es wird nie die ganze Aufnahme im RAM gehalten. Eine eigene Aufgabe reicht drei Puffer zu je
// 4096 Werten (256 ms) reihum an Mic.record() - die Bibliothek fuellt immer einen und haelt einen in Reserve -
// und schreibt den jeweils fertigen in die WAV-Datei. So darf ein Schreibvorgang bis ~250 ms haengen, ohne dass
// Ton verloren geht. Der WAV-Kopf wird am Ende mit der wahren Laenge ueberschrieben.
constexpr size_t AUFN_WERTE = 4096;
constexpr uint32_t AUFN_RATE = 16000;
constexpr uint32_t AUFN_BYTES_JE_SEK = AUFN_RATE * 2;

struct Aufnahme {
    volatile bool laeuft = false, stoppen = false, fertig = false, fehler = false;
    volatile int pegel = 0;
    volatile uint32_t bytes = 0;
    int16_t* puffer[3] = {nullptr, nullptr, nullptr};
    File datei;
    std::string pfad;
};
Aufnahme g_aufn;
uint8_t g_mikro_faktor = 16;      // mic_config_t::magnification (Vorgabe der Bibliothek: 16)

void wavKopf(File& f, uint32_t datenBytes) {
    uint8_t k[44];
    auto u32 = [&](int at, uint32_t v) { for (int i = 0; i < 4; ++i) k[at + i] = static_cast<uint8_t>(v >> (8 * i)); };
    auto u16 = [&](int at, uint16_t v) { k[at] = static_cast<uint8_t>(v); k[at + 1] = static_cast<uint8_t>(v >> 8); };
    memcpy(k, "RIFF", 4);
    u32(4, 36 + datenBytes);
    memcpy(k + 8, "WAVEfmt ", 8);
    u32(16, 16);
    u16(20, 1);                     // PCM
    u16(22, 1);                     // mono
    u32(24, AUFN_RATE);
    u32(28, AUFN_BYTES_JE_SEK);
    u16(32, 2);
    u16(34, 16);
    memcpy(k + 36, "data", 4);
    u32(40, datenBytes);
    f.write(k, sizeof k);
}

void aufnahmeSchreiben(const int16_t* p) {
    int peak = 0;
    for (size_t i = 0; i < AUFN_WERTE; ++i) {
        const int v = p[i] < 0 ? -p[i] : p[i];
        if (v > peak) peak = v;
    }
    g_aufn.pegel = peak * 100 / 32768;
    const size_t n = AUFN_WERTE * sizeof(int16_t);
    if (g_aufn.datei.write(reinterpret_cast<const uint8_t*>(p), n) != n) g_aufn.fehler = true;   // Speicher voll?
    else g_aufn.bytes = g_aufn.bytes + n;
}

void aufnahmeAufgabe(void*) {
    size_t i = 0;
    while (!g_aufn.stoppen && !g_aufn.fehler) {
        // wartet, solange beide Plaetze der Bibliothek belegt sind; danach ist der Puffer von vor zwei Runden voll
        if (!M5Cardputer.Mic.record(g_aufn.puffer[i % 3], AUFN_WERTE, AUFN_RATE)) {
            g_aufn.fehler = true;
            break;
        }
        if (i >= 2) aufnahmeSchreiben(g_aufn.puffer[(i - 2) % 3]);
        ++i;
    }
    while (M5Cardputer.Mic.isRecording()) vTaskDelay(pdMS_TO_TICKS(5));     // die beiden letzten Puffer fertig fuellen
    if (!g_aufn.fehler && i >= 2) aufnahmeSchreiben(g_aufn.puffer[(i - 2) % 3]);
    if (!g_aufn.fehler && i >= 1) aufnahmeSchreiben(g_aufn.puffer[(i - 1) % 3]);
    M5Cardputer.Mic.end();
    if (!g_aufn.datei.seek(0)) g_aufn.fehler = true;
    else wavKopf(g_aufn.datei, g_aufn.bytes);
    g_aufn.datei.close();
    M5Cardputer.Speaker.begin();      // Lautsprecher wieder an (Codec zurueck auf Wiedergabe)
    g_aufn.fertig = true;
    vTaskDelete(nullptr);
}

void aufnahmeAufraeumen() {
    for (auto& p : g_aufn.puffer) {
        free(p);
        p = nullptr;
    }
    g_aufn.laeuft = false;
}

bool aufnahmeStart(const std::string& pfad) {
    if (g_aufn.laeuft || !g_fs || !M5Cardputer.Mic.isEnabled()) return false;
    g_notes.clear();
    for (auto& p : g_aufn.puffer) p = static_cast<int16_t*>(malloc(AUFN_WERTE * sizeof(int16_t)));
    if (!g_aufn.puffer[0] || !g_aufn.puffer[1] || !g_aufn.puffer[2]) { aufnahmeAufraeumen(); return false; }
    if (g_fs->exists(pfad.c_str())) g_fs->remove(pfad.c_str());
    g_aufn.datei = g_fs->open(pfad.c_str(), FILE_WRITE);
    if (!g_aufn.datei) { aufnahmeAufraeumen(); return false; }
    wavKopf(g_aufn.datei, 0);         // Platzhalter, wird am Ende ueberschrieben
    M5Cardputer.Speaker.end();
    auto cfg = M5Cardputer.Mic.config();
    cfg.magnification = g_mikro_faktor;
    M5Cardputer.Mic.config(cfg);
    if (!M5Cardputer.Mic.begin()) {
        g_aufn.datei.close();
        g_fs->remove(pfad.c_str());
        M5Cardputer.Speaker.begin();
        aufnahmeAufraeumen();
        return false;
    }
    g_aufn.pfad = pfad;
    g_aufn.stoppen = g_aufn.fertig = g_aufn.fehler = false;
    g_aufn.bytes = 0;
    g_aufn.pegel = 0;
    g_aufn.laeuft = true;
    if (xTaskCreatePinnedToCore(aufnahmeAufgabe, "aufnahme", 4096, nullptr, 2, nullptr, 1) != pdPASS) {
        M5Cardputer.Mic.end();
        g_aufn.datei.close();
        g_fs->remove(pfad.c_str());
        M5Cardputer.Speaker.begin();
        aufnahmeAufraeumen();
        return false;
    }
    return true;
}

// Haelt die Oberflaeche kurz an (bis die letzten ~0,5 s Ton geschrieben sind)
bool aufnahmeStopp(bool behalten) {
    if (!g_aufn.laeuft) return false;
    g_aufn.stoppen = true;
    const uint32_t seit = millis();
    while (!g_aufn.fertig && millis() - seit < 5000) delay(5);
    const bool ok = g_aufn.fertig && !g_aufn.fehler && g_aufn.bytes > 0;
    if (g_aufn.fertig) aufnahmeAufraeumen();      // sonst haengt die Aufgabe noch: Puffer lieber nicht freigeben
    else g_aufn.laeuft = false;
    if ((!ok || !behalten) && g_fs) g_fs->remove(g_aufn.pfad.c_str());
    return ok && behalten;
}

// Wie viele Sekunden passen in den Speicher? Intern (LittleFS, 1,5 MB) reicht es fuer rund 40 s, mit SD-Karte fuer 60.
int aufnahmeMaxSek() {
    if (!g_fs || !M5Cardputer.Mic.isEnabled()) return 0;
    if (g_sd) return 60;              // freien Platz auf grossen Karten zu zaehlen dauert Sekunden; Schreibfehler faengt die Aufnahme ab
    const size_t gesamt = LittleFS.totalBytes(), belegt = LittleFS.usedBytes();
    const size_t frei = gesamt > belegt ? gesamt - belegt : 0;
    const size_t reserve = 96 * 1024;      // fuer Warteschlange, Zwischenspeicher und die Verwaltung des Dateisystems
    if (frei <= reserve) return 0;
    return static_cast<int>(std::min<size_t>(60, (frei - reserve) / AUFN_BYTES_JE_SEK));
}

void pumpSound(uint32_t now) {
    if (g_aufn.laeuft) return;
    if (g_notes.empty() || static_cast<int32_t>(now - g_next_note) < 0) return;
    const Note n = g_notes.front();
    g_notes.pop_front();
    M5Cardputer.Speaker.tone(n.hz, n.ms);
    g_next_note = now + n.ms + n.gap;
}

// ------------------------------------------------------------------ Netz: WLAN + HTTPS
// Warum eine eigene Aufgabe (FreeRTOS-Task) und nicht blockierend in loop(): ein TLS-Handshake auf dem
// ESP32-S3 dauert 1-3 Sekunden, bei schlechtem Hotspot laenger. In der Zeit muessen Tasten, die
// laufende Kirchturm-Uhr und das Laeuten weitergehen. Die Aufgabe bearbeitet immer genau eine Anfrage;
// Anfrage und Antwort wandern als Zeiger durch zwei Warteschlangen der Laenge 1, die Oberflaeche fragt
// nur ab (Net::poll). Die Verbindung bleibt offen (keep-alive), damit nicht jede Anfrage neu verhandelt.
constexpr size_t MAX_ANTWORT = 48 * 1024;     // groessere Antworten werden abgelehnt (kein PSRAM)
constexpr int32_t VERBINDEN_MS = 6000;
constexpr uint16_t LESEN_MS = 8000;
constexpr unsigned long HANDSHAKE_S = 8;

// Senke fuer HTTPClient::writeToStream: schreibt den Antworttext ohne Umweg in einen std::string
class TextSenke : public Stream {
public:
    explicit TextSenke(std::string& ziel) : ziel_(ziel) {}
    size_t write(uint8_t c) override { return write(&c, 1); }
    size_t write(const uint8_t* buf, size_t n) override {
        if (ziel_.size() + n > MAX_ANTWORT) {
            zuGross = true;
            return 0;
        }
        ziel_.append(reinterpret_cast<const char*>(buf), n);
        return n;
    }
    int available() override { return 0; }
    int read() override { return -1; }
    int peek() override { return -1; }
    void flush() override {}
    bool zuGross = false;

private:
    std::string& ziel_;
};

QueueHandle_t g_netz_ein = nullptr, g_netz_aus = nullptr;

// Datei hochladen (Spracheingabe) - von Hand ueber die TLS-Verbindung statt mit HTTPClient: dessen Zeitrahmen
// ist ein uint16_t (hoechstens 65 s), das Abschreiben einer langen Aufnahme dauert laenger. Die Datei geht in
// 2-KB-Stuecken raus, nie ganz in den Speicher. Eigene Verbindung (Connection: close).
void hochladen(WiFiClientSecure& tls, const Anfrage& a, const std::string& host, uint16_t port, Antwort& r) {
    if (!g_fs) { r.grund = "kein Speicher"; return; }
    File f = g_fs->open((std::string(DIR) + "/" + a.datei).c_str(), FILE_READ);
    if (!f) { r.grund = "Datei fehlt"; return; }
    const size_t groesse = f.size();
    if (!tls.connect(host.c_str(), port, VERBINDEN_MS)) {
        f.close();
        r.grund = "keine Verbindung";
        return;
    }
    std::string kopf = "POST " + a.pfad + " HTTP/1.1\r\nHost: " + host + "\r\nAccept: application/json\r\nConnection: close\r\n";
    if (!a.token.empty()) kopf += "Authorization: Bearer " + a.token + "\r\n";
    kopf += "Content-Type: " + a.inhaltTyp + "\r\nContent-Length: " + std::to_string(groesse) + "\r\n\r\n";
    bool ok = tls.write(reinterpret_cast<const uint8_t*>(kopf.data()), kopf.size()) == kopf.size();
    uint8_t* stueck = static_cast<uint8_t*>(malloc(2048));
    size_t gesendet = 0;
    while (ok && stueck && gesendet < groesse) {
        const int n = f.read(stueck, 2048);
        if (n <= 0) break;
        ok = tls.write(stueck, static_cast<size_t>(n)) == static_cast<size_t>(n);
        gesendet += static_cast<size_t>(n);
    }
    free(stueck);
    f.close();
    if (!ok || gesendet != groesse) {
        tls.stop();
        r.grund = "Hochladen abgebrochen";
        return;
    }
    // Antwort lesen: Geduld bis fristMs (der Server schreibt erst ab), dann Kopf und Text
    const uint32_t frist = a.fristMs ? a.fristMs : LESEN_MS;
    const uint32_t seit = millis();
    std::string roh;
    size_t kopfEnde = std::string::npos;
    long laenge = -1;
    while (millis() - seit < frist && roh.size() < MAX_ANTWORT) {
        const int da = tls.available();
        if (da > 0) {
            char buf[256];
            const int n = tls.read(reinterpret_cast<uint8_t*>(buf), std::min<int>(da, sizeof buf));
            if (n > 0) roh.append(buf, static_cast<size_t>(n));
            if (kopfEnde == std::string::npos) {
                kopfEnde = roh.find("\r\n\r\n");
                if (kopfEnde != std::string::npos) {
                    std::string klein = roh.substr(0, kopfEnde);
                    for (auto& c : klein) c = static_cast<char>(tolower(c));
                    const size_t cl = klein.find("content-length:");
                    if (cl != std::string::npos) laenge = atol(klein.c_str() + cl + 15);
                    const size_t ra = klein.find("retry-after:");
                    if (ra != std::string::npos) r.wartenSek = atoi(klein.c_str() + ra + 12);
                }
            }
            if (kopfEnde != std::string::npos && laenge >= 0 && roh.size() >= kopfEnde + 4 + static_cast<size_t>(laenge)) break;
        } else if (!tls.connected()) {
            break;
        } else {
            vTaskDelay(pdMS_TO_TICKS(20));
        }
    }
    tls.stop();
    if (kopfEnde == std::string::npos || roh.size() < 12 || roh.compare(0, 5, "HTTP/") != 0) {
        r.grund = "keine Antwort";
        return;
    }
    r.status = atoi(roh.c_str() + 9);
    std::string text = roh.substr(kopfEnde + 4);
    if (laenge < 0 && !text.empty() && text[0] != '{') {      // ohne Laengenangabe gestueckelt (chunked): zusammensetzen
        std::string ganz;
        size_t i = 0;
        while (i < text.size()) {
            const size_t z = text.find("\r\n", i);
            if (z == std::string::npos) break;
            const size_t n = strtoul(text.c_str() + i, nullptr, 16);
            if (n == 0 || z + 2 + n > text.size()) break;
            ganz.append(text, z + 2, n);
            i = z + 2 + n + 2;
        }
        text = ganz;
    }
    r.koerper = text;
}

void netzAufgabe(void*) {
    static WiFiClientSecure tls;
    static HTTPClient http;
    static const char* kopfzeilen[] = {"Retry-After"};
    std::string verbundenMit;
    tls.setCACert(DORF_WURZELN);            // nur diese Wurzeln gelten - nie setInsecure()
    tls.setHandshakeTimeout(HANDSHAKE_S);
    for (;;) {
        Anfrage* a = nullptr;
        if (xQueueReceive(g_netz_ein, &a, portMAX_DELAY) != pdTRUE || a == nullptr) continue;
        Antwort* r = new Antwort();
        r->id = a->id;
        const std::string vorsatz = "https://";
        if (a->basis.compare(0, vorsatz.size(), vorsatz) != 0) {
            r->grund = "nur https";
        } else if (WiFi.status() != WL_CONNECTED) {
            r->grund = "kein WLAN";
        } else {
            std::string host = a->basis.substr(vorsatz.size());
            uint16_t port = 443;
            const size_t dp = host.find(':');
            if (dp != std::string::npos) {
                port = static_cast<uint16_t>(atoi(host.c_str() + dp + 1));
                host.erase(dp);
            }
            if (host != verbundenMit) {       // anderes Dorf (neu gekoppelt): alte Verbindung schliessen
                http.end();
                tls.stop();
                verbundenMit = host;
            }
            if (!a->datei.empty()) {            // Spracheingabe: Datei hochladen, lange auf die Antwort warten
                http.end();
                tls.stop();
                hochladen(tls, *a, host, port, *r);
            }
            // Zweiter Versuch nur, wenn eine offen gehaltene Verbindung inzwischen tot war. Gefahrlos:
            // Lesen sowieso, Schreiben traegt X-Vorgang (der Server fuehrt nichts doppelt aus).
            const int versuche = !a->datei.empty() ? 0 : (!a->post || !a->vorgang.empty()) ? 2 : 1;
            for (int v = 0; v < versuche; ++v) {
                const bool warOffen = tls.connected();
                http.setReuse(true);
                http.setConnectTimeout(VERBINDEN_MS);
                http.setTimeout(LESEN_MS);
                if (!http.begin(tls, String(host.c_str()), port, String(a->pfad.c_str()), true)) {
                    r->grund = "Adresse";
                    break;
                }
                http.collectHeaders(kopfzeilen, 1);
                http.addHeader("Accept", "application/json");
                if (!a->token.empty()) http.addHeader("Authorization", String("Bearer ") + a->token.c_str());
                if (!a->vorgang.empty()) http.addHeader("X-Vorgang", a->vorgang.c_str());
                int code;
                if (a->post) {
                    http.addHeader("Content-Type", "application/json");
                    code = http.POST(reinterpret_cast<uint8_t*>(const_cast<char*>(a->koerper.data())), a->koerper.size());
                } else {
                    code = http.GET();
                }
                if (code > 0) {
                    r->status = code;
                    r->wartenSek = http.header("Retry-After").toInt();
                    const int laenge = http.getSize();
                    if (laenge > static_cast<int>(MAX_ANTWORT)) {
                        r->status = 0;
                        r->grund = "Antwort zu gross";
                        tls.stop();
                    } else {
                        if (laenge > 0) r->koerper.reserve(static_cast<size_t>(laenge));
                        TextSenke senke(r->koerper);
                        const int n = http.writeToStream(&senke);
                        if (n < 0 || senke.zuGross) {      // abgebrochen: lieber "kein Netz" als halbe Daten
                            r->status = 0;
                            r->koerper.clear();
                            r->grund = senke.zuGross ? "Antwort zu gross" : "Antwort abgebrochen";
                            tls.stop();
                        }
                    }
                    http.end();
                    break;
                }
                r->grund = http.errorToString(code).c_str();
                http.end();
                tls.stop();
                if (!warOffen) break;      // frische Verbindung hat auch nicht geklappt
            }
        }
        delete a;
        xQueueSend(g_netz_aus, &r, portMAX_DELAY);
    }
}

class GeraetNetz : public Net {
public:
    void begin() {
        if (an_) return;
        an_ = true;
        WiFi.persistent(false);            // Zugangsdaten verwaltet die App selbst (NVS "dorf")
        WiFi.mode(WIFI_STA);
        WiFi.setAutoReconnect(false);      // das Wiederverbinden steuert core/dorf.cpp (suchen -> erstes bekanntes Netz)
        WiFi.setHostname("cardputer");
        g_netz_ein = xQueueCreate(1, sizeof(Anfrage*));
        g_netz_aus = xQueueCreate(1, sizeof(Antwort*));
        // Kern 0 (dort laeuft auch der WLAN-Stapel), loop() bleibt auf Kern 1 fluessig
        xTaskCreatePinnedToCore(netzAufgabe, "dorfnetz", 14336, nullptr, 1, nullptr, 0);
    }
    void wlanSuchen() override {
        if (!an_) return;
        WiFi.scanDelete();
        sucht_ = WiFi.scanNetworks(true) != WIFI_SCAN_FAILED;   // true = im Hintergrund
        sucheSeit_ = millis();
        if (!sucht_) sucheFehl_ = true;
    }
    bool wlanGefunden(std::vector<WlanNetz>& netze) override {
        if (sucheFehl_) { sucheFehl_ = false; return true; }
        if (!sucht_) return false;
        const int16_t n = WiFi.scanComplete();
        if (n == WIFI_SCAN_RUNNING && millis() - sucheSeit_ < 15000) return false;
        sucht_ = false;
        for (int i = 0; i < n; ++i) {
            WlanNetz w;
            w.ssid = WiFi.SSID(i).c_str();
            w.rssi = WiFi.RSSI(i);
            w.offen = WiFi.encryptionType(i) == WIFI_AUTH_OPEN;
            netze.push_back(w);
        }
        WiFi.scanDelete();
        return true;
    }
    void wlanVerbinden(const std::string& ssid, const std::string& passwort) override {
        if (!an_) return;
        WiFi.disconnect();
        if (passwort.empty()) WiFi.begin(ssid.c_str());
        else WiFi.begin(ssid.c_str(), passwort.c_str());
        versucht_ = true;
        versuchSeit_ = millis();
    }
    void wlanTrennen() override {
        if (!an_) return;
        versucht_ = false;
        WiFi.disconnect();
    }
    WlanZustand wlanZustand() override {
        if (!an_) return WlanZustand::Aus;
        const wl_status_t s = WiFi.status();
        if (s == WL_CONNECTED) return WlanZustand::Verbunden;
        if (versucht_) {
            const uint32_t seit = millis() - versuchSeit_;
            if (s == WL_CONNECT_FAILED && seit > 1500) return WlanZustand::Fehler;      // falsches Passwort
            if (s == WL_NO_SSID_AVAIL && seit > 6000) return WlanZustand::Fehler;       // Netz nicht (mehr) da
            if (seit < 20000) return WlanZustand::Verbindet;
        }
        return WlanZustand::Getrennt;
    }
    std::string wlanName() override {
        if (!an_ || WiFi.status() != WL_CONNECTED) return "";
        return WiFi.SSID().c_str();
    }
    bool start(const Anfrage& a) override {
        if (!an_ || laeuft_) return false;
        Anfrage* kopie = new Anfrage(a);
        if (xQueueSend(g_netz_ein, &kopie, 0) != pdTRUE) {
            delete kopie;
            return false;
        }
        laeuft_ = true;
        return true;
    }
    bool poll(Antwort& out) override {
        if (!laeuft_) return false;
        Antwort* r = nullptr;
        if (xQueueReceive(g_netz_aus, &r, 0) != pdTRUE || r == nullptr) return false;
        out = std::move(*r);
        delete r;
        laeuft_ = false;
        return true;
    }

private:
    bool an_ = false, laeuft_ = false, sucht_ = false, sucheFehl_ = false, versucht_ = false;
    uint32_t sucheSeit_ = 0, versuchSeit_ = 0;
};

GeraetNetz g_netz;

// ------------------------------------------------------------------ Plattform fuer die App
void startRemote();

class DevicePlatform : public Platform {
public:
    void play(Sound s, int volume) override {
        if (g_aufn.laeuft) return;      // waehrend der Aufnahme gehoert der Codec dem Mikrofon
        M5Cardputer.Speaker.setVolume(volume <= 1 ? 70 : volume >= 3 ? 230 : 150);
        queueSound(s);
    }
    uint32_t random() override { return esp_random(); }
    int battery() const override { return g_battery; }
    void startRemote() override { ::startRemote(); }
    void startDorf() override { g_netz.begin(); }
    void restart() override {
        M5Cardputer.Display.setBrightness(0);
        delay(100);
        ESP.restart();
    }
    // Einstellungen der Agentendorf-App: NVS-Bereich "dorf" (die Fernbedienung nutzt weiter "haloos")
    std::string setting(const std::string& key) override {
        Preferences prefs;
        std::string out;
        if (prefs.begin("dorf", true)) {
            out = prefs.getString(key.c_str(), "").c_str();
            prefs.end();
        }
        return out;
    }
    void setSetting(const std::string& key, const std::string& value) override {
        Preferences prefs;
        if (prefs.begin("dorf", false)) {
            if (value.empty()) prefs.remove(key.c_str());
            else prefs.putString(key.c_str(), value.c_str());
            prefs.end();
        }
    }
    bool readFile(const std::string& name, std::string& out) override {
        return ::readFile((std::string(DIR) + "/" + name).c_str(), out);
    }
    bool writeFile(const std::string& name, const std::string& data) override {
        const std::string pfad = std::string(DIR) + "/" + name;
        return writeFileSafe(pfad.c_str(), (pfad + ".tmp").c_str(), nullptr, data);
    }
    void removeFile(const std::string& name) override {
        const std::string pfad = std::string(DIR) + "/" + name;
        if (g_fs && g_fs->exists(pfad.c_str())) g_fs->remove(pfad.c_str());
    }
    std::string storageName() const override { return g_sd ? "SD-Karte" : "intern"; }
    uint32_t freeHeap() const override { return ESP.getFreeHeap(); }
    int aufnahmeMaxSek() override {
        removeFile(Dorf::SPRACH_DATEI);      // ein liegengebliebener Rest zaehlt nicht als belegt
        return ::aufnahmeMaxSek();
    }
    bool aufnahmeStart(const std::string& name) override { return ::aufnahmeStart(std::string(DIR) + "/" + name); }
    int aufnahmePegel() override { return g_aufn.laeuft ? g_aufn.pegel : 0; }
    bool aufnahmeStopp(bool behalten) override { return ::aufnahmeStopp(behalten); }
    void mikroStufe(int stufe) override { g_mikro_faktor = stufe <= 1 ? 8 : stufe >= 3 ? 32 : 16; }
};

DevicePlatform g_platform;
App g_app(g_platform, g_netz, g_clock);

// ------------------------------------------------------------------ Fernbedienung (Bluetooth)
NimBLEServer* g_server = nullptr;
NimBLECharacteristic* g_tx = nullptr;
volatile bool g_subscribed_event = false;
volatile bool g_disconnected_event = false;
volatile uint16_t g_mtu = 23;
QueueHandle_t g_hub_writes = nullptr;
struct HubWrite {
    uint8_t len;
    uint8_t data[244];
};

class CardputerIO : public RemoteIO {
public:
    void sendToHub(const uint8_t* data, size_t len) override {
        if (g_tx != nullptr && g_server != nullptr && g_server->getConnectedCount() > 0) g_tx->notify(data, len);
    }
    void showScreen(const Screen& s) override {
        screen = s;
        dirty = true;
    }
    Screen screen;
    bool dirty = true;
};

CardputerIO g_io;
RemoteCore g_core(g_io);

class ServerCallbacks : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer* server, NimBLEConnInfo& info) override {
        server->updateConnParams(info.getConnHandle(), 12, 24, 0, 400);   // 15-30 ms: schnelle Tasten
    }
    void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int) override { g_disconnected_event = true; }
    void onMTUChange(uint16_t mtu, NimBLEConnInfo&) override { g_mtu = mtu; }
};

class TxCallbacks : public NimBLECharacteristicCallbacks {
    void onSubscribe(NimBLECharacteristic*, NimBLEConnInfo& info, uint16_t sub_value) override {
        g_mtu = info.getMTU();
        if (sub_value & 0x0001) g_subscribed_event = true;
    }
};

class RxCallbacks : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* chr, NimBLEConnInfo&) override {
        const NimBLEAttValue v = chr->getValue();
        HubWrite w{};
        w.len = static_cast<uint8_t>(std::min<size_t>(v.length(), sizeof w.data));
        memcpy(w.data, v.data(), w.len);
        xQueueSend(g_hub_writes, &w, pdMS_TO_TICKS(20));
    }
};

ServerCallbacks g_server_cb;
TxCallbacks g_tx_cb;
RxCallbacks g_rx_cb;

void setupBluetooth() {
    NimBLEDevice::init("");
    NimBLEDevice::setMTU(247);
    std::string addr = NimBLEDevice::getAddress().toString();
    std::string suffix;
    for (char c : addr.substr(addr.size() - 5))
        if (c != ':') suffix += static_cast<char>(toupper(c));
    const std::string name = std::string(REMOTE_NAME_PREFIX) + "-" + suffix;
    NimBLEDevice::setDeviceName(name);

    g_server = NimBLEDevice::createServer();
    g_server->setCallbacks(&g_server_cb);
    g_server->advertiseOnDisconnect(true);
    NimBLEService* svc = g_server->createService(REMOTE_SERVICE_UUID);
    g_tx = svc->createCharacteristic(REMOTE_TX_UUID, NIMBLE_PROPERTY::NOTIFY | NIMBLE_PROPERTY::READ);
    g_tx->setCallbacks(&g_tx_cb);
    NimBLECharacteristic* rx =
        svc->createCharacteristic(REMOTE_RX_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
    rx->setCallbacks(&g_rx_cb);

    NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
    adv->enableScanResponse(true);   // Name in die Scan-Antwort, sonst passt die 128-Bit-UUID nicht
    adv->setName(name);
    adv->addServiceUUID(REMOTE_SERVICE_UUID);
    adv->start();
}

void pollBattery(uint32_t now, bool force) {
    static uint32_t last = 0;
    if (!force && now - last < BATTERY_INTERVAL_MS) return;
    last = now;
    const int level = M5Cardputer.Power.getBatteryLevel();
    g_charging = M5Cardputer.Power.isCharging() == m5::Power_Class::is_charging;
    if (level >= 0) {
        g_battery = level;
        if (g_mode == Mode::Remote) g_core.onBattery(level, g_charging, now);
    }
}

void startRemote() {
    if (g_mode == Mode::Remote) return;
    g_mode = Mode::Remote;
    setCpuFrequencyMhz(80);   // reicht fuer Tastatur + Bluetooth, spart Strom
    g_hub_writes = xQueueCreate(16, sizeof(HubWrite));
    const uint32_t now = millis();
    loadStore(now);           // Cardo-Daten fuer den Abgleich (frueher schon beim Einschalten geladen)
    g_core.begin(now);
    {
        Preferences prefs;   // gespeicherte Einstellungen der Fernbedienung (Firmware 0.3)
        if (prefs.begin("haloos", true)) {
            g_core.setStoredSettings(prefs.getString("fb", "").c_str());
            prefs.end();
        }
    }
    pollBattery(now, true);
    setupBluetooth();
}

std::bitset<KEY_COUNT> g_pressed;

void pollRemoteKeys(uint32_t now) {
    std::bitset<KEY_COUNT> current;
    for (const auto& p : M5Cardputer.Keyboard.keyList())
        if (p.x >= 0 && p.x < KEY_COLS && p.y >= 0 && p.y < KEY_ROWS) current.set(p.y * KEY_COLS + p.x);
    if (M5Cardputer.BtnA.isPressed()) current.set(SIDE_BUTTON);
    const auto changed = current ^ g_pressed;
    if (changed.none()) return;
    for (uint8_t id = 0; id < KEY_COUNT; ++id)
        if (changed.test(id) && !current.test(id)) g_core.onKey(id, false, now);
    for (uint8_t id = 0; id < KEY_COUNT; ++id)
        if (changed.test(id) && current.test(id)) g_core.onKey(id, true, now);
    g_pressed = current;
}

void loopRemote(uint32_t now) {
    if (g_disconnected_event) {
        g_disconnected_event = false;
        g_subscribed_event = false;
        g_core.onHubDisconnected(now);
        g_link.disconnected();
        g_io.dirty = true;
    }
    if (g_subscribed_event) {
        g_subscribed_event = false;
        pollBattery(now, true);
        g_core.setMtu(g_mtu);
        g_core.onHubSubscribed(now);
        g_link.connected(now, g_mtu);   // Cardo-Mini abgleichen (startet nach 1,5 s)
    }
    HubWrite w;
    while (xQueueReceive(g_hub_writes, &w, 0) == pdTRUE) {
        if (w.len > 0 && w.data[0] == HUB_SYNC) g_link.onPacket(w.data, w.len, now);
        else g_core.onHubWrite(w.data, w.len, now);
    }
    if (g_link.takeChanged()) {
        g_store.savedUtc = g_clock.utc(now);
        g_store.savedOffset = g_clock.offset();
        writeFile(g_store.dump());
        g_io.dirty = true;
    }
    // Abgleich-Pakete gemaechlich senden (eins je Durchlauf), damit Tasten nicht warten
    std::vector<uint8_t> pkt;
    if (g_link.nextPacket(pkt, now)) g_io.sendToHub(pkt.data(), pkt.size());
    g_link.tick(now);

    pollRemoteKeys(now);
    pollBattery(now, false);
    if (g_core.imuRate() != 0 && M5.Imu.update()) {
        float ax, ay, az, gx, gy, gz;
        M5.Imu.getAccel(&ax, &ay, &az);
        M5.Imu.getGyro(&gx, &gy, &gz);
        g_core.onImuSample(ax, ay, az, gx, gy, gz, now);
    }
    g_core.tick(now);
    std::string settings;
    if (g_core.takeSettingsToSave(settings)) {
        Preferences prefs;
        if (prefs.begin("haloos", false)) {
            prefs.putString("fb", settings.c_str());
            prefs.end();
        }
    }

    // Seitentaste 3 s halten: zurueck ins Startmenue (Neustart)
    const bool holding = M5Cardputer.BtnA.isPressed() && M5Cardputer.BtnA.pressedFor(1000);
    if (M5Cardputer.BtnA.isPressed() && M5Cardputer.BtnA.pressedFor(SIDE_HOLD_MENU_MS)) {
        M5Cardputer.Display.setBrightness(0);
        delay(100);
        ESP.restart();
    }
    static uint32_t last_draw = 0;
    static bool last_hold = false;
    const Screen& s = g_io.screen;
    if (g_io.dirty || holding != last_hold || now - last_draw > 1000) {
        g_io.dirty = false;
        last_hold = holding;
        last_draw = now;
        if (!s.on && !holding) {
            M5Cardputer.Display.setBrightness(0);
        } else {
            drawRemoteScreen(g_gfx, s, g_link.status(now), g_clock.hhmm(now), holding);
            M5Cardputer.Display.pushImage(0, 0, SCREEN_W, SCREEN_H, g_gfx.px);
            M5Cardputer.Display.setBrightness(BRIGHT_FULL);
        }
    }
}

// ------------------------------------------------------------------ Startmenue + Agentendorf (Tastatur)
const char* umlaut(char c) {
    switch (c) {
        case 'a': return "\xC3\xA4";
        case 'o': return "\xC3\xB6";
        case 'u': return "\xC3\xBC";
        case 's': return "\xC3\x9F";
        case 'A': return "\xC3\x84";
        case 'O': return "\xC3\x96";
        case 'U': return "\xC3\x9C";
        case 'e': return "\xE2\x82\xAC";   // opt+e = Euro
        default: return nullptr;
    }
}

std::vector<Input> readInputs() {
    std::vector<Input> out;
    auto& st = M5Cardputer.Keyboard.keysState();
    if (st.esc) out.push_back({K::Esc, ""});
    else if (st.up) out.push_back({K::Up, ""});
    else if (st.down) out.push_back({K::Down, ""});
    else if (st.left) out.push_back({K::Left, ""});
    else if (st.right) out.push_back({K::Right, ""});
    else if (st.del || st.backspace) out.push_back({K::Del, ""});
    else if (st.enter) out.push_back({K::Enter, ""});
    else if (st.tab) out.push_back({K::Tab, ""});
    else {
        for (char c : st.word) {
            const char* u = st.opt ? umlaut(c) : nullptr;
            out.push_back({K::Char, u ? std::string(u) : std::string(1, c)});
        }
    }
    return out;
}

bool repeatable(const std::vector<Input>& in) {
    if (in.size() != 1) return false;
    const K k = in[0].k;
    if (k == K::Up || k == K::Down || k == K::Left || k == K::Right || k == K::Del) return true;
    return k == K::Char && (in[0].ch == ";" || in[0].ch == "." || in[0].ch == "," || in[0].ch == "/");
}

void loopApp(uint32_t now) {
    static std::vector<Input> held;
    static uint32_t held_since = 0, last_repeat = 0;
    static int last_bright = -1;

    if (M5Cardputer.Keyboard.isChange()) {
        if (M5Cardputer.Keyboard.isPressed()) {
            held = readInputs();
            held_since = last_repeat = now;
            for (const auto& in : held) g_app.input(in, now);
        } else {
            held.clear();
        }
    } else if (M5Cardputer.Keyboard.isPressed() && repeatable(held) && now - held_since > 450 &&
               now - last_repeat > 110) {
        last_repeat = now;
        g_app.input(held[0], now);   // Pfeile und Loeschen wiederholen beim Festhalten
    }
    if (M5Cardputer.BtnA.wasPressed()) g_app.wake(now, 30000);
    if (g_mode != Mode::App) return;   // Menuepunkt 1 gewaehlt

    g_app.tick(now);
    const int b = g_app.brightness(now);
    if (b > 0 && g_app.needsRender(now)) {
        g_app.render(g_gfx, now);
        M5Cardputer.Display.pushImage(0, 0, SCREEN_W, SCREEN_H, g_gfx.px);
    }
    if (b != last_bright) {
        last_bright = b;
        if (b > 0) {   // nach dem Aufwachen sofort aktuelles Bild
            g_app.render(g_gfx, now);
            M5Cardputer.Display.pushImage(0, 0, SCREEN_W, SCREEN_H, g_gfx.px);
        }
        M5Cardputer.Display.setBrightness(b == 0 ? 0 : b < 50 ? BRIGHT_DIM : BRIGHT_FULL);
    }
    pollBattery(now, false);
}

}  // namespace

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg, true);
    M5Cardputer.Display.setRotation(1);
    M5Cardputer.Display.setSwapBytes(true);   // Bildspeicher ist RGB565 in normaler Byte-Reihenfolge
    M5Cardputer.Display.setBrightness(BRIGHT_FULL);
    const uint32_t now = millis();
    mountStorage();
    pollBattery(now, true);
    g_app.begin(now);
    g_app.render(g_gfx, now);
    M5Cardputer.Display.pushImage(0, 0, SCREEN_W, SCREEN_H, g_gfx.px);
}

void loop() {
    M5Cardputer.update();
    const uint32_t now = millis();
    pumpSound(now);
    if (g_mode == Mode::Remote) loopRemote(now);
    else loopApp(now);
    delay(LOOP_DELAY_MS);
}
