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

test('E185 Chat: während der Agent arbeitet weiterschreiben – Nachrichten warten als graue Blasen und kommen danach dran', async ({ page }) => {
  test.setTimeout(90_000);
  await anmelden(page);
  await page.goto('/gebaeude/Rathaus?reiter=aktionen');
  await page.getByRole('button', { name: /Frage stellen/ }).click();
  await page.getByLabel(/Deine Frage/).fill('Bitte in Ruhe überlegen [warte 6000]');
  await page.getByRole('button', { name: 'Starten' }).click();
  await expect(page).toHaveURL(/\/chats\//);
  // das Textfeld bleibt offen
  const feld = page.getByPlaceholder(/Noch etwas vergessen\?/);
  await expect(feld).toBeEnabled();
  await feld.fill('Ach ja: bitte auf Englisch');
  await page.getByRole('button', { name: 'Dazuschreiben' }).click();
  await feld.fill('Das hier doch nicht');
  await page.getByRole('button', { name: 'Dazuschreiben' }).click();
  const wartend = page.locator('.nachricht.wartend');
  await expect(wartend).toHaveCount(2);
  await expect(wartend.first()).toContainText('wartet – kommt nach dem aktuellen Schritt dran');
  await expect(wartend.first()).toContainText('Ach ja: bitte auf Englisch');
  // eine wieder herausnehmen
  await wartend.nth(1).getByRole('button', { name: 'Wartende Nachricht entfernen' }).click();
  await expect(wartend).toHaveCount(1);
  // nach dem Lauf: die wartende Nachricht wird ein zweiter Lauf, die Blase ist weg
  await expect(page.getByText(/Lauf 2: fertig/)).toBeVisible({ timeout: 45_000 });
  await expect(wartend).toHaveCount(0);
  await expect(page.locator('.nachricht.nutzer', { hasText: 'Ach ja: bitte auf Englisch' })).toHaveCount(1);
  await expect(page.getByText('Das hier doch nicht')).toHaveCount(0);
  await expect(page.getByPlaceholder('Weiter im Gespräch …')).toBeVisible();
});

test('Schreibtisch: Aufgabe hinlegen, Plan freigeben, Helfer arbeiten, Aufgabe erledigt', async ({ page }, info) => {
  test.setTimeout(120_000); // Helfer laufen im Hintergrund – die CI ist langsamer
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
  await expect(page.locator('.karte.innen', { hasText: 'Testplan' }).first().getByText('fertig').first()).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: 'Schreibtisch', exact: true }).click();
  await expect(zeile.getByText('erledigt')).toBeVisible({ timeout: 45_000 });
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
  await expect(page.getByText(/rund um die Uhr zu zufälligen Zeiten auf \(alle 3–7 Stunden\)/)).toBeVisible();
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
  await w.getByLabel('Kursalarm unter').fill('150');
  await w.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(page.getByText('AAPL.US')).toBeVisible();
  await expect(page.locator('.boerse-tabelle', { hasText: 'Apple' })).toContainText('🔔 < 150');
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
  // Wochentag der Serie = heute (sonst hängt der Test vom Wochentag ab)
  const kuerzel = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][new Date(`${heute}T12:00:00Z`).getUTCDay()]!;
  const gesendet: { methode: string; url: string; body: unknown }[] = [];
  await page.route('**/api/kalender**', async (route) => {
    const r = route.request();
    if (r.method() !== 'GET' || r.url().includes('/serie')) {
      gesendet.push({ methode: r.method(), url: r.url(), body: r.postDataJSON() as unknown });
      return route.fulfill({ json: r.url().includes('/serie') ? { wiederholung: `RRULE:FREQ=WEEKLY;BYDAY=${kuerzel}`, start: null } : { ok: true } });
    }
    return route.fulfill({
      json: {
        modus: 'google',
        kalender: [
          { id: 'leif', name: 'Leif', farbe: '#9fe1e7', primaer: true, schreibbar: true },
          { id: 'feiertage', name: 'Feiertage', farbe: '#16a765', primaer: false, schreibbar: false },
        ],
        termine: [
          { id: 'e1', kalenderId: 'leif', titel: 'Zahnarzt Dr. Müller – Kontrolle 2026W344021/2/3/57/62/103/104 und Zahnreinigung', start: zeit(9), ende: zeit(10), ganztags: false, ort: 'Konstanz', quelle: 'google', schreibbar: true, erinnerungen: null },
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
  // Der heutige Tag ist so breit wie jeder andere – lange Titel ragen nicht in die Nachbartage (19.11.)
  const breite = async (l: import('@playwright/test').Locator) => (await l.boundingBox())!.width;
  const andere = page.locator('.kalender-tag:not(.heute)').first();
  expect(Math.abs((await breite(heuteZelle)) - (await breite(andere)))).toBeLessThan(2);

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
  expect(gesendet.find((g) => g.methode === 'PATCH')!.body).toMatchObject({ id: 's_1', serie: true, vonKalender: 'leif', termin: { titel: 'Training (neu)', wiederholung: `RRULE:FREQ=WEEKLY;BYDAY=${kuerzel}` } });

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
  await expect(page.getByTestId('heute-naechstes').or(page.getByRole('region', { name: 'Jetzt dran' })).first()).toBeVisible();

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

test('Rathaus → Notizen: festhalten und die letzten Tage sehen', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.goto('/gebaeude/Rathaus?reiter=notizen');
  const n = page.getByRole('region', { name: 'Notizen' });
  await n.getByRole('textbox', { name: 'Neue Notiz' }).fill('Notiz-Ansicht-Test');
  await n.getByRole('button', { name: 'Notiz speichern' }).click();
  await expect(n.locator('.notizen-tag').first()).toContainText('Notiz-Ansicht-Test');
  await expect(n.getByRole('textbox', { name: 'Neue Notiz' })).toHaveValue('');
  // E119: Notiz → To-do
  await n.getByRole('button', { name: 'Als To-do: Notiz-Ansicht-Test' }).click();
  await expect(n.getByText('✓ To-do')).toBeVisible();
  const todos = await (await page.request.get('/api/todos')).json();
  expect(todos.find((t: { titel: string }) => t.titel === 'Notiz-Ansicht-Test')?.notiz).toMatch(/^Aus der Notiz vom \d{4}-\d{2}-\d{2}, \d{2}:\d{2}\.$/);
});

test('To-do: Teilschritte anlegen, abhaken, Fortschritt; „Vorschlagen“ ohne Schlüssel erklärt sich', async ({ page }, info) => {
  await anmelden(page);
  const titel = `Schritte-Test ${info.project.name}`;
  await page.request.post('/api/todos', { headers: { origin: ORIGIN }, data: { titel, faellig: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' }) } });
  await page.goto('/gebaeude/Marktplatz?reiter=todo');
  const z = page.locator('li.todo', { hasText: titel });
  await z.getByRole('button', { name: `Schritte für ${titel}` }).click();
  const g = z.getByRole('group', { name: `Schritte: ${titel}` });
  for (const s of ['Gliederung', 'Folien']) {
    await g.getByRole('textbox', { name: 'Neuer Schritt' }).fill(s);
    await g.getByRole('button', { name: 'Schritt hinzufügen' }).click();
    await expect(g.getByText(s, { exact: true })).toBeVisible();
  }
  await expect(g.getByRole('textbox', { name: 'Neuer Schritt' })).toHaveValue('');
  await expect(z.getByRole('button', { name: 'Schritte: 0 von 2' })).toBeVisible();
  await g.getByRole('checkbox', { name: 'Schritt erledigt: Gliederung' }).check();
  await expect(z.getByRole('button', { name: 'Schritte: 1 von 2' })).toBeVisible();
  await g.getByRole('button', { name: '✂️ Vorschlagen' }).click();
  await expect(g.getByText(/API-Schlüssel/)).toBeVisible();
  // auf „Heute“: Fortschritt und der nächste Schritt
  await page.goto('/heute');
  await expect(page.locator('li', { hasText: titel }).locator('.heute-schritt', { hasText: '1/2' }).filter({ hasText: 'Folien' })).toBeVisible();
});

test('Heute: Countdown zur nächsten Prüfung', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  // morgen – früher als die Uni-Prüfungen aus dem nachgebauten Kalender
  const morgen = new Date(Date.now() + 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  await page.request.post('/api/todos', { headers: { origin: ORIGIN }, data: { titel: 'Prüfung: Countdown-Fach', faellig: morgen } });
  await page.goto('/heute');
  await expect(page.locator('.heute-zahlen')).toContainText('📝 Countdown-Fach morgen');
});

test('Wochenziele: sonntags die nächste Woche planen', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.clock.setFixedTime(new Date('2026-11-22T17:00:00Z')); // Sonntag in Wien (nur im Browser)
  await page.goto('/heute');
  const k = page.getByRole('region', { name: 'Wochenziele' });
  await expect(k.getByRole('heading', { name: /Nächste Woche · KW \d+/ })).toBeVisible();
  await k.getByRole('textbox', { name: 'Ziel für nächste Woche' }).fill('Vorgeplant-Test');
  await k.getByRole('button', { name: 'Ziel für nächste Woche hinzufügen' }).click();
  await expect(k.locator('.wochenziele-naechste')).toContainText('☐ Vorgeplant-Test');
});

test('Heute: Erste Schritte haken sich selbst ab und lassen sich ausblenden', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.goto('/heute');
  const k = page.getByRole('region', { name: 'Erste Schritte' });
  await expect(k).toBeVisible();
  await expect(k.locator('li')).toHaveCount(5);
  await page.request.post('/api/wochenziele', { headers: { origin: ORIGIN }, data: { text: 'Erste-Schritte-Ziel' } });
  await page.reload();
  await expect(k.locator('li.fertig', { hasText: 'Wochenziele' })).toHaveCount(1);
  await k.getByRole('button', { name: 'Ausblenden' }).click();
  await expect(k).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Erste Schritte' })).toHaveCount(0);
});

test('Fokus-Vollbild: starten, Zeit läuft, Pause, Stopp; Esc führt zurück', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.goto('/fokus');
  const f = page.getByRole('region', { name: 'Fokus' });
  await f.getByRole('button', { name: '🍅 Fokus starten' }).click();
  await expect(f.locator('.fokus-phase')).toHaveText('🍅 Fokus');
  await expect(f.getByRole('timer')).toHaveText(/^\d{1,2}:\d{2}$/); // Länge je nach Einstellungen anderer Tests
  await f.getByRole('button', { name: '⏸ Pause' }).click();
  await expect(f.getByRole('button', { name: '▶ Weiter' })).toBeVisible();
  await f.getByRole('button', { name: '⏹ Stopp' }).click();
  await expect(f.locator('.fokus-phase')).toHaveText('Bereit');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/heute$/);
});

test('Offline: To-do wird gemerkt und nach der Verbindung gesendet', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'handy', 'am Handy am wichtigsten');
  await anmelden(page);
  await page.goto('/gebaeude/Marktplatz?reiter=todo');
  await expect(page.getByRole('form', { name: 'Neues To-do' })).toBeVisible();
  await context.setOffline(true);
  const f = page.getByRole('form', { name: 'Neues To-do' });
  await f.getByRole('textbox', { name: 'Neues To-do' }).fill('Offline-Test');
  await f.getByRole('button', { name: '+' }).click();
  await expect(page.getByText(/gemerkt, wird gesendet/)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '1 Eintrag wartet' })).toBeVisible();
  // Feld geleert – sonst tippt man es nochmal und es kommt doppelt an (Review)
  await expect(f.getByRole('textbox', { name: 'Neues To-do' })).toHaveValue('');
  // Verbindung zurück → wird von selbst gesendet (online-Ereignis)
  await context.setOffline(false);
  await expect(page.getByRole('status').filter({ hasText: 'wartet' })).toHaveCount(0);
  await expect(page.locator('li.todo', { hasText: 'Offline-Test' })).toHaveCount(1);
});

