import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * E205 – VS Code in der App (eingebettet, eigener Ursprung) und Erweiterungen aus Open VSX.
 * Gegen e2e/coding-attrappe.mjs: Zielseite des Eintritts (Code-Adresse = anderer Port = anderer Ursprung), nachgebautes
 * Open VSX mit echten Antworten, und der ECHTE Runner im Profil coding mit nachgebautem openvscode-server.
 */
const CODING = `http://127.0.0.1:${process.env.E2E_CODING_PORT ?? Number(process.env.E2E_MOODLE_PORT ?? 3998) - 2}`;
const PW = 'e2e-Passwort-sehr-lang-1';
const BASIS = `http://127.0.0.1:${process.env.E2E_PORT ?? 3999}`;

async function anmelden(page: Page) {
  await page.addInitScript(() => localStorage.setItem('dorf-ansicht', 'liste'));
  await page.goto('/');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByRole('heading', { name: 'Dorfplatz' })).toBeVisible();
}

/** Beide Projekte (Desktop, Handy) laufen nacheinander gegen denselben Server – vorher aufräumen */
async function erweiterungenLeeren(page: Page) {
  const r = await page.request.get('/api/coding/erweiterungen');
  for (const e of ((await r.json()) as { erweiterungen: { id: string }[] }).erweiterungen)
    await page.request.post('/api/coding/erweiterungen/entfernen', { data: { id: e.id }, headers: { origin: BASIS } });
}

test('VS Code in der App: eingebettet über die Einmal-Karte, eigener Ursprung, Rahmen ohne Rechte über die App', async ({ page, request }) => {
  await request.post(`${CODING}/_test/projekte`, { data: [{ name: 'spielwiese', git: true, geaendert: Date.now() }] });
  await anmelden(page);
  // Einstieg: Codehaus → Reiter „VS Code“
  await page.goto('/gebaeude/Codehaus?reiter=vscode');
  await expect(page.getByRole('button', { name: 'VS Code', exact: true })).toHaveClass(/aktiv/);
  await page.getByTestId('vscode-seite-oeffnen').click();
  await expect(page).toHaveURL(/\/codehaus\/vscode$/);

  const rahmen = page.getByTestId('vscode-rahmen');
  await expect(rahmen).toBeVisible();
  // geladen wird genau die Einmal-Adresse des Code-Hosts (anderer Ursprung als die App)
  const src = (await rahmen.getAttribute('src'))!;
  expect(src.startsWith(`${CODING}/_dorf/eintritt?karte=`)).toBe(true);
  expect(new URL(src).origin).not.toBe(new URL(page.url()).origin);
  expect(new URL(src).searchParams.get('karte')!.length).toBeGreaterThanOrEqual(40);
  // weder das VS-Code-Token noch die Sitzung stehen in der Adresse
  expect(src).not.toContain('e2e-vscode-token');
  const innen = page.frameLocator('[data-testid="vscode-rahmen"]');
  await expect(innen.getByRole('heading', { name: 'VS Code (Attrappe)' })).toBeVisible();
  await expect(innen.locator('#projekt')).toHaveText('');

  // Rechte des Rahmens: Skripte und sein eigener Ursprung ja – die App wegleiten nie
  const rechte = ((await rahmen.getAttribute('sandbox')) ?? '').split(' ');
  expect(rechte).toContain('allow-scripts');
  expect(rechte).toContain('allow-same-origin');
  expect(rechte).not.toContain('allow-top-navigation');
  expect(rechte).not.toContain('allow-top-navigation-by-user-activation');
  expect(await rahmen.getAttribute('allow')).toContain('clipboard-write');
  expect(await rahmen.getAttribute('referrerpolicy')).toBe('no-referrer');
  // die App füllt den Platz unter der Kopfleiste
  const kasten = (await rahmen.boundingBox())!;
  const fenster = page.viewportSize()!;
  expect(kasten.width).toBeGreaterThan(fenster.width * 0.9);
  expect(kasten.height).toBeGreaterThan(fenster.height * 0.6);

  // Projekt wählen: neuer Rahmen mit neuer Karte, der Ordner reist mit
  await page.getByLabel('Projektordner').selectOption('spielwiese');
  await expect(page).toHaveURL(/\/codehaus\/vscode\?projekt=spielwiese$/);
  await expect(innen.locator('#projekt')).toHaveText('spielwiese');
  const src2 = (await rahmen.getAttribute('src'))!;
  expect(new URL(src2).searchParams.get('karte')).not.toBe(new URL(src).searchParams.get('karte'));

  // „Neu laden“ holt wieder eine frische Karte
  await page.getByTestId('vscode-neu-laden').click();
  await expect.poll(async () => rahmen.getAttribute('src')).not.toBe(src2);
  await expect(innen.locator('#projekt')).toHaveText('spielwiese');

  // Ausweg bleibt: in neuem Tab öffnen
  const [tab] = await Promise.all([page.context().waitForEvent('page'), page.getByTestId('vscode-neuer-tab').click()]);
  await tab.waitForURL((u) => u.href.startsWith(`${CODING}/_dorf/eintritt?karte=`));
  await tab.close();
});

