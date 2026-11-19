// HaloOS-Fernbedienung: Protokoll-Konstanten.
// Muss exakt zu hub/protocol.py passen (Referenz) - siehe docs/PROTOKOLL.md.
#pragma once
#include <cstdint>

namespace haloos {

constexpr uint8_t PROTOCOL_VERSION = 1;
constexpr uint8_t FIRMWARE_MAJOR = 0;
constexpr uint8_t FIRMWARE_MINOR = 3;

// Bluetooth (eigener GATT-Dienst, kein HID)
constexpr const char* REMOTE_SERVICE_UUID = "1312a614-9b9e-479f-adde-e1b0165e5971";
constexpr const char* REMOTE_TX_UUID = "1312a615-9b9e-479f-adde-e1b0165e5971";  // Notify: FB -> Hub
constexpr const char* REMOTE_RX_UUID = "1312a616-9b9e-479f-adde-e1b0165e5971";  // Write:  Hub -> FB
constexpr const char* REMOTE_NAME_PREFIX = "HaloOS-FB";

// Fernbedienung -> Hub
constexpr uint8_t REMOTE_KEY = 0x01;    // [01, key_id, status, seq]
constexpr uint8_t REMOTE_IMU = 0x02;    // [02, seq, ax, ay, az, gx, gy, gz] int16 LE (milli-g, 0.1 Grad/s)
constexpr uint8_t REMOTE_BATT = 0x03;   // [03, prozent, laedt]
constexpr uint8_t REMOTE_HELLO = 0x04;  // [04, protokoll, fw_major, fw_minor]
constexpr uint8_t REMOTE_SYNC = 0x05;   // [05, flags, text...]  Cardo-Mini-Abgleich (ab Firmware 0.2)
constexpr uint8_t REMOTE_STORED = 0x06; // [06, flags, text...]  gespeicherte Einstellungen (ab 0.3, leer = keine)

// Hub -> Fernbedienung
constexpr uint8_t HUB_IMU_ON = 0x10;    // [10, rate_hz]
constexpr uint8_t HUB_IMU_OFF = 0x11;   // [11]
constexpr uint8_t HUB_SYNC = 0x12;      // [12, flags, text...]  Antwort auf den Abgleich
constexpr uint8_t HUB_STORE = 0x13;     // [13, flags, text...]  Einstellungen speichern (ab 0.3)
// flags beim Abgleich: bit0 = erstes Stueck, bit1 = letztes Stueck
constexpr uint8_t SYNC_FIRST = 0x01;
constexpr uint8_t SYNC_LAST = 0x02;

// Tasten: Reihe * 14 + Spalte (0..55), Seitentaste G0 = 56
constexpr uint8_t KEY_COLS = 14;
constexpr uint8_t KEY_ROWS = 4;
constexpr uint8_t SIDE_BUTTON = 56;
constexpr uint8_t KEY_COUNT = 57;

}  // namespace haloos
