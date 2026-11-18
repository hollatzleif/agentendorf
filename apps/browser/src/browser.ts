import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { anfragePruefen, hostErlaubt, istLokal } from './leine.js';

export interface BrowserOptionen {
  moodleUrl: string; // z. B. https://moodle.jku.at
  hosts: string[]; // erlaubte Domains, z. B. ['jku.at']
  benutzer?: string;
  passwort?: string;
  executablePath?: string;
  /** Wurzel für den Fall, dass der Browser-Profilordner fest liegen soll (sonst nur im Speicher) */
  maxText?: number;
  log?: (t: string) => void;
  /**
   * Nur auf diesen Hosts (exakt) wird das Passwort eingetragen: Moodle selbst (nur unter /login/) und der
   * Identitätsanbieter. Standard: Moodle-Host, shibboleth.im.jku.at und access.jku.at („JKU Login Service“, dort steht das Anmeldeformular – gesehen bei Leifs erster Anmeldung).
   */
  anmeldeHosts?: string[];
}

export interface SeitenAuszug {
  url: string;
  titel: string;
  text: string;
  links: { nr: number; text: string; ziel: string | null; art: 'link' | 'knopf' }[];
  blockiert: string[]; // was die Leine auf dieser Seite abgefangen hat
}

export class BrowserFehler extends Error {}

const MAX_DATEI = 50 * 1024 * 1024;
const LEERLAUF_MS = 20 * 60_000;

interface Sitzung {
  page: Page;
  kette: Promise<unknown>;
  blockiert: string[];
  zuletzt: number;
  /** nur diese Sitzung meldet sich gerade an (dann dürfen Formular-Navigationen durch die Leine) */
  anmeldung: boolean;
  /** die zuletzt gewünschte Adresse (nach einer Anmeldung dorthin zurück) */
  gewollt?: string;
}

/**
 * Ein Chromium mit EINEM Kontext (Cookies = Moodle-Anmeldung werden geteilt), eine Seite pro Sitzung (Lauf).
 * Jede Anfrage geht durch die Leine. Anmeldung automatisch, sobald eine Seite ein Passwortfeld zeigt.
 */
export class MoodleBrowser {
  private browser: Browser | null = null;
  private kontext: BrowserContext | null = null;
  private start: Promise<BrowserContext> | null = null;
  private sitzungen = new Map<string, Sitzung>();
  private seiten = new WeakMap<Page, Sitzung>();
  // Anmeldungen nacheinander (Cookies sind geteilt; zwei gleichzeitige Anmeldungen stören sich)
  private anmeldeSperre: Promise<unknown> = Promise.resolve();
  private anmeldungen = 0;
  private aufraeumer: NodeJS.Timeout;

  constructor(private o: BrowserOptionen) {
    this.aufraeumer = setInterval(() => void this.aufraeumen(), 60_000);
    this.aufraeumer.unref();
  }

  /** Sind Zugangsdaten hinterlegt? (ohne sie preiszugeben) */
  hatZugang() {
    return !!this.o.benutzer && !!this.o.passwort;
  }

  private async kontextHolen(): Promise<BrowserContext> {
    if (this.kontext) return this.kontext;
    this.start ??= (async () => {
      this.browser = await chromium.launch({ headless: true, executablePath: this.o.executablePath, args: ['--disable-dev-shm-usage'] });
      const k = await this.browser.newContext({
        locale: 'de-AT',
        timezoneId: 'Europe/Vienna',
        viewport: { width: 1280, height: 900 },
        acceptDownloads: false,
        serviceWorkers: 'block',
      });
      k.setDefaultTimeout(30_000);
      // Die Leine sitzt am KONTEXT: gilt so auch für Popups und Unterseiten, nicht nur für unsere Seiten
      await k.route('**/*', async (route) => {
        const r = route.request();
        let s: Sitzung | undefined;
        try {
          s = this.seiten.get(r.frame().page());
        } catch {
          s = undefined; // Anfrage ohne Seite (z. B. Service Worker) – gilt nie als Anmeldung
        }
        const p = anfragePruefen(
          { methode: r.method(), url: r.url(), daten: r.postData(), anmeldung: !!s?.anmeldung, navigation: r.isNavigationRequest(), art: r.resourceType() },
          this.o.hosts,
        );
        if (p.ok) return route.continue();
        const zeile = this.maskieren(`${r.method()} ${r.url().slice(0, 140)} – ${p.grund}`);
        s?.blockiert.push(zeile);
        this.o.log?.(`Leine: ${zeile}`);
        return route.abort('blockedbyclient');
      });
      // WebSockets gar nicht erst verbinden
      await k.routeWebSocket(/.*/, (ws) => ws.close());
      this.kontext = k;
      this.kontext = k;
      return k;
    })();
    try {
      return await this.start;
    } finally {
      this.start = null;
    }
  }

