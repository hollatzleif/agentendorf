import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ModellKlient } from '../src/agenten/motor-api.js';
import { csvAnalysieren, datum, gegenseiteSchluessel, zahl } from '../src/bank.js';
import { gmailKlient } from '../src/post/gmail.js';
import { GoogleZugang } from '../src/post/google-oauth.js';
import { googleAttrappe } from './google-attrappe.js';
import { testDorf } from './hilfen.js';
import { kopf } from './etappe7.test.js';

const offen: { schliessen: () => Promise<void> }[] = [];
afterEach(async () => {
  while (offen.length) await offen.pop()!.schliessen();
});

/** ausgedachte Auszüge in typischen Formaten (keine echten Daten) */
const SPARKASSE_LATIN1 = Buffer.from(
  [
    'Umsätze Girokonto;;;;',
    'Zeitraum: 01.10.2026 - 31.10.2026;;;;',
    '',
    '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Beguenstigter/Zahlungspflichtiger";"Betrag";"Waehrung"',
    '"DE00";"01.10.26";"01.10.26";"LASTSCHRIFT";"Miete Oktober";"Wohnheim GmbH";"-420,00";"EUR"',
    '"DE00";"03.10.26";"03.10.26";"KARTENZAHLUNG";"REWE SAGT DANKE 1234";"REWE Markt";"-34,57";"EUR"',
    '"DE00";"05.10.26";"05.10.26";"LASTSCHRIFT";"Spotify P1234";"Spotify AB";"-10,99";"EUR"',
    '"DE00";"15.10.26";"15.10.26";"GUTSCHRIFT";"Lohn Oktober";"Arbeitgeber KG";"1.250,00";"EUR"',
    '"DE00";"20.10.26";"20.10.26";"KARTENZAHLUNG";"Bäckerei Müller";"Bäckerei Müller";"-4,20";"EUR"',
  ].join('\r\n'),
  'latin1',
);
const ENGLISCH = ['Date,Payee,Payment Reference,Amount (EUR)', '2026-11-02,Netflix,Abo,-13.99', '2026-11-03,Unbekannter Laden XY,Kauf,-25.00', '2026-11-05,Spotify AB,Spotify P1234,-10.99'].join('\n');
const SOLL_HABEN = ['Datum;Empfänger;Verwendungszweck;Soll;Haben', '01.11.2026;Tagesgeld Sparen;Übertrag;100,00;', '02.11.2026;Oma;Geburtstag;;50,00'].join('\n');
const UNBEKANNT = ['Tag;Wer;Was;Euro', '04.11.2026;Kiosk;Zeitung;-3,50'].join('\n');

describe('Bank: CSV verstehen', () => {
  it('Zahlen, Datum, Kopfzeile, Trennzeichen, Gegenseiten-Schlüssel', () => {
    expect(zahl('-1.234,56')).toBe(-1234.56);
    expect(zahl('1,234.56')).toBe(1234.56);
    expect(zahl('12,50 €')).toBe(12.5);
    expect(zahl('49,99S')).toBe(-49.99);
    expect(zahl('abc')).toBeNull();
    expect(datum('01.10.26')).toBe('2026-10-01');
    expect(datum('2026-11-02')).toBe('2026-11-02');
    expect(datum('x')).toBeNull();
    const a = csvAnalysieren(SPARKASSE_LATIN1.toString('latin1'))!;
    expect(a).toMatchObject({ trenner: ';', kopfZeile: 2, vollstaendig: true });
    expect(a.zuordnung).toMatchObject({ datum: 1, zweck: 4, gegenseite: 5, betrag: 6, waehrung: 7 });
    expect(csvAnalysieren(ENGLISCH)!.trenner).toBe(',');
    expect(csvAnalysieren(UNBEKANNT)!.vollstaendig).toBe(false);
    expect(gegenseiteSchluessel('Spotify AB')).toBe(gegenseiteSchluessel('SPOTIFY AB 123456'));
  });
});

