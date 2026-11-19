#include "dorf.h"

#include <algorithm>
#include <cstdio>

#include "app.h"

namespace haloos {

namespace {

const char* const DATEI_SCHLANGE = "dorf-warten.txt";
constexpr uint32_t ZEITLIMIT_MS = 30000;      // Sicherheitsnetz, falls die Netz-Schicht nie antwortet
constexpr uint32_t WLAN_VERSUCH_MS = 20000;

bool faellig(uint32_t now, uint32_t t) { return static_cast<int32_t>(now - t) >= 0; }

uint32_t pruefsumme(const std::string& s) {   // FNV-1a
    uint32_t h = 2166136261u;
    for (char c : s) h = (h ^ static_cast<uint8_t>(c)) * 16777619u;
    return h;
}

template <typename T>
bool enthaelt(const std::vector<T>& v, const T& x) { return std::find(v.begin(), v.end(), x) != v.end(); }

std::string fehlerText(const Antwort& r, const Json& j, bool verbunden) {
    if (j.gueltig()) {
        const std::string t = j["fehler"].text();
        if (!t.empty()) return t;
    }
    if (r.status == 0) return verbunden ? "Dorf nicht erreichbar" : "Kein Netz";
    if (r.status == 401) return "Nicht angemeldet";
    if (r.status == 429) return "Zu viele Versuche \xE2\x80\x93 in " + std::to_string(std::max(1, r.wartenSek)) + " s nochmal";
    return "Fehler " + std::to_string(r.status);
}

}  // namespace

Dorf::Dorf(Platform& p, Net& n, Clock& c) : platform_(p), net_(n), clock_(c) {}

// ------------------------------------------------------------------ Einstellungen
void Dorf::laden() {
    adresse = platform_.setting("adresse");
    token_ = platform_.setting("token");
    netze.clear();
    const std::string w = platform_.setting("wlan");
    size_t st = 0;
    while (st < w.size()) {
        size_t e = w.find('\n', st);
        if (e == std::string::npos) e = w.size();
        const auto f = splitFields(w.substr(st, e - st));
        if (f.size() >= 2 && !f[0].empty() && netze.size() < MAX_NETZE) netze.push_back({f[0], f[1]});
        st = e + 1;
    }
    const std::string laut = platform_.setting("laut");
    if (laut == "1" || laut == "2" || laut == "3") lautstaerke = laut[0] - '0';
    wartend_.clear();
    std::string text;
    if (platform_.readFile(DATEI_SCHLANGE, text)) {
        st = 0;
        while (st < text.size()) {
            size_t e = text.find('\n', st);
            if (e == std::string::npos) e = text.size();
            const auto f = splitFields(text.substr(st, e - st));
            if (f.size() >= 4 && f[0].size() >= 8 && wartend_.size() < MAX_WARTEND) wartend_.push_back({f[0], f[1], f[2], f[3]});
            st = e + 1;
        }
    }
}

void Dorf::netzeSpeichern() {
    std::string w;
    for (const auto& e : netze) w += joinFields({e.ssid, e.passwort}) + "\n";
    platform_.setSetting("wlan", w);
}

void Dorf::schlangeSpeichern() {
    std::string t;
    for (const auto& e : wartend_) t += joinFields({e.vorgang, e.pfad, e.koerper, e.text}) + "\n";
    platform_.writeFile(DATEI_SCHLANGE, t);
}

void Dorf::lautstaerkeSetzen(int v) {
    lautstaerke = std::max(1, std::min(3, v));
    platform_.setSetting("laut", std::to_string(lautstaerke));
}

const WlanEintrag* Dorf::netz(const std::string& ssid) const {
    for (const auto& e : netze)
        if (e.ssid == ssid) return &e;
    return nullptr;
}

void Dorf::netzVergessen(const std::string& ssid) {
    netze.erase(std::remove_if(netze.begin(), netze.end(), [&](const WlanEintrag& e) { return e.ssid == ssid; }), netze.end());
    netzeSpeichern();
    if (net_.wlanName() == ssid) net_.wlanTrennen();
}

std::string Dorf::adresseBereinigen(const std::string& eingabe) const {
    std::string s;
    for (char c : eingabe)
        if (c != ' ') s += static_cast<char>(c >= 'A' && c <= 'Z' ? c - 'A' + 'a' : c);
    std::string vorsatz;
    if (s.rfind("https://", 0) == 0) s.erase(0, 8);
    else if (s.rfind("http://", 0) == 0) {
        if (net_.nurHttps()) return "";      // auf dem Geraet nie unverschluesselt
        vorsatz = "http://";
        s.erase(0, 7);
    }
    const size_t schraeg = s.find('/');
    if (schraeg != std::string::npos) s.erase(schraeg);
    if (s.size() < 4 || s.find('.') == std::string::npos) return "";
    for (char c : s)
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '-' || c == ':')) return "";
    return vorsatz + s;
}

