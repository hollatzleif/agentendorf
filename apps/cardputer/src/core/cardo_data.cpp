#include "cardo_data.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>

#include "haloos_protocol.h"

namespace haloos {

const char* const WD_SHORT[7] = {"Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"};
const char* const MONTH_SHORT[12] = {"Jan", "Feb", "M\xC3\xA4r", "Apr", "Mai", "Jun",
                                     "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"};

// ------------------------------------------------------------------ Datum (H. Hinnant)
int64_t daysFromCivil(int y, int m, int d) {
    y -= m <= 2;
    const int64_t era = (y >= 0 ? y : y - 399) / 400;
    const unsigned yoe = static_cast<unsigned>(y - era * 400);
    const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + static_cast<int64_t>(doe) - 719468;
}

void civilFromDays(int64_t z, int& y, int& m, int& d) {
    z += 719468;
    const int64_t era = (z >= 0 ? z : z - 146096) / 146097;
    const unsigned doe = static_cast<unsigned>(z - era * 146097);
    const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    const unsigned mp = (5 * doy + 2) / 153;
    d = static_cast<int>(doy - (153 * mp + 2) / 5 + 1);
    m = static_cast<int>(mp < 10 ? mp + 3 : mp - 9);
    y = static_cast<int>(yoe + era * 400 + (m <= 2));
}

int weekdayOf(int64_t days) {
    const int64_t w = (days + 3) % 7;  // 1970-01-01 war ein Donnerstag
    return static_cast<int>(w < 0 ? w + 7 : w);
}

std::string isoDate(int64_t days) {
    int y, m, d;
    civilFromDays(days, y, m, d);
    char b[16];
    std::snprintf(b, sizeof b, "%04d-%02d-%02d", y, m, d);
    return b;
}

bool parseIsoDate(const std::string& s, int64_t& days) {
    int y, m, d;
    if (s.size() != 10 || std::sscanf(s.c_str(), "%4d-%2d-%2d", &y, &m, &d) != 3) return false;
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    days = daysFromCivil(y, m, d);
    int y2, m2, d2;
    civilFromDays(days, y2, m2, d2);
    return y2 == y && m2 == m && d2 == d;
}

std::string dayLabel(int64_t days) {
    int y, m, d;
    civilFromDays(days, y, m, d);
    char b[32];
    std::snprintf(b, sizeof b, "%s, %d. %s", WD_SHORT[weekdayOf(days)], d, MONTH_SHORT[m - 1]);
    return b;
}

std::string shortDate(int64_t days) {
    int y, m, d;
    civilFromDays(days, y, m, d);
    char b[16];
    std::snprintf(b, sizeof b, "%d.%d.", d, m);
    return b;
}

static int64_t floorDiv(int64_t a, int64_t b) {
    int64_t q = a / b;
    if ((a % b != 0) && ((a < 0) != (b < 0))) --q;
    return q;
}

// ------------------------------------------------------------------ Uhr
void Clock::set(int64_t utc, int offset_min, uint32_t now_ms) {
    base_utc_ = utc;
    base_ms_ = now_ms;
    offset_ = offset_min;
    any_ = exact_ = true;
}

void Clock::restore(int64_t utc, int offset_min, uint32_t now_ms) {
    if (utc <= 0) return;
    set(utc, offset_min, now_ms);
    exact_ = false;
}

int64_t Clock::utc(uint32_t now_ms) const {
    return base_utc_ + static_cast<int64_t>(static_cast<uint32_t>(now_ms - base_ms_) / 1000u);
}

int64_t Clock::today(uint32_t now_ms) const { return floorDiv(local(now_ms), 86400); }

int Clock::minuteOfDay(uint32_t now_ms) const {
    return static_cast<int>((local(now_ms) - today(now_ms) * 86400) / 60);
}

std::string Clock::hhmm(uint32_t now_ms) const {
    if (!any_) return "--:--";
    const int m = minuteOfDay(now_ms);
    char b[16];
    std::snprintf(b, sizeof b, "%02d:%02d", m / 60, m % 60);
    return b;
}

// ------------------------------------------------------------------ Felder
std::string escapeField(const std::string& s) {
    std::string o;
    o.reserve(s.size());
    for (char c : s) {
        if (c == '\\') o += "\\\\";
        else if (c == '\t') o += "\\t";
        else if (c == '\n') o += "\\n";
        else if (c != '\r') o += c;
    }
    return o;
}

std::string unescapeField(const std::string& s) {
    std::string o;
    o.reserve(s.size());
    for (size_t i = 0; i < s.size(); ++i) {
        if (s[i] == '\\' && i + 1 < s.size()) {
            const char n = s[++i];
            o += n == 't' ? '\t' : n == 'n' ? '\n' : n;
        } else {
            o += s[i];
        }
    }
    return o;
}

std::vector<std::string> splitFields(const std::string& line) {
    std::vector<std::string> f;
    size_t start = 0;
    for (size_t i = 0; i <= line.size(); ++i) {
        if (i == line.size() || line[i] == '\t') {
            f.push_back(unescapeField(line.substr(start, i - start)));
            start = i + 1;
        }
    }
    return f;
}

std::string joinFields(const std::vector<std::string>& f) {
    std::string o;
    for (size_t i = 0; i < f.size(); ++i) {
        if (i) o += '\t';
        o += escapeField(f[i]);
    }
    return o;
}

static std::vector<std::string> lines(const std::string& text) {
    std::vector<std::string> out;
    size_t start = 0;
    for (size_t i = 0; i <= text.size(); ++i) {
        if (i == text.size() || text[i] == '\n') {
            std::string l = text.substr(start, i - start);
            if (!l.empty() && l.back() == '\r') l.pop_back();
            if (!l.empty()) out.push_back(l);
            start = i + 1;
        }
    }
    return out;
}

static int toInt(const std::string& s, int def) {
    if (s.empty()) return def;
    char* end = nullptr;
    const long v = std::strtol(s.c_str(), &end, 10);
    return (end && *end == 0) ? static_cast<int>(v) : def;
}

static int64_t toInt64(const std::string& s, int64_t def) {
    if (s.empty()) return def;
    char* end = nullptr;
    const long long v = std::strtoll(s.c_str(), &end, 10);
    return (end && *end == 0) ? static_cast<int64_t>(v) : def;
}

// ------------------------------------------------------------------ Kennungen
std::string makeTaskId(int64_t ms, uint32_t (*rnd)()) {
    static const char* digits = "0123456789abcdefghijklmnopqrstuvwxyz";
    std::string b36;
    uint64_t v = ms > 0 ? static_cast<uint64_t>(ms) : 0;
    do { b36.insert(b36.begin(), digits[v % 36]); v /= 36; } while (v);
    std::string r;
    for (int i = 0; i < 8; ++i) r += digits[rnd() % 36];
    return "task:" + b36 + "-" + r;
}

std::string makeEventId(uint32_t (*rnd)()) {
    uint8_t b[16];
    for (int i = 0; i < 16; i += 4) {
        const uint32_t v = rnd();
        for (int k = 0; k < 4; ++k) b[i + k] = static_cast<uint8_t>(v >> (8 * k));
    }
    b[6] = (b[6] & 0x0F) | 0x40;
    b[8] = (b[8] & 0x3F) | 0x80;
    char s[40];
    std::snprintf(s, sizeof s, "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x", b[0], b[1],
                  b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]);
    return std::string("event:") + s;
}

