import { expect, test, type Page } from '@playwright/test';
import { BOT_ID, terminal, uebersicht } from './hafen-daten';

/** E227: Hafen – Flotte (Vergleich, Not-Aus, Bot anlegen) und Terminal „Kielwasser“. Kryptowerk nachgebaut. */
async function anmelden(page: Page) {
  await page.addInitScript(() => localStorage.setItem('dorf-ansicht', 'liste'));
  await page.goto('/');
  await page.getByLabel('Passwort').fill('e2e-Passwort-sehr-lang-1');
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByRole('heading', { name: 'Dorfplatz' })).toBeVisible();
}

test('Hafen: Flotte im Vergleich, Bot anlegen (Fehler vom Kryptowerk sichtbar), Not-Aus mit Rückfrage', async ({ page }, info) => {
  const u = uebersicht();
  const anfragen: { methode: string; pfad: string; body: unknown }[] = [];
  await page.route('**/api/krypto**', async (r) => {
    const url = new URL(r.request().url());
    anfragen.push({ methode: r.request().method(), pfad: url.pathname, body: r.request().postDataJSON() });
    if (url.pathname === '/api/krypto') return r.fulfill({ json: u });
    if (url.pathname === '/api/krypto/notaus') return r.fulfill({ json: { ...u, notaus: true } });
    if (url.pathname === '/api/krypto/bots' && r.request().method() === 'POST') return r.fulfill({ status: 400, json: { fehler: 'einstellung.limits.maxOffen: Too big: expected number to be <=20' } });
    return r.fulfill({ json: { ok: true } });
  });
  await anmelden(page);
  await page.goto('/gebaeude/Hafen');
  await expect(page.getByRole('heading', { name: '⚓ Flotte' })).toBeVisible();
  await expect(page.getByText('Pump.fun live · 214 Tokens im Blick')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Bot Schwarm' })).toContainText('13W/8L');
  await expect(page.getByRole('list', { name: 'Legende' })).toContainText('Grübler');
  await expect(page.getByText('Paper Trading:', { exact: false }).first()).toBeVisible();
  // neuer Bot: Formular mit Standardwerten, Fehler des Kryptowerks wird angezeigt
  await page.getByRole('button', { name: '+ Neuer Bot' }).click();
  const form = page.getByRole('region', { name: 'Neuer Bot' });
  await form.getByLabel('Offene Positionen höchstens').fill('99');
  await form.getByRole('button', { name: 'Bot anlegen (Paper)' }).click();
  await expect(form.getByRole('alert')).toContainText('maxOffen');
  const neu = anfragen.find((a) => a.pfad === '/api/krypto/bots')!;
  expect((neu.body as { einstellung: { limits: { maxOffen: number } } }).einstellung.limits.maxOffen).toBe(99);
  await form.getByRole('button', { name: 'Abbrechen' }).click();
  // Not-Aus fragt nach
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: '🛑 Not-Aus' }).click();
  await expect.poll(() => anfragen.some((a) => a.pfad === '/api/krypto/notaus' && a.methode === 'POST')).toBe(true);
  if (info.project.name === 'handy') {
    const breit = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(breit).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: info.outputPath('flotte.png'), fullPage: true });
});

test('Terminal Kielwasser: Kopf, Token-Leiste, Equity-Kerzen, Agent mit Modulen, Volumen/X/PnL, Protokoll', async ({ page }, info) => {
  await page.route('**/api/krypto/bots/*/terminal', (r) => r.fulfill({ json: terminal() }));
  await anmelden(page);
  await page.goto(`/hafen/${BOT_ID}`);
  const kw = page.getByLabel('Terminal Schwarm');
  await expect(kw).toBeVisible();
  await expect(kw.getByText('PAPER', { exact: true })).toBeVisible();
  await expect(kw.getByText('11,840 SOL')).toBeVisible();
  await expect(kw.getByText('13W/8L', { exact: false })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Beobachtete Tokens' })).toContainText('MOONCAT');
  await expect(page.getByRole('region', { name: 'Bot-Equity' })).toContainText('LONG');
  await expect(page.getByRole('region', { name: 'Bot-Equity' })).toContainText('kein Hebel');
  const agent = page.getByRole('region', { name: 'Agent' });
  await expect(agent).toContainText('10 Module online');
  await expect(agent).toContainText('Risk-Gate');
  await expect(agent).toContainText('scoring');
  await expect(page.getByRole('region', { name: 'X-Feed' })).toContainText('Grok-Schlüssel');
  await expect(page.getByRole('region', { name: 'PnL' })).toContainText('37');
  await expect(page.getByRole('region', { name: 'Entscheidungen' })).toContainText('RUG');
  await expect(page.getByRole('region', { name: 'Trades' })).toContainText('Trailing Stop');
  // keine Modulkarte ragt aus der Agenten-Tafel
  const raus = await agent.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return [...el.querySelectorAll('.kw-modul, .kw-kern')].filter((k) => k.getBoundingClientRect().right > r.right + 1 || k.getBoundingClientRect().left < r.left - 1).length;
  });
  expect(raus).toBe(0);
  if (info.project.name === 'handy') {
    const breit = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(breit).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: info.outputPath('terminal.png'), fullPage: true });
});