std::string Dorf::basis() const { return adresse.rfind("http://", 0) == 0 ? adresse : "https://" + adresse; }

std::string Dorf::vorgangNeu() {
    char b[20];
    std::snprintf(b, sizeof b, "%08lx%08lx", static_cast<unsigned long>(platform_.random()),
                  static_cast<unsigned long>(platform_.random()));
    return b;
}

std::string Dorf::dateiName(const std::string& pfad) const {
    std::string n = "c";
    bool strich = false;
    std::string p = pfad;
    const size_t a = p.find("ansicht=");
    if (a != std::string::npos) p.erase(a, 8);
    for (char c : p) {
        const bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
        if (ok) { if (strich) n += '-'; n += c; strich = false; }
        else strich = true;
    }
    return n.substr(0, 24) + ".json";
}

std::string Dorf::standText(int64_t utc, int offsetMin, uint32_t now) const {
    const int64_t local = utc + offsetMin * 60;
    int64_t tag = local / 86400;
    if (local < 0 && local % 86400 != 0) --tag;
    const int min = static_cast<int>((local - tag * 86400) / 60);
    char b[32];
    if (clock_.any() && clock_.today(now) != tag) {
        int y, m, d;
        civilFromDays(tag, y, m, d);
        std::snprintf(b, sizeof b, "%d.%d. %02d:%02d", d, m, min / 60, min % 60);
    } else {
        std::snprintf(b, sizeof b, "%02d:%02d", min / 60, min % 60);
    }
    return b;
}

// ------------------------------------------------------------------ Start, WLAN
void Dorf::starten(uint32_t now) {
    if (aktiv_) return;
    aktiv_ = true;
    platform_.startDorf();
    naechsteSuche_ = now;
    kirchturmFaellig_ = now + 1500;
    schlangeFaellig_ = now + 2000;
}

void Dorf::wlanSuchen(uint32_t now) {
    // Waehrend ein Verbindungsaufbau laeuft, kann der Funkchip nicht suchen - dann bleibt die alte Liste
    if (sucht_ || verbindet_ || versuch_ == Versuch::Laeuft) return;
    sucht_ = true;
    naechsteSuche_ = now + 20000;
    net_.wlanSuchen();
}

void Dorf::wlanVersuchen(const std::string& ssid, const std::string& passwort, uint32_t now) {
    versuch_ = Versuch::Laeuft;
    versuchSsid_ = ssid;
    versuchPasswort_ = passwort;
    versuchSeit_ = now;
    verbindet_ = false;
    net_.wlanVerbinden(ssid, passwort);
}