std::string isoTimestamp(int64_t utc) {
    const int64_t days = floorDiv(utc, 86400);
    const int64_t sec = utc - days * 86400;
    int y, m, d;
    civilFromDays(days, y, m, d);
    char b[32];
    std::snprintf(b, sizeof b, "%04d-%02d-%02dT%02d:%02d:%02d.000Z", y, m, d, static_cast<int>(sec / 3600),
                  static_cast<int>(sec / 60 % 60), static_cast<int>(sec % 60));
    return b;
}

// ------------------------------------------------------------------ Store
Task* Store::task(const std::string& id) {
    for (auto& t : tasks)
        if (t.id == id) return &t;
    return nullptr;
}

int Store::openCount() const {
    return static_cast<int>(std::count_if(tasks.begin(), tasks.end(), [](const Task& t) { return !t.done; }));
}

void Store::apply(const std::vector<std::string>& f) {
    if (f.empty()) return;
    const std::string& k = f[0];
    auto at = [&](size_t i) -> const std::string& {
        static const std::string empty;
        return i < f.size() ? f[i] : empty;
    };
    if (k == "TADD") {
        if (task(at(1))) return;
        Task t;
        t.id = at(1);
        t.title = at(2);
        t.due = at(3);
        t.prio = at(4).empty() ? "medium" : at(4);
        tasks.push_back(t);
    } else if (k == "TDONE") {
        if (Task* t = task(at(1))) t->done = at(2) == "1";
    } else if (k == "TDEL") {
        tasks.erase(std::remove_if(tasks.begin(), tasks.end(), [&](const Task& t) { return t.id == at(1); }),
                    tasks.end());
    } else if (k == "EADD") {
        for (const auto& e : events)
            if (e.id == at(1)) return;
        events.push_back(Event{at(1), at(2), at(3), at(4)});
    } else if (k == "EDEL") {
        events.erase(std::remove_if(events.begin(), events.end(), [&](const Event& e) { return e.id == at(1); }),
                     events.end());
    } else if (k == "PSET") {
        pomo.work = toInt(at(1), pomo.work);
        pomo.shortBreak = toInt(at(2), pomo.shortBreak);
        pomo.longBreak = toInt(at(3), pomo.longBreak);
        pomo.cycles = toInt(at(4), pomo.cycles);
        pomo.sound = at(5) != "0";
    }
}

