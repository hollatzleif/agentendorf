import { describe, expect, it } from 'vitest';
import { Auftrag, claudeArgumente, claudeUmgebung } from '../src/auftrag.js';

const basis = {
  laufId: '11111111-2222-3333-4444-555555555555',
  modell: 'claude-opus-5-5',
  aufwand: 'high',
  system: 'x',
  nachricht: 'y',
  sitzung: { art: 'neu', id: '11111111-2222-3333-4444-555555555555' },
  web: false,
  werkzeugToken: 'abcdefghijklmnopqrstuvwxyz',
};

describe('Werkstatt', () => {
  it('Umgebung für claude: Abo-Token ja, API-Schlüssel und Fremdes nie', () => {
    const env = claudeUmgebung({ PATH: '/bin', CLAUDE_CODE_OAUTH_TOKEN: 'abo', ANTHROPIC_API_KEY: 'sk', ANTHROPIC_AUTH_TOKEN: 't', WERKSTATT_GEHEIMNIS: 'g' });
    expect(env).toEqual({ PATH: '/bin', CLAUDE_CODE_OAUTH_TOKEN: 'abo', DISABLE_AUTOUPDATER: '1' });
  });

  it('Aufträge mit eingeschleusten Werten werden abgelehnt', () => {
    expect(() => Auftrag.parse({ ...basis, modell: 'claude-x --dangerously-skip-permissions' })).toThrow();
    expect(() => Auftrag.parse({ ...basis, sitzung: { art: 'neu', id: '../../etc' } })).toThrow();
    expect(() => Auftrag.parse({ ...basis, aufwand: 'ultracode' })).toThrow();
  });

  it('Argumente: keine Schreib-/Shell-Werkzeuge, kein bare, nur der MCP-Server dorf', () => {
    const a = claudeArgumente(Auftrag.parse(basis), { systemDatei: '/a/s.md', mcpBefehl: ['node', 'mcp.js'], internUrl: 'http://dorf:3001' });
    expect(a).not.toContain('--bare');
    expect(a).not.toContain('--dangerously-skip-permissions');
    expect(a[a.indexOf('--tools') + 1]).toBe('Read,Glob,Grep');
    expect(a[a.indexOf('--allowedTools') + 1]).toBe('Read,Glob,Grep,mcp__dorf__*');
    const mcp = JSON.parse(a[a.indexOf('--mcp-config') + 1]!);
    expect(Object.keys(mcp.mcpServers)).toEqual(['dorf']);
    expect(mcp.mcpServers.dorf.env).toEqual({ DORF_INTERN_URL: 'http://dorf:3001', DORF_WERKZEUG_TOKEN: basis.werkzeugToken });
    const f = claudeArgumente(Auftrag.parse({ ...basis, sitzung: { art: 'fortsetzen', id: basis.laufId } }), { systemDatei: '/a', mcpBefehl: ['n'], internUrl: 'u' });
    expect(f).toContain('--resume');
    expect(f).not.toContain('--session-id');
  });
});
