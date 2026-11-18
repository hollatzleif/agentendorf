import { describe, expect, it } from 'vitest';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

describe('Anschlüsse (E109)', () => {
  it('zeigt verbunden/fehlt mit Befehl – ohne Geheimnisse; nur angemeldet', async () => {
    const d = await testDorf({ env: { TELEGRAM_BOT_TOKEN: '123:geheim-token-xyz', TELEGRAM_CHAT_ID: '42', EODHD_API_KEY: 'eod-geheim' } });
    expect((await d.app.inject({ url: '/api/anschluesse' })).statusCode).toBe(401);
    const h = await kopf(d);
    const r = await d.app.inject({ url: '/api/anschluesse', headers: h });
    const a = r.json() as { name: string; ok: boolean; befehl: string; teilweise?: boolean }[];
    const n = (x: string) => a.find((y) => y.name === x)!;
    expect(n('Telegram')).toMatchObject({ ok: true, befehl: 'dorf telegram-einrichten' });
    expect(n('Börse (EODHD)').ok).toBe(true);
    expect(n('Gmail')).toMatchObject({ ok: false, befehl: 'dorf gmail-anmelden' });
    expect(n('Google-Kalender')).toMatchObject({ ok: false });
    expect(n('Saxo').ok).toBe(false);
    expect(r.body).not.toMatch(/geheim/);
  });
});