describe('Bank: einlesen, einordnen, auswerten', () => {
  it('liest Auszüge (Latin-1, Englisch, Soll/Haben), doppelte Buchungen nur einmal, Kategorien, Monat, Abos, Sparziel, Budget-Warnung einmal', async () => {
    const d = await testDorf();
    const ordner = path.join(d.vault.wurzel, 'Bank/auszuege');
    fs.mkdirSync(ordner, { recursive: true });
    fs.writeFileSync(path.join(ordner, 'oktober.csv'), SPARKASSE_LATIN1);
    fs.writeFileSync(path.join(ordner, 'oktober-kopie.csv'), SPARKASSE_LATIN1); // überlappender Export
    fs.writeFileSync(path.join(ordner, 'november.csv'), ENGLISCH);
    fs.writeFileSync(path.join(ordner, 'sparen.csv'), SOLL_HABEN);
    const r = await d.bank.einlesen();
    expect(r.neu).toBe(5 + 3 + 2);
    expect(await d.bank.einlesen()).toEqual({ neu: 0, dateien: 0 }); // unverändert → nichts zu tun

    const okt = await d.bank.monat('2026-10');
    expect(okt).toMatchObject({ einnahmen: 1250, ausgaben: 469.76, saldo: 780.24 });
    const kat = Object.fromEntries(okt.buchungen.map((b) => [b.gegenseite, b.kategorie]));
    expect(kat).toMatchObject({ 'Wohnheim GmbH': 'Wohnen', 'REWE Markt': 'Lebensmittel', 'Spotify AB': 'Abos & Medien', 'Arbeitgeber KG': 'Einkommen', 'Bäckerei Müller': 'Essen gehen' });
    // Leifs Einstellungen: Budget Lebensmittel 250 (Vorlage) → noch keine Warnung; eigene Regel + Sparziel
    const nov = await d.bank.monat('2026-11');
    expect(nov.buchungen.find((b) => b.gegenseite === 'Unbekannter Laden XY')!.kategorie).toBe('Sonstiges'); // ohne KI
    expect(nov.buchungen.find((b) => b.gegenseite === 'Oma')!.kategorie).toBe('Einkommen');
    expect(nov.sparziele[0]).toMatchObject({ name: 'Notgroschen', ziel: 1000, gespart: 100, prozent: 10 });
    // Tagesgeld-Übertrag zählt nicht als Ausgabe
    expect(nov.ausgaben).toBe(49.98);

    // Leif stellt um – gilt für alle Buchungen derselben Gegenseite, auch künftige
    const laden = nov.buchungen.find((b) => b.gegenseite === 'Unbekannter Laden XY')!;
    expect(d.bank.kategorieSetzen(laden.id, 'Freizeit')).toBe(1);
    fs.writeFileSync(path.join(ordner, 'november2.csv'), `${ENGLISCH}\n2026-11-10,Unbekannter Laden XY,Kauf,-7.00`);
    await d.bank.einlesen();
    const nov2 = await d.bank.monat('2026-11');
    expect(nov2.buchungen.filter((b) => b.gegenseite === 'Unbekannter Laden XY').map((b) => [b.kategorie, b.vonLeif])).toEqual([
      ['Freizeit', true],
      ['Freizeit', true],
    ]);

    // Abo: Spotify Oktober + November + Dezember (3× monatlich)
    fs.writeFileSync(path.join(ordner, 'dezember.csv'), ['Date,Payee,Payment Reference,Amount (EUR)', '2026-12-05,Spotify AB,Spotify P1234,-10.99', '2026-12-06,REWE Markt,Einkauf,-240.00'].join('\n'));
    d.uhr.vor(20 * 86_400_000); // 6.12.
    const warnungen: string[] = [];
    d.bank.beiWarnung.push((t) => void warnungen.push(t));
    await d.bank.einlesen();
    const abos = d.bank.abos();
    expect(abos).toEqual([expect.objectContaining({ gegenseite: 'Spotify AB', betrag: 10.99, rhythmus: 'monatlich', anzahl: 3, letzte: '2026-12-05', naechste: '2027-01-04' })]);
    // Budget Lebensmittel 250 → 240 € = 96 % → genau eine Warnung, beim nächsten Prüfen nicht noch einmal
    expect(warnungen).toEqual([expect.stringMatching(/Budget fast aufgebraucht: Lebensmittel – 240.00 € von 250.00 € \(96 %\)/)]);
    expect(await d.bank.budgetPruefen()).toEqual([]);
    expect(await d.bank.zeitungsZeilen()).toEqual(['Lebensmittel: 240 € von 250 € (96 %)']);
  });

  it('unbekanntes Format: Datei wartet auf Zuordnung, nach der Zuordnung (gemerkt) wird eingelesen; API', async () => {
    const d = await testDorf();
    const h = await kopf(d);
    fs.mkdirSync(path.join(d.vault.wurzel, 'Bank/auszuege'), { recursive: true });
    fs.writeFileSync(path.join(d.vault.wurzel, 'Bank/auszuege/kiosk.csv'), UNBEKANNT);
    await d.app.inject({ method: 'POST', url: '/api/bank/einlesen', headers: h });
    const m = (await d.app.inject({ url: '/api/bank/monat?monat=2026-11', headers: h })).json();
    const datei = m.dateien.find((x: { datei: string }) => x.datei === 'Bank/auszuege/kiosk.csv');
    expect(datei).toMatchObject({ status: 'zuordnung', spalten: { kopf: ['Tag', 'Wer', 'Was', 'Euro'], beispiel: [['04.11.2026', 'Kiosk', 'Zeitung', '-3,50']] } });
    const z = await d.app.inject({ method: 'POST', url: '/api/bank/zuordnung', headers: h, payload: { kennung: datei.spalten.kennung, zuordnung: { datum: 0, gegenseite: 1, zweck: 2, betrag: 3 } } });
    expect(z.json()).toMatchObject({ neu: 1 });
    const m2 = (await d.app.inject({ url: '/api/bank/monat?monat=2026-11', headers: h })).json();
    expect(m2.buchungen).toMatchObject([{ gegenseite: 'Kiosk', betrag: -3.5 }]);
    // gleiches Format später: Zuordnung ist gemerkt
    fs.writeFileSync(path.join(d.vault.wurzel, 'Bank/auszuege/kiosk2.csv'), `${UNBEKANNT}\n05.11.2026;Kiosk;Kaffee;-2,00`);
    expect((await d.bank.einlesen()).neu).toBe(1);
    expect((await d.app.inject({ method: 'POST', url: '/api/bank/zuordnung', headers: h, payload: { kennung: datei.spalten.kennung, zuordnung: { gegenseite: 1 } } })).statusCode).toBe(400);
  });

  it('Bank ist offen, Skill für PDF-Auszüge ist fehlerfrei', async () => {
    const d = await testDorf();
    const { aktionenListe } = await import('../src/agenten/aktionen.js');
    const a = (await aktionenListe(d.vault)).find((x) => x.id === 'Bank/kontoauszug-pdf')!;
    expect(a.fehler).toBeUndefined();
    expect(a).toMatchObject({ fremdinhalte: true, motor: 'claude-code' });
  });
});

