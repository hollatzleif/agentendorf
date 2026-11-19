#include "app.h"

#include <algorithm>
#include <cstdio>

#include "ui.h"

namespace haloos {

namespace ui {

void battery(Gfx& g, int x, int y, int pct) {
    g.frame(x, y, 15, 8, 2, col::GREY);
    g.fill(x + 15, y + 2, 2, 4, col::GREY);
    if (pct >= 0) {
        const int w = std::max(1, std::min(11, (pct * 11 + 50) / 100));
        g.fill(x + 2, y + 2, w, 4, pct < 20 ? col::RED : col::TEXT2);
    }
}

// ------------------------------------------------------------------ Listen
void ListView::fix() {
    const int n = static_cast<int>(rows.size());
    if (n == 0) { sel = top = 0; return; }
    sel = std::max(0, std::min(sel, n - 1));
    if (!waehlbar(rows[sel])) {
        int s = sel;
        while (s < n && !waehlbar(rows[s])) ++s;
        if (s >= n) { s = sel; while (s > 0 && !waehlbar(rows[s])) --s; }
        sel = s;
    }
    if (sel < top) top = sel;
    if (sel >= top + ROWS) top = sel - ROWS + 1;
    // Ueberschriften ueber der ersten sichtbaren Zeile mitnehmen
    while (top > 0 && sel - (top - 1) < ROWS && !waehlbar(rows[top - 1])) --top;
    // Hinweise unter der letzten waehlbaren Zeile ebenso
    bool letzte = true;
    for (int i = sel + 1; i < n; ++i) letzte = letzte && !waehlbar(rows[i]);
    if (letzte) top = std::max(top, std::min(n - ROWS, sel));
    top = std::max(0, std::min(top, std::max(0, n - ROWS)));
}

void ListView::move(int d) {
    const int n = static_cast<int>(rows.size());
    int s = sel;
    for (int i = 0; i < n; ++i) {
        s += d;
        if (s < 0 || s >= n) return;
        if (waehlbar(rows[s])) { sel = s; return; }
    }
}

void ListView::draw(Gfx& g, App& app, uint32_t now) {
    build(app, now);
    fix();
    app.header(g, title(app), now, headerRight(app, now));
    const bool scroll = static_cast<int>(rows.size()) > ROWS;
    const int rx = scroll ? 230 : 234;
    for (int i = top; i < std::min(static_cast<int>(rows.size()), top + ROWS); ++i) {
        const Row& r = rows[i];
        const int y = ROW_Y0 + (i - top) * ROW_H;
        const bool on = i == sel && waehlbar(r);
        if (on) {
            g.rrect(4, y, rx - 2, 17, 5, col::SEL_BG);
            g.fill(4, y + 4, 2, 9, col::ACCENT);
        }
        const int base = y + 13;
        int tx = 12;
        Color tc = on ? col::WHITE : col::TEXT2;
        switch (r.style) {
            case Row::Header:
                g.text(FONT_SMALL, 10, base, r.text, col::GREY, Align::Left, rx - 20);
                if (Gfx::width(FONT_SMALL, r.text) < rx - 30)
                    g.hline(10 + Gfx::width(FONT_SMALL, r.text) + 6, y + 9, rx - 16 - Gfx::width(FONT_SMALL, r.text) - 6, col::LINE);
                continue;
            case Row::Note:
                g.text(FONT_BODY, 12, base, r.text, r.rightColor == col::GREY ? col::TEXT2 : r.rightColor, Align::Left, rx - 18);
                continue;
            case Row::Open:
                g.ring(17, y + 8, 5, on ? col::ACCENT : col::GREY);
                tx = 29;
                break;
            case Row::Done:
                g.disc(17, y + 8, 6, col::ACCENT_DIM);
                g.check(12, y + 3, 11, col::BG);
                tx = 29;
                tc = col::GREY;
                break;
            case Row::Star:       // Farbe des Sterns = rightColor (gruen: verbunden)
                g.star(17, y + 8, 6, r.rightColor == col::GREY ? (on ? col::ACCENT : col::ACCENT_DIM) : r.rightColor);
                tx = 29;
                break;
            case Row::Plus:
                g.text(FONT_TITLE, 12, base + 1, "+", col::ACCENT);
                tx = 29;
                tc = col::ACCENT;
                break;
            default:
                break;
        }
        if (!r.left.empty()) {
            g.text(FONT_SMALL, tx, base, r.left, on ? col::ACCENT : col::ACCENT_DIM);
            tx += 40;
        }
        int rw = 0;
        if (!r.right.empty()) {
            rw = g.text(FONT_SMALL, rx - 6, base, Gfx::fit(FONT_SMALL, r.right, 110),
                        r.style == Row::Value ? col::ACCENT : r.rightColor, Align::Right);
        }
        g.text(FONT_BODY, tx, base, r.text, tc, Align::Left, rx - 6 - (rw ? rw + 8 : 0) - tx);
        if (r.style == Row::Done) g.hline(tx, base - 4, std::min(Gfx::width(FONT_BODY, r.text), rx - 14 - rw - tx), col::GREY);
    }
    if (scroll) {
        const int n = static_cast<int>(rows.size());
        const int h = std::max(10, 90 * ROWS / n);
        const int y = ROW_Y0 + (90 - h) * top / std::max(1, n - ROWS);
        g.fill(235, ROW_Y0, 2, 90, col::LINE);
        g.fill(235, y, 2, h, col::ACCENT_DIM);
    }
    app.footer(g, hint(app, now), hintColor(app));
}

void ListView::key(const Input& in, App& app, uint32_t now) {
    build(app, now);   // Zeilen aktuell halten, auch wenn seit dem Oeffnen nicht gezeichnet wurde
    fix();
    const Row* r = current();
    if (other(app, in, r, now)) return;
    switch (nav(in)) {
        case K::Up: move(-1); break;
        case K::Down: move(1); break;
        case K::Enter: if (r) activate(app, *r, now); break;
        case K::Esc:
        case K::Left: app.pop(); break;
        default: break;
    }
}

// ------------------------------------------------------------------ Eingabe
void TextInputView::draw(Gfx& g, App& app, uint32_t now) {
    app.header(g, title_, now);
    g.text(FONT_SMALL, 10, 42, label_, col::GREY, Align::Left, 222);
    g.rrect(8, 49, 224, 28, 7, col::PANEL);
    g.frame(8, 49, 224, 28, 7, col::ACCENT_DIM);
    // Ende des Textes sichtbar halten
    std::string shown = text_;
    while (!shown.empty() && Gfx::width(FONT_BODY, shown) > 204) {
        size_t i = 0;
        nextChar(shown, i);
        shown.erase(0, i);
    }
    const int w = g.text(FONT_BODY, 16, 68, shown, col::WHITE);
    if ((now / 500) % 2 == 0) g.fill(17 + w, 56, 2, 15, col::ACCENT);
    const auto lines = wrapText(FONT_SMALL, hint_, 222, 2);
    for (size_t i = 0; i < lines.size(); ++i) g.text(FONT_SMALL, 10, 93 + static_cast<int>(i) * 13, lines[i], col::TEXT2);
    app.footer(g, "Enter OK" + std::string(DOT) + "Esc abbrechen" + DOT + (roh_ ? "Esc = fn + `" : "opt+a = \xC3\xA4"));
}

void TextInputView::key(const Input& in, App& app, uint32_t now) {
    if (in.k == K::Esc || (!roh_ && in.k == K::Char && in.ch == "`")) { app.pop(); return; }
    if (in.k == K::Del) { popChar(text_); return; }
    if (in.k == K::Enter) {
        std::string t = text_;
        if (!roh_) {
            while (!t.empty() && t.back() == ' ') t.pop_back();
            while (!t.empty() && t.front() == ' ') t.erase(0, 1);
        }
        if (t.empty() && !allowEmpty_) return;
        TextCb cb = cb_;
        app.pop();
        cb(app, t, now);
        return;
    }
    if (in.k == K::Char && charCount(text_) < maxLen_) text_ += in.ch;
}

void ChoiceView::build(App&, uint32_t) {
    rows.clear();
    for (size_t i = 0; i < options_.size(); ++i) {
        Row r;
        r.text = options_[i];
        r.action = static_cast<int>(i);
        rows.push_back(r);
    }
}

void ChoiceView::activate(App& app, const Row& r, uint32_t now) {
    PickCb cb = cb_;
    const int a = r.action;
    app.pop();
    cb(app, a, now);
}

void ConfirmView::draw(Gfx& g, App& app, uint32_t now) {
    app.header(g, "Sicher?", now);
    g.text(FONT_TITLE, 120, 58, q_, col::WHITE, Align::Center, 224);
    const auto lines = wrapText(FONT_BODY, d_, 220, 2);
    for (size_t i = 0; i < lines.size(); ++i)
        g.text(FONT_BODY, 120, 80 + static_cast<int>(i) * 16, lines[i], col::TEXT2, Align::Center);
    app.footer(g, "Enter ja" + std::string(DOT) + "Esc nein");
}

void ConfirmView::key(const Input& in, App& app, uint32_t now) {
    const K k = nav(in);
    if (k == K::Enter) {
        YesCb cb = cb_;
        app.pop();
        cb(app, now);
    } else if (k == K::Esc || k == K::Left || (in.k == K::Char && (in.ch == "n" || in.ch == "N"))) {
        app.pop();
    }
}

void DatePickerView::draw(Gfx& g, App& app, uint32_t now) {
    app.header(g, title_, now);
    int y, m, d;
    civilFromDays(day_, y, m, d);
    const int64_t today = app.today(now);
    const std::string rel = day_ == today ? "heute" : day_ == today + 1 ? "morgen" :
                            day_ > today ? "in " + std::to_string(day_ - today) + " Tagen" :
                            "vor " + std::to_string(today - day_) + " Tagen";
    g.text(FONT_SMALL, 120, 46, rel, col::ACCENT, Align::Center);
    g.text(FONT_MENU, 120, 72, dayLabel(day_) + " " + std::to_string(y), col::WHITE, Align::Center);
    if (!typed_.empty()) g.text(FONT_BODY, 120, 96, "Eingabe: " + typed_, col::AMBER, Align::Center);
    else g.text(FONT_SMALL, 120, 96, "oder Datum tippen: 2412 = 24.12.", col::GREY, Align::Center);
    app.footer(g, std::string(ARROW_LR) + " Tag" + DOT + ARROW_UD + " Woche" + DOT + "Enter OK");
}

void DatePickerView::key(const Input& in, App& app, uint32_t now) {
    if (in.k == K::Char && in.ch.size() == 1 && in.ch[0] >= '0' && in.ch[0] <= '9') {
        if (typed_.size() < 8) typed_ += in.ch;
        return;
    }
    switch (nav(in)) {
        case K::Left: day_ -= 1; typed_.clear(); break;
        case K::Right: day_ += 1; typed_.clear(); break;
        case K::Up: day_ -= 7; typed_.clear(); break;
        case K::Down: day_ += 7; typed_.clear(); break;
        case K::Esc: app.pop(); break;
        case K::Enter: {
            if (!typed_.empty() && !applyTyped(app, now)) { app.toast("Datum ung\xC3\xBCltig", now); typed_.clear(); return; }
            if (!typed_.empty()) { typed_.clear(); return; }   // erst anzeigen, dann bestaetigen
            DayCb cb = cb_;
            const int64_t d = day_;
            app.pop();
            cb(app, d, now);
            break;
        }
        default:
            if (in.k == K::Del) popChar(typed_);
            break;
    }
}

bool DatePickerView::applyTyped(App& app, uint32_t now) {
    if (typed_.size() != 4 && typed_.size() != 8) return false;
    const int d = std::atoi(typed_.substr(0, 2).c_str()), m = std::atoi(typed_.substr(2, 2).c_str());
    int y, mm, dd;
    civilFromDays(app.today(now), y, mm, dd);
    if (typed_.size() == 8) y = std::atoi(typed_.substr(4, 4).c_str());
    int64_t days;
    char iso[32];
    std::snprintf(iso, sizeof iso, "%04d-%02d-%02d", y, m, d);
    if (!parseIsoDate(iso, days)) return false;
    if (typed_.size() == 4 && days < app.today(now) - 31) {   // "2401" im Dezember = naechstes Jahr
        std::snprintf(iso, sizeof iso, "%04d-%02d-%02d", y + 1, m, d);
        if (!parseIsoDate(iso, days)) return false;
    }
    day_ = days;
    return true;
}

// ------------------------------------------------------------------ Lesetext
namespace {
constexpr int LESE_Y0 = 27, LESE_Y1 = 116;
int zeilenHoehe(const Font& f) { return f.size + 2; }
}  // namespace

void LeseView::umbrechen() {
    zeilen_.clear();
    for (size_t a = 0; a < inhalt_.size(); ++a) {
        const auto teile = umbruch(*inhalt_[a].f, inhalt_[a].text, 224);
        for (const auto& t : teile) zeilen_.push_back({static_cast<uint16_t>(a), t.first, t.second});
    }
    alt_ = false;
}

int LeseView::passend(int ab) const {
    int y = LESE_Y0, n = 0;
    for (size_t i = static_cast<size_t>(ab); i < zeilen_.size(); ++i) {
        const Absatz& a = inhalt_[zeilen_[i].absatz];
        const bool erste = i > 0 && zeilen_[i - 1].absatz != zeilen_[i].absatz;
        if (erste && n > 0) y += a.abstand;
        y += zeilenHoehe(*a.f);
        if (y > LESE_Y1) break;
        ++n;
    }
    return n;
}

bool LeseView::blaettern(int d) {
    if (alt_) umbrechen();
    const int n = static_cast<int>(zeilen_.size());
    int maxOben = n;
    while (maxOben > 0 && passend(maxOben - 1) >= n - (maxOben - 1)) --maxOben;   // letzte Seite ganz zeigen
    const int neu = std::max(0, std::min(maxOben, oben_ + d));
    const bool bewegt = neu != oben_;
    oben_ = neu;
    return bewegt;
}

void LeseView::draw(Gfx& g, App& app, uint32_t now) {
    if (alt_) umbrechen();
    blaettern(0);
    app.header(g, titel(app), now, kopfRechts(app, now));
    const int n = static_cast<int>(zeilen_.size());
    const int sicht = passend(oben_);
    int y = LESE_Y0;
    for (int i = oben_; i < oben_ + sicht; ++i) {
        const Zeile& z = zeilen_[i];
        const Absatz& a = inhalt_[z.absatz];
        if (i > oben_ && zeilen_[i - 1].absatz != z.absatz) y += a.abstand;
        y += zeilenHoehe(*a.f);
        g.text(*a.f, 10, y - 3, a.text.substr(z.start, z.len), a.farbe);
    }
    if (sicht < n) {
        const int h = std::max(10, 90 * std::max(1, sicht) / n);
        const int yy = ROW_Y0 + (90 - h) * oben_ / std::max(1, n - sicht);
        g.fill(235, ROW_Y0, 2, 90, col::LINE);
        g.fill(235, yy, 2, h, col::ACCENT_DIM);
    }
    app.footer(g, fuss(app, now), fussFarbe(app));
}

void LeseView::key(const Input& in, App& app, uint32_t now) {
    if (taste(app, in, now)) return;
    switch (nav(in)) {
        case K::Up: blaettern(-2); break;
        case K::Down: blaettern(2); break;
        case K::Esc:
        case K::Left: app.pop(); break;
        default: break;
    }
}

}  // namespace ui

using namespace ui;

namespace {

// ------------------------------------------------------------------ Startmenue
class MenuView : public View {
public:
    explicit MenuView(int sel) : sel_(sel) {}
    void draw(Gfx& g, App& app, uint32_t now) override {
        const int w = g.text(FONT_TITLE, 8, 17, "HaloOS", col::ACCENT);
        g.text(FONT_SMALL, 8 + w + 8, 17, std::string("Agentendorf ") + FIRMWARE_VERSION, col::GREY);
        app.header(g, "", now);
        card(g, 30, 1, "Fernbedienung", "f\xC3\xBCr die Brille \xE2\x80\x93 sucht den Hub", sel_ == 0);
        card(g, 74, 2, "Agentendorf", "To-dos, B\xC3\xBCrgermeister, Kirchturm", sel_ == 1);
        app.footer(g, std::string(ARROW_UD) + " w\xC3\xA4hlen" + DOT + "Enter starten" + DOT + "oder 1 / 2");
    }
    static void card(Gfx& g, int y, int n, const std::string& t, const std::string& sub, bool on) {
        g.rrect(6, y, 228, 40, 8, on ? col::SEL_BG : col::PANEL);
        if (on) g.frame(6, y, 228, 40, 8, col::ACCENT_DIM);
        g.disc(26, y + 20, 10, on ? col::ACCENT : col::LINE);
        g.text(FONT_TITLE, 26, y + 25, std::to_string(n), on ? col::BG : col::TEXT2, Align::Center);
        g.text(FONT_TITLE, 46, y + 18, t, on ? col::WHITE : col::TEXT2);
        g.text(FONT_SMALL, 46, y + 33, sub, on ? col::TEXT2 : col::GREY, Align::Left, 184);
    }
    void key(const Input& in, App& app, uint32_t now) override {
        const K k = nav(in);
        if (k == K::Up || k == K::Down) sel_ = 1 - sel_;
        int pick = -1;
        if (k == K::Enter) pick = sel_;
        if (in.k == K::Char && in.ch == "1") pick = 0;
        if (in.k == K::Char && in.ch == "2") pick = 1;
        if (pick < 0) return;
        // Merker: beim naechsten Einschalten ist der zuletzt genutzte Modus vorgewaehlt
        const std::string modus = pick == 0 ? "fb" : "dorf";
        if (app.platform.setting("modus") != modus) app.platform.setSetting("modus", modus);
        if (pick == 0) app.platform.startRemote();
        if (pick == 1) app.openDorf(now);
    }

private:
    int sel_;
};

}  // namespace

// ------------------------------------------------------------------ Hilfen
bool parseTimeInput(const std::string& in, std::string& out) {
    std::string d;
    for (char c : in) {
        if (c >= '0' && c <= '9') d += c;
        else if (c != ':' && c != '.' && c != ' ' && c != 'h') return false;
    }
    if (d.empty()) { out.clear(); return true; }
    int h, m = 0;
    if (d.size() <= 2) h = std::atoi(d.c_str());
    else if (d.size() == 3) { h = std::atoi(d.substr(0, 1).c_str()); m = std::atoi(d.substr(1).c_str()); }
    else if (d.size() == 4) { h = std::atoi(d.substr(0, 2).c_str()); m = std::atoi(d.substr(2).c_str()); }
    else return false;
    if (h > 23 || m > 59) return false;
    out = two(h) + ":" + two(m);
    return true;
}

std::vector<std::string> wrapText(const Font& f, const std::string& s, int width, int maxLines) {
    std::vector<std::string> out;
    std::string line;
    std::vector<std::string> words;
    size_t st = 0;
    for (size_t i = 0; i <= s.size(); ++i)
        if (i == s.size() || s[i] == ' ') { if (i > st) words.push_back(s.substr(st, i - st)); st = i + 1; }
    for (size_t i = 0; i < words.size(); ++i) {
        const std::string cand = line.empty() ? words[i] : line + " " + words[i];
        if (Gfx::width(f, cand) <= width || line.empty()) { line = cand; continue; }
        out.push_back(line);
        line.clear();
        if (static_cast<int>(out.size()) == maxLines - 1) {   // Rest in die letzte Zeile, gekuerzt
            std::string rest = words[i];
            for (size_t k = i + 1; k < words.size(); ++k) rest += " " + words[k];
            out.push_back(Gfx::fit(f, rest, width));
            return out;
        }
        line = words[i];
    }
    if (!line.empty()) out.push_back(line);
    for (auto& l : out) l = Gfx::fit(f, l, width);
    return out;
}

std::vector<std::pair<uint32_t, uint32_t>> umbruch(const Font& f, const std::string& s, int width) {
    std::vector<std::pair<uint32_t, uint32_t>> out;
    size_t start = 0;        // Anfang der laufenden Zeile
    size_t luecke = 0;       // letztes Leerzeichen in der Zeile (0 = keins)
    bool hatLuecke = false;
    int w = 0, wBisLuecke = 0;
    size_t i = 0;
    auto zeile = [&](size_t bis) {
        size_t e = bis;
        while (e > start && s[e - 1] == ' ') --e;
        out.emplace_back(static_cast<uint32_t>(start), static_cast<uint32_t>(e - start));
    };
    while (i < s.size()) {
        const size_t vor = i;
        const uint32_t cp = nextChar(s, i);
        if (cp == '\n') {
            zeile(vor);
            start = i;
            w = 0;
            hatLuecke = false;
            continue;
        }
        const Glyph* gl = f.find(static_cast<uint16_t>(cp));
        if (!gl) gl = f.find('?');
        const int adv = gl ? gl->adv : 0;
        if (cp == ' ') {
            if (vor == start) { start = i; continue; }   // Leerzeichen am Zeilenanfang schlucken
            luecke = vor;
            hatLuecke = true;
            wBisLuecke = w;
        }
        if (w + adv > width && vor > start) {
            if (hatLuecke && cp != ' ') {
                zeile(luecke);
                start = luecke + 1;
                w = w - wBisLuecke - (f.find(' ') ? f.find(' ')->adv : 0);
            } else {            // Wort laenger als die Zeile (oder Leerzeichen am Rand): hart trennen
                zeile(vor);
                start = cp == ' ' ? i : vor;
                w = 0;
                if (cp == ' ') { hatLuecke = false; continue; }
            }
            hatLuecke = false;
        }
        w += adv;
    }
    if (start < s.size()) zeile(s.size());
    if (out.empty()) out.emplace_back(0u, 0u);
    return out;
}

// ------------------------------------------------------------------ App
App::App(Platform& p, Net& n, Clock& c) : platform(p), clock(c), dorf(p, n, c) {}

void App::begin(uint32_t now) {
    lastInput_ = now;
    dorf.laden();
    stack_.clear();
    dorfTiefe_ = 0;
    push(std::unique_ptr<View>(new MenuView(platform.setting("modus") == "dorf" ? 1 : 0)));
    dirty_ = true;
}

void App::openDorf(uint32_t now) {
    dorf.starten(now);
    push(dorfStartAnsicht());
    dorfTiefe_ = stack_.size();
    if (dorf.netze.empty()) push(wlanAnsicht());            // Ersteinrichtung: erst WLAN ...
    else if (!dorf.gekoppelt()) push(koppelnAnsicht());     // ... dann koppeln
}

void App::neuKoppeln(uint32_t now) {
    if (dorfTiefe_ == 0) return;
    popTo(dorfTiefe_);
    push(neuKoppelnAnsicht());
    wake(now, 15000);
}

void App::push(std::unique_ptr<View> v) {
    v->kennung = naechsteKennung_++;
    stack_.push_back(std::move(v));
    dirty_ = true;
}

void App::pop() {
    if (stack_.size() > 1) {
        graveyard_.push_back(std::move(stack_.back()));
        stack_.pop_back();
    }
    dirty_ = true;
}

void App::replace(std::unique_ptr<View> v) {
    pop();
    push(std::move(v));
}

void App::popTo(size_t depth) {
    while (stack_.size() > depth && stack_.size() > 1) pop();
}

View* App::ansicht(uint32_t kennung) const {
    if (kennung == 0) return nullptr;
    for (const auto& v : stack_)
        if (v->kennung == kennung) return v.get();
    return nullptr;
}

void App::zustellen(uint32_t kennung, const Ergebnis& e, uint32_t now) {
    dirty_ = true;
    if (View* v = ansicht(kennung)) v->netz(*this, e, now);
}

void App::toast(const std::string& msg, uint32_t now) {
    toast_ = msg;
    toastUntil_ = now + 2200;
    dirty_ = true;
}

void App::wake(uint32_t now, uint32_t ms) {
    wakeUntil_ = now + ms;
    dirty_ = true;
}

int64_t App::today(uint32_t now) const {
    if (clock.any()) return clock.today(now);
    return daysFromCivil(2026, 11, 19);   // Uhr noch nie gestellt (kommt vom Dorf): irgendein Startdatum
}

void App::input(const Input& in, uint32_t now) {
    now_ = now;
    graveyard_.clear();
    const bool asleep = brightness(now) == 0;
    lastInput_ = now;
    dirty_ = true;
    if (dorf.alarm()) {            // Kirchturm laeutet: jede Taste quittiert (und sonst nichts)
        dorf.alarmLeise(now);
        toast("Quittiert", now);
        return;
    }
    if (asleep) return;   // erste Taste weckt nur
    if (!stack_.empty()) stack_.back()->key(in, *this, now);
}

void App::tick(uint32_t now) {
    now_ = now;
    graveyard_.clear();
    dorf.tick(*this, now);
    if (!stack_.empty()) stack_.back()->tick(*this, now);
    if (!toast_.empty() && static_cast<int32_t>(now - toastUntil_) >= 0) {
        toast_.clear();
        dirty_ = true;
    }
}

bool App::needsRender(uint32_t now) {
    if (dirty_) return true;
    const bool anim = dorf.alarm() || (!stack_.empty() && stack_.back()->animated());
    if (anim && now - lastDraw_ >= 500) return true;
    return now - lastDraw_ >= 20000;   // Uhr im Kopf
}

int App::brightness(uint32_t now) const {
    const uint32_t idle = now - lastInput_;
    if (dorf.alarm()) return 100;
    if (idle < 30000 || static_cast<int32_t>(wakeUntil_ - now) > 0) return 100;
    if (idle < 120000) return 25;
    return 0;
}

void App::render(Gfx& g, uint32_t now) {
    g.clear(col::BG);
    if (!stack_.empty()) stack_.back()->draw(g, *this, now);
    if (dorf.alarm()) {            // Kirchturm laeutet: gross ueber allem
        const bool hell = (now / 500) % 2 == 0;
        g.rrect(14, 30, 212, 80, 10, col::SEL_BG);
        g.frame(14, 30, 212, 80, 10, hell ? col::AMBER : col::ACCENT);
        g.text(FONT_SMALL, 120, 48, "Kirchturm l\xC3\xA4utet", col::AMBER, Align::Center);
        const auto lines = wrapText(FONT_TITLE, dorf.alarmText(), 196, 2);
        for (size_t i = 0; i < lines.size(); ++i)
            g.text(FONT_TITLE, 120, 68 + static_cast<int>(i) * 18, lines[i], col::WHITE, Align::Center);
        g.text(FONT_SMALL, 120, 102, "beliebige Taste = leise", col::TEXT2, Align::Center);
    } else if (!toast_.empty()) {
        const int w = std::min(228, Gfx::width(FONT_BODY, toast_) + 28);
        g.rrect(120 - w / 2, 98, w, 24, 8, col::SEL_BG);
        g.frame(120 - w / 2, 98, w, 24, 8, col::ACCENT);
        g.text(FONT_BODY, 120, 114, toast_, col::WHITE, Align::Center, w - 16);
    }
    lastDraw_ = now;
    dirty_ = false;
}

void App::header(Gfx& g, const std::string& title, uint32_t now, const std::string& right) {
    battery(g, 217, 8, platform.battery());
    int x = 211;
    if (clock.any()) x -= g.text(FONT_SMALL, x, 16, clock.hhmm(now), clock.exact() ? col::TEXT2 : col::AMBER, Align::Right) + 6;
    if (dorf.aktiv()) {            // WLAN-Punkt: gruen verbunden, gelb verbindet, rot getrennt
        const WlanZustand z = dorf.wlanZustand();
        g.disc(x - 4, 12, 3, z == WlanZustand::Verbunden ? col::GREEN : z == WlanZustand::Verbindet ? col::AMBER : col::RED);
        x -= 14;
    }
    if (!right.empty()) x -= g.text(FONT_SMALL, x, 16, right, col::GREY, Align::Right, 84) + 8;
    if (!title.empty()) g.text(FONT_TITLE, 8, 17, title, col::WHITE, Align::Left, x - 10);
    g.hline(0, 23, SCREEN_W, col::LINE);
}

void App::footer(Gfx& g, const std::string& hint, Color c) {
    g.hline(0, 117, SCREEN_W, col::LINE);
    g.text(FONT_SMALL, 8, 130, hint, c, Align::Left, 226);
}

// ------------------------------------------------------------------ Fernbedienung
void drawRemoteScreen(Gfx& g, const Screen& s, const std::string& syncStatus, const std::string& clockText,
                      bool holdHint) {
    g.clear(col::BG);
    g.text(FONT_TITLE, 8, 17, "Fernbedienung", col::WHITE);
    battery(g, 217, 8, s.battery);
    if (clockText != "--:--") g.text(FONT_SMALL, 211, 16, clockText, col::TEXT2, Align::Right);
    g.hline(0, 23, SCREEN_W, col::LINE);
    const Color c = s.connected ? col::GREEN : col::AMBER;
    g.disc(17, 50, 6, c);
    g.text(FONT_MENU, 30, 57, s.connected ? "Mit Hub verbunden" : "Suche Hub \xE2\x80\xA6", col::WHITE, Align::Left, 200);
    std::string detail = s.detail;
    if (detail.rfind("Taste: ", 0) == 0) detail = "Letzte Taste: " + detail.substr(7);
    else if (detail == "bereit") detail = s.connected ? "Bereit \xE2\x80\x93 alle Tasten gehen an die Brille" : "Hub starten, Bluetooth an";
    g.text(FONT_BODY, 10, 80, detail, col::TEXT2, Align::Left, 222);
    const bool ok = syncStatus.rfind("Cardo abgeglichen", 0) == 0;
    g.text(FONT_SMALL, 10, 101, syncStatus, ok ? col::ACCENT : col::GREY, Align::Left, 222);
    if (s.imu) g.text(FONT_SMALL, 230, 101, "Bewegung", col::ACCENT, Align::Right);
    g.hline(0, 117, SCREEN_W, col::LINE);
    g.text(FONT_SMALL, 8, 130, holdHint ? "Weiter halten \xE2\x80\xA6 Startmen\xC3\xBC" : "Seitentaste 3 s halten: Startmen\xC3\xBC",
           holdHint ? col::AMBER : col::GREY, Align::Left, 226);
}

}  // namespace haloos
