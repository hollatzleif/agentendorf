import { expect, test, type Page } from '@playwright/test';

/** Origin des Testservers (E2E_PORT wie in playwright.config.ts – so laufen auch zwei Testreihen nebeneinander) */
const ORIGIN = `http://127.0.0.1:${process.env.E2E_PORT ?? 3999}`;

const PW = 'e2e-Passwort-sehr-lang-1';

/** Anmelden; diese Tests brauchen das 3D-Dorf nicht (das prüft dorf3d.spec.ts) → Liste spart Rechenzeit */
async function anmelden(page: Page) {
  await page.addInitScript(() => localStorage.setItem('dorf-ansicht', 'liste'));
  await page.goto('/');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByTestId('dorf-leinwand').or(page.getByRole('heading', { name: 'Dorfplatz' }))).toBeVisible();
}

test('falsches Passwort wird abgelehnt, richtiges führt ins Dorf', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Passwort').fill('ganz-falsch');
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByText('Passwort falsch.')).toBeVisible();
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  // Startseite ist das 3D-Dorf; die Liste gibt es per Knopf (und sie bleibt gemerkt)
  await expect(page.getByTestId('dorf-leinwand')).toBeVisible();
  await page.getByRole('button', { name: 'Als Liste anzeigen' }).click();
  for (const g of ['Rathaus', 'Uni', 'Post', 'Marktplatz', 'Bibliothek', 'Corpshaus', 'Bank', 'Börse', 'Einkaufsladen']) {
    await expect(page.locator('.gebaeude-karte', { hasText: g }).first()).toBeVisible();
  }
  await expect(page.locator('.live.verbunden')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dorfplatz' })).toBeVisible();
  await page.getByRole('button', { name: /Zum Dorf/ }).click();
  await expect(page.getByTestId('dorf-leinwand')).toBeVisible();
});

