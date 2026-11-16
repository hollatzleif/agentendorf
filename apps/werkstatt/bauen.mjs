// Bündelt Runner und MCP-Server in je eine Datei (alle Abhängigkeiten eingebaut).
import { build } from 'esbuild';
await build({
  entryPoints: ['src/runner.ts', 'src/mcp.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
console.log('Werkstatt gebaut.');