void Dorf::wlanTick(uint32_t now) {
    if (sucht_) {
        std::vector<WlanNetz> n;
        if (net_.wlanGefunden(n)) {
            sucht_ = false;
            std::stable_sort(n.begin(), n.end(), [](const WlanNetz& a, const WlanNetz& b) { return a.rssi > b.rssi; });
            funde.clear();
            for (const auto& f : n) {      // dasselbe Netz von mehreren Sendern nur einmal (das staerkste)
                bool da = f.ssid.empty();
                for (const auto& g : funde) da = da || g.ssid == f.ssid;
                if (!da && funde.size() < 20) funde.push_back(f);
            }
            if (autoSuche_) {
                autoSuche_ = false;
                if (versuch_ != Versuch::Laeuft && net_.wlanZustand() != WlanZustand::Verbunden) {
                    for (const auto& e : netze) {      // das erste bekannte Netz, das gerade da ist
                        bool da = false;
                        for (const auto& f : funde) da = da || f.ssid == e.ssid;
                        if (!da) continue;
                        net_.wlanVerbinden(e.ssid, e.passwort);
                        verbindet_ = true;
                        verbindetSeit_ = now;
                        break;
                    }
                }
            }
        }
    }
    const WlanZustand z = net_.wlanZustand();
    if (versuch_ == Versuch::Laeuft) {
        if (z == WlanZustand::Verbunden && net_.wlanName() == versuchSsid_) {
            versuch_ = Versuch::Ok;
            bool da = false;
            for (auto& e : netze)
                if (e.ssid == versuchSsid_) { e.passwort = versuchPasswort_; da = true; }
            if (!da) {
                if (netze.size() >= MAX_NETZE) netze.pop_back();
                netze.push_back({versuchSsid_, versuchPasswort_});
            }
            netzeSpeichern();
            versuchPasswort_.clear();
            kirchturmFaellig_ = now + 500;
            schlangeFaellig_ = now + 500;
        } else if (z == WlanZustand::Fehler || now - versuchSeit_ > WLAN_VERSUCH_MS) {
            versuch_ = Versuch::Fehler;
            versuchPasswort_.clear();
            net_.wlanTrennen();
            naechsteSuche_ = now + 3000;
        }
        return;
    }
    if (z == WlanZustand::Verbunden) {
        if (verbindet_) {              // gerade (wieder) verbunden: gleich nachholen
            kirchturmFaellig_ = now + 500;
            schlangeFaellig_ = now + 500;
            schlangePause_ = 5000;
        }
        verbindet_ = false;
        warVerbunden_ = true;
        return;
    }
    if (warVerbunden_) {               // Verbindung verloren: bald nach bekannten Netzen sehen
        warVerbunden_ = false;
        naechsteSuche_ = now + 1500;
    }
    if (verbindet_) {
        if (z == WlanZustand::Fehler || now - verbindetSeit_ > WLAN_VERSUCH_MS) {
            verbindet_ = false;
            naechsteSuche_ = now + 5000;
        }
        return;
    }
    if (!netze.empty() && !sucht_ && faellig(now, naechsteSuche_)) {
        autoSuche_ = true;
        wlanSuchen(now);
    }
}

// ------------------------------------------------------------------ Koppeln
void Dorf::koppeln(const std::string& adr, const std::string& code, uint32_t besitzer, int marke) {
    Offen o;
    o.art = Art::Koppeln;
    o.besitzer = besitzer;
    o.marke = marke;
    o.a.post = true;
    o.a.basis = adr.rfind("http://", 0) == 0 ? adr : "https://" + adr;
    o.a.pfad = "/api/geraet/koppeln";
    o.a.koerper = JsonBau().text("code", code).text("name", "Cardputer").fertig();
    einstellen(o);
}

void Dorf::koppelnFertig(const std::string& adr, const std::string& token, uint32_t now) {
    adresse = adr;
    token_ = token;
    gesperrt_ = false;
    platform_.setSetting("adresse", adresse);
    platform_.setSetting("token", token_);
    kirchturmFaellig_ = now + 300;
    schlangeFaellig_ = now + 300;
    schlangePause_ = 5000;
}

void Dorf::entkoppeln() {
    token_.clear();
    gesperrt_ = false;
    platform_.setSetting("token", "");
    start = StartInfo();
    kirchturm = KirchturmStand();
    alarm_.clear();
    quittiert_.clear();
}

// ------------------------------------------------------------------ Anfragen
void Dorf::einstellen(Offen o) {
    o.a.id = naechsteId_++;
    const bool hintergrund = o.art == Art::Schlange || o.art == Art::Kirchturm || o.art == Art::Start;
    if (hintergrund) { offen_.push_back(std::move(o)); return; }
    // Was der Mensch gerade angestossen hat, geht vor dem Hintergrund (Reihenfolge untereinander bleibt)
    auto it = offen_.begin();
    while (it != offen_.end() && it->art != Art::Schlange && it->art != Art::Kirchturm && it->art != Art::Start) ++it;
    offen_.insert(it, std::move(o));
}