describe('Bank: Rechnungen aus Mails', () => {
  it('der Postbote erkennt eine Rechnung → To-do mit Fälligkeit (Bank, aus Mail markiert), genau einmal', async () => {
    const g = await googleAttrappe();
    offen.push(g);
    const klient: ModellKlient = {
      async streamen(params) {
        const inhalt = String((params.messages[0] as { content: string }).content);
        const mails = JSON.parse(/<fremdinhalt quelle="gmail">\n([\s\S]*)\n<\/fremdinhalt>/.exec(inhalt)![1]!) as { id: string; betreff: string }[];
        const ergebnisse = mails.map((m) => ({
          id: m.id,
          kategorie: 'Finanzen',
          wichtig: true,
          antwort_noetig: false,
          zusammenfassung: 'Rechnung',
          frist: '',
          rechnung_betrag: /Rechnung/.test(m.betreff) ? '49,99 €' : '',
          rechnung_faellig: /Rechnung/.test(m.betreff) ? '30.11.2026' : '',
          rechnung_empfaenger: /Rechnung/.test(m.betreff) ? 'Handyanbieter' : '',
        }));
        return {
          id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5',
          content: [{ type: 'text', text: JSON.stringify({ ergebnisse }), citations: null }],
          stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        } as unknown as BetaMessage;
      },
    };
    const gmail = gmailKlient(new GoogleZugang({ clientId: 'c', clientSecret: 's', refreshToken: 'refresh-gut', tokenUrl: g.tokenUrl }), g.basis);
    const d = await testDorf({ gmail, ki: () => klient });
    g.mailNeu({ labels: ['INBOX'], von: 'Handy <rechnung@handy.example>', betreff: 'Ihre Rechnung November', text: 'Bitte zahlen', datum: d.uhr.jetzt() - 3600_000 });
    g.mailNeu({ labels: ['INBOX'], von: 'Bank <info@bank.example>', betreff: 'Kontoauszug bereit', text: 'x', datum: d.uhr.jetzt() - 3500_000 });
    await d.postbote.abholen();
    let t = await d.listen.todo.liste();
    expect(t).toMatchObject([{ titel: 'Rechnung: Handyanbieter – 49,99 €', faellig: '2026-11-30', gebaeude: 'Bank', quelle: 'Postbote', fremd: true }]);
    await d.postbote.abholen();
    t = await d.listen.todo.liste();
    expect(t).toHaveLength(1);
  });
});
