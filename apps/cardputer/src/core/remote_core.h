// HaloOS-Fernbedienung: hardware-unabhaengiger Kern.
//
// Dieser Kern laeuft unveraendert
//   - auf dem Cardputer Adv (src/main.cpp liefert Tastatur, Bluetooth, Display, Lagesensor)
//   - im Simulator (host/host_main.cpp, gesteuert vom Python-Simulator)
// Er kennt keine Hardware, nur Ereignisse rein und Pakete/Anzeige raus.
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "haloos_protocol.h"

namespace haloos {

// Was das kleine Display des Cardputers zeigen soll
struct Screen {
    bool on = true;
    bool connected = false;
    int battery = -1;          // -1 = unbekannt
    bool charging = false;
    bool imu = false;          // Bewegungsdaten werden gerade gesendet
    std::string title;         // Zeile 1
    std::string status;        // Zeile 2
    std::string detail;        // Zeile 3
};

class RemoteIO {
public:
    virtual ~RemoteIO() = default;
    virtual void sendToHub(const uint8_t* data, size_t len) = 0;  // ein Notify-Paket
    virtual void showScreen(const Screen& screen) = 0;             // Anzeige hat sich geaendert
};

class RemoteCore {
public:
    static constexpr uint32_t SCREEN_TIMEOUT_MS = 10000;  // Display aus nach 10 s ohne Taste
    static constexpr uint8_t DEFAULT_IMU_HZ = 50;

    explicit RemoteCore(RemoteIO& io);

    void begin(uint32_t now_ms);
    // Hub hat die Benachrichtigungen abonniert (erst dann kommt "Hallo" sicher an)
    void onHubSubscribed(uint32_t now_ms);
    void onHubDisconnected(uint32_t now_ms);
    void onKey(uint8_t key_id, bool down, uint32_t now_ms);
    void onBattery(int percent, bool charging, uint32_t now_ms);
    // Beschleunigung in g, Drehrate in Grad/s
    void onImuSample(float ax, float ay, float az, float gx, float gy, float gz, uint32_t now_ms);
    void onHubWrite(const uint8_t* data, size_t len, uint32_t now_ms);
    void tick(uint32_t now_ms);

    // Einstellungen der Fernbedienung (Tasten, Empfindlichkeit ...), vom Hub geschickt. Der Kern wertet
    // sie nicht aus - er bewahrt sie nur auf und meldet sie nach jedem Verbinden zurueck (REMOTE_STORED),
    // damit sie auch nach einem Hub-Wechsel oder neu eingerichteten Hub erhalten bleiben.
    void setStoredSettings(const std::string& text) { settings_ = text; }
    const std::string& storedSettings() const { return settings_; }
    bool takeSettingsToSave(std::string& out);   // true: neu vom Hub -> dauerhaft speichern
    void setMtu(int mtu) { mtu_ = mtu; }

    bool connected() const { return connected_; }
    uint8_t imuRate() const { return imu_hz_; }  // 0 = aus
    const Screen& screen() const { return screen_; }

    static const char* keyName(uint8_t key_id);

private:
    void send(const uint8_t* data, size_t len);
    void sendBattery();
    void wakeScreen(uint32_t now_ms);
    void refreshScreen();
    uint8_t nextSeq() { return ++seq_; }

    RemoteIO& io_;
    bool connected_ = false;
    uint8_t seq_ = 0;
    uint8_t imu_hz_ = 0;
    uint32_t next_imu_ms_ = 0;
    int battery_ = -1;
    bool charging_ = false;
    int battery_sent_ = -1;
    bool charging_sent_ = false;
    uint32_t last_input_ms_ = 0;
    std::string last_key_;
    Screen screen_;
    std::string settings_, settings_in_;
    bool settings_new_ = false;
    size_t settings_pos_ = 0;
    bool settings_sending_ = false;
    int mtu_ = 23;
};

}  // namespace haloos
