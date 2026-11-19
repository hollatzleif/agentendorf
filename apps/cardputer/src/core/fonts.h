// Geglaettete Bitmap-Schriften (Inter) fuer den Cardputer. Daten: fonts_data.cpp (tools/fontgen.py).
#pragma once
#include <cstdint>

namespace haloos {

struct Glyph {
    uint16_t cp;      // Unicode-Zeichen
    int8_t x0, y0;    // linke obere Ecke relativ zu (Stift-x, Grundlinie)
    uint8_t w, h;     // Bildgroesse in Pixeln
    uint8_t adv;      // Vorschub
    uint32_t off;     // Start in data (4 Bit je Pixel, zeilenweise, hohes Halbbyte zuerst)
};

struct Font {
    const Glyph* glyphs;
    uint16_t count;
    const uint8_t* data;
    uint8_t ascent, descent, size;
    const Glyph* find(uint16_t cp) const;
};

extern const Font FONT_SMALL;   // Inter Medium 11 px
extern const Font FONT_BODY;    // Inter Medium 13 px
extern const Font FONT_TITLE;   // Inter SemiBold 15 px
extern const Font FONT_MENU;    // Inter SemiBold 18 px
extern const Font FONT_BIG;     // Inter Display Light 46 px, nur Ziffern und ':'

}  // namespace haloos