test('Offline: gleichzeitiges Senden schickt nichts doppelt, Neues bleibt in der Schlange (Review)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.goto('/gebaeude/Marktplatz?reiter=todo');
  await expect(page.getByRole('form', { name: 'Neues To-do' })).toBeVisible();
  // langsamer Server: während des Sendens kommt ein neuer Eintrag dazu
  await page.route('**/api/todos', async (r) => {
    if (r.request().method() === 'POST') await new Promise((x) => setTimeout(x, 400));
    await r.continue();
  });
  await page.evaluate(() => {
    localStorage.setItem('dorf-offline-schlange', JSON.stringify([{ id: 'a', url: '/api/todos', body: { titel: 'Schlange-A' }, zeit: Date.now() }]));
  });
  // dreimal fast gleichzeitig auslösen (online-Ereignis + Knopf)
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('online'));
    setTimeout(() => {
      const s = JSON.parse(localStorage.getItem('dorf-offline-schlange') ?? '[]');
      s.push({ id: 'b', url: '/api/notiz', body: { text: 'nicht verlieren' }, zeit: Date.now() });
      localStorage.setItem('dorf-offline-schlange', JSON.stringify(s));
    }, 100);
  });
  await expect(page.locator('li.todo', { hasText: 'Schlange-A' })).toHaveCount(1);
  await page.waitForTimeout(800);
  const rest = await page.evaluate(() => JSON.parse(localStorage.getItem('dorf-offline-schlange') ?? '[]').map((e: { id: string }) => e.id));
  expect(rest).toEqual(['b']);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => page.evaluate(() => localStorage.getItem('dorf-offline-schlange'))).toBe('[]');
  await page.reload();
  await expect(page.locator('li.todo', { hasText: 'Schlange-A' })).toHaveCount(1);
});

test('Zeitschätzung: Dauer am To-do, „Heute“ warnt, wenn der Tag nicht reicht (E120)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  const o = { origin: ORIGIN };
  await page.request.post('/api/todos', { headers: o, data: { titel: 'Riesenprojekt', faellig: heute, dauer: 600 } });
  await page.request.post('/api/todos', { headers: o, data: { titel: 'Riesenprojekt 2', faellig: heute, dauer: 600 } });
  await page.request.post('/api/todos', { headers: o, data: { titel: 'Dauer-Test', faellig: heute } });
  await page.goto('/gebaeude/Marktplatz?reiter=todo');
  await page.getByRole('button', { name: 'Dauer-Test', exact: true }).click();
  await page.getByRole('combobox', { name: 'Geschätzte Dauer' }).selectOption('90');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('li.todo', { hasText: 'Dauer-Test' })).toContainText('⏱ 1 h 30');
  await page.goto('/heute');
  const b = page.getByRole('status', { name: 'Zeitbudget heute' });
  await expect(b).toContainText('21 h 30 min');
  await expect(b).toContainText('mehr, als in den Tag passt');
  // ab 18 Uhr steht das To-do zusätzlich in „Morgen im Blick“ – darum genau die Zeile der Heute-Liste
  await expect(page.locator('li', { hasText: 'Dauer-Test' }).locator('.heute-todo-datum', { hasText: '⏱ 1 h 30 min' })).toBeVisible();
});

