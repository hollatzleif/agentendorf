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
});
export type AuftragT = z.infer<typeof Auftrag>;

export const VAULT = '/vault';
export const ARBEIT = '/arbeit';

/**
 * Die Argumente für das unveränderte claude-CLI (Headless, Abo-Login über CLAUDE_CODE_OAUTH_TOKEN).
 * - kein --bare (liest kein Abo-Token)
 * - nur Lese-Werkzeuge eingebaut (Read, Glob, Grep), Web nur wenn erlaubt; KEIN Bash/Edit/Write
 * - einziger MCP-Server: "dorf" (Schreiben, Suchen, Freigaben – mit der Leine im Dorf)
 * - keine Projekt-Einstellungen, keine Slash-Commands, keine Rückfragen
 */
export function claudeArgumente(a: AuftragT, pfade: { systemDatei: string; mcpBefehl: string[]; internUrl: string }) {
  const eingebaut = ['Read', 'Glob', 'Grep', ...(a.web ? ['WebSearch', 'WebFetch'] : [])];
  const mcp = {
    mcpServers: {
      dorf: {
        type: 'stdio',
        command: pfade.mcpBefehl[0],
        args: pfade.mcpBefehl.slice(1),
        env: { DORF_INTERN_URL: pfade.internUrl, DORF_WERKZEUG_TOKEN: a.werkzeugToken },
      },
    },
  };
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
    '--max-turns', '60',
    ...(a.sitzung.art === 'neu' ? ['--session-id', a.sitzung.id] : ['--resume', a.sitzung.id]),
  ];
}

/** Umgebung für den claude-Prozess: Abo-Token ja, API-Schlüssel nie (der hätte Vorrang vor dem Abo). */
export function claudeUmgebung(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const erlaubt = ['PATH', 'HOME', 'LANG', 'TZ', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE'];
  const aus: NodeJS.ProcessEnv = { DISABLE_AUTOUPDATER: '1' };
  for (const k of erlaubt) if (env[k]) aus[k] = env[k];
  return aus;
}
