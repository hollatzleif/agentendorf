import { describe, expect, it } from 'vitest';
import { terminAusText } from '@dorf/shared';

// Mo, 16.11.2026 13:00 Linz
const JETZT = Date.UTC(2026, 10, 16, 12, 0);
const t = (s: string) => terminAusText(s, JETZT);

describe('Termin aus Text', () => {
  it('Datum: heute, morgen, übermorgen, Wochentag, nächsten …, Datum mit/ohne Jahr, in n Tagen', () => {
    expect(t('morgen 14 Uhr Zahnarzt')).toEqual({ titel: 'Zahnarzt', ganztags: false, start: '2026-11-17T14:00', ende: '2026-11-17T15:00' });
    expect(t('übermorgen Geburtstag Oma')).toEqual({ titel: 'Geburtstag Oma', ganztags: true, start: '2026-11-18', ende: '2026-11-19' });
    expect(t('Fr 9-11 Lernen Mathe')).toEqual({ titel: 'Lernen Mathe', ganztags: false, start: '2026-11-20T09:00', ende: '2026-11-20T11:00' });
    expect(t('Montag 10 Uhr Sprechstunde')!.start).toBe('2026-11-23T10:00'); // heute ist Montag → nächste Woche
    expect(t('nächsten Mittwoch 18:30 Kneipe')!.start).toBe('2026-11-18T18:30');
    expect(t('20.11. 18:30 Kneipe @Corpshaus')).toEqual({ titel: 'Kneipe', ganztags: false, start: '2026-11-20T18:30', ende: '2026-11-20T19:30', ort: 'Corpshaus' });
    expect(t('3.2. Prüfung Stat ML')).toMatchObject({ ganztags: true, start: '2027-02-03' }); // schon vorbei → nächstes Jahr
    expect(t('5.1.2027 Abgabe')).toMatchObject({ start: '2027-01-05' });
    expect(t('in 3 Tagen 8 Uhr Laufen 45 min')).toEqual({ titel: 'Laufen', ganztags: false, start: '2026-11-19T08:00', ende: '2026-11-19T08:45' });
  });

  it('Zeit und Dauer: von–bis, mit Minuten, für 2h, 1,5 Stunden; nur Uhrzeit → heute bzw. morgen', () => {
    expect(t('von 9 bis 11:30 Bibliothek')).toMatchObject({ start: '2026-11-17T09:00', ende: '2026-11-17T11:30' }); // 9 Uhr heute schon vorbei
    expect(t('15:15 Kaffee mit Max')).toMatchObject({ titel: 'Kaffee mit Max', start: '2026-11-16T15:15', ende: '2026-11-16T16:15' });
    expect(t('morgen 10:15 für 2h Sprechstunde')).toMatchObject({ start: '2026-11-17T10:15', ende: '2026-11-17T12:15' });
    expect(t('morgen um 9 Arzt 1,5 Stunden')).toMatchObject({ titel: 'Arzt', start: '2026-11-17T09:00', ende: '2026-11-17T10:30' });
    expect(t('morgen 23 Uhr Nachtzug 3h')).toMatchObject({ ende: '2026-11-18T00:00' });
  });

  it('Unsinn → null; Titel bleibt sauber', () => {
    expect(t('morgen 14 Uhr')).toBeNull();
    expect(t('')).toBeNull();
    expect(t('25:00 Party')).toBeNull();
    expect(t('Steuererklärung')).toEqual({ titel: 'Steuererklärung', ganztags: true, start: '2026-11-16', ende: '2026-11-17' });
  });
});