test('Wochenplan: Eingang und Tage, Verschieben per Ziehen und Auswahl, Auslastung (E121)', async ({ page }, info) => {
  await anmelden(page);
  const o = { origin: ORIGIN };
  const titel = `Plan-${info.project.name}-${Date.now() % 100000}`;
  const faellig = async () => ((await (await page.request.get('/api/todos')).json()) as { titel: string; faellig?: string }[]).find((t) => t.titel === titel)?.faellig;
  await page.request.post('/api/todos', { headers: o, data: { titel, dauer: 120 } });
  await page.goto('/gebaeude/Marktplatz?reiter=wochenplan');
  const plan = page.getByRole('region', { name: 'Wochenplan' });
  const eingang = plan.getByLabel('Ohne Datum', { exact: true });
  await expect(eingang.locator('.wplan-karte', { hasText: titel })).toBeVisible();
  const wahl = plan.getByRole('combobox', { name: `Tag für ${titel}` });
  const montag = await wahl.locator('option').nth(1).getAttribute('value');
  const sonntag = await wahl.locator('option').last().getAttribute('value');
  if (info.project.name === 'desktop') {
    // per Auswahl auf Dienstag, dann in die Montags-Spalte daneben ziehen (oben in den Spalten – kein Scrollen beim Ziehen)
    await wahl.selectOption((await wahl.locator('option').nth(2).getAttribute('value'))!);
    const karteDi = plan.locator('.wplan-spalte').nth(2).locator('.wplan-karte', { hasText: titel });
    await expect(karteDi).toBeVisible();
    await karteDi.dragTo(plan.locator('.wplan-spalte').nth(1).locator('h3'), { sourcePosition: { x: 12, y: 8 } });
    await expect(plan.locator('.wplan-spalte').nth(1).locator('.wplan-karte', { hasText: titel })).toBeVisible();
    await expect.poll(faellig).toBe(montag);
  }
  // per Auswahl auf Sonntag
  await wahl.selectOption(sonntag!);
  const spalte = plan.locator('.wplan-spalte').last();
  await expect(spalte.locator('.wplan-karte', { hasText: titel })).toBeVisible();
  await expect(spalte.locator('.wplan-karte', { hasText: titel })).toContainText('⏱ 2 h');
  await expect(spalte.locator('.wplan-summe')).toContainText(/⏱ \d+ h/);
  await expect.poll(faellig).toBe(sonntag);
  // zurück in den Eingang
  await plan.getByRole('combobox', { name: `Tag für ${titel}` }).selectOption('');
  await expect(eingang.locator('.wplan-karte', { hasText: titel })).toBeVisible();
  await expect.poll(faellig).toBeUndefined();
  await plan.getByRole('button', { name: 'Nächste Woche' }).click();
  await expect(plan.getByRole('button', { name: 'Diese Woche' })).toBeVisible();
});

test('Heute: „Jetzt dran“ schlägt ein passendes To-do vor, 🍅 Los startet den Fokus (E123)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  // feste Uhrzeit 10:00 Wien (sonst ist nach 22 Uhr Feierabend) und ein leerer Kalender
  await page.clock.setFixedTime(new Date(`${heute}T10:00:00+01:00`));
  await page.route('**/api/kalender?*', (r) => r.fulfill({ json: { modus: 'aus', kalender: [], termine: [] } }));
  const titel = `Jetzt-Test ${Date.now() % 100000}`;
  await page.request.post('/api/todos', { headers: { origin: ORIGIN }, data: { titel, faellig: '2020-01-01', wichtig: true, dauer: 20, notiz: '- [ ] Erster Schritt' } });
  await page.goto('/heute');
  const j = page.getByRole('region', { name: 'Jetzt dran' });
  await expect(j).toContainText(titel);
  await expect(j).toContainText('nächster Schritt: Erster Schritt');
  await expect(j).toContainText('bis 22 Uhr');
  await j.getByRole('button', { name: `Fokus starten: ${titel}` }).click();
  await expect(page).toHaveURL(/\/fokus$/);
  await expect(page.locator('.fokus-thema')).toHaveText(titel);
  await page.request.post('/api/kirchturm', { headers: { origin: ORIGIN }, data: { befehl: 'pomodoro', aktion: 'stopp' } });
});

test('To-do-Brett: Filter nach Text, ⭐ und Gruppe (E125)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  const o = { origin: ORIGIN };
  const p = `F${Date.now() % 100000}`;
  for (let i = 0; i < 5; i++) await page.request.post('/api/todos', { headers: o, data: { titel: `${p} Kleinkram ${i}` } });
  await page.request.post('/api/todos', { headers: o, data: { titel: `${p} Wichtig`, wichtig: true } });
  await page.request.post('/api/todos', { headers: o, data: { titel: `${p} Mathe-Blatt`, gruppe: `Mathe${p}` } });
  await page.goto('/gebaeude/Marktplatz?reiter=todo');
  const f = page.getByRole('group', { name: 'Filter' });
  await f.getByRole('searchbox', { name: 'To-dos filtern' }).fill(`${p} Klein`);
  await expect(page.locator('li.todo', { hasText: p })).toHaveCount(5);
  await f.getByRole('searchbox', { name: 'To-dos filtern' }).fill(p);
  await f.getByRole('button', { name: `Mathe${p}` }).click();
  await expect(page.locator('li.todo', { hasText: p })).toHaveCount(1);
  await expect(page.locator('li.todo', { hasText: `${p} Mathe-Blatt` })).toBeVisible();
  await f.getByRole('button', { name: '⭐' }).click();
  await expect(page.locator('li.todo', { hasText: p })).toHaveCount(1);
  await expect(page.locator('li.todo', { hasText: `${p} Wichtig` })).toBeVisible();
  await f.getByRole('button', { name: 'Alle', exact: true }).click();
  await expect(page.locator('li.todo', { hasText: p })).toHaveCount(7);
  // E158: ⏳ Wartet
  await page.request.post('/api/todos', { headers: o, data: { titel: `${p} Antwort`, wartet: 'Prof' } });
  await page.reload();
  await f.getByRole('searchbox', { name: 'To-dos filtern' }).fill(p);
  await f.getByRole('button', { name: '⏳ Wartet' }).click();
  await expect(page.locator('li.todo', { hasText: p })).toHaveCount(1);
  await expect(page.locator('li.todo', { hasText: `${p} Antwort` })).toBeVisible();
});