void Store::record(std::vector<std::string> f) {
    apply(f);
    ops.push_back(Op{nextSeq++, std::move(f)});
}

const Task& Store::addTask(const std::string& id, const std::string& title, const std::string& due,
                           const std::string& prio, const std::string& createdAt) {
    record({"TADD", id, title, due, prio, createdAt});
    return *task(id);
}

void Store::setDone(const std::string& id, bool done, const std::string& at) {
    record({"TDONE", id, done ? "1" : "0", at});
}

void Store::deleteTask(const std::string& id) { record({"TDEL", id}); }

const Event& Store::addEvent(const std::string& id, const std::string& date, const std::string& time,
                             const std::string& title, const std::string& createdAt) {
    record({"EADD", id, date, time, title, createdAt});
    for (const auto& e : events)
        if (e.id == id) return e;
    return events.back();
}

void Store::deleteEvent(const std::string& id) { record({"EDEL", id}); }

void Store::setPomo(const PomoSettings& p) {
    const bool synced = !pomo.sameSynced(p);
    pomo = p;
    if (synced)
        record({"PSET", std::to_string(p.work), std::to_string(p.shortBreak), std::to_string(p.longBreak),
                std::to_string(p.cycles), p.sound ? "1" : "0"});
}

void Store::addPomodoros(int n) {
    if (n > 0) record({"POMO", std::to_string(n)});
}

std::string Store::dump() const {
    std::string o = "CARDOMINI\t1\n";
    o += "SEQ\t" + std::to_string(nextSeq) + "\n";
    o += "SYNC\t" + std::to_string(lastSyncUtc) + "\n";
    o += "CLOCK\t" + std::to_string(savedUtc) + "\t" + std::to_string(savedOffset) + "\n";
    o += joinFields({"P", std::to_string(pomo.work), std::to_string(pomo.shortBreak), std::to_string(pomo.longBreak),
                     std::to_string(pomo.cycles), pomo.sound ? "1" : "0", std::to_string(pomo.rounds),
                     pomo.autoNext ? "1" : "0", std::to_string(pomo.volume)}) + "\n";
    for (const auto& t : tasks)
        o += joinFields({"T", t.id, t.title, t.done ? "1" : "0", t.due, t.prio}) + "\n";
    for (const auto& e : events) o += joinFields({"E", e.id, e.date, e.time, e.title}) + "\n";
    for (const auto& op : ops) {
        std::vector<std::string> f = {"OP", std::to_string(op.seq)};
        f.insert(f.end(), op.f.begin(), op.f.end());
        o += joinFields(f) + "\n";
    }
    return o;
}

