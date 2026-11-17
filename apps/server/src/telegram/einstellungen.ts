import matter from 'gray-matter';
import { z } from 'zod';
import type { TelegramEinstellungen } from '@dorf/shared';
import type { VaultDienst } from '../vault/dienst.js';

export const TELEGRAM_PFAD = '00_Stadtordnung/telegram.md';
export const STANDARD: TelegramEinstellungen = { freigaben: true, entwuerfe: true, fehler: true, beendet: true, mails: false };

const JaNein = z.preprocess((w) => (w === 'ja' ? true : w === 'nein' ? false : w), z.boolean());
const Schema = z.object({
  freigaben: JaNein.default(true),
  entwuerfe: JaNein.default(true),
  fehler: JaNein.default(true),
  beendet: JaNein.default(true),
  mails: JaNein.default(false),
});

export async function einstellungenLaden(vault: VaultDienst): Promise<TelegramEinstellungen> {
  try {
    return Schema.parse(matter((await vault.lesen(TELEGRAM_PFAD)).inhalt).data);
  } catch {
    return { ...STANDARD };
  }
}

export async function einstellungenSetzen(vault: VaultDienst, e: TelegramEinstellungen) {
  const g = Schema.parse(e);
  const d = await vault.lesen(TELEGRAM_PFAD).catch(() => null);
  const m = d ? matter(d.inhalt) : { data: { titel: 'Telegram-Meldungen' }, content: '\n# Telegram-Meldungen\n' };
  const neu = matter.stringify(m.content, { ...m.data, ...g });
  await vault.schreiben(TELEGRAM_PFAD, neu, { basisVersion: d?.version });
  return g;
}
