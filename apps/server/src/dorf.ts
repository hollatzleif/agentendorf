import { Kontakte } from './kontakte.js';
import { Dorfplan } from './dorfplan.js';
import { Wetter } from './wetter.js';
import type { KalenderEintrag } from './agenten/werkzeuge.js';
import { Ablage, Automatik } from './agenten/automatik.js';
import path from 'node:path';
import type { Konfig } from './konfig.js';
import { dbOeffnen } from './db.js';
import { systemUhr, type Uhr } from './uhr.js';
import { VaultDienst } from './vault/dienst.js';
import { Suchindex, istText } from './vault/suche.js';
import { vaultBeobachten } from './vault/waechter.js';
import { LiveHub } from './live.js';
import { appBauen } from './app.js';
import { AgentenDienst } from './agenten/dienst.js';
import type { Motor } from './agenten/motor.js';
import { motorenBauen, type Motoren } from './agenten/motoren.js';
import { WerkzeugRegister } from './agenten/register.js';
import { internBauen } from './intern.js';
import { Schreibtisch } from './schreibtisch.js';
import { Buergermeister } from './agenten/buergermeister.js';
import fs from 'node:fs';
import { TelegramBot } from './telegram/bot.js';
import { telegramApi, type TelegramSchnittstelle } from './telegram/api.js';
import { Uni, kalenderQuelle, type KalenderQuelle } from './uni/abgleich.js';
import { moodleKlient, type MoodleKlient } from './uni/moodle.js';
import { rechenraumKlient } from './agenten/rechenraum.js';
import { netzBauen } from './agenten/werkzeuge-extra.js';
import { moodleBrowserKlient, type MoodleBrowserKlient } from './agenten/moodle-browser.js';
import { SystemAufrufe } from './agenten/system.js';
import { sdkKlient, type ModellKlient } from './agenten/motor-api.js';
import { Postbote } from './post/postbote.js';
import { gmailKlient, type GmailKlient } from './post/gmail.js';
import { GoogleZugang } from './post/google-oauth.js';
import { Terminkalender } from './kalender.js';
import { Morgenzeitung } from './morgenzeitung.js';
import { Aufwachen, aufwachEinstellungen, budgetErreicht } from './aufwachen.js';
import { Rundgang } from './rundgang.js';
import { MEINE_TODOS_ORDNER, MeineTodos } from './agenten/meine-todos.js';
import { listenAnlegen } from './todos.js';
import { UniTodoBruecke } from './uni/todo-bruecke.js';
import { Saxo } from './saxo.js';
import { Kirchturm } from './kirchturm.js';
import { Wochenrueckblick } from './wochenrueckblick.js';
import { Karteikasten } from './karten.js';
import { Gewohnheiten } from './gewohnheiten.js';
import { Wochenziele } from './wochenziele.js';
import { tagIn, tagPlus } from './zeit.js';
import { ortszeitZuUtc } from './uni/ical.js';
import { Lernziele } from './uni/lernziele.js';
import { fachZuordnen, minutenText, projekteAus } from '@dorf/shared';
import { Notizen } from './notizen.js';
import { Noten } from './uni/noten.js';
import { mitFokus, statistik } from './statistik.js';
import { bluete } from './bluete.js';
import { TodoErinnerungen } from './todo-erinnerungen.js';
import { GoogleKalender, googleKalenderKlient, terminVorschau, type KalenderKlient } from './kalender-google.js';
import { Bank, datum as bankDatum } from './bank.js';
import { Corps } from './corps.js';
import { Boerse, eodhdKlient, ezbKurs, type BoerseKlient, type Fremdwaehrung } from './boerse.js';

/** Dateien, die das Dorf zum Arbeiten braucht: fehlen sie (z. B. Vault aus einer älteren Etappe), werden sie aus der Vorlage ergänzt – nie überschrieben. */
const PFLICHT_DATEIEN = [
  'Rathaus/aktionen/buergermeister.md',
  '00_Stadtordnung/telegram.md',
  '00_Stadtordnung/aufwachen.md',
  '00_Stadtordnung/rundgang.md',
  'Uni/aktionen/lernen.md',
  'Uni/aktionen/abgabe-bearbeiten.md',
  'Uni/aktionen/moodle-durchsehen.md',
  'Post/aktionen/antwort-entwerfen.md',
  '00_Stadtordnung/aktion-vorlage.md',
  'Bibliothek/aktionen/checkliste.md',
  'Bibliothek/vorlagen/checkliste-vorlage.html',
  'Uni/aktionen/kursuebersicht.md',
  'Rathaus/memory.md',
  'Rathaus/personality.md',
  'Einkaufsladen/einstellungen.md',
  'Einkaufsladen/aktionen/essensplan.md',
  'Einkaufsladen/aktionen/preisvergleich.md',
  'Bank/einstellungen.md',
  'Bank/aktionen/kontoauszug-pdf.md',
  'Corpshaus/einstellungen.md',
  'Corpshaus/aktionen/termine-aus-mails.md',
  'Corpshaus/aktionen/veranstaltung-planen.md',
  'Corpshaus/aktionen/uebergabe.md',
  'Boerse/depot.md',
  'Boerse/aktionen/wochenbericht.md',
  'Boerse/aktionen/tagesbericht.md', // E222
  'Boerse/aktionen/aktie-analysieren.md', // E223 Berater
  'Boerse/aktionen/etf-vergleichen.md',
  'Boerse/aktionen/depot-check.md',
  'Boerse/aktionen/berater-frage.md',
  'Kirchturm/gebaeude.md',
  'Uni/aktionen/karten-erstellen.md',
  // E191 Codehaus
  'Codehaus/gebaeude.md',
  'Codehaus/aktionen/programmieren.md',
  'Codehaus/aktionen/repo-klonen.md',
  'Codehaus/aktionen/pr-pruefen.md',
  // E198 Atelier
  'Atelier/gebaeude.md',
  'Atelier/aktionen/bild-bearbeiten.md',
  // E212 Handschrift
  'Atelier/aktionen/handschrift.md',
];

