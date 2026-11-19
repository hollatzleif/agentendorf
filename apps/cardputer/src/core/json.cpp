#include "json.h"

#include <cstdio>
#include <cstdlib>

namespace haloos {

namespace {

const char* leer(const char* p, const char* end) {
    while (p < end && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) ++p;
    return p;
}

// Ueberspringt einen Wert. Rueckgabe: Zeiger hinter den Wert oder nullptr bei Fehler.
const char* ueberspringen(const char* p, const char* end, int tiefe) {
    p = leer(p, end);
    if (p >= end || tiefe > 24) return nullptr;
    if (*p == '"') {
        for (++p; p < end; ++p) {
            if (*p == '\\') { ++p; continue; }
            if (*p == '"') return p + 1;
        }
        return nullptr;
    }
    if (*p == '{' || *p == '[') {
        const bool obj = *p == '{';
        const char zu = obj ? '}' : ']';
        p = leer(p + 1, end);
        if (p < end && *p == zu) return p + 1;
        while (true) {
            if (obj) {
                p = leer(p, end);
                if (p >= end || *p != '"') return nullptr;
                p = ueberspringen(p, end, tiefe + 1);
                if (!p) return nullptr;
                p = leer(p, end);
                if (p >= end || *p != ':') return nullptr;
                ++p;
            }
            p = ueberspringen(p, end, tiefe + 1);
            if (!p) return nullptr;
            p = leer(p, end);
            if (p >= end) return nullptr;
            if (*p == zu) return p + 1;
            if (*p != ',') return nullptr;
            ++p;
        }
    }
    // Zahl, true, false, null
    const char* s = p;
    while (p < end && *p != ',' && *p != '}' && *p != ']' && *p != ' ' && *p != '\n' && *p != '\r' && *p != '\t') ++p;
    if (p == s) return nullptr;
    const char c = *s;
    if (!(c == '-' || (c >= '0' && c <= '9') || c == 't' || c == 'f' || c == 'n')) return nullptr;
    return p;
}

void utf8(std::string& o, uint32_t cp) {
    if (cp < 0x80) {
        o += static_cast<char>(cp);
    } else if (cp < 0x800) {
        o += static_cast<char>(0xC0 | (cp >> 6));
        o += static_cast<char>(0x80 | (cp & 0x3F));
    } else if (cp < 0x10000) {
        o += static_cast<char>(0xE0 | (cp >> 12));
        o += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
        o += static_cast<char>(0x80 | (cp & 0x3F));
    } else {
        o += static_cast<char>(0xF0 | (cp >> 18));
        o += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
        o += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
        o += static_cast<char>(0x80 | (cp & 0x3F));
    }
}

bool hex4(const char* p, const char* end, uint32_t& v) {
    if (end - p < 4) return false;
    v = 0;
    for (int i = 0; i < 4; ++i) {
        const char c = p[i];
        v <<= 4;
        if (c >= '0' && c <= '9') v |= static_cast<uint32_t>(c - '0');
        else if (c >= 'a' && c <= 'f') v |= static_cast<uint32_t>(c - 'a' + 10);
        else if (c >= 'A' && c <= 'F') v |= static_cast<uint32_t>(c - 'A' + 10);
        else return false;
    }
    return true;
}

// Zeichenkette ab dem oeffnenden Anfuehrungszeichen entschluesseln
std::string entschluesseln(const char* p, const char* end) {
    std::string o;
    for (++p; p < end && *p != '"'; ++p) {
        if (*p != '\\') { o += *p; continue; }
        if (++p >= end) break;
        switch (*p) {
            case 'n': o += '\n'; break;
            case 't': o += ' '; break;
            case 'r': break;
            case 'b': case 'f': break;
            case 'u': {
                uint32_t cp = 0;
                if (!hex4(p + 1, end, cp)) return o;
                p += 4;
                if (cp >= 0xD800 && cp < 0xDC00 && end - p > 6 && p[1] == '\\' && p[2] == 'u') {   // Ersatzpaar
                    uint32_t lo = 0;
                    if (hex4(p + 3, end, lo) && lo >= 0xDC00 && lo < 0xE000) {
                        cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                        p += 6;
                    }
                }
                utf8(o, cp);
                break;
            }
            default: o += *p; break;   // \" \\ \/
        }
    }
    return o;
}

}  // namespace

Json Json::lesen(const std::string& text) {
    const char* p = text.data();
    const char* end = p + text.size();
    const char* nach = ueberspringen(p, end, 0);
    if (!nach || leer(nach, end) != end) return Json();
    return Json(leer(p, end), end);
}

Json Json::operator[](const char* schluessel) const {
    if (!istObjekt()) return Json();
    const char* p = leer(p_ + 1, end_);
    while (p < end_ && *p == '"') {
        const char* k = p + 1;
        const char* nachK = ueberspringen(p, end_, 0);
        if (!nachK) return Json();
        const char* s = schluessel;
        const char* q = k;
        while (*s && q < nachK - 1 && *q == *s) { ++q; ++s; }
        const bool gleich = *s == 0 && q == nachK - 1;
        p = leer(nachK, end_);
        if (p >= end_ || *p != ':') return Json();
        p = leer(p + 1, end_);
        if (gleich) return Json(p, end_);
        p = ueberspringen(p, end_, 0);
        if (!p) return Json();
        p = leer(p, end_);
        if (p < end_ && *p == ',') p = leer(p + 1, end_);
    }
    return Json();
}

std::string Json::text(const std::string& sonst) const {
    if (!p_) return sonst;
    if (*p_ == '"') return entschluesseln(p_, end_);
    if (*p_ == 'n' || *p_ == '{' || *p_ == '[') return sonst;
    const char* e = ueberspringen(p_, end_, 0);   // Zahl/true/false als Text
    return e ? std::string(p_, e) : sonst;
}

long long Json::zahl(long long sonst) const {
    if (!p_ || !(*p_ == '-' || (*p_ >= '0' && *p_ <= '9'))) return sonst;
    const char* e = ueberspringen(p_, end_, 0);
    if (!e) return sonst;
    const std::string s(p_, e);
    if (s.find_first_of(".eE") != std::string::npos) return static_cast<long long>(std::strtod(s.c_str(), nullptr));
    return std::strtoll(s.c_str(), nullptr, 10);
}

bool Json::wahr(bool sonst) const {
    if (!p_) return sonst;
    if (*p_ == 't') return true;
    if (*p_ == 'f' || *p_ == 'n') return false;
    return sonst;
}

Json Json::erstes() const {
    if (!istListe()) return Json();
    const char* p = leer(p_ + 1, end_);
    if (p >= end_ || *p == ']') return Json();
    return Json(p, end_);
}

Json Json::naechstes() const {
    if (!p_) return Json();
    const char* p = ueberspringen(p_, end_, 0);
    if (!p) return Json();
    p = leer(p, end_);
    if (p >= end_ || *p != ',') return Json();
    return Json(leer(p + 1, end_), end_);
}

std::string jsonText(const std::string& s) {
    std::string o = "\"";
    for (char c : s) {
        const unsigned char u = static_cast<unsigned char>(c);
        if (c == '"') o += "\\\"";
        else if (c == '\\') o += "\\\\";
        else if (c == '\n') o += "\\n";
        else if (u < 0x20) {
            char b[8];
            std::snprintf(b, sizeof b, "\\u%04x", u);
            o += b;
        } else o += c;
    }
    return o + "\"";
}

void JsonBau::schluessel(const char* k) {
    if (s_.size() > 1) s_ += ",";
    s_ += "\"";
    s_ += k;
    s_ += "\":";
}

JsonBau& JsonBau::text(const char* k, const std::string& v) {
    schluessel(k);
    s_ += jsonText(v);
    return *this;
}

JsonBau& JsonBau::zahl(const char* k, long long v) {
    schluessel(k);
    s_ += std::to_string(v);
    return *this;
}

JsonBau& JsonBau::wahr(const char* k, bool v) {
    schluessel(k);
    s_ += v ? "true" : "false";
    return *this;
}

}  // namespace haloos