test('VS Code in der App: Inhalt im Rahmen kann die Dorf-App nicht wegleiten und nicht auslesen', async ({ page, request }) => {
  await request.post(`${CODING}/_test/projekte`, { data: [{ name: 'ausbruch', git: false, geaendert: Date.now() }] });
  await anmelden(page);
  // die Attrappe versucht bei diesem Projekt top.location zu setzen
  await page.goto('/codehaus/vscode?projekt=ausbruch');
  const innen = page.frameLocator('[data-testid="vscode-rahmen"]');
  await expect(innen.locator('#ausbruch')).toHaveText('gesperrt');
  await page.waitForTimeout(300);
  expect(new URL(page.url()).pathname).toBe('/codehaus/vscode');
  await expect(page.getByTestId('vscode-seite')).toBeVisible();
  // aus dem Rahmen heraus ist die App nicht lesbar (anderer Ursprung), und die Dorf-API antwortet ihm nicht als Leif
  const frame = page.frames().find((f) => f.url().startsWith(CODING))!;
  expect(await frame.evaluate(() => {
    try {
      return window.parent.document.title;
    } catch {
      return 'kein Zugriff';
    }
  })).toBe('kein Zugriff');
  const status = await frame.evaluate(async (basis) => {
    try {
      const r = await fetch(`${basis}/api/coding/erweiterungen/installieren`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{"id":"boese.sache"}' });
      return r.status;
    } catch {
      return 'blockiert';
    }
  }, BASIS);
  // der Browser blockiert (CORS) – und käme die Anfrage an, lehnte das Dorf die fremde Herkunft ab (403)
  expect(['blockiert', 403]).toContain(status);
  const liste = (await (await page.request.get('/api/coding/erweiterungen')).json()) as { erweiterungen: { id: string }[] };
  expect(liste.erweiterungen.map((e) => e.id)).not.toContain('boese.sache');
  await request.post(`${CODING}/_test/projekte`, { data: [] });
});

test('VS Code in der App: unter den Kopfzeilen des echten Caddyfile – das Dorf darf die Code-Adresse einbetten, eine fremde Seite nicht', async ({ page, browser }) => {
  // Der Testserver hat kein Caddy davor: die Kopfzeilen aus deploy/Caddyfile werden hier an die Antworten gehängt
  const caddy = fs.readFileSync(path.resolve(import.meta.dirname, '../../../deploy/Caddyfile'), 'utf8');
  const dorfCsp = /\?Content-Security-Policy "([^"]+)"/
    .exec(caddy)![1]!
    .replace('wss://{$DORF_DOMAIN}', BASIS.replace('http', 'ws'))
    .replace('https://{$CODING_DOMAIN}', CODING);
  const codeCsp = /\+Content-Security-Policy "([^"]+)"/.exec(caddy)![1]!.replace('https://{$DORF_DOMAIN}', BASIS);
  expect(dorfCsp).toContain(`frame-src 'self' ${CODING};`);
  expect(dorfCsp).toContain("frame-ancestors 'none'");
  expect(codeCsp).toBe(`frame-ancestors 'self' ${BASIS}`);
  // im Abschnitt der Code-Adresse steht kein X-Frame-Options mehr, das das Dorf aussperrte
  expect(caddy.slice(caddy.indexOf('{$CODING_DOMAIN} {'))).not.toMatch(/^\s*\??X-Frame-Options "/m);
  const koepfe = async (p: Page) => {
    await p.route(
      (u) => u.origin === BASIS && !u.pathname.startsWith('/api/') && !u.pathname.startsWith('/assets/'),
      async (route) => {
        const antwort = await route.fetch();
        await route.fulfill({ response: antwort, headers: { ...antwort.headers(), 'content-security-policy': dorfCsp, 'x-frame-options': 'DENY' } });
      },
    );
    await p.route(
      (u) => u.origin === CODING && u.pathname.startsWith('/_dorf/'),
      async (route) => {
        const antwort = await route.fetch();
        await route.fulfill({ response: antwort, headers: { ...antwort.headers(), 'content-security-policy': codeCsp } });
      },
    );
  };
  await koepfe(page);
  const verstoesse: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) verstoesse.push(m.text());
  });
  await anmelden(page);
  await page.goto('/codehaus/vscode');
  await expect(page.frameLocator('[data-testid="vscode-rahmen"]').getByRole('heading', { name: 'VS Code (Attrappe)' })).toBeVisible();
  expect(verstoesse).toEqual([]);

  // Gegenprobe: eine fremde Seite (anderer Ursprung) bekommt die Code-Adresse mit derselben Kopfzeile nicht in einen Rahmen …
  const { url } = (await (await page.request.get('/api/coding/oeffnen?json=1')).json()) as { url: string };
  const fremd = await browser.newPage();
  await koepfe(fremd);
  const gesperrt: string[] = [];
  fremd.on('console', (m) => {
    if (/frame-ancestors|Refused to (frame|display)/i.test(m.text())) gesperrt.push(m.text());
  });
  await fremd.route('http://fremd.test/**', (route) => route.fulfill({ contentType: 'text/html', body: `<title>fremd</title><iframe id="r" src="${url}"></iframe><iframe id="d" src="${BASIS}/"></iframe>` }));
  await fremd.goto('http://fremd.test/');
  await expect.poll(() => gesperrt.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  expect(fremd.frames().some((f) => f.url().startsWith(`${CODING}/_dorf/`))).toBe(false);
  // … und die Dorf-App selbst auch nicht
  expect(fremd.frames().some((f) => f.url().startsWith(BASIS))).toBe(false);
  await fremd.close();
});