test('Gebäude öffnen zeigt die Arbeitsanweisung', async ({ page }) => {
  await anmelden(page);
  await page.goto('/gebaeude/Uni');
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
  await a.context().close();
  await b.context().close();
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
  // in der CI teilt sich der Testserver die Maschine mit dem Browser – großzügig warten
  await expect(page.getByText(/Erledigt\. \(claude-code, claude-opus-5-5/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Lauf 1: fertig/)).toBeVisible({ timeout: 15_000 });

  await page.getByPlaceholder('Weiter im Gespräch …').fill('Und noch etwas?');
  await page.getByRole('button', { name: 'Senden' }).click();
  await expect(page.getByText(/Lauf 2: fertig/)).toBeVisible({ timeout: 15_000 });

  // Freigabe im Kopf, im Fenstertitel (und als Plakette am App-Symbol) und im Rathaus
  await expect(page).toHaveTitle(/^\(\d+\) Agentendorf$/);
  await page.locator('.abzeichen.brief').click();
  await expect(page.getByRole('heading', { name: `${ziel} löschen` })).toBeVisible();
  await page.locator('.freigabe', { hasText: `${ziel} löschen` }).getByRole('button', { name: 'Ja, ausführen' }).click();
  // nur die eigene Freigabe prüfen – ein Rest aus dem anderen Geräte-Durchlauf soll diesen Test nicht umwerfen
  await expect(page.getByRole('heading', { name: `${ziel} löschen` })).toBeHidden();

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
  // Helfer laufen im Hintergrund (Attrappe) – auf der langsameren CI kann das ein paar Sekunden dauern
  await expect(page.locator('.karte.innen', { hasText: 'Testplan' }).first().getByText('fertig').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Schreibtisch', exact: true }).click();
  await expect(zeile.getByText('erledigt')).toBeVisible({ timeout: 20_000 });
  await zeile.getByRole('link').first().click();
  await expect(page.getByText('Alle Helfer sind fertig')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: 'Helfer: Lernplan' }).click();
  await expect(page.getByRole('link', { name: 'Bürgermeisters', exact: true })).toBeVisible();
});

test('Uni: Fristen und Pflichttermine aus Google, abhaken, Fach anlegen', async ({ page }, info) => {
  await anmelden(page);
  await page.goto('/gebaeude/Uni');
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
  await page.getByRole('region', { name: `Fach ${fach}` }).getByRole('link', { name: fach }).click();
  await expect(page).toHaveURL(new RegExp(`bibliothek\\?pfad=Uni%2Ffaecher%2FFach%20${info.project.name}`));
  await expect(page.getByRole('link', { name: /aufgaben/ })).toBeVisible();
});

test('Uni: „Lernen“ und „Abgabe bearbeiten“ bieten Leifs Ordner an', async ({ page }, info) => {
  await anmelden(page);
  const h = { origin: ORIGIN };
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
  const r = await page.request.put('/api/vault/datei', { headers: { origin: ORIGIN }, data: { pfad, inhalt: html } });
  expect(r.ok()).toBe(true);
  await page.goto(`/bibliothek?pfad=${encodeURIComponent(pfad)}`);
  const rahmen = page.frameLocator('iframe.html-rahmen');
  await expect(rahmen.locator('#a')).toHaveText('Skript läuft');
  await expect(rahmen.locator('#b')).toHaveText('App blockiert');
  await expect(rahmen.locator('#c')).toHaveText('Speicher blockiert');
  await expect(rahmen.locator('#d')).toHaveText('Netz blockiert');
  await expect(page.getByRole('link', { name: 'Vollbild' })).toHaveAttribute('target', '_blank');
});

test('Häkchen-Brücke: eine abgeschottete Seite speichert ihren Stand im Dorf (bleibt nach dem Neuladen)', async ({ page }, info) => {
  await anmelden(page);
  const pfad = `Bibliothek/haekchen-${info.project.name}.html`;
  const html = `<!doctype html><html><body>
<label><input type="checkbox" id="k1"> Blatt abgeben</label><p id="s">lädt</p>
<script>
const k = document.getElementById('k1');
window.addEventListener('message', (e) => {
  if (e.data && e.data.dorf === 'stand') { k.checked = !!(e.data.stand && e.data.stand.k1); document.getElementById('s').textContent = 'geladen'; }
});
k.addEventListener('change', () => parent.postMessage({ dorf: 'stand-speichern', stand: { k1: k.checked } }, '*'));
parent.postMessage({ dorf: 'stand-laden' }, '*');
</script></body></html>`;
  const origin = new URL(page.url()).origin;
  expect((await page.request.put('/api/vault/datei', { headers: { origin }, data: { pfad, inhalt: html } })).ok()).toBe(true);
  await page.goto(`/bibliothek?pfad=${encodeURIComponent(pfad)}`);
  const rahmen = page.frameLocator('iframe.html-rahmen');
  await expect(rahmen.locator('#s')).toHaveText('geladen');
  await expect(rahmen.locator('#k1')).not.toBeChecked();
  await rahmen.locator('#k1').check();
  await expect.poll(async () => ((await (await page.request.get(`/api/vault/seitenstand?pfad=${encodeURIComponent(pfad)}`)).json()) as { stand: unknown }).stand).toEqual({ k1: true });
  await page.reload();
  await expect(rahmen.locator('#s')).toHaveText('geladen');
  await expect(rahmen.locator('#k1')).toBeChecked();
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
  await expect(page.getByText(/rund um die Uhr wach/)).toBeVisible();
  await page.getByRole('button', { name: 'Jetzt aufwachen' }).click();
  await expect(page.getByText(/^Aufgewacht:|Aufgewacht:/).first()).toBeVisible();

  await page.goto('/gebaeude/Post');
  await expect(page.getByText(/Gmail ist noch nicht verbunden/)).toBeVisible();
  await expect(page.getByText('dorf gmail-anmelden')).toBeVisible();
});

test('Skill anlegen: Formular im Gebäude, Prüfen zeigt Fehler, angelegt erscheint er mit Zeitplan', async ({ page }, info) => {
  await anmelden(page);
  await page.goto('/gebaeude/Bibliothek?reiter=aktionen');
  await page.getByRole('button', { name: /\+ Neue Aktion/ }).click();
  const f = page.getByRole('form', { name: 'Neue Aktion' });
  const name = `Wochenplan ${info.project.name}`;
  await f.getByLabel('Name *').fill(name);
  await f.getByLabel('Anweisung an den Agenten *').fill('Lies meine Termine und schreib einen Wochenplan.');
  await f.getByLabel('Kalender lesen').check();
  await f.getByLabel('Zeitplan (optional)').fill('manchmal 07:00');
  await f.getByRole('button', { name: 'Prüfen' }).click();
  await expect(f.getByText(/„manchmal“ verstehe ich nicht/)).toBeVisible();
  await f.getByLabel('Zeitplan (optional)').fill('mo 07:00');
  await f.getByRole('button', { name: 'Prüfen' }).click();
  await expect(f.getByText(/fremdinhalte: ja/)).toBeVisible();
  await f.getByRole('button', { name: 'Aktion anlegen' }).click();
  await expect(f).toBeHidden();
  const knopf = page.locator('.aktion-knopf', { hasText: name });
  await expect(knopf).toContainText('⏰ mo 07:00');
  await expect(page.getByText(/Läuft von selbst: mo 07:00 – nächstes Mal/)).toBeVisible();
});

test('Marktplatz: To-do-Brett – anlegen, live auf zweitem Gerät, abhaken, bearbeiten, löschen', async ({ page, browser }, info) => {
  await anmelden(page);
  const zweit = await browser.newContext({ storageState: await page.context().storageState() });
  const p2 = await zweit.newPage();
  await p2.goto('/gebaeude/Marktplatz');
  await page.goto('/gebaeude/Marktplatz');
  await expect(page.getByRole('button', { name: 'To-do', exact: true })).toHaveClass(/aktiv/);
  const titel = `Plakat abgeben ${info.project.name}`;
  const form = page.getByRole('form', { name: 'Neues To-do' });
  await form.getByLabel('Neues To-do').fill(titel);
  await form.getByLabel('Fällig am').fill('2026-11-18');
  await form.getByRole('button', { name: '+' }).click();
  const zeile = page.locator('.todo', { hasText: titel });
  await expect(zeile).toBeVisible();
  // zweites Gerät sieht es ohne Neuladen
  await expect(p2.locator('.todo', { hasText: titel })).toBeVisible();
  await zeile.getByRole('checkbox').check();
  await expect(page.locator('.todo-liste:not(.erledigt) .todo', { hasText: titel })).toHaveCount(0);
  await expect(p2.locator('.todo-liste:not(.erledigt) .todo', { hasText: titel })).toHaveCount(0);
  await page.getByText(/^Erledigt \(/).click();
  const fertig = page.locator('.todo.fertig', { hasText: titel });
  await expect(fertig).toBeVisible();
  // wieder öffnen, umbenennen, löschen
  await fertig.getByRole('checkbox').uncheck();
  const offen = page.locator('.todo-liste:not(.erledigt) .todo', { hasText: titel });
  await expect(offen).toBeVisible();
  await offen.getByRole('button', { name: titel, exact: true }).click();
  await page.locator('.todo.bearbeiten').getByLabel('Titel').fill(`${titel} (neu)`);
  await page.locator('.todo.bearbeiten').getByRole('button', { name: 'Speichern' }).click();
  const neu = page.locator('.todo', { hasText: `${titel} (neu)` });
  await expect(neu).toBeVisible();
  await neu.getByRole('button', { name: `${titel} (neu)`, exact: true }).click();
  await page.locator('.todo.bearbeiten').getByRole('button', { name: 'Löschen' }).click();
  await expect(page.locator('.todo', { hasText: titel })).toHaveCount(0);
  await expect(p2.locator('.todo', { hasText: titel })).toHaveCount(0);
  await zweit.close();
});

test('Schnelleingabe (/schnell): Enter schickt an den Bürgermeister oder auf die To-do-Liste; Einstellungen zeigen Programme', async ({ page }, info) => {
  await anmelden(page);
  await page.goto('/schnell');
  const f = page.getByRole('form', { name: 'Schnelleingabe' });
  await expect(f.getByLabel('Text')).toBeFocused();
  await f.getByRole('radio', { name: /To-do/ }).click();
  await f.getByLabel('Text').fill(`Schnell-To-do ${info.project.name}`);
  await f.getByLabel('Text').press('Enter');
  await expect(f.getByText('✓ Auf der To-do-Liste')).toBeVisible();
  await f.getByRole('radio', { name: /Bürgermeister/ }).click();
  await f.getByLabel('Text').fill(`Schnell-Aufgabe ${info.project.name}`);
  await f.getByLabel('Text').press('Enter');
  await expect(f.getByText('✓ Beim Bürgermeister')).toBeVisible();
  await page.goto('/gebaeude/Marktplatz');
  await expect(page.locator('.todo', { hasText: `Schnell-To-do ${info.project.name}` })).toBeVisible();
  await page.goto('/gebaeude/Rathaus');
  await expect(page.getByText(`Schnell-Aufgabe ${info.project.name}`).first()).toBeVisible();
  await page.goto('/einstellungen');
  await expect(page.getByRole('heading', { name: 'Programme für Mac und Windows' })).toBeVisible();
  await expect(page.getByText(/Noch keine Programme gebaut/)).toBeVisible();
});

test('Etappe 7: neues Gebäude bauen, Einkaufsliste nach Abteilung, Wunschliste mit Preisvergleich', async ({ page }, info) => {
  await anmelden(page);
  // neues Gebäude aus der Liste heraus
  await page.goto('/');
  await page.getByRole('button', { name: '🏗️ Neues Gebäude' }).click();
  const f = page.getByRole('form', { name: 'Neues Gebäude' });
  const name = `Werkhof ${info.project.name}`;
  await f.getByLabel('Name').fill(name);
  await f.getByLabel('Wofür ist es da?').fill('Testgebäude');
  await f.getByRole('button', { name: 'Bauen' }).click();
  await expect(page.locator('.gebaeude-karte', { hasText: name })).toBeVisible();
  // Einkaufsladen: Einkaufsliste ist der erste Reiter
  await page.goto('/gebaeude/Einkaufsladen');
  await expect(page.getByRole('button', { name: 'Einkaufsliste', exact: true })).toHaveClass(/aktiv/);
  const milch = `Milch ${info.project.name}`;
  await page.getByRole('textbox', { name: 'Neues To-do' }).fill(milch);
  await page.getByRole('form', { name: 'Neues To-do' }).getByRole('button', { name: '+' }).click();
  await expect(page.locator('.todo', { hasText: milch })).toBeVisible();
  // Wunschliste → Preisvergleich startet einen Chat
  await page.getByRole('button', { name: 'Wunschliste', exact: true }).click();
  const wunsch = `Kopfhörer ${info.project.name}`;
  await page.getByRole('textbox', { name: 'Neues To-do' }).fill(wunsch);
  await page.getByRole('form', { name: 'Neues To-do' }).getByRole('button', { name: '+' }).click();
  await page.locator('.todo', { hasText: wunsch }).getByRole('button', { name: '🔎 Preise' }).click();
  await expect(page).toHaveURL(/\/chats\//);
  await expect(page.getByText(`Preisvergleich: ${wunsch}`).first()).toBeVisible();
});

test('Bank: Kontoauszug hochladen → Monat mit Kategorien; Kategorie umstellen gilt für die Gegenseite', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht – beide Projekte teilen sich den Server');
  await anmelden(page);
  await page.goto('/gebaeude/Bank');
  await expect(page.getByRole('button', { name: 'Konto', exact: true })).toHaveClass(/aktiv/);
  await page.locator('.bank input[type=file]').setInputFiles(new URL('./auszug-beispiel.csv', import.meta.url).pathname);
  await expect(page.getByText(/Hochgeladen – 4 neue Buchungen/)).toBeVisible();
  await expect(page.locator('.bank-kachel', { hasText: 'Einnahmen' })).toContainText('1.250,00');
  await expect(page.locator('.bank-balken li', { hasText: 'Wohnen' })).toContainText('420,00');
  await page.getByText(/^Buchungen im/).click();
  await page.getByLabel('Kategorie Kiosk am Eck').selectOption('Freizeit');
  await expect(page.locator('.bank-balken li', { hasText: 'Freizeit' })).toContainText('3,50');
});

test('Corpshaus: Termine, Ämter & Aufgaben (Gruppe = Amt), Corps-Mails', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.goto('/gebaeude/Corpshaus');
  await expect(page.getByRole('button', { name: 'Termine', exact: true })).toHaveClass(/aktiv/);
  await expect(page.getByRole('heading', { name: 'Termine aus deinem Kalender' })).toBeVisible();
  await page.getByRole('button', { name: 'Ämter & Aufgaben', exact: true }).click();
  await page.getByRole('textbox', { name: 'Neues To-do' }).fill('Kassenbuch abschließen');
  await page.getByRole('form', { name: 'Neues To-do' }).getByRole('button', { name: '+' }).click();
  await page.locator('.todo').getByRole('button', { name: 'Kassenbuch abschließen' }).click();
  await page.locator('.todo.bearbeiten').getByLabel('Gruppe').fill('Kassier');
  await page.locator('.todo.bearbeiten').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.todo', { hasText: 'Kassenbuch abschließen' })).toContainText('Kassier');
  await page.getByRole('button', { name: 'Corps-Mails', exact: true }).click();
  await expect(page.getByText(/Gmail ist noch nicht verbunden|Keine Mails/)).toBeVisible();
});

test('Börse: ohne Schlüssel Hinweis; Position und Watchlist anlegen und entfernen', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.goto('/gebaeude/Boerse');
  await expect(page.getByRole('button', { name: 'Depot', exact: true })).toHaveClass(/aktiv/);
  await expect(page.getByText(/dorf boerse-schluessel/)).toBeVisible();
  await page.getByRole('button', { name: '+ Position' }).click();
  const f = page.getByRole('form', { name: 'Neue Position' });
  await f.getByLabel('Name').fill('Vanguard All-World');
  await f.getByLabel('ISIN oder Kürzel').fill('IE00BK5BQT80');
  await f.getByLabel('Stück', { exact: true }).fill('10');
  await f.getByLabel('Einstand je Stück (€)').fill('120,5');
  await f.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(page.locator('.boerse-tabelle', { hasText: 'Vanguard All-World' })).toContainText('IE00BK5BQT80 · 10 Stück');
  await expect(page.locator('.bank-kachel', { hasText: 'Eingesetzt' })).toContainText('1.205,00');
  await page.getByRole('button', { name: '+ Beobachten' }).click();
  const w = page.getByRole('form', { name: 'Neuer Watchlist-Wert' });
  await w.getByLabel('Name').fill('Apple');
  await w.getByLabel('ISIN oder Kürzel').fill('aapl');
  await w.getByLabel('Börse').selectOption('US');
  await w.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(page.getByText('AAPL.US')).toBeVisible();
  await page.getByRole('button', { name: 'Apple entfernen' }).click();
  await expect(page.getByText('AAPL.US')).toHaveCount(0);
});