  private async sitzung(id: string): Promise<Sitzung> {
    let s = this.sitzungen.get(id);
    if (s && !s.page.isClosed()) return s;
    const k = await this.kontextHolen();
    const page = await k.newPage();
    const neu: Sitzung = { page, kette: Promise.resolve(), blockiert: [], zuletzt: Date.now(), anmeldung: false };
    this.seiten.set(page, neu);
    // Popups (window.open, target=_blank) sofort schließen – der Agent arbeitet nur in seiner einen Seite
    page.on('popup', (p) => {
      neu.blockiert.push('Popup-Fenster geschlossen');
      void p.close().catch(() => undefined);
    });
    this.sitzungen.set(id, neu);
    return neu;
  }

  /** Arbeitsschritte einer Sitzung nacheinander ausführen */
  private nacheinander<T>(id: string, f: (s: Sitzung) => Promise<T>): Promise<T> {
    return (async () => {
      const s = await this.sitzung(id);
      const weiter = s.kette.then(
        () => f(s),
        () => f(s),
      );
      s.kette = weiter.catch(() => undefined);
      s.zuletzt = Date.now();
      return weiter;
    })();
  }

  /** Passwort nie herausgeben – auch nicht in Adressen, Titeln, Linktexten oder Meldungen */
  private maskieren(t: string) {
    const pw = this.o.passwort;
    if (!pw || pw.length < 3) return t;
    let aus = t.split(pw).join('••••');
    for (const v of [encodeURIComponent(pw), encodeURIComponent(pw).replace(/%20/g, '+')]) if (v !== pw) aus = aus.split(v).join('••••');
    return aus;
  }

  private get anmeldeHosts() {
    return (this.o.anmeldeHosts ?? [new URL(this.o.moodleUrl).hostname, 'shibboleth.im.jku.at', 'access.jku.at']).map((h) => h.toLowerCase());
  }