/**
 * Vorlagendateien, die das Dorf ersetzen darf – aber NUR, wenn sie byte-genau einer früheren Vorlagenfassung
 * entsprechen (sha256), Leif sie also nie verändert hat. Alles andere bleibt unangetastet.
 */
const VORLAGE_FRUEHERE_FASSUNGEN: Record<string, string[]> = {
  // E216: E213/E215 haben die Aktion geändert, ohne die alte Fassung hier einzutragen – jetzt alle drei
  'Atelier/aktionen/handschrift.md': [
    '21951fb1886f67a952c62c01e057a23f7a5e770d8bff29bfcb92377f0e3ca567', // E212
    'e7c16642e462c77656c9818323c26d8fa6b5af23856640aa192a3c1a361c71e5', // E213/E214
    'ffe2110a27884d8c077f95f43ee92808e583451e7e58c072db46fd15c377aeb0', // E215
  ],
  'Uni/gebaeude.md': [
    'ec2518b6e8de76279701087fca5af642c2a164939cf3d69f8f2edb7643080077', // bis Etappe 2b
    'a0c46bec0fab52f7d0f900a1b10253c4bc6125d4e81ed8863599782af2e96ad2', // Etappe 3 (Moodle-App)
  ],
  'Uni/aktionen/abgabe-bearbeiten.md': ['28289a20e8f718a2b45d16b34ab2a578350078df696a855dccd52e6857259b11'],
  'Uni/aktionen/lernen.md': ['fe2283fc7e878ffd5f7f6a01ec776f50e49b6f96446c28db7cfcec36f48f1dd1'],
  'Post/gebaeude.md': ['313622cda22bc8ff13c0a644fab2c49f1bdf84c57eb2702231a70f2ac1e9a076'], // bis Etappe 3
  '00_Stadtordnung/aktion-vorlage.md': ['b0d3e48a90aa554a0e7ceb234edc1b026e285424313cc2654431b5b9c683f671', '7c7e1c394868de4de10cf6c85ce03f9578b452291e36259be9b9cf54ad368940'], // E60, bis E184
  'Uni/aktionen/kursuebersicht.md': ['f525448be2f08c6d74635be2a96d4c89b0c1c98f5d0d21b42211da403833a8cf'], // E60
  '00_Stadtordnung/aufwachen.md': ['231a442ce4d7e593e65f27a057d4c5392521cd0da0b139c8c045a2d38c6efbd2', '126158d2f1587d9fa31f98a0bbef6aa09e7c95121cc98ebf85baa1bdad4363c8', '1918aee666f956e4f85a47e31dc29504f1ad2a980c58bc45b762395cea0b9f84', '1b96283e9086b2786f93a3ecc72e85cf6375125d7bf8514941e10b1abb3abd15'], // bis E61, bis E180, E181–E191, E192–E217
  // E218: System-Modell (Haiku) für automatische Aufrufe
  '00_Stadtordnung/modelle.md': ['b744670bd0b085242a32057518e3c83fcdf4bc194acfd29424e5234663cb477a'],
  // E61: Gedächtnis/Persönlichkeit des Bürgermeisters
  'Rathaus/aktionen/buergermeister.md': ['653aace36ae47d42bc847eda934c819312ceb446d1d624ba92f8ff528eb37084', '7deb8d2e528b9f2bee7d39619be317cc6043c7ab2269fdc532ebff7b83e2c952', '2d072be6666a3aaef6b19adb004dbf12f3d8221af8603cba00c91f9da4111b96'], // bis E60, E61–E184, E185–E191
  'Rathaus/memory.md': ['e0fc4c0f1b0580080454cc80af5ebb111f927d77e3a3b5d0b71f710ba6e74ee7'], // bis E191 (nur wenn weder Leif noch der Bürgermeister sie je geändert haben)
  'Rathaus/gebaeude.md': ['7dd8c996765e716a804cafdaa4734c16aa4f97afb94e20ae69a6b0cda615b130'],
  '00_Stadtordnung/stadtordnung.md': [
    'b25ae8f9443f9001f0d9fe78ede22016e41ff8839e073540172b22768507c95e', // Etappe 1
    '7dcba59a9ae908f2caaa02362b46cb0e8c4995b9350a764812dfe9f61d4f9bf1', // Etappe 2a
    '495a9ae689adcec68c4878b0fddf28b5c5909de8893b72aed438da2ad66b3bc6', // Etappe 2b
    'd7caf198ce646fe65d2fafa29e6ddd63bae6f21ccdd527b1a9dec63ec517aba9', // Etappe 3 bis E60
    'ff3beab8cf394168ff1cfc9e3d4e91fb9c6f9eced1152b31f2db5373547043e3', // E61–E64
    '77990f31c7ba34481767fb0ee51234ed6ec6f17da46c5f3b2d71d6a0f56d5b64', // E65–E184
  ],
  'Boerse/gebaeude.md': ['15a5f5dae8854563d65c806e7b84b429d733826e38e1d35dc9a68a92b8779948'], // geschlossen bis Etappe 7
  '00_Stadtordnung/motoren.md': ['86c86542cedce20651cd2ed78bd1a5f7c2003da319595ee0721d48bc52151c83'], // bis E190 (ohne coding)
  'Corpshaus/gebaeude.md': ['b7604d37957b279a6581562ed10640efb0993ca228cbdd47fb191e599a753427'], // leer bis Etappe 7
  'Bank/gebaeude.md': ['c2349ea31d50afc797ea1c70c9bc3d43ef0f7f605bb5a6f7d5e43555cb482b37'], // geschlossen bis Etappe 7
  'Einkaufsladen/gebaeude.md': ['b334b038336be925930e612231f6129a7f25a723f111d08af9568117fe45e87f'], // geschlossen bis Etappe 7
  'Marktplatz/gebaeude.md': ['b7332c301634c2889f157d87138f392c3f2a49500a7fb31cc30a9d2d41157358'], // bis E64
  '00_Stadtordnung/rundgang.md': ['60d05e9a34a9e8acce98164fed4eceea9ce8378ec38696613546e08c94697fb8'], // E192–E199 (18 Aktivitäten)
};

