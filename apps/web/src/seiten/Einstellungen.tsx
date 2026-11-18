import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import type { Anschluss, Ich, Konflikt, ProgrammeInfo, SitzungInfo } from '@dorf/shared';
import { istProgramm } from '../programm/desktop';
import { api, ApiFehler } from '../api';
import { bibliothekUrl, linkKlick } from '../router';

const fehlertext = (e: unknown) => (e instanceof ApiFehler ? e.message : String(e));
const zeit = (iso: string) => new Date(iso).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' });

export function Einstellungen() {
  const qc = useQueryClient();
  const ich = useQuery({ queryKey: ['ich'], queryFn: () => api<Ich>('/api/ich') });

  useEffect(() => {
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  }, []);

  return (
    <section className="einstellungen">
      <h1>Einstellungen</h1>
      <p className="leise">
        Neu hier oder neu sortieren? <a href="/anleitung" onClick={linkKlick}>So nutzt du das Dorf</a>
      </p>
      <Anschluesse />
      <Konflikte />
      <Sitzungen />
      <Zweitfaktor aktiv={!!ich.data?.totpAktiv} />
      <PasswortAendern />
      <Programme />
      <div className="karte">
        <h2>Abmelden</h2>
        <button
          onClick={async () => {
            await api('/api/abmeldung', { body: {} });
            qc.clear();
            location.href = '/';
          }}
        >
          Auf diesem Gerät abmelden
        </button>
        <p className="leise">Version {ich.data?.version}</p>
      </div>
    </section>
  );
}

