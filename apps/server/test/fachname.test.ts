import { describe, expect, it } from 'vitest';
import { fachPasst, fachZuordnen, istFristBlock } from '@dorf/shared';

describe('Fachnamen vergleichen (E145)', () => {
  it('ganze Wörter, kein „Mathe I“ in „Mathe II“', () => {
    expect(fachPasst('Mathe III', 'mathe iii')).toBe(true);
    expect(fachPasst('Mathe III', 'Mathe III UE')).toBe(true);
    expect(fachPasst('Mathe I', 'Mathe II')).toBe(false);
    expect(fachPasst('Mathe II', 'Mathe I')).toBe(false);
    expect(fachPasst('NLP', 'NLP Klausur')).toBe(false); // zu kurz für einen Teil-Treffer
    expect(fachPasst('NLP', 'nlp')).toBe(true);
    expect(fachPasst('Statistik', 'Statistisches Lernen')).toBe(false);
    expect(fachPasst('Statistisches Lernen', 'VL Statistisches Lernen (WS)')).toBe(true);
    expect(fachPasst('', 'x')).toBe(false);
    expect(fachPasst('Lernen', 'Statistisches Lernen')).toBe(false);
    expect(fachPasst('Algorithmen', 'VL Algorithmen und Datenstrukturen')).toBe(true);
    expect(istFristBlock({ titel: '⏰ NLP: Blatt 3 ist fällig' })).toBe(true);
    expect(istFristBlock({ titel: '✅ ⏰ NLP: Blatt 3 ist fällig' })).toBe(true);
    expect(istFristBlock({ titel: 'Vorlesung' })).toBe(false);
    expect(istFristBlock({ titel: '✔ ⏰ NLP: Blatt 3 ist fällig' })).toBe(true);
    expect(istFristBlock({ titel: 'erledigt ⏰ NLP: Blatt 3 ist fällig' })).toBe(true);
  });
});

describe('fachZuordnen (E145)', () => {
  const faecher = [
    { titel: 'Mathe III UE', name: 'mathe-ue' },
    { titel: 'Mathe III', name: 'mathe3' },
    { titel: 'Statistisches Lernen', name: 'stat' },
  ];
  it('exakt vor ungefähr, sonst ganze Wörter', () => {
    const z = (n: string) => fachZuordnen(faecher, (f) => [f.titel, f.name], n)?.titel;
    expect(z('Mathe III')).toBe('Mathe III');
    expect(z('mathe-ue')).toBe('Mathe III UE');
    expect(z('VL Statistisches Lernen (WS 2026)')).toBe('Statistisches Lernen');
    expect(z('Mathe II')).toBeUndefined();
    expect(z('')).toBeUndefined();
  });
  it('ohne exakten Treffer gewinnt der längste passende Name – unabhängig von der Reihenfolge (Review)', () => {
    const alpha = [
      { titel: 'Mathe III', name: 'm3' },
      { titel: 'Mathe III UE', name: 'm3ue' },
    ];
    expect(fachZuordnen(alpha, (f) => [f.titel, f.name], 'VL Mathe III UE (2026W)')?.titel).toBe('Mathe III UE');
    expect(fachZuordnen(alpha, (f) => [f.titel, f.name], 'VL Mathe III (2026W)')?.titel).toBe('Mathe III');
  });
});

describe('Überschneidungen (E168)', () => {
  it('findet überlappende Termine, nicht angrenzende, nicht Fristen/Ganztägiges', async () => {
    const { ueberschneidungen } = await import('@dorf/shared');
    const t = (titel: string, a: string, b: string, ganztags = false) => ({ titel, start: `2026-11-17T${a}:00+01:00`, ende: `2026-11-17T${b}:00+01:00`, ganztags });
    const r = ueberschneidungen([t('VL', '10:00', '12:00'), t('Zahnarzt', '11:30', '12:00'), t('Mittag', '12:00', '13:00'), t('⏰ Frist', '11:00', '11:10'), t('Feiertag', '00:00', '23:59', true)]);
    expect(r.map(([a, b]) => `${a.titel}↔${b.titel}`)).toEqual(['VL↔Zahnarzt']);
  });
});