test('Kirchturm: Timer klingelt überall sichtbar, im Programm mit Glocke; Wecker, Pomodoro, Stoppuhr', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  // so tun, als liefe die Seite im Desktop-Programm: Befehle mitschreiben
  await page.addInitScript(() => {
    const w = window as unknown as { __befehle: [string, unknown][]; __TAURI_INTERNALS__: unknown };
    w.__befehle = [];
    w.__TAURI_INTERNALS__ = { invoke: async (b: string, a: unknown) => void w.__befehle.push([b, a]) };
  });
  await anmelden(page);
  await page.goto('/gebaeude/Kirchturm');
  await expect(page.getByRole('button', { name: 'Uhr', exact: true })).toHaveClass(/aktiv/);
  await expect(page.getByRole('img', { name: /Turmuhr/ })).toBeVisible();

  // Timer über 1 Sekunde → klingelt
  const t = page.getByRole('form', { name: 'Neuer Timer' });
  await t.getByLabel('Timer-Name').fill('Ei');
  await t.getByLabel('Minuten').fill('0');
  await t.getByLabel('Sekunden').fill('1');
  await t.getByRole('button', { name: '▶ Start' }).click();
  const alarm = page.getByRole('alert');
  await expect(alarm).toContainText('⏳ Ei', { timeout: 10_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __befehle: [string, unknown][] }).__befehle)).toContainEqual(['glocke', { art: 'schlag', mal: 1 }]);
  await alarm.getByRole('button', { name: 'Aus' }).click();
  await expect(alarm).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __befehle: [string, unknown][] }).__befehle.map((x) => x[0]))).toContain('glocke_stopp');

  // Wecker anlegen (werktags), ausschalten
  await page.getByRole('button', { name: '+ Wecker' }).click();
  const w = page.getByRole('form', { name: 'Neuer Wecker' });
  await w.getByLabel('Uhrzeit').fill('06:45');
  await w.getByLabel('Wecker-Name').fill('Uni');
  await w.getByRole('button', { name: 'Speichern' }).click();
  const wecker = page.getByRole('region', { name: 'Wecker' });
  await expect(wecker).toContainText('Uni · werktags');
  await wecker.getByLabel('Wecker 06:45 ausschalten').click();
  await expect(wecker.locator('li.wecker.aus')).toHaveCount(1);

  // Pomodoro einstellen und starten
  const p = page.getByRole('region', { name: 'Pomodoro' });
  await p.getByRole('button', { name: '⚙ Einstellen' }).click();
  await p.getByRole('button', { name: 'Lang (50/10/30)' }).click();
  await p.getByLabel('Woran arbeitest du? (optional)').fill('Mathe III');
  await p.getByRole('button', { name: 'Speichern' }).click();
  await p.getByRole('button', { name: '▶ Start' }).click();
  await expect(p).toContainText('Arbeiten');
  await expect(p).toContainText('Runde 1 von 4 · Mathe III');
  await expect(p.locator('.pomodoro-zeit')).toHaveText(/^(50:00|49:5\d)$/);
  await p.getByRole('button', { name: '⏹ Stopp' }).click();

  // Stoppuhr
  const s = page.getByRole('region', { name: 'Stoppuhr' });
  await s.getByRole('button', { name: '▶ Start' }).click();
  await s.getByRole('button', { name: 'Runde' }).click();
  await s.getByRole('button', { name: '⏸ Stopp' }).click();
  await expect(s.locator('.stoppuhr-runden li')).toHaveCount(1);
  await s.getByRole('button', { name: 'Zurücksetzen' }).click();
  await expect(s.locator('.stoppuhr-zeit')).toHaveText('0:00,00');
});

