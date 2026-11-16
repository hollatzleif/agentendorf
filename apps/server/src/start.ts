import { konfigLaden } from './konfig.js';
import { dorfStarten } from './dorf.js';

const konfig = konfigLaden();
const { app, angelegt } = await dorfStarten(konfig);
if (angelegt) app.log.info(`Vault aus Vorlage angelegt (${angelegt} Dateien).`);
await app.listen({ port: konfig.port, host: konfig.host });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    app.log.info(`${sig} empfangen, fahre herunter …`);
    void app.close().then(() => process.exit(0));
  });
}
