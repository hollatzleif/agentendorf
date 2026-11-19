import { describe, expect, it } from 'vitest';
import { Auftrag, claudeArgumente, claudeUmgebung, codingOrdner, codingUmgebung, profilLesen } from '../src/auftrag.js';

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

  // ---- E191: Profil „coding“ (Codehaus) -----------------------------------------------------------
  const pfade = { systemDatei: '/tmp/s.md', mcpBefehl: ['node', 'mcp.js'], internUrl: 'http://dorf:3001' };

  it('Profil werkstatt bleibt streng – auch wenn ein Auftrag ein Projekt nennt; das Profil kommt nur aus RUNNER_PROFIL', () => {
    const a = claudeArgumente(Auftrag.parse({ ...basis, projekt: 'mein-repo' }), pfade);
    expect(a[a.indexOf('--tools') + 1]).toBe('Read,Glob,Grep');
    expect(a[a.indexOf('--permission-mode') + 1]).toBe('dontAsk');
    expect(a.join(' ')).not.toMatch(/Bash|Edit|Write|bypassPermissions|default/);
    expect(claudeArgumente(Auftrag.parse(basis), pfade, 'werkstatt')).toEqual(claudeArgumente(Auftrag.parse(basis), pfade));
    expect(profilLesen(undefined)).toBe('werkstatt');
    expect(profilLesen('')).toBe('werkstatt');
    expect(profilLesen('coding')).toBe('coding');
    expect(() => profilLesen('Coding ')).toThrow(/RUNNER_PROFIL/);
    expect(() => profilLesen('alles')).toThrow(/RUNNER_PROFIL/);
  });

  it('Profil coding: alle eingebauten Werkzeuge (Bash/Edit/Write), ohne Rückfragen, Vault dabei, nur der MCP-Server dorf', () => {
    const a = claudeArgumente(Auftrag.parse({ ...basis, projekt: 'mein-repo' }), pfade, 'coding');
    const wert = (f: string) => a[a.indexOf(f) + 1];
    // „default“ = Standardsatz des CLI, darin Bash, Edit, Write (claude --help: --tools "default")
    expect(wert('--tools')).toBe('default');
    expect(wert('--permission-mode')).toBe('bypassPermissions');
    expect(wert('--add-dir')).toBe('/vault');
    expect(wert('--setting-sources')).toBe('user,project');
    expect(a).toContain('--strict-mcp-config');
    expect(Object.keys(JSON.parse(wert('--mcp-config')!).mcpServers)).toEqual(['dorf']);
    expect(a).not.toContain('--bare');
    expect(a).not.toContain('--allowedTools');
    expect(a).toContain('--session-id');
    expect(wert('--append-system-prompt-file')).toBe('/tmp/s.md');
    // das Projekt steht nie in den Argumenten – es ist nur der Arbeitsordner
    expect(a).not.toContain('mein-repo');
  });

  it('Arbeitsordner: /arbeit/<projekt>, ohne Projekt /arbeit; Pfade und Tricks im Projektnamen werden abgelehnt', () => {
    expect(codingOrdner('/arbeit', 'mein-repo')).toBe('/arbeit/mein-repo');
    expect(codingOrdner('/arbeit/', 'a.b_c-1')).toBe('/arbeit/a.b_c-1');
    expect(codingOrdner('/arbeit', undefined)).toBe('/arbeit');
    for (const boese of ['../vault', 'a/b', '.heim', '', ' x', 'a b', '-rf', 'x'.repeat(65), '/etc'])
      expect(() => Auftrag.parse({ ...basis, projekt: boese }), boese).toThrow();
    expect(Auftrag.parse({ ...basis, projekt: 'Agentendorf.v2' }).projekt).toBe('Agentendorf.v2');
  });

  it('Umgebung coding: GitHub-Token und Git-Angaben ja – Runner-Geheimnis, VS-Code-Token und API-Schlüssel nie', () => {
    const env = codingUmgebung({
      PATH: '/bin',
      HOME: '/arbeit/.heim',
      CLAUDE_CODE_OAUTH_TOKEN: 'abo',
      GH_TOKEN: 'ghp',
      GIT_AUTHOR_NAME: 'Leif',
      CODING_GEHEIMNIS: 'g',
      WERKSTATT_GEHEIMNIS: 'w',
      VSCODE_TOKEN: 'v',
      ANTHROPIC_API_KEY: 'sk',
      ANTHROPIC_AUTH_TOKEN: 't',
      RUNNER_PROFIL: 'coding',
    });
    expect(env).toEqual({ PATH: '/bin', HOME: '/arbeit/.heim', CLAUDE_CODE_OAUTH_TOKEN: 'abo', GH_TOKEN: 'ghp', GIT_AUTHOR_NAME: 'Leif', DISABLE_AUTOUPDATER: '1' });
  });

  it('Codehaus und Werkstatt nutzen dieselbe festgelegte claude-CLI-Version', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const version = (datei: string) => /^ARG CLAUDE_CODE_VERSION=(\d+\.\d+\.\d+)$/m.exec(fs.readFileSync(path.resolve(import.meta.dirname, datei), 'utf8'))?.[1];
    expect(version('../Dockerfile')).toBeTruthy();
    expect(version('../../coding/Dockerfile')).toBe(version('../Dockerfile'));
  });
});
