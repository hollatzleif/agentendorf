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
import { Uni } from './uni/abgleich.js';
import { moodleKlient, type MoodleKlient } from './uni/moodle.js';
import { rechenraumKlient } from './agenten/rechenraum.js';

/** Dateien, die das Dorf zum Arbeiten braucht: fehlen sie (z. B. Vault aus einer älteren Etappe), werden sie aus der Vorlage ergänzt – nie überschrieben. */
const PFLICHT_DATEIEN = ['Rathaus/aktionen/buergermeister.md', '00_Stadtordnung/telegram.md', 'Uni/aktionen/lernen.md', 'Uni/aktionen/abgabe-bearbeiten.md'];

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
    pauseMs: opt.moodle ? 0 : 500,
    log: (t) => console.warn(t),
  });
  agenten.quellen = (q) => uni.quelle(q);
  let telegram: TelegramBot | undefined;
  if ((konfig.telegramToken || opt.telegram) && konfig.telegramChatId) {
    telegram = new TelegramBot({
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
      log: (t) => console.warn(t),
    });
    if (!opt.telegram) telegram.starten();
  }
  agenten.anstossen();
  if (!opt.moodle && opt.beobachten !== false) uni.starten();
  const app = await appBauen({ konfig, db, uhr, vault, suche, hub, agenten, schreibtisch, buergermeister, telegram, uni });
  app.addHook('onClose', async () => {
    uni.stoppen();
    telegram?.stoppen();
    await intern.close();
    await waechter?.close();
    db.close();
  });
  return { app, db, vault, suche, hub, angelegt, agenten, intern, register, schreibtisch, buergermeister, telegram, uni };
}
