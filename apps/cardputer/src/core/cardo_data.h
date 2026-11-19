// Cardo-Mini auf dem Cardputer: Daten, Uhr, Speicherformat und Abgleich mit dem Hub.
//
// Grundidee: Jede Aenderung am Cardputer wird sofort lokal angewendet UND als "Op" gemerkt.
// Beim naechsten Verbinden schickt der Cardputer alle offenen Ops an den Hub; der Hub traegt
// sie in Cardo ein und schickt den aktuellen Stand zurueck (Aufgaben, Termine, Pomodoro-
// Einstellungen, Uhrzeit). Ops, die der Hub bestaetigt hat, werden geloescht; was waehrend
// des Abgleichs neu dazukam, wird auf den neuen Stand wieder angewendet.
// Format der Nachrichten: docs/CARDPUTER_ABGLEICH.md und hubapp/cardputer_sync.py.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace haloos {

// ------------------------------------------------------------------ Datum
int64_t daysFromCivil(int y, int m, int d);
void civilFromDays(int64_t z, int& y, int& m, int& d);
int weekdayOf(int64_t days);                      // 0 = Montag ... 6 = Sonntag
std::string isoDate(int64_t days);                // "2026-11-08"
bool parseIsoDate(const std::string& s, int64_t& days);
std::string dayLabel(int64_t days);               // "Fr, 8. Nov"
std::string shortDate(int64_t days);              // "8.11."
extern const char* const WD_SHORT[7];
extern const char* const MONTH_SHORT[12];

// ------------------------------------------------------------------ Uhr
// Der Cardputer hat keine eigene Uhr, die das Ausschalten ueberlebt. Die Zeit kommt vom Hub
// (bei jedem Abgleich) oder wird von Hand gestellt. Die letzte bekannte Zeit wird gespeichert,
// damit nach dem Einschalten wenigstens das Datum ungefaehr stimmt.
class Clock {
public:
    void set(int64_t utc, int offset_min, uint32_t now_ms);   // genau (Hub oder von Hand)
    void restore(int64_t utc, int offset_min, uint32_t now_ms);  // ungefaehr (gespeichert)
    bool exact() const { return exact_; }
    bool any() const { return any_; }
    int64_t utc(uint32_t now_ms) const;
    int64_t local(uint32_t now_ms) const { return utc(now_ms) + offset_ * 60; }
    int64_t today(uint32_t now_ms) const;             // Tage seit 1970 (lokal)
    int minuteOfDay(uint32_t now_ms) const;
    int offset() const { return offset_; }
    std::string hhmm(uint32_t now_ms) const;          // "14:03" bzw. "--:--"

private:
    bool any_ = false, exact_ = false;
    int64_t base_utc_ = 0;
    uint32_t base_ms_ = 0;
    int offset_ = 60;
};

// ------------------------------------------------------------------ Daten
struct Task {
    std::string id, title, due, prio = "medium";   // due "JJJJ-MM-TT" oder leer; prio high/medium/low
    bool done = false;
};

struct Event {
    std::string id, date, time, title;             // time "HH:MM" oder leer (ganztaegig)
};

struct PomoSettings {
    // wie in Cardo (werden abgeglichen)
    int work = 25, shortBreak = 5, longBreak = 15, cycles = 4;
    bool sound = true;
    // nur auf dem Cardputer
    int rounds = 0;          // Durchgaenge (0 = endlos)
    bool autoNext = true;    // naechste Phase startet von selbst
    int volume = 2;          // 1 leise, 2 mittel, 3 laut
    bool sameSynced(const PomoSettings& o) const {
        return work == o.work && shortBreak == o.shortBreak && longBreak == o.longBreak &&
               cycles == o.cycles && sound == o.sound;
    }
};

struct Op {
    uint32_t seq = 0;
    std::vector<std::string> f;   // f[0] = Art (TADD, TDONE, TDEL, EADD, EDEL, PSET, POMO)
};

class Store {
public:
    std::vector<Task> tasks;
    std::vector<Event> events;
    PomoSettings pomo;
    std::vector<Op> ops;
    uint32_t nextSeq = 1;
    int64_t lastSyncUtc = 0;      // 0 = noch nie
    int64_t savedUtc = 0;         // zuletzt gespeicherte Uhrzeit (fuer Clock::restore)
    int savedOffset = 60;

    // Aenderungen (lokal anwenden und fuer den Hub merken)
    const Task& addTask(const std::string& id, const std::string& title, const std::string& due,
                        const std::string& prio, const std::string& createdAt);
    void setDone(const std::string& id, bool done, const std::string& at);
    void deleteTask(const std::string& id);
    const Event& addEvent(const std::string& id, const std::string& date, const std::string& time,
                          const std::string& title, const std::string& createdAt);
    void deleteEvent(const std::string& id);
    void setPomo(const PomoSettings& p);
    void addPomodoros(int n);

    Task* task(const std::string& id);
    int openCount() const;

    // Speichern auf SD-Karte / intern (eine Textdatei)
    std::string dump() const;
    bool load(const std::string& text);

    // Abgleich: Nachricht an den Hub bauen, Antwort einspielen
    std::string syncUp() const;
    // true = Antwort gueltig und eingespielt. Stellt auch die Uhr.
    bool syncDown(const std::string& msg, Clock& clock, uint32_t now_ms);

private:
    void record(std::vector<std::string> f);
    void apply(const std::vector<std::string>& f);
};

// Tab-getrennte Felder mit \\, \t, \n maskiert
std::string escapeField(const std::string& s);
std::string unescapeField(const std::string& s);
std::vector<std::string> splitFields(const std::string& line);
std::string joinFields(const std::vector<std::string>& f);

// Kennungen wie Cardo: "task:<ms base36>-<8 Zeichen>", "event:<uuid v4>"
std::string makeTaskId(int64_t ms, uint32_t (*rnd)());
std::string makeEventId(uint32_t (*rnd)());
std::string isoTimestamp(int64_t utc);   // "2026-11-08T13:05:00.000Z"

// ------------------------------------------------------------------ Funk-Abgleich
// Pakete: Cardputer -> Hub [0x05, flags, text...], Hub -> Cardputer [0x12, flags, text...]
// flags: bit0 = erstes Stueck, bit1 = letztes Stueck
class SyncLink {
public:
    static constexpr uint32_t RESYNC_MS = 10u * 60u * 1000u;   // alle 10 Minuten, solange verbunden
    static constexpr uint32_t TIMEOUT_MS = 30000;

    SyncLink(Store& store, Clock& clock) : store_(store), clock_(clock) {}
    void connected(uint32_t now_ms, int mtu);
    void disconnected();
    void tick(uint32_t now_ms);
    bool nextPacket(std::vector<uint8_t>& out, uint32_t now_ms);  // naechstes Stueck zum Senden
    void onPacket(const uint8_t* data, size_t len, uint32_t now_ms);
    bool takeChanged();                                       // Daten neu -> speichern
    std::string status(uint32_t now_ms) const;
    bool busy() const { return state_ == State::Sending || state_ == State::Waiting; }

private:
    enum class State { Idle, Delay, Sending, Waiting, Done, Failed };
    void begin(uint32_t now_ms);
    Store& store_;
    Clock& clock_;
    State state_ = State::Idle;
    bool connected_ = false, changed_ = false;
    int chunk_ = 18;
    uint32_t t_ = 0;
    std::string out_, in_;
    size_t pos_ = 0;
    int sentOps_ = 0;
    std::string error_;
};

}  // namespace haloos