test('Marktplatz-Kalender: Monat/Woche/Liste, Termin anlegen, Serie bearbeiten, löschen (Google nachgebaut)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  const zeit = (h: number) => new Date(`${heute}T${String(h).padStart(2, '0')}:00:00`).toISOString();
  const gesendet: { methode: string; url: string; body: unknown }[] = [];
  await page.route('**/api/kalender**', async (route) => {
    const r = route.request();
    if (r.method() !== 'GET' || r.url().includes('/serie')) {
      gesendet.push({ methode: r.method(), url: r.url(), body: r.postDataJSON() as unknown });
      return route.fulfill({ json: r.url().includes('/serie') ? { wiederholung: 'RRULE:FREQ=WEEKLY;BYDAY=WE', start: null } : { ok: true } });
    }
    return route.fulfill({
      json: {
        modus: 'google',
        kalender: [
          { id: 'leif', name: 'Leif', farbe: '#9fe1e7', primaer: true, schreibbar: true },
          { id: 'feiertage', name: 'Feiertage', farbe: '#16a765', primaer: false, schreibbar: false },
        ],
        termine: [
          { id: 'e1', kalenderId: 'leif', titel: 'Zahnarzt', start: zeit(9), ende: zeit(10), ganztags: false, ort: 'Konstanz', quelle: 'google', schreibbar: true, erinnerungen: null },
          { id: 's_1', kalenderId: 'leif', titel: 'Training', start: zeit(18), ende: zeit(19), ganztags: false, serieId: 's', quelle: 'google', schreibbar: true, erinnerungen: [30] },
          { id: 'f1', kalenderId: 'feiertage', titel: 'Feiertag', start: heute, ende: heute.replace(/\d\d$/, (t) => String(Number(t) + 1).padStart(2, '0')), ganztags: true, quelle: 'google', schreibbar: false },
          { id: 'uni:1', kalenderId: 'uni', titel: '⏰ Mathe III: Blatt 5', start: zeit(22), ende: zeit(22), ganztags: false, quelle: 'uni', schreibbar: false },
        ],
      },
    });
  });
  await anmelden(page);
  await page.goto('/gebaeude/Marktplatz');
  await page.getByRole('button', { name: 'Kalender', exact: true }).click();
  await page.getByRole('tab', { name: 'Monat' }).click();
  const heuteZelle = page.locator('.kalender-tag.heute');
  await expect(heuteZelle).toContainText('Zahnarzt');
  await expect(heuteZelle).toContainText('Training');
  await expect(heuteZelle).toContainText('Feiertag');
  await expect(page.getByLabel('Uni-Fristen')).toBeChecked();

  // Kalender ausblenden
  await page.getByLabel('Feiertage').uncheck();
  await expect(heuteZelle).not.toContainText('Feiertag');

  // neuer Termin
  await page.getByRole('button', { name: '+ Termin' }).click();
  const f = page.getByRole('dialog', { name: 'Neuer Termin' });
  await f.getByLabel('Titel').fill('Corps-Kneipe');
  await f.getByLabel('Beginn Uhrzeit').fill('20:00');
  await f.getByLabel('Ende Uhrzeit').fill('23:30');
  await f.getByLabel('Ort').fill('Corpshaus');
  await f.getByLabel('Wiederholen').selectOption('woechentlich');
  await f.getByLabel('Wiederholung endet').selectOption('anzahl');
  await f.getByLabel('Anzahl Termine').fill('4');
  await f.getByLabel('Erinnerung', { exact: true }).selectOption('30');
  await f.getByRole('button', { name: 'Tomate' }).click();
  await f.getByRole('button', { name: 'Speichern' }).click();
  await expect(f).toHaveCount(0);
  const neu = gesendet.find((g) => g.methode === 'POST')!;
  expect(neu.body).toMatchObject({ kalenderId: 'leif', titel: 'Corps-Kneipe', ganztags: false, start: `${heute}T20:00`, ende: `${heute}T23:30`, ort: 'Corpshaus', erinnerungen: [30], farbe: '11' });
  expect((neu.body as { wiederholung: string }).wiederholung).toMatch(/^RRULE:FREQ=WEEKLY;BYDAY=(MO|TU|WE|TH|FR|SA|SU);COUNT=4$/);

  // Serie bearbeiten: ganze Serie umbenennen
  await page.getByRole('tab', { name: 'Woche' }).click();
  await page.locator('.kalender-raster').getByRole('button', { name: /Training/ }).click();
  const b = page.getByRole('dialog', { name: 'Termin bearbeiten' });
  await expect(b.getByLabel('Wiederholen')).toBeDisabled();
  await b.getByLabel('ganze Serie').check();
  await expect(b.getByLabel('Wiederholen')).toHaveValue('woechentlich');
  await b.getByLabel('Titel').fill('Training (neu)');
  await b.getByRole('button', { name: 'Speichern' }).click();
  await expect(b).toHaveCount(0);
  expect(gesendet.find((g) => g.methode === 'PATCH')!.body).toMatchObject({ id: 's_1', serie: true, vonKalender: 'leif', termin: { titel: 'Training (neu)', wiederholung: 'RRULE:FREQ=WEEKLY;BYDAY=WE' } });

  // Liste: Uni-Frist nur ansehen; Zahnarzt löschen
  await page.getByRole('tab', { name: 'Liste' }).click();
  await page.locator('.kalender-liste').getByRole('button', { name: /Mathe III/ }).click();
  await expect(page.getByRole('dialog', { name: 'Termin' })).toContainText('Uni-Frist');
  await page.getByRole('button', { name: 'Schließen' }).click();
  await page.locator('.kalender-liste').getByRole('button', { name: 'Zahnarzt' }).click();
  await page.getByRole('dialog', { name: 'Termin bearbeiten' }).getByRole('button', { name: 'Löschen' }).click();
  expect(gesendet.find((g) => g.methode === 'DELETE')!.url).toContain('kalenderId=leif&id=e1');
});