void Dorf::holen(const std::string& pfad, uint32_t besitzer, int marke, bool merken) {
    for (const auto& x : offen_)      // dieselbe Frage nicht doppelt anstellen
        if (!x.a.post && x.besitzer == besitzer && x.marke == marke && x.art == Art::Ansicht) return;
    Offen o;
    o.besitzer = besitzer;
    o.marke = marke;
    o.merken = merken;
    o.a.basis = basis();
    o.a.pfad = "/api/geraet" + pfad;
    o.a.token = token_;
    einstellen(o);
}

void Dorf::senden(const std::string& pfad, const std::string& koerper, uint32_t besitzer, int marke) {
    Offen o;
    o.art = besitzer == 0 ? Art::Still : Art::Ansicht;
    o.besitzer = besitzer;
    o.marke = marke;
    o.a.post = true;
    o.a.basis = basis();
    o.a.pfad = "/api/geraet" + pfad;
    o.a.token = token_;
    o.a.koerper = koerper;
    o.a.vorgang = vorgangNeu();
    einstellen(o);
}

bool Dorf::einreihen(const std::string& pfad, const std::string& koerper, const std::string& text, uint32_t now) {
    if (wartend_.size() >= MAX_WARTEND) return false;
    wartend_.push_back({vorgangNeu(), pfad, koerper, text});
    schlangeSpeichern();
    if (wartend_.size() == 1) {
        schlangeFaellig_ = now;
        schlangePause_ = 5000;
    }
    return true;
}

void Dorf::startHolen(uint32_t now) {
    (void)now;
    for (const auto& x : offen_)
        if (x.art == Art::Start) return;
    if (laeuft_ && aktuell_.art == Art::Start) return;
    Offen o;
    o.art = Art::Start;
    o.a.basis = basis();
    o.a.pfad = "/api/geraet/start";
    o.a.token = token_;
    einstellen(o);
}

void Dorf::kirchturmAktion(const std::string& koerper, uint32_t besitzer, int marke) {
    senden("/kirchturm", koerper, besitzer, marke);
}

void Dorf::abschicken(App& app, uint32_t now) {
    if (laeuft_) {
        Antwort r;
        if (net_.poll(r)) {
            if (r.id != aktuell_.a.id) return;      // verspaetete Antwort einer aufgegebenen Anfrage
            laeuft_ = false;
            const Offen o = std::move(aktuell_);
            antwort(app, o, r, now);
        } else if (now - gestartet_ > ZEITLIMIT_MS) {
            laeuft_ = false;
            const Offen o = std::move(aktuell_);
            r.id = o.a.id;
            r.status = 0;
            antwort(app, o, r, now);
        }
        return;
    }
    if (offen_.empty()) return;
    Offen o = std::move(offen_.front());
    offen_.pop_front();
    if (o.art == Art::Ansicht && !o.a.post && !app.lebt(o.besitzer)) return;   // Ansicht schon zu
    Antwort r;
    r.id = o.a.id;
    if (o.art != Art::Koppeln && (o.a.token.empty() || gesperrt_)) {
        Ergebnis e;          // gar nicht erst fragen
        e.marke = o.marke;
        e.status = 401;
        e.fehler = gesperrt_ ? "Bitte neu koppeln" : "Noch nicht gekoppelt";
        if (o.art == Art::Ansicht) app.zustellen(o.besitzer, e, now);
        if (o.art == Art::Schlange) schlangeLaeuft_ = false;
        if (o.art == Art::Kirchturm) kirchturmLaeuft_ = false;
        return;
    }
    if (net_.wlanZustand() != WlanZustand::Verbunden) {
        r.status = 0;
        antwort(app, o, r, now);
        return;
    }
    if (net_.start(o.a)) {
        aktuell_ = std::move(o);
        laeuft_ = true;
        gestartet_ = now;
    } else {
        offen_.push_front(std::move(o));   // Netz-Schicht noch mit einer alten Anfrage beschaeftigt
        Antwort alt;
        net_.poll(alt);
    }
}

