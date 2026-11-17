import { expect, test, type Page } from '@playwright/test';

const PW = 'e2e-Passwort-sehr-lang-1';

async function anmelden(page: Page) {
  await page.goto('/');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByRole('heading', { name: 'Dorfplatz' })).toBeVisible();
}

test('falsches Passwort wird abgelehnt, richtiges führt ins Dorf', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Passwort').fill('ganz-falsch');
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByText('Passwort falsch.')).toBeVisible();
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  for (const g of ['Rathaus', 'Uni', 'Post', 'Marktplatz', 'Bibliothek', 'Corpshaus', 'Bank', 'Börse', 'Einkaufsladen']) {
    await expect(page.locator('.gebaeude-karte', { hasText: g }).first()).toBeVisible();
  }
  await expect(page.locator('.live.verbunden')).toBeVisible();
});

test('Gebäude öffnen zeigt die Arbeitsanweisung', async ({ page }) => {
  await anmelden(page);
  await page.locator('.gebaeude-karte', { hasText: 'Uni' }).click();
  await page.getByRole('button', { name: 'Übersicht' }).click();
  await expect(page.getByRole('heading', { name: /Uni – Arbeitsanweisung/ })).toBeVisible();
  await page.getByRole('button', { name: 'Dateien' }).click();
  await expect(page.getByRole('button', { name: /faecher/ })).toBeVisible();
});

test('Notiz anlegen, bearbeiten, Wikilink folgen, suchen', async ({ page }, info) => {
  const name = `Testnotiz ${info.project.name}`;
  await anmelden(page);
  await page.goto('/bibliothek?pfad=Uni');
  if (info.project.name === 'handy') await page.getByRole('button', { name: '☰ Dateien' }).click();
  page.once('dialog', (d) => d.accept(name));
  await page.getByRole('button', { name: '+ Notiz' }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(`Eigenwertproblem ${info.project.name}\n\nSiehe [[stadtordnung]].`);
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Gespeichert.')).toBeVisible();
  await page.getByRole('button', { name: 'Fertig' }).click();
  await page.getByRole('link', { name: 'stadtordnung' }).click();
  await expect(page.getByRole('heading', { name: 'Stadtordnung', exact: true })).toBeVisible();

  await page.goto(`/bibliothek?q=${encodeURIComponent(`eigenwert ${info.project.name}`)}`);
  await expect(page.getByRole('link', { name })).toBeVisible();
});

test('Änderungen erscheinen live auf einem zweiten Gerät', async ({ browser }, info) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await anmelden(a);
  await anmelden(b);
  const pfad = `Rathaus/schreibtisch/live-${info.project.name}.md`;
  // Gerät A legt die Datei an
  await a.evaluate(
    (p) => fetch('/api/vault/datei', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pfad: p, inhalt: 'Erste Fassung' }) }),
    pfad,
  );
  await b.goto(`/bibliothek?pfad=${encodeURIComponent(pfad)}`);
  await expect(b.getByText('Erste Fassung')).toBeVisible();
  // Gerät A ändert – Gerät B sieht es ohne Neuladen
  await a.evaluate(
    (p) => fetch('/api/vault/datei', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pfad: p, inhalt: 'Zweite Fassung' }) }),
    pfad,
  );
  await expect(b.getByText('Zweite Fassung')).toBeVisible({ timeout: 10_000 });
});

test('Einstellungen zeigen angemeldete Geräte; Abmelden wirkt', async ({ page }) => {
  await anmelden(page);
  await page.goto('/einstellungen');
  await expect(page.getByText('dieses Gerät')).toBeVisible();
  await page.getByRole('button', { name: 'Auf diesem Gerät abmelden' }).click();
  await expect(page.getByRole('button', { name: 'Ins Dorf' })).toBeVisible();
});