test('Marktplatz-Kalender: Termin in der Woche ziehen (Zeit und Tag) und unten verlängern', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  // Linzer Zeit (MEZ/MESZ), unabhängig von der Zeitzone des Testrechners
  const versatz = Number(new Date(`${heute}T12:00:00Z`).toLocaleString('en-GB', { timeZone: 'Europe/Vienna', hour: '2-digit', hour12: false })) - 12;
  const zeit = (h: number) => new Date(Date.parse(`${heute}T${String(h).padStart(2, '0')}:00:00Z`) - versatz * 3_600_000).toISOString();
  const gesendet: unknown[] = [];
  await page.route('**/api/kalender**', async (route) => {
    const r = route.request();
    if (r.method() === 'PATCH') {
      gesendet.push(r.postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({
      json: {
        modus: 'google',
        kalender: [{ id: 'leif', name: 'Leif', farbe: '#9fe1e7', primaer: true, schreibbar: true }],
        termine: [{ id: 'e1', kalenderId: 'leif', titel: 'Lernen', start: zeit(9), ende: zeit(10), ganztags: false, quelle: 'google', schreibbar: true, erinnerungen: null }],
      },
    });
  });
  await anmelden(page);
  await page.goto('/gebaeude/Marktplatz');
  await page.getByRole('button', { name: 'Kalender', exact: true }).click();
  await page.getByRole('tab', { name: 'Tag' }).click();
  const t = page.locator('.raster-termin[data-termin="Lernen"]');
  await expect(t).toBeVisible();
  // um 1 Stunde nach unten ziehen (44 px je Stunde)
  const b = (await t.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + 10);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(b.x + b.width / 2, b.y + 10 + (44 * i) / 6);
  await expect(page.locator('.zug-zeit')).toHaveText('10:00–11:00');
  await page.mouse.up();
  await expect.poll(() => gesendet.length).toBe(1);
  expect(gesendet[0]).toMatchObject({ id: 'e1', vonKalender: 'leif', termin: { titel: 'Lernen', start: `${heute}T10:00`, ende: `${heute}T11:00` } });
  // unten am Griff um 30 min verlängern
  const g = (await t.getByLabel('Lernen verlängern').boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2 + (22 * i) / 4);
  await page.mouse.up();
  await expect.poll(() => gesendet.length).toBe(2);
  expect(gesendet[1]).toMatchObject({ termin: { start: `${heute}T09:00`, ende: `${heute}T10:30` } });
  // ein einfacher Klick öffnet weiterhin das Bearbeiten
  await t.click();
  await expect(page.getByRole('dialog', { name: 'Termin bearbeiten' })).toBeVisible();
});

test('Fokus: Pomodoro direkt an einem To-do starten; Kirchturm zeigt Thema und Fokus-Statistik', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.goto('/gebaeude/Marktplatz');
  const f = page.getByRole('form', { name: 'Neues To-do' });
  await f.getByLabel('Neues To-do').fill('Blatt 7 rechnen');
  await f.getByRole('button', { name: '+' }).click();
  await page.getByRole('button', { name: 'Fokus: Blatt 7 rechnen' }).click();
  await page.goto('/gebaeude/Kirchturm');
  const p = page.getByRole('region', { name: 'Pomodoro' });
  await expect(p).toContainText('Arbeiten');
  await expect(p).toContainText('Blatt 7 rechnen');
  await expect(page.getByRole('region', { name: 'Fokus' })).toContainText('7 Tage');
  await p.getByRole('button', { name: '⏹ Stopp' }).click();
  await expect(p).toContainText('Bereit');
});

test('Lernzeit einplanen: 📅 am To-do zeigt freie Blöcke bis zur Frist, Eintragen geht in den Kalender', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  const morgen = new Date(Date.now() + 2 * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  const eingetragen: unknown[] = [];
  await page.route('**/api/kalender/frei**', (r) =>
    r.fulfill({ json: [{ start: `${morgen}T08:00:00.000Z`, ende: `${morgen}T09:30:00.000Z` }, { start: `${morgen}T12:00:00.000Z`, ende: `${morgen}T13:30:00.000Z` }] }),
  );
  await page.route('**/api/kalender/lernzeit', (r) => {
    eingetragen.push(r.request().postDataJSON());
    return r.fulfill({ json: { ok: true } });
  });
  await anmelden(page);
  await page.goto('/gebaeude/Marktplatz');
  const f = page.getByRole('form', { name: 'Neues To-do' });
  await f.getByLabel('Neues To-do').fill('Abgabe: Blatt 8');
  await f.getByLabel('Fällig am').fill(morgen);
  await f.getByRole('button', { name: '+' }).click();
  await page.getByRole('button', { name: 'Lernzeit: Abgabe: Blatt 8' }).click();
  const g = page.getByRole('group', { name: 'Lernzeit für Blatt 8' });
  await expect(g.getByRole('listitem')).toHaveCount(2);
  await g.getByRole('button', { name: 'Eintragen' }).first().click();
  await expect(g).toContainText('✅ eingetragen');
  expect(eingetragen[0]).toMatchObject({ titel: 'Blatt 8', start: `${morgen}T08:00:00.000Z` });
  // E96: Lernplan bis zur Frist – Stunden wählen, einen Block abwählen, Rest eintragen
  let plan: { bloecke: { titel: string }[] } | null = null;
  await page.route('**/api/kalender/lernplan**', (r) =>
    r.fulfill({ json: { gewuenscht: 4, bloecke: [1, 2, 3].map((i) => ({ start: `${morgen}T0${i}:00:00.000Z`, ende: `${morgen}T0${i}:30:00.000Z` })) } }),
  );
  await page.route('**/api/tag/eintragen', (r) => {
    plan = r.request().postDataJSON();
    return r.fulfill({ json: [] });
  });
  await g.getByRole('button', { name: 'Lernplan bis zur Frist' }).click();
  await expect(g).toContainText('nur 3 von 4 Blöcken');
  await g.getByRole('checkbox').nth(1).uncheck();
  await g.getByRole('button', { name: '2 Blöcke eintragen' }).click();
  await expect(g).toContainText('2 Lernblöcke im Kalender');
  expect(plan!.bloecke.map((b) => b.titel)).toEqual(['Lernen: Blatt 8', 'Lernen: Blatt 8']);
});

