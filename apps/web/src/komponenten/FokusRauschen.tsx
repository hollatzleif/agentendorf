import { useEffect, useRef, useState } from 'react';
import { E } from '../apple/tag';

/**
 * E155: Rauschen im Fokus – braunes (oder rosa) Rauschen, im Browser erzeugt (Web Audio, keine Datei, kein Netz).
 * Startet nur auf Klick (Browser erlauben Ton erst nach einer Geste), endet beim Verlassen der Seite.
 * Keine Glocke, kein Alarm – das Klingeln bleibt Sache des Kirchturms.
 */
type Art = 'braun' | 'rosa';

function puffer(ctx: AudioContext, art: Art) {
  const laenge = ctx.sampleRate * 4;
  // etwas länger erzeugen und das Ende in den Anfang überblenden – sonst knackt es am Schleifenpunkt (Review)
  const ueber = Math.floor(ctx.sampleRate * 0.25);
  const d = new Float32Array(laenge + ueber);
  let letzt = 0;
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < laenge + ueber; i++) {
    const w = Math.random() * 2 - 1;
    if (art === 'braun') {
      letzt = (letzt + 0.02 * w) / 1.02;
      d[i] = letzt * 3.5;
    } else {
      // Paul Kellets Näherung für rosa Rauschen
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
  const b = ctx.createBuffer(1, laenge, ctx.sampleRate);
  const aus = b.getChannelData(0);
  aus.set(d.subarray(0, laenge));
  // Anfang = Mischung aus Fortsetzung des Endes (d[laenge+i]) und eigentlichem Anfang → nahtlos an aus[laenge-1]
  for (let i = 0; i < ueber; i++) {
    const f = i / ueber;
    // gleichbleibende Leistung (unabhängige Rauschstücke) – linear gäbe ein Loch von ~3 dB in der Mitte (Review)
    aus[i] = d[laenge + i]! * Math.sqrt(1 - f) + d[i]! * Math.sqrt(f);
  }
  return b;
}

export function FokusRauschen() {
  const [an, setAn] = useState(false);
  const [art, setArt] = useState<Art>(() => (localStorage.getItem('dorf-rauschen') === 'rosa' ? 'rosa' : 'braun'));
  const [lautstaerke, setLautstaerke] = useState(() => Number(localStorage.getItem('dorf-rauschen-laut') ?? '0.4') || 0.4);
  const ctx = useRef<AudioContext | null>(null);
  const gain = useRef<GainNode | null>(null);
  const quelle = useRef<AudioBufferSourceNode | null>(null);

  const stopp = () => {
    quelle.current?.stop();
    quelle.current = null;
    void ctx.current?.close();
    ctx.current = null;
  };
  const start = (a: Art) => {
    stopp();
    const c = new AudioContext();
    const g = c.createGain();
    g.gain.value = lautstaerke;
    g.connect(c.destination);
    const s = c.createBufferSource();
    s.buffer = puffer(c, a);
    s.loop = true;
    s.connect(g);
    s.start();
    ctx.current = c;
    gain.current = g;
    quelle.current = s;
  };
  useEffect(() => () => stopp(), []);
  useEffect(() => {
    if (gain.current) gain.current.gain.value = lautstaerke;
    localStorage.setItem('dorf-rauschen-laut', String(lautstaerke));
  }, [lautstaerke]);

  return (
    <div className="fokus-rauschen" role="group" aria-label="Rauschen">
      <button
        type="button"
        className={`klein${an ? ' an' : ''}`}
        aria-pressed={an}
        onClick={() => {
          if (an) stopp();
          else start(art);
          setAn(!an);
        }}
      >
        <E e={an ? '🔇' : '🔊'} /> {an ? 'Rauschen aus' : 'Rauschen'}
      </button>
      {an && (
        <>
          <select
            value={art}
            aria-label="Art des Rauschens"
            onChange={(e) => {
              const a = e.target.value as Art;
              setArt(a);
              localStorage.setItem('dorf-rauschen', a);
              start(a);
            }}
          >
            <option value="braun">braun (tief, wie Regen)</option>
            <option value="rosa">rosa (heller, wie Wind)</option>
          </select>
          <input type="range" min={0.05} max={1} step={0.05} value={lautstaerke} onChange={(e) => setLautstaerke(Number(e.target.value))} aria-label="Lautstärke" />
        </>
      )}
    </div>
  );
}
