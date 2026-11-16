import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const SEITEN_PRO_SCHRITT = 20;

/** Zeigt PDFs auf allen Geräten gleich (auch auf Handys, die PDFs nicht eingebettet anzeigen). */
export function PdfAnsicht({ url }: { url: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [fehler, setFehler] = useState('');
  const [bis, setBis] = useState(SEITEN_PRO_SCHRITT);

  useEffect(() => {
    let weg = false;
    setDoc(null);
    setBis(SEITEN_PRO_SCHRITT);
    const aufgabe = pdfjs.getDocument({ url, withCredentials: true });
    aufgabe.promise.then((d) => !weg && setDoc(d)).catch((e: Error) => !weg && setFehler(e.message));
    return () => {
      weg = true;
      void aufgabe.destroy();
    };
  }, [url]);

  useEffect(() => {
    if (!doc || !box.current) return;
    let weg = false;
    const ziel = box.current;
    ziel.innerHTML = '';
    (async () => {
      const breite = Math.min(ziel.clientWidth || 800, 1000);
      for (let i = 1; i <= Math.min(doc.numPages, bis) && !weg; i++) {
        const seite = await doc.getPage(i);
        const basis = seite.getViewport({ scale: 1 });
        const skala = (breite / basis.width) * (window.devicePixelRatio || 1);
        const vp = seite.getViewport({ scale: skala });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        canvas.style.width = `${breite}px`;
        canvas.className = 'pdf-seite';
        ziel.appendChild(canvas);
        await seite.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
      }
    })().catch((e: Error) => setFehler(e.message));
    return () => {
      weg = true;
    };
  }, [doc, bis]);

  if (fehler) return <p className="fehler">PDF konnte nicht angezeigt werden: {fehler}</p>;
  return (
    <div>
      {!doc && <p className="leise">Lade PDF …</p>}
      {doc && <p className="leise">{doc.numPages} Seite{doc.numPages === 1 ? '' : 'n'}</p>}
      <div ref={box} className="pdf" />
      {doc && doc.numPages > bis && <button onClick={() => setBis((b) => b + SEITEN_PRO_SCHRITT)}>Weitere Seiten laden</button>}
    </div>
  );
}
