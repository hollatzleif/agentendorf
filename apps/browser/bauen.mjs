// Bündelt den Runner in eine Datei; playwright-core bleibt extern (wird im Image installiert).
import { build } from 'esbuild';
await build({
  entryPoints: ['src/runner.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: ['playwright-core'],
});
console.log('Browser gebaut.');
