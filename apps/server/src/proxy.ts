import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * E195: Welchem Absender glaubt das Dorf die Kopfzeile X-Forwarded-For?
 *
 * Früher jedem (`trustProxy: true`). Das Dorf ist aber nicht nur für Caddy erreichbar: Werkstatt, Rechenraum, Browser und
 * – seit E191 – der Coding-Container (Shell!) hängen in Netzen, aus denen `dorf:3000` direkt erreichbar ist. Von dort
 * ließ sich mit jeder Anfrage eine andere „Herkunft“ behaupten und so die Login-Drossel je IP umgehen (oder Leifs
 * Adresse aussperren). Jetzt gilt X-Forwarded-For nur noch, wenn die Verbindung wirklich von einem benannten Proxy kommt
 * (VERTRAUTER_PROXY, im Server „caddy“). Alle anderen zählen mit ihrer echten Adresse im Docker-Netz – die lässt sich
 * dort nicht fälschen (kein CAP_NET_RAW, cap_drop: ALL).
 *
 * Namen werden über den DNS des Docker-Netzes aufgelöst und regelmäßig erneuert (Caddy bekommt nach einem Neustart
 * unter Umständen eine andere Adresse); kommt eine Anfrage von unbekannter Adresse, wird sofort nachgesehen.
 */
export interface ProxyVertrauen {
  /** Für Fastify (`trustProxy`): stimmt die Adresse der Verbindung mit einem vertrauten Proxy überein? */
  pruefen(adresse: string): boolean;
  /** einmal auflösen (beim Start abwarten, in Tests direkt) */
  erneuern(): Promise<void>;
  stoppen(): void;
}

const schlicht = (a: string) => a.replace(/^::ffff:/i, '').toLowerCase();

export function proxyVertrauen(
  eintraege: string[],
  opt: { aufloesen?: (name: string) => Promise<string[]>; intervallMs?: number; log?: (t: string) => void; jetzt?: () => number } = {},
): ProxyVertrauen {
  const aufloesen = opt.aufloesen ?? (async (n: string) => (await dns.lookup(n, { all: true })).map((x) => x.address));
  const jetzt = opt.jetzt ?? Date.now;
  const fest = new Set(eintraege.filter((e) => net.isIP(e)).map(schlicht));
  const namen = eintraege.filter((e) => !net.isIP(e));
  let aufgeloest = new Set<string>();
  let zuletzt = -Infinity;
  let laeuft: Promise<void> | null = null;

  const erneuern = () =>
    (laeuft ??= (async () => {
      const neu = new Set<string>();
      for (const n of namen) {
        try {
          for (const a of await aufloesen(n)) neu.add(schlicht(a));
        } catch (e) {
          // Name (noch) nicht bekannt: lieber niemandem trauen als allen – die bisherigen Adressen dieses Namens verfallen
          opt.log?.(`Proxy „${n}“ lässt sich nicht auflösen (${(e as Error).message}) – X-Forwarded-For gilt von dort vorerst nicht.`);
        }
      }
      aufgeloest = neu;
      zuletzt = jetzt();
    })().finally(() => {
      laeuft = null;
    }));

  const zeitgeber = namen.length ? setInterval(() => void erneuern(), opt.intervallMs ?? 30_000) : null;
  zeitgeber?.unref();

  return {
    pruefen(adresse) {
      const a = schlicht(adresse);
      if (fest.has(a) || aufgeloest.has(a)) return true;
      // unbekannt: vielleicht hat der Proxy eine neue Adresse – nachsehen (höchstens einmal je Sekunde), diese Anfrage zählt noch nicht
      if (namen.length && jetzt() - zuletzt > 1000) void erneuern();
      return false;
    },
    erneuern,
    stoppen() {
      if (zeitgeber) clearInterval(zeitgeber);
    },
  };
}
