// Einrichtungsseite (lokal im Programm): Dorf-Adresse eintragen bzw. „nicht erreichbar“ mit erneutem Versuch.
// Darf nur adresse_lesen, adresse_speichern und neu_verbinden aufrufen (capabilities/einrichten.json).
const aufruf = (befehl, args) => window.__TAURI_INTERNALS__.invoke(befehl, args);
const $ = (id) => document.getElementById(id);

function fehler(t) {
  $('fehler').textContent = t ? String(t) : '';
}

async function start() {
  const stand = await aufruf('adresse_lesen');
  if (stand.adresse) $('adresse').value = stand.adresse.replace(/\/$/, '');
  $('offline').hidden = !stand.offline;
  $('formular').hidden = !!stand.offline;
  if (!stand.offline) $('adresse').focus();
}

$('formular').addEventListener('submit', async (e) => {
  e.preventDefault();
  fehler('');
  $('speichern').disabled = true;
  $('speichern').textContent = 'Verbinde …';
  try {
    await aufruf('adresse_speichern', { adresse: $('adresse').value });
  } catch (err) {
    fehler(err);
  } finally {
    $('speichern').disabled = false;
    $('speichern').textContent = 'Verbinden';
  }
});

$('erneut').addEventListener('click', async () => {
  fehler('');
  $('erneut').disabled = true;
  try {
    await aufruf('neu_verbinden');
  } catch (err) {
    fehler(err);
  } finally {
    $('erneut').disabled = false;
  }
});

$('aendern').addEventListener('click', () => {
  $('offline').hidden = true;
  $('formular').hidden = false;
  $('adresse').focus();
});

start().catch(fehler);
