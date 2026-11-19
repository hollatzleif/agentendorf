"""Erzeugt src/core/fonts_data.cpp: Inter-Schriften als geglaettete 4-Bit-Bitmaps fuer den Cardputer.

Schrift: Inter (fonts/, SIL Open Font License 1.1 - fonts/LICENSE-Inter.txt), mit Umlauten.
Aufruf (aus apps/cardputer/):  python3 tools/fontgen.py     (braucht Pillow)

Achtung: Die grosse Ziffernschrift (FONT_BIG) kommt aus InterDisplay-Light.otf. Diese Datei lag dem
HaloOS-Quellpaket nicht bei; fonts_data.cpp ist deshalb unveraendert aus HaloOS 0.3 uebernommen. Wer die
Schriften neu erzeugen will, legt InterDisplay-Light.otf (rsms.me/inter, gleiche Lizenz) nach fonts/.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONTS = ROOT / "fonts"
OUT = ROOT / "src" / "core" / "fonts_data.cpp"

LATIN = "".join(chr(c) for c in range(32, 127)) + "ÄÖÜäöüßéèàáâçñÉ€°·…–—„“”‘’«»×✓←→↑↓∞"
DIGITS = "0123456789:–-+% "

# (C-Name, Datei, Pixelgroesse, Zeichensatz)
SPECS = [
    ("FONT_SMALL", "Inter-Medium.otf", 11, LATIN),
    ("FONT_BODY", "Inter-Medium.otf", 13, LATIN),
    ("FONT_TITLE", "Inter-SemiBold.otf", 15, LATIN),
    ("FONT_MENU", "Inter-SemiBold.otf", 18, LATIN),
    ("FONT_BIG", "InterDisplay-Light.otf", 46, DIGITS),
]


def render(name: str, file: str, size: int, chars: str) -> tuple[str, int]:
    font = ImageFont.truetype(str(FONTS / file), size)
    ascent, descent = font.getmetrics()
    glyphs, data = [], bytearray()
    for ch in sorted(set(chars), key=ord):
        adv = round(font.getlength(ch))
        box = font.getbbox(ch, anchor="ls")          # relativ zur Grundlinie
        w, h = max(0, box[2] - box[0]), max(0, box[3] - box[1])
        off = len(data)
        if w and h:
            img = Image.new("L", (w, h), 0)
            ImageDraw.Draw(img).text((-box[0], -box[1]), ch, font=font, fill=255, anchor="ls")
            px = list(img.tobytes())
            nib = [min(15, (v * 15 + 127) // 255) for v in px]
            if len(nib) % 2:
                nib.append(0)
            data += bytes((nib[i] << 4) | nib[i + 1] for i in range(0, len(nib), 2))
        glyphs.append((ord(ch), box[0], box[1], w, h, adv, off))
    lines = [f"static const uint8_t {name}_data[] = {{"]
    for i in range(0, len(data), 24):
        lines.append("    " + ", ".join(f"0x{b:02x}" for b in data[i:i + 24]) + ",")
    lines.append("};")
    lines.append(f"static const Glyph {name}_glyphs[] = {{")
    for cp, x0, y0, w, h, adv, off in glyphs:
        lines.append(f"    {{0x{cp:04x}, {x0}, {y0}, {w}, {h}, {adv}, {off}}},")
    lines.append("};")
    lines.append(f"const Font {name} = {{{name}_glyphs, {len(glyphs)}, {name}_data, {ascent}, {descent}, {size}}};")
    return "\n".join(lines), len(data)


def main() -> None:
    fehlt = sorted({spec[1] for spec in SPECS if not (FONTS / spec[1]).exists()})
    if fehlt:
        raise SystemExit("Es fehlt in fonts/: " + ", ".join(fehlt) + " - nichts geaendert (siehe Kopf dieser Datei).")
    parts = ["// Automatisch erzeugt von tools/fontgen.py - nicht von Hand aendern.",
             "// Schrift: Inter (rsms.me/inter), SIL Open Font License 1.1 (fonts/LICENSE-Inter.txt).",
             '#include "fonts.h"', "", "namespace haloos {", ""]
    total = 0
    for spec in SPECS:
        src, n = render(*spec)
        parts += [src, ""]
        total += n
    parts.append("}  // namespace haloos")
    OUT.write_text("\n".join(parts) + "\n", encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {len(SPECS)} Schriften, {total} Bytes Bilddaten")


if __name__ == "__main__":
    main()