/** E109: Was ist verbunden, was fehlt – mit dem Befehl auf dem Server zum Kopieren */
function Anschluesse() {
  const q = useQuery({ queryKey: ['anschluesse'], queryFn: () => api<Anschluss[]>('/api/anschluesse') });
  const [kopiert, setKopiert] = useState('');
  const fehlen = q.data?.filter((a) => !a.ok) ?? [];
  return (
    <div className="karte" id="anschluesse">
      <h2>
        Anschlüsse {q.data && (fehlen.length ? <span className="abzeichen">{fehlen.length} offen</span> : <span className="abzeichen gut">alles verbunden</span>)}
      </h2>
      {q.isError && <p className="fehler">{q.error.message}</p>}
      <ul className="anschluesse">
        {q.data?.map((a) => (
          <li key={a.name} className={a.ok ? 'ok' : a.teilweise ? 'teilweise' : 'fehlt'}>
            <span className="anschluss-symbol" aria-hidden>
              {a.symbol}
            </span>
            <div className="anschluss-text">
              <strong>{a.name}</strong> <span className="anschluss-stand">{a.ok ? '✓ verbunden' : a.teilweise ? '◐ teilweise' : '✗ fehlt'}</span>
              <div className="leise">{a.wofuer}</div>
              {!a.ok && (
                <div className="anschluss-befehl">
                  {a.hinweis && <div>{a.hinweis}</div>}
                  Auf dem Server: <code>{a.befehl}</code>{' '}
                  <button
                    type="button"
                    className="klein"
                    onClick={() => void navigator.clipboard?.writeText(a.befehl).then(() => setKopiert(a.befehl))}
                    aria-label={`Befehl kopieren: ${a.befehl}`}
                  >
                    {kopiert === a.befehl ? '✓ kopiert' : 'kopieren'}
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Etappe 6: Programme für Mac und Windows – Download (die CI liefert sie mit dem Deploy) */
function Programme() {
  const p = useQuery({ queryKey: ['programme'], queryFn: () => api<ProgrammeInfo>('/api/programme') });
  return (
    <div className="karte" id="programme">
      <h2>Programme für Mac und Windows</h2>
      {istProgramm() && <p className="hinweis">Du benutzt gerade das Programm. Updates kommen von selbst.</p>}
      {p.data && !p.data.vorhanden && <p className="leise">Noch keine Programme gebaut – sie kommen mit dem nächsten Deploy.</p>}
      {p.data?.vorhanden && (
        <>
          <p className="leise">
            Version {p.data.version}
            {p.data.erstellt ? ` vom ${zeit(p.data.erstellt)}` : ''}. Das Programm öffnet dein Dorf in einem eigenen Fenster – mit Meldungen, Symbol in der Leiste,
            Schnelleingabe (Strg/⌘ + Umschalt + Leertaste) und Autostart. Updates installiert es selbst.
          </p>
          <div className="programme-knoepfe">
            {p.data.mac && (
              <a className="knopf haupt-link" href={p.data.mac.url} download>
                🍎 Mac (Apple Silicon)
              </a>
            )}
            {p.data.windows && (
              <a className="knopf haupt-link" href={p.data.windows.url} download>
                🪟 Windows
              </a>
            )}
          </div>
          <details>
            <summary>Erster Start (die Programme sind nicht signiert)</summary>
            <ul>
              <li>
                <strong>Mac:</strong> .dmg öffnen, „Agentendorf“ in „Programme“ ziehen. Beim ersten Start meldet macOS „nicht verifiziert“: Systemeinstellungen →
                Datenschutz &amp; Sicherheit → ganz unten „Dennoch öffnen“. Danach startet es normal.
              </li>
              <li>
                <strong>Windows:</strong> Installer starten. Zeigt Windows „Der Computer wurde durch Windows geschützt“: „Weitere Informationen“ → „Trotzdem ausführen“.
              </li>
              <li>Beim ersten Start fragt das Programm nach deiner Dorf-Adresse ({location.origin}) – danach meldest du dich wie im Browser an.</li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}

function Konflikte() {
  const k = useQuery({ queryKey: ['konflikte'], queryFn: () => api<Konflikt[]>('/api/vault/konflikte') });
  return (
    <div className="karte" id="konflikte">
      <h2>Konflikte zwischen Geräten</h2>
      {k.data?.length === 0 && <p className="leise">Keine Konflikte. 👍</p>}
      {k.data && k.data.length > 0 && (
        <>
          <p>
            Diese Dateien wurden auf zwei Geräten gleichzeitig geändert. Nichts wurde überschrieben: Öffne beide Fassungen, übernimm, was du
            brauchst, und lösche dann die Konfliktkopie.
          </p>
          <ul>
            {k.data.map((x) => (
              <li key={x.pfad}>
                <a href={bibliothekUrl(x.pfad)} onClick={linkKlick}>
                  {x.pfad}
                </a>{' '}
                ↔{' '}
                <a href={bibliothekUrl(x.original)} onClick={linkKlick}>
                  {x.original}
                </a>{' '}
                <span className="leise">
                  ({x.quelle === 'syncthing' ? 'Syncthing' : 'Dorf'}, {zeit(x.geaendert)})
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Sitzungen() {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ['sitzungen'], queryFn: () => api<SitzungInfo[]>('/api/sitzungen') });
  const [fehler, setFehler] = useState('');
  const neu = () => qc.invalidateQueries({ queryKey: ['sitzungen'] });
  return (
    <div className="karte">
      <h2>Angemeldete Geräte</h2>
      {fehler && <p className="fehler">{fehler}</p>}
      <table className="tabelle">
        <thead>
          <tr>
            <th>Gerät</th>
            <th>Zuletzt</th>
            <th>IP</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {s.data?.map((x) => (
            <tr key={x.id}>
              <td title={x.geraet}>
                {geraetKurz(x.geraet)} {x.aktuell && <span className="abzeichen">dieses Gerät</span>}
              </td>
              <td>{zeit(x.zuletzt)}</td>
              <td>{x.ip}</td>
              <td>
                {!x.aktuell && (
                  <button
                    onClick={() =>
                      api(`/api/sitzungen/${x.id}`, { methode: 'DELETE' })
                        .then(neu)
                        .catch((e) => setFehler(fehlertext(e)))
                    }
                  >
                    Abmelden
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        onClick={() =>
          api('/api/sitzungen/andere-beenden', { body: {} })
            .then(neu)
            .catch((e) => setFehler(fehlertext(e)))
        }
      >
        Alle anderen Geräte abmelden
      </button>
    </div>
  );
}

function geraetKurz(ua: string) {
  const sys = /iPhone|iPad|Android|Macintosh|Windows|Linux/.exec(ua)?.[0] ?? '';
  const br = /Edg|Firefox|Chrome|Safari|Tauri/.exec(ua)?.[0] ?? '';
  return [br === 'Edg' ? 'Edge' : br, sys === 'Macintosh' ? 'Mac' : sys].filter(Boolean).join(' auf ') || ua.slice(0, 40) || 'unbekannt';
}

function Zweitfaktor({ aktiv }: { aktiv: boolean }) {
  const qc = useQueryClient();
  const [passwort, setPasswort] = useState('');
  const [code, setCode] = useState('');
  const [einrichtung, setEinrichtung] = useState<{ geheimnis: string; qr: string } | null>(null);
  const [meldung, setMeldung] = useState('');

  const starten = async () => {
    try {
      const r = await api<{ geheimnis: string; uri: string }>('/api/totp/einrichten', { body: { passwort } });
      setEinrichtung({ geheimnis: r.geheimnis, qr: await QRCode.toDataURL(r.uri, { margin: 1, width: 220 }) });
      setPasswort('');
      setMeldung('');
    } catch (e) {
      setMeldung(fehlertext(e));
    }
  };
  const bestaetigen = async () => {
    try {
      await api('/api/totp/bestaetigen', { body: { code } });
      setEinrichtung(null);
      setCode('');
      setMeldung('Zweiter Faktor ist aktiv. Ab jetzt brauchst du beim Anmelden zusätzlich den Code.');
      await qc.invalidateQueries({ queryKey: ['ich'] });
    } catch (e) {
      setMeldung(fehlertext(e));
    }
  };
  const abschalten = async () => {
    try {
      await api('/api/totp/abschalten', { body: { passwort, code } });
      setPasswort('');
      setCode('');
      setMeldung('Zweiter Faktor abgeschaltet.');
      await qc.invalidateQueries({ queryKey: ['ich'] });
    } catch (e) {
      setMeldung(fehlertext(e));
    }
  };

  return (
    <div className="karte">
      <h2>Zweiter Faktor (TOTP) {aktiv ? <span className="abzeichen gut">aktiv</span> : <span className="abzeichen">aus</span>}</h2>
      {meldung && <p className="hinweis">{meldung}</p>}
      {!aktiv && !einrichtung && (
        <div className="formzeile">
          <input type="password" placeholder="Passwort zur Bestätigung" value={passwort} onChange={(e) => setPasswort(e.target.value)} />
          <button onClick={starten} disabled={!passwort}>
            Einrichten
          </button>
        </div>
      )}
      {einrichtung && (
        <div>
          <p>Scanne den Code mit einer Authenticator-App (z. B. Aegis, 2FAS, Google Authenticator) und gib den angezeigten Code ein.</p>
          <img src={einrichtung.qr} alt="QR-Code für die Authenticator-App" width={220} height={220} />
          <p className="leise">
            Oder von Hand: <code>{einrichtung.geheimnis}</code>
          </p>
          <div className="formzeile">
            <input inputMode="numeric" placeholder="6-stelliger Code" value={code} onChange={(e) => setCode(e.target.value)} />
            <button onClick={bestaetigen} disabled={code.length < 6}>
              Bestätigen
            </button>
          </div>
        </div>
      )}
      {aktiv && (
        <div className="formzeile">
          <input type="password" placeholder="Passwort" value={passwort} onChange={(e) => setPasswort(e.target.value)} />
          <input inputMode="numeric" placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} />
          <button onClick={abschalten} className="gefahr" disabled={!passwort || !code}>
            Abschalten
          </button>
        </div>
      )}
      <p className="leise">Handy verloren? Auf dem Server hilft <code>./dorf totp-aus</code>.</p>
    </div>
  );
}

function PasswortAendern() {
  const [alt, setAlt] = useState('');
  const [neu, setNeu] = useState('');
  const [neu2, setNeu2] = useState('');
  const [meldung, setMeldung] = useState('');
  return (
    <div className="karte">
      <h2>Passwort ändern</h2>
      <form
        className="formspalte"
        onSubmit={async (e) => {
          e.preventDefault();
          if (neu !== neu2) return setMeldung('Die neuen Passwörter stimmen nicht überein.');
          try {
            const r = await api<{ andereBeendet: number }>('/api/passwort', { body: { alt, neu } });
            setMeldung(`Passwort geändert. ${r.andereBeendet} andere Sitzung(en) beendet.`);
            setAlt('');
            setNeu('');
            setNeu2('');
          } catch (err) {
            setMeldung(fehlertext(err));
          }
        }}
      >
        <input type="password" autoComplete="current-password" placeholder="Aktuelles Passwort" value={alt} onChange={(e) => setAlt(e.target.value)} />
        <input type="password" autoComplete="new-password" placeholder="Neues Passwort (mind. 14 Zeichen)" value={neu} onChange={(e) => setNeu(e.target.value)} />
        <input type="password" autoComplete="new-password" placeholder="Neues Passwort wiederholen" value={neu2} onChange={(e) => setNeu2(e.target.value)} />
        <button type="submit" disabled={!alt || neu.length < 14}>
          Ändern
        </button>
      </form>
      {meldung && <p className="hinweis">{meldung}</p>}
    </div>
  );
}
