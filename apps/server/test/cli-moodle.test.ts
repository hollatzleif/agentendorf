import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { moodleAttrappe, TOKEN } from './moodle-attrappe.js';
import { tempOrdner } from './hilfen.js';

function cli(args: string[], stdin: string, env: Record<string, string>) {
  return new Promise<{ code: number; out: string; err: string }>((res) => {
    const p = execFile('npx', ['tsx', 'src/cli.ts', ...args], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, ...env } }, (e, out, err) =>
      res({ code: e ? ((e as { code?: number }).code ?? 1) : 0, out, err }),
    );
    p.stdin!.end(stdin);
  });
}

describe('cli moodle-token (für dorf moodle-anmelden)', async () => {
  const m = await moodleAttrappe();
  afterAll(() => m.schliessen());
  const env = { DATEN_DIR: tempOrdner() };
  const adresse = (passport: string) =>
    `moodlemobile://token=${Buffer.from(`${crypto.createHash('md5').update(m.basis + passport).digest('hex')}:::${TOKEN}`).toString('base64')}\n`;

  it('gibt nach geprüfter Signatur und Verbindung nur das Token aus', async () => {
    const r = await cli(['moodle-token', m.basis, '123456'], adresse('123456'), env);
    expect(r).toMatchObject({ code: 0, out: TOKEN });
    expect(r.err).toContain('Verbunden mit JKU Moodle als Leif Test');
  }, 30_000);

  it('falscher Prüfwert oder fehlende Funktionen: kein Token, Exit ≠ 0', async () => {
    const a = await cli(['moodle-token', m.basis, '999'], adresse('123456'), env);
    expect(a.code).not.toBe(0);
    expect(a.out).toBe('');
    m.s.funktionen = m.s.funktionen.filter((f) => f !== 'mod_assign_get_assignments');
    const b = await cli(['moodle-token', m.basis, '123456'], adresse('123456'), env);
    expect(b).toMatchObject({ code: 2, out: '' });
    expect(b.err).toMatch(/STOPP.*mod_assign_get_assignments/);
  }, 30_000);
});
