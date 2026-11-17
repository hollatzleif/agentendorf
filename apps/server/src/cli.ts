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

const HILFE = `Agentendorf – Verwaltung
  passwort                 Passwort setzen oder ändern (beendet alle Sitzungen)
  passwort --stdin         Passwort aus der Standardeingabe lesen (für Skripte)
  totp-aus                 Zweiten Faktor abschalten (Notfall, wenn das Handy weg ist)
  sitzungen-beenden        Alle Sitzungen beenden (alle Geräte abmelden)
  db-sichern <zieldatei>   Konsistente Kopie der Datenbank anlegen (für das Backup)
  vault-ergaenzen          Fehlende Dateien aus der Vorlage ergänzen (überschreibt nie)
  moodle-token <url> <prüfwert>
                           Liest die moodlemobile://-Adresse von stdin, prüft Signatur und Verbindung,
                           gibt das Token auf stdout aus (nur für dorf moodle-anmelden)`;

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