void Dorf::antwort(App& app, const Offen& o, const Antwort& r, uint32_t now) {
    const Json j = r.koerper.empty() ? Json() : Json::lesen(r.koerper);
    const bool ok = r.status >= 200 && r.status < 300 && j.gueltig();
    const bool verb = net_.wlanZustand() == WlanZustand::Verbunden;
    if (o.art == Art::Schlange) schlangeLaeuft_ = false;
    if (o.art == Art::Kirchturm) kirchturmLaeuft_ = false;
    if (ok && o.art != Art::Schlange && !wartend_.empty() && schlangePause_ > 5000) {
        schlangeFaellig_ = now;      // das Dorf antwortet wieder: Wartendes gleich nachschicken
        schlangePause_ = 5000;
    }

    if (r.status == 401 && o.art != Art::Koppeln) {      // Schluessel ungueltig oder in der App gesperrt
        if (!gesperrt_) {
            gesperrt_ = true;
            alarm_.clear();
            app.neuKoppeln(now);
        }
        return;
    }

    switch (o.art) {
        case Art::Ansicht:
        case Art::Koppeln: {
            Ergebnis e;
            e.marke = o.marke;
            e.status = r.status;
            std::string alt;       // muss leben, solange e.j benutzt wird
            if (ok) {
                e.ok = e.daten = true;
                e.j = j;
                if (o.merken && !o.a.post) {
                    const std::string name = dateiName(o.a.pfad.substr(11));
                    const uint32_t h = pruefsumme(r.koerper);
                    auto it = gemerkt_.find(name);
                    if (it == gemerkt_.end() || it->second != h) {
                        gemerkt_[name] = h;
                        const int64_t utc = clock_.any() ? clock_.utc(now) : 0;
                        platform_.writeFile(name, std::to_string(utc) + " " + std::to_string(clock_.offset()) + "\n" + r.koerper);
                    }
                }
            } else {
                e.fehler = fehlerText(r, j, verb);
                if (o.merken && !o.a.post && (r.status == 0 || r.status >= 500)) {
                    std::string datei;
                    if (platform_.readFile(dateiName(o.a.pfad.substr(11)), datei)) {
                        const size_t nl = datei.find('\n');
                        if (nl != std::string::npos) {
                            long long utc = 0;
                            int off = 60;
                            std::sscanf(datei.c_str(), "%lld %d", &utc, &off);
                            alt = datei.substr(nl + 1);
                            datei.clear();
                            const Json aj = Json::lesen(alt);
                            if (aj.gueltig()) {
                                e.daten = e.offline = true;
                                e.j = aj;
                                e.stand = utc > 0 ? standText(utc, off, now) : "unbekannt";
                            }
                        }
                    }
                }
            }
            app.zustellen(o.besitzer, e, now);
            break;
        }
        case Art::Schlange: {
            if (wartend_.empty() || wartend_.front().vorgang != o.a.vorgang) break;
            const bool abgelehnt = r.status >= 400 && r.status < 500 && r.status != 408 && r.status != 429;
            if (ok || (r.status >= 200 && r.status < 300) || abgelehnt) {
                if (abgelehnt) app.toast("Abgelehnt: " + fehlerText(r, j, verb), now);
                wartend_.pop_front();
                schlangeSpeichern();
                ++schreibStand_;
                schlangePause_ = 5000;
                schlangeFaellig_ = now;
                app.neuZeichnen();
            } else {
                schlangeFaellig_ = now + (r.status == 429 ? static_cast<uint32_t>(std::max(1, r.wartenSek)) * 1000u : schlangePause_);
                schlangePause_ = std::min<uint32_t>(60000, schlangePause_ * 2);
            }
            break;
        }
        case Art::Kirchturm:
            if (ok) kirchturmLesen(app, j, now);
            else kirchturm.offline = true;
            app.neuZeichnen();
            break;
        case Art::Start:
            if (ok) {
                StartInfo s;
                s.bekannt = true;
                s.geholt = now;
                const long long zeit = j["zeit"].zahl();
                const int off = static_cast<int>(j["offsetMin"].zahl(60));
                if (zeit > 1600000000LL) clock_.set(zeit, off, now);
                s.version = j["version"].text();
                s.todosOffen = static_cast<int>(j["todosOffen"].zahl());
                s.todosHeute = static_cast<int>(j["todosHeute"].zahl());
                s.freigaben = static_cast<int>(j["freigaben"].zahl());
                s.gewohnheitenOffen = static_cast<int>(j["gewohnheitenOffen"].zahl());
                s.terminZeit = j["termin"]["zeit"].text();
                s.terminTitel = j["termin"]["titel"].text();
                s.fokusArt = j["fokus"]["art"].text();
                s.fokusPhase = j["fokus"]["phase"].text();
                s.fokusRestSek = static_cast<int>(j["fokus"]["restSek"].zahl());
                s.bmLaeuft = j["buergermeister"]["laeuft"].wahr();
                s.stand = clock_.hhmm(now);
                start = s;
            } else if (start.bekannt) {
                start.offline = true;
            }
            app.neuZeichnen();
            break;
        case Art::Still:
            break;
    }
}

