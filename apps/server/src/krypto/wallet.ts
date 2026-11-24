// E228: Wallets der Bots – je Bot ein EIGENES, neu erzeugtes Solana-Wallet. Der private Schlüssel liegt nur
// verschlüsselt in der Datenbank des Kryptowerks (AES-256-GCM, Hauptschlüssel nur in /srv/dorf/krypto.env, nicht im
// Backup). Er verlässt das Kryptowerk nie – kein Log, kein LLM, keine App, kein Dorf. Ausnahme: `dorf krypto-export`
// auf dem Server, damit Leif ein Wallet in Phantom übernehmen kann.
import crypto from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import type { KDB } from './motor.js';

export class WalletTresor {
  private schluessel: Buffer | null;

  constructor(
    private db: KDB,
    hauptschluesselHex: string | undefined,
  ) {
    this.schluessel = hauptschluesselHex && /^[0-9a-f]{64}$/i.test(hauptschluesselHex) ? Buffer.from(hauptschluesselHex, 'hex') : null;
  }

  get bereit() {
    return !!this.schluessel;
  }

  /** neues Wallet für einen Bot (null ohne Hauptschlüssel) */
  erzeugen(botId: string): string | null {
    if (!this.schluessel) return null;
    const kp = Keypair.generate();
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.schluessel, iv);
    c.setAAD(Buffer.from(kp.publicKey.toBase58()));
    const geheim = Buffer.concat([c.update(Buffer.from(kp.secretKey)), c.final()]);
    this.db
      .prepare('INSERT INTO wallets (adresse, bot_id, geheim, iv, tag, erstellt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(kp.publicKey.toBase58(), botId, geheim, iv, c.getAuthTag(), Date.now());
    kp.secretKey.fill(0);
    return kp.publicKey.toBase58();
  }

  adresse(botId: string): string | null {
    return (this.db.prepare('SELECT adresse FROM wallets WHERE bot_id = ? ORDER BY erstellt DESC LIMIT 1').get(botId) as { adresse: string } | undefined)?.adresse ?? null;
  }

  /** Schlüsselpaar nur für den Moment des Signierens – danach verwerfen */
  keypair(adresse: string): Keypair {
    if (!this.schluessel) throw new Error('Hauptschlüssel fehlt (KRYPTO_HAUPTSCHLUESSEL)');
    const z = this.db.prepare('SELECT geheim, iv, tag FROM wallets WHERE adresse = ?').get(adresse) as { geheim: Buffer; iv: Buffer; tag: Buffer } | undefined;
    if (!z) throw new Error('Wallet unbekannt');
    const d = crypto.createDecipheriv('aes-256-gcm', this.schluessel, z.iv);
    d.setAAD(Buffer.from(adresse));
    d.setAuthTag(z.tag);
    const roh = Buffer.concat([d.update(z.geheim), d.final()]);
    const kp = Keypair.fromSecretKey(new Uint8Array(roh));
    roh.fill(0);
    if (kp.publicKey.toBase58() !== adresse) throw new Error('Wallet passt nicht zur Adresse');
    return kp;
  }

  /** Bot gelöscht: Wallet bleibt (Schlüssel geht nie verloren), nur ohne Bot */
  archivieren(botId: string) {
    this.db.prepare("UPDATE wallets SET bot_id = 'archiv:' || bot_id WHERE bot_id = ?").run(botId);
  }

  /** nur für `dorf krypto-export` auf dem Server: privater Schlüssel im Phantom-Format (Base58) */
  exportieren(adresse: string): string {
    const kp = this.keypair(adresse);
    const s = bs58.encode(kp.secretKey);
    kp.secretKey.fill(0);
    return s;
  }

  liste(): { adresse: string; botId: string }[] {
    return (this.db.prepare('SELECT adresse, bot_id FROM wallets ORDER BY erstellt').all() as { adresse: string; bot_id: string }[]).map((x) => ({ adresse: x.adresse, botId: x.bot_id }));
  }
}

/** gültige Solana-Adresse (Base58, 32 Byte) */
export function istAdresse(s: string): boolean {
  try {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) && bs58.decode(s).length === 32;
  } catch {
    return false;
  }
}
