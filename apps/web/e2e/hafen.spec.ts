import { expect, test, type Page } from '@playwright/test';
import { BOT_ID, muster, terminal, uebersicht } from './hafen-daten';

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
    if (url.pathname === '/api/krypto/muster') return r.fulfill({ json: muster() });
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
  // E237: Euro neben SOL (70,2 $ je SOL, 1,08 $ je Euro → 1 SOL ≈ 65 €)
  await expect(page.getByTestId('hafen-kurs')).toContainText('1 SOL ≈ 65,00 €');
  await expect(page.getByTestId('hafen-kurs')).toHaveAttribute('title', /DexScreener.*EZB/);
  const schwarm = page.getByRole('article', { name: 'Bot Schwarm' });
  await expect(schwarm.getByTestId('bot-kapital')).toHaveText(/^11,84 SOL \(≈ 769,6\d €\)$/);
  await expect(schwarm.getByTestId('bot-gewinn')).toHaveText(/^\+1,84 SOL \(≈ \+119,6\d €\)$/);
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
  const takte: string[] = [];
  await page.route('**/api/krypto/bots/*/terminal**', (r) => {
    const takt = new URL(r.request().url()).searchParams.get('takt') ?? '';
    takte.push(takt);
    return r.fulfill({ json: { ...terminal(), kerzenTakt: takt || '15m' } });
  });
  await anmelden(page);
  await page.goto(`/hafen/${BOT_ID}`);
  const kw = page.getByLabel('Terminal Schwarm');
  await expect(kw).toBeVisible();
  await expect(kw.getByText('PAPER', { exact: true })).toBeVisible();
  await expect(kw.getByText('11,840 SOL')).toBeVisible();
  // E237: Euro – Kopfzeile, Kapital, Trades, Position
  await expect(kw.getByTestId('kw-kurs')).toHaveText('1 SOL ≈ 65,00 €');
  await expect(kw.getByTestId('kw-kurs')).toHaveAttribute('title', /EZB/);
  await expect(kw.locator('.kw-konto')).toContainText(/≈ 769,6\d €/);
  await expect(page.getByRole('region', { name: 'Trades' }).getByTestId('kw-trade-gewinn')).toContainText(/\+0,290 SOL \(≈ \+18,8\d €\)/);
  await expect(page.getByRole('region', { name: 'Trades' })).toContainText('0,500 SOL (≈ 32,50 €)');
  await expect(page.getByRole('region', { name: 'PnL' })).toContainText(/\+0,610 \(≈ \+39,6\d €\)/);
  await expect(page.getByTestId('kw-position')).toHaveAttribute('title', /Einsatz 0,50\d SOL \(≈ 32,5\d €\) · Wert 0,570 SOL \(≈ 37,0\d €\)/);
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
  // E232: Echtzeit-Kurse – Status und Kerzen des gehaltenen Tokens
  const echt = page.getByRole('region', { name: 'Echtzeit-Kurse' });
  await expect(echt.getByTestId('echtzeit-status')).toContainText('● live · 7 Tokens · 42 Trades/min · 12,4 MB heute');
  await expect(echt).toContainText('MOONCAT · gehalten');
  // E233: Chart – kein Feld über den Kerzen mehr (letzter Trade steht darüber), Marker für Kauf/Verkauf, Fadenkreuz, Zoom
  const eq = page.getByRole('region', { name: 'Bot-Equity' });
  await expect(eq.locator('.kw-popup')).toHaveCount(0);
  await expect(eq.getByTestId('letzter-trade')).toContainText('PEPEZ');
  await expect(page.getByTestId('tage-im-plus')).toContainText('2/3');
  const chart = eq.getByRole('img', { name: /Equity:/ });
  await expect(chart).toHaveAttribute('aria-label', /60 Kerzen, 2 Trades/); // Fehlschlag ist kein Marker
  await eq.locator('.kw-marker').first().hover();
  await expect(eq.getByTestId('chart-marker')).toContainText(/Verkauf PEPEZ|Kauf MOONCAT/);
  await expect(eq.getByTestId('chart-marker')).toContainText('Gebühr');
  await expect(eq.getByTestId('chart-marker')).toContainText('€'); // E237
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await expect(eq.getByTestId('chart-zeiger')).toContainText(/\d\d:\d\d/);
  await expect(eq.getByTestId('chart-zeiger')).toContainText('seit Start');
  await expect(eq.getByTestId('chart-zeiger')).toContainText(/≈ [\d.,]+ €/); // E237
  await eq.getByRole('button', { name: 'Hineinzoomen' }).click();
  await expect(chart).toHaveAttribute('aria-label', /40 Kerzen/);
  await eq.getByRole('button', { name: 'Alles' }).click();
  await expect(chart).toHaveAttribute('aria-label', /60 Kerzen/);
  // E233: Kerzen-Takt der Equity – 5 s bis 15 min, Anfrage mit ?takt=…, Wahl bleibt gemerkt
  await expect(eq.getByRole('group', { name: 'Kerzen-Takt' }).getByRole('button')).toHaveText(['5 s', '15 s', '1 min', '5 min', '15 min']);
  await eq.getByRole('button', { name: '5 s', exact: true }).click();
  await expect(eq.getByRole('heading')).toHaveText('Bot-Equity · 5 s');
  await expect(eq.getByRole('button', { name: '5 s', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(takte).toContain('5s');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Bot-Equity' }).getByRole('heading')).toHaveText('Bot-Equity · 5 s');
  await expect(echt.getByRole('img', { name: /MOONCAT: 60 Kerzen/ })).toBeVisible();
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

test('E228: Backtest mit den Regeln eines Bots, scharf schalten nur mit SCHARF + Passwort, Terminal zeigt LIVE, Wallet, Umsatz und Gebühren', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'ausführlich am Desktop');
  const { BOT_ID, uebersicht, terminal, muster } = await import('./hafen-daten');
  const u = uebersicht();
  const anfragen: { pfad: string; body: unknown }[] = [];
  let laeufe = 0;
  await page.route('**/api/krypto**', async (r) => {
    const url = new URL(r.request().url());
    const body = r.request().postDataJSON();
    anfragen.push({ pfad: url.pathname, body });
    if (url.pathname === '/api/krypto') return r.fulfill({ json: u });
    if (url.pathname === '/api/krypto/muster') return r.fulfill({ json: muster() });
    if (url.pathname === '/api/krypto/backtests' && r.request().method() === 'GET') return r.fulfill({ json: { bereich: { von: new Date(Date.now() - 30 * 3_600_000).toISOString(), bis: new Date().toISOString() }, jobs: [] } });
    if (url.pathname === '/api/krypto/backtests') return r.fulfill({ json: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', status: 'laeuft', fortschritt: 0, von: '', bis: '', name: 'Schwarm', erstellt: '' } });
    if (url.pathname.startsWith('/api/krypto/backtests/')) {
      laeufe++;
      const k = { ...u.bots[0]!.kennzahlen, gewinnSol: 0.42, gewinnProzent: 4.2, trades: 7, gewonnen: 4, verloren: 3 };
      return r.fulfill({ json: laeufe < 2 ? { id: 'x', status: 'laeuft', fortschritt: 40, von: '', bis: '', name: 'Schwarm', erstellt: '' } : { id: 'x', status: 'fertig', fortschritt: 100, von: '', bis: '', name: 'Schwarm', erstellt: '', daten: { tokens: 812, kurse: 40210, rug: 133 }, ergebnis: { kennzahlen: k, kurve: [], trades: terminal().trades, entscheidungen: { buy: 9, hold: 120, block: 77 } } } });
    }
    if (url.pathname.endsWith('/scharf')) return (body as { passwort: string }).passwort === 'richtig' ? r.fulfill({ json: { ...u.bots[0], modus: 'live' } }) : r.fulfill({ status: 401, json: { fehler: 'Passwort falsch.' } });
    if (url.pathname.endsWith('/protokoll')) return r.fulfill({ json: { trades: terminal().trades, entscheidungen: [] } });
    if (url.pathname.endsWith('/terminal')) {
      const t = terminal();
      t.bot.modus = 'live';
      t.trades[0]!.signatur = '5HTy8CU5GnhWYyH2vC1aW1wRxc74hkBtqpr6XgDRQcPF';
      return r.fulfill({ json: t });
    }
    return r.fulfill({ json: { ok: true } });
  });
  await anmelden(page);
  await page.goto('/gebaeude/Hafen');
  const karte = page.getByRole('article', { name: 'Bot Schwarm' });
  await expect(karte).toContainText('7xKXtg');
  // Backtest
  await karte.getByRole('button', { name: 'Backtest' }).click();
  const bt = page.getByRole('region', { name: 'Backtest' });
  await bt.getByRole('button', { name: '▶ Backtest starten' }).click();
  await expect(bt).toContainText('4W/3L', { timeout: 10_000 });
  await expect(bt).toContainText('812 Tokens');
  await expect(bt).toContainText(/\+0,420 SOL \(\+4,2 %\) \(≈ \+27,3\d €\)/); // E237
  expect((anfragen.find((a) => a.pfad === '/api/krypto/backtests' && a.body)!.body as { vonStunden: number }).vonStunden).toBe(24);
  await bt.getByRole('button', { name: 'Schließen' }).click();
  // Scharf schalten: Knopf erst mit SCHARF und Passwort; falsches Passwort → Meldung
  await karte.getByRole('button', { name: '🎯 Scharf schalten' }).click();
  const sd = page.getByRole('region', { name: 'Scharf schalten' });
  await expect(sd).toContainText('echtem Geld');
  const los = sd.getByRole('button', { name: 'Mit echtem Geld handeln' });
  await expect(los).toBeDisabled();
  await sd.getByLabel('Dein Passwort').fill('falsch');
  await sd.getByLabel('Zum Bestätigen SCHARF eintippen').fill('SCHARF');
  await los.click();
  await expect(sd.getByRole('alert')).toContainText('Passwort falsch');
  await sd.getByLabel('Dein Passwort').fill('richtig');
  await los.click();
  await expect(sd).toBeHidden();
  expect(anfragen.filter((a) => a.pfad.endsWith('/scharf')).at(-1)!.body).toMatchObject({ budgetSol: 0.5, bestaetigung: 'SCHARF', passwort: 'richtig' });
  // Terminal im Live-Modus
  await page.goto(`/hafen/${BOT_ID}`);
  const kw = page.getByLabel('Terminal Schwarm');
  await expect(kw.getByText('LIVE', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'PnL' })).toContainText('Umsatz');
  await expect(page.getByRole('region', { name: 'PnL' })).toContainText('PumpPortal');
  await expect(page.getByRole('region', { name: 'Trades' }).getByRole('link', { name: 'Transaktion' })).toHaveAttribute('href', /solscan\.io\/tx\//);
  const download = page.waitForEvent('download');
  await page.getByRole('region', { name: 'Trades' }).getByRole('button', { name: '⬇ CSV' }).click();
  expect((await download).suggestedFilename()).toBe('hafen-Schwarm-trades.csv');
});

test('E235: Muster-Modell in der Flotte (Jetzt trainieren, läuft schon), RL im Formular, Muster-Rat und Nachschuss im Terminal', async ({ page }, info) => {
  const u = uebersicht();
  const anfragen: { methode: string; pfad: string; body: unknown }[] = [];
  let laeuft = false;
  await page.route('**/api/krypto**', async (r) => {
    const url = new URL(r.request().url());
    anfragen.push({ methode: r.request().method(), pfad: url.pathname, body: r.request().postDataJSON() });
    if (url.pathname === '/api/krypto') return r.fulfill({ json: u });
    if (url.pathname === '/api/krypto/muster') return r.fulfill({ json: muster(laeuft) });
    if (url.pathname === '/api/krypto/muster/training') {
      laeuft = true; // ein anderes Training (alle 5 h) hat gerade begonnen
      return r.fulfill({ status: 409, json: { fehler: 'Das Training läuft schon.' } });
    }
    if (url.pathname.endsWith('/terminal')) return r.fulfill({ json: terminal() });
    if (url.pathname === '/api/krypto/bots' && r.request().method() === 'POST') return r.fulfill({ json: u.bots[0] });
    return r.fulfill({ json: { ok: true } });
  });
  await anmelden(page);
  await page.goto('/gebaeude/Hafen');
  const tafel = page.getByTestId('muster-tafel');
  await expect(tafel).toContainText('aktiv – gibt Rat');
  await expect(tafel).toContainText('0,612');
  await expect(tafel).toContainText('31 % vs. 17 %');
  await expect(tafel).toContainText('1.204.000 Ticks');
  await expect(tafel.getByRole('list', { name: 'Wichtigste Merkmale' }).getByRole('listitem')).toHaveCount(5);
  await expect(tafel.getByTestId('muster-zeitraffer')).toContainText('57 Trades');
  // E236: Tabelle aller Modelle – aktiv grün, inaktiv mit Grund, Wert-Modelle gegen den Median
  const modelle = tafel.getByTestId('muster-modelle');
  await expect(modelle.locator('tbody tr')).toHaveCount(5);
  await expect(modelle.locator('tr[data-schluessel="basis"] .hafen-punkt.an')).toHaveCount(1);
  await expect(modelle.locator('tr[data-schluessel="absturz"]')).toContainText('AUC 0,664 vs. Raten 0,5');
  await expect(modelle.locator('tr[data-schluessel="absturz"] .hafen-punkt.an')).toHaveCount(1);
  await expect(modelle.locator('tr[data-schluessel="pump"] .hafen-punkt.an')).toHaveCount(0);
  await expect(modelle.locator('tr[data-schluessel="pump"]')).toContainText('zu wenige Pumps im Test');
  await expect(modelle.locator('tr[data-schluessel="hoch5"]')).toContainText('±18,4 vs. Median ±23,9');
  await expect(modelle.locator('tr[data-schluessel="hoch5"] .hafen-punkt.an')).toHaveCount(1);
  await expect(modelle.locator('tr[data-schluessel="basis"]')).toContainText('412');
  await tafel.getByRole('button', { name: 'Jetzt trainieren' }).click();
  await expect(tafel.getByRole('status')).toContainText('läuft schon');
  await expect(tafel.getByRole('progressbar', { name: 'Training' })).toContainText('40 %');
  await expect(tafel.getByRole('button', { name: 'Trainiert …' })).toBeDisabled();
  expect(anfragen.filter((a) => a.pfad === '/api/krypto/muster/training' && a.methode === 'POST')).toHaveLength(1);
  // Formular: RL mit eigenen Feldern, Regeln mit Muster-Gewicht
  await page.getByRole('button', { name: '+ Neuer Bot' }).click();
  const form = page.getByRole('region', { name: 'Neuer Bot' });
  await expect(form.getByLabel('Muster-Rat Gewicht (0 = nur anzeigen)')).toHaveValue('0');
  await expect(form).toContainText('> 0: auch Verkauf bei Absturz-Risiko ≥ 70 %');
  await form.getByLabel('Strategie').selectOption('rl');
  await expect(form.getByLabel('Muster-Rat Gewicht (0 = nur anzeigen)')).toHaveCount(0);
  await expect(form).toContainText('nur im Paper Trading');
  await form.getByLabel('RL: Kauf ab Modell-Sicherheit (0–1)').fill('0.65');
  await expect(form.getByLabel('RL: Erkunden (0–0,3)')).toHaveValue('0.05');
  await form.getByLabel('RL: Nachschuss nach Pleite').selectOption('nein');
  await expect(form.getByLabel('RL: Kein Kauf ab Absturz-Risiko (0–1)')).toHaveValue('0.35');
  await expect(form).toContainText('gehalten ab 70 % sofort raus');
  await form.getByLabel('RL: Kein Kauf ab Absturz-Risiko (0–1)').fill('0.3');
  await form.getByRole('button', { name: 'Bot anlegen (Paper)' }).click();
  await expect(form).toBeHidden();
  const neu = anfragen.find((a) => a.pfad === '/api/krypto/bots' && a.methode === 'POST')!.body as { einstellung: { art: string; rl: unknown } };
  expect(neu.einstellung.art).toBe('rl');
  expect(neu.einstellung.rl).toEqual({ minSicherheit: 0.65, erkunden: 0.05, nachschuss: false, maxAbsturz: 0.3 });
  if (info.project.name === 'handy') {
    const breit = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(breit).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: info.outputPath('muster-flotte.png'), fullPage: true });
  // Terminal: Muster-Rat und Nachschuss
  await page.goto(`/hafen/${BOT_ID}`);
  const rat = page.getByRole('region', { name: 'Muster-Rat' });
  await expect(rat).toContainText('MOONCAT');
  await expect(rat).toContainText('p 72 %');
  // E236: Pump/Absturz/Ausblick/früh
  const mooncat = rat.getByRole('listitem').filter({ hasText: 'MOONCAT' });
  await expect(mooncat).toContainText('🚀 34 %');
  await expect(mooncat).toContainText('💥 8 %');
  await expect(mooncat).toContainText('5 min: Hoch +27 % / Tief −12 %');
  await expect(mooncat.locator('.kw-frueh')).toHaveText('früh');
  const sadcat = rat.getByRole('listitem').filter({ hasText: 'SADCAT' });
  await expect(sadcat.locator('.gefahr')).toContainText('💥 61 %');
  await expect(sadcat.locator('.kw-frueh')).toHaveCount(0);
  await expect(mooncat.locator('.gefahr')).toHaveCount(0);
  await expect(rat.locator('.kw-rat.kaufen')).toHaveText('KAUFEN');
  await expect(rat.locator('.kw-rat.raus')).toHaveText('RAUS');
  await expect(rat).toContainText('nur Anzeige');
  const pnl = page.getByRole('region', { name: 'PnL' });
  await expect(pnl.getByTestId('nachschuss')).toContainText('10,00 SOL');
  await expect(pnl.getByTestId('nachschuss')).toContainText('zählt nicht als Gewinn');
  await page.screenshot({ path: info.outputPath('muster-terminal.png'), fullPage: true });
});

test('E237: Kursvorhersage in der Muster-Tafel, Alarm-Felder im Formular, Alarm und gestrichelte Prognose im Terminal', async ({ page }, info) => {
  const u = uebersicht();
  const anfragen: { methode: string; pfad: string; body: unknown }[] = [];
  await page.route('**/api/krypto**', async (r) => {
    const url = new URL(r.request().url());
    anfragen.push({ methode: r.request().method(), pfad: url.pathname, body: r.request().postDataJSON() });
    if (url.pathname === '/api/krypto') return r.fulfill({ json: u });
    if (url.pathname === '/api/krypto/muster') return r.fulfill({ json: muster() });
    if (url.pathname.endsWith('/terminal')) return r.fulfill({ json: terminal() });
    if (url.pathname === '/api/krypto/bots' && r.request().method() === 'POST') return r.fulfill({ json: u.bots[0] });
    return r.fulfill({ json: { ok: true } });
  });
  await anmelden(page);
  await page.goto('/gebaeude/Hafen');
  const tafel = page.getByTestId('muster-tafel');
  // übrige Modelle bleiben in der Tabelle, die 6 Horizonte stehen kompakt darunter
  await expect(tafel.getByTestId('muster-modelle').locator('tbody tr')).toHaveCount(5);
  const kv = tafel.getByTestId('kursvorhersage');
  await expect(kv.getByRole('heading', { name: '📈 Kursvorhersage' })).toBeVisible();
  await expect(kv).toContainText('verpasster Absturz zählt 3× – die Vorhersage ist bewusst vorsichtig');
  await expect(kv.locator('tbody tr')).toHaveCount(6);
  await expect(kv.locator('tbody tr td:first-child')).toHaveText([/5 s/, /15 s/, /30 s/, /1 min/, /2 min/, /5 min/]);
  await expect(kv.locator('.hafen-punkt.an')).toHaveCount(4);
  const m1 = kv.locator('tr[data-schluessel="verlauf1m"]');
  await expect(m1).toContainText('±9,8 vs. ±11,9');
  await expect(m1).toContainText('64 %');
  await expect(m1).toContainText('9/18 · 27/40');
  await expect(kv.locator('tr[data-schluessel="verlauf15s"]')).toContainText('– · –');
  await expect(kv.locator('tr[data-schluessel="verlauf2m"]')).toHaveAttribute('title', /Token-Bootstrap/);
  // Formular: Alarm-Schwellen bei Regeln (unter dem Muster-Gewicht) und bei RL – Wert im POST
  await page.getByRole('button', { name: '+ Neuer Bot' }).click();
  const form = page.getByRole('region', { name: 'Neuer Bot' });
  await expect(form.getByLabel('🚀 Alarm ab +% (2 min)')).toHaveValue('15');
  await expect(form.getByLabel('💥 Alarm ab −% (2 min)')).toHaveValue('10');
  await expect(form).toContainText('nur mit Muster-Rat Gewicht > 0');
  await form.getByLabel('Muster-Rat Gewicht (0 = nur anzeigen)').fill('5');
  await form.getByLabel('🚀 Alarm ab +% (2 min)').fill('20');
  await form.getByLabel('💥 Alarm ab −% (2 min)').fill('8');
  await form.getByLabel('Strategie').selectOption('rl');
  await expect(form.getByLabel('🚀 Alarm ab +% (2 min)')).toHaveValue('20');
  await expect(form).toContainText('Alarme wirken bei RL-Bots immer.');
  await form.getByLabel('Strategie').selectOption('regeln');
  await form.getByRole('button', { name: 'Bot anlegen (Paper)' }).click();
  await expect(form).toBeHidden();
  const neu = anfragen.find((a) => a.pfad === '/api/krypto/bots' && a.methode === 'POST')!.body as { einstellung: { art: string; regeln: { musterGewicht: number; alarm: unknown } } };
  expect(neu.einstellung.art).toBe('regeln');
  expect(neu.einstellung.regeln.musterGewicht).toBe(5);
  expect(neu.einstellung.regeln.alarm).toEqual({ anstiegProzent: 20, fallProzent: 8 });
  if (info.project.name === 'handy') {
    const breit = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(breit).toBeLessThanOrEqual(1);
  }
  // Terminal: Mini-Vorhersage je Token (nur aktive Horizonte) + Alarm-Abzeichen
  await page.goto(`/hafen/${BOT_ID}`);
  const rat = page.getByRole('region', { name: 'Muster-Rat' });
  const mooncat = rat.getByRole('listitem').filter({ hasText: 'MOONCAT' });
  await expect(mooncat.getByTestId('muster-verlauf')).toHaveText('📈 5 s +1 % · 30 s +4 % · 1 min +9 % · 5 min −3 %');
  await expect(mooncat.getByTestId('muster-alarm')).toHaveText('🚀 ALARM');
  await expect(mooncat.getByTestId('muster-alarm')).toHaveClass(/anstieg/);
  const sadcat = rat.getByRole('listitem').filter({ hasText: 'SADCAT' });
  await expect(sadcat.getByTestId('muster-alarm')).toHaveText('💥 ALARM');
  await expect(sadcat.getByTestId('muster-alarm')).toHaveClass(/absturz/);
  await expect(sadcat.getByTestId('muster-verlauf')).toContainText('1 min −19 %');
  // Echtzeit-Kerzen: gestrichelte Prognose rechts an den Kerzen, Alarm am Token
  const echt = page.getByRole('region', { name: 'Echtzeit-Kurse' });
  const bild = echt.getByRole('img', { name: /MOONCAT: 60 Kerzen/ });
  await expect(bild).toHaveAttribute('aria-label', /Vorhersage/);
  const prognose = bild.getByTestId('prognose');
  await expect(prognose.locator('polyline')).toHaveAttribute('stroke-dasharray', '4 3');
  await expect(prognose.locator('circle')).toHaveCount(4);
  const xs = await prognose.locator('circle').evaluateAll((k) => k.map((c) => Number(c.getAttribute('cx'))));
  const kerzenRechts = await bild.locator('rect').evaluateAll((k) => Math.max(...k.map((r) => Number(r.getAttribute('x')) + Number(r.getAttribute('width')))));
  expect(xs.every((x, i) => x > kerzenRechts && (i === 0 || x > xs[i - 1]!))).toBe(true);
  expect(xs.at(-1)!).toBeGreaterThan(300);
  await expect(echt.getByTestId('muster-alarm')).toHaveText('🚀 ALARM');
  await page.screenshot({ path: info.outputPath('e237-terminal.png'), fullPage: true });
});

test('E236: Muster-Rat auch ohne Grundsignal (nur Absturz-Erkenner)', async ({ page }) => {
  await page.route('**/api/krypto/bots/*/terminal**', (r) =>
    r.fulfill({ json: { ...terminal(), musterRat: [{ mint: 'c', symbol: 'RUGCAT', wahrscheinlichkeit: null, rat: 'halten', zeit: Date.now(), pump: null, absturz: 0.4, ausblick: null, frueh: false }] } }),
  );
  await anmelden(page);
  await page.goto(`/hafen/${BOT_ID}`);
  const rat = page.getByRole('region', { name: 'Muster-Rat' });
  await expect(rat).toContainText('RUGCAT');
  await expect(rat).toContainText('💥 40 %');
  await expect(rat).not.toContainText(/p \d+ %/);
  await expect(rat.locator('.kw-rat.halten')).toHaveText('HALTEN');
});

test('E235: Terminal ohne aktives Modell sagt es', async ({ page }) => {
  await page.route('**/api/krypto/bots/*/terminal**', (r) => r.fulfill({ json: { ...terminal(), musterRat: [] } }));
  await anmelden(page);
  await page.goto(`/hafen/${BOT_ID}`);
  await expect(page.getByRole('region', { name: 'Muster-Rat' })).toContainText('kein aktives Modell');
  await expect(page.getByRole('region', { name: 'PnL' })).toBeVisible();
});
