import { z } from 'zod';

/** Auftrag vom Dorf an die Werkstatt. Die Werkstatt baut die claude-Argumente selbst – das Dorf kann keine Flags einschleusen. */
export const Auftrag = z.object({
  laufId: z.string().regex(/^[0-9a-f-]{36}$/),
  modell: z.string().regex(/^claude-[a-z0-9-]+$/),
  aufwand: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
  system: z.string().max(500_000),
  nachricht: z.string().max(2_000_000),
  /** Neue Sitzung (UUID) oder bestehende fortsetzen */
  sitzung: z.object({ art: z.enum(['neu', 'fortsetzen']), id: z.string().regex(/^[0-9a-f-]{36}$/) }),
  web: z.boolean(),
  /** Token, mit dem der MCP-Server die Werkzeuge dieses Laufs beim Dorf aufruft */
  werkzeugToken: z.string().regex(/^[A-Za-z0-9_-]{20,}$/),
  /** Nur Profil „coding“ (E191): Projektordner unter /arbeit – ein einzelner Ordnername, kein Pfad */
  projekt: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
    .optional(),
});
export type AuftragT = z.infer<typeof Auftrag>;

export const VAULT = '/vault';
export const ARBEIT = '/arbeit';

/**
 * Profil des Runners – legt der CONTAINER fest (RUNNER_PROFIL), nie der Auftrag aus dem Dorf:
 * - werkstatt: nur lesen (Read/Glob/Grep), Vault nur lesbar, Schreiben ausschließlich über die Dorf-Werkzeuge
 * - coding (E191, Codehaus): alle eingebauten Werkzeuge inkl. Bash/Edit/Write, ohne Rückfragen, Vault beschreibbar
 */
export type Profil = 'werkstatt' | 'coding';
export function profilLesen(wert: string | undefined): Profil {
  if (wert === undefined || wert === '' || wert === 'werkstatt') return 'werkstatt';
  if (wert === 'coding') return 'coding';
  throw new Error(`Unbekanntes RUNNER_PROFIL „${wert}“ (erlaubt: werkstatt, coding).`);
}

/**
 * Die Argumente für das unveränderte claude-CLI (Headless, Abo-Login über CLAUDE_CODE_OAUTH_TOKEN).
 * - kein --bare (liest kein Abo-Token)
 * - nur Lese-Werkzeuge eingebaut (Read, Glob, Grep), Web nur wenn erlaubt; KEIN Bash/Edit/Write
 * - einziger MCP-Server: "dorf" (Schreiben, Suchen, Freigaben – mit der Leine im Dorf)
 * - keine Projekt-Einstellungen, keine Slash-Commands, keine Rückfragen
 */
export function claudeArgumente(a: AuftragT, pfade: { systemDatei: string; mcpBefehl: string[]; internUrl: string }, profil: Profil = 'werkstatt') {
  if (profil === 'coding') return codingArgumente(a, pfade);
  const eingebaut = ['Read', 'Glob', 'Grep', ...(a.web ? ['WebSearch', 'WebFetch'] : [])];
  const mcp = mcpDorf(a, pfade);
  return [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model', a.modell,
    '--effort', a.aufwand,
    '--tools', eingebaut.join(','),
    '--allowedTools', [...eingebaut, 'mcp__dorf__*'].join(','),
    '--strict-mcp-config',
    '--mcp-config', JSON.stringify(mcp),
    '--permission-mode', 'dontAsk',
    '--permission-prompts', 'none',
    '--setting-sources', 'user',
    '--disable-slash-commands',
    '--add-dir', VAULT,
    '--append-system-prompt-file', pfade.systemDatei,
    // Lernzettel über ein ganzes Semester und Abgaben mit LaTeX-Schleifen brauchen viele Schritte
    '--max-turns', '200',
    ...(a.sitzung.art === 'neu' ? ['--session-id', a.sitzung.id] : ['--resume', a.sitzung.id]),
  ];
}

const mcpDorf = (a: AuftragT, pfade: { mcpBefehl: string[]; internUrl: string }) => ({
  mcpServers: {
    dorf: {
      type: 'stdio',
      command: pfade.mcpBefehl[0],
      args: pfade.mcpBefehl.slice(1),
      env: { DORF_INTERN_URL: pfade.internUrl, DORF_WERKZEUG_TOKEN: a.werkzeugToken },
    },
  },
});

/**
 * Profil „coding“ (Codehaus, E191 – Leifs Entscheidung): der Agent programmiert selbstständig.
 * - alle eingebauten Werkzeuge (--tools default: Bash, Edit, Write, Read, Glob, Grep, Web …)
 * - ohne Rückfragen (bypassPermissions) – der Schutz ist der Container (eigene Geheimnisse, eigenes Netz), nicht das CLI
 * - Einstellungen aus user UND project: die CLAUDE.md eines geklonten Repos soll gelten
 * - weiterhin kein --bare, nur der MCP-Server „dorf“, Vault als zusätzlicher Ordner
 */
function codingArgumente(a: AuftragT, pfade: { systemDatei: string; mcpBefehl: string[]; internUrl: string }) {
  return [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model', a.modell,
    '--effort', a.aufwand,
    '--tools', 'default',
    '--strict-mcp-config',
    '--mcp-config', JSON.stringify(mcpDorf(a, pfade)),
    '--permission-mode', 'bypassPermissions',
    '--setting-sources', 'user,project',
    '--add-dir', VAULT,
    '--append-system-prompt-file', pfade.systemDatei,
    '--max-turns', '400',
    ...(a.sitzung.art === 'neu' ? ['--session-id', a.sitzung.id] : ['--resume', a.sitzung.id]),
  ];
}

/** Arbeitsordner eines Coding-Laufs: /arbeit/<projekt> (wird angelegt), ohne Projekt /arbeit selbst. */
export function codingOrdner(arbeit: string, projekt: string | undefined) {
  return projekt ? `${arbeit.replace(/\/+$/, '')}/${projekt}` : arbeit;
}

/**
 * Umgebung für claude im Profil „coding“: alles, was der Container hat (GitHub-Token, Git-Name, PATH …) – der Agent
 * soll bauen, testen und pushen können. Nicht weitergereicht werden das Runner-Geheimnis, das VS-Code-Token und ein
 * API-Schlüssel (hätte Vorrang vor dem Abo). Im Container liegt ohnehin nichts aus /srv/dorf/.env.
 */
export function codingUmgebung(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const nie = new Set(['CODING_GEHEIMNIS', 'WERKSTATT_GEHEIMNIS', 'VSCODE_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'RUNNER_PROFIL', 'PORT']);
  const aus: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !nie.has(k)) aus[k] = v;
  aus.DISABLE_AUTOUPDATER = '1';
  return aus;
}

/** Umgebung für den claude-Prozess: Abo-Token ja, API-Schlüssel nie (der hätte Vorrang vor dem Abo). */
export function claudeUmgebung(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const erlaubt = ['PATH', 'HOME', 'LANG', 'TZ', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE'];
  const aus: NodeJS.ProcessEnv = { DISABLE_AUTOUPDATER: '1' };
  for (const k of erlaubt) if (env[k]) aus[k] = env[k];
  return aus;
}
