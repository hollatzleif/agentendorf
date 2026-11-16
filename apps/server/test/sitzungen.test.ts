import { describe, expect, it } from 'vitest';
import { dbOeffnen } from '../src/db.js';
import { Sitzungen, SITZUNG_DAUER_MS, tokenHash } from '../src/auth/sitzungen.js';
import { TestUhr } from '../src/uhr.js';

describe('Sitzungen', () => {
  it('speichert nur den Hash, läuft gleitend ab und ist widerrufbar', () => {
    const uhr = new TestUhr();
    const db = dbOeffnen(':memory:');
    const s = new Sitzungen(db, uhr);
    const { token, sitzung } = s.anlegen('Firefox', '1.2.3.4');
    expect(sitzung.id).toBe(tokenHash(token));
    expect(JSON.stringify(db.prepare('SELECT * FROM sitzungen').all())).not.toContain(token);

    uhr.vor(SITZUNG_DAUER_MS - 1000);
    expect(s.pruefen(token)).not.toBeNull(); // verlängert
    uhr.vor(SITZUNG_DAUER_MS - 1000);
    expect(s.pruefen(token)).not.toBeNull();
    uhr.vor(SITZUNG_DAUER_MS + 1);
    expect(s.pruefen(token)).toBeNull(); // abgelaufen

    const b = s.anlegen('Handy', '');
    const c = s.anlegen('Mac', '');
    expect(s.alleAusserBeenden(b.sitzung.id)).toEqual([c.sitzung.id]);
    expect(s.pruefen(c.token)).toBeNull();
    expect(s.pruefen(b.token)).not.toBeNull();
    expect(s.beenden(b.sitzung.id)).toBe(true);
    expect(s.pruefen(b.token)).toBeNull();
    expect(s.pruefen('quatsch')).toBeNull();
  });
});
