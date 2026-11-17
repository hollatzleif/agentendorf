import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Die Werkstatt-Tests brauchen den gebauten Runner und MCP-Server. */
export default function () {
  const werkstatt = path.resolve(import.meta.dirname, '../../werkstatt');
  // immer neu bauen: ein veralteter dist-Ordner würde sonst still alte MCP-/Runner-Fassungen testen
  execFileSync('node', ['bauen.mjs'], { cwd: werkstatt, stdio: 'inherit' });
}
