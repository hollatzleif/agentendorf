/** Kann dieses Gerät WebGL? (eigene Datei, damit die Liste ohne three.js auskommt) */
export function webglMoeglich() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}
