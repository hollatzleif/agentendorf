// E240: welche Oberfläche gilt gerade? („dorf“ = gewohnt, „apple“ = Apple-Oberfläche)
// Quelle ist das Attribut data-design an <html> (gesetzt von aussehen.ts) – so reagieren alle Teile sofort auf die Umschaltung.
import { useSyncExternalStore } from 'react';

export type DesignArt = 'dorf' | 'apple';

function lesen(): DesignArt {
  return typeof document !== 'undefined' && document.documentElement.dataset.design === 'apple' ? 'apple' : 'dorf';
}

function abonnieren(melden: () => void) {
  const b = new MutationObserver(melden);
  b.observe(document.documentElement, { attributes: true, attributeFilter: ['data-design', 'data-dunkel'] });
  return () => b.disconnect();
}

/** aktuelle Oberfläche – Komponenten zeigen damit Apple-Varianten nur dort, wo CSS allein nicht reicht */
export function useDesign(): DesignArt {
  return useSyncExternalStore(abonnieren, lesen, () => 'dorf');
}

export function istApple(): boolean {
  return lesen() === 'apple';
}
