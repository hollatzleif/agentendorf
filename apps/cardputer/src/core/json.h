// Kleiner JSON-Leser ohne eigenen Speicher: ein Json-Objekt ist nur ein Verweis in den Antworttext.
// Der Cardputer hat kein PSRAM - ein voller Baum (wie bei ArduinoJson) wuerde eine 20-KB-Antwort
// im Speicher mehr als verdoppeln. Hier wird beim Zugriff gelesen und nur das kopiert, was die
// Ansicht wirklich braucht. Laeuft unveraendert im PC-Test.
#pragma once
#include <cstdint>
#include <string>

namespace haloos {

class Json {
public:
    Json() = default;
    Json(const char* p, const char* end) : p_(p), end_(end) {}

    // Ganzen Text pruefen (vollstaendig, sauber geschachtelt) und Wurzel liefern; sonst ungueltig.
    static Json lesen(const std::string& text);

    bool gueltig() const { return p_ != nullptr; }
    bool istObjekt() const { return p_ && *p_ == '{'; }
    bool istListe() const { return p_ && *p_ == '['; }
    bool istText() const { return p_ && *p_ == '"'; }
    bool istNull() const { return !p_ || *p_ == 'n'; }

    Json operator[](const char* schluessel) const;    // Feld eines Objekts (ungueltig, wenn es fehlt)
    std::string text(const std::string& sonst = "") const;
    long long zahl(long long sonst = 0) const;
    bool wahr(bool sonst = false) const;

    // Liste durchlaufen:  for (Json e = liste.erstes(); e.gueltig(); e = e.naechstes()) ...
    Json erstes() const;
    Json naechstes() const;

private:
    const char* p_ = nullptr;     // erstes Zeichen des Werts
    const char* end_ = nullptr;   // Ende des gesamten Textes
};

// Schreiben: Text als JSON-Zeichenkette (mit Anfuehrungszeichen)
std::string jsonText(const std::string& s);

// Baut ein flaches JSON-Objekt:  JsonBau().text("id", id).wahr("erledigt", true).fertig()
class JsonBau {
public:
    JsonBau& text(const char* k, const std::string& v);
    JsonBau& zahl(const char* k, long long v);
    JsonBau& wahr(const char* k, bool v);
    std::string fertig() const { return s_ + "}"; }

private:
    void schluessel(const char* k);
    std::string s_ = "{";
};

}  // namespace haloos
