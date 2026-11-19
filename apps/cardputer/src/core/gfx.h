// Kleine Grafik-Schicht fuer das 240x135-Display des Cardputers.
// Zeichnet in einen eigenen Bildspeicher (RGB565). Auf dem Geraet wird er mit einem Befehl
// aufs Display geschoben, im PC-Test als Bild gespeichert - so sind die Bildschirmfotos exakt.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

#include "fonts.h"

namespace haloos {

constexpr int SCREEN_W = 240;
constexpr int SCREEN_H = 135;

using Color = uint16_t;

constexpr Color rgb(uint32_t hex) {
    return static_cast<Color>((((hex >> 16) & 0xF8) << 8) | (((hex >> 8) & 0xFC) << 3) | ((hex & 0xFF) >> 3));
}

// Farben wie auf der Brille (glasses/main.lua, Design 2)
namespace col {
constexpr Color BG = rgb(0x05090C);
constexpr Color PANEL = rgb(0x0E161C);
constexpr Color LINE = rgb(0x1E2A33);
constexpr Color WHITE = rgb(0xEAF2F8);
constexpr Color TEXT2 = rgb(0xAEBAC6);
constexpr Color GREY = rgb(0x76838F);
constexpr Color ACCENT = rgb(0x3CD7FF);
constexpr Color ACCENT_DIM = rgb(0x2A8FB0);
constexpr Color SEL_BG = rgb(0x0B2B37);
constexpr Color RED = rgb(0xFF5C6C);
constexpr Color GREEN = rgb(0x37E89B);
constexpr Color AMBER = rgb(0xFFC15C);
}  // namespace col

enum class Align { Left, Center, Right };

class Gfx {
public:
    uint16_t px[SCREEN_W * SCREEN_H];

    void clear(Color c);
    void fill(int x, int y, int w, int h, Color c);
    void rrect(int x, int y, int w, int h, int r, Color c);         // gefuellt, runde Ecken
    void frame(int x, int y, int w, int h, int r, Color c);         // Umriss, runde Ecken
    void hline(int x, int y, int w, Color c) { fill(x, y, w, 1, c); }
    void disc(int cx, int cy, int r, Color c);                      // gefuellter Kreis (geglaettet)
    void ring(int cx, int cy, int r, Color c);                      // Kreislinie (geglaettet)
    void check(int x, int y, int s, Color c);                       // Haekchen in einem s*s-Feld
    void star(int cx, int cy, int r, Color c);                      // gefuellter Stern (geglaettet)

    // Text: y ist die Grundlinie. Gibt die Breite zurueck. maxw > 0 kuerzt mit "…".
    int text(const Font& f, int x, int y, const std::string& s, Color c, Align a = Align::Left,
             int maxw = 0);
    static int width(const Font& f, const std::string& s);
    static std::string fit(const Font& f, const std::string& s, int maxw);

    // Nur fuer Tests: wenn gesetzt, wird jeder gezeichnete Text hier mitgeschrieben
    static std::vector<std::string>* mitschrift;

private:
    void blend(int x, int y, Color c, int a16);  // a16 = 0..16
};

// UTF-8 -> naechstes Zeichen (ungueltige Bytes werden als '?' gelesen)
uint32_t nextChar(const std::string& s, size_t& i);
// Laenge in Zeichen und Abschneiden nach Zeichen (fuer Eingabefelder)
size_t charCount(const std::string& s);
void popChar(std::string& s);

}  // namespace haloos
