import { Component, type ReactNode } from 'react';
import { useDesign } from '../apple/design';
import { Symbol } from '../apple/Ikon';

/**
 * Fängt Fehler einer Seite ab (E118): nach einem Deploy fehlen alte nachgeladene Seiten-Dateien – statt einer weißen
 * Seite erscheint „Neu laden“. `schluessel` (der Pfad) setzt den Fehler beim Wechsel der Seite zurück.
 */
/** E240: in der Apple-Oberfläche ein Warnsymbol über dem Text */
function FehlerSymbol() {
  if (useDesign() !== 'apple') return null;
  return (
    <span className="a-seiten-fehler-symbol" aria-hidden="true">
      <Symbol name="warnung" />
    </span>
  );
}

export class SeitenFehler extends Component<{ schluessel: string; children: ReactNode }, { fehler: Error | null; schluessel: string }> {
  state = { fehler: null as Error | null, schluessel: this.props.schluessel };
  static getDerivedStateFromError(fehler: Error) {
    return { fehler };
  }
  static getDerivedStateFromProps(p: { schluessel: string }, s: { schluessel: string }) {
    return p.schluessel !== s.schluessel ? { fehler: null, schluessel: p.schluessel } : null;
  }
  render() {
    if (!this.state.fehler) return this.props.children;
    return (
      <div className="karte seiten-fehler" role="alert">
        <FehlerSymbol />
        <h2>Diese Seite ließ sich nicht laden</h2>
        <p className="leise">Vermutlich gibt es eine neue Version des Dorfs. Neu laden hilft fast immer.</p>
        <p className="leise">
          <code>{this.state.fehler.message.slice(0, 200)}</code>
        </p>
        <button type="button" className="haupt" onClick={() => location.reload()}>
          Neu laden
        </button>
      </div>
    );
  }
}
