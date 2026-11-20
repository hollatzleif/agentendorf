import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

/**
 * E197 – Editor im Codehaus: Monaco, Dateibaum, Suche, Git, Terminal und Agent in der Dorf-App, auf Desktop und Handy.
 * Dahinter läuft der ECHTE Runner im Profil coding (server-starten.sh) mit dem Projekt „spielwiese“ (Git, ein Commit).
 * Desktop und Handy teilen sich das Projekt – jeder Lauf benutzt eigene Dateinamen und räumt hinter sich auf.
 */
const CODING = `http://127.0.0.1:${process.env.E2E_CODING_PORT ?? Number(process.env.E2E_MOODLE_PORT ?? 3998) - 2}`;
const PW = 'e2e-Passwort-sehr-lang-1';
const P = 'spielwiese';

type EditorHilfe = { wert(): string; original(): string; sprache(): string; thema(): boolean };
const editor = <T>(page: Page, f: (e: EditorHilfe) => T) => page.evaluate(`(${f.toString()})(window.__editor)`) as Promise<T>;
const handy = (info: TestInfo) => info.project.name === 'handy';

async function anmelden(page: Page) {
  await page.addInitScript(() => localStorage.setItem('dorf-ansicht', 'liste'));
  await page.goto('/');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Ins Dorf' }).click();
  await expect(page.getByRole('heading', { name: 'Dorfplatz' })).toBeVisible();
}

async function editorOeffnen(page: Page) {
  await page.request.post(`${CODING}/_test/projekte`, { data: [{ name: P, git: true, geaendert: Date.now() }] });
  await anmelden(page);
  await page.goto(`/codehaus/editor?projekt=${P}`);
  await expect(page.getByTestId('codeeditor')).toBeVisible({ timeout: 20_000 });
}

/** Bereich wählen: am Handy ist immer genau einer sichtbar; am Desktop blendet ein zweiter Klick die Seitenleiste aus */
async function bereich(page: Page, info: TestInfo, name: 'Dateien' | 'Suche' | 'Git' | 'Agent' | 'Editor') {
  const knopf = page.getByRole('navigation', { name: 'Bereiche' }).getByRole('button', { name, exact: true });
  if (name === 'Editor') {
    if (handy(info)) await knopf.click();
    return;
  }
  if (handy(info) || (await knopf.getAttribute('aria-pressed')) !== 'true') await knopf.click();
}

const api = (page: Page, pfad: string) => page.request.get(`/api/coding/editor/datei?projekt=${P}&pfad=${encodeURIComponent(pfad)}`);
const schreibend = (page: Page) => ({ origin: new URL(page.url()).origin });