test('Wochenrückblick: im Rathaus erstellen und lesen', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.goto('/gebaeude/Rathaus');
  await page.getByRole('button', { name: 'Wochenrückblick', exact: true }).click();
  await page.getByRole('button', { name: 'Jetzt erstellen' }).click();
  await expect(page.getByRole('heading', { name: /Wochenrückblick \d{4} · KW \d{2}/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nächste Woche' })).toBeVisible();
});

test('Post: Mail per Klick als To-do', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  let gesendet: unknown = null;
  await page.route('**/api/post', (r) =>
    r.fulfill({
      json: {
        verbunden: true,
        einordnungMoeglich: true,
        laeuft: false,
        letzter: null,
        mails: [{ id: 'm1', threadId: 't1', von: 'Prof', betreff: 'Nachklausur', datum: new Date().toISOString(), kategorie: 'Uni', wichtig: true, antwortNoetig: true, zusammenfassung: 'Bitte zusagen', frist: null, eingeordnet: true }],
      },
    }),
  );
  await page.route('**/api/post/todo', (r) => {
    gesendet = r.request().postDataJSON();
    return r.fulfill({ json: { pfad: 'Marktplatz/todos/x.md' } });
  });
  await anmelden(page);
  await page.goto('/gebaeude/Post');
  await page.getByRole('button', { name: 'Als To-do: Nachklausur' }).click();
  await expect(page.getByText('✅ auf dem To-do-Brett')).toBeVisible();
  expect(gesendet).toEqual({ id: 'm1' });
});

test('Kalender-Schnelleingabe: „morgen 14 Uhr Zahnarzt @Konstanz“ füllt das Formular', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  const morgen = new Date(Date.now() + 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  let neu: unknown = null;
  await page.route('**/api/kalender**', (r) => {
    if (r.request().method() === 'POST') {
      neu = r.request().postDataJSON();
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({ json: { modus: 'google', kalender: [{ id: 'leif', name: 'Leif', farbe: '#9fe1e7', primaer: true, schreibbar: true }], termine: [] } });
  });
  await anmelden(page);
  await page.goto('/gebaeude/Marktplatz');
  await page.getByRole('button', { name: 'Kalender', exact: true }).click();
  await page.getByLabel('Termin schnell eingeben').fill('morgen 14 Uhr Zahnarzt @Konstanz');
  await page.getByLabel('Termin schnell eingeben').press('Enter');
  const f = page.getByRole('dialog', { name: 'Neuer Termin' });
  await expect(f.getByLabel('Titel')).toHaveValue('Zahnarzt');
  await expect(f.getByLabel('Beginn Uhrzeit')).toHaveValue('14:00');
  await expect(f.getByLabel('Ort')).toHaveValue('Konstanz');
  await f.getByRole('button', { name: 'Speichern' }).click();
  await expect.poll(() => neu).toMatchObject({ titel: 'Zahnarzt', start: `${morgen}T14:00`, ende: `${morgen}T15:00`, ort: 'Konstanz' });
});

test('Tag planen: Vorschläge aus To-dos abwählen und eintragen', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  let eingetragen: unknown = null;
  await page.route('**/api/kalender?**', (r) => r.fulfill({ json: { modus: 'google', kalender: [{ id: 'leif', name: 'Leif', farbe: '#9fe1e7', primaer: true, schreibbar: true }], termine: [] } }));
  await page.route('**/api/tag/planen**', (r) =>
    r.fulfill({
      json: [
        { titel: 'Steuer', todoPfad: 'a', start: '2026-11-17T07:00:00.000Z', ende: '2026-11-17T07:45:00.000Z', grund: 'überfällig' },
        { titel: 'Blatt 5', todoPfad: 'b', start: '2026-11-17T09:15:00.000Z', ende: '2026-11-17T10:45:00.000Z', grund: 'heute fällig' },
      ],
    }),
  );
  await page.route('**/api/tag/eintragen', (r) => {
    eingetragen = r.request().postDataJSON();
    return r.fulfill({ json: [] });
  });
  await anmelden(page);
  await page.goto('/gebaeude/Marktplatz');
  await page.getByRole('button', { name: 'Kalender', exact: true }).click();
  await page.getByRole('button', { name: '🧭 Tag planen' }).click();
  const d = page.getByRole('dialog', { name: 'Tag planen' });
  await expect(d.getByRole('listitem')).toHaveCount(2);
  await d.getByRole('checkbox').first().uncheck();
  await d.getByRole('button', { name: 'Eintragen (1)' }).click();
  await expect(d).toContainText('1 Block eingetragen');
  expect(eingetragen).toEqual({ bloecke: [{ titel: 'Blatt 5', start: '2026-11-17T09:15:00.000Z', ende: '2026-11-17T10:45:00.000Z' }] });
});

test('Mein Tag (/heute): Termine aus dem Kalender, To-do anlegen und abhaken, Fokus starten', async ({ page }, info) => {
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  const morgenDatum = new Date(`${heute}T12:00:00Z`);
  morgenDatum.setUTCDate(morgenDatum.getUTCDate() + 1);
  const morgen = morgenDatum.toISOString().slice(0, 10);
  // 11–12 Uhr UTC liegt in Wien immer am selben Tag (12/13 Uhr)
  const zeit = (tag: string, h: number) => `${tag}T${String(h).padStart(2, '0')}:00:00.000Z`;
  await page.route('**/api/kalender**', (route) =>
    route.fulfill({
      json: {
        modus: 'google',
        kalender: [{ id: 'leif', name: 'Leif', farbe: '#9fe1e7', primaer: true, schreibbar: true }],
        termine: [
          { id: 'e1', kalenderId: 'leif', titel: 'Zahnarzt', start: zeit(heute, 11), ende: zeit(heute, 12), ganztags: false, ort: 'Konstanz', quelle: 'google', schreibbar: true, erinnerungen: null },
          { id: 'f1', kalenderId: 'leif', titel: 'Stiftungsfest', start: heute, ende: morgen, ganztags: true, quelle: 'google', schreibbar: true },
          { id: 'uni:1', kalenderId: 'uni', titel: '⏰ Mathe III: Blatt 5', start: zeit(morgen, 11), ende: zeit(morgen, 11), ganztags: false, quelle: 'uni', schreibbar: false },
        ],
      },
    }),
  );
  await anmelden(page);
  await page.getByRole('link', { name: 'Heute', exact: true }).click();
  await expect(page).toHaveURL(/\/heute$/);
  await expect(page.getByRole('link', { name: 'Heute', exact: true })).toHaveClass(/aktiv/);
  await expect(page.getByRole('heading', { name: /, Leif$/ })).toBeVisible();
  await expect(page.getByTestId('heute-naechstes')).toBeVisible();

  // Termine: heute (mit Uhrzeit in Wiener Zeit und ganztags), morgen die Uni-Frist
  const termine = page.getByRole('region', { name: 'Termine' });
  const wien = new Date(zeit(heute, 11)).toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' });
  await expect(termine.getByRole('link', { name: /Zahnarzt/ })).toContainText(wien);
  await expect(termine.getByRole('link', { name: /Zahnarzt/ })).toContainText('Konstanz');
  await expect(termine.getByRole('link', { name: /Stiftungsfest/ })).toContainText('ganztags');
  await expect(termine).toContainText('Morgen');
  await expect(termine.getByRole('link', { name: /Mathe III: Blatt 5/ })).toContainText('Uni-Frist');

  // To-do für heute anlegen → Gruppe „Heute“; abhaken → weg, zählt als erledigt
  const todos = page.getByRole('region', { name: 'To-dos' });
  const titel = `Heute-Probe ${info.project.name}`;
  await todos.getByRole('textbox', { name: 'Neues To-do' }).fill(titel);
  await todos.getByText('heute', { exact: true }).click();
  await todos.getByRole('button', { name: 'To-do anlegen' }).click();
  const zeile = todos.locator('.heute-todo', { hasText: titel });
  await expect(zeile).toBeVisible();
  await expect(todos.locator('.heute-gruppe', { hasText: titel }).locator('.heute-gruppe-titel')).toContainText('Heute');
  await expect(todos.getByRole('textbox', { name: 'Neues To-do' })).toHaveValue('');
  await zeile.getByRole('checkbox').check();
  await expect(zeile).toHaveCount(0);
  await expect(page.locator('.heute-zahl.gruen')).toContainText('erledigt');
  const liste = (await (await page.request.get('/api/todos')).json()) as { titel: string; erledigt: boolean }[];
  expect(liste.find((t) => t.titel === titel)?.erledigt).toBe(true);

  // Fokus starten → Restzeit läuft; Stopp → Knopf wieder da
  const fokus = page.getByRole('region', { name: 'Fokus' });
  await fokus.getByRole('button', { name: '🍅 Fokus starten' }).click();
  await expect(fokus.getByTestId('heute-fokus-rest')).toHaveText(/^\d{1,2}:\d\d$/);
  await expect(fokus).toContainText('Arbeiten');
  await fokus.getByRole('button', { name: '⏹ Stopp' }).click();
  await expect(fokus.getByRole('button', { name: '🍅 Fokus starten' })).toBeVisible();

  // Termin antippen → Marktplatz-Kalender
  await termine.getByRole('link', { name: /Zahnarzt/ }).click();
  await expect(page).toHaveURL(/\/gebaeude\/Marktplatz\?reiter=kalender$/);
  await expect(page.getByRole('button', { name: 'Kalender', exact: true })).toHaveClass(/aktiv/);
});

test('Befehlspalette (Strg+K): To-do anlegen, Termin mit Bestätigung, Gebäude öffnen', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  let termin: unknown = null;
  await page.route('**/api/kalender/schnell', (r) => {
    termin = r.request().postDataJSON();
    return r.fulfill({ json: { ok: true } });
  });
  await anmelden(page);
  await page.keyboard.press('Control+k');
  const p = page.getByRole('dialog', { name: 'Befehlspalette' });
  const feld = p.getByLabel('Befehl oder Suche');
  await feld.fill('todo Palette-Test');
  await expect(p.getByRole('option').first()).toContainText('To-do anlegen: Palette-Test');
  await feld.press('Enter');
  await expect(p).toContainText('To-do angelegt: Palette-Test');
  await feld.fill('termin morgen 14 Uhr Zahnarzt');
  await expect(p.getByRole('option').first()).toContainText('Termin eintragen: Zahnarzt');
  await feld.press('Enter');
  await expect(p).toContainText('Eintragen?');
  expect(termin).toBeNull();
  await feld.press('Enter');
  await expect(p).toContainText('📅 Eingetragen');
  expect(termin).toEqual({ text: 'morgen 14 Uhr Zahnarzt' });
  await feld.fill('kirchturm');
  await expect(p.getByRole('option').first()).toContainText('Kirchturm');
  await feld.press('Enter');
  await expect(page).toHaveURL(/\/gebaeude\/Kirchturm/);
  await expect(p).toHaveCount(0);
  await page.goto('/gebaeude/Marktplatz');
  await expect(page.getByRole('button', { name: 'Palette-Test', exact: true }).first()).toBeVisible();
});