// ------------------------------------------------------------------ Kirchturm
int64_t Dorf::restMs(const Uhr& u, uint32_t now) const {
    if (u.pausiert) return u.restMs;
    const int64_t jetzt = kirchturm.jetztMs + static_cast<int64_t>(static_cast<uint32_t>(now - kirchturm.geholt));
    return std::max<int64_t>(0, u.endeMs - jetzt);
}

std::string Dorf::alarmText() const {
    if (alarm_.empty()) return "";
    std::string t = alarm_.front().second.empty() ? "Zeit abgelaufen" : alarm_.front().second;
    if (alarm_.size() > 1) t += " (+" + std::to_string(alarm_.size() - 1) + ")";
    return t;
}

void Dorf::alarmLeise(uint32_t now) {
    for (const auto& a : alarm_) {
        if (!enthaelt(quittiert_, a.first)) quittiert_.push_back(a.first);
        senden("/kirchturm", JsonBau().text("aktion", "leise").text("id", a.first).fertig(), 0, 0);
    }
    alarm_.clear();
    kirchturmFaellig_ = now + 1500;
}

void Dorf::kirchturmLesen(App& app, const Json& j, uint32_t now) {
    KirchturmStand k;
    k.bekannt = true;
    k.jetztMs = j["jetztMs"].zahl();
    k.geholt = now;
    for (Json e = j["laufend"].erstes(); e.gueltig() && k.laufend.size() < 8; e = e.naechstes()) {
        Uhr u;
        u.id = e["id"].text();
        u.art = e["art"].text();
        u.titel = e["titel"].text();
        u.phase = e["phase"].text();
        u.endeMs = e["endeMs"].zahl();
        u.restMs = e["restMs"].zahl();
        u.pausiert = e["pausiert"].wahr();
        u.runde = static_cast<int>(e["runde"].zahl());
        k.laufend.push_back(u);
    }
    const Json p = j["pomodoro"];
    k.fokus = static_cast<int>(p["fokus"].zahl(25));
    k.kurz = static_cast<int>(p["kurz"].zahl(5));
    k.lang = static_cast<int>(p["lang"].zahl(15));
    k.langNach = static_cast<int>(p["langNach"].zahl(4));

    // Klingeln: neue Eintraege laeuten, quittierte nicht noch einmal
    std::vector<std::string> ids;
    bool neu = false;
    for (Json e = j["klingelt"].erstes(); e.gueltig(); e = e.naechstes()) {
        const std::string id = e["id"].text();
        ids.push_back(id);
        if (enthaelt(quittiert_, id)) {      // Quittung kam beim Server nicht an: noch einmal schicken
            senden("/kirchturm", JsonBau().text("aktion", "leise").text("id", id).fertig(), 0, 0);
            continue;
        }
        bool da = false;
        for (const auto& a : alarm_) da = da || a.first == id;
        if (!da) {
            alarm_.emplace_back(id, e["titel"].text());
            neu = true;
        }
    }
    alarm_.erase(std::remove_if(alarm_.begin(), alarm_.end(),
                                [&](const std::pair<std::string, std::string>& a) { return !enthaelt(ids, a.first); }),
                 alarm_.end());
    quittiert_.erase(std::remove_if(quittiert_.begin(), quittiert_.end(),
                                    [&](const std::string& q) { return !enthaelt(ids, q); }),
                     quittiert_.end());
    if (neu) {
        alarmSeit_ = now;
        alarmTon_ = faellig(now, letzterTon_ + 2500) ? now : letzterTon_ + 2500;
        app.wake(now, 60000);
    } else if (kirchturm.bekannt && alarm_.empty()) {
        // Phasenwechsel eines Pomodoro ohne Klingeln: kurzer Ton und Hinweis
        for (const auto& u : k.laufend) {
            if (u.art != "pomodoro") continue;
            for (const auto& alt : kirchturm.laufend) {
                if (alt.id != u.id || alt.phase == u.phase) continue;
                const Sound s = u.phase == "fokus" ? Sound::FocusStart : u.phase == "lang" ? Sound::LongBreak : Sound::ShortBreak;
                if (faellig(now, letzterTon_ + 2500)) {
                    platform_.play(s, lautstaerke);
                    letzterTon_ = now;
                }
                app.toast(std::string(u.phase == "fokus" ? "Fokus" : u.phase == "lang" ? "Lange Pause" : "Kurze Pause") + " beginnt", now);
                app.wake(now, 15000);
            }
        }
    }
    abgelaufen_.erase(std::remove_if(abgelaufen_.begin(), abgelaufen_.end(), [&](const std::string& key) {
                          for (const auto& u : k.laufend)
                              if (key == u.id + "|" + std::to_string(u.endeMs)) return false;
                          return true;
                      }),
                      abgelaufen_.end());
    kirchturm = k;
}

