// Gemeinsame Bausteine der Ansichten: Liste, Texteingabe, Auswahl, Rueckfrage, Datumswahl, Lesetext.
// Nur von app.cpp und dorf_ansichten.cpp eingebunden.
#pragma once
#include <algorithm>
#include <cstdio>
#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "app.h"

namespace haloos {
namespace ui {

constexpr int ROW_Y0 = 26, ROW_H = 18, ROWS = 5;
constexpr const char* ARROW_UD = "\xE2\x86\x91\xE2\x86\x93";   // ↑↓
constexpr const char* ARROW_R = "\xE2\x86\x92";                // →
constexpr const char* ARROW_LR = "\xE2\x86\x90\xE2\x86\x92";   // ←→
constexpr const char* DOT = " \xC2\xB7 ";                       // ·
constexpr const char* ELL = "\xE2\x80\xA6";                     // …
constexpr const char* HAKEN = "\xE2\x9C\x93";                   // ✓

// Pfeiltasten des Cardputers: ; . , / (ohne fn) - in Listen als Pfeile, in Textfeldern als Zeichen
inline K nav(const Input& in) {
    if (in.k != K::Char) return in.k;
    if (in.ch == ";") return K::Up;
    if (in.ch == ".") return K::Down;
    if (in.ch == ",") return K::Left;
    if (in.ch == "/") return K::Right;
    if (in.ch == "`") return K::Esc;
    if (in.ch == " ") return K::Enter;
    return K::Char;
}

inline bool isLetter(const std::string& ch) {
    if (ch.size() == 1) return (ch[0] >= 'a' && ch[0] <= 'z') || (ch[0] >= 'A' && ch[0] <= 'Z');
    return ch.size() == 2 && static_cast<uint8_t>(ch[0]) == 0xC3;   // Umlaute, ß
}

inline std::string two(int v) {
    char b[16];
    std::snprintf(b, sizeof b, "%02d", v);
    return b;
}

inline std::string mmss(int64_t ms) {
    const long s = ms <= 0 ? 0 : static_cast<long>((ms + 999) / 1000);
    return two(static_cast<int>(s / 60)) + ":" + two(static_cast<int>(s % 60));
}

inline std::string relDay(int64_t day, int64_t today) {
    const int64_t d = day - today;
    if (d == 0) return "heute";
    if (d == 1) return "morgen";
    if (d == -1) return "gestern";
    if (d > 1 && d < 7) return std::string(WD_SHORT[weekdayOf(day)]) + ", " + shortDate(day);
    return shortDate(day);
}

void battery(Gfx& g, int x, int y, int pct);

// ------------------------------------------------------------------ Listen
struct Row {
    enum Style { Plain, Open, Done, Plus, Header, Value, Note, Star };   // Header und Note sind nicht waehlbar; Star = gespeichertes WLAN
    Style style = Plain;
    std::string text, right, left, key;
    Color rightColor = col::GREY;
    int action = 0;
};

class ListView : public View {
public:
    std::vector<Row> rows;
    int sel = 0, top = 0;

    virtual std::string title(App&) = 0;
    virtual std::string hint(App&, uint32_t) {
        return std::string(ARROW_UD) + " w\xC3\xA4hlen" + DOT + "Enter OK" + DOT + "Esc zur\xC3\xBC" "ck";
    }
    virtual Color hintColor(App&) { return col::GREY; }
    virtual std::string headerRight(App&, uint32_t) { return ""; }
    virtual void build(App&, uint32_t now) = 0;
    virtual void activate(App&, const Row&, uint32_t) {}
    virtual bool other(App&, const Input&, const Row*, uint32_t) { return false; }

