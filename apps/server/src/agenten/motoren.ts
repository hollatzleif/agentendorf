import type { Konfig } from '../konfig.js';
import type { Motor as MotorName } from '@dorf/shared';
import type { Motor } from './motor.js';
import { attrappe } from './motor-attrappe.js';
import { apiMotor, sdkKlient } from './motor-api.js';
import { claudeCodeMotor, codingMotor } from './motor-claude-code.js';
import type { WerkzeugRegister } from './register.js';

/** Wie Tests und dorfBauen Motoren übergeben: coding darf fehlen (dann erklärt der Motor, was zu tun ist). */
export type Motoren = Record<'api' | 'claude-code', Motor> & { coding?: Motor };

export const CODING_FEHLT = 'Codehaus nicht eingerichtet. Auf dem Server: dorf coding-einrichten';

/** Motor, der nur erklärt, was fehlt. */
export const motorFehlt = (name: MotorName, grund: string): Motor => ({
  name,
  // eslint-disable-next-line require-yield
  async *starten() {
    throw new Error(grund);
  },
});

/** Baut die Motoren. DORF_MOTOR_ATTRAPPE=1 ersetzt alle durch die Attrappe (Tests, lokale Entwicklung). */
export function motorenBauen(konfig: Konfig, register: WerkzeugRegister): Record<MotorName, Motor> {
  if (konfig.motorAttrappe) return { api: attrappe('api'), 'claude-code': attrappe('claude-code'), coding: attrappe('coding') };
  const fehlt = motorFehlt;
  return {
    api: konfig.anthropicApiKey
      ? apiMotor(() => sdkKlient(konfig.anthropicApiKey!))
      : fehlt('api', 'Kein API-Schlüssel: ANTHROPIC_API_KEY in /srv/dorf/.env eintragen und ./dorf deploy ausführen.'),
    'claude-code': konfig.werkstattGeheimnis
      ? claudeCodeMotor({ url: konfig.werkstattUrl, geheimnis: konfig.werkstattGeheimnis, register })
      : fehlt('claude-code', 'Werkstatt nicht eingerichtet: WERKSTATT_GEHEIMNIS fehlt in /srv/dorf/.env.'),
    // E191: eigener Container, eigenes Geheimnis – ohne `dorf coding-einrichten` gibt es den Motor nicht
    coding: konfig.codingGeheimnis ? codingMotor({ url: konfig.codingUrl, geheimnis: konfig.codingGeheimnis, register }) : fehlt('coding', CODING_FEHLT),
  };
}