test('⭐ wichtig: am To-do markieren, auf „Heute“ ganz oben', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.goto('/gebaeude/Marktplatz');
  const f = page.getByRole('form', { name: 'Neues To-do' });
  await f.getByLabel('Neues To-do').fill('Stern-Test');
  await f.getByRole('button', { name: '+' }).click();
  await page.getByRole('button', { name: 'Stern-Test als wichtig markieren' }).click();
  await expect(page.getByRole('button', { name: 'Stern-Test nicht mehr wichtig' })).toBeVisible();
  await page.goto('/heute');
  await expect(page.locator('.heute-gruppe.stern')).toContainText('Stern-Test');
});

test('Karteikarten: Fach mit karten.md, lernen mit Leertaste und 1–4', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  const o = { origin: ORIGIN };
  expect((await page.request.post('/api/uni/fach', { headers: o, data: { name: 'Karten-Fach' } })).ok()).toBe(true);
  const r = await page.request.put('/api/vault/datei', { headers: o, data: { pfad: 'Uni/faecher/Karten-Fach/karten.md', inhalt: 'Hauptstadt von Österreich :: Wien\n\n### Was ist ein Eigenwert?\nEin λ mit Av = λv.\n' } });
  expect(r.ok()).toBe(true);
  await page.goto('/gebaeude/Uni');
  await page.getByRole('button', { name: 'Karteikarten', exact: true }).click();
  const k = page.getByRole('region', { name: 'Karten Karten-Fach' });
  await expect(k).toContainText('2 heute dran');
  await k.getByRole('button', { name: 'Lernen' }).click();
  const karte = page.getByLabel('Karteikarte');
  await expect(karte).toContainText('Hauptstadt von Österreich');
  await page.keyboard.press(' ');
  await expect(karte).toContainText('Wien');
  await page.keyboard.press('3');
  await expect(karte).toContainText('Was ist ein Eigenwert?');
  await karte.getByRole('button', { name: /Antwort zeigen/ }).click();
  await karte.getByRole('button', { name: /Leicht/ }).click();
  await expect(page.getByText('Fertig für heute – 2 Karten.')).toBeVisible();
  await page.getByRole('button', { name: '← Fächer' }).click();
  await expect(k).toContainText('0 heute dran');
});

test('„Heute“ als Startseite: nach dem Haken öffnet „/“ direkt „Heute“', async ({ page }, info) => {
  test.skip(info.project.name !== 'handy', 'am Handy am sinnvollsten');
  await anmelden(page);
  await page.goto('/heute');
  await page.getByLabel('Beim Öffnen zuerst „Heute“ zeigen').check();
  await page.goto('/');
  await expect(page).toHaveURL(/\/heute$/);
  await page.getByLabel('Beim Öffnen zuerst „Heute“ zeigen').uncheck();
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
});

test('Gewohnheiten auf „Heute“: anlegen, abhaken (Serie 🔥 1), entfernen', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.goto('/heute');
  const k = page.getByRole('region', { name: 'Gewohnheiten' });
  await k.getByRole('button', { name: /Anlegen|Bearbeiten/ }).click();
  const f = k.getByRole('form', { name: 'Neue Gewohnheit' });
  await f.getByLabel('Symbol').fill('📖');
  await f.getByLabel('Name der Gewohnheit').fill('Lesen-Test');
  await f.getByRole('button', { name: 'Gewohnheit anlegen' }).click();
  await k.getByRole('button', { name: 'Fertig' }).click();
  const haken = k.getByLabel('Lesen-Test heute erledigt');
  await expect(haken).not.toBeChecked();
  await haken.check();
  await expect(haken).toBeChecked();
  await expect(k.locator('.gewohnheit', { hasText: 'Lesen-Test' })).toContainText('🔥 1');
  await page.reload();
  await expect(k.getByLabel('Lesen-Test heute erledigt')).toBeChecked();
  await k.getByRole('button', { name: 'Bearbeiten' }).click();
  page.once('dialog', (d) => void d.accept());
  await k.getByRole('button', { name: 'Lesen-Test entfernen' }).click();
  await expect(k.getByText('Lesen-Test')).toHaveCount(0);
});

test('Wochenziele auf „Heute“: setzen, abhaken (Balken), entfernen', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.goto('/heute');
  const k = page.getByRole('region', { name: 'Wochenziele' });
  await expect(k).toContainText('Welche 3 Dinge');
  for (const t of ['Ziel-Test A', 'Ziel-Test B']) {
    await k.getByRole('textbox', { name: 'Neues Wochenziel' }).fill(t);
    await k.getByRole('button', { name: 'Ziel hinzufügen' }).click();
    await expect(k.getByText(t)).toBeVisible();
  }
  await k.getByLabel('Ziel erreicht: Ziel-Test A').click();
  await expect(k.getByLabel('Ziel erreicht: Ziel-Test A')).toBeChecked();
  await expect(k.locator('.wochenziele-stand')).toHaveText(' 1/2');
  await k.getByRole('button', { name: 'Bearbeiten' }).click();
  await k.getByRole('button', { name: 'Ziel entfernen: Ziel-Test B' }).click();
  await expect(k.getByText('Ziel-Test B')).toHaveCount(0);
});

test('Wiederkehrendes To-do: 🔁 wöchentlich, abhaken legt das nächste an', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.goto('/gebaeude/Marktplatz?reiter=todo');
  const f = page.getByRole('form', { name: 'Neues To-do' });
  await f.getByRole('textbox', { name: 'Neues To-do' }).fill('Wäsche-Test');
  await f.getByLabel('Fällig am').fill('2026-01-05');
  await f.getByRole('button', { name: '+' }).click();
  await page.getByRole('button', { name: 'Wäsche-Test', exact: true }).click();
  await page.getByLabel('Wiederholen').selectOption('wöchentlich');
  await page.getByRole('button', { name: 'Speichern' }).click();
  const zeile = page.locator('li.todo', { hasText: 'Wäsche-Test' });
  await expect(zeile).toContainText('🔁 wöchentlich');
  await zeile.getByLabel('Wäsche-Test erledigt').check();
  // das nächste ist offen, mit Datum in der Zukunft
  const offen = page.locator('li.todo:not(.fertig)', { hasText: 'Wäsche-Test' });
  await expect(offen).toHaveCount(1);
  await expect(offen).toContainText('🔁 wöchentlich');
  await expect(page.locator('li.todo.fertig', { hasText: 'Wäsche-Test' })).toHaveCount(1);
});

