"""Kirchenglocke synthetisch (additive Synthese, eigene Arbeit): Teiltöne einer Glocke mit Abklingen."""
import math, struct, sys, wave, random

RATE = 22050

def schlag(grund, dauer, laut=1.0):
    # typische Glocken-Teiltöne (Verhältnis zur Prime): Unterton, Prime, kleine Terz, Quinte, Oktave (Nominal), höhere
    teile = [(0.5, 0.35, 1.1), (1.0, 0.55, 0.9), (1.19, 0.4, 0.75), (1.5, 0.22, 0.6), (2.0, 0.5, 0.55), (2.5, 0.12, 0.35), (2.66, 0.1, 0.3), (3.01, 0.08, 0.25), (4.1, 0.05, 0.18)]
    n = int(dauer * RATE)
    aus = [0.0] * n
    rnd = random.Random(int(grund))
    for verh, amp, abkl in teile:
        f = grund * verh * (1 + rnd.uniform(-0.002, 0.002))
        schweb = rnd.uniform(0.6, 1.8)  # leichte Schwebung (zwei fast gleiche Töne)
        for i in range(n):
            t = i / RATE
            hk = math.exp(-t / (abkl * dauer * 0.45))
            aus[i] += amp * hk * (math.sin(2 * math.pi * f * t) + 0.35 * math.sin(2 * math.pi * (f + schweb) * t))
    # Anschlag: kurzer metallischer Klick
    for i in range(min(n, int(0.02 * RATE))):
        aus[i] += 0.25 * math.exp(-i / (0.003 * RATE)) * rnd.uniform(-1, 1)
    return [x * laut for x in aus]

def mischen(stuecke, gesamt):
    n = int(gesamt * RATE)
    aus = [0.0] * n
    for start, daten in stuecke:
        s = int(start * RATE)
        for i, x in enumerate(daten):
            if s + i < n:
                aus[s + i] += x
    return aus

def schreiben(pfad, daten):
    spitze = max(abs(x) for x in daten) or 1
    with wave.open(pfad, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        # sanft ausblenden
        n = len(daten)
        for i in range(int(0.3 * RATE)):
            daten[n - 1 - i] *= i / (0.3 * RATE)
        w.writeframes(b''.join(struct.pack('<h', int(28000 * x / spitze)) for x in daten))

ziel = sys.argv[1]
# einzelner Schlag (Timer, Pomodoro, Mitteilungen): tiefe Glocke
schreiben(f'{ziel}/schlag.wav', schlag(392.0, 3.0))
# Geläut (Wecker): zwei Glocken im Wechsel, 4 Schläge
hoch, tief = schlag(523.25, 2.6, 0.8), schlag(392.0, 3.0)
schreiben(f'{ziel}/gelaeut.wav', mischen([(0.0, tief), (0.9, hoch), (1.8, tief), (2.7, hoch)], 5.6))
