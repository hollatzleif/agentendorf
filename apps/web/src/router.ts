import { useSyncExternalStore } from 'react';

/** Minimaler Router über die History-API. */
const zuhoerer = new Set<() => void>();
window.addEventListener('popstate', () => zuhoerer.forEach((f) => f()));

export function navigieren(url: string, ersetzen = false) {
  if (url === location.pathname + location.search) return;
  if (ersetzen) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  zuhoerer.forEach((f) => f());
  window.scrollTo(0, 0);
}

export function useOrt() {
  const href = useSyncExternalStore(
    (f) => {
      zuhoerer.add(f);
      return () => zuhoerer.delete(f);
    },
    () => location.pathname + location.search,
  );
  const url = new URL(href, location.origin);
  return { pfad: url.pathname, suche: url.searchParams };
}

export const bibliothekUrl = (pfad: string, q?: string) =>
  `/bibliothek?pfad=${encodeURIComponent(pfad)}${q ? `&q=${encodeURIComponent(q)}` : ''}`;

/** Für <a>-Elemente: Klick ohne Neuladen. */
export function linkKlick(e: React.MouseEvent<HTMLAnchorElement>) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  const href = e.currentTarget.getAttribute('href');
  if (!href || !href.startsWith('/')) return;
  e.preventDefault();
  navigieren(href);
}
