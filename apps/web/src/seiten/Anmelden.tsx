import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiFehler } from '../api';

export function Anmelden() {
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ['anmeldung-info'], queryFn: () => api<{ passwortGesetzt: boolean; totpAktiv: boolean }>('/api/anmeldung/info') });
  const [passwort, setPasswort] = useState('');
  const [code, setCode] = useState('');
  const [fehler, setFehler] = useState('');
  const [laeuft, setLaeuft] = useState(false);

  const absenden = async (e: React.FormEvent) => {
    e.preventDefault();
    setLaeuft(true);
    setFehler('');
    try {
      await api('/api/anmeldung', { body: { passwort, code: code || undefined } });
      await qc.invalidateQueries({ queryKey: ['ich'] });
    } catch (err) {
      setFehler(err instanceof ApiFehler ? err.message : 'Server nicht erreichbar.');
      setCode('');
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <div className="anmelden">
      <form className="karte" onSubmit={absenden}>
        <h1>
          <img src="/favicon.svg" alt="" width={36} height={36} /> Agentendorf
        </h1>
        {info.data && !info.data.passwortGesetzt && (
          <p className="hinweis">
            Noch kein Passwort gesetzt. Auf dem Server: <code>./dorf passwort</code>
          </p>
        )}
        <label>
          Passwort
          <input type="password" autoComplete="current-password" value={passwort} onChange={(e) => setPasswort(e.target.value)} autoFocus required />
        </label>
        {info.data?.totpAktiv && (
          <label>
            Code aus der Authenticator-App
            <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" value={code} onChange={(e) => setCode(e.target.value)} required />
          </label>
        )}
        {fehler && <p className="fehler">{fehler}</p>}
        <button type="submit" disabled={laeuft}>
          {laeuft ? 'Prüfe …' : 'Ins Dorf'}
        </button>
      </form>
    </div>
  );
}