bool Store::load(const std::string& text) {
    const auto ls = lines(text);
    if (ls.empty() || splitFields(ls[0])[0] != "CARDOMINI") return false;
    Store s;
    for (size_t i = 1; i < ls.size(); ++i) {
        const auto f = splitFields(ls[i]);
        auto at = [&](size_t k) { return k < f.size() ? f[k] : std::string(); };
        if (f[0] == "SEQ") s.nextSeq = static_cast<uint32_t>(toInt64(at(1), 1));
        else if (f[0] == "SYNC") s.lastSyncUtc = toInt64(at(1), 0);
        else if (f[0] == "CLOCK") { s.savedUtc = toInt64(at(1), 0); s.savedOffset = toInt(at(2), 60); }
        else if (f[0] == "P") {
            s.pomo.work = toInt(at(1), 25); s.pomo.shortBreak = toInt(at(2), 5);
            s.pomo.longBreak = toInt(at(3), 15); s.pomo.cycles = toInt(at(4), 4);
            s.pomo.sound = at(5) != "0"; s.pomo.rounds = toInt(at(6), 0);
            s.pomo.autoNext = at(7) != "0"; s.pomo.volume = toInt(at(8), 2);
        } else if (f[0] == "T" && f.size() >= 2) {
            s.tasks.push_back(Task{at(1), at(2), at(4), at(5).empty() ? "medium" : at(5), at(3) == "1"});
        } else if (f[0] == "E" && f.size() >= 2) {
            s.events.push_back(Event{at(1), at(2), at(3), at(4)});
        } else if (f[0] == "OP" && f.size() >= 3) {
            s.ops.push_back(Op{static_cast<uint32_t>(toInt64(at(1), 0)), std::vector<std::string>(f.begin() + 2, f.end())});
        }
    }
    for (const auto& op : s.ops) s.nextSeq = std::max(s.nextSeq, op.seq + 1);
    *this = std::move(s);
    return true;
}

std::string Store::syncUp() const {
    std::string o = "CARDO1\n";
    for (const auto& op : ops) {
        std::vector<std::string> f = {"OP", std::to_string(op.seq)};
        f.insert(f.end(), op.f.begin(), op.f.end());
        o += joinFields(f) + "\n";
    }
    return o + "END\n";
}

bool Store::syncDown(const std::string& msg, Clock& clock, uint32_t now_ms) {
    const auto ls = lines(msg);
    if (ls.size() < 2 || ls.front() != "CARDO1" || ls.back() != "END") return false;
    uint32_t ack = 0;
    int64_t utc = 0;
    int offset = clock.offset();
    bool haveP = false;
    std::vector<Task> nt;
    std::vector<Event> ne;
    PomoSettings np = pomo;
    for (size_t i = 1; i + 1 < ls.size(); ++i) {
        const auto f = splitFields(ls[i]);
        auto at = [&](size_t k) { return k < f.size() ? f[k] : std::string(); };
        if (f[0] == "ACK") ack = static_cast<uint32_t>(toInt64(at(1), 0));
        else if (f[0] == "TIME") { utc = toInt64(at(1), 0); offset = toInt(at(2), offset); }
        else if (f[0] == "T" && f.size() >= 3) nt.push_back(Task{at(1), at(2), at(4), at(5).empty() ? "medium" : at(5), at(3) == "1"});
        else if (f[0] == "E" && f.size() >= 3) ne.push_back(Event{at(1), at(2), at(3), at(4)});
        else if (f[0] == "P" && f.size() >= 6) {
            haveP = true;
            np.work = toInt(at(1), np.work); np.shortBreak = toInt(at(2), np.shortBreak);
            np.longBreak = toInt(at(3), np.longBreak); np.cycles = toInt(at(4), np.cycles);
            np.sound = at(5) != "0";
        }
    }
    ops.erase(std::remove_if(ops.begin(), ops.end(), [&](const Op& o) { return o.seq <= ack; }), ops.end());
    tasks = std::move(nt);
    events = std::move(ne);
    if (haveP) pomo = np;
    for (const auto& op : ops) apply(op.f);   // waehrend des Abgleichs Neues wieder obendrauf
    if (utc > 0) {
        clock.set(utc, offset, now_ms);
        lastSyncUtc = utc;
        savedUtc = utc;
        savedOffset = offset;
    }
    return true;
}