  /** Darf auf dieser Adresse das Passwort eingetragen werden? (Moodle nur unter /login/, sonst nur der Identitätsanbieter) */
  private anmeldeAdresse(url: string) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return false;
    }
    const h = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && istLokal(h))) return false;
    if (!hostErlaubt(u.href, this.o.hosts) || !this.anmeldeHosts.includes(h)) return false;
    if (h === new URL(this.o.moodleUrl).hostname.toLowerCase()) return u.pathname.startsWith('/login/');
    return true;
  }

  private exklusiv<T>(f: () => Promise<T>): Promise<T> {
    const p = this.anmeldeSperre.then(f, f);
    this.anmeldeSperre = p.catch(() => undefined);
    return p;
  }

  private absolut(url: string) {
    const u = new URL(url, this.o.moodleUrl);
    if (!hostErlaubt(u.href, this.o.hosts)) throw new BrowserFehler(`Die Adresse ${u.hostname} liegt außerhalb von Moodle/JKU – gesperrt.`);
    return u.href;
  }

  private async warten(page: Page) {
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => undefined);
  }

  private async hatPasswortfeld(page: Page) {
    return (await page.locator('input[type=password]:visible').count()) > 0;
  }

  /** Anmeldung über das JKU-Formular (Moodle-Login oder SSO, ein- oder zweistufig). Zugangsdaten verlassen den Runner nie. */
  private async anmelden(s: Sitzung) {
    const page = s.page;
    if (!this.o.benutzer || !this.o.passwort) throw new BrowserFehler('Keine Moodle-Zugangsdaten hinterlegt – auf dem Server: dorf moodle-browser-zugang');
    s.anmeldung = true;
    try {
      for (let schritt = 0; schritt < 4; schritt++) {
        // Zugangsdaten nur auf Moodles Login-Seite oder beim Identitätsanbieter eintragen
        if (!this.anmeldeAdresse(page.url())) break;
        const pw = page.locator('input[type=password]:visible').first();
        const hatPw = (await pw.count()) > 0;
        const nutzerFeld = page
          .locator('input[type=email]:visible, input[type=text]:visible, input:not([type]):visible')
          .filter({ hasNot: page.locator('[type=hidden]') })
          .first();
        if (!hatPw && !(await nutzerFeld.count())) {
          // Moodle zeigt oft nur einen SSO-Knopf („JKU Single Sign On“) – den nehmen
          const sso = page.locator('a[href*="/auth/"]:visible, a:visible:text-matches("single sign on|sso|anmelden|log ?in", "i")').first();
          if (await sso.count()) {
            await sso.click();
            await this.warten(page);
            continue;
          }
          break;
        }
        if (await nutzerFeld.count()) {
          const leer = !(await nutzerFeld.inputValue().catch(() => ''));
          if (leer) await nutzerFeld.fill(this.o.benutzer);
        }
        if (hatPw) {
          await pw.fill(this.o.passwort);
          await pw.press('Enter');
        } else {
          await nutzerFeld.press('Enter'); // zweistufig: erst Benutzername
        }
        await this.warten(page);
        if (!(await this.istAnmeldeseite(page))) break;
      }
      // Nach dem Absenden folgen oft noch per Skript abgeschickte Formulare (SAML-Antwort von Shibboleth an Moodle),
      // manchmal mit Verzögerung – die gehören noch zur Anmeldung.
      await page.waitForTimeout(1500);
      await this.warten(page);
    } finally {
      s.anmeldung = false;
    }
    if (await this.istAnmeldeseite(page)) {
      const u = new URL(page.url());
      const fehlermeldung = (await page.locator('.alert-danger, .error, .loginerrors, [role=alert]').first().innerText().catch(() => '')).trim().slice(0, 200);
      throw new BrowserFehler(this.maskieren(`Anmeldung fehlgeschlagen auf ${u.hostname}${u.pathname}${fehlermeldung ? ` – ${fehlermeldung}` : ''}`));
    }
  }

  private async auszug(s: Sitzung): Promise<SeitenAuszug> {
    const page = s.page;
    const max = this.o.maxText ?? 15_000;
    const roh = await page.evaluate((maxText: number) => {
      document.querySelectorAll('[data-dorf-nr]').forEach((e) => e.removeAttribute('data-dorf-nr'));
      const sichtbar = (e: Element) => {
        const r = (e as HTMLElement).getBoundingClientRect();
        const st = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
      };
      const els = Array.from(document.querySelectorAll('a[href], button, input[type=submit], input[type=button], [role=button], summary')).filter(sichtbar);
      const links: { nr: number; text: string; ziel: string | null; art: 'link' | 'knopf' }[] = [];
      let n = 0;
      for (const e of els) {
        const el = e as HTMLElement & { value?: string; href?: string };
        const t = (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 120);
        const istLink = el.tagName === 'A';
        if (!t && !istLink) continue;
        if (istLink && /^javascript:/i.test(el.getAttribute('href') ?? '')) continue;
        n++;
        el.setAttribute('data-dorf-nr', String(n));
        links.push({ nr: n, text: t || '(ohne Text)', ziel: istLink ? (el as HTMLAnchorElement).href : null, art: istLink ? 'link' : 'knopf' });
        if (n >= 300) break;
      }
      const haupt = document.querySelector('#region-main, main, [role=main]') ?? document.body;
      return { titel: document.title, text: (haupt as HTMLElement).innerText.replace(/\n{3,}/g, '\n\n').slice(0, maxText), links };
    }, max);
    const blockiert = s.blockiert.splice(0);
    const m = (t: string) => this.maskieren(t);
    return {
      url: m(page.url()),
      titel: m(roh.titel),
      text: m(roh.text),
      links: roh.links.map((l) => ({ ...l, text: m(l.text), ziel: l.ziel == null ? null : m(l.ziel) })),
      blockiert,
    };
  }

  /**
   * Anmeldeseite: Moodles Login-Seite (dort oft nur ein SSO-Knopf) oder ein Passwortfeld auf einer Anmelde-Adresse.
   * Passwortfelder anderswo (z. B. Test-Kennwort in Moodle, fremde jku.at-Dienste) lösen KEINE Anmeldung aus.
   */
  private async istAnmeldeseite(page: Page) {
    const url = page.url();
    if (!this.anmeldeAdresse(url)) return false;
    return /\/login\/index\.php$/.test(new URL(url).pathname) || (await this.hatPasswortfeld(page));
  }

  /**
   * Gast-Ansicht: JKU-Moodle leitet Nicht-Angemeldete nicht auf die Login-Seite, sondern zeigt ein Gast-Dashboard
   * („Dashboard (Gast)“). Erkennbar an: Body-Klasse notloggedin, „(Gast)“ im Titel oder Anmelde-Link ohne Abmelde-Link.
   */
  private async istGast(page: Page) {
    if (!hostErlaubt(page.url(), this.o.hosts)) return false;
    return page
      .evaluate(() => {
        const b = document.body;
        if (!b) return false;
        if (b.classList.contains('notloggedin')) return true;
        if (document.querySelector('a[href*="/login/logout.php"]')) return false;
        return /\((Gast|Guest)\)/i.test(document.title) || !!document.querySelector('a[href*="/login/index.php"]');
      })
      .catch(() => false);
  }

  /**
   * Bei der Anmeldung „daneben“ gelandet: Fehlerseite (z. B. Shibboleths Skript-Formular wurde blockiert, weil gerade
   * nicht diese Sitzung angemeldet wird) oder ein fremder Host, obwohl eine Moodle-Seite gewollt war.
   */
  private daneben(s: Sitzung) {
    const url = s.page.url();
    if (url.startsWith('chrome-error:')) return true;
    if (!s.gewollt) return false;
    const moodle = new URL(this.o.moodleUrl).hostname;
    try {
      return new URL(s.gewollt).hostname === moodle && new URL(url).hostname !== moodle;
    } catch {
      return false;
    }
  }

  private async nachNavigation(s: Sitzung) {
    await this.warten(s.page);
    const anmeldeseite = await this.istAnmeldeseite(s.page);
    const gast = !anmeldeseite && (await this.istGast(s.page));
    const daneben = !anmeldeseite && !gast && this.daneben(s);
    if (!anmeldeseite && !gast && !daneben) return;
    const ziel = s.gewollt ?? s.page.url();
    const vorher = this.anmeldungen;
    await this.exklusiv(async () => {
      // Hat sich inzwischen eine andere Sitzung angemeldet, oder sind wir daneben gelandet? Erst neu laden.
      if ((this.anmeldungen !== vorher || daneben) && hostErlaubt(ziel, this.o.hosts) && !/\/login\//.test(new URL(ziel).pathname)) {
        await s.page.goto(ziel).catch(() => undefined);
        await this.warten(s.page);
        if (!(await this.istAnmeldeseite(s.page)) && !(await this.istGast(s.page)) && !this.daneben(s)) return;
      }
      if (!(await this.istAnmeldeseite(s.page))) {
        // zur Login-Seite. Die JKU leitet dort sofort zu Shibboleth weiter, und Shibboleth schickt per Skript ein
        // Formular ab (Sitzungsdaten) – das gehört schon zur Anmeldung und muss (nur für diese Sitzung) durch die Leine.
        s.anmeldung = true;
        try {
          await s.page.goto(this.absolut('/login/index.php')).catch(() => undefined);
          await this.warten(s.page);
        } finally {
          s.anmeldung = false;
        }
      }
      await this.anmelden(s);
      this.anmeldungen++;
      // wo die Anmeldung endete (für die Fehlermeldung, falls z. B. eine Einwilligungsseite dazwischenkommt)
      const u = new URL(s.page.url());
      const zuletzt = `${u.hostname}${u.pathname} „${(await s.page.title().catch(() => '')).slice(0, 80)}“`;
      // nach der Anmeldung leitet Moodle meist zurück; sonst die ursprüngliche Seite neu öffnen
      if (hostErlaubt(ziel, this.o.hosts) && !/\/login\//.test(new URL(ziel).pathname) && s.page.url() !== ziel) {
        await s.page.goto(ziel).catch(() => undefined);
        await this.warten(s.page);
      }
      if (await this.istGast(s.page)) throw new BrowserFehler(this.maskieren(`Anmeldung fehlgeschlagen – Moodle zeigt weiterhin die Gast-Ansicht (Anmeldung endete auf ${zuletzt}).`));
    });
  }

  async oeffnen(sitzung: string, url: string): Promise<SeitenAuszug> {
    const ziel = this.absolut(url);
    return this.nacheinander(sitzung, async (s) => {
      s.gewollt = ziel;
      await s.page.goto(ziel).catch((e: Error) => {
        if (!/ERR_BLOCKED_BY_CLIENT|ERR_ABORTED/.test(e.message)) throw new BrowserFehler(`Seite lädt nicht: ${e.message.split('\n')[0]}`);
      });
      await this.nachNavigation(s);
      return this.auszug(s);
    });
  }

  klicken(sitzung: string, nr: number): Promise<SeitenAuszug> {
    return this.nacheinander(sitzung, async (s) => {
      const el = s.page.locator(`[data-dorf-nr="${nr}"]`).first();
      if (!(await el.count())) throw new BrowserFehler(`Kein Eintrag [${nr}] auf der Seite – erst moodle_seite aufrufen.`);
      const href = await el.evaluate((e) => (e.tagName === 'A' ? (e as HTMLAnchorElement).href : null));
      if (href) {
        // Links öffnen wir direkt (GET) – dann kann kein Skript dahinter etwas anderes auslösen
        const ziel = this.absolut(href);
        s.gewollt = ziel;
        await s.page.goto(ziel).catch((e: Error) => {
          if (/Download is starting/i.test(e.message)) throw new BrowserFehler('Das ist eine Datei – nimm moodle_herunterladen.');
          if (!/ERR_BLOCKED_BY_CLIENT|ERR_ABORTED/.test(e.message)) throw new BrowserFehler(`Seite lädt nicht: ${e.message.split('\n')[0]}`);
        });
      } else {
        s.gewollt = undefined;
        await el.click({ timeout: 10_000 }).catch((e: Error) => {
          throw new BrowserFehler(`Klick ging nicht: ${e.message.split('\n')[0]}`);
        });
      }
      await this.nachNavigation(s);
      return this.auszug(s);
    });
  }

  seite(sitzung: string): Promise<SeitenAuszug> {
    return this.nacheinander(sitzung, (s) => this.auszug(s));
  }

  zurueck(sitzung: string): Promise<SeitenAuszug> {
    return this.nacheinander(sitzung, async (s) => {
      await s.page.goBack().catch(() => undefined);
      await this.warten(s.page);
      return this.auszug(s);
    });
  }

  bild(sitzung: string): Promise<{ bild: string }> {
    return this.nacheinander(sitzung, async (s) => ({ bild: (await s.page.screenshot({ type: 'jpeg', quality: 70 })).toString('base64') }));
  }

  /** Datei hinter Eintrag [nr] laden – Weiterleitungen werden einzeln geprüft (auch sie nur auf erlaubten Domains) */
  herunterladen(sitzung: string, nr: number): Promise<{ name: string; mime: string; daten: Buffer }> {
    return this.nacheinander(sitzung, async (s) => {
      const el = s.page.locator(`[data-dorf-nr="${nr}"]`).first();
      const href = (await el.count()) ? await el.evaluate((e) => (e.tagName === 'A' ? (e as HTMLAnchorElement).href : null)) : null;
      if (!href) throw new BrowserFehler(`Eintrag [${nr}] ist kein Link.`);
      let url = this.absolut(href);
      const k = await this.kontextHolen();
      for (let i = 0; i < 6; i++) {
        // Der Download läuft nicht über die Seite – also jede Adresse (auch jede Weiterleitung) selbst durch die Leine
        const p = anfragePruefen({ methode: 'GET', url, anmeldung: false, navigation: true }, this.o.hosts);
        if (!p.ok) throw new BrowserFehler(`Gesperrt: ${p.grund}`);
        const r = await k.request.get(url, { maxRedirects: 0, failOnStatusCode: false, timeout: 60_000 });
        if (r.status() >= 300 && r.status() < 400) {
          const weiter = r.headers()['location'];
          if (!weiter) throw new BrowserFehler('Weiterleitung ohne Ziel.');
          url = this.absolut(new URL(weiter, url).href);
          continue;
        }
        if (!r.ok()) throw new BrowserFehler(`Download fehlgeschlagen (HTTP ${r.status()}).`);
        const mime = (r.headers()['content-type'] ?? 'application/octet-stream').split(';')[0]!.trim();
        if (mime === 'text/html') {
          // Moodle zeigt bei Ressourcen oft erst eine Seite mit dem eigentlichen Link
          const html = (await r.text()).slice(0, 400_000);
          const m = /href="([^"]*\/pluginfile\.php\/[^"]+)"/.exec(html);
          if (m && i < 5) {
            url = this.absolut(m[1]!.replace(/&amp;/g, '&'));
            continue;
          }
          throw new BrowserFehler('Das ist eine Seite, keine Datei – öffne sie mit moodle_klicken.');
        }
        const laenge = Number(r.headers()['content-length'] ?? 0);
        if (laenge > MAX_DATEI) throw new BrowserFehler('Datei ist größer als 50 MB.');
        const daten = await r.body();
        if (daten.length > MAX_DATEI) throw new BrowserFehler('Datei ist größer als 50 MB.');
        const cd = r.headers()['content-disposition'] ?? '';
        const ausCd = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1] ?? /filename="?([^";]+)"?/i.exec(cd)?.[1];
        const name = decodeURIComponent(ausCd ?? new URL(url).pathname.split('/').pop() ?? 'datei');
        return { name, mime, daten };
      }
      throw new BrowserFehler('Zu viele Weiterleitungen.');
    });
  }

  /** Anmeldung prüfen (für dorf moodle-browser-zugang): Startseite öffnen, ggf. anmelden, angemeldet? */
  async anmeldungPruefen(): Promise<{ ok: boolean; url: string; meldung: string }> {
    const a = await this.oeffnen('__pruefen__', '/my/');
    const angemeldet = (await this.sitzungen.get('__pruefen__')!.page.locator('a[href*="/login/logout.php"], [data-region="user-menu"], .usermenu .userbutton').count()) > 0;
    await this.schliessen('__pruefen__');
    return { ok: angemeldet, url: a.url, meldung: angemeldet ? `Angemeldet – ${a.titel}` : `Nicht angemeldet (Seite: ${a.titel})` };
  }

  async schliessen(sitzung: string) {
    const s = this.sitzungen.get(sitzung);
    this.sitzungen.delete(sitzung);
    await s?.page.close().catch(() => undefined);
  }

  private async aufraeumen() {
    const jetzt = Date.now();
    for (const [id, s] of this.sitzungen) if (jetzt - s.zuletzt > LEERLAUF_MS) await this.schliessen(id);
    if (!this.sitzungen.size && this.browser) {
      // nichts zu tun → Speicher freigeben; Cookies gehen dabei verloren, nächste Seite meldet sich neu an
      await this.beenden();
    }
  }

  async beenden() {
    clearInterval(this.aufraeumer);
    const b = this.browser;
    this.browser = null;
    this.kontext = null;
    this.sitzungen.clear();
    await b?.close().catch(() => undefined);
    this.aufraeumer = setInterval(() => void this.aufraeumen(), 60_000);
    this.aufraeumer.unref();
  }
}