test('Erweiterungen: in Open VSX suchen, installieren, entfernen, VSIX hochladen', async ({ page }) => {
  await anmelden(page);
  await erweiterungenLeeren(page);
  await page.goto('/gebaeude/Codehaus?reiter=vscode');
  const feld = page.getByTestId('erweiterungen');
  await expect(feld).toBeVisible();
  // Hinweise: voller Zugriff, wirkt nur im VS Code, Microsoft-eigene gibt es nicht
  await expect(feld.getByRole('note')).toContainText('vollem Zugriff im Codehaus');
  await expect(feld).toContainText('nicht im schlanken Editor');
  await expect(feld).toContainText('Pylance');
  await expect(feld.getByTestId('erw-installiert-reiter')).toHaveText('Installiert (0)');

  await feld.getByLabel('Erweiterung suchen').fill('prettier');
  await feld.getByRole('button', { name: 'Suchen', exact: true }).click();
  const treffer = feld.getByTestId('erw-treffer').locator('li');
  await expect(treffer).toHaveCount(10);
  const erster = treffer.first();
  await expect(erster).toContainText('Prettier - Code formatter');
  await expect(erster).toContainText('esbenp');
  await expect(erster).toContainText('Code formatter using prettier');
  await expect(erster.locator('.abzeichen', { hasText: 'verifiziert' })).toBeVisible();
  await expect(erster).toContainText('Lizenz: MIT');
  await expect(erster).toContainText('10 Mio.');
  await expect(erster.getByRole('link', { name: 'bei Open VSX' })).toHaveAttribute('href', 'https://open-vsx.org/extension/esbenp/prettier-vscode');
  await expect(erster.getByRole('link', { name: 'bei Open VSX' })).toHaveAttribute('rel', /noopener/);
  // ohne Lizenzangabe steht das da
  await expect(treffer.filter({ hasText: 'Catspeak' })).toContainText('Lizenz: nicht angegeben');
  await expect(feld.getByRole('button', { name: /Mehr laden \(10 von 63\)/ })).toBeVisible();

  // Installieren (ein Klick bei verifiziertem Herausgeber)
  await erster.getByRole('button', { name: 'Installieren' }).click();
  await expect(feld.getByTestId('erw-meldung')).toContainText('„Prettier - Code formatter“ ist installiert.');
  await expect(erster.locator('.abzeichen.gut')).toHaveText('installiert 9.9.9');
  await expect(feld.getByTestId('erw-installiert-reiter')).toHaveText('Installiert (1)');

  // Reiter „Installiert“: Liste, VSIX hochladen, Entfernen mit Rückfrage
  await feld.getByTestId('erw-installiert-reiter').click();
  const da = feld.getByTestId('erw-installiert').locator('li');
  await expect(da).toHaveCount(1);
  await expect(da.first()).toContainText('esbenp.prettier-vscode');
  await feld.getByTestId('erw-vsix').setInputFiles({ name: 'kein.vsix', mimeType: 'application/octet-stream', buffer: Buffer.from('das ist kein Archiv') });
  await expect(feld.getByTestId('erw-meldung')).toContainText('keine VSIX-Datei');
  await expect(da).toHaveCount(1);
  await feld.getByTestId('erw-vsix').setInputFiles({ name: 'meine.vsix', mimeType: 'application/octet-stream', buffer: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(3000, 1)]) });
  await expect(feld.getByTestId('erw-meldung')).toContainText('„meine.vsix“ ist installiert.');
  await expect(da).toHaveCount(2);
  await expect(da.filter({ hasText: 'lokal.aus-vsix' })).toBeVisible();

  const zeile = da.filter({ hasText: 'esbenp.prettier-vscode' });
  await zeile.getByRole('button', { name: 'Entfernen' }).click();
  // erster Klick fragt nur nach
  await expect(zeile.getByRole('button', { name: 'Wirklich entfernen?' })).toBeVisible();
  await expect(da).toHaveCount(2);
  await zeile.getByRole('button', { name: 'Wirklich entfernen?' }).click();
  await expect(feld.getByTestId('erw-meldung')).toContainText('ist entfernt');
  await expect(da).toHaveCount(1);

  // Suche ohne Treffer
  await feld.getByRole('tab', { name: 'Suchen' }).click();
  await feld.getByLabel('Erweiterung suchen').fill('gibtsnicht');
  await feld.getByRole('button', { name: 'Suchen', exact: true }).click();
  await expect(feld).toContainText('Nichts gefunden.');
  await erweiterungenLeeren(page);
});