    static bool waehlbar(const Row& r) { return r.style != Row::Header && r.style != Row::Note; }
    const Row* current() const {
        return (sel >= 0 && sel < static_cast<int>(rows.size()) && waehlbar(rows[sel])) ? &rows[sel] : nullptr;
    }
    std::string auswahl() const override { return current() ? current()->text : ""; }
    void fix();
    void move(int d);
    void draw(Gfx& g, App& app, uint32_t now) override;
    void key(const Input& in, App& app, uint32_t now) override;
};

// ------------------------------------------------------------------ Eingabe
using TextCb = std::function<void(App&, const std::string&, uint32_t)>;
using PickCb = std::function<void(App&, int, uint32_t)>;
using DayCb = std::function<void(App&, int64_t, uint32_t)>;
using YesCb = std::function<void(App&, uint32_t)>;

class TextInputView : public View {
public:
    // roh = Passwort-Feld: das Zeichen ` wird getippt (abbrechen nur mit Esc = fn + `), nichts wird gekuerzt,
    // keine Spracheingabe
    TextInputView(std::string title, std::string label, std::string text, std::string hint, TextCb cb,
                  bool allowEmpty = false, size_t maxLen = 120, bool roh = false)
        : title_(std::move(title)), label_(std::move(label)), text_(std::move(text)), hint_(std::move(hint)),
          cb_(std::move(cb)), allowEmpty_(allowEmpty), maxLen_(maxLen), roh_(roh) {}
    bool animated() const override { return true; }
    bool wach() const override { return sprache_ != Sprache::Aus; }
    void draw(Gfx& g, App& app, uint32_t now) override;
    void key(const Input& in, App& app, uint32_t now) override;
    void tick(App& app, uint32_t now) override;
    void netz(App& app, const Ergebnis& e, uint32_t now) override;
    void gleichSprechen() { sofort_ = true; }      // Aufnahme startet beim Oeffnen

private:
    // Spracheingabe (Tab): aufnehmen -> hochladen -> der erkannte Text wird an der Schreibmarke (= am Ende)
    // eingefuegt, nicht abgeschickt.
    enum class Sprache { Aus, Aufnahme, Abschreiben };
    void spracheStart(App& app, uint32_t now);
    void spracheStopp(App& app, uint32_t now);
    void einfuegen(const std::string& t);
    std::string title_, label_, text_, hint_;
    TextCb cb_;
    bool allowEmpty_;
    size_t maxLen_;
    bool roh_;
    Sprache sprache_ = Sprache::Aus;
    uint32_t spracheSeit_ = 0;
    int maxSek_ = 0, lauf_ = 0, pegel_ = 0;
    bool sofort_ = false;
};

class ChoiceView : public ListView {
public:
    ChoiceView(std::string title, std::vector<std::string> options, PickCb cb)
        : title_(std::move(title)), options_(std::move(options)), cb_(std::move(cb)) {}
    std::string title(App&) override { return title_; }
    void build(App&, uint32_t) override;
    void activate(App& app, const Row& r, uint32_t now) override;

private:
    std::string title_;
    std::vector<std::string> options_;
    PickCb cb_;
};

class ConfirmView : public View {
public:
    ConfirmView(std::string question, std::string detail, YesCb cb)
        : q_(std::move(question)), d_(std::move(detail)), cb_(std::move(cb)) {}
    void draw(Gfx& g, App& app, uint32_t now) override;
    void key(const Input& in, App& app, uint32_t now) override;

private:
    std::string q_, d_;
    YesCb cb_;
};

class DatePickerView : public View {
public:
    DatePickerView(std::string title, int64_t day, DayCb cb) : title_(std::move(title)), day_(day), cb_(std::move(cb)) {}
    void draw(Gfx& g, App& app, uint32_t now) override;
    void key(const Input& in, App& app, uint32_t now) override;

private:
    bool applyTyped(App& app, uint32_t now);
    std::string title_, typed_;
    int64_t day_;
    DayCb cb_;
};

// ------------------------------------------------------------------ Lesetext (umgebrochen, mit ↑↓ blaettern)
struct Absatz {
    std::string text;
    const Font* f = &FONT_BODY;
    Color farbe = col::TEXT2;
    int abstand = 0;      // Luft ueber dem Absatz in Pixeln
};

class LeseView : public View {
public:
    LeseView() = default;
    LeseView(std::string titel, std::vector<Absatz> inhalt) : titel_(std::move(titel)), inhalt_(std::move(inhalt)) {}
    void draw(Gfx& g, App& app, uint32_t now) override;
    void key(const Input& in, App& app, uint32_t now) override;

protected:
    virtual std::string titel(App&) { return titel_; }
    virtual std::string kopfRechts(App&, uint32_t) { return ""; }
    virtual std::string fuss(App&, uint32_t) { return std::string(ARROW_UD) + " bl\xC3\xA4ttern" + DOT + "Esc zur\xC3\xBC" "ck"; }
    virtual Color fussFarbe(App&) { return col::GREY; }
    virtual bool taste(App&, const Input&, uint32_t) { return false; }   // true = verbraucht
    void inhaltNeu() { alt_ = true; }
    void zumEnde() { oben_ = 1 << 20; }
    bool blaettern(int d);            // false = am Rand
    std::string titel_;
    std::vector<Absatz> inhalt_;

private:
    struct Zeile {
        uint16_t absatz;
        uint32_t start, len;
    };
    void umbrechen();
    int passend(int ab) const;        // wie viele Zeilen ab Zeile "ab" auf den Schirm passen
    std::vector<Zeile> zeilen_;
    bool alt_ = true;
    int oben_ = 0;
};

// ------------------------------------------------------------------ Agentendorf (dorf_ansichten.cpp)
std::unique_ptr<View> dorfStartAnsicht();
std::unique_ptr<View> wlanAnsicht();
std::unique_ptr<View> koppelnAnsicht();
std::unique_ptr<View> neuKoppelnAnsicht();

}  // namespace ui
}  // namespace haloos
