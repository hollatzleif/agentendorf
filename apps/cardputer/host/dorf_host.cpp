// PC-Testversion von Startmenue und Agentendorf-App: derselbe Code wie auf dem Cardputer,
// gesteuert ueber stdin. Das Netz geht ueber einfache Sockets an den Testserver
// (test/testserver.py), das WLAN wird nachgestellt. Fuer test/host_test.py und die Bildschirmfotos.
//
// Bauen:  g++ -std=c++17 -O2 -Wall -Wextra -Iinclude -Isrc/core src/core/{app,dorf,dorf_ansichten,json,gfx,
//         cardo_data,fonts_data,remote_core}.cpp host/dorf_host.cpp -o build/dorf-host
//
// Befehle (eine Zeile je Befehl):
//   T <ms>              Zeit setzen und einen Takt laufen lassen
//   LAUF <ms> [schritt] Zeit in Schritten (Vorgabe 100 ms) um <ms> vorstellen, jeweils ein Takt
//   K <name>            Taste: enter del esc up down left right tab
//   C <zeichen>         Zeichen tippen (UTF-8, "space" = Leerzeichen)
//   S <text>            Text tippen (jedes Zeichen einzeln)
//   SHOT <datei.ppm>    Bildschirm speichern
//   AUSWAHL             Text der gewaehlten Listenzeile ausgeben
//   TEXT                alle Texte auf dem Bildschirm ausgeben (zwischen TEXT-BEGIN und TEXT-END)
//   NETZ an|aus|stumm   Internet da / weg / Anfrage geht raus, aber die Antwort geht verloren
//   WLAN <name>|<rssi>|<passwort oder - fuer offen>[|versteckt];...   Netze in Reichweite festlegen
//                       (versteckt = verbindbar, fehlt aber in der Suche - wie ein iPhone-Hotspot)
//   WLANWEG             WLAN-Verbindung bricht ab
//   MIKRO <datei.wav>   Mikrofon nachstellen: diese WAV-Datei (16 kHz mono 16 Bit) wird "gehoert"; MIKRO aus = keins
//   PLATZ <sekunden>    so viele Sekunden Aufnahme passen in den Speicher (Vorgabe 60)
//   EINST mikrostufe    (Sonderfall) eingestellte Mikrofon-Verstaerkung ausgeben
//   EINST <key>         gespeicherte Einstellung ausgeben
//   SETZE <key> <wert>  Einstellung vorgeben
//   DATEI <name>        Datei ausgeben (zwischen DATEI-BEGIN und DATEI-END)
//   NEUSTART            Geraet neu starten (Einstellungen und Dateien bleiben)
//   REMOTESHOT <datei> <verbunden 0|1>   Bildschirm des Fernbedienungs-Modus speichern
//   BRIGHT              Helligkeit ausgeben
//   Q
// Ausgaben: "AUFNAHME start|fertig|verworfen", "SCAN" je WLAN-Suche, "VERBINDE <name>" je Verbindungsversuch, "PLAY <ton> <lautstaerke>", "REMOTE" (Menuepunkt 1), "DORF" (Menuepunkt 2), "RESTART",
// "HTTP <methode> <pfad> <status>" je Anfrage und ". " am Ende jedes Befehls.
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <map>
#include <memory>
#include <sstream>
#include <string>

#include "app.h"

using namespace haloos;

namespace {

class HostPlatform : public Platform {
public:
    std::map<std::string, std::string> einst, dateien;
    uint32_t seed = 12345;
    bool neustart = false;
    void play(Sound s, int volume) override { std::cout << "PLAY " << static_cast<int>(s) << " " << volume << "\n"; }
    uint32_t random() override {
        seed = seed * 1103515245u + 12345u;
        return seed >> 1;
    }
    int battery() const override { return 76; }
    void startRemote() override { std::cout << "REMOTE\n"; }
    void startDorf() override { std::cout << "DORF\n"; }
    void restart() override { neustart = true; }
    std::string setting(const std::string& key) override { return einst.count(key) ? einst[key] : ""; }
    void setSetting(const std::string& key, const std::string& value) override { einst[key] = value; }
    bool readFile(const std::string& name, std::string& out) override {
        if (!dateien.count(name)) return false;
        out = dateien[name];
        return true;
    }
    bool writeFile(const std::string& name, const std::string& data) override {
        dateien[name] = data;
        return true;
    }
    void removeFile(const std::string& name) override { dateien.erase(name); }
    std::string storageName() const override { return "intern"; }
    uint32_t freeHeap() const override { return 187u * 1024u; }