test('Wochenplan: „Woche verteilen“ schlägt Tage vor, Übernehmen setzt die Fälligkeit (E126)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  await page.clock.setFixedTime(new Date(`${heute}T10:00:00+01:00`));
  const todos = [
    { pfad: 'Marktplatz/todos/a.md', version: 'v1', titel: 'Bericht schreiben', erledigt: false, wichtig: true, dauer: 120 },
    { pfad: 'Marktplatz/todos/b.md', version: 'v1', titel: 'Kleinkram', erledigt: false, dauer: 15 },
  ];
  const patches: unknown[] = [];
  await page.route('**/api/todos', (r) => {
    if (r.request().method() === 'PATCH') {
      patches.push(r.request().postDataJSON());
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({ json: todos });
  });
  await page.route('**/api/kalender?*', (r) => r.fulfill({ json: { modus: 'aus', kalender: [], termine: [] } }));
  await page.goto('/gebaeude/Marktplatz?reiter=wochenplan');
  await page.getByRole('button', { name: '✨ Woche verteilen' }).click();
  const v = page.getByRole('group', { name: 'Vorschlag: Woche verteilen' });
  await expect(v.locator('label')).toHaveCount(2);
  await expect(v.locator('label').first()).toContainText('Bericht schreiben');
  await v.getByRole('checkbox').nth(1).uncheck();
  await v.getByRole('button', { name: 'Übernehmen (1)' }).click();
  await expect(v).toHaveCount(0);
  expect(patches).toEqual([{ pfad: 'Marktplatz/todos/a.md', basisVersion: 'v1', faellig: heute }]);
});

test('To-do aus Text in der App: „… jeden Montag 30 min“ mit Vorschau (E127)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  const titel = `Wäsche${Date.now() % 100000}`;
  await page.goto('/gebaeude/Marktplatz?reiter=todo');
  const f = page.getByRole('form', { name: 'Neues To-do' });
  await f.getByRole('textbox', { name: 'Neues To-do' }).fill(`${titel} jeden Montag 30 min`);
  await expect(page.locator('.todo-text-hinweis')).toContainText(`→ „${titel}“ · 🔁 wöchentlich ab Mo.`);
  await expect(page.locator('.todo-text-hinweis')).toContainText('⏱ 30 min');
  await f.getByRole('button', { name: '+' }).click();
  const z = page.locator('li.todo', { hasText: titel });
  await expect(z).toContainText('🔁 wöchentlich');
  await expect(z).toContainText('⏱ 30 min');
  await expect(page.locator('.todo-text-hinweis')).toHaveCount(0);
});

test('Wochenplanung (/planen): vier Schritte, Häkchen bleiben; Hinweis auf „Heute“ am Sonntag (E129)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  // Sonntag 15:00 Wien → Hinweis auf Heute, geplant wird die kommende Woche
  await page.clock.setFixedTime(new Date('2026-11-22T15:00:00+01:00'));
  await page.goto('/heute');
  await page.getByRole('link', { name: /Zeit für die Wochenplanung/ }).click();
  await expect(page).toHaveURL(/\/planen$/);
  const p = page.getByRole('region', { name: 'Wochenplanung' });
  for (const n of ['1 · Zurückschauen', '2 · Drei Ziele', '3 · Woche verteilen', '4 · Gewohnheiten']) await expect(p.getByRole('region', { name: n })).toBeVisible();
  await expect(p.getByRole('region', { name: 'Wochenplan' })).toContainText('23.11.');
  // E165: Projekte aufklappbar unter den Zielen
  await p.getByText('📁 Deine Projekte ansehen').click();
  await expect(p.getByRole('region', { name: '2 · Drei Ziele' }).locator('.projekte, .projekte-leer').first()).toBeVisible();
  await p.getByRole('checkbox', { name: '1 · Zurückschauen erledigt' }).check();
  await expect(p).toContainText('1/4 erledigt');
  await page.reload();
  await expect(page.getByRole('checkbox', { name: '1 · Zurückschauen erledigt' })).toBeChecked();
  for (const n of ['2 · Drei Ziele', '3 · Woche verteilen', '4 · Gewohnheiten']) await page.getByRole('checkbox', { name: `${n} erledigt` }).check();
  await expect(page.getByRole('region', { name: 'Wochenplanung' })).toContainText('4/4 erledigt – gute Woche!');
  await page.goto('/heute');
  await expect(page.getByRole('link', { name: /Zeit für die Wochenplanung/ })).toHaveCount(0);
});

test('Fokus-Vollbild: Schritte des To-dos abhaken und ergänzen, ohne den Fokus zu verlassen (E136)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  const o = { origin: ORIGIN };
  const titel = `Fokus-Schritte ${Date.now() % 100000}`;
  const t = await (await page.request.post('/api/todos', { headers: o, data: { titel, notiz: '- [ ] Lesen\n- [ ] Rechnen' } })).json();
  await page.request.post('/api/kirchturm', { headers: o, data: { befehl: 'pomodoro_fuer', titel, pfad: t.pfad } });
  await page.goto('/fokus');
  const g = page.getByRole('group', { name: 'Schritte im Fokus' });
  await g.getByRole('checkbox', { name: 'Schritt erledigt: Lesen' }).check();
  await g.getByRole('textbox', { name: 'Schritt hinzufügen' }).fill('Aufschreiben');
  await g.getByRole('textbox', { name: 'Schritt hinzufügen' }).press('Enter');
  await expect(g.getByText('Aufschreiben', { exact: true })).toBeVisible();
  await expect
    .poll(async () => ((await (await page.request.get('/api/todos')).json()) as { pfad: string; schritte?: { text: string; erledigt: boolean }[] }[]).find((x) => x.pfad === t.pfad)?.schritte)
    .toEqual([
      { text: 'Lesen', erledigt: true },
      { text: 'Rechnen', erledigt: false },
      { text: 'Aufschreiben', erledigt: false },
    ]);
  await page.request.post('/api/kirchturm', { headers: o, data: { befehl: 'pomodoro', aktion: 'stopp' } });
});

test('Uni: Lernziel je Fach pro Woche setzen, Balken erscheint (E137)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  const fach = `Lernziel${Date.now() % 100000}`;
  await page.request.post('/api/uni/fach', { headers: { origin: ORIGIN }, data: { name: fach } });
  await page.goto('/gebaeude/Uni?reiter=studium');
  const k = page.getByRole('region', { name: `Fach ${fach}` });
  await k.getByRole('button', { name: `Lernziel: ${fach}` }).click();
  await k.getByRole('spinbutton', { name: `Stunden pro Woche für ${fach}` }).fill('4');
  await k.getByRole('button', { name: 'Speichern' }).click();
  await expect(k.getByRole('meter', { name: `Lernziel ${fach}` })).toContainText('0 min von 4 h diese Woche');
  const datei = await (await page.request.get(`/api/vault/datei?pfad=${encodeURIComponent('Uni/lernziele.md')}`)).json();
  expect(datei.inhalt).toContain(`${fach}: 4`);
});

