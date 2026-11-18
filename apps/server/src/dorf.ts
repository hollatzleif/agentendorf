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
import { motorenBauen } from './agenten/motoren.js';
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
import { moodleBrowserKlient, type MoodleBrowserKlient } from './agenten/moodle-browser.js';
import { SystemAufrufe } from './agenten/system.js';
import { sdkKlient, type ModellKlient } from './agenten/motor-api.js';
import { Postbote } from './post/postbote.js';
import { gmailKlient, type GmailKlient } from './post/gmail.js';
import { GoogleZugang } from './post/google-oauth.js';
import { Terminkalender } from './kalender.js';
import { Morgenzeitung } from './morgenzeitung.js';
import { Aufwachen } from './aufwachen.js';
import { listenAnlegen } from './todos.js';

/** Dateien, die das Dorf zum Arbeiten braucht: fehlen sie (z. B. Vault aus einer älteren Etappe), werden sie aus der Vorlage ergänzt – nie überschrieben. */
const PFLICHT_DATEIEN = [
  'Rathaus/aktionen/buergermeister.md',
  '00_Stadtordnung/telegram.md',
  '00_Stadtordnung/aufwachen.md',
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
];

/**
 * Vorlagendateien, die das Dorf ersetzen darf – aber NUR, wenn sie byte-genau einer früheren Vorlagenfassung
 * entsprechen (sha256), Leif sie also nie verändert hat. Alles andere bleibt unangetastet.
 */
const VORLAGE_FRUEHERE_FASSUNGEN: Record<string, string[]> = {
  'Uni/gebaeude.md': [
    'ec2518b6e8de76279701087fca5af642c2a164939cf3d69f8f2edb7643080077', // bis Etappe 2b
    'a0c46bec0fab52f7d0f900a1b10253c4bc6125d4e81ed8863599782af2e96ad2', // Etappe 3 (Moodle-App)
  ],
  'Uni/aktionen/abgabe-bearbeiten.md': ['28289a20e8f718a2b45d16b34ab2a578350078df696a855dccd52e6857259b11'],
  'Uni/aktionen/lernen.md': ['fe2283fc7e878ffd5f7f6a01ec776f50e49b6f96446c28db7cfcec36f48f1dd1'],
  'Post/gebaeude.md': ['313622cda22bc8ff13c0a644fab2c49f1bdf84c57eb2702231a70f2ac1e9a076'], // bis Etappe 3
  '00_Stadtordnung/aktion-vorlage.md': ['b0d3e48a90aa554a0e7ceb234edc1b026e285424313cc2654431b5b9c683f671'], // E60
  'Uni/aktionen/kursuebersicht.md': ['f525448be2f08c6d74635be2a96d4c89b0c1c98f5d0d21b42211da403833a8cf'], // E60
  '00_Stadtordnung/aufwachen.md': ['231a442ce4d7e593e65f27a057d4c5392521cd0da0b139c8c045a2d38c6efbd2'], // bis E61
  // E61: Gedächtnis/Persönlichkeit des Bürgermeisters
  'Rathaus/aktionen/buergermeister.md': ['653aace36ae47d42bc847eda934c819312ceb446d1d624ba92f8ff528eb37084'],
  'Rathaus/gebaeude.md': ['7dd8c996765e716a804cafdaa4734c16aa4f97afb94e20ae69a6b0cda615b130'],
  '00_Stadtordnung/stadtordnung.md': [
    'b25ae8f9443f9001f0d9fe78ede22016e41ff8839e073540172b22768507c95e', // Etappe 1
    '7dcba59a9ae908f2caaa02362b46cb0e8c4995b9350a764812dfe9f61d4f9bf1', // Etappe 2a
    '495a9ae689adcec68c4878b0fddf28b5c5909de8893b72aed438da2ad66b3bc6', // Etappe 2b
    'd7caf198ce646fe65d2fafa29e6ddd63bae6f21ccdd527b1a9dec63ec517aba9', // Etappe 3 bis E60
    'ff3beab8cf394168ff1cfc9e3d4e91fb9c6f9eced1152b31f2db5373547043e3', // E61–E64
  ],
  'Einkaufsladen/gebaeude.md': ['b334b038336be925930e612231f6129a7f25a723f111d08af9568117fe45e87f'], // geschlossen bis Etappe 7
  'Marktplatz/gebaeude.md': ['b7332c301634c2889f157d87138f392c3f2a49500a7fb31cc30a9d2d41157358'], // bis E64
};