test('Editor: Projekt wählen, Datei aus dem Baum öffnen, ändern (ungespeichert-Marke), speichern – Inhalt liegt im Container', async ({ page }, info) => {
  const fehler: string[] = [];
  page.on('pageerror', (e) => fehler.push(e.message));
  await page.request.post(`${CODING}/_test/projekte`, { data: [{ name: P, git: true, geaendert: Date.now() }] });
  await anmelden(page);

  // Einstieg über das Codehaus: Reiter „Editor“ → Projektliste → Projekt
  await page.goto('/gebaeude/Codehaus?reiter=editor');
  await page.getByTestId('editor-oeffnen').click();
  await expect(page).toHaveURL(/\/codehaus\/editor$/);
  await page.getByTestId('editor-projekte').getByRole('link', { name: P }).click();
  await expect(page).toHaveURL(new RegExp(`/codehaus/editor\\?projekt=${P}`));
  await expect(page.getByTestId('codeeditor')).toBeVisible({ timeout: 20_000 });

  // Baum: Ordner aufklappen, Datei öffnen
  const baum = page.getByTestId('baum');
  await expect(baum.getByRole('button', { name: 'README.md' })).toBeVisible();
  await baum.getByRole('button', { name: 'src', exact: true }).click();
  await baum.getByRole('button', { name: 'haupt.ts' }).click();
  const tab = page.getByRole('tab', { name: /haupt\.ts/ });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('monaco').locator('.view-lines')).toContainText('gruss');
  expect(await editor(page, (e) => e.sprache())).toBe('typescript');
  // Syntaxhervorhebung: Monaco färbt Schlüsselwörter (mehrere Token-Klassen in der ersten Zeile)
  await expect.poll(() => page.getByTestId('monaco').locator('.view-line').first().locator('span[class*="mtk"]').count()).toBeGreaterThan(1);
  await expect(page.getByTestId('stand')).toHaveText('gespeichert');
  await expect(page.getByTestId('speichern')).toBeDisabled();

  // ändern → Marke „ungespeichert“
  const marke = `// e2e ${info.project.name} ${Date.now()}`;
  await page.getByTestId('monaco').locator('.view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(`${marke}`);
  await expect(tab).toHaveAttribute('data-ungespeichert', 'ja');
  await expect(page.getByTestId('stand')).toContainText('ungespeichert');
  expect(await editor(page, (e) => e.wert())).toContain(marke);
  // noch nichts auf der Platte
  expect(((await (await api(page, 'src/haupt.ts')).json()) as { text: string }).text).not.toContain(marke);

  // speichern: am Desktop mit Strg+S, am Handy mit dem Knopf
  if (handy(info)) await page.getByTestId('speichern').click();
  else await page.keyboard.press('Control+s');
  await expect(tab).toHaveAttribute('data-ungespeichert', 'nein');
  await expect(page.getByTestId('stand')).toHaveText('gespeichert');
  expect(((await (await api(page, 'src/haupt.ts')).json()) as { text: string }).text).toContain(marke);

  // jemand anderes ändert die Datei (Agent, Terminal) → Speichern überschreibt nicht, sondern fragt
  await page.request.put('/api/coding/editor/datei', { headers: schreibend(page), data: { projekt: P, pfad: 'src/haupt.ts', text: '// vom Agenten\n' } });
  await page.getByTestId('monaco').locator('.view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' meins');
  await page.getByTestId('speichern').click();
  await expect(page.locator('.ce-konflikt')).toContainText('inzwischen von jemand anderem geändert');
  expect(((await (await api(page, 'src/haupt.ts')).json()) as { text: string }).text).toBe('// vom Agenten\n');
  await page.getByRole('button', { name: /Neu laden \(meine/ }).click();
  await expect(page.locator('.ce-konflikt')).toHaveCount(0);
  await expect.poll(() => editor(page, (e) => e.wert())).toBe('// vom Agenten\n');
  await expect(tab).toHaveAttribute('data-ungespeichert', 'nein');

  // aufräumen: Ausgangszustand wiederherstellen (das Projekt teilen sich Desktop und Handy)
  await page.request.put('/api/coding/editor/datei', { headers: schreibend(page), data: { projekt: P, pfad: 'src/haupt.ts', text: 'export function gruss(name: string) {\n  return `Hallo ${name}`;\n}\n' } });
  expect(fehler).toEqual([]);
});

test('Editor: Dateibaum – neue Datei, umbenennen, hochladen, löschen mit Rückfrage; Schnellsuche (Strg+P) und Volltextsuche', async ({ page }, info) => {
  await editorOeffnen(page);
  const n = info.project.name;
  const baum = page.getByTestId('baum');
  await expect(baum.getByRole('button', { name: 'README.md' })).toBeVisible();

  // neue Datei (in der Projektwurzel) – öffnet sich gleich
  await baum.getByRole('button', { name: 'Neue Datei' }).click();
  const dialog = page.getByRole('dialog', { name: 'Neue Datei' });
  await dialog.getByRole('textbox').fill('../raus.txt');
  await dialog.getByRole('button', { name: 'Anlegen' }).click();
  await expect(dialog).toContainText('..');
  await dialog.getByRole('textbox').fill(`notiz-${n}.md`);
  await dialog.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByRole('tab', { name: new RegExp(`notiz-${n}\\.md`) })).toBeVisible();
  await bereich(page, info, 'Dateien');
  await expect(baum.getByRole('button', { name: `notiz-${n}.md` })).toBeVisible();

  // umbenennen (die neue Datei ist markiert)
  await baum.getByRole('button', { name: `notiz-${n}.md` }).click();
  await bereich(page, info, 'Dateien');
  await baum.getByRole('button', { name: 'Umbenennen' }).click();
  const um = page.getByRole('dialog', { name: /Umbenennen/ });
  await um.getByRole('textbox').fill(`docs-${n}/merkzettel.md`);
  await um.getByRole('button', { name: 'Umbenennen' }).click();
  await expect(page.getByRole('tab', { name: /merkzettel\.md/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: new RegExp(`notiz-${n}`) })).toHaveCount(0);
  await bereich(page, info, 'Dateien');
  await expect(baum.getByRole('button', { name: `docs-${n}`, exact: true })).toBeVisible();
  await expect(baum.getByRole('button', { name: `notiz-${n}.md` })).toHaveCount(0);

  // hochladen: in den markierten Ordner; Binärdatei → nur Download
  await baum.getByRole('button', { name: `docs-${n}`, exact: true }).click();
  await page.getByTestId('hochladen').setInputFiles([
    { name: 'bild.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 1, 2, 3, 255]) },
    { name: 'text.txt', mimeType: 'text/plain', buffer: Buffer.from('hochgeladen\n') },
  ]);
  await expect(baum.getByRole('button', { name: 'bild.bin' })).toBeVisible();
  await baum.getByRole('button', { name: 'text.txt' }).click();
  await expect.poll(() => editor(page, (e) => e.wert())).toBe('hochgeladen\n');
  await bereich(page, info, 'Dateien');
  await baum.getByRole('button', { name: 'bild.bin' }).click();
  await expect(page.getByText(/Binärdatei .* herunterladen/)).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.ce-leer').getByRole('link', { name: /Herunterladen/ }).click()]);
  expect(download.suggestedFilename()).toBe('bild.bin');

  // Schnellsuche: Strg+P (Desktop) bzw. Knopf, Dateiname tippen, Enter
  if (handy(info)) await page.getByRole('button', { name: /Datei öffnen/ }).click();
  else await page.keyboard.press('Control+p');
  const schnell = page.getByRole('dialog', { name: 'Datei öffnen' });
  await schnell.getByRole('textbox').fill('haupt');
  await expect(page.getByTestId('schnell-liste').getByRole('button').first()).toContainText('haupt.ts');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: /haupt\.ts/ })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => editor(page, (e) => e.wert())).toContain('gruss');

  // Volltextsuche im Projekt (ripgrep) → Treffer öffnet die Datei an der Stelle
  await bereich(page, info, 'Suche');
  const suche = page.getByTestId('suche');
  await suche.getByRole('searchbox').fill('apfelstrudel');
  await suche.getByRole('button', { name: 'Suchen' }).click();
  await expect(suche).toContainText('1 Treffer in 1 Datei');
  await suche.getByRole('button', { name: /Suchwort: Apfelstrudel/ }).click();
  await expect(page.getByRole('tab', { name: /README\.md/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.ce-fuss')).toContainText('README.md');

  // löschen mit Rückfrage: erst abbrechen, dann wirklich
  await bereich(page, info, 'Dateien');
  await baum.getByRole('button', { name: `docs-${n}`, exact: true }).click();
  await baum.getByRole('button', { name: 'Löschen' }).click();
  const weg = page.getByRole('dialog', { name: /löschen\?/ });
  await expect(weg).toContainText('Papierkorb');
  await weg.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(baum.getByRole('button', { name: `docs-${n}`, exact: true })).toBeVisible();
  await baum.getByRole('button', { name: 'Löschen' }).click();
  await page.getByRole('dialog', { name: /löschen\?/ }).getByRole('button', { name: 'Löschen' }).click();
  await expect(baum.getByRole('button', { name: `docs-${n}`, exact: true })).toHaveCount(0);
  // die Reiter der gelöschten Dateien sind zu
  await expect(page.getByRole('tab', { name: /merkzettel|text\.txt|bild\.bin/ })).toHaveCount(0);
  expect((await api(page, `docs-${n}/merkzettel.md`)).status()).toBe(404);
});

test('Editor: Git-Leiste – Status, Diff-Ansicht, Commit, neuer Branch', async ({ page }, info) => {
  await editorOeffnen(page);
  const n = info.project.name;
  // Ausgangslage: eine eigene Datei im letzten Commit (Fassung eins), dann geändert (Fassung zwei) + eine neue Datei
  const datei = `stand-${n}.md`;
  const inhalt = `# Stand\n\nFassung zwei von ${n} um ${Date.now()}.\n`;
  const h = schreibend(page);
  await page.request.put('/api/coding/editor/datei', { headers: h, data: { projekt: P, pfad: datei, text: '# Stand\n\nFassung eins.\n' } });
  expect(((await (await page.request.post('/api/coding/editor/git', { headers: h, data: { projekt: P, befehl: 'commit', nachricht: `Vorbereitung ${n}`, alle: true } })).json()) as { ok: boolean }).ok).toBe(true);
  await page.request.put('/api/coding/editor/datei', { headers: h, data: { projekt: P, pfad: datei, text: inhalt } });
  await page.request.put('/api/coding/editor/datei', { headers: h, data: { projekt: P, pfad: `neu-${n}.txt`, text: 'frisch\n' } });

  await bereich(page, info, 'Git');
  const git = page.getByTestId('git');
  await expect(git.getByLabel('Branch')).toHaveValue(/main|zweig-/);
  const liste = page.getByTestId('git-dateien');
  await expect(liste.locator('li')).toHaveCount(2);
  await expect(liste.locator('li', { hasText: datei })).toContainText('geändert');
  await expect(liste.locator('li', { hasText: `neu-${n}.txt` })).toContainText('neu');

  // Diff: links der Stand im letzten Commit, rechts die Arbeitsfassung
  await liste.getByRole('button', { name: new RegExp(`geändert ${datei}`) }).click();
  await expect(page.getByRole('tab', { name: new RegExp(`± ${datei}`) })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('monaco-diff')).toBeVisible();
  await expect.poll(() => editor(page, (e) => e.wert())).toBe(inhalt);
  expect(await editor(page, (e) => e.original())).not.toBe(inhalt);
  expect(await editor(page, (e) => e.original())).toBe('# Stand\n\nFassung eins.\n');
  await expect(page.getByTestId('monaco-diff').locator('.line-insert, .char-insert, .line-delete, .char-delete').first()).toBeAttached();

  // eine Datei vormerken, dann alles committen
  await bereich(page, info, 'Git');
  await git.getByRole('button', { name: `neu-${n}.txt: vormerken` }).click();
  await expect(git.getByRole('button', { name: /nur Vorgemerktes \(1\)/ })).toBeEnabled();
  await git.getByRole('button', { name: 'Commit (alles)' }).click();
  await expect(page.getByTestId('meldung')).toContainText('Commit-Nachricht fehlt');
  await git.getByLabel('Commit-Nachricht').fill(`Test ${n}`);
  await git.getByRole('button', { name: 'Commit (alles)' }).click();
  await expect(page.getByTestId('git-ausgabe')).toContainText(`Test ${n}`);
  await expect(liste.locator('li')).toHaveCount(0);
  await expect(git).toContainText('Nichts geändert');

  // neuer Branch
  await git.getByLabel('Branch').selectOption('+neu');
  const neu = page.getByRole('dialog', { name: 'Neuer Branch' });
  await neu.getByRole('textbox').fill('--böse');
  await neu.getByRole('button', { name: /Anlegen/ }).click();
  await expect(neu).toContainText('Nur Buchstaben');
  await neu.getByRole('textbox').fill(`zweig-${n}`);
  await neu.getByRole('button', { name: /Anlegen/ }).click();
  await expect(git.getByLabel('Branch')).toHaveValue(`zweig-${n}`);
  // Push ohne Gegenstelle: die Fehlermeldung von git steht in der Leiste, nichts stürzt ab
  await git.getByRole('button', { name: /Push/ }).click();
  await expect(page.getByTestId('git-ausgabe')).toContainText('origin');
});

test('Editor: Terminal – Shell im Projektordner, Eingabe und Ausgabe, zweites Terminal, Thema umschalten', async ({ page }, info) => {
  await editorOeffnen(page);
  await page.getByTestId('terminal-knopf').click();
  const terminal = page.getByTestId('terminal').first();
  await expect(terminal).toHaveAttribute('data-zustand', 'bereit', { timeout: 15_000 });
  const text = (i = 0) => page.evaluate((k) => (document.querySelectorAll('[data-testid="terminal"]')[k] as HTMLElement & { __text(): string }).__text(), i);
  await terminal.click();
  await page.keyboard.type('echo dorf-$((20+22)) && pwd\n');
  await expect.poll(() => text(), { timeout: 15_000 }).toContain('dorf-42');
  expect(await text()).toContain(`/${P}`);
  // die Tastenkürzel der App greifen im Terminal nicht („n“ würde sonst ein To-do anlegen, „f“ den Fokus öffnen)
  await page.keyboard.type('echo fn-$((1+1))\n');
  await expect.poll(() => text()).toContain('fn-2');
  await expect(page).toHaveURL(/\/codehaus\/editor/);

  // zweites Terminal: eigene Shell
  await page.getByRole('button', { name: 'Weiteres Terminal' }).click();
  const zweites = page.getByTestId('terminal').nth(1);
  await expect(zweites).toHaveAttribute('data-zustand', 'bereit', { timeout: 15_000 });
  await zweites.click();
  await page.keyboard.type('echo zwei-$((2*21))\n');
  await expect.poll(() => text(1), { timeout: 15_000 }).toContain('zwei-42');
  expect(await text(0)).not.toContain('zwei-42');
  await page.getByRole('button', { name: 'Terminal 2 schließen' }).click();
  await expect(page.getByTestId('terminal')).toHaveCount(1);

  // exit beendet die Shell – „Neu starten“ holt eine neue
  await terminal.click();
  await page.keyboard.type('exit\n');
  await expect(terminal).toHaveAttribute('data-zustand', 'beendet');
  await page.getByRole('button', { name: 'Neu starten' }).click();
  await expect(page.getByTestId('terminal').first()).toHaveAttribute('data-zustand', 'bereit', { timeout: 15_000 });

  // Thema: hell (Standard) ↔ dunkel, bleibt gemerkt
  await bereich(page, info, 'Dateien');
  await page.getByTestId('baum').getByRole('button', { name: 'README.md' }).click();
  await expect.poll(() => editor(page, (e) => e.wert())).toContain('Spielwiese');
  expect(await editor(page, (e) => e.thema())).toBe(false);
  await page.getByTestId('thema').click();
  await expect.poll(() => editor(page, (e) => e.thema())).toBe(true);
  await expect(page.getByTestId('codeeditor')).toHaveClass(/dunkel/);
  await page.getByTestId('thema').click();
  await expect.poll(() => editor(page, (e) => e.thema())).toBe(false);
});

test('Editor: Coding-Agent daneben – Auftrag startet „Programmieren“ für das offene Projekt, Verlauf steht in der Leiste', async ({ page }, info) => {
  await editorOeffnen(page);
  await bereich(page, info, 'Agent');
  const agent = page.getByTestId('agent');
  await agent.getByLabel('Auftrag für den Coding-Agenten').fill('Schreib eine Hallo-Welt-Funktion.');
  await agent.getByRole('button', { name: 'Agent starten' }).click();
  // die Attrappe des Motors antwortet mit Motor und Projekt
  await expect(agent.getByText(new RegExp(`\\(coding, .*Projekt: ${P}\\)`)).first()).toBeVisible({ timeout: 15_000 });
  await expect(agent.getByText('Schreib eine Hallo-Welt-Funktion.').first()).toBeVisible();
  // weiterschreiben geht in derselben Leiste
  await expect(agent.getByPlaceholder(/Weiter im Gespräch|Noch etwas vergessen/)).toBeVisible();
  // nach dem Neuladen ist der Chat des Projekts wieder da; „Neuer Auftrag“ leert die Leiste
  await page.reload();
  await bereich(page, info, 'Agent');
  await expect(page.getByTestId('agent').getByText(new RegExp(`Projekt: ${P}\\)`)).first()).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('agent').getByRole('button', { name: 'Neuer Auftrag' }).click();
  await expect(page.getByTestId('agent').getByLabel('Auftrag für den Coding-Agenten')).toBeVisible();
});

test('Editor: ohne Anmeldung gibt es weder Dateien noch Terminal; Pfad-Tricks kommen auch mit Anmeldung nicht durch', async ({ page, request }) => {
  expect((await request.get(`/api/coding/editor/baum?projekt=${P}`)).status()).toBe(401);
  expect((await request.get(`/api/coding/editor/datei?projekt=${P}&pfad=README.md`)).status()).toBe(401);
  expect((await request.get(`/api/coding/terminal?projekt=${P}`)).status()).toBe(401);
  await anmelden(page);
  expect((await page.request.get(`/api/coding/editor/datei?projekt=${P}&pfad=${encodeURIComponent('../../etc/passwd')}`)).status()).toBe(400);
  expect((await page.request.get(`/api/coding/editor/datei?projekt=${P}&pfad=${encodeURIComponent('.git/config')}`)).status()).toBe(400);
  // Schreiben ohne passende Herkunft: abgelehnt
  expect((await page.request.put('/api/coding/editor/datei', { headers: { origin: 'https://boese.example' }, data: { projekt: P, pfad: 'boese.txt', text: 'x' } })).status()).toBe(403);
  expect((await page.request.get(`/api/coding/editor/datei?projekt=${P}&pfad=boese.txt`)).status()).toBe(404);
});

test('Editor: läuft unter der Content-Security-Policy des echten Servers (Caddyfile) – Monaco, Worker, Schrift, xterm ohne Verstoß', async ({ page }, info) => {
  // Der Testserver hat kein Caddy davor: die Richtlinie aus deploy/Caddyfile wird hier an die Seite gehängt
  const caddy = fs.readFileSync(path.resolve(import.meta.dirname, '../../../deploy/Caddyfile'), 'utf8');
  const csp = /\?Content-Security-Policy "([^"]+)"/
    .exec(caddy)![1]!
    .replace('wss://{$DORF_DOMAIN}', `ws://127.0.0.1:${process.env.E2E_PORT ?? 3999}`) // auf dem Server wss://<Dorf-Adresse> – wie für /api/live
    .replace('https://{$CODING_DOMAIN}', `http://127.0.0.1:${process.env.E2E_CODING_PORT ?? Number(process.env.E2E_MOODLE_PORT ?? 3998) - 2}`); // E205: die Code-Adresse (frame-src)
  expect(csp).not.toContain('{$');
  expect(csp).toContain("script-src 'self'");
  await page.route(
    (u) => !u.pathname.startsWith('/api/') && !u.pathname.startsWith('/assets/'),
    async (route) => {
      const antwort = await route.fetch();
      await route.fulfill({ response: antwort, headers: { ...antwort.headers(), 'content-security-policy': csp } });
    },
  );
  const verstoesse: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) verstoesse.push(m.text());
  });
  page.on('pageerror', (e) => verstoesse.push(e.message));
  await editorOeffnen(page);
  await page.evaluate(() => document.addEventListener('securitypolicyviolation', (e) => ((window as unknown as { __csp: string[] }).__csp ??= []).push(`${e.violatedDirective} ${e.blockedURI}`)));
  const baum = page.getByTestId('baum');
  await baum.getByRole('button', { name: 'src', exact: true }).click();
  await baum.getByRole('button', { name: 'haupt.ts' }).click();
  // TypeScript-Worker arbeitet: ein Syntaxfehler wird unterstrichen
  await page.getByTestId('monaco').locator('.view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nconst = ;');
  await expect(page.getByTestId('monaco').locator('.squiggly-error').first()).toBeAttached({ timeout: 20_000 });
  // Symbolschrift (codicon) geladen
  expect(await page.evaluate(() => document.fonts.check('16px codicon'))).toBe(true);
  // zweite Datei
  await bereich(page, info, 'Dateien');
  await baum.getByRole('button', { name: 'README.md' }).click();
  // Terminal: xterm baut sich unter der Richtlinie auf. Die Verbindung selbst lässt sich hier nicht prüfen – Chromium sperrt
  // WebSockets zu 127.0.0.1 für Seiten, deren Antwort der Test umgeschrieben hat (Local Network Access); auf dem Server
  // erlaubt connect-src wss://<Dorf-Adresse> sie genauso wie /api/live. Das Terminal selbst prüft der Test weiter oben.
  await page.getByTestId('terminal-knopf').click();
  await expect(page.getByTestId('terminal').first().locator('.xterm-screen')).toBeAttached();
  expect(await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])).toEqual([]);
  expect(verstoesse).toEqual([]);
});
