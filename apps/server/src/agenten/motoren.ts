import type { Konfig } from '../konfig.js';
import type { Motor } from './motor.js';
import { attrappe } from './motor-attrappe.js';

/** Baut die beiden Motoren. DORF_MOTOR_ATTRAPPE=1 ersetzt beide durch die Attrappe (Tests, lokale Entwicklung). */
export function motorenBauen(konfig: Konfig): Record<'api' | 'claude-code', Motor> {
  if (konfig.motorAttrappe) return { api: attrappe('api'), 'claude-code': attrappe('claude-code') };
  const fehlt = (name: 'api' | 'claude-code', grund: string): Motor => ({
    name,
    // eslint-disable-next-line require-yield
    async *starten() {
      throw new Error(grund);
    },
  });
  return {
    api: fehlt('api', 'api-Motor noch nicht eingebaut.'),
    'claude-code': fehlt('claude-code', 'claude-code-Motor noch nicht eingebaut.'),
  };
}