/** Baut das ganze Dorf zusammen (für Start und Integrationstests). */
export async function dorfStarten(
  konfig: Konfig,
  opt: {
    uhr?: Uhr;
    beobachten?: boolean;
    motoren?: Record<'api' | 'claude-code', Motor> | ((r: WerkzeugRegister) => Record<'api' | 'claude-code', Motor>);
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
    /** Für Tests: Open-Meteo-Antwort ohne Netz */
    wetter?: () => Promise<unknown>;
  } = {},
) {
  const uhr = opt.uhr ?? systemUhr;
  const db = dbOeffnen(path.join(konfig.datenDir, 'dorf.db'));
  const vault = new VaultDienst(konfig.vaultDir, uhr);
  const angelegt = await vault.ausVorlage(konfig.vorlageDir);
  for (const p of PFLICHT_DATEIEN) {
    const quelle = path.join(konfig.vorlageDir, p);
    if (!(await vault.existiert(p)) && fs.existsSync(quelle)) await vault.schreiben(p, fs.readFileSync(quelle, 'utf8'), { nurNeu: true });
  }
  for (const [p, fassungen] of Object.entries(VORLAGE_FRUEHERE_FASSUNGEN)) {
    const quelle = path.join(konfig.vorlageDir, p);
    if (!fs.existsSync(quelle) || !(await vault.existiert(p))) continue;
    const jetzt = await vault.lesen(p);
    if (fassungen.includes(jetzt.version)) await vault.schreiben(p, fs.readFileSync(quelle, 'utf8'), { basisVersion: jetzt.version });
  }
  const suche = new Suchindex(db, vault);
  await suche.vollIndex();
  const hub = new LiveHub();

  const schreibtischRef: { aktuell?: Schreibtisch } = {};
  const aenderung = (rel: string, art: 'angelegt' | 'geaendert' | 'geloescht') => {
    if (art === 'geloescht') suche.entfernen(rel);
    else if (istText(rel)) void suche.aktualisieren(rel).catch(() => undefined);
    hub.gebuendelt({ typ: 'vault.geaendert', pfad: rel, art });
    if (!rel.includes('/') || /^[^/]+\/gebaeude\.md$/.test(rel) || /^[^/]+\/aktionen\//.test(rel)) hub.gebuendelt({ typ: 'gebaeude.geaendert' });
    if (VaultDienst.istKonflikt(rel)) hub.gebuendelt({ typ: 'konflikte.geaendert' });
    if (/^[^/]+\/aktionen\//.test(rel)) hub.gebuendelt({ typ: 'aktionen.geaendert' });
    if (rel.startsWith('00_Stadtordnung/')) hub.gebuendelt({ typ: 'konfig.geaendert' });
    if (art === 'angelegt' && Schreibtisch.istAufgabe(rel)) void schreibtischRef.aktuell?.vaultAufnehmen(rel).catch(() => undefined);
  };
  vault.beobachten(aenderung);
  const waechter = opt.beobachten === false ? null : vaultBeobachten(vault.wurzel, aenderung);

  const register = new WerkzeugRegister();
  const motoren = typeof opt.motoren === 'function' ? opt.motoren(register) : (opt.motoren ?? motorenBauen(konfig, register));
  const agenten = new AgentenDienst(db, uhr, vault, suche, hub, motoren);
  if (konfig.rechenraumGeheimnis) agenten.rechenraum = rechenraumKlient(konfig.rechenraumUrl, konfig.rechenraumGeheimnis);
  if (opt.moodleBrowser) agenten.moodleBrowser = opt.moodleBrowser;
  else if (konfig.browserGeheimnis) agenten.moodleBrowser = moodleBrowserKlient(konfig.browserUrl, konfig.browserGeheimnis);
  const intern = await internBauen(register);
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
  const gmail = opt.gmail ?? (konfig.gmail ? gmailKlient(new GoogleZugang({ ...konfig.gmail, tokenUrl: konfig.googleTokenUrl }), konfig.gmailApiUrl) : undefined);
  const ki = new SystemAufrufe({
    db,
    uhr,
    vault,
    hub,
    klient: opt.ki ?? (konfig.anthropicApiKey && !konfig.motorAttrappe ? () => sdkKlient(konfig.anthropicApiKey!) : undefined),
  });
  const postbote = new Postbote({
    db,
    uhr,
    vault,
    hub,
    ki,
    gmail,
    log: (t) => console.warn(t),
  });
  agenten.post = gmail;
  const kalender = new Terminkalender(opt.google ? opt.google.termine : konfig.googleTermineIcs ? kalenderQuelle(konfig.googleTermineIcs) : undefined, () => uhr.jetzt());
  // Ablage mit Archiv + Zeitplaner für Aktionen (E60)
  agenten.ablage = new Ablage({ db, uhr, vault, log: (t) => console.warn(t) });
  agenten.beiLaufEnde.push(async (e) => {
    const t = await agenten.ablage!.abschliessen(e);
    if (t) await agenten.hinweisSchreiben(e.chatId, t);
  });
  // E65: To-do-Brett auf dem Marktplatz (App, Telegram, alle Agenten)
  // Etappe 7: weitere Listen (Einkauf, Wunsch, Corps) mit derselben Technik
  const listen = listenAnlegen({ vault, uhr }, (liste) => hub.senden({ typ: 'todos.geaendert', liste }));
  const todos = listen.todo;
  agenten.listen = listen;
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
  const aufwachen = new Aufwachen({ db, uhr, hub, schreibtisch, buergermeister, freigaben: agenten.freigaben, uni, postbote, vault, log: (t) => console.warn(t) });
  const wetter = new Wetter({ url: konfig.wetterUrl, ort: konfig.wetterOrt, uhr, laden: opt.wetter, log: (t) => console.warn(t) });
  // einmal vorab holen, damit das Wetter schon beim ersten Öffnen des Dorfs da ist (nur mit WETTER_URL)
  if (konfig.wetterUrl) void wetter.holen();
  const morgenzeitung = new Morgenzeitung({ db, uhr, vault, hub, ki, freigaben: agenten.freigaben, schreibtisch, uni, postbote, kalender, wetter, log: (t) => console.warn(t) });
  let telegram: TelegramBot | undefined;
  if ((konfig.telegramToken || opt.telegram) && konfig.telegramChatId) {
    telegram = new TelegramBot({
      uhr,
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
      log: (t) => console.warn(t),
    });
    if (!opt.telegram) telegram.starten();
  }
  agenten.anstossen();
  if (!opt.moodle && !opt.kalender && !opt.google && opt.beobachten !== false) uni.starten();
  if (!opt.gmail && opt.beobachten !== false) postbote.starten();
  if (opt.beobachten !== false) morgenzeitung.starten();
  if (opt.beobachten !== false) aufwachen.starten();
  if (opt.beobachten !== false) automatik.starten();
  // E62: jede Minute fällige Pläne automatisch annehmen
  const planTakt = opt.beobachten !== false ? setInterval(() => void buergermeister.faelligePlaeneAnnehmen().catch((e) => console.warn(`Pläne: ${(e as Error).message}`)), 60_000) : undefined;
  planTakt?.unref();
  const dorfplan = new Dorfplan({ db, uhr, hub, vault, uni, wetter });
  const app = await appBauen({ konfig, db, uhr, vault, suche, hub, agenten, schreibtisch, buergermeister, telegram, uni, postbote, morgenzeitung, aufwachen, dorfplan, automatik, listen });
  app.addHook('onClose', async () => {
    uni.stoppen();
    postbote.stoppen();
    morgenzeitung.stoppen();
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
  return { app, db, vault, suche, hub, angelegt, agenten, intern, register, schreibtisch, buergermeister, telegram, uni, postbote, ki, kalender, morgenzeitung, aufwachen, dorfplan, wetter, automatik, todos, listen };
}