// ------------------------------------------------------------------ SyncLink
void SyncLink::connected(uint32_t now_ms, int mtu) {
    connected_ = true;
    const int payload = std::min(std::max(mtu - 3, 20), 200);
    chunk_ = payload - 2;
    state_ = State::Delay;
    t_ = now_ms;
    in_.clear();
}

void SyncLink::disconnected() {
    connected_ = false;
    if (state_ != State::Done && state_ != State::Failed) state_ = State::Idle;
    in_.clear();
}

void SyncLink::begin(uint32_t now_ms) {
    out_ = store_.syncUp();
    pos_ = 0;
    sentOps_ = static_cast<int>(store_.ops.size());
    state_ = State::Sending;
    t_ = now_ms;
    error_.clear();
}

void SyncLink::tick(uint32_t now_ms) {
    if (!connected_) return;
    if (state_ == State::Delay && now_ms - t_ >= 1500) begin(now_ms);
    if (state_ == State::Waiting && now_ms - t_ > TIMEOUT_MS) {
        state_ = State::Failed;
        error_ = "Hub antwortet nicht (Hub aktuell?)";
        t_ = now_ms;
    }
    if ((state_ == State::Done || state_ == State::Failed) && now_ms - t_ >= RESYNC_MS) begin(now_ms);
}

bool SyncLink::nextPacket(std::vector<uint8_t>& out, uint32_t now_ms) {
    if (state_ != State::Sending || !connected_) return false;
    const size_t n = std::min(out_.size() - pos_, static_cast<size_t>(chunk_));
    uint8_t flags = 0;
    if (pos_ == 0) flags |= 1;
    if (pos_ + n >= out_.size()) flags |= 2;
    out.assign({REMOTE_SYNC, flags});
    out.insert(out.end(), out_.begin() + static_cast<long>(pos_), out_.begin() + static_cast<long>(pos_ + n));
    pos_ += n;
    if (flags & 2) {
        state_ = State::Waiting;
        t_ = now_ms;
    }
    return true;
}

void SyncLink::onPacket(const uint8_t* data, size_t len, uint32_t now_ms) {
    if (len < 2 || data[0] != HUB_SYNC) return;
    if (data[1] & 1) in_.clear();
    in_.append(reinterpret_cast<const char*>(data + 2), len - 2);
    if (!(data[1] & 2)) return;
    const bool ok = store_.syncDown(in_, clock_, now_ms);
    in_.clear();
    state_ = ok ? State::Done : State::Failed;
    error_ = ok ? "" : "Antwort vom Hub unlesbar";
    changed_ = changed_ || ok;
    t_ = now_ms;
}

bool SyncLink::takeChanged() {
    const bool c = changed_;
    changed_ = false;
    return c;
}

std::string SyncLink::status(uint32_t now_ms) const {
    (void)now_ms;
    switch (state_) {
        case State::Delay:
        case State::Sending:
        case State::Waiting:
            return "Cardo wird abgeglichen \xE2\x80\xA6";
        case State::Done:
            return "Cardo abgeglichen " + clock_.hhmm(t_);
        case State::Failed:
            return "Abgleich: " + error_;
        default:
            break;
    }
    if (!store_.ops.empty()) return "Cardo: " + std::to_string(store_.ops.size()) + " \xC3\x84nderungen warten";
    return "Cardo: bereit zum Abgleich";
}

}  // namespace haloos