test('Tastenkürzel: ? Übersicht, g w Wochenplan, n neues To-do, f Fokus; im Feld wirken sie nicht (E138)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'nur am PC');
  await anmelden(page);
  await page.goto('/heute');
  await expect(page.getByRole('heading', { name: /, Leif$/ })).toBeVisible();
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Tastenkürzel' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Tastenkürzel' })).toHaveCount(0);
  await page.keyboard.press('g');
  await page.keyboard.press('w');
  await expect(page).toHaveURL(/reiter=wochenplan$/);
  await page.keyboard.press('n');
  await expect(page).toHaveURL(/\/heute$/);
  const feld = page.getByRole('textbox', { name: 'Neues To-do' }).first();
  await expect(feld).toBeFocused();
  // im Feld getippt: „f“ ist ein Buchstabe, keine Navigation
  await feld.type('fg');
  await expect(feld).toHaveValue('fg');
  await expect(page).toHaveURL(/\/heute$/);
  await feld.fill('');
  await feld.blur();
  // bei offenem Fenster (hier: Befehlspalette) ruhen die Kürzel (E145)
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Befehlspalette' });
  await expect(palette).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('f');
  await expect(page).toHaveURL(/\/heute$/);
  await page.mouse.click(5, 5);
  await expect(palette).toHaveCount(0);
  await page.keyboard.press('f');
  await expect(page).toHaveURL(/\/fokus$/);
});

test('Uni → Prüfungen: Cockpit mit Countdown, Schritten, Fokus, Karten; Lernplan öffnet (E140)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await page.route('**/api/uni/pruefungen', (r) =>
    r.fulfill({
      json: [
        { id: 'p1', titel: 'Short Exam 2', fach: 'NLP', frist: new Date(Date.now() + 2 * 86_400_000).toISOString(), tage: 2, todo: { pfad: 'Marktplatz/todos/x.md', titel: 'Prüfung: Short Exam 2', schritteFertig: 1, schritte: 5, naechster: 'Lernplan anlegen' }, fokus14Tage: 95, karten: { gesamt: 40, gelernt: 12, faellig: 6, fach: 'nlp-ordner' }, lernzielMin: 180 },
        { id: 'p2', titel: 'Klausur ohne Kurs', fach: 'Klausur ohne Kurs', frist: new Date(Date.now() + 5 * 86_400_000).toISOString(), tage: 5, fokus14Tage: 0, ohneFach: true },
      ],
    }),
  );
  await anmelden(page);
  await page.goto('/gebaeude/Uni?reiter=pruefungen');
  const k = page.getByRole('article', { name: 'Prüfung Short Exam 2' });
  await expect(k.getByLabel('in 2 Tagen')).toBeVisible();
  await expect(k).toContainText('Schritte 1/5');
  await expect(k).toContainText('als Nächstes: Lernplan anlegen');
  await expect(k).toContainText('1 h 35 min gelernt (14 Tage)');
  await expect(k).toContainText('Ziel 6 h');
  await expect(k).toContainText('12/40 Karten sitzen');
  // Karten-Link nutzt den Ordnernamen der Karten; ohne Fach kein „Lernen“ (E145)
  await expect(k.getByRole('link', { name: 'Karten üben' })).toHaveAttribute('href', '/gebaeude/Uni?reiter=karten&fach=nlp-ordner');
  const ohne = page.getByRole('article', { name: 'Prüfung Klausur ohne Kurs' });
  await expect(ohne.getByRole('button', { name: '📅 Lernplan' })).toBeVisible();
  await expect(ohne.getByRole('button', { name: /Lernen starten/ })).toHaveCount(0);
  await k.getByRole('button', { name: '📅 Lernplan' }).click();
  await expect(k.getByRole('group', { name: 'Lernzeit für NLP' })).toBeVisible();
});

test('Heute ab 18 Uhr: „Morgen im Blick“ mit To-dos und freier Zeit (E141)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  const morgen = new Date(Date.parse(`${heute}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  await page.clock.setFixedTime(new Date(`${heute}T19:00:00+01:00`));
  await page.route('**/api/kalender?*', (r) => r.fulfill({ json: { modus: 'aus', kalender: [], termine: [] } }));
  const titel = `Morgen-Test ${Date.now() % 100000}`;
  await page.request.post('/api/todos', { headers: { origin: ORIGIN }, data: { titel, faellig: morgen, dauer: 45 } });
  await page.goto('/heute');
  const k = page.getByRole('region', { name: 'Morgen im Blick' });
  await expect(k).toContainText(titel);
  await expect(k).toContainText('frei ≈ 14 h');
});

test('Statistik: Fokus nach Tageszeit mit bester Spanne (E144)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await page.route('**/api/statistik?*', async (r) => {
    const echt = await (await r.fetch()).json();
    const werte = Array.from({ length: 24 }, (_, h) => (h === 9 ? 80 : h === 10 ? 60 : h === 15 ? 20 : 0));
    return r.fulfill({ json: { ...echt, fokusJeStunde: werte, besteZeit: { von: 9, bis: 11, min: 140 } } });
  });
  await anmelden(page);
  await page.goto('/gebaeude/Rathaus?reiter=statistik');
  const d = page.getByRole('figure', { name: '🕘 Fokus nach Tageszeit' });
  await expect(d).toContainText('am konzentriertesten: 9–11 Uhr');
  await expect(d.locator('.statistik-balken.beste')).toHaveCount(2);
});

test('Seite lässt sich nicht laden (nach Deploy): einmal neu laden, dann „Neu laden“ statt weißer Seite (Review)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.goto('/');
  await page.route(/\/assets\/Anleitung-[^/]+\.js$/, (r) => r.abort());
  await page.evaluate(() => {
    history.pushState(null, '', '/anleitung');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('alert').filter({ hasText: 'Diese Seite ließ sich nicht laden' })).toBeVisible({ timeout: 15_000 });
  await page.unroute(/\/assets\/Anleitung-[^/]+\.js$/);
  await page.getByRole('button', { name: 'Neu laden' }).click();
  await expect(page.getByRole('heading', { name: 'So nutzt du das Dorf' })).toBeVisible();
});

test('Anleitung: erreichbar über Befehlspalette, Links führen weiter', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.goto('/anleitung');
  await expect(page.getByRole('heading', { name: 'So nutzt du das Dorf' })).toBeVisible();
  await page.getByRole('link', { name: 'Vollbild' }).click();
  await expect(page).toHaveURL(/\/fokus$/);
});

test('Heute: Mails, die eine Antwort brauchen, als Hinweis', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  const mail = (id: string, antwortNoetig: boolean) => ({ id, threadId: id, von: 'Prof. X', betreff: `Betreff ${id}`, datum: new Date().toISOString(), kategorie: 'Uni', wichtig: true, antwortNoetig, zusammenfassung: null, frist: null, eingeordnet: true });
  await page.route('**/api/post', (r) => r.fulfill({ json: { verbunden: true, einordnungMoeglich: true, laeuft: false, letzter: null, mails: [mail('a', true), mail('b', true), mail('c', false)] } }));
  await anmelden(page);
  await page.goto('/heute');
  await expect(page.locator('.heute-zahlen')).toContainText('✉️ 2 Mails warten auf Antwort');
});