    // Nachgestelltes Mikrofon: Quelle ist eine WAV-Datei (16 kHz mono 16 Bit), die im Kreis "abgehoert" wird
    std::string quelle;            // nur die Abtastwerte (ohne Kopf); leer = kein Mikrofon
    int platzSek = 60;             // so viel passt in den Speicher
    uint32_t jetzt = 0, aufnahmeSeit = 0;
    bool nimmtAuf = false;
    int stufe = 2;
    std::string aufnahmeName;
    int aufnahmeMaxSek() override { return quelle.empty() ? 0 : platzSek; }
    bool aufnahmeStart(const std::string& name) override {
        if (quelle.empty()) return false;
        nimmtAuf = true;
        aufnahmeSeit = jetzt;
        aufnahmeName = name;
        std::cout << "AUFNAHME start\n";
        return true;
    }
    int aufnahmePegel() override {
        if (!nimmtAuf) return 0;
        const size_t n = quelle.size() / 2;
        size_t pos = (static_cast<size_t>(jetzt - aufnahmeSeit) * 16) % n;
        int peak = 0;
        for (size_t i = 0; i < 1600; ++i) {
            const size_t k = ((pos + i) % n) * 2;
            const int v = static_cast<int16_t>(static_cast<uint8_t>(quelle[k]) | (static_cast<uint8_t>(quelle[k + 1]) << 8));
            peak = std::max(peak, v < 0 ? -v : v);
        }
        return peak * 100 / 32768;
    }
    bool aufnahmeStopp(bool behalten) override {
        if (!nimmtAuf) return false;
        nimmtAuf = false;
        std::cout << "AUFNAHME " << (behalten ? "fertig" : "verworfen") << "\n";
        if (!behalten) return false;
        const uint32_t bytes = (jetzt - aufnahmeSeit) * 32;      // 16000 Werte/s, 2 Bytes je Wert
        std::string wav = "RIFF";
        auto u32 = [&](uint32_t v) { for (int i = 0; i < 4; ++i) wav += static_cast<char>((v >> (8 * i)) & 0xFF); };
        auto u16 = [&](uint32_t v) { for (int i = 0; i < 2; ++i) wav += static_cast<char>((v >> (8 * i)) & 0xFF); };
        u32(36 + bytes);
        wav += "WAVEfmt ";
        u32(16); u16(1); u16(1); u32(16000); u32(32000); u16(2); u16(16);
        wav += "data";
        u32(bytes);
        while (wav.size() < 44 + bytes) wav += quelle.substr(0, std::min<size_t>(quelle.size(), 44 + bytes - wav.size()));
        dateien[aufnahmeName] = wav;
        return true;
    }
    void mikroStufe(int s) override { stufe = s; }
};

struct SimNetz {
    std::string ssid, passwort;
    int rssi;
    bool offen;
    bool versteckt;      // sendet, taucht aber in der Suche nicht auf
};

class HostNetz : public Net {
public:
    HostPlatform* plattform = nullptr;      // fuer das Hochladen von Dateien
    enum class Modus { An, Aus, Stumm };
    Modus modus = Modus::An;
    std::vector<SimNetz> sichtbar;
    WlanZustand zustand = WlanZustand::Getrennt;
    std::string name;
    bool sucheFertig = false;

    void wlanSuchen() override {
        sucheFertig = true;
        std::cout << "SCAN\n";
    }
    bool wlanGefunden(std::vector<WlanNetz>& netze) override {
        if (!sucheFertig) return false;
        sucheFertig = false;
        for (const auto& s : sichtbar) {
            if (s.versteckt) continue;
            WlanNetz n;
            n.ssid = s.ssid;
            n.rssi = s.rssi;
            n.offen = s.offen;
            netze.push_back(n);
        }
        return true;
    }
    void wlanVerbinden(const std::string& ssid, const std::string& passwort) override {
        std::cout << "VERBINDE " << ssid << "\n";
        zustand = WlanZustand::Fehler;
        name.clear();
        for (const auto& s : sichtbar)
            if (s.ssid == ssid && (s.offen || s.passwort == passwort)) {
                zustand = WlanZustand::Verbunden;
                name = ssid;
            }
    }
    void wlanTrennen() override {
        zustand = WlanZustand::Getrennt;
        name.clear();
    }
    WlanZustand wlanZustand() override { return zustand; }
    std::string wlanName() override { return name; }
    bool nurHttps() const override { return false; }

