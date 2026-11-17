import path from 'node:path';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { konfigLaden } from './konfig.js';
import { dbOeffnen } from './db.js';
import { systemUhr } from './uhr.js';
import { passwortSetzen } from './auth/passwort.js';
import { Sitzungen } from './auth/sitzungen.js';
import { VaultDienst } from './vault/dienst.js';
import { moodleKlient, tokenAusLaunch, verbindungPruefen } from './uni/moodle.js';
import { kalenderQuelle } from './uni/abgleich.js';
import { icsLesen, icsTermine } from './uni/ical.js';
import { fristText } from './uni/text.js';

const HILFE = `Agentendorf – Verwaltung
  passwort                 Passwort setzen oder ändern (beendet alle Sitzungen)
  passwort --stdin         Passwort aus der Standardeingabe lesen (für Skripte)
  totp-aus                 Zweiten Faktor abschalten (Notfall, wenn das Handy weg ist)
  sitzungen-beenden        Alle Sitzungen beenden (alle Geräte abmelden)
  db-sichern <zieldatei>   Konsistente Kopie der Datenbank anlegen (für das Backup)
  vault-ergaenzen          Fehlende Dateien aus der Vorlage ergänzen (überschreibt nie)
  moodle-token <url> <prüfwert>
                           Liest die moodlemobile://-Adresse von stdin, prüft Signatur und Verbindung,
                           gibt das Token auf stdout aus (nur für dorf moodle-anmelden)
  google-kalender-pruefen <fristen|pflicht>
                           Liest eine geheime Google-Kalender-Adresse von stdin, lädt sie und zeigt, was das Dorf übernimmt
  moodle-kalender-pruefen  Liest die Kalender-Adresse von stdin, lädt den Export und zeigt, was drin ist
                           (nur für dorf moodle-kalender; die Adresse selbst wird nie ausgegeben)`;

async function verdecktFragen(frage: string): Promise<string> {
  let stumm = false;
  const aus = new Writable({
    write(chunk, _enc, cb) {
      if (!stumm) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output: aus, terminal: true });
  return new Promise((res) => {
    rl.question(frage, (a) => {
      rl.close();
      process.stdout.write('\n');
      res(a);
    });
    stumm = true;
  });
}

async function stdinLesen() {
  const teile: Buffer[] = [];
  for await (const t of process.stdin) teile.push(t as Buffer);
  return Buffer.concat(teile).toString('utf8').replace(/\r?\n$/, '');
}

const konfig = konfigLaden();
const [befehl, ...rest] = process.argv.slice(2);
const db = dbOeffnen(path.join(konfig.datenDir, 'dorf.db'));
try {
  switch (befehl) {
    case 'passwort': {
      let pw: string;
      if (rest.includes('--stdin')) pw = await stdinLesen();
      else {
        pw = await verdecktFragen('Neues Passwort (mind. 14 Zeichen): ');
        const pw2 = await verdecktFragen('Wiederholen: ');
        if (pw !== pw2) throw new Error('Die Eingaben stimmen nicht überein.');
      }
      await passwortSetzen(db, systemUhr, pw);
      const n = new Sitzungen(db, systemUhr).alleAusserBeenden(null).length;
      console.log(`Passwort gesetzt. ${n} Sitzung(en) beendet.`);
      break;
    }
    case 'totp-aus':
      db.prepare('UPDATE nutzer SET totp_geheimnis = NULL, totp_aktiv = 0, totp_letzter_zaehler = NULL WHERE id = 1').run();
      console.log('Zweiter Faktor abgeschaltet.');
      break;
    case 'sitzungen-beenden':
      console.log(`${new Sitzungen(db, systemUhr).alleAusserBeenden(null).length} Sitzung(en) beendet.`);
      break;
    case 'db-sichern': {
      const ziel = rest[0];
      if (!ziel) throw new Error('Zieldatei fehlt.');
      await db.backup(ziel);
      console.log(`Datenbank gesichert nach ${ziel}`);
      break;
    }
    case 'vault-ergaenzen': {
      const n = await new VaultDienst(konfig.vaultDir, systemUhr).ausVorlage(konfig.vorlageDir, { ergaenzen: true });
      console.log(`${n} fehlende Datei(en) aus der Vorlage ergänzt.`);
      break;
    }
    case 'moodle-token': {
      const [url, passport] = rest;
      if (!url || !passport) throw new Error('Aufruf: moodle-token <moodle-url> <prüfwert>');
      const { token } = tokenAusLaunch(await stdinLesen(), url, passport);
      const v = await verbindungPruefen(moodleKlient(url, token));
      console.error(`Verbunden mit ${v.seite} als ${v.nutzer}.`);
      if (v.fehlend.length) {
        console.error(`STOPP: Moodle erlaubt diese Funktionen nicht: ${v.fehlend.join(', ')}. Token wird NICHT gespeichert.`);
        process.exitCode = 2;
        break;
      }
      for (const f of v.optionalFehlend) console.error(`Hinweis: ${f} ist nicht erlaubt – dieser Teil des Abgleichs fällt weg.`);
      process.stdout.write(token);
      break;
    }
    case 'google-kalender-pruefen': {
      const art = rest[0];
      if (art !== 'fristen' && art !== 'pflicht') throw new Error('Aufruf: google-kalender-pruefen <fristen|pflicht>');
      const url = (await stdinLesen()).trim();
      const jetzt = Date.now();
      const termine = icsTermine(await kalenderQuelle(url).laden(), jetzt, jetzt + 60 * 86_400_000);
      const passend = art === 'fristen' ? termine.filter((t) => /^\s*(✅\s*)?(⏰|📝)/.test(t.titel)) : termine.filter((t) => /^\s*(pflicht|prüfung)\s*:/i.test(t.titel));
      console.error(
        art === 'fristen'
          ? `Kalender gelesen: ${termine.length} kommende Einträge, davon ${passend.length} Fristen/Prüfungen (⏰/📝).`
          : `Kalender gelesen: ${termine.length} kommende Einträge (60 Tage), davon ${passend.length} mit „Pflicht:“/„Prüfung:“ – nur die übernimmt das Dorf.`,
      );
      for (const t of passend.slice(0, 5)) console.error(`  ${fristText(t.start)}  ${t.titel}`);
      if (termine.length && !passend.length) console.error('Hinweis: Kein passender Eintrag gefunden – ist es der richtige Kalender?');
      break;
    }
    case 'moodle-kalender-pruefen': {
      const url = (await stdinLesen()).trim();
      const termine = icsLesen(await kalenderQuelle(url).laden());
      const kommend = termine.filter((t) => t.start != null && t.start > Date.now()).sort((a, b) => a.start! - b.start!);
      console.error(`Kalender gelesen: ${termine.length} Termine, davon ${kommend.length} in der Zukunft.`);
      for (const t of kommend.slice(0, 5)) console.error(`  ${fristText(t.start)}  ${t.titel}${t.kategorie ? ` (${t.kategorie})` : ''}`);
      break;
    }
    default:
      console.log(HILFE);
      if (befehl && befehl !== 'hilfe') process.exitCode = 1;
  }
} catch (e) {
  console.error(`Fehler: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