test('Gewohnheit bearbeiten: Tage und Uhrzeit ändern', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.request.post('/api/gewohnheiten', { headers: { origin: ORIGIN }, data: { name: 'Bearbeiten-Test' } });
  await page.goto('/heute');
  const k = page.getByRole('region', { name: 'Gewohnheiten' });
  await k.getByRole('button', { name: 'Bearbeiten' }).click();
  await k.getByLabel('Wann: Bearbeiten-Test').selectOption('3x pro woche');
  await k.getByLabel('Uhrzeit: Bearbeiten-Test').fill('06:45');
  await k.getByLabel('Uhrzeit: Bearbeiten-Test').blur();
  await k.getByRole('button', { name: 'Fertig' }).click();
  await expect(k.locator('.gewohnheit', { hasText: 'Bearbeiten-Test' })).toContainText('06:45');
  await expect(k.locator('.gewohnheit', { hasText: 'Bearbeiten-Test' })).toContainText('diese Woche');
  // aufräumen: sonst läutet die 06:45-Erinnerung ab 06:45 Wiener Zeit im Testserver und ihr Hinweis liegt über
  // späteren Tests (3D-Dorf-Klicks liefen in die Zeitüberschreitung)
  await page.request.delete('/api/gewohnheiten?name=Bearbeiten-Test', { headers: { origin: ORIGIN } });
});

test('Tag abschließen (/abschluss): Erledigtes, Offenes auf morgen, ⭐ für morgen, Kopf leeren (E146)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  const morgen = new Date(Date.parse(`${heute}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const n = Date.now() % 100000;
  const fertig = (await (await page.request.post('/api/todos', { headers: { origin: ORIGIN }, data: { titel: `Abschluss-fertig ${n}`, faellig: heute } })).json()) as { pfad: string; version: string };
  await page.request.patch('/api/todos', { headers: { origin: ORIGIN }, data: { pfad: fertig.pfad, basisVersion: fertig.version, erledigt: true } });
  await page.request.post('/api/todos', { headers: { origin: ORIGIN }, data: { titel: `Abschluss-offen ${n}`, faellig: heute } });
  await page.goto('/abschluss');
  await expect(page.getByRole('heading', { name: '🌙 Tag abschließen' })).toBeVisible();
  const geschafft = page.getByRole('region', { name: '1 · Geschafft' });
  await expect(geschafft).toContainText(`✓ Abschluss-fertig ${n}`);
  const offen = page.getByRole('region', { name: '2 · Offenes verteilen' });
  await expect(offen).toContainText(`Abschluss-offen ${n}`);
  await offen.getByRole('button', { name: `Abschluss-offen ${n} auf morgen` }).click();
  await expect(offen).not.toContainText(`Abschluss-offen ${n}`);
  const t = ((await (await page.request.get('/api/todos')).json()) as { titel: string; faellig?: string }[]).find((x) => x.titel === `Abschluss-offen ${n}`)!;
  expect(t.faellig).toBe(morgen);
  // jetzt steht es unter „für morgen“ und bekommt einen ⭐
  const drei = page.getByRole('region', { name: '3 · Die drei für morgen' });
  await drei.getByRole('button', { name: `Abschluss-offen ${n} als wichtig markieren` }).click();
  await expect(drei.getByRole('button', { name: `Abschluss-offen ${n} nicht mehr wichtig` })).toBeVisible();
  // Kopf leeren → Tagesnotiz, Schritt 4 abgehakt
  const kopf = page.getByRole('region', { name: '4 · Kopf leeren' });
  await kopf.getByLabel('Gedanken für die Tagesnotiz').fill(`Abschluss-Gedanke ${n}`);
  await kopf.getByRole('button', { name: 'In die Notiz' }).click();
  await expect(kopf).toContainText('In der Tagesnotiz');
  await expect(page.getByRole('checkbox', { name: '4 · Kopf leeren erledigt' })).toBeChecked();
  await expect(page.getByText('1/4 erledigt')).toBeVisible();
});

test('Wartet auf …: aus Text erkannt, ruht unter „⏳ Wartet auf“, im Brett bearbeitbar (E147)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  const n = Date.now() % 100000;
  await page.goto('/heute');
  const feld = page.getByRole('textbox', { name: 'Neues To-do' }).first();
  await feld.fill(`Note Mathe ${n} wartet auf Prof. Müller`);
  await expect(page.getByText('⏳ wartet auf Prof. Müller')).toBeVisible();
  await feld.press('Enter');
  const gruppe = page.locator('.heute-gruppe.wartend');
  await expect(gruppe).toContainText(`Note Mathe ${n}`);
  await expect(gruppe).toContainText('⏳ Prof. Müller');
  // im Brett: Abzeichen, bearbeiten → wartet nicht mehr
  await page.goto('/gebaeude/Marktplatz?reiter=todo');
  const zeile = page.locator('li.todo', { hasText: `Note Mathe ${n}` });
  await expect(zeile.locator('.abzeichen.wartet')).toHaveText('⏳ Prof. Müller');
  await zeile.getByRole('button', { name: `Note Mathe ${n}`, exact: true }).click();
  const form = page.locator('li.todo.bearbeiten');
  await expect(form.getByLabel('Wartet auf')).toHaveValue('Prof. Müller');
  await form.getByLabel('Wartet auf').fill('');
  await form.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('li.todo', { hasText: `Note Mathe ${n}` }).locator('.abzeichen.wartet')).toHaveCount(0);
});

test('Fokus: Gedanken parken → Tagesnotiz, in der Pause „→ To-do“ (E148)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.evaluate(() => sessionStorage.clear());
  const n = Date.now() % 100000;
  // Pomodoro starten, Gedanken parken während der Arbeit
  await page.request.post('/api/kirchturm', { headers: { origin: ORIGIN }, data: { befehl: 'pomodoro', aktion: 'start' } });
  await page.goto('/fokus');
  const park = page.getByRole('group', { name: 'Gedanken parken' });
  await park.getByLabel('Gedanke parken').fill(`Mail an Prof ${n}`);
  await park.getByLabel('Gedanke parken').press('Enter');
  await expect(park).toContainText(`💭 Mail an Prof ${n}`);
  await expect(park.getByRole('button', { name: `Mail an Prof ${n} als To-do` })).toHaveCount(0);
  const notiz = (await (await page.request.get('/api/notizen')).json()) as unknown;
  expect(JSON.stringify(notiz)).toContain(`💭 Mail an Prof ${n}`);
  // Stopp → keine Arbeitsphase mehr → „→ To-do“
  await page.request.post('/api/kirchturm', { headers: { origin: ORIGIN }, data: { befehl: 'pomodoro', aktion: 'stopp' } });
  await page.reload();
  await park.getByRole('button', { name: `Mail an Prof ${n} als To-do` }).click();
  await expect(park).toContainText('✓ To-do');
  const todos = (await (await page.request.get('/api/todos')).json()) as { titel: string }[];
  expect(todos.some((t) => t.titel === `Mail an Prof ${n}`)).toBe(true);
});

test('Energie am To-do: im Brett 🧠 wählen, Abzeichen im Brett und auf Heute (E151)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  const n = Date.now() % 100000;
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  await page.request.post('/api/todos', { headers: { origin: ORIGIN }, data: { titel: `Beweis ${n}`, faellig: heute } });
  await page.goto('/gebaeude/Marktplatz?reiter=todo');
  await page.locator('li.todo', { hasText: `Beweis ${n}` }).getByRole('button', { name: `Beweis ${n}`, exact: true }).click();
  const form = page.locator('li.todo.bearbeiten');
  await form.getByLabel('Energie').selectOption('hoch');
  await form.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('li.todo', { hasText: `Beweis ${n}` }).locator('.abzeichen', { hasText: '🧠' })).toBeVisible();
  await page.goto('/heute');
  await expect(page.locator('.heute-todo', { hasText: `Beweis ${n}` }).locator('[title="braucht Konzentration"]')).toBeVisible();
});

