#include "gfx.h"

#include <cmath>
#include <cstdlib>

namespace haloos {

std::vector<std::string>* Gfx::mitschrift = nullptr;

const Glyph* Font::find(uint16_t cp) const {
    int lo = 0, hi = count - 1;
    while (lo <= hi) {
        const int mid = (lo + hi) / 2;
        if (glyphs[mid].cp == cp) return &glyphs[mid];
        if (glyphs[mid].cp < cp) lo = mid + 1; else hi = mid - 1;
    }
    return nullptr;
}

uint32_t nextChar(const std::string& s, size_t& i) {
    const auto b = [&](size_t k) { return static_cast<uint8_t>(s[k]); };
    const uint8_t c = b(i);
    if (c < 0x80) { ++i; return c; }
    int n = (c & 0xE0) == 0xC0 ? 1 : (c & 0xF0) == 0xE0 ? 2 : (c & 0xF8) == 0xF0 ? 3 : -1;
    if (n < 0 || i + n >= s.size()) { ++i; return '?'; }   // abgeschnittenes Zeichen
    uint32_t cp = c & (0x3F >> n);
    for (int k = 1; k <= n; ++k) {
        if ((b(i + k) & 0xC0) != 0x80) { ++i; return '?'; }
        cp = (cp << 6) | (b(i + k) & 0x3F);
    }
    i += n + 1;
    return cp;
}

size_t charCount(const std::string& s) {
    size_t n = 0;
    for (size_t i = 0; i < s.size();) { nextChar(s, i); ++n; }
    return n;
}

void popChar(std::string& s) {
    while (!s.empty()) {
        const uint8_t c = static_cast<uint8_t>(s.back());
        s.pop_back();
        if ((c & 0xC0) != 0x80) return;  // Anfangsbyte erreicht
    }
}

void Gfx::clear(Color c) {
    for (auto& p : px) p = c;
}

void Gfx::fill(int x, int y, int w, int h, Color c) {
    const int x0 = x < 0 ? 0 : x, y0 = y < 0 ? 0 : y;
    const int x1 = x + w > SCREEN_W ? SCREEN_W : x + w, y1 = y + h > SCREEN_H ? SCREEN_H : y + h;
    for (int yy = y0; yy < y1; ++yy)
        for (int xx = x0; xx < x1; ++xx) px[yy * SCREEN_W + xx] = c;
}

void Gfx::blend(int x, int y, Color c, int a) {
    if (x < 0 || y < 0 || x >= SCREEN_W || y >= SCREEN_H || a <= 0) return;
    uint16_t& d = px[y * SCREEN_W + x];
    if (a >= 16) { d = c; return; }
    const int r = ((c >> 11) * a + (d >> 11) * (16 - a)) >> 4;
    const int g = (((c >> 5) & 0x3F) * a + ((d >> 5) & 0x3F) * (16 - a)) >> 4;
    const int b = ((c & 0x1F) * a + (d & 0x1F) * (16 - a)) >> 4;
    d = static_cast<uint16_t>((r << 11) | (g << 5) | b);
}

// Abdeckung eines Pixels durch einen Kreis (Abstand zum Rand -> 0..16)
static int coverage(float dist_out) {
    if (dist_out <= -0.5f) return 16;
    if (dist_out >= 0.5f) return 0;
    return static_cast<int>((0.5f - dist_out) * 16.0f + 0.5f);
}

void Gfx::rrect(int x, int y, int w, int h, int r, Color c) {
    if (r * 2 > h) r = h / 2;
    if (r * 2 > w) r = w / 2;
    fill(x + r, y, w - 2 * r, h, c);
    fill(x, y + r, r, h - 2 * r, c);
    fill(x + w - r, y + r, r, h - 2 * r, c);
    for (int dy = 0; dy < r; ++dy) {
        for (int dx = 0; dx < r; ++dx) {
            const float fx = r - dx - 0.5f, fy = r - dy - 0.5f;
            const int a = coverage(std::sqrt(fx * fx + fy * fy) - r);
            blend(x + dx, y + dy, c, a);
            blend(x + w - 1 - dx, y + dy, c, a);
            blend(x + dx, y + h - 1 - dy, c, a);
            blend(x + w - 1 - dx, y + h - 1 - dy, c, a);
        }
    }
}

void Gfx::frame(int x, int y, int w, int h, int r, Color c) {
    if (r * 2 > h) r = h / 2;
    hline(x + r, y, w - 2 * r, c);
    hline(x + r, y + h - 1, w - 2 * r, c);
    fill(x, y + r, 1, h - 2 * r, c);
    fill(x + w - 1, y + r, 1, h - 2 * r, c);
    for (int dy = 0; dy < r; ++dy) {
        for (int dx = 0; dx < r; ++dx) {
            const float fx = r - dx - 0.5f, fy = r - dy - 0.5f;
            const float d = std::sqrt(fx * fx + fy * fy) - (r - 0.5f);
            const int a = coverage(std::fabs(d) - 0.5f);
            blend(x + dx, y + dy, c, a);
            blend(x + w - 1 - dx, y + dy, c, a);
            blend(x + dx, y + h - 1 - dy, c, a);
            blend(x + w - 1 - dx, y + h - 1 - dy, c, a);
        }
    }
}

void Gfx::disc(int cx, int cy, int r, Color c) {
    for (int y = -r - 1; y <= r + 1; ++y)
        for (int x = -r - 1; x <= r + 1; ++x)
            blend(cx + x, cy + y, c, coverage(std::sqrt(float(x * x + y * y)) - r));
}

void Gfx::ring(int cx, int cy, int r, Color c) {
    for (int y = -r - 1; y <= r + 1; ++y)
        for (int x = -r - 1; x <= r + 1; ++x) {
            const float d = std::sqrt(float(x * x + y * y)) - (r - 0.5f);
            blend(cx + x, cy + y, c, coverage(std::fabs(d) - 0.6f));
        }
}

void Gfx::check(int x, int y, int s, Color c) {
    // zwei Striche, 1.6 px breit, geglaettet ueber Abstand zur Strecke
    const float ax = x + s * 0.18f, ay = y + s * 0.52f, bx = x + s * 0.42f, by = y + s * 0.76f,
                cx = x + s * 0.84f, cy = y + s * 0.26f;
    auto seg = [](float px_, float py, float x0, float y0, float x1, float y1) {
        const float vx = x1 - x0, vy = y1 - y0, wx = px_ - x0, wy = py - y0;
        float t = (vx * wx + vy * wy) / (vx * vx + vy * vy);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const float dx = wx - t * vx, dy = wy - t * vy;
        return std::sqrt(dx * dx + dy * dy);
    };
    for (int yy = y; yy < y + s; ++yy)
        for (int xx = x; xx < x + s; ++xx) {
            const float fx = xx + 0.5f, fy = yy + 0.5f;
            const float d = std::fmin(seg(fx, fy, ax, ay, bx, by), seg(fx, fy, bx, by, cx, cy));
            blend(xx, yy, c, coverage(d - 0.9f));
        }
}

int Gfx::width(const Font& f, const std::string& s) {
    int w = 0;
    for (size_t i = 0; i < s.size();) {
        const Glyph* g = f.find(static_cast<uint16_t>(nextChar(s, i)));
        if (!g) g = f.find('?');
        if (g) w += g->adv;
    }
    return w;
}

std::string Gfx::fit(const Font& f, const std::string& s, int maxw) {
    if (maxw <= 0 || width(f, s) <= maxw) return s;
    const std::string dots = "\xE2\x80\xA6";  // …
    std::string out = s;
    while (!out.empty() && width(f, out + dots) > maxw) popChar(out);
    while (!out.empty() && out.back() == ' ') out.pop_back();
    return out + dots;
}

int Gfx::text(const Font& f, int x, int y, const std::string& s0, Color c, Align a, int maxw) {
    const std::string s = maxw > 0 ? fit(f, s0, maxw) : s0;
    if (mitschrift) mitschrift->push_back(s);
    const int w = width(f, s);
    if (a == Align::Center) x -= w / 2;
    if (a == Align::Right) x -= w;
    for (size_t i = 0; i < s.size();) {
        const Glyph* g = f.find(static_cast<uint16_t>(nextChar(s, i)));
        if (!g) g = f.find('?');
        if (!g) continue;
        const uint8_t* d = f.data + g->off;
        for (int yy = 0; yy < g->h; ++yy)
            for (int xx = 0; xx < g->w; ++xx) {
                const int k = yy * g->w + xx;
                const int v = (k & 1) ? (d[k >> 1] & 0x0F) : (d[k >> 1] >> 4);
                if (v) blend(x + g->x0 + xx, y + g->y0 + yy, c, v + (v >> 3));  // 0..15 -> 0..16
            }
        x += g->adv;
    }
    return w;
}

}  // namespace haloos
