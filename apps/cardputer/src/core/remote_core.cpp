#include "remote_core.h"

#include <algorithm>
#include <vector>

#include <cmath>
#include <cstdlib>

namespace haloos {

namespace {
const char* const KEY_NAMES[KEY_COUNT] = {
    "`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", "del",
    "tab", "q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]", "\\",
    "fn", "shift", "a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'", "enter",
    "ctrl", "opt", "alt", "z", "x", "c", "v", "b", "n", "m", ",", ".", "/", "space",
    "seitentaste",
};

int16_t clamp16(float v) {
    if (v > 32767.0f) return 32767;
    if (v < -32768.0f) return -32768;
    return static_cast<int16_t>(v);  // Richtung Null runden, wie int() in Python
}

void putLE16(uint8_t* p, int16_t v) {
    const uint16_t u = static_cast<uint16_t>(v);
    p[0] = static_cast<uint8_t>(u & 0xFF);
    p[1] = static_cast<uint8_t>(u >> 8);
}
}  // namespace

const char* RemoteCore::keyName(uint8_t key_id) {
    return key_id < KEY_COUNT ? KEY_NAMES[key_id] : "?";
}

RemoteCore::RemoteCore(RemoteIO& io) : io_(io) {}

void RemoteCore::begin(uint32_t now_ms) {
    last_input_ms_ = now_ms;
    screen_.title = "HaloOS Fernbedienung";
    refreshScreen();
}

void RemoteCore::send(const uint8_t* data, size_t len) {
    if (connected_) io_.sendToHub(data, len);
}

void RemoteCore::sendBattery() {
    if (battery_ < 0) return;
    const uint8_t pkt[3] = {REMOTE_BATT, static_cast<uint8_t>(battery_), static_cast<uint8_t>(charging_ ? 1 : 0)};
    send(pkt, sizeof pkt);
    battery_sent_ = battery_;
    charging_sent_ = charging_;
}

void RemoteCore::onHubSubscribed(uint32_t now_ms) {
    connected_ = true;
    imu_hz_ = 0;
    const uint8_t hello[4] = {REMOTE_HELLO, PROTOCOL_VERSION, FIRMWARE_MAJOR, FIRMWARE_MINOR};
    send(hello, sizeof hello);
    sendBattery();
    settings_pos_ = 0;
    settings_sending_ = true;   // danach (je Takt ein Stueck) die gespeicherten Einstellungen melden
    wakeScreen(now_ms);
}

void RemoteCore::onHubDisconnected(uint32_t now_ms) {
    connected_ = false;
    imu_hz_ = 0;
    wakeScreen(now_ms);
}

void RemoteCore::onKey(uint8_t key_id, bool down, uint32_t now_ms) {
    if (key_id >= KEY_COUNT) return;
    if (down) last_key_ = keyName(key_id);
    wakeScreen(now_ms);
    const uint8_t pkt[4] = {REMOTE_KEY, key_id, static_cast<uint8_t>(down ? 1 : 0), nextSeq()};
    if (connected_) {
        io_.sendToHub(pkt, sizeof pkt);
    } else {
        --seq_;  // nicht gesendet: Zaehler nicht verbrauchen
    }
}

void RemoteCore::onBattery(int percent, bool charging, uint32_t now_ms) {
    (void)now_ms;
    if (percent < 0) percent = 0;
    if (percent > 100) percent = 100;
    battery_ = percent;
    charging_ = charging;
    // Nur bei spuerbarer Aenderung senden (spart Funkzeit)
    if (battery_sent_ < 0 || std::abs(battery_ - battery_sent_) >= 5 || charging_ != charging_sent_) {
        if (connected_) sendBattery();
    }
    refreshScreen();
}

void RemoteCore::onImuSample(float ax, float ay, float az, float gx, float gy, float gz, uint32_t now_ms) {
    if (!connected_ || imu_hz_ == 0) return;
    if (static_cast<int32_t>(now_ms - next_imu_ms_) < 0) return;
    const uint32_t period = 1000u / imu_hz_;
    next_imu_ms_ += period;
    if (static_cast<int32_t>(now_ms - next_imu_ms_) >= 0) next_imu_ms_ = now_ms + period;  // aufholen statt stauen

    uint8_t pkt[14];
    pkt[0] = REMOTE_IMU;
    pkt[1] = nextSeq();
    putLE16(pkt + 2, clamp16(ax * 1000.0f));
    putLE16(pkt + 4, clamp16(ay * 1000.0f));
    putLE16(pkt + 6, clamp16(az * 1000.0f));
    putLE16(pkt + 8, clamp16(gx * 10.0f));
    putLE16(pkt + 10, clamp16(gy * 10.0f));
    putLE16(pkt + 12, clamp16(gz * 10.0f));
    io_.sendToHub(pkt, sizeof pkt);
}

void RemoteCore::onHubWrite(const uint8_t* data, size_t len, uint32_t now_ms) {
    if (len == 0) return;
    if (data[0] == HUB_IMU_ON) {
        uint8_t hz = (len > 1 && data[1] > 0) ? data[1] : DEFAULT_IMU_HZ;
        if (hz > 100) hz = 100;
        imu_hz_ = hz;
        next_imu_ms_ = now_ms;
    } else if (data[0] == HUB_IMU_OFF) {
        imu_hz_ = 0;
    } else if (data[0] == HUB_STORE && len >= 2) {
        if (data[1] & SYNC_FIRST) settings_in_.clear();
        if (settings_in_.size() + len < 4000) settings_in_.append(reinterpret_cast<const char*>(data + 2), len - 2);
        if (data[1] & SYNC_LAST) {
            settings_ = settings_in_;
            settings_in_.clear();
            settings_new_ = true;
        }
        return;
    }
    refreshScreen();
}

bool RemoteCore::takeSettingsToSave(std::string& out) {
    if (!settings_new_) return false;
    settings_new_ = false;
    out = settings_;
    return true;
}

void RemoteCore::tick(uint32_t now_ms) {
    if (settings_sending_ && connected_) {
        // REMOTE_STORED in Stuecken (leer = nichts gespeichert); eins je Takt, damit Tasten nicht warten
        int mtu = mtu_ < 23 ? 23 : mtu_;
        if (mtu > 203) mtu = 203;
        const size_t chunk = static_cast<size_t>(mtu - 3 - 2);
        const size_t n = std::min(settings_.size() - settings_pos_, chunk);
        uint8_t flags = 0;
        if (settings_pos_ == 0) flags |= SYNC_FIRST;
        if (settings_pos_ + n >= settings_.size()) flags |= SYNC_LAST;
        std::vector<uint8_t> pkt{REMOTE_STORED, flags};
        pkt.insert(pkt.end(), settings_.begin() + static_cast<long>(settings_pos_),
                   settings_.begin() + static_cast<long>(settings_pos_ + n));
        send(pkt.data(), pkt.size());
        settings_pos_ += n;
        if (flags & SYNC_LAST) settings_sending_ = false;
    }
    const bool should_be_on = (now_ms - last_input_ms_) < SCREEN_TIMEOUT_MS;
    if (screen_.on != should_be_on) {
        screen_.on = should_be_on;
        io_.showScreen(screen_);
    }
}

void RemoteCore::wakeScreen(uint32_t now_ms) {
    last_input_ms_ = now_ms;
    screen_.on = true;
    refreshScreen();
}

void RemoteCore::refreshScreen() {
    screen_.connected = connected_;
    screen_.battery = battery_;
    screen_.charging = charging_;
    screen_.imu = imu_hz_ > 0;
    screen_.status = connected_ ? "mit Hub verbunden" : "suche Hub ...";
    screen_.detail = last_key_.empty() ? "bereit" : ("Taste: " + last_key_);
    io_.showScreen(screen_);
}

}  // namespace haloos