test('Erweiterungen neben VS Code: Panel auf der VS-Code-Seite, nach dem Installieren wird „Neu laden“ hervorgehoben', async ({ page }) => {
  await anmelden(page);
  await erweiterungenLeeren(page);
  await page.goto('/codehaus/vscode');
  await expect(page.frameLocator('[data-testid="vscode-rahmen"]').getByRole('heading', { name: 'VS Code (Attrappe)' })).toBeVisible();
  await expect(page.getByTestId('erweiterungen')).toHaveCount(0);
  await page.getByTestId('erweiterungen-knopf').click();
  const feld = page.getByTestId('erweiterungen');
  await expect(feld).toBeVisible();
  await feld.getByLabel('Erweiterung suchen').fill('prettier');
  await feld.getByLabel('Erweiterung suchen').press('Enter');
  const erster = feld.getByTestId('erw-treffer').locator('li').first();
  await erster.getByRole('button', { name: 'Installieren' }).click();
  await expect(erster.locator('.abzeichen.gut')).toHaveText('installiert 9.9.9');
  await expect(page.getByTestId('vscode-neu-laden')).toHaveClass(/vs-hinweis/);
  // VS Code läuft darunter weiter (der Rahmen wurde nicht neu aufgebaut)
  await expect(page.getByTestId('vscode-rahmen')).toHaveCount(1);
  await page.getByRole('button', { name: 'Erweiterungen schließen' }).click();
  await expect(page.getByTestId('erweiterungen')).toHaveCount(0);
  await expect(page.getByTestId('vscode-rahmen')).toBeVisible();
  await page.getByTestId('vscode-neu-laden').click();
  await expect(page.getByTestId('vscode-neu-laden')).not.toHaveClass(/vs-hinweis/);
  // direkter Einstieg mit offenem Panel
  await page.goto('/codehaus/vscode?erweiterungen=1');
  await expect(page.getByTestId('erweiterungen')).toBeVisible();
  await erweiterungenLeeren(page);
});