test('Aktion starten, Chat live, fortsetzen, Freigabe annehmen, Verbrauch', async ({ page }, info) => {
  await anmelden(page);
  await page.goto('/gebaeude/Rathaus?reiter=aktionen');
  await page.getByRole('button', { name: /Frage stellen/ }).click();
  const ziel = `Rathaus/schreibtisch/2026-11-16_1200_e2e-${info.project.name}.md`;
  await page.getByLabel(/Deine Frage/).fill(`Lege bitte etwas ab [schreibe ${ziel}] und beantrage [freigabe ${ziel}]`);
  await page.getByRole('button', { name: 'Starten' }).click();
  await expect(page).toHaveURL(/\/chats\//);
  await expect(page.getByText(/Erledigt\. \(claude-code, claude-opus-5-5/)).toBeVisible();
  await expect(page.getByText(/Lauf 1: fertig/)).toBeVisible();

  await page.getByPlaceholder('Weiter im Gespräch …').fill('Und noch etwas?');
  await page.getByRole('button', { name: 'Senden' }).click();
  await expect(page.getByText(/Lauf 2: fertig/)).toBeVisible();

  // Freigabe im Kopf und im Rathaus
  await page.locator('.abzeichen.brief').click();
  await expect(page.getByRole('heading', { name: `${ziel} löschen` })).toBeVisible();
  await page.getByRole('button', { name: 'Ja, ausführen' }).first().click();
  await expect(page.getByText('Nichts offen.')).toBeVisible();

  await page.getByRole('button', { name: 'Verbrauch' }).click();
  await expect(page.locator('table.tabelle').first()).toContainText('2');
  await page.getByRole('button', { name: 'Agenten-Einstellungen' }).click();
  await expect(page.getByLabel('Modell gross')).toHaveValue('claude-fable-5-2');
});

test('Schreibtisch: Aufgabe hinlegen, Plan freigeben, Helfer arbeiten, Aufgabe erledigt', async ({ page }, info) => {
  await anmelden(page);
  await page.goto('/gebaeude/Rathaus');
  await expect(page.getByRole('button', { name: 'Schreibtisch', exact: true })).toHaveClass(/aktiv/);
  const titel = `Projekt ${info.project.name}`;
  await page.getByLabel('Neue Aufgabe für den Bürgermeister').fill(`${titel} [plan Bibliothek|Übersicht; Uni|Lernplan]`);
  await page.getByRole('button', { name: 'Auf den Schreibtisch' }).click();
  const zeile = page.locator('.chatliste li', { hasText: titel });
  await expect(zeile.getByText('Plan wartet auf dich')).toBeVisible();

  await page.getByRole('button', { name: 'Freigaben', exact: true }).click();
  const karte = page.locator('.freigabe', { hasText: 'Testplan' }).first();
  await expect(karte.getByRole('cell', { name: 'Lernplan' })).toBeVisible();
  await karte.getByRole('button', { name: 'Ja, ausführen' }).click();

  await page.getByRole('button', { name: 'Pläne', exact: true }).click();
  await expect(page.locator('.karte.innen', { hasText: 'Testplan' }).first().getByText('fertig').first()).toBeVisible();
  await page.getByRole('button', { name: 'Schreibtisch', exact: true }).click();
  await expect(zeile.getByText('erledigt')).toBeVisible();
  await zeile.getByRole('link').first().click();
  await expect(page.getByText('Alle Helfer sind fertig')).toBeVisible();
  await page.getByRole('link', { name: 'Helfer: Lernplan' }).click();
  await expect(page.getByRole('link', { name: 'Bürgermeisters', exact: true })).toBeVisible();
});

test('Uni: Fristen und Pflichttermine aus Google, abhaken, Fach anlegen', async ({ page }, info) => {
  await anmelden(page);
  await page.locator('.gebaeude-karte', { hasText: 'Uni' }).click();
  // „Studium“ ist der erste Reiter der Uni
  await expect(page.getByRole('heading', { name: 'Fristen und Pflichttermine' })).toBeVisible();
  await expect(page.getByText(/Fristen aus „Moodle-Fristen \(automatisch\)“ · Pflichttermine aus „JKU Pflicht“/)).toBeVisible();
  await page.getByRole('button', { name: /Jetzt abgleichen|Abgleich läuft/ }).click();
  const fristen = page.locator('table.fristen');
  await expect(fristen).toContainText('Übung 1 ist fällig', { timeout: 20_000 });
  await expect(fristen).toContainText('Zwischentest');
  await expect(fristen).not.toContainText('Übung 0'); // vorbei
  await expect(fristen).not.toContainText('Zahnarzt'); // privat, ohne „Pflicht:“
  const vorlesung = fristen.locator('tr', { hasText: 'Mathe III UE' });
  await expect(vorlesung).toHaveClass(/laeuft/);
  await expect(vorlesung).toContainText('läuft gerade');
  await expect(vorlesung.getByLabel('erledigt')).toHaveCount(0); // Vorlesungen hakt man nicht ab
  await expect(fristen.locator('tr.dringend', { hasText: 'Übung 1' })).toBeVisible(); // Frist in weniger als 3 Tagen
  await expect(fristen.locator('tr', { hasText: 'Übung 2' })).not.toHaveClass(/dringend/);
  await expect(page.getByText(/Letzter Abgleich: .* neue (Frist|Fristen)\./)).toBeVisible();

  // Abhaken (und für den nächsten Testlauf wieder zurück)
  const zeile = fristen.locator('tr', { hasText: 'Übung 2' });
  await zeile.getByLabel('erledigt').check();
  await expect(zeile).toHaveClass(/erledigt/);
  await zeile.getByLabel('erledigt').uncheck();
  await expect(zeile).not.toHaveClass(/erledigt/);

  const fach = `Fach ${info.project.name}`;
  await page.getByLabel('Neues Fach').fill(fach);
  await page.getByRole('button', { name: 'Fach anlegen' }).click();
  await page.locator('.uni .ordnerliste').getByRole('link', { name: fach }).click();
  await expect(page).toHaveURL(new RegExp(`bibliothek\\?pfad=Uni%2Ffaecher%2FFach%20${info.project.name}`));
  await expect(page.getByRole('link', { name: /aufgaben/ })).toBeVisible();
});

test('Uni: „Lernen“ und „Abgabe bearbeiten“ bieten Leifs Ordner an', async ({ page }, info) => {
  await anmelden(page);
  const h = { origin: 'http://127.0.0.1:3999' };
  const fach = `Lernfach ${info.project.name}`;
  await page.request.post('/api/uni/fach', { headers: h, data: { name: fach } });
  await page.request.put('/api/vault/datei', { headers: h, data: { pfad: `Uni/faecher/${fach}/aufgaben/Blatt 3/Blatt3.pdf`, inhalt: '%PDF' } });
  await page.request.put('/api/vault/datei', { headers: h, data: { pfad: `Uni/faecher/${fach}/aufgaben/erledigt/Blatt1.pdf`, inhalt: '%PDF' } });

  await page.goto('/gebaeude/Uni?reiter=aktionen');
  await page.getByRole('button', { name: /^Lernen/ }).click();
  const auswahl = page.getByLabel(/Fach/);
  await expect(auswahl.locator('option', { hasText: fach })).toHaveCount(1);
  await auswahl.selectOption({ label: fach });
  await page.getByRole('button', { name: 'Starten' }).click();
  await expect(page).toHaveURL(/\/chats\//);
  await expect(page.getByText(new RegExp(`Lernen: ${fach}`)).first()).toBeVisible();
  await expect(page.getByText(/Lauf 1: fertig/)).toBeVisible();

  await page.goto('/gebaeude/Uni?reiter=aktionen');
  await page.getByRole('button', { name: /^Abgabe bearbeiten/ }).click();
  const abgabe = page.getByLabel(/Abgabe \(Ordner oder PDF/);
  await expect(abgabe.locator('option', { hasText: `Blatt 3 – ${fach}` })).toHaveCount(1);
  await expect(abgabe.locator('option', { hasText: 'Blatt1' })).toHaveCount(0); // erledigt/
});

test('HTML-Seite aus dem Vault: Skript läuft, App, Speicher und Netz sind abgeschottet', async ({ page }, info) => {
  await anmelden(page);
  const pfad = `Uni/abschottung-${info.project.name}.html`;
  const html = `<!doctype html><html><body>
<p id="a">wartet</p><p id="b"></p><p id="c"></p><p id="d"></p>
<script>
const s = (id, t) => (document.getElementById(id).textContent = t);
s('a', 'Skript läuft');
try { parent.document.title; s('b', 'App erreichbar!'); } catch (e) { s('b', 'App blockiert'); }
try { localStorage.getItem('x'); s('c', 'Speicher offen!'); } catch (e) { s('c', 'Speicher blockiert'); }
fetch('/api/ich').then(() => s('d', 'Netz offen!'), () => s('d', 'Netz blockiert'));
</script></body></html>`;
  const r = await page.request.put('/api/vault/datei', { headers: { origin: 'http://127.0.0.1:3999' }, data: { pfad, inhalt: html } });
  expect(r.ok()).toBe(true);
  await page.goto(`/bibliothek?pfad=${encodeURIComponent(pfad)}`);
  const rahmen = page.frameLocator('iframe.html-rahmen');
  await expect(rahmen.locator('#a')).toHaveText('Skript läuft');
  await expect(rahmen.locator('#b')).toHaveText('App blockiert');
  await expect(rahmen.locator('#c')).toHaveText('Speicher blockiert');
  await expect(rahmen.locator('#d')).toHaveText('Netz blockiert');
  await expect(page.getByRole('link', { name: 'Vollbild' })).toHaveAttribute('target', '_blank');
});

test('Etappe 4: Morgenzeitung drucken, Bürgermeister wecken, Post ohne Gmail', async ({ page }) => {
  await anmelden(page);
  await page.goto('/gebaeude/Rathaus?reiter=morgenzeitung');
  await page.getByRole('button', { name: /Jetzt neu erstellen/ }).click();
  await expect(page.getByRole('heading', { name: /Morgenzeitung –/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fristen (7 Tage)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Wartet auf dich' })).toBeVisible();
  await expect(page.getByText(/Erscheint jeden Morgen um 06:30/)).toBeVisible();

  await page.goto('/gebaeude/Rathaus?reiter=schreibtisch');
  await expect(page.getByText(/wacht von selbst auf/)).toBeVisible();
  await page.getByRole('button', { name: 'Jetzt aufwachen' }).click();
  await expect(page.getByText(/^Aufgewacht:|Aufgewacht:/).first()).toBeVisible();

  await page.goto('/gebaeude/Post');
  await expect(page.getByText(/Gmail ist noch nicht verbunden/)).toBeVisible();
  await expect(page.getByText('dorf gmail-anmelden')).toBeVisible();
});
