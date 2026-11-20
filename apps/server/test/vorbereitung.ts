import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Die Werkstatt-Tests brauchen den gebauten Runner und MCP-Server. */
export default function () {
  const werkstatt = path.resolve(import.meta.dirname, '../../werkstatt');
  // immer neu bauen: ein veralteter dist-Ordner würde sonst still alte MCP-/Runner-Fassungen testen
  execFileSync('node', ['bauen.mjs'], { cwd: werkstatt, stdio: 'inherit' });
  // E204: Test-Ordner (tempOrdner, „dorf-test-…“) nach dem Lauf wegräumen – nur die, die in DIESEM Lauf entstanden sind
  // (die Arbeitsprozesse von Vitest werden beendet, ohne dass ihr exit-Ereignis sicher feuert)
  const testOrdner = () => new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('dorf-test-')));
  const vorher = testOrdner();
  return () => {
    for (const n of testOrdner()) if (!vorher.has(n)) fs.rmSync(path.join(os.tmpdir(), n), { recursive: true, force: true });
  };
}