test('Aufschiebe-Zähler: nach dreimal Verschieben ↻ 3× auf Heute (E153)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  const tag = (n: number) => new Date(Date.parse(`${heute}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const titel = `Steuer ${Date.now() % 100000}`;
  let t = (await (await page.request.post('/api/todos', { headers: { origin: ORIGIN }, data: { titel, faellig: tag(-1) } })).json()) as { pfad: string; version: string };
  for (const f of [tag(1), tag(-1), tag(1), tag(-1), tag(1)])
    t = (await (await page.request.patch('/api/todos', { headers: { origin: ORIGIN }, data: { pfad: t.pfad, basisVersion: t.version, faellig: f } })).json()) as typeof t;
  await page.goto('/heute');
  await expect(page.locator('.heute-todo', { hasText: titel }).getByText('↻ 3×')).toBeVisible();
});

test('Fokus: Rauschen an und aus, Art wählbar (E155)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.request.post('/api/kirchturm', { headers: { origin: ORIGIN }, data: { befehl: 'pomodoro', aktion: 'start' } });
  await page.goto('/fokus');
  const r = page.getByRole('group', { name: 'Rauschen' });
  await r.getByRole('button', { name: '🔊 Rauschen' }).click();
  await expect(r.getByRole('button', { name: '🔇 Rauschen aus' })).toHaveAttribute('aria-pressed', 'true');
  await r.getByLabel('Art des Rauschens').selectOption('rosa');
  expect(await page.evaluate(() => localStorage.getItem('dorf-rauschen'))).toBe('rosa');
  await r.getByRole('button', { name: '🔇 Rauschen aus' }).click();
  await expect(r.getByRole('button', { name: '🔊 Rauschen' })).toBeVisible();
  await page.request.post('/api/kirchturm', { headers: { origin: ORIGIN }, data: { befehl: 'pomodoro', aktion: 'stopp' } });
});

test('Heute: Tagesleiste 8–22 Uhr mit Terminen, freien Lücken und Jetzt-Linie (E157)', async ({ page }, info) => {
  await anmelden(page);
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  await page.clock.setFixedTime(new Date(`${heute}T11:00:00+01:00`));
  const termin = (id: string, titel: string, von: string, bis: string) => ({ id, kalenderId: 'k', titel, start: `${heute}T${von}:00+01:00`, ende: `${heute}T${bis}:00+01:00`, ganztags: false, ort: null, quelle: 'google', farbe: null });
  const termine = [termin('a', 'Analysis VO', '09:00', '10:30'), termin('b', 'Mittag mit Jonas', '12:00', '13:00'), termin('c', 'Sport', '18:00', '19:30'), termin('d', '⏰ Übung 3 ist fällig', '15:00', '15:30')];
  let antwort: object = { modus: 'google', kalender: [{ id: 'k', name: 'Leif', farbe: '#4a86e8' }], termine };
  await page.route('**/api/kalender?*', (r) => r.fulfill({ json: antwort }));
  await page.goto('/heute');
  const karte = page.getByRole('region', { name: 'Termine' });
  // 14 h − (1,5 + 1 + 1,5) h; der Fristen-Block zählt nicht
  const leiste = karte.getByRole('img', { name: 'Tagesleiste: 3 Termine, frei ≈ 10 h' });
  await expect(leiste).toBeVisible();
  await expect(leiste.locator('.tagesleiste-block')).toHaveCount(3);
  await expect(leiste.locator('.tagesleiste-block').first()).toHaveAttribute('title', '09:00–10:30 Analysis VO');
  await expect(leiste.locator('.tagesleiste-frei')).toHaveCount(4);
  await expect(leiste.locator('.tagesleiste-frei').nth(2)).toHaveAttribute('title', 'frei 13:00–18:00');
  await expect(leiste.locator('.tagesleiste-jetzt')).toHaveCount(1);
  await expect(leiste.locator('.tagesleiste-stunden span')).toHaveCount(8);
  await karte.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('tagesleiste.png') });
  // die Leiste ragt (auch am Handy) nicht über die Karte hinaus
  const [kb, lb] = [await karte.boundingBox(), await leiste.boundingBox()];
  expect(lb!.x).toBeGreaterThanOrEqual(kb!.x);
  expect(lb!.x + lb!.width).toBeLessThanOrEqual(kb!.x + kb!.width);

  // nach 22 Uhr: keine Jetzt-Linie; ohne Termine ganz frei
  antwort = { modus: 'google', kalender: [], termine: [] };
  await page.clock.setFixedTime(new Date(`${heute}T22:30:00+01:00`));
  await page.goto('/heute');
  const leer = page.getByRole('img', { name: 'Tagesleiste: keine Termine, frei ≈ 14 h' });
  await expect(leer).toBeVisible();
  await expect(leer.locator('.tagesleiste-jetzt')).toHaveCount(0);
  await expect(leer.locator('.tagesleiste-frei')).toHaveAttribute('title', 'frei 08:00–22:00');

  // Kalender nicht verbunden: keine Leiste
  antwort = { modus: 'aus', kalender: [], termine: [] };
  await page.goto('/heute');
  await expect(page.getByRole('region', { name: 'Termine' })).toContainText('Noch kein Kalender eingerichtet.');
  await expect(page.locator('.tagesleiste')).toHaveCount(0);
});

test('Marktplatz → Projekte: Gruppe als Projekt mit Fortschritt und nächstem Schritt (E161)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  const g = `Projekt${Date.now() % 100000}`;
  const o = { origin: ORIGIN };
  const erst = (await (await page.request.post('/api/todos', { headers: o, data: { titel: `${g} Gliederung`, gruppe: g } })).json()) as { pfad: string; version: string };
  await page.request.patch('/api/todos', { headers: o, data: { pfad: erst.pfad, basisVersion: erst.version, erledigt: true } });
  await page.request.post('/api/todos', { headers: o, data: { titel: `${g} Kapitel 1`, gruppe: g, wichtig: true } });
  await page.request.post('/api/todos', { headers: o, data: { titel: `${g} Kapitel 2`, gruppe: g } });
  await page.goto('/gebaeude/Marktplatz?reiter=projekte');
  const k = page.getByRole('article', { name: `Projekt ${g}` });
  await expect(k).toContainText('1/3 erledigt');
  await expect(k.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33');
  await expect(k).toContainText(`👉 ${g} Kapitel 1`);
});

test('Statistik: „💡 Was gute Tage ausmacht“ bei genug Stimmungs-Tagen (E162)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  const tage = Array.from({ length: 28 }, (_, i) => ({
    tag: new Date(Date.UTC(2026, 9, 23 + i)).toISOString().slice(0, 10),
    erledigt: 0,
    fokusMin: i % 2 ? 90 : 0,
    gewohnheitenFaellig: 0,
    gewohnheitenErledigt: 0,
    stimmung: i < 8 ? (i % 2 ? 5 : 2) : null,
  }));
  await page.route('**/api/statistik?*', (r) =>
    r.fulfill({ json: { tage, summen: { erledigt: 0, erledigtWoche: 0, fokusMin: 1260, fokusMinWoche: 270, gewohnheitenQuote: null, stimmungSchnitt: 3.5, aktiveTage: 14 }, fokusJeStunde: Array(24).fill(0), besteZeit: null } }),
  );
  await page.goto('/gebaeude/Rathaus?reiter=statistik');
  const k = page.getByRole('note', { name: 'Was gute Tage ausmacht' });
  await expect(k).toContainText('An Tagen mit mindestens 1 h Fokus: Stimmung ⌀ 5 – sonst 2');
});

