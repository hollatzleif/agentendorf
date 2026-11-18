import { expect, test, type Page } from '@playwright/test';

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
  await expect(page.locator('.karte.innen', { hasText: 'Testplan' }).first().getByText('fertig').first()).toBeVisible();
  await page.getByRole('button', { name: 'Schreibtisch', exact: true }).click();
  await expect(zeile.getByText('erledigt')).toBeVisible();
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
});