/** Baut das ganze Dorf zusammen (für Start und Integrationstests). */
export async function dorfStarten(
  konfig: Konfig,
  opt: {
    uhr?: Uhr;
    beobachten?: boolean;
    motoren?: Motoren | ((r: WerkzeugRegister) => Motoren);
    /** Für Tests: nachgebaute Bot-API; das Polling startet dann nicht automatisch */
    telegram?: TelegramSchnittstelle;
    /** Für Tests: nachgebauter Moodle-Server; der 3-Stunden-Takt startet dann nicht */
    moodle?: MoodleKlient;
    /** Für Tests: nachgebauter Kalender-Export */
    kalender?: KalenderQuelle;
    /** Für Tests: nachgebautes Gmail und Modell für Aufrufe ohne Werkzeuge (Einordnung, Morgenzeitung) */
    gmail?: GmailKlient;
    ki?: () => ModellKlient;
    /** Für Tests: nachgebaute Google-Kalender */
    google?: { fristen?: KalenderQuelle; pflicht?: KalenderQuelle; termine?: KalenderQuelle };
    /** Für Tests: nachgebauter Moodle-Browser */
    moodleBrowser?: MoodleBrowserKlient;
    /** Für Tests: nachgebauter Kurs-Anbieter und EZB-Kurs */
    boerse?: BoerseKlient;
    boerseFx?: (waehrung: Fremdwaehrung) => Promise<{ datum: string; kurs: number }>;
    /** Tests: Google Kalender nachgebaut */
    kalenderKlient?: KalenderKlient;
    /** Tests: Saxo-Server nachgebaut */
    saxoHolen?: typeof fetch;
    /** Für Tests: Open-Meteo-Antwort ohne Netz */
    wetter?: () => Promise<unknown>;
  } = {},
) {
  const uhr = opt.uhr ?? systemUhr;
  const db = dbOeffnen(path.join(konfig.datenDir, 'dorf.db'));
  const vault = new VaultDienst(konfig.vaultDir, uhr);
  const angelegt = await vault.ausVorlage(konfig.vorlageDir);
  // E195: Ein Problem an EINER Vorlagendatei (z. B. ein Symlink dort – dem folgt das Dorf nicht mehr) darf den Start nie verhindern
  for (const p of PFLICHT_DATEIEN) {
    const quelle = path.join(konfig.vorlageDir, p);
    try {
      if (!(await vault.existiert(p)) && fs.existsSync(quelle)) await vault.schreiben(p, fs.readFileSync(quelle, 'utf8'), { nurNeu: true });
    } catch (e) {
      console.warn(`Vorlage ${p} nicht ergänzt: ${(e as Error).message}`);
    }
  }
  for (const [p, fassungen] of Object.entries(VORLAGE_FRUEHERE_FASSUNGEN)) {
    const quelle = path.join(konfig.vorlageDir, p);
    try {
      if (!fs.existsSync(quelle) || !(await vault.existiert(p))) continue;
      const jetzt = await vault.lesen(p);
      if (fassungen.includes(jetzt.version)) await vault.schreiben(p, fs.readFileSync(quelle, 'utf8'), { basisVersion: jetzt.version });
    } catch (e) {
      console.warn(`Vorlage ${p} nicht aktualisiert: ${(e as Error).message}`);
    }
  }
  const suche = new Suchindex(db, vault);
  await suche.vollIndex();
  const hub = new LiveHub();

  const schreibtischRef: { aktuell?: Schreibtisch } = {};
  const corpsRef: { aktuell?: Corps } = {};
  const bankRef: { aktuell?: Bank; zeitgeber?: NodeJS.Timeout; pdfStart?: () => void } = {};
  const aenderung = (rel: string, art: 'angelegt' | 'geaendert' | 'geloescht') => {
    if (art === 'geloescht') suche.entfernen(rel);
    else if (istText(rel)) void suche.aktualisieren(rel).catch(() => undefined);
    hub.gebuendelt({ typ: 'vault.geaendert', pfad: rel, art });
    if (!rel.includes('/') || /^[^/]+\/gebaeude\.md$/.test(rel) || /^[^/]+\/aktionen\//.test(rel)) hub.gebuendelt({ typ: 'gebaeude.geaendert' });
    if (VaultDienst.istKonflikt(rel)) hub.gebuendelt({ typ: 'konflikte.geaendert' });
    if (/^[^/]+\/aktionen\//.test(rel)) hub.gebuendelt({ typ: 'aktionen.geaendert' });
    if (rel.startsWith('00_Stadtordnung/')) hub.gebuendelt({ typ: 'konfig.geaendert' });
    if (rel.startsWith(`${MEINE_TODOS_ORDNER}/`)) hub.gebuendelt({ typ: 'schreibtisch.geaendert' });
    if (art === 'angelegt' && Schreibtisch.istAufgabe(rel)) void schreibtischRef.aktuell?.vaultAufnehmen(rel).catch(() => undefined);
    // neues Kontoauszug-PDF → Skill „Kontoauszug (PDF) einlesen“ (gebündelt, Motor der Aktion)
    if (art === 'angelegt' && /^Bank\/auszuege\/[^/]+\.pdf$/i.test(rel) && bankRef.pdfStart) bankRef.pdfStart();
    // neuer/geänderter Kontoauszug → gebündelt einlesen
    if (art !== 'geloescht' && Bank.istAuszug(rel) && bankRef.aktuell) {
      if (bankRef.zeitgeber) clearTimeout(bankRef.zeitgeber);
      bankRef.zeitgeber = setTimeout(() => void bankRef.aktuell?.einlesen().catch((e) => console.warn(`Bank: ${(e as Error).message}`)), 1500);
      bankRef.zeitgeber.unref();
    }
  };
  vault.beobachten(aenderung);
  const waechter = opt.beobachten === false ? null : vaultBeobachten(vault.wurzel, aenderung);

  const register = new WerkzeugRegister();
  const motoren: Motoren = typeof opt.motoren === 'function' ? opt.motoren(register) : (opt.motoren ?? motorenBauen(konfig, register));
  const agenten = new AgentenDienst(db, uhr, vault, suche, hub, motoren);
  if (konfig.rechenraumGeheimnis) agenten.rechenraum = rechenraumKlient(konfig.rechenraumUrl, konfig.rechenraumGeheimnis);
  // E199: Literatur, Zugverbindungen, Wetter, EZB-Kurse – feste Adressen, Kennung mit der Dorf-Adresse als Kontakt
  agenten.netz = netzBauen({ version: konfig.version, kontakt: konfig.origins[0] ?? 'privat', wetterOrt: konfig.wetterOrt });
  // E190: Umwandlungen fremder Anhänge zwischenspeichern (Daten-Ordner, nicht der Vault – Syncthing muss das nicht tragen)
  agenten.dateien.cacheOrdner = path.join(konfig.datenDir, 'umwandlung');
  if (opt.moodleBrowser) agenten.moodleBrowser = opt.moodleBrowser;
  else if (konfig.browserGeheimnis) agenten.moodleBrowser = moodleBrowserKlient(konfig.browserUrl, konfig.browserGeheimnis);
  const intern = await internBauen(register, { konfig, db, uhr });
  const schreibtisch = new Schreibtisch(db, uhr, vault, hub);
  schreibtischRef.aktuell = schreibtisch;
  const buergermeister = new Buergermeister(db, uhr, vault, agenten, schreibtisch, hub);
  await schreibtisch.abgleichen();
  const uni = new Uni({
    db,
    uhr,
    vault,
    hub,
    klient: opt.moodle ?? (konfig.moodleUrl && konfig.moodleToken ? moodleKlient(konfig.moodleUrl, konfig.moodleToken) : undefined),
    kalender: opt.kalender ?? (konfig.moodleKalenderUrl ? kalenderQuelle(konfig.moodleKalenderUrl) : undefined),
    google: opt.google ?? {
      fristen: konfig.googleFristenIcs ? kalenderQuelle(konfig.googleFristenIcs) : undefined,
      pflicht: konfig.googlePflichtIcs ? kalenderQuelle(konfig.googlePflichtIcs) : undefined,
    },
    pauseMs: opt.moodle ? 0 : 500,
    log: (t) => console.warn(t),
  });
  agenten.quellen = (q) => (q === 'post.mails' ? postbote.quelle() : uni.quelle(q));
  const googleZugang = konfig.gmail ? new GoogleZugang({ ...konfig.gmail, tokenUrl: konfig.googleTokenUrl }) : undefined;
  const gmail = opt.gmail ?? (googleZugang ? gmailKlient(googleZugang, konfig.gmailApiUrl) : undefined);
  const ki = new SystemAufrufe({
    db,
    uhr,
    vault,
    hub,
    klient: opt.ki ?? (konfig.anthropicApiKey && !konfig.motorAttrappe ? () => sdkKlient(konfig.anthropicApiKey!) : undefined),
    // E218: harte Tagesgrenze (aufwachen.md tagesbudget_usd) für alle automatischen API-Aufrufe
    budgetErreicht: () => budgetErreicht(db, uhr, vault),
  });
  // E218: Wacht der Bürgermeister von selbst auf, denkt er über Leifs Abo (aufwachen.md: denken_ueber: abo)
  agenten.zeitplanUeberAbo = async () => (await aufwachEinstellungen(vault)).denken_ueber === 'abo';
  const postbote = new Postbote({
    db,
    uhr,
    vault,
    hub,
    ki,
    gmail,
    kategorieFest: async (von) => ((await corpsRef.aktuell?.istCorpsAbsender(von)) ? 'Corps' : null),
    log: (t) => console.warn(t),
  });
  agenten.post = gmail;
  const kalender = new Terminkalender(opt.google ? opt.google.termine : konfig.googleTermineIcs ? kalenderQuelle(konfig.googleTermineIcs) : undefined, () => uhr.jetzt());
  // E75: Kalender auf dem Marktplatz – Google Calendar (lesen + schreiben durch Leif), sonst nur lesen über iCal
  const googleKalender = new GoogleKalender({
    klient: opt.kalenderKlient ?? (googleZugang ? googleKalenderKlient(googleZugang, konfig.googleCalendarApiUrl) : undefined),
    ical: kalender,
    uni,
    hub,
    jetzt: () => uhr.jetzt(),
  });
  if (googleKalender.verbunden) kalender.google = (von, bis) => googleKalender.alsIcs(von, bis);
  // Etappe 7: Corpshaus (Termine aus dem Hauptkalender per Stichwort, Corps-Absender für den Postboten)
  const corps = new Corps({ vault, uhr, kalender });
  corpsRef.aktuell = corps;
  // Ablage mit Archiv + Zeitplaner für Aktionen (E60)
  agenten.ablage = new Ablage({ db, uhr, vault, log: (t) => console.warn(t) });
  agenten.beiLaufEnde.push(async (e) => {
    const t = await agenten.ablage!.abschliessen(e);
    if (t) await agenten.hinweisSchreiben(e.chatId, t);
  });
  // E65: To-do-Brett auf dem Marktplatz (App, Telegram, alle Agenten)
  // Etappe 7: weitere Listen (Einkauf, Wunsch, Corps) mit derselben Technik
  let uniTodosAnstossen = () => undefined as void;
  const listen = listenAnlegen({ vault, uhr }, (liste) => {
    hub.senden({ typ: 'todos.geaendert', liste });
    if (liste === 'todo') uniTodosAnstossen();
  });
  const todos = listen.todo;
  // E71: Uni-Fristen → To-dos, Abhaken in beide Richtungen
  const uniTodos = new UniTodoBruecke({ db, uhr, uni, todos, vault, log: (t) => console.warn(t) });
  let geschlossen = false;
  let uniTodosZeitgeber: NodeJS.Timeout | undefined;
  uniTodosAnstossen = () => {
    if (uniTodosZeitgeber || geschlossen) return;
    uniTodosZeitgeber = setTimeout(() => {
      uniTodosZeitgeber = undefined;
      if (!geschlossen) void uniTodos.abgleichen();
    }, 1500);
    uniTodosZeitgeber.unref();
  };
  uni.beiAbgleich.push(() => (geschlossen ? undefined : uniTodos.abgleichen()));
  uni.beiErledigt.push(() => uniTodosAnstossen());
  agenten.listen = listen;
  postbote.beiRechnung.push(async (r) => {
    const schon = db.prepare('SELECT rechnung_todo FROM post_mails WHERE id = ?').get(r.mail.id) as { rechnung_todo: string | null } | undefined;
    if (schon?.rechnung_todo) return;
    const faellig = r.faellig ? (bankDatum(r.faellig.split(' ')[0]!) ?? undefined) : undefined;
    const t = await listen.todo.anlegen(
      {
        titel: `Rechnung: ${r.empfaenger || r.mail.von} – ${r.betrag}`.slice(0, 200),
        ...(faellig ? { faellig } : {}),
        gebaeude: 'Bank',
        notiz: `Aus der Mail „${r.mail.betreff}“ von ${r.mail.von}. Bezahlen tust du selbst – danach abhaken.`,
      },
      'Postbote',
      { fremd: true },
    );
    db.prepare('UPDATE post_mails SET rechnung_todo = ? WHERE id = ?').run(t.pfad, r.mail.id);
  });
  const automatik = new Automatik({ db, uhr, vault, agenten, log: (t) => console.warn(t) });
  // kalender_lesen für Aktionen mit werkzeuge: [kalender]: Hauptkalender + Uni-Fristen/Pflichttermine (nur lesen)
  agenten.kalender = async (von, bis) => {
    const aus: KalenderEintrag[] = [];
    for (const t of await kalender.termine(von, bis).catch(() => [])) if (t.start != null) aus.push({ start: t.start, ende: t.ende, ganztags: t.ganztags, titel: t.titel, quelle: 'Kalender' });
    const art = { abgabe: 'Abgabe', test: 'Prüfung', termin: 'Uni-Termin', pflicht: 'Pflichttermin' } as const;
    for (const f of uni.fristen()) {
      const s = f.frist ? Date.parse(f.frist) : NaN;
      if (Number.isNaN(s) || s < von || s > bis) continue;
      aus.push({ start: s, ende: f.ende ? Date.parse(f.ende) : null, ganztags: false, titel: f.kurs ? `${f.titel} (${f.kurs})` : f.titel, quelle: art[f.art], erledigt: f.abgegeben });
    }
    return aus;
  };
  // E192: eigene To-do-Liste des Bürgermeisters + Aktivitäten-Katalog für den Rundgang
  const meineTodos = new MeineTodos({ db, vault, uhr });
  meineTodos.beiAenderung = () => hub.gebuendelt({ typ: 'schreibtisch.geaendert' });
  agenten.meineTodos = meineTodos;
  const rundgang = new Rundgang({ db, uhr, vault, uni, postbote, meineTodos, todos: listen.todo, kalender: agenten.kalender, moodleBereit: () => !!agenten.moodleBrowser, log: (t) => console.warn(t) });
  // Nach jedem Bürgermeister-Lauf: Offenes aus der Zusammenfassung übernehmen (wenn er es nicht selbst eingetragen hat), Rundgang protokollieren
  agenten.beiLaufEnde.push(async (e) => {
    await meineTodos.nachLauf(e).catch((x) => console.warn(`Eigene To-dos: ${(x as Error).message}`));
    await rundgang.nachLauf(e).catch((x) => console.warn(`Rundgang-Protokoll: ${(x as Error).message}`));
  });
  const aufwachen = new Aufwachen({ db, uhr, hub, schreibtisch, buergermeister, freigaben: agenten.freigaben, uni, postbote, vault, meineTodos, rundgang, log: (t) => console.warn(t) });
  const wetter = new Wetter({ url: konfig.wetterUrl, ort: konfig.wetterOrt, uhr, laden: opt.wetter, log: (t) => console.warn(t) });
  // einmal vorab holen, damit das Wetter schon beim ersten Öffnen des Dorfs da ist (nur mit WETTER_URL)
  if (konfig.wetterUrl) void wetter.holen();
  // Etappe 7: Bank – Kontoauszüge aus Bank/auszuege/ (nur lesen und auswerten, nie bezahlen)
  const bank = new Bank({ db, uhr, vault, hub, ki, log: (t) => console.warn(t) });
  bankRef.aktuell = bank;
  rundgang.ergaenzen({ bank });
  let pdfZeitgeber: NodeJS.Timeout | undefined;
  bankRef.pdfStart = () => {
    if (pdfZeitgeber) clearTimeout(pdfZeitgeber);
    pdfZeitgeber = setTimeout(() => {
      const laeuft = db
        .prepare("SELECT 1 FROM laeufe l JOIN chats c ON c.id = l.chat_id WHERE c.aktion = 'Bank/kontoauszug-pdf' AND l.status IN ('wartend', 'laeuft', 'wartet_freigabe')")
        .get();
      if (!laeuft) void agenten.aktionStarten('Bank/kontoauszug-pdf', {}, 'automatik').catch((e) => console.warn(`Bank: PDF-Skill: ${(e as Error).message}`));
    }, 20_000);
    pdfZeitgeber.unref();
  };
  // Etappe 7: Börse – Depot-Datei, Kurse von EODHD (Leifs Schlüssel), Euro/Dollar von der EZB; gehandelt wird nie
  const boerse = new Boerse({
    db,
    uhr,
    vault,
    hub,
    klient: opt.boerse ?? (konfig.eodhdSchluessel ? eodhdKlient({ url: konfig.eodhdUrl, schluessel: konfig.eodhdSchluessel, jetzt: () => uhr.jetzt() }) : undefined),
    fx: opt.boerseFx ?? ((w) => ezbKurs(konfig.ezbUrl, w)),
    log: (t) => console.warn(t),
  });
  // E74: Kirchturm – Wecker, Timer, Pomodoro, Stoppuhr (Server-Takt jede Sekunde)
  const kirchturm = new Kirchturm({ db, uhr, hub });
  if (opt.beobachten !== false) kirchturm.starten();
  // E73: Saxo – Depotwert und Performance aus Leifs Konto, nur lesen
  const saxo = new Saxo({
    db,
    uhr,
    hub,
    konfig: konfig.saxo ? { ...konfig.saxo, rueckleitung: `${konfig.origins[0] ?? ''}/api/boerse/saxo/rueckruf` } : undefined,
    holen: opt.saxoHolen,
    log: (t) => console.warn(t),
  });
  agenten.saxo = saxo; // E222: depot_* für die Agenten
  boerse.saxoSymbole = () => saxo.symbole(); // E223: Kursverläufe auch für Saxo-Positionen
  boerse.saxoWaehrungen = () => saxo.waehrungen(); // E226: EZB-Kurse für Konto- und Positionswährungen
  const depotZeilen = { zeitungsZeilen: async () => [...saxo.zeitungsZeilen(), ...(await boerse.zeitungsZeilen())] };
  // Nacht 18./19.11.: Karteikarten je Fach
  const karten = new Karteikasten({ db, uhr, vault, hub });
  const gewohnheiten = new Gewohnheiten({ db, uhr, vault, hub });
  rundgang.ergaenzen({ gewohnheiten });
  const wochenziele = new Wochenziele({ uhr, vault, hub });
  const notizen = new Notizen({ uhr, vault });
  // E183: Agenten stellen Timer/Wecker/Pomodoro und schreiben Notizen direkt (termin_anlegen als Freigabe-Art bleibt für alte Anträge)
  agenten.kirchturm = kirchturm;
  agenten.notizen = notizen;
  agenten.freigaben.registrieren('termin_anlegen', async (t) => {
    const r = await googleKalender.inHauptkalender({ titel: t.titel, ganztags: t.ganztags, start: t.start, ende: t.ende, ...(t.ort ? { ort: t.ort } : {}) });
    return `Eingetragen: ${r.titel} (${terminVorschau(t)}) – ohne Einladungen.`;
  });
  // E185: Termine im EIGENEN Kalender tragen Agenten direkt ein (Meldung mit „Rückgängig“); nur Termine mit Gästen per Freigabe
  agenten.termine = googleKalender;
  agenten.kontakte = new Kontakte({ db, vault, post: () => agenten.post });
  agenten.freigaben.registrieren('termin_aendern', async (t) => {
    const r = await googleKalender.aendern(t.id, t.eingabe);
    return `Geändert: ${r.titel} (${terminVorschau(t.eingabe)}) – niemand wurde benachrichtigt.`;
  });
  agenten.freigaben.registrieren('termin_loeschen', async (t) => {
    await googleKalender.loeschen(t.kalenderId, t.id);
    return 'Termin gelöscht – niemand wurde benachrichtigt.';
  });
  agenten.rueckgaengig.registrieren('termin_angelegt', async (t: { kalenderId: string; id: string }) => {
    await googleKalender.loeschen(t.kalenderId, t.id);
    return 'Termin wieder aus dem Kalender genommen.';
  });
  agenten.rueckgaengig.registrieren('termin_geaendert', async (t: { id: string; vorher: { kalenderId: string } }) => {
    await googleKalender.aendern(t.id, t.vorher);
    return 'Termin steht wieder wie vorher im Kalender.';
  });
  agenten.rueckgaengig.registrieren('termin_geloescht', async (t: { eingabe: unknown }) => {
    await googleKalender.anlegen(t.eingabe);
    return 'Termin wieder eingetragen.';
  });
  agenten.rueckgaengig.registrieren('datei_geaendert', async (x: { pfad: string; archiv: string; version: string }) => {
    const jetzt = await vault.lesen(x.pfad).catch(() => null);
    if (jetzt && jetzt.version !== x.version) throw new Error(`${x.pfad} wurde seither wieder geändert – die alte Fassung liegt in ${x.archiv}.`);
    await vault.schreiben(x.pfad, (await vault.lesen(x.archiv)).inhalt);
    return `Alte Fassung wiederhergestellt: ${x.pfad}`;
  });
  agenten.rueckgaengig.registrieren('datei_verschoben', async (x: { von: string; nach: string }) => `Zurück verschoben: ${await vault.verschieben(x.nach, x.von)}`);
  // E112: Blüte für Morgenzeitung und Wochenrückblick (wie im Dorfstatus)
  const blueteBerechnen = async () => bluete(await statistik({ db, uhr, todos, gewohnheiten }, 7), await wochenziele.lesen().catch(() => undefined));
  const noten = new Noten({ vault, hub, faecher: () => uni.faecher() });
  agenten.noten = noten; // E221: noten_* für die Agenten
  // E94: Erinnerungen an To-dos – läuten im Kirchturm, Telegram schickt Knöpfe
  const erinnerungen = new TodoErinnerungen({ todos, weitereListen: Object.values(listen), uhr, kirchturm, gewohnheiten, log: (t) => console.warn(t) });
  kirchturm.beiErinnerungSchlummern.push((pfad) => {
    if (!pfad.startsWith('gewohnheit:')) void erinnerungen.verschieben(pfad, { minuten: 10 }).catch(() => undefined);
  });
  if (opt.beobachten !== false) erinnerungen.starten();
  // Nacht 18./19.11.: Wochenrückblick sonntags 18:30
  const lernziele = new Lernziele({ vault, hub });
  // E137/E139: Stand je Lernziel – Fokuszeit (Gruppe = Fach, ungefährer Namensvergleich) seit einem Zeitpunkt
  const lernStand = async (seit: number) => {
    const ziele = await lernziele.lesen();
    const fokus = [...kirchturm.fokusJeGruppe(seit).entries()];
    // E145: jede Fokus-Gruppe zählt für genau ein Ziel – exakt vor ungefähr, in beide Richtungen, ganze Wörter (Review)
    const namen = Object.keys(ziele);
    return Object.entries(ziele).map(([fach, h]) => ({
      fach,
      zielMin: Math.round(h * 60),
      istMin: fokus.filter(([k]) => fachZuordnen(namen, (n) => [n], k) === fach).reduce((s2, [, x]) => s2 + x, 0),
    }));
  };
  const seitMontag = () => {
    const heute = tagIn(uhr.jetzt());
    const montag = tagPlus(heute, -((new Date(`${heute}T12:00:00Z`).getUTCDay() + 6) % 7));
    return ortszeitZuUtc(...(montag.split('-').map(Number) as [number, number, number]), 0, 0, 0, 'Europe/Vienna');
  };
  const lernzielZeilen = async () =>
    (await lernStand(uhr.jetzt() - 7 * 86_400_000)).map((l) => `${l.istMin >= l.zielMin ? '✓' : '✗'} ${l.fach}: ${minutenText(l.istMin)} von ${minutenText(l.zielMin)}`);
  const wochenrueckblick = new Wochenrueckblick({ db, uhr, vault, hub, ki, todos, uni, kalender, lernziele: lernzielZeilen, fokus: kirchturm, bank, gewohnheiten, wochenziele, bluete: () => blueteBerechnen(), log: (t) => console.warn(t) });
  const morgenzeitung = new Morgenzeitung({ db, uhr, vault, hub, ki, freigaben: agenten.freigaben, schreibtisch, uni, postbote, kalender, wetter, bank, boerse: depotZeilen, depotGestern: () => saxo.gesternZeilen(), fokus: kirchturm, gewohnheiten, wochenziele, bluete: () => blueteBerechnen(), lernen: async () => (await lernStand(seitMontag())).map((l) => `${l.istMin >= l.zielMin ? '✓ ' : ''}${l.fach}: ${minutenText(l.istMin)} von ${minutenText(l.zielMin)}`), projekte: async () => projekteAus(mitFokus(db, await todos.liste({ alleErledigten: true })), uhr.jetzt()), todosHeute: async () => { const h = tagIn(uhr.jetzt()); return (await todos.liste()).filter((t) => !t.erledigt && t.faellig && t.faellig <= h); }, wichtig: async () => (await todos.liste()).filter((t) => !t.erledigt && t.wichtig).slice(0, 5).map((t) => `**${t.titel}**${t.faellig ? ` (fällig ${t.faellig})` : ''}`), log: (t) => console.warn(t) });
  let telegram: TelegramBot | undefined;
  if ((konfig.telegramToken || opt.telegram) && konfig.telegramChatId) {
    telegram = new TelegramBot({
      uhr,
      lernStand: () => lernStand(seitMontag()),
      api: opt.telegram ?? telegramApi(konfig.telegramToken!, konfig.telegramApiUrl),
      chatId: konfig.telegramChatId,
      geheimnis: konfig.werkstattGeheimnis ?? konfig.telegramToken ?? 'test',
      appUrl: konfig.origins[0] ?? '',
      db,
      vault,
      agenten,
      schreibtisch,
      buergermeister,
      uni,
      postbote,
      morgenzeitung,
      listen,
      kalender: googleKalender,
      karten,
      kirchturm,
      gewohnheiten,
      wochenziele,
      erinnerungen,
      notizen,
      woche: wochenrueckblick,
      suche,
      noten,
      depot: async () => [...saxo.kurzbericht(), ...(await boerse.zeitungsZeilen()).map((x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;'))],
      statistik: (n) => statistik({ db, uhr, todos, gewohnheiten }, n),
      log: (t) => console.warn(t),
    });
    if (!opt.telegram) telegram.starten();
    const t = telegram;
    bank.beiWarnung.push((text) => t.bankMelden(text));
    saxo.beiMeldung.push((text) => void t.saxoMelden(text).catch(() => undefined));
    boerse.beiAlarm.push((text) => void t.saxoMelden(`🔔 Kursalarm\n${text}`).catch(() => undefined));
    wochenrueckblick.beiNeu.push((r) => t.rueckblickSenden(r));
    // Fokus: während einer Pomodoro-Arbeitsphase hält Telegram Meldungen zurück und schickt sie danach gesammelt
    t.fokusAktiv = () => kirchturm.fokusAktiv();
    erinnerungen.beiErinnerung.push((todo) => t.erinnerungSenden(todo));
    erinnerungen.beiGewohnheit.push((name) => t.gewohnheitErinnern(name));
    // E99: Pomodoro-Folge an einem To-do vorbei → in Telegram „Erledigt?“ fragen
    kirchturm.beiKlingeln.push((k) => {
      if (k.todo && k.sitzungEnde) void t.fokusFertigFragen(k.todo.pfad, k.todo.titel).catch(() => undefined);
    });
    kirchturm.beiFokusEnde.push(() => void t.nachtNachholen().catch(() => undefined));
  }
  // Review zu E185: nach einem Neustart hängende Pläne/Helfer-Abschlüsse und Chat-Warteschlangen aufgreifen
  await buergermeister.nachStart().catch((e) => console.error('Bürgermeister nach dem Start', e));
  agenten.nachStart();
  agenten.anstossen();
  if (!opt.moodle && !opt.kalender && !opt.google && opt.beobachten !== false) uni.starten();
  // Kontoauszüge, die während einer Pause dazukamen; Budget einmal am Tag prüfen (Monatswechsel, neue Einstellungen)
  if (opt.beobachten !== false) {
    void bank.einlesen().catch((e) => console.warn(`Bank: ${(e as Error).message}`));
    const bankTakt = setInterval(() => void bank.budgetPruefen().catch(() => undefined), 6 * 3_600_000);
    bankTakt.unref();
    // Kurse: stündlich nachsehen, abgerufen wird je Wert höchstens einmal am Tag (kostenlose Stufe: 20 Abrufe)
    const boerseTakt = setInterval(() => void boerse.aktualisieren().catch((e) => console.warn(`Börse: ${(e as Error).message}`)), 3_600_000);
    boerseTakt.unref();
    setTimeout(() => void boerse.aktualisieren().catch(() => undefined), 90_000).unref();
  }
  // Saxo: jede Minute Sitzung erneuern (Refresh-Token lebt nur ~40 min), Stand alle 30 min
  const saxoTakt =
    opt.beobachten !== false && konfig.saxo
      ? setInterval(() => void saxo.erneuern().then(() => saxo.aktualisieren()).catch((e) => console.warn(`Saxo: ${(e as Error).message}`)), 60_000)
      : undefined;
  saxoTakt?.unref();
  if (!opt.gmail && opt.beobachten !== false) postbote.starten();
  if (opt.beobachten !== false) morgenzeitung.starten();
  if (opt.beobachten !== false) wochenrueckblick.starten();
  if (opt.beobachten !== false) aufwachen.starten();
  if (opt.beobachten !== false) automatik.starten();
  // E62: jede Minute fällige Pläne automatisch annehmen
  const planTakt = opt.beobachten !== false ? setInterval(() => void buergermeister.faelligePlaeneAnnehmen().catch((e) => console.warn(`Pläne: ${(e as Error).message}`)), 60_000) : undefined;
  planTakt?.unref();
  const dorfplan = new Dorfplan({ db, uhr, hub, vault, uni, wetter, todos, kirchturm });
  const app = await appBauen({ konfig, ki, lernziele, db, uhr, vault, suche, hub, agenten, schreibtisch, buergermeister, telegram, uni, postbote, morgenzeitung, aufwachen, dorfplan, automatik, listen, bank, corps, boerse, saxo, kirchturm, googleKalender, wochenrueckblick, karten, gewohnheiten, wochenziele, notizen, noten });
  // Abhaken in Obsidian kommt ohne Ereignis an → zusätzlich alle 10 Minuten abgleichen
  const uniTodoTakt = opt.beobachten !== false ? setInterval(() => uniTodosAnstossen(), 600_000) : undefined;
  uniTodoTakt?.unref();
  if (opt.beobachten !== false) uniTodosAnstossen();
  app.addHook('onClose', async () => {
    geschlossen = true;
    if (uniTodoTakt) clearInterval(uniTodoTakt);
    if (saxoTakt) clearInterval(saxoTakt);
    kirchturm.stoppen();
    if (uniTodosZeitgeber) clearTimeout(uniTodosZeitgeber);
    uni.stoppen();
    postbote.stoppen();
    morgenzeitung.stoppen();
    wochenrueckblick.stoppen();
    aufwachen.stoppen();
    automatik.stoppen();
    if (planTakt) clearInterval(planTakt);
    telegram?.stoppen();
    await intern.close();
    await waechter?.close();
    // erst die Warteschlange zur Ruhe kommen lassen, dann die Datenbank schließen
    await agenten.ruhe();
    db.close();
  });
  return { app, lernziele, db, vault, suche, hub, angelegt, agenten, intern, register, schreibtisch, buergermeister, telegram, uni, postbote, ki, kalender, morgenzeitung, aufwachen, dorfplan, wetter, automatik, todos, listen, bank, corps, boerse, uniTodos, saxo, kirchturm, googleKalender, wochenrueckblick, karten, gewohnheiten, wochenziele, erinnerungen, notizen, noten };
}
