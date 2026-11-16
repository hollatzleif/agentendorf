import { describe, expect, it } from 'vitest';
import { dbOeffnen } from '../src/db.js';
import { Drossel } from '../src/auth/drossel.js';
import { TestUhr } from '../src/uhr.js';

describe('Login-Drosselung', () => {
  it('5 Fehlversuche frei, dann wachsende Wartezeit', () => {
    const uhr = new TestUhr();
    const d = new Drossel(dbOeffnen(':memory:'), uhr);
    for (let i = 0; i < 5; i++) {
      expect(d.pruefen('1.1.1.1').erlaubt).toBe(true);
      d.merken('1.1.1.1', false);
    }
    expect(d.pruefen('1.1.1.1')).toEqual({ erlaubt: false, warteSek: 30 });
    expect(d.pruefen('2.2.2.2').erlaubt).toBe(true); // andere IP unberührt
    uhr.vor(30_000);
    expect(d.pruefen('1.1.1.1').erlaubt).toBe(true);
    d.merken('1.1.1.1', false); // 6. Fehlversuch
    expect(d.pruefen('1.1.1.1').warteSek).toBe(60);
    uhr.vor(60_000);
    d.merken('1.1.1.1', false); // 7.
    expect(d.pruefen('1.1.1.1').warteSek).toBe(120);
  });

  it('Wartezeit ist auf 15 Minuten begrenzt', () => {
    const uhr = new TestUhr();
    const d = new Drossel(dbOeffnen(':memory:'), uhr);
    for (let i = 0; i < 14; i++) d.merken('1.1.1.1', false);
    expect(d.pruefen('1.1.1.1').warteSek).toBe(15 * 60);
  });

  it('ein Erfolg setzt den Zähler der IP zurück', () => {
    const uhr = new TestUhr();
    const d = new Drossel(dbOeffnen(':memory:'), uhr);
    for (let i = 0; i < 4; i++) d.merken('1.1.1.1', false);
    uhr.vor(1000);
    d.merken('1.1.1.1', true);
    uhr.vor(1000);
    for (let i = 0; i < 4; i++) d.merken('1.1.1.1', false);
    expect(d.pruefen('1.1.1.1').erlaubt).toBe(true);
  });

  it('globale Bremse bei vielen Fehlversuchen von vielen IPs', () => {
    const uhr = new TestUhr();
    const d = new Drossel(dbOeffnen(':memory:'), uhr);
    for (let i = 0; i < 30; i++) d.merken(`10.0.0.${i}`, false);
    expect(d.pruefen('9.9.9.9')).toEqual({ erlaubt: false, warteSek: 60 });
    uhr.vor(60_000);
    expect(d.pruefen('9.9.9.9').erlaubt).toBe(true);
  });

  it('nach 15 Minuten ohne Versuch ist die IP wieder frei', () => {
    const uhr = new TestUhr();
    const d = new Drossel(dbOeffnen(':memory:'), uhr);
    for (let i = 0; i < 8; i++) d.merken('1.1.1.1', false);
    uhr.vor(15 * 60 * 1000 + 1);
    expect(d.pruefen('1.1.1.1').erlaubt).toBe(true);
  });
});
