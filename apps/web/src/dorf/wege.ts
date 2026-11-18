/** A*-Wegsuche auf dem Feldraster (4 Nachbarn). Gibt die Felder von start bis ziel zurück oder null. */
export function wegFinden(start: [number, number], ziel: [number, number], begehbar: (x: number, z: number) => boolean, max = 20_000): [number, number][] | null {
  const k = (x: number, z: number) => `${x},${z}`;
  const h = (x: number, z: number) => Math.abs(x - ziel[0]) + Math.abs(z - ziel[1]);
  const offen: { x: number; z: number; f: number; g: number }[] = [{ x: start[0], z: start[1], g: 0, f: h(start[0], start[1]) }];
  const kosten = new Map<string, number>([[k(start[0], start[1]), 0]]);
  const von = new Map<string, string>();
  let schritte = 0;
  while (offen.length && schritte++ < max) {
    let bi = 0;
    for (let i = 1; i < offen.length; i++) if (offen[i]!.f < offen[bi]!.f) bi = i;
    const c = offen.splice(bi, 1)[0]!;
    if (c.x === ziel[0] && c.z === ziel[1]) {
      const weg: [number, number][] = [];
      let s: string | undefined = k(c.x, c.z);
      while (s) {
        const [x, z] = s.split(',').map(Number) as [number, number];
        weg.unshift([x, z]);
        s = von.get(s);
      }
      return weg;
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = c.x + dx;
      const nz = c.z + dz;
      const istZiel = nx === ziel[0] && nz === ziel[1];
      if (!istZiel && !begehbar(nx, nz)) continue;
      const g = c.g + 1;
      const nk = k(nx, nz);
      if (g < (kosten.get(nk) ?? Infinity)) {
        kosten.set(nk, g);
        von.set(nk, k(c.x, c.z));
        offen.push({ x: nx, z: nz, g, f: g + h(nx, nz) });
      }
    }
  }
  return null;
}