test('Morgen im Blick warnt vor Überschneidungen (E168)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  const morgen = new Date(Date.parse(`${heute}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  await page.clock.setFixedTime(new Date(`${heute}T19:00:00+01:00`));
  const termin = (id: string, titel: string, a: string, b: string) => ({ id, kalenderId: 'k', titel, start: `${morgen}T${a}:00+01:00`, ende: `${morgen}T${b}:00+01:00`, ganztags: false });
  await page.route('**/api/kalender?*', (r) =>
    r.fulfill({ json: { modus: 'google', kalender: [{ id: 'k', name: 'Leif', farbe: '#4a86e8', primaer: true, schreibbar: true }], termine: [termin('a', 'Vorlesung', '10:00', '12:00'), termin('b', 'Zahnarzt', '11:30', '12:15')] } }),
  );
  await page.goto('/heute');
  const k = page.getByRole('region', { name: 'Morgen im Blick' });
  await expect(k).toContainText('⚠️ Überschneidung: 10:00 Vorlesung ↔ 11:30 Zahnarzt');
});

test('In Etappen planen: 🪜 zeigt die Vorschau, „Etappen anlegen“ macht ein Projekt daraus (E170)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  const frist = new Date(Date.parse(`${heute}T12:00:00Z`) + 4 * 86_400_000).toISOString().slice(0, 10);
  const titel = `Referat ${Date.now() % 100000}`;
  await page.request.post('/api/todos', { headers: { origin: ORIGIN }, data: { titel, faellig: frist, dauer: 180 } });
  await page.goto('/gebaeude/Marktplatz?reiter=todo');
  await page.getByRole('button', { name: `Etappen: ${titel}` }).click();
  const g = page.getByRole('group', { name: `Etappen für ${titel}` });
  await expect(g.locator('li')).toHaveCount(3);
  await expect(g).toContainText(`${titel} – Etappe 1/3`);
  await g.getByRole('button', { name: 'Etappen anlegen' }).click();
  await expect(page.locator('li.todo', { hasText: `${titel} – Etappe 3/3` })).toBeVisible();
  await page.goto('/gebaeude/Marktplatz?reiter=projekte');
  const k = page.getByRole('article', { name: `Projekt ${titel}` });
  await expect(k).toContainText('0/4 erledigt');
  // E172: Frist mit Countdown
  await expect(k).toContainText(`🏁 Frist ${frist} (in 4 Tagen)`);
});

test('Heute: Hinweis auf ein Projekt, das hinterher ist (E174)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.route('**/api/projekte', (r) =>
    r.fulfill({ json: [{ name: 'Referat', gesamt: 4, erledigt: 0, offen: 4, dieseWoche: 0, fokusMin: 0, ruhtTage: 1, hinterher: 2, frist: '2026-12-01', ruhtMelden: false, naechster: { pfad: 'Marktplatz/todos/x.md', titel: 'Referat – Etappe 1/3' } }] }),
  );
  await page.goto('/heute');
  const l = page.getByRole('link', { name: /Referat – 2 Schritte hinterher/ });
  await expect(l).toContainText('👉 Referat – Etappe 1/3');
  await l.click();
  await expect(page).toHaveURL(/reiter=projekte/);
});

test('Befehlspalette springt zu den Projekten (E177)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.goto('/heute');
  await expect(page.getByRole('heading', { name: /, Leif$/ })).toBeVisible();
  await page.keyboard.press('Control+k');
  const p = page.getByRole('dialog', { name: 'Befehlspalette' });
  const feld = p.getByLabel('Befehl oder Suche');
  await feld.fill('projekte');
  await expect(p.getByRole('option').first()).toContainText('Projekte');
  await feld.press('Enter');
  await expect(page).toHaveURL(/reiter=projekte/);
});

test('Nach Update suchen: von Hand in den Einstellungen – kein automatisches Prüfen mehr', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'einmal reicht');
  await anmelden(page);
  await page.goto('/einstellungen');
  await expect(page.getByText(/Dorf-Stand .* · diese Seite gebaut am/)).toBeVisible();
  // von selbst passiert nichts: auch wenn der Server ein neues Skript liefert, fragt die App nicht nach
  let gefragt = 0;
  await page.route('**/index.html?v=*', (r) => {
    gefragt++;
    return r.fulfill({ contentType: 'text/html', body: '<!doctype html><script type="module" crossorigin src="/assets/index-NEU123.js"></script>' });
  });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(500);
  expect(gefragt).toBe(0);
  // gleiche Fassung → „schon aktuell“
  await page.unroute('**/index.html?v=*');
  await page.getByRole('button', { name: '🔄 Nach Update suchen' }).click();
  await expect(page.getByText('Du hast schon die neueste Version.')).toBeVisible();
  // neue Fassung → lädt neu
  await page.route('**/index.html?v=*', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><script type="module" crossorigin src="/assets/index-NEU123.js"></script>' }));
  const neuGeladen = page.waitForEvent('load');
  await page.getByRole('button', { name: '🔄 Nach Update suchen' }).click();
  await neuGeladen;
  await page.unroute('**/index.html?v=*');
  await expect(page.getByRole('button', { name: '🔄 Nach Update suchen' })).toBeVisible();
});

test('Einstellungen: Cardputer koppeln – Code, Gerät erscheint, Sperren → Schlüssel gilt nicht mehr (E182)', async ({ page, request }, info) => {
  await anmelden(page);
  await page.goto('/einstellungen');
  await page.getByRole('button', { name: 'Cardputer koppeln' }).click();
  const code = ((await page.getByLabel('Kopplungscode').textContent()) ?? '').trim();
  expect(code).toMatch(/^\d{6}$/);
  await expect(page.getByText('Agentendorf → Einstellungen → Koppeln')).toBeVisible();
  await expect(page.getByText(new URL(ORIGIN).host, { exact: true })).toBeVisible();
  await expect(page.getByText(/noch [45]:\d\d gültig/)).toBeVisible();
  // der Cardputer koppelt sich (eigene Anfrage, ohne Cookie und ohne Origin)
  const name = `Cardputer ${info.project.name}`;
  const r = await request.post('/api/geraet/koppeln', { data: { code, name } });
  expect(r.ok()).toBe(true);
  const { token } = (await r.json()) as { token: string };
  const g = { authorization: `Bearer ${token}` };
  await expect(page.getByText('Gekoppelt ✓')).toBeVisible();
  const zeile = page.getByRole('row').filter({ hasText: name });
  await expect(zeile).toBeVisible();
  expect((await request.get('/api/geraet/start', { headers: g })).status()).toBe(200);
  // derselbe Code gilt kein zweites Mal
  expect((await request.post('/api/geraet/koppeln', { data: { code } })).status()).toBe(401);
  page.once('dialog', (d) => d.accept());
  await zeile.getByRole('button', { name: 'Sperren' }).click();
  await expect(zeile).toHaveCount(0);
  expect((await request.get('/api/geraet/start', { headers: g })).status()).toBe(401);
});
