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
import { SystemAufrufe } from './agenten/system.js';
import { sdkKlient, type ModellKlient } from './agenten/motor-api.js';
import { Postbote } from './post/postbote.js';
import { gmailKlient, type GmailKlient } from './post/gmail.js';
import { GoogleZugang } from './post/google-oauth.js';

/** Dateien, die das Dorf zum Arbeiten braucht: fehlen sie (z. B. Vault aus einer älteren Etappe), werden sie aus der Vorlage ergänzt – nie überschrieben. */
const PFLICHT_DATEIEN = ['Rathaus/aktionen/buergermeister.md', '00_Stadtordnung/telegram.md', 'Uni/aktionen/lernen.md', 'Uni/aktionen/abgabe-bearbeiten.md'];

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
    google?: { fristen?: KalenderQuelle; pflicht?: KalenderQuelle };
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
  agenten.quellen = (q) => uni.quelle(q);
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
    gmail: opt.gmail ?? (konfig.gmail ? gmailKlient(new GoogleZugang({ ...konfig.gmail, tokenUrl: konfig.googleTokenUrl }), konfig.gmailApiUrl) : undefined),
    log: (t) => console.warn(t),
  });
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
      log: (t) => console.warn(t),
    });
    if (!opt.telegram) telegram.starten();
  }
  agenten.anstossen();
  if (!opt.moodle && !opt.kalender && !opt.google && opt.beobachten !== false) uni.starten();
  if (!opt.gmail && opt.beobachten !== false) postbote.starten();
  const app = await appBauen({ konfig, db, uhr, vault, suche, hub, agenten, schreibtisch, buergermeister, telegram, uni, postbote });
  app.addHook('onClose', async () => {
    uni.stoppen();
    postbote.stoppen();
    telegram?.stoppen();
    await intern.close();
    await waechter?.close();
    // erst die Warteschlange zur Ruhe kommen lassen, dann die Datenbank schließen
    await agenten.ruhe();
    db.close();
  });
  return { app, db, vault, suche, hub, angelegt, agenten, intern, register, schreibtisch, buergermeister, telegram, uni, postbote, ki };
}
