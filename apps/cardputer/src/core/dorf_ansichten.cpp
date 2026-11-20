// Die Ansichten der Agentendorf-App (alles Listen und Texte, keine Dorf-Grafik).
// Daten kommen ueber core/dorf.* von /api/geraet/* (Vertrag: API.md).
#include <algorithm>
#include <cstdio>

#include "ui.h"

namespace haloos {
namespace ui {

namespace {

enum { M_LADEN = 1, M_SCHREIBEN = 2, M_LOESCHEN = 3, M_JA = 4, M_NEIN = 5 };

const char* const LAEDT = "l\xC3\xA4" "dt \xE2\x80\xA6";
const char* const STRICH = " \xE2\x80\x93 ";   // –

template <typename V>
std::unique_ptr<View> neu(V* v) { return std::unique_ptr<View>(v); }

// "Erledigt ✓" bzw. mit Zusatz, wenn es erst spaeter beim Dorf ankommt
void merkToast(App& a, const std::string& text, uint32_t now) {
    if (a.dorf.verbunden() && a.dorf.gekoppelt() && !a.dorf.gesperrt()) a.toast(text, now);
    else a.toast(text + STRICH + "wird nachgeschickt", now);
}

bool einreihen(App& a, const std::string& pfad, const std::string& koerper, const std::string& text,
               const std::string& meldung, uint32_t now) {
    if (!a.dorf.einreihen(pfad, koerper, text, now)) {
        a.toast("Warteschlange voll \xE2\x80\x93 erst wieder ins Netz", now);
        return false;
    }
    merkToast(a, meldung, now);
    return true;
}

std::string phasenName(const std::string& p) {
    return p == "fokus" ? "Fokus" : p == "kurz" ? "Kurze Pause" : p == "lang" ? "Lange Pause" : p;
}

// ------------------------------------------------------------------ Liste mit Daten vom Dorf
class DatenListe : public ListView {
public:
    void build(App& app, uint32_t now) final {
        if (!gefragt_) laden(app, now);
        rows.clear();
        zeilen(app, now);
        if (!geladen_) {
            Row r;
            r.style = Row::Note;
            r.text = laedt_ ? LAEDT : fehler_;
            if (!laedt_) r.rightColor = col::AMBER;
            rows.push_back(r);
        }
    }
    std::string headerRight(App& app, uint32_t now) override { return laedt_ ? LAEDT : kopfRechts(app, now); }
    std::string hint(App& app, uint32_t) override {
        if (offline_) return "offline, Stand " + stand_ + DOT + "Esc zur\xC3\xBC" "ck";
        return tasten(app);
    }
    Color hintColor(App&) override { return offline_ ? col::AMBER : col::GREY; }
    void tick(App& app, uint32_t now) override {
        if (laedt_ || !gefragt_) return;
        const uint32_t alter = now - geladenUm_;
        if (app.dorf.schreibStand() != schreibStand_ || alter > ((offline_ || !geladen_) ? 20000u : 60000u)) laden(app, now);
    }
    void netz(App& app, const Ergebnis& e, uint32_t now) override {
        if (e.marke != M_LADEN) { geschrieben(app, e, now); return; }
        laedt_ = false;
        geladenUm_ = now;
        if (e.daten) {
            lesen(app, e.j);
            geladen_ = true;
            offline_ = e.offline;
            stand_ = e.stand;
            fehler_.clear();
        } else {
            fehler_ = e.fehler;
        }
    }

protected:
    virtual std::string pfad() = 0;
    virtual void lesen(App& app, const Json& j) = 0;
    virtual void zeilen(App& app, uint32_t now) = 0;
    virtual std::string tasten(App&) { return std::string(ARROW_UD) + " w\xC3\xA4hlen" + DOT + "Enter OK" + DOT + "Esc zur\xC3\xBC" "ck"; }
    virtual std::string kopfRechts(App&, uint32_t) { return ""; }
    virtual void geschrieben(App& app, const Ergebnis& e, uint32_t now) {
        if (e.ok) app.dorf.schreibStandErhoehen();
        else app.toast(e.fehler, now);
    }
    void laden(App& app, uint32_t now) {
        gefragt_ = laedt_ = true;
        geladenUm_ = now;
        schreibStand_ = app.dorf.schreibStand();
        app.dorf.holen(pfad(), kennung, M_LADEN, true);
    }
    void leer(const std::string& text) {
        if (!geladen_) return;
        Row h;
        h.style = Row::Header;
        h.text = text;
        rows.push_back(h);
    }
    bool gefragt_ = false, laedt_ = false, geladen_ = false, offline_ = false;
    std::string stand_, fehler_;
    uint32_t geladenUm_ = 0, schreibStand_ = 0;
};

// ------------------------------------------------------------------ To-dos
struct Todo {
    std::string id, titel, faellig;
    bool wichtig = false, erledigt = false, wartet = false;
    std::vector<std::pair<std::string, bool>> schritte;
};

Todo todoLesen(const Json& e) {
    Todo t;
    t.id = e["id"].text();
    t.titel = e["titel"].text();
    t.faellig = e["faellig"].text();
    t.wichtig = e["wichtig"].wahr();
    t.erledigt = e["erledigt"].wahr();
    for (Json s = e["schritte"].erstes(); s.gueltig() && t.schritte.size() < 12; s = s.naechstes())
        t.schritte.emplace_back(s["text"].text(), s["erledigt"].wahr());
    return t;
}

// Was noch in der Warteschlange steht, ueber die (evtl. alten) Daten legen
void wartendesAnwenden(App& app, std::vector<Todo>& todos, bool neue) {
    for (const auto& w : app.dorf.wartend()) {
        const Json b = Json::lesen(w.koerper);
        if (w.pfad == "/todos" && neue) {
            Todo t;
            t.titel = b["text"].text();
            t.wartet = true;
            todos.push_back(t);
        } else if (w.pfad == "/todos/erledigt" || w.pfad == "/todos/schritt") {
            const std::string id = b["id"].text();
            for (auto& t : todos) {
                if (t.id != id) continue;
                if (w.pfad == "/todos/erledigt") t.erledigt = b["erledigt"].wahr();
                else {
                    const size_t i = static_cast<size_t>(b["index"].zahl());
                    if (i < t.schritte.size()) t.schritte[i].second = b["erledigt"].wahr();
                }
            }
        }
    }
}

std::string todoKoerper(const std::string& id, bool erledigt) {
    return JsonBau().text("id", id).wahr("erledigt", erledigt).fertig();
}

class TodosView;

class TodoDetailView : public ListView {
public:
    TodoDetailView(Todo t, uint32_t eltern) : t_(std::move(t)), eltern_(eltern) {}
    std::string title(App&) override { return "To-do"; }
    std::string hint(App&, uint32_t) override { return "Enter abhaken" + std::string(DOT) + "Del l\xC3\xB6schen" + DOT + "Esc zur\xC3\xBC" "ck"; }
    void build(App& app, uint32_t now) override {
        rows.clear();
        const auto teile = umbruch(FONT_BODY, (t_.wichtig ? "! " : "") + t_.titel, 190);
        Row kopf;
        kopf.style = t_.erledigt ? Row::Done : Row::Open;
        kopf.text = ((t_.wichtig ? "! " : "") + t_.titel).substr(teile[0].first, teile[0].second);
        kopf.action = -1;
        rows.push_back(kopf);
        for (size_t i = 1; i < teile.size() && i < 4; ++i) {      // Rest des Titels
            Row r;
            r.style = Row::Note;
            r.text = "     " + ((t_.wichtig ? "! " : "") + t_.titel).substr(teile[i].first, teile[i].second);
            rows.push_back(r);
        }
        int64_t d;
        if (!t_.faellig.empty() && parseIsoDate(t_.faellig.substr(0, 10), d)) {
            Row r;
            r.style = Row::Header;
            r.text = "F\xC3\xA4llig " + relDay(d, app.today(now)) + (t_.wichtig ? std::string(DOT) + "wichtig" : "");
            rows.push_back(r);
        }
        if (!t_.schritte.empty()) {
            int fertig = 0;
            for (const auto& s : t_.schritte) fertig += s.second ? 1 : 0;
            Row h;
            h.style = Row::Header;
            h.text = "Teilschritte " + std::to_string(fertig) + "/" + std::to_string(t_.schritte.size());
            rows.push_back(h);
            for (size_t i = 0; i < t_.schritte.size(); ++i) {
                Row r;
                r.style = t_.schritte[i].second ? Row::Done : Row::Open;
                r.text = t_.schritte[i].first;
                r.action = static_cast<int>(i);
                rows.push_back(r);
            }
        }
    }
    void activate(App& app, const Row& r, uint32_t now) override;
    bool other(App& app, const Input& in, const Row*, uint32_t) override {
        if (in.k != K::Del) return false;
        const std::string id = t_.id;
        const uint32_t k = kennung;
        app.push(neu(new ConfirmView("To-do l\xC3\xB6schen?", t_.titel, [id, k](App& a, uint32_t) {
            a.dorf.senden("/todos/loeschen", JsonBau().text("id", id).fertig(), k, M_LOESCHEN);
        })));
        return true;
    }
    void netz(App& app, const Ergebnis& e, uint32_t now) override {
        if (e.marke != M_LOESCHEN) return;
        if (!e.ok) { app.toast(e.fehler, now); return; }
        app.dorf.schreibStandErhoehen();
        app.toast("Gel\xC3\xB6scht", now);
        app.pop();
    }

private:
    Todo t_;
    uint32_t eltern_;
};

class TodosView : public DatenListe {
public:
    std::string title(App&) override { return heute_ ? "To-dos heute" : "To-dos"; }
    std::string kopfRechts(App&, uint32_t) override {
        if (!geladen_) return "";
        int n = 0;
        for (const auto& t : todos_) n += t.erledigt ? 0 : 1;
        return std::to_string(n) + " offen";
    }
    std::string pfad() override { return heute_ ? "/todos?ansicht=heute" : "/todos?ansicht=offen"; }
    std::string tasten(App&) override {
        return "Enter abhaken" + std::string(DOT) + ARROW_R + " Details" + DOT + "Tab " + (heute_ ? "alle" : "heute");
    }
    void lesen(App& app, const Json& j) override {
        todos_.clear();
        for (Json e = j["todos"].erstes(); e.gueltig() && todos_.size() < 60; e = e.naechstes()) todos_.push_back(todoLesen(e));
        wartendesAnwenden(app, todos_, true);
    }
    void zeilen(App& app, uint32_t now) override {
        Row add;
        add.style = Row::Plus;
        add.text = "Neues To-do (einfach tippen)";
        add.action = -1;
        rows.push_back(add);
        const int64_t today = app.today(now);
        for (int runde = 0; runde < 2; ++runde) {
            for (size_t i = 0; i < todos_.size(); ++i) {
                const Todo& t = todos_[i];
                if (t.erledigt != (runde == 1)) continue;
                Row r;
                r.style = t.erledigt ? Row::Done : Row::Open;
                r.text = (t.wichtig && !t.erledigt ? "! " : "") + t.titel;
                r.action = static_cast<int>(i);
                int64_t d;
                if (t.wartet) {
                    r.right = "wartet";
                    r.rightColor = col::AMBER;
                } else if (!t.faellig.empty() && parseIsoDate(t.faellig.substr(0, 10), d)) {
                    r.right = relDay(d, today);
                    r.rightColor = (!t.erledigt && d < today) ? col::RED : (d == today ? col::AMBER : col::GREY);
                } else if (!t.schritte.empty()) {
                    int fertig = 0;
                    for (const auto& s : t.schritte) fertig += s.second ? 1 : 0;
                    r.right = std::to_string(fertig) + "/" + std::to_string(t.schritte.size());
                }
                rows.push_back(r);
            }
        }
        if (todos_.empty()) leer(heute_ ? "Heute nichts mehr offen" : "Keine offenen To-dos");
    }
    void activate(App& app, const Row& r, uint32_t now) override {
        if (r.style == Row::Plus) { neuesTodo(app, ""); return; }
        if (r.action < 0 || r.action >= static_cast<int>(todos_.size())) return;
        Todo& t = todos_[static_cast<size_t>(r.action)];
        if (t.wartet) { app.toast("Wird noch ans Dorf geschickt", now); return; }
        const bool erledigt = !t.erledigt;
        if (!einreihen(app, "/todos/erledigt", todoKoerper(t.id, erledigt), t.titel,
                       erledigt ? std::string("Erledigt ") + HAKEN : "Wieder offen", now)) return;
        t.erledigt = erledigt;
    }
    bool other(App& app, const Input& in, const Row* r, uint32_t now) override {
        if (in.k == K::Char && isLetter(in.ch)) { neuesTodo(app, in.ch); return true; }
        if (in.k == K::Tab) {
            heute_ = !heute_;
            todos_.clear();
            geladen_ = offline_ = false;
            sel = top = 0;
            laden(app, now);
            return true;
        }
        if (!r || r->style == Row::Plus || r->action < 0 || r->action >= static_cast<int>(todos_.size())) return false;
        const Todo& t = todos_[static_cast<size_t>(r->action)];
        if (t.wartet) return false;
        if (in.k == K::Del) {
            const std::string id = t.id;
            const uint32_t k = kennung;
            app.push(neu(new ConfirmView("To-do l\xC3\xB6schen?", t.titel, [id, k](App& a, uint32_t) {
                a.dorf.senden("/todos/loeschen", JsonBau().text("id", id).fertig(), k, M_LOESCHEN);
            })));
            return true;
        }
        if (nav(in) == K::Right) {
            app.push(neu(new TodoDetailView(t, kennung)));
            return true;
        }
        return false;
    }
    void geschrieben(App& app, const Ergebnis& e, uint32_t now) override {
        if (!e.ok) { app.toast(e.fehler, now); return; }
        app.dorf.schreibStandErhoehen();
        if (e.marke == M_LOESCHEN) app.toast("Gel\xC3\xB6scht", now);
    }
    // von der Detailansicht und der Texteingabe
    void anwenden(const std::string& id, bool erledigt) {
        for (auto& t : todos_)
            if (t.id == id) t.erledigt = erledigt;
    }
    void schrittAnwenden(const std::string& id, size_t i, bool erledigt) {
        for (auto& t : todos_)
            if (t.id == id && i < t.schritte.size()) t.schritte[i].second = erledigt;
    }
    void platzhalter(const std::string& text) {
        Todo t;
        t.titel = text;
        t.wartet = true;
        todos_.push_back(t);
    }

private:
    void neuesTodo(App& app, const std::string& start) {
        const uint32_t k = kennung;
        app.push(neu(new TextInputView(
            "Neues To-do", "Was ist zu tun?", start, "Das Dorf versteht: morgen, fr, 24.12., 30 min und ! f\xC3\xBCr wichtig",
            [k](App& a, const std::string& text, uint32_t t) {
                if (!einreihen(a, "/todos", JsonBau().text("text", text).fertig(), text, "To-do angelegt", t)) return;
                if (View* v = a.ansicht(k)) static_cast<TodosView*>(v)->platzhalter(text);
            })));
    }
    bool heute_ = false;
    std::vector<Todo> todos_;
};

void TodoDetailView::activate(App& app, const Row& r, uint32_t now) {
    TodosView* eltern = static_cast<TodosView*>(app.ansicht(eltern_));
    if (r.action < 0) {
        const bool erledigt = !t_.erledigt;
        if (!einreihen(app, "/todos/erledigt", todoKoerper(t_.id, erledigt), t_.titel,
                       erledigt ? std::string("Erledigt ") + HAKEN : "Wieder offen", now)) return;
        t_.erledigt = erledigt;
        if (eltern) eltern->anwenden(t_.id, erledigt);
        return;
    }
    const size_t i = static_cast<size_t>(r.action);
    if (i >= t_.schritte.size()) return;
    const bool erledigt = !t_.schritte[i].second;
    if (!einreihen(app, "/todos/schritt", JsonBau().text("id", t_.id).zahl("index", r.action).wahr("erledigt", erledigt).fertig(),
                   t_.schritte[i].first, erledigt ? std::string("Schritt erledigt ") + HAKEN : "Schritt wieder offen", now)) return;
    t_.schritte[i].second = erledigt;
    if (eltern) eltern->schrittAnwenden(t_.id, i, erledigt);
}

// ------------------------------------------------------------------ Heute
class HeuteView : public DatenListe {
public:
    std::string title(App&) override { return "Heute"; }
    std::string pfad() override { return "/heute"; }
    std::string tasten(App&) override { return std::string(ARROW_UD) + " w\xC3\xA4hlen" + DOT + "Enter abhaken" + DOT + "Esc zur\xC3\xBC" "ck"; }
    void lesen(App& app, const Json& j) override {
        z_.clear();
        for (Json e = j["zeilen"].erstes(); e.gueltig() && z_.size() < 40; e = e.naechstes())
            z_.push_back({e["art"].text(), e["text"].text(), e["zeit"].text(), e["id"].text(), e["erledigt"].wahr()});
        for (const auto& w : app.dorf.wartend()) {      // noch nicht Gesendetes drueberlegen
            const Json b = Json::lesen(w.koerper);
            for (auto& z : z_) {
                if (w.pfad == "/todos/erledigt" && z.art == "todo" && z.id == b["id"].text()) z.erledigt = b["erledigt"].wahr();
                if (w.pfad == "/gewohnheiten" && z.art == "gewohnheit" && name(z) == b["name"].text()) z.erledigt = b["erledigt"].wahr();
            }
        }
    }
    void zeilen(App&, uint32_t) override {
        for (size_t i = 0; i < z_.size(); ++i) {
            const Zeile& z = z_[i];
            Row r;
            r.action = static_cast<int>(i);
            r.text = z.text;
            if (z.art == "todo" || z.art == "gewohnheit") {
                r.style = z.erledigt ? Row::Done : Row::Open;
                r.right = z.art == "gewohnheit" ? "Gewohnheit" : z.zeit;
            } else if (z.art == "frist") {
                r.left = "Frist";
                r.right = z.zeit;
                r.rightColor = col::AMBER;
                if (z.erledigt) r.style = Row::Done;
            } else {
                r.left = z.zeit.empty() ? "ganzt." : z.zeit;
            }
            rows.push_back(r);
        }
        if (z_.empty()) leer("Heute steht nichts an");
    }
    void activate(App& app, const Row& r, uint32_t now) override {
        if (r.action < 0 || r.action >= static_cast<int>(z_.size())) return;
        Zeile& z = z_[static_cast<size_t>(r.action)];
        const bool erledigt = !z.erledigt;
        const std::string meldung = erledigt ? std::string("Erledigt ") + HAKEN : "Wieder offen";
        if (z.art == "todo" && !z.id.empty()) {
            if (einreihen(app, "/todos/erledigt", todoKoerper(z.id, erledigt), z.text, meldung, now)) z.erledigt = erledigt;
        } else if (z.art == "gewohnheit") {
            if (einreihen(app, "/gewohnheiten", JsonBau().text("name", name(z)).wahr("erledigt", erledigt).fertig(), z.text, meldung, now))
                z.erledigt = erledigt;
        }
    }

private:
    struct Zeile {
        std::string art, text, zeit, id;
        bool erledigt;
    };
    // Annahme (API.md nennt es nicht): bei Gewohnheiten ist "id" der Name, sonst der Text
    static std::string name(const Zeile& z) { return z.id.empty() ? z.text : z.id; }
    std::vector<Zeile> z_;
};

// ------------------------------------------------------------------ Gewohnheiten
class GewohnheitenView : public DatenListe {
public:
    std::string title(App&) override { return "Gewohnheiten"; }
    std::string pfad() override { return "/gewohnheiten"; }
    std::string tasten(App&) override { return std::string(ARROW_UD) + " w\xC3\xA4hlen" + DOT + "Enter abhaken" + DOT + "Esc zur\xC3\xBC" "ck"; }
    std::string kopfRechts(App&, uint32_t) override {
        if (!geladen_) return "";
        int n = 0;
        for (const auto& g : g_) n += g.erledigt ? 0 : 1;
        return std::to_string(n) + " offen";
    }
    void lesen(App& app, const Json& j) override {
        g_.clear();
        for (Json e = j["gewohnheiten"].erstes(); e.gueltig() && g_.size() < 40; e = e.naechstes())
            g_.push_back({e["name"].text(), e["erledigt"].wahr(), static_cast<int>(e["serie"].zahl())});
        for (const auto& w : app.dorf.wartend()) {
            if (w.pfad != "/gewohnheiten") continue;
            const Json b = Json::lesen(w.koerper);
            for (auto& g : g_)
                if (g.name == b["name"].text()) g.erledigt = b["erledigt"].wahr();
        }
    }
    void zeilen(App&, uint32_t) override {
        for (size_t i = 0; i < g_.size(); ++i) {
            Row r;
            r.style = g_[i].erledigt ? Row::Done : Row::Open;
            r.text = g_[i].name;
            r.action = static_cast<int>(i);
            if (g_[i].serie > 0) r.right = "Serie " + std::to_string(g_[i].serie);
            rows.push_back(r);
        }
        if (g_.empty()) leer("Keine Gewohnheiten f\xC3\xBCr heute");
    }
    void activate(App& app, const Row& r, uint32_t now) override {
        if (r.action < 0 || r.action >= static_cast<int>(g_.size())) return;
        auto& g = g_[static_cast<size_t>(r.action)];
        const bool erledigt = !g.erledigt;
        if (einreihen(app, "/gewohnheiten", JsonBau().text("name", g.name).wahr("erledigt", erledigt).fertig(), g.name,
                      erledigt ? std::string("Erledigt ") + HAKEN : "Wieder offen", now))
            g.erledigt = erledigt;
    }

private:
    struct G {
        std::string name;
        bool erledigt;
        int serie;
    };
    std::vector<G> g_;
};

// ------------------------------------------------------------------ Kalender
void neuerTermin(App& app, uint32_t besitzer) {
    app.push(neu(new TextInputView("Neuer Termin", "Was steht an?", "", "Danach Tag und Uhrzeit w\xC3\xA4hlen",
        [besitzer](App& a, const std::string& titel, uint32_t t) {
            a.push(neu(new DatePickerView("Termin am", a.today(t), [titel, besitzer](App& b, int64_t day, uint32_t) {
                b.push(neu(new TextInputView("Uhrzeit", "Uhrzeit (leer = ganzt\xC3\xA4gig)", "",
                    "z. B. 15 \xC2\xB7 930 \xC2\xB7 1530 \xC2\xB7 15:30 (dauert 60 min)",
                    [titel, day, besitzer](App& c, const std::string& txt, uint32_t t3) {
                        std::string hm;
                        if (!parseTimeInput(txt, hm)) { c.toast("Uhrzeit ung\xC3\xBCltig \xE2\x80\x93 Termin nicht angelegt", t3); return; }
                        JsonBau k;
                        k.text("titel", titel).text("datum", isoDate(day)).text("zeit", hm);
                        if (!hm.empty()) k.zahl("dauerMin", 60);
                        c.dorf.senden("/termine", k.fertig(), besitzer, M_SCHREIBEN);
                        c.toast("Termin wird angelegt \xE2\x80\xA6", t3);
                    }, true)));
            })));
        })));
}

class KalenderView : public DatenListe {
public:
    std::string title(App&) override { return "Kalender"; }
    std::string pfad() override { return "/termine?tage=14"; }
    std::string tasten(App&) override { return std::string(ARROW_UD) + " w\xC3\xA4hlen" + DOT + "Enter Details" + DOT + "Esc zur\xC3\xBC" "ck"; }
    void lesen(App&, const Json& j) override {
        t_.clear();
        for (Json e = j["termine"].erstes(); e.gueltig() && t_.size() < 60; e = e.naechstes())
            t_.push_back({e["datum"].text(), e["zeit"].text(), e["ende"].text(), e["titel"].text(), e["ort"].text()});
        std::stable_sort(t_.begin(), t_.end(), [](const Termin& a, const Termin& b) {
            if (a.datum != b.datum) return a.datum < b.datum;
            return a.zeit < b.zeit;   // ganztaegig (leer) zuerst
        });
    }
    void zeilen(App& app, uint32_t now) override {
        Row add;
        add.style = Row::Plus;
        add.text = "Neuer Termin";
        add.action = -1;
        rows.push_back(add);
        const int64_t today = app.today(now);
        std::string last;
        for (size_t i = 0; i < t_.size(); ++i) {
            const Termin& e = t_[i];
            if (e.datum != last) {
                last = e.datum;
                int64_t d = today;
                parseIsoDate(e.datum, d);
                Row h;
                h.style = Row::Header;
                const int64_t diff = d - today;
                h.text = (diff == 0 ? "Heute" + std::string(DOT) : diff == 1 ? "Morgen" + std::string(DOT) : std::string()) + dayLabel(d);
                rows.push_back(h);
            }
            Row r;
            r.left = e.zeit.empty() ? "ganzt." : e.zeit;
            r.text = e.titel;
            r.action = static_cast<int>(i);
            rows.push_back(r);
        }
        if (t_.empty()) leer("Keine Termine in den n\xC3\xA4" "chsten 14 Tagen");
    }
    void activate(App& app, const Row& r, uint32_t now) override {
        if (r.style == Row::Plus) { neuerTermin(app, kennung); return; }
        if (r.action < 0 || r.action >= static_cast<int>(t_.size())) return;
        const Termin& e = t_[static_cast<size_t>(r.action)];
        std::vector<Absatz> a;
        a.push_back({e.titel, &FONT_TITLE, col::WHITE, 0});
        int64_t d;
        if (parseIsoDate(e.datum, d)) {
            int y, m, dd;
            civilFromDays(d, y, m, dd);
            a.push_back({dayLabel(d) + " " + std::to_string(y) + DOT + relDay(d, app.today(now)), &FONT_BODY, col::TEXT2, 5});
        }
        a.push_back({e.zeit.empty() ? "ganzt\xC3\xA4gig" : e.zeit + (e.ende.empty() ? "" : STRICH + e.ende) + " Uhr", &FONT_BODY, col::ACCENT, 2});
        if (!e.ort.empty()) a.push_back({"Ort: " + e.ort, &FONT_BODY, col::TEXT2, 2});
        app.push(neu(new LeseView("Termin", a)));
    }
    void geschrieben(App& app, const Ergebnis& e, uint32_t now) override {
        if (!e.ok) { app.toast("Nicht angelegt: " + e.fehler, now); return; }
        app.toast("Termin angelegt", now);
        app.dorf.schreibStandErhoehen();
    }

private:
    struct Termin {
        std::string datum, zeit, ende, titel, ort;
    };
    std::vector<Termin> t_;
};

// ------------------------------------------------------------------ Fristen
class FristenView : public DatenListe {
public:
    std::string title(App&) override { return "Fristen"; }
    std::string pfad() override { return "/fristen"; }
    std::string tasten(App&) override { return std::string(ARROW_UD) + " w\xC3\xA4hlen" + DOT + "Enter Details" + DOT + "Esc zur\xC3\xBC" "ck"; }
    void lesen(App&, const Json& j) override {
        f_.clear();
        for (Json e = j["fristen"].erstes(); e.gueltig() && f_.size() < 60; e = e.naechstes())
            f_.push_back({e["titel"].text(), e["fach"].text(), e["faellig"].text(), e["erledigt"].wahr()});
    }
    static std::string wann(const std::string& faellig, int64_t today, Color* c, bool erledigt) {
        int64_t d;
        if (faellig.size() < 10 || !parseIsoDate(faellig.substr(0, 10), d)) return "";
        if (c) *c = erledigt ? col::GREY : d < today ? col::RED : d <= today + 1 ? col::AMBER : col::GREY;
        return relDay(d, today) + (faellig.size() >= 16 ? " " + faellig.substr(11, 5) : "");
    }
    void zeilen(App& app, uint32_t now) override {
        const int64_t today = app.today(now);
        for (size_t i = 0; i < f_.size(); ++i) {
            Row r;
            r.style = f_[i].erledigt ? Row::Done : Row::Open;
            r.text = f_[i].fach.empty() ? f_[i].titel : f_[i].fach + ": " + f_[i].titel;
            r.right = wann(f_[i].faellig, today, &r.rightColor, f_[i].erledigt);
            r.action = static_cast<int>(i);
            rows.push_back(r);
        }
        if (f_.empty()) leer("Keine Fristen in den n\xC3\xA4" "chsten 14 Tagen");
    }
    void activate(App& app, const Row& r, uint32_t now) override {
        if (r.action < 0 || r.action >= static_cast<int>(f_.size())) return;
        const Frist& f = f_[static_cast<size_t>(r.action)];
        std::vector<Absatz> a;
        a.push_back({f.titel, &FONT_TITLE, col::WHITE, 0});
        if (!f.fach.empty()) a.push_back({f.fach, &FONT_BODY, col::ACCENT, 4});
        a.push_back({"F\xC3\xA4llig " + wann(f.faellig, app.today(now), nullptr, false), &FONT_BODY, col::TEXT2, 2});
        if (f.erledigt) a.push_back({std::string("erledigt ") + HAKEN, &FONT_BODY, col::GREEN, 2});
        app.push(neu(new LeseView("Frist", a)));
    }

private:
    struct Frist {
        std::string titel, fach, faellig;
        bool erledigt;
    };
    std::vector<Frist> f_;
};

// ------------------------------------------------------------------ Post
class PostView : public DatenListe {
public:
    std::string title(App&) override { return "Post"; }
    std::string pfad() override { return "/post"; }
    std::string tasten(App&) override { return std::string(ARROW_UD) + " w\xC3\xA4hlen" + DOT + "Enter lesen" + DOT + "Esc zur\xC3\xBC" "ck"; }
    void lesen(App&, const Json& j) override {
        m_.clear();
        for (Json e = j["mails"].erstes(); e.gueltig() && m_.size() < 20; e = e.naechstes())
            m_.push_back({e["von"].text(), e["betreff"].text(), e["zusammenfassung"].text(), e["antwortNoetig"].wahr()});
    }
    void zeilen(App&, uint32_t) override {
        for (size_t i = 0; i < m_.size(); ++i) {
            Row r;
            r.text = m_[i].betreff;
            r.right = m_[i].antwort ? "Antwort n\xC3\xB6tig" : Gfx::fit(FONT_SMALL, m_[i].von, 80);
            if (m_[i].antwort) r.rightColor = col::AMBER;
            r.action = static_cast<int>(i);
            rows.push_back(r);
        }
        if (m_.empty()) leer("Keine Post von heute und gestern");
    }
    void activate(App& app, const Row& r, uint32_t) override {
        if (r.action < 0 || r.action >= static_cast<int>(m_.size())) return;
        const Mail& m = m_[static_cast<size_t>(r.action)];
        std::vector<Absatz> a;
        a.push_back({m.betreff, &FONT_TITLE, col::WHITE, 0});
        a.push_back({"Von: " + m.von, &FONT_SMALL, col::ACCENT, 4});
        if (m.antwort) a.push_back({"Antwort n\xC3\xB6tig", &FONT_SMALL, col::AMBER, 1});
        a.push_back({m.text, &FONT_BODY, col::TEXT2, 5});
        app.push(neu(new LeseView("Post", a)));
    }

private:
    struct Mail {
        std::string von, betreff, text;
        bool antwort;
    };
    std::vector<Mail> m_;
};

// ------------------------------------------------------------------ Freigaben
class FreigabeView : public LeseView {
public:
    FreigabeView(std::string id, const std::string& titel, const std::string& gebaeude, const std::string& text)
        : id_(std::move(id)), was_(titel) {
        titel_ = "Freigabe";
        inhalt_.push_back({titel, &FONT_TITLE, col::WHITE, 0});
        if (!gebaeude.empty()) inhalt_.push_back({gebaeude, &FONT_SMALL, col::ACCENT, 3});
        inhalt_.push_back({text, &FONT_BODY, col::TEXT2, 5});
    }

protected:
    std::string kopfRechts(App&, uint32_t) override { return sendet_ ? "sendet \xE2\x80\xA6" : ""; }
    std::string fuss(App&, uint32_t) override { return "Enter Ja" + std::string(DOT) + "n Nein" + DOT + ARROW_UD + " bl\xC3\xA4ttern" + DOT + "Esc"; }
    bool taste(App& app, const Input& in, uint32_t) override {
        if (sendet_) return nav(in) != K::Esc;
        const uint32_t k = kennung;
        const std::string id = id_;
        if (nav(in) == K::Enter) {
            app.push(neu(new ConfirmView("Wirklich freigeben?", was_, [k, id](App& a, uint32_t) {
                if (View* v = a.ansicht(k)) static_cast<FreigabeView*>(v)->sendet_ = true;
                a.dorf.senden("/freigaben/entscheiden", JsonBau().text("id", id).text("entscheidung", "ja").fertig(), k, M_JA);
            })));
            return true;
        }
        if (in.k == K::Del || (in.k == K::Char && (in.ch == "n" || in.ch == "N"))) {
            app.push(neu(new TextInputView("Ablehnen", "Begr\xC3\xBCndung (leer = ohne)", "", "Enter lehnt ab. Der B\xC3\xBCrgermeister bekommt die Begr\xC3\xBCndung.",
                [k, id](App& a, const std::string& grund, uint32_t) {
                    if (View* v = a.ansicht(k)) static_cast<FreigabeView*>(v)->sendet_ = true;
                    JsonBau b;
                    b.text("id", id).text("entscheidung", "nein");
                    if (!grund.empty()) b.text("begruendung", grund);
                    a.dorf.senden("/freigaben/entscheiden", b.fertig(), k, M_NEIN);
                }, true, 200)));
            return true;
        }
        return false;
    }

public:
    void netz(App& app, const Ergebnis& e, uint32_t now) override {
        sendet_ = false;
        if (!e.ok) { app.toast(e.fehler, now); return; }
        app.toast(e.marke == M_JA ? std::string("Freigegeben ") + HAKEN : "Abgelehnt", now);
        app.dorf.schreibStandErhoehen();
        app.pop();
    }

private:
    std::string id_, was_;
    bool sendet_ = false;
};

class FreigabenView : public DatenListe {
public:
    std::string title(App&) override { return "Freigaben"; }
    std::string pfad() override { return "/freigaben"; }
    std::string tasten(App&) override { return std::string(ARROW_UD) + " w\xC3\xA4hlen" + DOT + "Enter ansehen" + DOT + "Esc zur\xC3\xBC" "ck"; }
    std::string kopfRechts(App&, uint32_t) override { return geladen_ ? std::to_string(f_.size()) + " offen" : ""; }
    void lesen(App&, const Json& j) override {
        f_.clear();
        for (Json e = j["freigaben"].erstes(); e.gueltig() && f_.size() < 30; e = e.naechstes())
            f_.push_back({e["id"].text(), e["titel"].text(), e["gebaeude"].text(), e["text"].text()});
    }
    void zeilen(App&, uint32_t) override {
        for (size_t i = 0; i < f_.size(); ++i) {
            Row r;
            r.text = f_[i].titel;
            r.right = Gfx::fit(FONT_SMALL, f_[i].gebaeude, 70);
            r.action = static_cast<int>(i);
            rows.push_back(r);
        }
        if (f_.empty()) leer("Nichts zu entscheiden");
    }
    void activate(App& app, const Row& r, uint32_t) override {
        if (r.action < 0 || r.action >= static_cast<int>(f_.size())) return;
        const F& f = f_[static_cast<size_t>(r.action)];
        app.push(neu(new FreigabeView(f.id, f.titel, f.gebaeude, f.text)));
    }
    bool other(App& app, const Input& in, const Row* r, uint32_t now) override {
        if (r && nav(in) == K::Right) { activate(app, *r, now); return true; }
        return false;
    }

private:
    struct F {
        std::string id, titel, gebaeude, text;
    };
    std::vector<F> f_;
};

// ------------------------------------------------------------------ Buergermeister
class BmChatView : public LeseView {
public:
    BmChatView(std::string chatId, std::string erste) : chatId_(std::move(chatId)), erste_(std::move(erste)) {
        titel_ = "B\xC3\xBCrgermeister";
    }
    bool animated() const override { return status_ == "laeuft" || sendet_; }
    void tick(App& app, uint32_t now) override {
        if (!begonnen_) {
            begonnen_ = true;
            if (!erste_.empty()) schicken(app, erste_, now);
            else abrufen(app, now);
            erste_.clear();
            return;
        }
        if (!fragt_ && !sendet_ && pollt_ && static_cast<int32_t>(now - pollUm_) >= 0) abrufen(app, now);
    }
    void netz(App& app, const Ergebnis& e, uint32_t now) override {
        if (e.marke == M_SCHREIBEN) {
            sendet_ = false;
            if (!e.ok) {
                app.toast("Nicht gesendet: " + e.fehler, now);
                entwurf_ = gesendet_;
                nachrichten_ -= std::min(nachrichten_, eigene_);      // die vorlaeufig gezeigte Nachricht wieder entfernen
                eigene_ = 0;
                status_ = chatId_.empty() ? "" : "fertig";
                aufbauen(false);
                return;
            }
            chatId_ = e.j["chatId"].text(chatId_);
            status_ = "laeuft";
            pollt_ = true;
            pollUm_ = now + 1000;
            aufbauen(true);
            return;
        }
        fragt_ = false;
        if (!e.ok) {                 // Abruf fehlgeschlagen: spaeter noch einmal
            offline_ = true;
            pollt_ = true;
            pollUm_ = now + 6000;
            return;
        }
        offline_ = false;
        const size_t vorher = nachrichten_;
        const std::string statusVorher = status_;
        status_ = e.j["status"].text("fertig");
        inhalt_.clear();
        eigene_ = 0;
        for (Json m = e.j["nachrichten"].erstes(); m.gueltig() && inhalt_.size() < 44; m = m.naechstes()) {
            const bool du = m["von"].text() == "du";
            inhalt_.push_back({du ? "Du" : "B\xC3\xBCrgermeister", &FONT_SMALL, du ? col::ACCENT : col::GREEN, inhalt_.empty() ? 0 : 6});
            inhalt_.push_back({m["text"].text(), &FONT_BODY, du ? col::WHITE : col::TEXT2, 0});
        }
        nachrichten_ = inhalt_.size();
        pollt_ = status_ == "laeuft" || status_ == "wartet";
        pollUm_ = now + (status_ == "laeuft" ? 3000 : 10000);
        aufbauen(nachrichten_ != vorher || status_ != statusVorher || erstes_);
        erstes_ = false;
    }

protected:
    std::string kopfRechts(App&, uint32_t now) override {
        if (sendet_) return "sendet \xE2\x80\xA6";
        if (status_ == "laeuft") return (now / 500) % 3 == 0 ? "\xC2\xB7" : (now / 500) % 3 == 1 ? "\xC2\xB7 \xC2\xB7" : "\xC2\xB7 \xC2\xB7 \xC2\xB7";      // "denkt nach" steht im Text
        if (fragt_ && nachrichten_ == 0) return LAEDT;
        return "";
    }
    std::string fuss(App&, uint32_t) override {
        if (offline_) return "offline \xE2\x80\x93 versuche es wieder" + std::string(DOT) + "Esc zur\xC3\xBC" "ck";
        if (status_ == "laeuft") return std::string(ARROW_UD) + " bl\xC3\xA4ttern" + DOT + "Esc zur\xC3\xBC" "ck (er denkt weiter)";
        return "tippen = antworten" + std::string(DOT) + ARROW_UD + " bl\xC3\xA4ttern" + DOT + "Esc";
    }
    Color fussFarbe(App&) override { return offline_ ? col::AMBER : col::GREY; }
    bool taste(App& app, const Input& in, uint32_t now) override {
        const bool buchstabe = in.k == K::Char && isLetter(in.ch);
        if (!buchstabe && in.k != K::Enter) return false;
        if (sendet_ || status_ == "laeuft") { app.toast("Er denkt noch nach \xE2\x80\xA6", now); return true; }
        const uint32_t k = kennung;
        std::string start = entwurf_;
        if (buchstabe) start += in.ch;
        TextInputView* eingabe = new TextInputView("Nachricht", "An den B\xC3\xBCrgermeister", start,
            "Enter schickt ab \xC2\xB7 Tab sprechen = geht gleich raus. Die Antwort kann dauern.",
            [k](App& a, const std::string& text, uint32_t t) {
                if (View* v = a.ansicht(k)) static_cast<BmChatView*>(v)->schicken(a, text, t);
            }, false, 400);
        eingabe->direktSenden();
        app.push(neu(eingabe));
        return true;
    }

private:
    void abrufen(App& app, uint32_t now) {
        if (chatId_.empty()) return;
        fragt_ = true;
        pollUm_ = now + 3000;
        app.dorf.holen("/buergermeister/" + chatId_, kennung, M_LADEN, false);
    }
    void schicken(App& app, const std::string& text, uint32_t) {
        entwurf_.clear();
        gesendet_ = text;
        sendet_ = true;
        JsonBau b;
        b.text("text", text);
        if (!chatId_.empty()) b.text("chatId", chatId_);
        app.dorf.senden("/buergermeister", b.fertig(), kennung, M_SCHREIBEN);
        // gleich zeigen, was man gefragt hat
        inhalt_.resize(nachrichten_);
        inhalt_.push_back({"Du", &FONT_SMALL, col::ACCENT, inhalt_.empty() ? 0 : 6});
        inhalt_.push_back({text, &FONT_BODY, col::WHITE, 0});
        nachrichten_ = inhalt_.size();
        eigene_ = 2;
        status_ = "laeuft";
        aufbauen(true);
    }
    // Statuszeile ans Ende haengen und neu umbrechen
    void aufbauen(bool ansEnde) {
        inhalt_.resize(std::min(inhalt_.size(), nachrichten_));
        nachrichten_ = inhalt_.size();
        if (status_ == "laeuft") inhalt_.push_back({"denkt nach \xE2\x80\xA6", &FONT_BODY, col::AMBER, 6});
        else if (status_ == "wartet") inhalt_.push_back({"wartet (z. B. auf eine Freigabe von dir)", &FONT_SMALL, col::AMBER, 6});
        else if (status_ == "fehler") inhalt_.push_back({"Der Lauf ist mit einem Fehler beendet.", &FONT_SMALL, col::RED, 6});
        else if (inhalt_.empty()) inhalt_.push_back({"Schreib dem B\xC3\xBCrgermeister \xE2\x80\x93 einfach lostippen.", &FONT_BODY, col::GREY, 0});
        inhaltNeu();
        if (ansEnde) zumEnde();
    }
    std::string chatId_, erste_, status_, entwurf_, gesendet_;
    bool begonnen_ = false, sendet_ = false, fragt_ = false, pollt_ = false, offline_ = false, erstes_ = true;
    uint32_t pollUm_ = 0;
    size_t nachrichten_ = 0;    // Absaetze ohne die Statuszeile
    size_t eigene_ = 0;
};

class BmListeView : public DatenListe {
public:
    std::string title(App&) override { return "B\xC3\xBCrgermeister"; }
    std::string pfad() override { return "/buergermeister"; }
    std::string tasten(App&) override { return "Enter \xC3\xB6" "ffnen" + std::string(DOT) + "tippen = neues Gespr\xC3\xA4" "ch"; }
    void lesen(App&, const Json& j) override {
        c_.clear();
        for (Json e = j["chats"].erstes(); e.gueltig() && c_.size() < 10; e = e.naechstes())
            c_.push_back({e["chatId"].text(), e["titel"].text(), e["status"].text(), e["zeit"].text()});
    }
    void zeilen(App&, uint32_t) override {
        Row add;
        add.style = Row::Plus;
        add.text = "Neues Gespr\xC3\xA4" "ch";
        add.action = -1;
        rows.push_back(add);
        for (size_t i = 0; i < c_.size(); ++i) {
            Row r;
            r.text = c_[i].titel.empty() ? "Gespr\xC3\xA4" "ch" : c_[i].titel;
            r.right = c_[i].status == "laeuft" ? "denkt nach" : c_[i].status == "wartet" ? "wartet" : c_[i].status == "fehler" ? "Fehler" : c_[i].zeit;
            r.rightColor = c_[i].status == "laeuft" || c_[i].status == "wartet" ? col::AMBER : c_[i].status == "fehler" ? col::RED : col::GREY;
            r.action = static_cast<int>(i);
            rows.push_back(r);
        }
    }
    void activate(App& app, const Row& r, uint32_t) override {
        if (r.style == Row::Plus) { neuesGespraech(app, ""); return; }
        if (r.action < 0 || r.action >= static_cast<int>(c_.size())) return;
        geladenUm_ -= 60000;      // beim Zurueckkommen die Liste auffrischen
        app.push(neu(new BmChatView(c_[static_cast<size_t>(r.action)].id, "")));
    }
    bool other(App& app, const Input& in, const Row*, uint32_t) override {
        if (in.k == K::Char && isLetter(in.ch)) { neuesGespraech(app, in.ch); return true; }
        return false;
    }

private:
    void neuesGespraech(App& app, const std::string& start) {
        geladenUm_ -= 60000;
        TextInputView* eingabe = new TextInputView("Neues Gespr\xC3\xA4" "ch", "Was soll der B\xC3\xBCrgermeister tun?", start,
            "Enter schickt ab \xC2\xB7 Tab sprechen = geht gleich raus.",
            [](App& a, const std::string& text, uint32_t) { a.push(neu(new BmChatView("", text))); }, false, 400);
        eingabe->direktSenden();
        app.push(neu(eingabe));
    }
    struct C {
        std::string id, titel, status, zeit;
    };
    std::vector<C> c_;
};

// ------------------------------------------------------------------ Kirchturm
class KirchturmEinstView : public ListView {
public:
    explicit KirchturmEinstView(const KirchturmStand& k) : f_(k.fokus), k_(k.kurz), l_(k.lang), n_(k.langNach) {}
    std::string title(App&) override { return "Pomodoro"; }
    std::string headerRight(App&, uint32_t) override { return sendet_ ? "speichert \xE2\x80\xA6" : ""; }
    std::string hint(App&, uint32_t) override { return std::string(ARROW_LR) + " \xC3\xA4ndern" + DOT + "Esc speichern"; }
    void build(App& app, uint32_t) override {
        if (!gemerkt_) { gemerkt_ = true; laut_ = app.dorf.lautstaerke; }
        rows.clear();
        auto add = [&](const std::string& label, const std::string& val) {
            Row r;
            r.style = Row::Value;
            r.text = label;
            r.right = val;
            r.action = static_cast<int>(rows.size());
            rows.push_back(r);
        };
        add("Fokus", std::to_string(f_) + " min");
        add("Kurze Pause", std::to_string(k_) + " min");
        add("Lange Pause", std::to_string(l_) + " min");
        add("Lange Pause nach", std::to_string(n_) + (n_ == 1 ? " Fokusphase" : " Fokusphasen"));
        add("Lautst\xC3\xA4rke (Cardputer)", laut_ == 1 ? "leise" : laut_ == 3 ? "laut" : "mittel");
    }
    void change(App& app, int row, int d) {
        auto step = [](int v, int dd, int lo, int hi, int big) {
            const int s = v >= big ? 5 : 1;
            int n = v + dd * s;
            if (dd < 0 && v > big && n < big) n = big;
            return std::max(lo, std::min(hi, n));
        };
        switch (row) {
            case 0: f_ = step(f_, d, 1, 120, 10); break;
            case 1: k_ = std::max(1, std::min(30, k_ + d)); break;
            case 2: l_ = step(l_, d, 1, 60, 10); break;
            case 3: n_ = std::max(1, std::min(8, n_ + d)); break;
            case 4:
                laut_ = std::max(1, std::min(3, laut_ + d));
                app.dorf.lautstaerkeSetzen(laut_);
                app.platform.play(Sound::Test, laut_);
                break;
            default: break;
        }
    }
    void activate(App& app, const Row& r, uint32_t) override { change(app, r.action, 1); }
    bool other(App& app, const Input& in, const Row* r, uint32_t) override {
        const K k = nav(in);
        if (r && (k == K::Left || k == K::Right)) {
            change(app, r->action, k == K::Right ? 1 : -1);
            return true;
        }
        if (k == K::Esc) {
            const KirchturmStand& s = app.dorf.kirchturm;
            const bool neu = f_ != s.fokus || k_ != s.kurz || l_ != s.lang || n_ != s.langNach;
            if (!neu || sendet_ || fehlgeschlagen_) { app.pop(); return true; }
            sendet_ = true;
            app.dorf.senden("/kirchturm/einstellungen",
                            JsonBau().zahl("fokus", f_).zahl("kurz", k_).zahl("lang", l_).zahl("langNach", n_).fertig(), kennung, M_SCHREIBEN);
            return true;
        }
        return false;
    }
    void netz(App& app, const Ergebnis& e, uint32_t now) override {
        sendet_ = false;
        if (!e.ok) {
            fehlgeschlagen_ = true;      // noch einmal Esc schliesst ohne zu speichern
            app.toast("Nicht gespeichert: " + e.fehler, now);
            return;
        }
        app.dorf.kirchturm.fokus = f_;
        app.dorf.kirchturm.kurz = k_;
        app.dorf.kirchturm.lang = l_;
        app.dorf.kirchturm.langNach = n_;
        app.dorf.kirchturmHolen(now);
        app.toast("Gespeichert", now);
        app.pop();
    }

private:
    int f_, k_, l_, n_, laut_ = 2;
    bool gemerkt_ = false, sendet_ = false, fehlgeschlagen_ = false;
};

class KirchturmView : public View {
public:
    bool animated() const override { return true; }
    void tick(App& app, uint32_t now) override {
        app.dorf.kirchturmSchnell(now);
        if (!gefragt_) { gefragt_ = true; app.dorf.kirchturmHolen(now); }
    }
    void draw(Gfx& g, App& app, uint32_t now) override {
        const KirchturmStand& k = app.dorf.kirchturm;
        const int n = static_cast<int>(k.laufend.size());
        idx_ = std::max(0, std::min(idx_, n - 1));
        std::string rechts = k.offline ? "offline" : sendet_ ? "sendet \xE2\x80\xA6" : n > 1 ? std::to_string(idx_ + 1) + "/" + std::to_string(n) : "";
        app.header(g, "Kirchturm", now, rechts);
        if (!k.bekannt) {
            g.text(FONT_BODY, 120, 72, app.dorf.verbunden() ? LAEDT : "Kein Netz", col::GREY, Align::Center);
            app.footer(g, "Esc zur\xC3\xBC" "ck");
            return;
        }
        if (n == 0) {
            g.text(FONT_MENU, 120, 58, "Keine Uhr l\xC3\xA4uft", col::TEXT2, Align::Center);
            g.text(FONT_SMALL, 120, 78, "Pomodoro: " + std::to_string(k.fokus) + " / " + std::to_string(k.kurz) + " / " +
                   std::to_string(k.lang) + " min", col::GREY, Align::Center);
            g.text(FONT_SMALL, 120, 96, "Enter startet einen Pomodoro", col::ACCENT, Align::Center);
            app.footer(g, "t Timer" + std::string(DOT) + "w Wecker" + DOT + "e Einstellungen" + DOT + "Esc");
            return;
        }
        const Uhr& u = k.laufend[static_cast<size_t>(idx_)];
        const int64_t rest = app.dorf.restMs(u, now);
        const bool pomo = u.art == "pomodoro";
        const Color pc = pomo && u.phase != "fokus" ? col::GREEN : col::ACCENT;
        std::string label;
        if (pomo) label = phasenName(u.phase) + (u.runde > 0 ? std::string(DOT) + "Runde " + std::to_string(u.runde) : "");
        else if (u.art == "timer") label = "Timer" + (u.titel.empty() ? "" : std::string(DOT) + u.titel);
        else if (u.art == "wecker") label = "Wecker" + (u.titel.empty() ? "" : std::string(DOT) + u.titel);
        else label = "Stoppuhr" + (u.titel.empty() ? "" : std::string(DOT) + u.titel);
        if (u.pausiert) label += std::string(DOT) + "pausiert";
        g.text(FONT_TITLE, 120, 42, label, u.pausiert ? col::AMBER : pc, Align::Center, 228);
        std::string gross, klein;
        if (u.art == "wecker") {
            const int64_t lokal = u.endeMs / 1000 + app.clock.offset() * 60;
            const int min = static_cast<int>(((lokal % 86400) + 86400) % 86400 / 60);
            gross = two(min / 60) + ":" + two(min % 60);
            const long m = static_cast<long>((rest + 59999) / 60000);
            klein = m >= 60 ? "in " + std::to_string(m / 60) + " h " + std::to_string(m % 60) + " min" : "in " + std::to_string(m) + " min";
        } else if (u.art == "stoppuhr") {
            gross = "--:--";
            klein = "l\xC3\xA4uft auf dem Server";
        } else {
            gross = mmss(rest);
            if (pomo && !u.titel.empty()) klein = u.titel;
        }
        g.text(FONT_BIG, 120, 86, gross, u.pausiert ? col::TEXT2 : col::WHITE, Align::Center);
        if (pomo) {
            const int64_t total = static_cast<int64_t>(std::max(1, u.phase == "fokus" ? k.fokus : u.phase == "kurz" ? k.kurz : k.lang)) * 60000;
            const int done = static_cast<int>(200 * std::max<int64_t>(0, std::min(total, total - rest)) / total);
            g.rrect(20, 94, 200, 4, 2, col::LINE);
            if (done > 0) g.rrect(20, 94, std::max(4, std::min(200, done)), 4, 2, pc);
        }
        if (!klein.empty()) g.text(FONT_SMALL, 120, 111, klein, col::TEXT2, Align::Center, 224);
        if (pomo) app.footer(g, "Enter " + std::string(u.pausiert ? "weiter" : "Pause") + DOT + ARROW_R + " n\xC3\xA4" "chste" + DOT + "Del Stopp" + DOT + "Tab");
        else app.footer(g, (u.art == "timer" ? "Enter " + std::string(u.pausiert ? "weiter" : "Pause") + DOT : std::string()) + "Del Stopp" + DOT + "Tab mehr");
    }
    void key(const Input& in, App& app, uint32_t now) override {
        const K k = nav(in);
        const KirchturmStand& ks = app.dorf.kirchturm;
        const int n = static_cast<int>(ks.laufend.size());
        const Uhr* u = n > 0 ? &ks.laufend[static_cast<size_t>(std::max(0, std::min(idx_, n - 1)))] : nullptr;
        if (k == K::Esc || k == K::Left) { app.pop(); return; }
        if (in.k == K::Char && (in.ch == "t" || in.ch == "T")) { timer(app); return; }
        if (in.k == K::Char && (in.ch == "w" || in.ch == "W")) { wecker(app); return; }
        if (in.k == K::Char && (in.ch == "e" || in.ch == "E")) { app.push(neu(new KirchturmEinstView(ks))); return; }
        if (in.k == K::Char && (in.ch == "p" || in.ch == "P")) { aktion(app, JsonBau().text("aktion", "pomodoro").fertig()); return; }
        if (in.k == K::Tab || (in.k == K::Char && (in.ch == "m" || in.ch == "M"))) {
            const uint32_t kn = kennung;
            app.push(neu(new ChoiceView("Kirchturm", {"Pomodoro starten", "Timer stellen", "Wecker stellen", "Pomodoro-Einstellungen"},
                [kn](App& a, int pick, uint32_t) {
                    KirchturmView* v = static_cast<KirchturmView*>(a.ansicht(kn));
                    if (!v) return;
                    if (pick == 0) v->aktion(a, JsonBau().text("aktion", "pomodoro").fertig());
                    if (pick == 1) v->timer(a);
                    if (pick == 2) v->wecker(a);
                    if (pick == 3) a.push(neu(new KirchturmEinstView(a.dorf.kirchturm)));
                })));
            return;
        }
        if (k == K::Up) { idx_ = std::max(0, idx_ - 1); return; }
        if (k == K::Down) { idx_ = std::min(std::max(0, n - 1), idx_ + 1); return; }
        if (!ks.bekannt) return;
        if (k == K::Enter) {
            if (!u) aktion(app, JsonBau().text("aktion", "pomodoro").fertig());
            else if (u->art == "pomodoro" || u->art == "timer")
                aktion(app, JsonBau().text("aktion", u->pausiert ? "weiter" : "pause").text("id", u->id).fertig());
            return;
        }
        if (!u) return;
        if (k == K::Right && u->art == "pomodoro") { aktion(app, JsonBau().text("aktion", "naechste").text("id", u->id).fertig()); return; }
        if (in.k == K::Del) {
            const uint32_t kn = kennung;
            const std::string id = u->id;
            app.push(neu(new ConfirmView("Uhr stoppen?", u->art == "pomodoro" ? "Der Pomodoro wird beendet." : u->titel,
                [kn, id](App& a, uint32_t) {
                    if (View* v = a.ansicht(kn)) static_cast<KirchturmView*>(v)->aktion(a, JsonBau().text("aktion", "stopp").text("id", id).fertig());
                })));
        }
        (void)now;
    }
    void netz(App& app, const Ergebnis& e, uint32_t now) override {
        sendet_ = false;
        if (!e.ok) { app.toast(e.fehler, now); return; }
        app.dorf.kirchturmHolen(now);
    }
    void aktion(App& app, const std::string& koerper) {
        sendet_ = true;
        app.dorf.kirchturmAktion(koerper, kennung, M_SCHREIBEN);
    }
    void timer(App& app) {
        const uint32_t kn = kennung;
        app.push(neu(new TextInputView("Timer", "Wie viele Minuten?", "", "z. B. 10 \xE2\x80\x93 oder mit Namen: 4 Tee",
            [kn](App& a, const std::string& txt, uint32_t t) {
                int min = 0;
                size_t i = 0;
                while (i < txt.size() && txt[i] >= '0' && txt[i] <= '9' && i < 4) min = min * 10 + (txt[i++] - '0');
                std::string titel = txt.substr(i);
                while (!titel.empty() && titel.front() == ' ') titel.erase(0, 1);
                if (min < 1 || min > 600) { a.toast("Minuten ung\xC3\xBCltig (1\xE2\x80\x93" "600)", t); return; }
                JsonBau b;
                b.text("aktion", "timer").zahl("minuten", min);
                if (!titel.empty()) b.text("titel", titel);
                if (View* v = a.ansicht(kn)) static_cast<KirchturmView*>(v)->aktion(a, b.fertig());
            })));
    }
    void wecker(App& app) {
        const uint32_t kn = kennung;
        app.push(neu(new TextInputView("Wecker", "Um wie viel Uhr?", "", "z. B. 7 \xC2\xB7 730 \xC2\xB7 0730 \xC2\xB7 7:30",
            [kn](App& a, const std::string& txt, uint32_t t) {
                std::string hm;
                if (!parseTimeInput(txt, hm) || hm.empty()) { a.toast("Uhrzeit ung\xC3\xBCltig", t); return; }
                if (View* v = a.ansicht(kn)) static_cast<KirchturmView*>(v)->aktion(a, JsonBau().text("aktion", "wecker").text("zeit", hm).fertig());
            })));
    }

private:
    int idx_ = 0;
    bool gefragt_ = false, sendet_ = false;
};

// ------------------------------------------------------------------ WLAN
class WlanView : public ListView {
public:
    std::string title(App&) override { return "WLAN"; }
    std::string headerRight(App& app, uint32_t) override { return app.dorf.sucht() ? "sucht \xE2\x80\xA6" : ""; }
    bool animated() const override { return true; }
    std::string hint(App& app, uint32_t) override {
        if (app.dorf.versuch() == Dorf::Versuch::Laeuft) return "verbinde mit " + app.dorf.versuchSsid() + " \xE2\x80\xA6";
        const Row* r = current();
        if (r && r->action == 1) return ", / Vorrang" + std::string(DOT) + "Del vergessen" + DOT + "Tab Passwort";
        return "Enter verbinden" + std::string(DOT) + "Esc zur\xC3\xBC" "ck";
    }
    Color hintColor(App& app) override { return app.dorf.versuch() == Dorf::Versuch::Laeuft ? col::AMBER : col::GREY; }
    void tick(App& app, uint32_t now) override {
        if (!gesucht_) { gesucht_ = true; app.dorf.wlanSuchen(now); }
        const Dorf::Versuch v = app.dorf.versuch();
        if (v == Dorf::Versuch::Ok) {
            app.dorf.versuchFertig();
            app.toast("Verbunden mit " + app.dorf.versuchSsid() + " " + HAKEN, now);
            if (!app.dorf.gekoppelt()) app.replace(koppelnAnsicht());   // Ersteinrichtung: weiter zum Koppeln
        } else if (v == Dorf::Versuch::Fehler) {
            app.dorf.versuchFertig();
            app.toast("Keine Verbindung \xE2\x80\x93 Passwort pr\xC3\xBC" "fen", now);
        }
    }
    void build(App& app, uint32_t) override {
        rows.clear();
        Dorf& d = app.dorf;
        const std::string aktuell = d.verbunden() ? d.wlanName() : "";
        if (!d.netze.empty()) {
            Row h;
            h.style = Row::Header;
            h.text = "Gespeichert \xE2\x80\x93 oben = Vorrang";
            rows.push_back(h);
        }
        for (const auto& e : d.netze) {      // Stern = gespeichert, gruen = gerade verbunden
            Row r;
            r.style = Row::Star;
            r.text = e.ssid;
            r.key = e.ssid;
            r.action = 1;
            const int rssi = d.rssi(e.ssid);
            if (e.ssid == aktuell) { r.right = "verbunden"; r.rightColor = col::GREEN; }
            else if (rssi != 0) r.right = rssi < Dorf::RSSI_SCHWACH ? "sehr schwach" : "in Reichweite";
            else if (e.versteckt) r.right = "versteckt";
            rows.push_back(r);
        }
        Row h;
        h.style = Row::Header;
        h.text = "In der N\xC3\xA4he (auch Handy-Hotspot)";
        rows.push_back(h);
        int n = 0;
        for (const auto& f : d.funde) {
            if (d.netz(f.ssid)) continue;
            Row r;
            r.text = f.ssid;
            r.key = f.ssid;
            r.action = f.offen ? 3 : 2;
            r.right = std::string(f.rssi > -60 ? "stark" : f.rssi > -75 ? "mittel" : "schwach") + (f.offen ? std::string(DOT) + "offen" : "");
            rows.push_back(r);
            ++n;
        }
        if (n == 0) {
            Row r;
            r.style = Row::Note;
            r.text = d.sucht() ? "suche Netze \xE2\x80\xA6" : "keine weiteren Netze gefunden";
            rows.push_back(r);
        }
        Row a;
        a.style = Row::Plus;
        a.text = "Anderes Netz (Name tippen)";
        a.action = 4;
        rows.push_back(a);
        Row s;
        s.text = "Neu suchen";
        s.action = 5;
        rows.push_back(s);
    }
    static void passwortFragen(App& app, const std::string& ssid, bool versteckt) {
        app.push(neu(new TextInputView("WLAN-Passwort", ssid, "", "Gro\xC3\x9F-/Kleinschreibung beachten. Leer = offenes Netz.",
            [ssid, versteckt](App& a, const std::string& pw, uint32_t t) { a.dorf.wlanVersuchen(ssid, pw, t, versteckt); }, true, 63, true)));
    }
    void activate(App& app, const Row& r, uint32_t now) override {
        if (app.dorf.versuch() == Dorf::Versuch::Laeuft) return;
        if (r.action == 1) {
            const WlanEintrag* e = app.dorf.netz(r.key);
            if (e) app.dorf.wlanVersuchen(e->ssid, e->passwort, now, e->versteckt);
        } else if (r.action == 2) {
            passwortFragen(app, r.key, false);
        } else if (r.action == 3) {
            app.dorf.wlanVersuchen(r.key, "", now);
        } else if (r.action == 4) {
            // Von Hand getippt: gilt als "versteckt" - wird kuenftig auch ohne Suche direkt versucht
            app.push(neu(new TextInputView("Anderes Netz", "Name des WLANs (SSID)", "", "Genau so, wie es am Handy oder Router hei\xC3\x9Ft.",
                [](App& a, const std::string& ssid, uint32_t) { passwortFragen(a, ssid, true); }, false, 32, true)));
        } else if (r.action == 5) {
            app.dorf.wlanSuchen(now);
        }
    }
    bool other(App& app, const Input& in, const Row* r, uint32_t now) override {
        if (!r || r->action != 1) return false;
        const std::string ssid = r->key;
        if (in.k == K::Del) {
            app.push(neu(new ConfirmView("Netz vergessen?", ssid, [ssid](App& a, uint32_t t) {
                a.dorf.netzVergessen(ssid);
                a.toast("Vergessen", t);
            })));
            return true;
        }
        if (in.k == K::Tab) {      // Passwort neu eingeben
            const WlanEintrag* e = app.dorf.netz(ssid);
            passwortFragen(app, ssid, e && e->versteckt);
            return true;
        }
        const K k = nav(in);
        if (k == K::Left || k == K::Right) {      // Vorrang: , = nach oben, / = nach unten (die Auswahl wandert mit)
            if (app.dorf.netzVerschieben(ssid, k == K::Left ? -1 : 1)) {
                sel += k == K::Left ? -1 : 1;
                app.toast(k == K::Left ? "Vorrang h\xC3\xB6her" : "Vorrang tiefer", now);
            }
            return true;
        }
        return false;
    }

private:
    bool gesucht_ = false;
};

// ------------------------------------------------------------------ Koppeln
class KoppelnView : public ListView {
public:
    std::string title(App&) override { return "Koppeln"; }
    std::string headerRight(App&, uint32_t) override { return sendet_ ? "fragt das Dorf \xE2\x80\xA6" : ""; }
    std::string hint(App& app, uint32_t) override {
        if (!app.dorf.verbunden()) return "Kein WLAN \xE2\x80\x93 erst unter Einstellungen verbinden";
        return "Enter eintippen" + std::string(DOT) + "Esc zur\xC3\xBC" "ck";
    }
    Color hintColor(App& app) override { return app.dorf.verbunden() ? col::GREY : col::AMBER; }
    void build(App& app, uint32_t) override {
        if (!begonnen_) { begonnen_ = true; adresse_ = app.dorf.adresse; }
        rows.clear();
        Row a;
        a.style = Row::Value;
        a.text = "Dorf-Adresse";
        a.right = adresse_.empty() ? "eintippen" : adresse_;
        a.action = 1;
        rows.push_back(a);
        Row c;
        c.style = Row::Value;
        c.text = "Code";
        c.right = code_.empty() ? "6 Ziffern" : code_;
        c.action = 2;
        rows.push_back(c);
        Row k;
        k.style = Row::Plus;
        k.text = "Jetzt koppeln";
        k.action = 3;
        rows.push_back(k);
        Row n1, n2;
        n1.style = n2.style = Row::Header;
        n1.text = "Code: App \xE2\x86\x92 Einstellungen \xE2\x86\x92 Ger\xC3\xA4te";
        n2.text = "\xE2\x86\x92 \xE2\x80\x9E" "Cardputer koppeln\xE2\x80\x9C (gilt 5 min)";
        rows.push_back(n1);
        rows.push_back(n2);
    }
    void activate(App& app, const Row& r, uint32_t now) override {
        if (sendet_) return;
        const uint32_t k = kennung;
        if (r.action == 1) {
            app.push(neu(new TextInputView("Dorf-Adresse", "Adresse deines Agentendorfs", adresse_, "z. B. dorf.beispiel.de \xE2\x80\x93 https kommt von selbst",
                [k](App& a, const std::string& txt, uint32_t t) {
                    KoppelnView* v = static_cast<KoppelnView*>(a.ansicht(k));
                    if (!v) return;
                    const std::string adr = a.dorf.adresseBereinigen(txt);
                    if (adr.empty()) { a.toast("Adresse ung\xC3\xBCltig", t); return; }
                    v->adresse_ = adr;
                    v->sel = 1;
                }, false, 80, true)));
        } else if (r.action == 2) {
            app.push(neu(new TextInputView("Code", "6-stelliger Code aus der App", "", "App: Einstellungen \xE2\x86\x92 Ger\xC3\xA4te \xE2\x86\x92 \xE2\x80\x9E" "Cardputer koppeln\xE2\x80\x9C",
                [k](App& a, const std::string& txt, uint32_t t) {
                    KoppelnView* v = static_cast<KoppelnView*>(a.ansicht(k));
                    if (!v) return;
                    std::string code;
                    for (char c : txt)
                        if (c >= '0' && c <= '9') code += c;
                    if (code.size() != 6) { a.toast("Der Code hat 6 Ziffern", t); return; }
                    v->code_ = code;
                    v->sel = 2;
                }, false, 12)));
        } else if (r.action == 3) {
            if (adresse_.empty()) { app.toast("Erst die Dorf-Adresse eintippen", now); sel = 0; return; }
            if (code_.size() != 6) { app.toast("Erst den Code eintippen", now); sel = 1; return; }
            if (!app.dorf.verbunden()) { app.toast("Kein WLAN", now); return; }
            sendet_ = true;
            app.dorf.koppeln(adresse_, code_, kennung, M_SCHREIBEN);
        }
    }
    void netz(App& app, const Ergebnis& e, uint32_t now) override {
        sendet_ = false;
        const std::string token = e.ok ? e.j["token"].text() : "";
        if (token.size() >= 16) {
            app.dorf.koppelnFertig(adresse_, token, now);
            app.dorf.schreibStandErhoehen();
            app.toast(std::string("Gekoppelt ") + HAKEN, now);
            app.popTo(app.dorfTiefe());
            return;
        }
        code_.clear();
        sel = 1;
        if (e.status == 401) app.toast("Code falsch oder abgelaufen", now);
        else if (e.status == 0) app.toast("Dorf nicht erreichbar \xE2\x80\x93 Adresse pr\xC3\xBC" "fen", now);
        else app.toast(e.ok ? "Antwort ohne Schl\xC3\xBCssel" : e.fehler, now);
    }

private:
    std::string adresse_, code_;
    bool begonnen_ = false, sendet_ = false;
};

class NeuKoppelnView : public View {
public:
    void draw(Gfx& g, App& app, uint32_t now) override {
        app.header(g, "Neu koppeln", now);
        g.text(FONT_TITLE, 120, 50, "Das Dorf kennt diesen", col::WHITE, Align::Center);
        g.text(FONT_TITLE, 120, 68, "Cardputer nicht mehr", col::WHITE, Align::Center);
        g.text(FONT_SMALL, 120, 88, "Schl\xC3\xBCssel gesperrt oder abgelaufen.", col::TEXT2, Align::Center);
        g.text(FONT_SMALL, 120, 103, "Gemerkte \xC3\x84nderungen bleiben erhalten.", col::TEXT2, Align::Center);
        app.footer(g, "Enter neu koppeln" + std::string(DOT) + "Esc zur\xC3\xBC" "ck");
    }
    void key(const Input& in, App& app, uint32_t) override {
        const K k = nav(in);
        if (k == K::Enter) app.replace(koppelnAnsicht());
        else if (k == K::Esc || k == K::Left) app.pop();
    }
};

// ------------------------------------------------------------------ Mikrofon-Test (1.3.3)
// Nimmt auf, ohne zu speichern oder zu senden, und zeigt live: kommen ueberhaupt Puffer an (je 256 ms), wie laut ist es.
// Enter schaltet die Verstaerkung im Codec an/aus (startet den Test neu) – so laesst sich am Geraet klaeren, was geht.
class MikroTestView : public View {
public:
    bool animated() const override { return true; }
    uint32_t animMs() const override { return 150; }
    bool wach() const override { return true; }
    void tick(App& app, uint32_t now) override {
        if (!gestartet_) {
            gestartet_ = true;
            seit_ = now;
            spitze_ = 0;
            ok_ = app.platform.mikroTestStart();
        }
        stand_ = app.platform.mikroTestStand();
        spitze_ = std::max(spitze_, stand_.pegel);
    }
    void draw(Gfx& g, App& app, uint32_t now) override {
        app.header(g, "Mikrofon-Test", now);
        const int sek = std::max<int>(1, static_cast<int>((now - seit_) / 1000));
        g.text(FONT_SMALL, 10, 42, std::string("Verst\xC3\xA4rkung: ") + (app.dorf.mikroRegister ? "im Codec (Register)" : "Software (wie 1.2)"), col::GREY);
        if (!ok_ && !stand_.laeuft) {
            g.text(FONT_BODY, 10, 66, "Startet nicht", col::RED);
            const auto z = wrapText(FONT_SMALL, stand_.grund.empty() ? app.platform.aufnahmeGrund() : stand_.grund, 222, 2);
            for (size_t i = 0; i < z.size(); ++i) g.text(FONT_SMALL, 10, 82 + static_cast<int>(i) * 13, z[i], col::TEXT2);
        } else {
            // Soll: 16 000 Werte/s, 4096 je Puffer = 3,9 Puffer/s. Deutlich weniger = Takt stimmt nicht (Ton kommt zu langsam)
            const uint32_t ms = std::max<uint32_t>(1, now - seit_);
            const int zehntel = static_cast<int>(stand_.puffer * 10000u / ms);
            const std::string puffer = std::to_string(stand_.puffer) + " Puffer in " + std::to_string(sek) + " s (" + std::to_string(zehntel / 10) + "," +
                                       std::to_string(zehntel % 10) + "/s, soll 3,9)";
            g.text(FONT_BODY, 10, 64, puffer, stand_.puffer == 0 && sek >= 2 ? col::RED : col::WHITE);
            g.rrect(10, 72, 220, 8, 4, col::LINE);
            if (stand_.pegel > 0) g.rrect(10, 72, std::max(6, 220 * stand_.pegel / 100), 8, 4, stand_.pegel > 90 ? col::RED : col::GREEN);
            g.text(FONT_SMALL, 10, 96, "Pegel " + std::to_string(stand_.pegel) + " % \xC2\xB7 Spitze " + std::to_string(spitze_) + " %", col::TEXT2);
            const char* deutung = stand_.puffer == 0 && sek >= 2   ? "Kein Ton vom Mikrofon."
                                  : sek >= 3 && zehntel < 30         ? "Ton kommt zu langsam (Takt) \xE2\x80\x93 bitte Zahl melden."
                                  : spitze_ < 25                     ? "Ton kommt an, aber leise \xE2\x80\x93 lauter/n\xC3\xA4her sprechen."
                                                                     : "Ton kommt an \xE2\x9C\x93";
            g.text(FONT_SMALL, 10, 110, deutung, stand_.puffer == 0 && sek >= 2 ? col::RED : col::AMBER);
        }
        app.footer(g, "Enter: Codec-Verst\xC3\xA4rkung an/aus \xC2\xB7 Esc zur\xC3\xBC" "ck", col::AMBER);
    }
    void key(const Input& in, App& app, uint32_t now) override {
        if (in.k == K::Esc || (in.k == K::Char && in.ch == "`")) {
            app.platform.mikroTestStopp();
            app.pop();
            return;
        }
        if (in.k == K::Enter) {
            app.platform.mikroTestStopp();
            app.dorf.mikroRegisterSetzen(!app.dorf.mikroRegister);
            app.toast(app.dorf.mikroRegister ? "Codec-Verst\xC3\xA4rkung an" : "Codec-Verst\xC3\xA4rkung aus", now);
            gestartet_ = false;      // neu starten mit der anderen Einstellung
        }
    }

private:
    bool gestartet_ = false, ok_ = false;
    uint32_t seit_ = 0;
    int spitze_ = 0;
    Platform::MikroStand stand_;
};

// ------------------------------------------------------------------ Einstellungen
class EinstellungenView : public ListView {
public:
    std::string title(App&) override { return "Einstellungen"; }
    void build(App& app, uint32_t) override {
        rows.clear();
        Dorf& d = app.dorf;
        auto add = [&](int action, const std::string& text, const std::string& right, Color c = col::GREY) {
            Row r;
            r.text = text;
            r.right = right;
            r.rightColor = c;
            r.action = action;
            rows.push_back(r);
        };
        const WlanZustand z = d.wlanZustand();
        add(1, "WLAN-Netze", z == WlanZustand::Verbunden ? d.wlanName() : z == WlanZustand::Verbindet ? "verbindet \xE2\x80\xA6" : "nicht verbunden",
            z == WlanZustand::Verbunden ? col::GREEN : col::AMBER);
        add(2, d.gekoppelt() ? "Neu koppeln" : "Koppeln", d.gekoppelt() ? (d.gesperrt() ? "gesperrt" : d.adresse) : "noch nicht",
            d.gekoppelt() && !d.gesperrt() ? col::GREY : col::AMBER);
        if (d.gekoppelt()) add(3, "Ger\xC3\xA4t entkoppeln", "");
        const size_t n = d.wartend().size();
        add(4, "Warteschlange", n == 0 ? "leer" : std::to_string(n) + (n == 1 ? " wartet" : " warten"), n ? col::AMBER : col::GREY);
        Row l;
        l.style = Row::Value;
        l.text = "Lautst\xC3\xA4rke";
        l.right = d.lautstaerke == 1 ? "leise" : d.lautstaerke == 3 ? "laut" : "mittel";
        l.action = 5;
        rows.push_back(l);
        Row m;
        m.style = Row::Value;
        m.text = "Mikrofon";
        m.right = d.mikro == 1 ? "leise" : d.mikro == 3 ? "laut" : "normal";
        m.action = 7;
        rows.push_back(m);
        add(8, "Mikrofon-Test", d.mikroRegister ? "Codec" : "Software");
        add(6, "Zum Startmen\xC3\xBC", "Neustart");
        Row h;
        h.style = Row::Header;
        h.text = std::string("Firmware ") + FIRMWARE_VERSION + (d.start.version.empty() ? "" : std::string(DOT) + "Dorf " + d.start.version);
        rows.push_back(h);
        const std::string sprache = app.platform.setting("sprachlog");
        if (!sprache.empty()) {      // 1.3.2: letzte Spracheingabe – hilft, wenn „nichts ankommt“
            Row sp;
            sp.style = Row::Header;
            sp.text = "Letzte Sprache: " + sprache;
            rows.push_back(sp);
        }
        Row h2;
        h2.style = Row::Header;
        const uint32_t frei = app.platform.freeHeap();
        h2.text = "Speicher: " + app.platform.storageName() + (frei ? std::string(DOT) + std::to_string(frei / 1024) + " KB RAM frei" : "");
        rows.push_back(h2);
    }
    void activate(App& app, const Row& r, uint32_t now) override {
        switch (r.action) {
            case 1: app.push(wlanAnsicht()); break;
            case 2: app.push(koppelnAnsicht()); break;
            case 3:
                app.push(neu(new ConfirmView("Ger\xC3\xA4t entkoppeln?", "Der Schl\xC3\xBCssel wird hier gel\xC3\xB6scht. In der App unter Ger\xC3\xA4te sperren.",
                    [](App& a, uint32_t t) {
                        a.dorf.entkoppeln();
                        a.toast("Entkoppelt", t);
                    })));
                break;
            case 4:
                if (app.dorf.wartend().empty()) app.toast("Nichts wartet", now);
                else if (!app.dorf.verbunden()) app.toast("Kein Netz \xE2\x80\x93 wird sp\xC3\xA4ter gesendet", now);
                else { app.dorf.schlangeJetzt(now); app.toast("Wird jetzt gesendet \xE2\x80\xA6", now); }
                break;
            case 5:
                app.dorf.lautstaerkeSetzen(app.dorf.lautstaerke % 3 + 1);
                app.platform.play(Sound::Test, app.dorf.lautstaerke);
                break;
            case 6: zumStartmenue(app); break;
            case 7: app.dorf.mikroSetzen(app.dorf.mikro % 3 + 1); break;
            case 8: app.push(neu(new MikroTestView())); break;
            default: break;
        }
    }
    bool other(App& app, const Input& in, const Row* r, uint32_t) override {
        const K k = nav(in);
        if (r && r->action == 5 && (k == K::Left || k == K::Right)) {
            app.dorf.lautstaerkeSetzen(app.dorf.lautstaerke + (k == K::Right ? 1 : -1));
            app.platform.play(Sound::Test, app.dorf.lautstaerke);
            return true;
        }
        if (r && r->action == 7 && (k == K::Left || k == K::Right)) {      // Verstaerkung fuer die Spracheingabe
            app.dorf.mikroSetzen(app.dorf.mikro + (k == K::Right ? 1 : -1));
            return true;
        }
        return false;
    }
    static void zumStartmenue(App& app) {
        app.push(neu(new ConfirmView("Zum Startmen\xC3\xBC?", "Der Cardputer startet dazu kurz neu.",
                                     [](App& a, uint32_t) { a.platform.restart(); })));
    }
};

// ------------------------------------------------------------------ Startseite
class DorfStartView : public ListView {
public:
    std::string title(App&) override { return "Agentendorf"; }
    bool animated() const override { return laeuft_; }
    std::string headerRight(App& app, uint32_t) override { return app.dorf.beschaeftigt() && !app.dorf.start.bekannt ? LAEDT : ""; }
    std::string hint(App& app, uint32_t) override {
        Dorf& d = app.dorf;
        const size_t n = d.wartend().size();
        const std::string warten = n ? std::string(DOT) + std::to_string(n) + (n == 1 ? " wartet" : " warten") : "";
        const WlanZustand z = d.wlanZustand();
        if (z != WlanZustand::Verbunden)
            return (z == WlanZustand::Verbindet || d.wlanAutomatik() || d.sucht() ? "WLAN: suche bekannte Netze \xE2\x80\xA6" : d.start.bekannt ? "offline, Stand " + d.start.stand : "offline \xE2\x80\x93 kein WLAN") + warten;
        if (d.gekoppelt() && d.start.offline) return "Dorf nicht erreichbar, Stand " + d.start.stand + warten;
        if (n) return std::to_string(n) + (n == 1 ? " \xC3\x84nderung wartet" : " \xC3\x84nderungen warten") + " auf Versand";
        // Normalfall: zeigen, mit welchem Netz er verbunden ist
        return "WLAN " + Gfx::fit(FONT_SMALL, d.wlanName(), 110) + DOT + "Esc Startmen\xC3\xBC";
    }
    Color hintColor(App& app) override {
        Dorf& d = app.dorf;
        return (!d.verbunden() || (d.gekoppelt() && d.start.offline) || !d.wartend().empty()) ? col::AMBER : col::GREY;
    }
    void tick(App& app, uint32_t now) override {
        Dorf& d = app.dorf;
        if (!d.gekoppelt() || d.gesperrt() || !d.verbunden()) { gefragt_ = false; return; }
        const uint32_t pause = d.start.bekannt && !d.start.offline ? 60000u : 8000u;
        if (!gefragt_ || now - geholt_ > pause || d.schreibStand() != schreibStand_) {
            gefragt_ = true;
            geholt_ = now;
            schreibStand_ = d.schreibStand();
            d.startHolen(now);
        }
    }
    void build(App& app, uint32_t now) override {
        rows.clear();
        Dorf& d = app.dorf;
        const StartInfo& s = d.start;
        auto add = [&](int action, const std::string& text, const std::string& right, Color c = col::GREY) {
            Row r;
            r.text = text;
            r.right = right;
            r.rightColor = c;
            r.action = action;
            rows.push_back(r);
        };
        if (!d.gekoppelt() || d.gesperrt()) {
            Row k;
            k.style = Row::Plus;
            k.text = d.gesperrt() ? "Neu koppeln" : "Mit dem Dorf koppeln";
            k.action = 20;
            rows.push_back(k);
        }
        const bool da = s.bekannt;
        add(1, "Heute", da && s.todosHeute > 0 ? std::to_string(s.todosHeute) + (s.todosHeute == 1 ? " To-do" : " To-dos") : "");
        add(2, "To-dos", da ? std::to_string(s.todosOffen) + " offen" : "");
        add(3, "B\xC3\xBCrgermeister", da && s.bmLaeuft ? "denkt nach \xE2\x80\xA6" : "", col::AMBER);
        // Kirchturm: am liebsten aus dem Waechter (zaehlt lokal), sonst aus der Uebersicht
        std::string uhr;
        laeuft_ = false;
        if (d.kirchturm.bekannt) {
            if (!d.kirchturm.laufend.empty()) {
                const Uhr& u = d.kirchturm.laufend.front();
                const std::string name = u.art == "pomodoro" ? phasenName(u.phase) : u.art == "timer" ? "Timer" : u.art == "wecker" ? "Wecker" : "Stoppuhr";
                if (u.art == "stoppuhr") uhr = name;
                else if (u.art == "wecker") {
                    const int64_t lokal = u.endeMs / 1000 + app.clock.offset() * 60;
                    const int min = static_cast<int>(((lokal % 86400) + 86400) % 86400 / 60);
                    uhr = name + " " + two(min / 60) + ":" + two(min % 60);
                } else {
                    uhr = name + " " + mmss(d.restMs(u, now)) + (u.pausiert ? " \xE2\x80\x96" : "");
                    laeuft_ = !u.pausiert;
                }
            }
        } else if (da && !s.fokusArt.empty()) {
            const int64_t rest = static_cast<int64_t>(s.fokusRestSek) * 1000 - static_cast<int64_t>(static_cast<uint32_t>(now - s.geholt));
            uhr = (s.fokusArt == "pomodoro" ? phasenName(s.fokusPhase) : s.fokusArt == "timer" ? "Timer" : s.fokusArt == "wecker" ? "Wecker" : "Uhr") + std::string(" ") + mmss(rest);
            laeuft_ = true;
        }
        add(4, "Kirchturm", uhr, col::ACCENT);
        add(5, "Kalender", da && !s.terminTitel.empty() ? (s.terminZeit.empty() ? "" : s.terminZeit + " ") + s.terminTitel : "");
        add(6, "Freigaben", da && s.freigaben > 0 ? std::to_string(s.freigaben) + (s.freigaben == 1 ? " wartet" : " warten") : "", col::AMBER);
        add(7, "Fristen", "");
        add(8, "Gewohnheiten", da && s.gewohnheitenOffen > 0 ? std::to_string(s.gewohnheitenOffen) + " offen" : "");
        add(9, "Notiz", "");
        add(12, "Sprechen", std::string(ARROW_R) + " B\xC3\xBCrgermeister", col::ACCENT);
        add(10, "Post", "");
        const WlanZustand z = d.wlanZustand();
        add(11, "Einstellungen", z == WlanZustand::Verbunden ? d.wlanName() : "kein WLAN", z == WlanZustand::Verbunden ? col::GREY : col::AMBER);
    }
    void activate(App& app, const Row& r, uint32_t now) override {
        Dorf& d = app.dorf;
        if (r.action == 11) { app.push(neu(new EinstellungenView())); return; }
        if (r.action == 20) { app.push(d.netze.empty() ? wlanAnsicht() : koppelnAnsicht()); return; }
        if (!d.gekoppelt()) { app.toast("Erst koppeln (oben in der Liste)", now); return; }
        if (d.gesperrt()) { app.toast("Erst neu koppeln", now); return; }
        switch (r.action) {
            case 1: app.push(neu(new HeuteView())); break;
            case 2: app.push(neu(new TodosView())); break;
            case 3: app.push(neu(new BmListeView())); break;
            case 4: app.push(neu(new KirchturmView())); break;
            case 5: app.push(neu(new KalenderView())); break;
            case 6: app.push(neu(new FreigabenView())); break;
            case 7: app.push(neu(new FristenView())); break;
            case 8: app.push(neu(new GewohnheitenView())); break;
            case 9:
                app.push(neu(new TextInputView("Notiz", "Schnelle Notiz (landet in der Tagesnotiz)", "", "Enter speichert. Ohne Netz wird sie nachgeschickt.",
                    [](App& a, const std::string& text, uint32_t t) {
                        einreihen(a, "/notiz", JsonBau().text("text", text).fertig(), text, "Notiz gespeichert", t);
                    }, false, 300)));
                break;
            case 10: app.push(neu(new PostView())); break;
            case 12: {      // gleich aufnehmen; der erkannte Text geht sofort an den Buergermeister (1.3.2, Leifs Wunsch)
                TextInputView* v = new TextInputView("Neues Gespr\xC3\xA4" "ch", "Was soll der B\xC3\xBCrgermeister tun?", "",
                    "Sprechen, dann Tab \xE2\x80\x93 geht gleich raus.",
                    [](App& a, const std::string& text, uint32_t) { a.push(neu(new BmChatView("", text))); }, false, 400);
                v->gleichSprechen();
                v->direktSenden();
                app.push(neu(v));
                break;
            }
            default: break;
        }
    }
    bool other(App& app, const Input& in, const Row*, uint32_t) override {
        const K k = nav(in);
        if (k == K::Esc || k == K::Left) {
            if (k == K::Esc) EinstellungenView::zumStartmenue(app);
            return true;      // Pfeil links tut hier nichts (kein versehentlicher Neustart)
        }
        return false;
    }

private:
    bool gefragt_ = false, laeuft_ = false;
    uint32_t geholt_ = 0, schreibStand_ = 0;
};

}  // namespace

std::unique_ptr<View> dorfStartAnsicht() { return neu(new DorfStartView()); }
std::unique_ptr<View> wlanAnsicht() { return neu(new WlanView()); }
std::unique_ptr<View> koppelnAnsicht() { return neu(new KoppelnView()); }
std::unique_ptr<View> neuKoppelnAnsicht() { return neu(new NeuKoppelnView()); }

}  // namespace ui
}  // namespace haloos
