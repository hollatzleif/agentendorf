// E240: Apple-Oberfläche in Browser-Tests einschalten (nur dieses Gerät – localStorage „dorf-aussehen-geraet“, wie Einstellungen → Aussehen)
import type { Page } from '@playwright/test';

export async function appleAn(page: Page, o: { dunkel?: boolean } = {}) {
  await page.addInitScript((dunkel) => {
    localStorage.setItem('dorf-aussehen-geraet', JSON.stringify({ design: 'apple', ...(dunkel ? { vorlage: 'nacht' } : {}) }));
  }, !!o.dunkel);
}