test('Erweiterungen (Review): Antwort ohne Liste stürzt nicht ab; ungewöhnliche Kennungen ohne „Entfernen“; jede Kennung nur einmal', async ({ page }) => {
  const fehler: string[] = [];
  page.on('pageerror', (e) => fehler.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /same key|unique "key"/i.test(m.text())) fehler.push(m.text());
  });
  let antwort: unknown = {};
  await page.route('**/api/coding/erweiterungen', (route) => route.fulfill({ json: antwort }));
  await anmelden(page);
  await page.goto('/gebaeude/Codehaus?reiter=vscode');
  const feld = page.getByTestId('erweiterungen');
  await expect(feld.getByTestId('erw-installiert-reiter')).toHaveText('Installiert (0)');
  await feld.getByTestId('erw-installiert-reiter').click();
  await expect(feld).toContainText('Noch keine Erweiterungen installiert');

  antwort = {
    erweiterungen: [
      { id: 'esbenp.prettier-vscode', version: '12.4.0' },
      { id: 'esbenp.prettier-vscode', version: '12.4.0' },
      { id: 'mit_unterstrich.name', version: '1.0.0' },
      { id: 'drei.teile.name', version: '2.0.0' },
    ],
  };
  await page.reload();
  await feld.getByTestId('erw-installiert-reiter').click();
  const da = feld.getByTestId('erw-installiert').locator('li');
  await expect(da).toHaveCount(3);
  await expect(feld.getByTestId('erw-installiert-reiter')).toHaveText('Installiert (3)');
  await expect(da.filter({ hasText: 'esbenp.prettier-vscode' }).getByRole('button', { name: 'Entfernen' })).toBeVisible();
  for (const id of ['mit_unterstrich.name', 'drei.teile.name']) {
    await expect(da.filter({ hasText: id }).getByRole('button')).toHaveCount(0);
    await expect(da.filter({ hasText: id })).toContainText('nur in VS Code selbst entfernbar');
  }
  expect(fehler).toEqual([]);
});

test('Erweiterungen und Karte: ohne Anmeldung nichts', async ({ request }) => {
  expect((await request.get('/api/coding/erweiterungen')).status()).toBe(401);
  expect((await request.get('/api/coding/erweiterungen/suche?q=prettier')).status()).toBe(401);
  expect((await request.get('/%61pi/coding/erweiterungen/suche?q=prettier')).status()).toBe(401);
  for (const weg of ['installieren', 'entfernen']) expect((await request.post(`/api/coding/erweiterungen/${weg}`, { data: { id: 'esbenp.prettier-vscode' }, headers: { origin: BASIS } })).status()).toBe(401);
  expect((await request.post('/api/coding/erweiterungen/vsix', { data: Buffer.from('PK\u0003\u0004'), headers: { origin: BASIS, 'content-type': 'application/octet-stream' } })).status()).toBe(401);
});
