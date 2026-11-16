import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Die Werkstatt-Tests brauchen den gebauten Runner und MCP-Server. */
export default function () {
  const werkstatt = path.resolve(import.meta.dirname, '../../werkstatt');
  if (!fs.existsSync(path.join(werkstatt, 'dist/runner.js'))) execFileSync('node', ['bauen.mjs'], { cwd: werkstatt, stdio: 'inherit' });
}
