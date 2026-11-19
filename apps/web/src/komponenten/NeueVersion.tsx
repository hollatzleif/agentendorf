import { useEffect, useState } from 'react';
import { aufNeueVersion, neueVersionDa, neuLaden } from '../aktualisierung';

/** E179: Hinweis „Neue Version“ – Neuladen per Knopf; sonst passiert es beim nächsten Wechsel in den Hintergrund */
export function NeueVersion() {
  const [da, setDa] = useState(neueVersionDa);
  useEffect(() => aufNeueVersion(() => setDa(true)), []);
  if (!da) return null;
  return (
    <div className="neue-version" role="status">
      🔄 Neue Version des Dorfs ist da.
      <button type="button" className="klein haupt" onClick={neuLaden}>
        Jetzt neu laden
      </button>
    </div>
  );
}
