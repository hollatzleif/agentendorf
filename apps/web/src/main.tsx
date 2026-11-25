import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import './stil.css';
import './apple/tokens.css';
import './apple/basis.css';
import './apple/seiten-tag.css';
import './apple/seiten-wissen.css';
import './apple/finanzen.css';
import './apple/werkzeuge.css';
import { aktualisierungStarten } from './aktualisierung';
import { aussehenAusSpeicher } from './aussehen';

aktualisierungStarten();
aussehenAusSpeicher(); // E224: gemerktes Aussehen sofort, vor dem ersten Zeichnen

// Nach einem Deploy fehlen alte Seiten-Dateien: einmal neu laden (nicht in Schleife – Merker für 1 min)
window.addEventListener('vite:preloadError', (e) => {
  const zuletzt = Number(sessionStorage.getItem('dorf-neu-geladen') ?? 0);
  if (Date.now() - zuletzt < 60_000) return; // dann zeigt SeitenFehler „Neu laden“
  e.preventDefault();
  sessionStorage.setItem('dorf-neu-geladen', String(Date.now()));
  location.reload();
});

const qc = new QueryClient({
  defaultOptions: { queries: { retry: (n, e) => n < 2 && (e as { status?: number }).status !== 401, staleTime: 10_000 } },
});

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