    bool start(const Anfrage& a) override {
        if (hat_) return false;
        antwort_ = Antwort();
        antwort_.id = a.id;
        if (modus != Modus::Aus) abrufen(a);
        if (modus == Modus::Stumm) {      // beim Server angekommen, Antwort verloren
            antwort_ = Antwort();
            antwort_.id = a.id;
        }
        std::cout << "HTTP " << (a.post ? "POST " : "GET ") << a.pfad << " " << antwort_.status << "\n";
        hat_ = true;
        return true;
    }
    bool poll(Antwort& out) override {
        if (!hat_) return false;
        out = antwort_;
        hat_ = false;
        return true;
    }

private:
    void abrufen(const Anfrage& a) {
        const std::string vor = "http://127.0.0.1:";
        if (a.basis.rfind(vor, 0) != 0) return;
        const int port = std::atoi(a.basis.substr(vor.size()).c_str());
        const int fd = socket(AF_INET, SOCK_STREAM, 0);
        if (fd < 0) return;
        timeval tv{5, 0};
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof tv);
        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port = htons(static_cast<uint16_t>(port));
        addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        if (connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof addr) != 0) { close(fd); return; }
        std::string req = std::string(a.post ? "POST " : "GET ") + a.pfad + " HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\nAccept: application/json\r\n";
        if (!a.token.empty()) req += "Authorization: Bearer " + a.token + "\r\n";
        if (!a.vorgang.empty()) req += "X-Vorgang: " + a.vorgang + "\r\n";
        std::string koerper = a.koerper, typ = "application/json";
        if (!a.datei.empty()) {      // Datei hochladen (auf dem Geraet stueckweise, hier am Stueck)
            if (!plattform || !plattform->readFile(a.datei, koerper)) return;
            typ = a.inhaltTyp;
        }
        if (a.post) req += "Content-Type: " + typ + "\r\nContent-Length: " + std::to_string(koerper.size()) + "\r\n";
        req += "\r\n";
        if (a.post) req += koerper;
        size_t gesendet = 0;
        while (gesendet < req.size()) {
            const ssize_t n = send(fd, req.data() + gesendet, req.size() - gesendet, 0);
            if (n <= 0) { close(fd); return; }
            gesendet += static_cast<size_t>(n);
        }
        std::string roh;
        char buf[4096];
        while (true) {
            const ssize_t n = recv(fd, buf, sizeof buf, 0);
            if (n <= 0) break;
            roh.append(buf, static_cast<size_t>(n));
        }
        close(fd);
        const size_t kopfEnde = roh.find("\r\n\r\n");
        if (kopfEnde == std::string::npos || roh.size() < 12) return;
        antwort_.status = std::atoi(roh.substr(9, 3).c_str());
        antwort_.koerper = roh.substr(kopfEnde + 4);
        std::string kopf = roh.substr(0, kopfEnde);
        for (auto& c : kopf) c = static_cast<char>(tolower(c));
        const size_t ra = kopf.find("retry-after:");
        if (ra != std::string::npos) antwort_.wartenSek = std::atoi(kopf.c_str() + ra + 12);
    }
    bool hat_ = false;
    Antwort antwort_;
};

void writePpm(const Gfx& g, const std::string& path) {
    std::ofstream f(path, std::ios::binary);
    f << "P6\n" << SCREEN_W << " " << SCREEN_H << "\n255\n";
    for (int i = 0; i < SCREEN_W * SCREEN_H; ++i) {
        const uint16_t p = g.px[i];
        const unsigned char rgb[3] = {static_cast<unsigned char>(((p >> 11) & 0x1F) * 255 / 31),
                                      static_cast<unsigned char>(((p >> 5) & 0x3F) * 255 / 63),
                                      static_cast<unsigned char>((p & 0x1F) * 255 / 31)};
        f.write(reinterpret_cast<const char*>(rgb), 3);
    }
}

}  // namespace

static Gfx g_gfx;