void Dorf::kirchturmTick(App& app, uint32_t now) {
    if (!alarm_.empty() && faellig(now, alarmTon_) && now - alarmSeit_ < 120000u) {
        platform_.play(Sound::BreakEnd, lautstaerke);
        letzterTon_ = now;
        alarmTon_ = now + 4000;
        app.wake(now, 10000);
    }
    if (!kirchturm.bekannt) return;
    for (const auto& u : kirchturm.laufend) {
        if (u.pausiert || u.art == "stoppuhr" || u.endeMs <= 0 || restMs(u, now) > 0) continue;
        const std::string key = u.id + "|" + std::to_string(u.endeMs);
        if (enthaelt(abgelaufen_, key)) continue;
        abgelaufen_.push_back(key);
        app.wake(now, 15000);
        kirchturmFaellig_ = now + 700;       // gleich nachsehen, was der Server dazu sagt
        if (net_.wlanZustand() != WlanZustand::Verbunden) {   // ohne Netz wenigstens selbst melden
            platform_.play(Sound::BreakEnd, lautstaerke);
            letzterTon_ = now;
            app.toast((u.titel.empty() ? std::string("Zeit") : u.titel) + " abgelaufen", now);
        }
    }
}

// ------------------------------------------------------------------ Takt
void Dorf::tick(App& app, uint32_t now) {
    if (!aktiv_) return;
    wlanTick(now);
    kirchturmTick(app, now);
    abschicken(app, now);
    if (laeuft_ || !offen_.empty() || !gekoppelt() || gesperrt_) return;

    // Leerlauf: Warteschlange nachschicken, Kirchturm pruefen
    const bool verb = net_.wlanZustand() == WlanZustand::Verbunden;
    if (!wartend_.empty() && !schlangeLaeuft_ && verb && faellig(now, schlangeFaellig_)) {
        const Wartend& w = wartend_.front();
        Offen o;
        o.art = Art::Schlange;
        o.a.post = true;
        o.a.basis = basis();
        o.a.pfad = "/api/geraet" + w.pfad;
        o.a.token = token_;
        o.a.koerper = w.koerper;
        o.a.vorgang = w.vorgang;
        schlangeLaeuft_ = true;
        einstellen(o);
        return;
    }
    if (!kirchturmLaeuft_ && faellig(now, kirchturmFaellig_)) {
        const bool schnell = !faellig(now, schnellBis_);
        kirchturmFaellig_ = now + (schnell ? KIRCHTURM_SCHNELL_MS : KIRCHTURM_MS);
        if (!verb) {
            if (kirchturm.bekannt && !kirchturm.offline) { kirchturm.offline = true; app.neuZeichnen(); }
            return;
        }
        Offen o;
        o.art = Art::Kirchturm;
        o.a.basis = basis();
        o.a.pfad = "/api/geraet/kirchturm";
        o.a.token = token_;
        kirchturmLaeuft_ = true;
        einstellen(o);
    }
}

}  // namespace haloos
