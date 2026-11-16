// Bündelt den Server in eine Datei (dist/start.js und dist/cli.js).
// Native Module (better-sqlite3, argon2) bleiben extern und werden im Docker-Image installiert.
import { build } from 'esbuild';
const gemeinsam = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
};
// Workspace-Paket @dorf/shared wird mitgebündelt, alles andere bleibt extern.
const plugins = [{
  name: 'shared-inline',
  setup(b) {
    b.onResolve({ filter: /^@dorf\/shared$/ }, () => ({ path: new URL('../../packages/shared/src/index.ts', import.meta.url).pathname }));
  },
}];
await build({ ...gemeinsam, plugins, entryPoints: ['src/start.ts', 'src/cli.ts'], outdir: 'dist' });
console.log('Server gebaut.');