test('Statistik im Rathaus: Kacheln, Balken mit Hover, Tabelle', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  const o = { origin: ORIGIN };
  for (const t of ['Stat-A', 'Stat-B']) {
    const n = await (await page.request.post('/api/todos', { headers: o, data: { titel: t } })).json();
    await page.request.patch('/api/todos', { headers: o, data: { pfad: n.pfad, erledigt: true } });
  }
  await page.goto('/gebaeude/Rathaus?reiter=statistik');
  const s = page.getByRole('region', { name: 'Statistik' });
  await expect(s.locator('.statistik-kachel').first()).toContainText(/To-dos erledigt\s*\d+/);
  const d = s.getByRole('figure', { name: '☑️ Erledigte To-dos je Tag' });
  await expect(d.locator('.statistik-balken')).not.toHaveCount(0);
  await d.locator('.statistik-treffer').last().hover();
  await expect(d.locator('.statistik-hover')).toContainText('erledigt');
  if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT, fullPage: true });
  await s.getByRole('button', { name: 'Tabelle' }).click();
  await expect(s.getByRole('table')).toBeVisible();
  await s.getByRole('button', { name: '3 Monate' }).click();
  await expect(s.getByRole('row')).toHaveCount(91);
});

test('Erinnerung am To-do: setzen, 🔔-Abzeichen; zur Zeit läutet der Kirchturm mit „✓ Erledigt“', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  test.setTimeout(75_000);
  await anmelden(page);
  const o = { origin: ORIGIN };
  const lokal = (ms: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  };
  await page.goto('/gebaeude/Marktplatz?reiter=todo');
  const f = page.getByRole('form', { name: 'Neues To-do' });
  await f.getByRole('textbox', { name: 'Neues To-do' }).fill('Erinner-Test');
  await f.getByRole('button', { name: '+' }).click();
  await page.getByRole('button', { name: 'Erinner-Test', exact: true }).click();
  await page.getByLabel('Erinnerung').fill(lokal(Date.now() + 2 * 86_400_000));
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('li.todo', { hasText: 'Erinner-Test' })).toContainText('🔔');
  // zweites To-do, dessen Zeit schon da ist → läutet beim nächsten Rundgang (alle 30 s)
  await page.request.post('/api/todos', { headers: o, data: { titel: 'Jetzt-Erinnerung', erinnerung: lokal(Date.now() - 60_000) } });
  const glocke = page.locator('.kirchturm-klingel', { hasText: 'Jetzt-Erinnerung' });
  await expect(glocke).toBeVisible({ timeout: 45_000 });
  await glocke.getByRole('button', { name: '✓ Erledigt' }).click();
  await expect(glocke).toHaveCount(0);
  await expect(page.locator('li.todo.fertig', { hasText: 'Jetzt-Erinnerung' })).toHaveCount(1);
});

test('Befehlspalette: „notiz …“ landet in der Tagesnotiz', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.keyboard.press('Control+k');
  const p = page.getByRole('dialog', { name: 'Befehlspalette' });
  await p.getByLabel('Befehl oder Suche').fill('notiz Palette-Notiz-Test');
  await expect(p.getByRole('option').first()).toContainText('Notiz: Palette-Notiz-Test');
  await p.getByLabel('Befehl oder Suche').press('Enter');
  await expect(p).toContainText('📝 Notiert.');
  const n = await (await page.request.get('/api/notizen/heute')).json();
  expect(n.zeilen.some((z: string) => z.endsWith('Palette-Notiz-Test'))).toBe(true);
});

test('Heute: überfälliges To-do mit „→ morgen“ neu einplanen', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  const o = { origin: ORIGIN };
  await page.request.post('/api/todos', { headers: o, data: { titel: 'Alt-Überfällig', faellig: '2026-01-02' } });
  await page.goto('/heute');
  await page.getByRole('button', { name: 'Alt-Überfällig auf morgen' }).click();
  await expect(page.locator('.heute-gruppe.rot', { hasText: 'Alt-Überfällig' })).toHaveCount(0);
  await expect(page.locator('.heute-todo', { hasText: 'Alt-Überfällig' })).toContainText('morgen');
});

test('Uni → Noten: Fach mit ECTS, Note wählen, Schnitt und Ziel', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.goto('/gebaeude/Uni?reiter=noten');
  const n = page.getByRole('region', { name: 'Noten und ECTS' });
  const f = n.getByRole('form', { name: 'Fach zur Notenliste' });
  for (const [fach, ects] of [['Noten-A', '6'], ['Noten-B', '3']] as const) {
    await f.getByLabel('Fach', { exact: true }).fill(fach);
    await f.getByLabel('ECTS neu').fill(ects);
    await f.getByRole('button', { name: 'Fach hinzufügen' }).click();
    await expect(n.getByRole('cell', { name: fach, exact: true })).toBeVisible();
  }
  await n.getByLabel('Note Noten-A').selectOption('1');
  await n.getByLabel('Note Noten-B').selectOption('4');
  await expect(n.locator('.statistik-kachel').first()).toContainText('2'); // (6·1 + 3·4) / 9
  await n.getByLabel('Ziel-ECTS').fill('18');
  await n.getByLabel('Ziel-ECTS').blur();
  await expect(n.locator('.statistik-kachel').nth(2)).toContainText('50 %');
  if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT, fullPage: true });
});

test('Einstellungen → Anschlüsse: zeigt, was fehlt, mit Befehl', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.goto('/einstellungen');
  const a = page.locator('#anschluesse');
  const zeile = (name: string) => a.locator('li', { has: page.locator('strong', { hasText: new RegExp(`^${name.replace(/[()]/g, '\\$&')}$`) }) });
  await expect(zeile('Gmail')).toContainText('✗ fehlt');
  await expect(zeile('Gmail')).toContainText('dorf gmail-anmelden');
  await expect(zeile('KI (API-Schlüssel)')).toContainText('✓ verbunden'); // Attrappe
});

test('Gewohnheit „3× pro Woche“ mit Uhrzeit: Wochenstand auf „Heute“', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.goto('/heute');
  const k = page.getByRole('region', { name: 'Gewohnheiten' });
  await k.getByRole('button', { name: /Anlegen|Bearbeiten/ }).click();
  const f = k.getByRole('form', { name: 'Neue Gewohnheit' });
  await f.getByLabel('Name der Gewohnheit').fill('Wochen-Sport');
  await f.getByLabel('Wann').selectOption('3x pro woche');
  await f.getByLabel(/Uhrzeit/).fill('07:30');
  await f.getByRole('button', { name: 'Gewohnheit anlegen' }).click();
  await k.getByRole('button', { name: 'Fertig' }).click();
  const z = k.locator('.gewohnheit', { hasText: 'Wochen-Sport' });
  await expect(z).toContainText('07:30');
  await expect(z).toContainText('0/3 diese Woche');
  await z.getByLabel('Wochen-Sport heute erledigt').check();
  await expect(z).toContainText('1/3 diese Woche');
});

test('Statistik: Stimmung als eigenes Diagramm, sobald eine gesetzt ist', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  expect((await page.request.post('/api/stimmung', { headers: { origin: ORIGIN }, data: { wert: 4 } })).ok()).toBe(true);
  await page.goto('/gebaeude/Rathaus?reiter=statistik');
  const d = page.getByRole('figure', { name: '💭 Stimmung (1–5)' });
  await expect(d).toBeVisible();
  await d.locator('.statistik-treffer').last().hover();
  await expect(d.locator('.statistik-hover')).toContainText('🙂 4/5');
});
