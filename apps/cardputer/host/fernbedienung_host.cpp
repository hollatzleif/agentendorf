// Simulator-Bruecke: laesst den echten Firmware-Kern (src/core/remote_core.*)
// auf dem Rechner laufen. Der Python-Simulator schickt Ereignisse ueber stdin
// und liest Pakete/Anzeige ueber stdout.
//
// Bauen (macht start.sh automatisch, wenn ein C++-Compiler da ist):
//   c++ -std=c++17 -O2 -Iinclude -Isrc/core src/core/remote_core.cpp host/host_main.cpp -o build/fb-sim
//
// Eingabe (eine Zeile je Ereignis, Zeit in ms):
//   S <ms>                          Hub hat Benachrichtigungen abonniert (verbunden)
//   D <ms>                          Verbindung getrennt
//   K <taste> <0|1> <ms>            Taste losgelassen/gedrueckt
//   B <prozent> <laedt 0|1> <ms>    Akkustand
//   I <ax> <ay> <az> <gx> <gy> <gz> <ms>   Lagesensor (g, Grad/s)
//   W <hex> <ms>                    Hub schreibt an die Fernbedienung
//   T <ms>                          Zeittakt
//   Q                               Ende
// Ausgabe: "TX <hex>" je Paket an den Hub, "SCREEN\t..." bei Anzeigeaenderung,
// "STORED <hex>" wenn der Hub Einstellungen zum Speichern geschickt hat (Firmware 0.3),
// und zum Abschluss jedes Befehls ". <imu_hz>".
#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "remote_core.h"

using namespace haloos;

namespace {

class HostIO : public RemoteIO {
public:
    void sendToHub(const uint8_t* data, size_t len) override {
        std::string hex;
        char buf[3];
        for (size_t i = 0; i < len; ++i) {
            std::snprintf(buf, sizeof buf, "%02x", data[i]);
            hex += buf;
        }
        std::cout << "TX " << hex << "\n";
    }

    void showScreen(const Screen& s) override {
        std::cout << "SCREEN\t" << (s.on ? 1 : 0) << '\t' << (s.connected ? 1 : 0) << '\t' << s.battery << '\t'
                  << (s.charging ? 1 : 0) << '\t' << (s.imu ? 1 : 0) << '\t' << s.title << '\t' << s.status << '\t'
                  << s.detail << "\n";
    }
};

std::vector<uint8_t> fromHex(const std::string& hex) {
    std::vector<uint8_t> out;
    for (size_t i = 0; i + 1 < hex.size(); i += 2) {
        out.push_back(static_cast<uint8_t>(std::stoi(hex.substr(i, 2), nullptr, 16)));
    }
    return out;
}

}  // namespace

int main() {
    std::ios::sync_with_stdio(false);
    HostIO io;
    RemoteCore core(io);
    core.begin(0);
    std::cout << ". " << int(core.imuRate()) << std::endl;

    std::string line;
    while (std::getline(std::cin, line)) {
        std::istringstream in(line);
        char cmd = 0;
        in >> cmd;
        uint32_t ms = 0;
        switch (cmd) {
            case 'S': in >> ms; core.onHubSubscribed(ms); break;
            case 'D': in >> ms; core.onHubDisconnected(ms); break;
            case 'K': {
                int id = 0, down = 0;
                in >> id >> down >> ms;
                core.onKey(static_cast<uint8_t>(id), down != 0, ms);
                break;
            }
            case 'B': {
                int pct = 0, ch = 0;
                in >> pct >> ch >> ms;
                core.onBattery(pct, ch != 0, ms);
                break;
            }
            case 'I': {
                float v[6] = {0, 0, 0, 0, 0, 0};
                for (float& f : v) in >> f;
                in >> ms;
                core.onImuSample(v[0], v[1], v[2], v[3], v[4], v[5], ms);
                break;
            }
            case 'W': {
                std::string hex;
                in >> hex >> ms;
                const auto data = fromHex(hex);
                core.onHubWrite(data.data(), data.size(), ms);
                break;
            }
            case 'T': in >> ms; core.tick(ms); break;
            case 'Q': return 0;
            default: break;
        }
        std::string saved;
        if (core.takeSettingsToSave(saved)) {   // wie NVS auf dem Cardputer: hier nur melden
            std::string hex;
            char buf[3];
            for (unsigned char c : saved) {
                std::snprintf(buf, sizeof buf, "%02x", c);
                hex += buf;
            }
            std::cout << "STORED " << hex << "\n";
        }
        std::cout << ". " << int(core.imuRate()) << std::endl;  // Befehl fertig
    }
    return 0;
}