int main() {
    HostPlatform plat;
    HostNetz netz;
    netz.plattform = &plat;
    Clock clock;
    std::unique_ptr<App> app(new App(plat, netz, clock));
    uint32_t now = 1000;
    app->begin(now);
    auto takt = [&]() {
        plat.jetzt = now;
        app->tick(now);
        if (plat.neustart) {      // wie ESP.restart(): alles Fluechtige ist weg
            plat.neustart = false;
            std::cout << "RESTART\n";
            netz.wlanTrennen();
            clock = Clock();
            app.reset(new App(plat, netz, clock));
            app->begin(now);
        }
    };
    std::string line;
    while (std::getline(std::cin, line)) {
        std::istringstream in(line);
        std::string cmd;
        in >> cmd;
        if (cmd == "Q") break;
        if (cmd == "T") {
            in >> now;
            takt();
        } else if (cmd == "LAUF") {
            uint32_t ms = 0, schritt = 100;
            in >> ms >> schritt;
            if (schritt == 0) schritt = 100;
            for (uint32_t t = 0; t < ms; t += schritt) {
                now += schritt;
                takt();
            }
        } else if (cmd == "K") {
            std::string n;
            in >> n;
            K k = n == "enter" ? K::Enter : n == "del" ? K::Del : n == "esc" ? K::Esc : n == "up" ? K::Up :
                  n == "down" ? K::Down : n == "left" ? K::Left : n == "right" ? K::Right : K::Tab;
            plat.jetzt = now;
            app->input(Input{k, ""}, now);
            takt();
        } else if (cmd == "C") {
            std::string c;
            in >> c;
            app->input(Input{K::Char, c == "space" ? " " : c}, now);
            takt();
        } else if (cmd == "S") {
            std::string text = line.size() > 2 ? line.substr(2) : "";
            for (size_t i = 0; i < text.size();) {
                const size_t st = i;
                nextChar(text, i);
                app->input(Input{K::Char, text.substr(st, i - st)}, now);
            }
        } else if (cmd == "SHOT") {
            std::string p;
            in >> p;
            app->render(g_gfx, now);
            writePpm(g_gfx, p);
        } else if (cmd == "TEXT") {
            std::vector<std::string> texte;
            Gfx::mitschrift = &texte;
            app->render(g_gfx, now);
            Gfx::mitschrift = nullptr;
            std::cout << "TEXT-BEGIN\n";
            for (const auto& t : texte) std::cout << t << "\n";
            std::cout << "TEXT-END\n";
        } else if (cmd == "AUSWAHL") {
            app->render(g_gfx, now);
            std::cout << "AUSWAHL " << app->auswahl() << "\n";
        } else if (cmd == "NETZ") {
            std::string m;
            in >> m;
            netz.modus = m == "aus" ? HostNetz::Modus::Aus : m == "stumm" ? HostNetz::Modus::Stumm : HostNetz::Modus::An;
        } else if (cmd == "WLAN") {
            netz.sichtbar.clear();
            std::string rest = line.size() > 5 ? line.substr(5) : "";
            std::istringstream teile(rest);
            std::string eins;
            while (std::getline(teile, eins, ';')) {
                const size_t a = eins.find('|'), b = eins.find('|', a + 1);
                if (a == std::string::npos || b == std::string::npos) continue;
                SimNetz s;
                s.ssid = eins.substr(0, a);
                s.rssi = std::atoi(eins.substr(a + 1, b - a - 1).c_str());
                s.passwort = eins.substr(b + 1);
                const size_t c = s.passwort.find('|');
                s.versteckt = c != std::string::npos && s.passwort.substr(c + 1) == "versteckt";
                if (c != std::string::npos) s.passwort.erase(c);
                s.offen = s.passwort == "-";
                netz.sichtbar.push_back(s);
            }
        } else if (cmd == "MIKRO") {      // MIKRO <datei.wav> | MIKRO aus
            std::string p;
            in >> p;
            plat.quelle.clear();
            if (p != "aus") {
                std::ifstream f(p, std::ios::binary);
                std::stringstream ss;
                ss << f.rdbuf();
                const std::string roh = ss.str();
                if (roh.size() > 44) plat.quelle = roh.substr(44, (roh.size() - 44) & ~static_cast<size_t>(1));
            }
        } else if (cmd == "PLATZ") {
            in >> plat.platzSek;
        } else if (cmd == "WLANWEG") {
            netz.wlanTrennen();
        } else if (cmd == "EINST") {
            std::string k;
            in >> k;
            if (k == "mikrostufe") std::cout << "EINST " << plat.stufe << "\n";
            else std::cout << "EINST " << plat.setting(k) << "\n";
        } else if (cmd == "SETZE") {
            std::string k, v;
            in >> k;
            std::getline(in, v);
            if (!v.empty() && v[0] == ' ') v.erase(0, 1);
            std::string roh;      // \t und \n im Wert erlauben
            for (size_t i = 0; i < v.size(); ++i) {
                if (v[i] == '\\' && i + 1 < v.size() && v[i + 1] == 't') { roh += '\t'; ++i; }
                else if (v[i] == '\\' && i + 1 < v.size() && v[i + 1] == 'n') { roh += '\n'; ++i; }
                else roh += v[i];
            }
            plat.setSetting(k, roh);
        } else if (cmd == "DATEI") {
            std::string n, d;
            in >> n;
            plat.readFile(n, d);
            std::cout << "DATEI-BEGIN\n" << d << (d.empty() || d.back() == '\n' ? "" : "\n") << "DATEI-END\n";
        } else if (cmd == "NEUSTART") {
            plat.neustart = true;
            takt();
        } else if (cmd == "REMOTESHOT") {
            std::string p;
            int conn;
            in >> p >> conn;
            Screen s;
            s.connected = conn != 0;
            s.battery = 76;
            s.detail = conn ? "Taste: enter" : "bereit";
            drawRemoteScreen(g_gfx, s, "Noch kein Abgleich", clock.hhmm(now), false);
            writePpm(g_gfx, p);
        } else if (cmd == "BRIGHT") {
            std::cout << "BRIGHT " << app->brightness(now) << "\n";
        }
        std::cout << ".\n" << std::flush;
    }
    return 0;
}
