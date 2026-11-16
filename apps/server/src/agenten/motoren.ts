import type { Konfig } from '../konfig.js';
import type { Motor } from './motor.js';
import { attrappe } from './motor-attrappe.js';
import { apiMotor, sdkKlient } from './motor-api.js';
import { claudeCodeMotor } from './motor-claude-code.js';
import type { WerkzeugRegister } from './register.js';

/** Baut die beiden Motoren. DORF_MOTOR_ATTRAPPE=1 ersetzt beide durch die Attrappe (Tests, lokale Entwicklung). */
export function motorenBauen(konfig: Konfig, register: WerkzeugRegister): Record<'api' | 'claude-code', Motor> {
  if (konfig.motorAttrappe) return { api: attrappe('api'), 'claude-code': attrappe('claude-code') };
  const fehlt = (name: 'api' | 'claude-code', grund: string): Motor => ({
    name,
    // eslint-disable-next-line require-yield
    async *starten() {
      throw new Error(grund);
    },
  });
  return {
    api: konfig.anthropicApiKey
      ? apiMotor(() => sdkKlient(konfig.anthropicApiKey!))
      : fehlt('api', 'Kein API-Schlüssel: ANTHROPIC_API_KEY in /srv/dorf/.env eintragen und ./dorf deploy ausführen.'),
    'claude-code': konfig.werkstattGeheimnis
      ? claudeCodeMotor({ url: konfig.werkstattUrl, geheimnis: konfig.werkstattGeheimnis, register })
      : fehlt('claude-code', 'Werkstatt nicht eingerichtet: WERKSTATT_GEHEIMNIS fehlt in /srv/dorf/.env.'),
  };
}
