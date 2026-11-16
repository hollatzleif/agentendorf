/** Austauschbare Uhr, damit Tests Zeit vorspulen können. */
export interface Uhr {
  jetzt(): number;
}
export const systemUhr: Uhr = { jetzt: () => Date.now() };

export class TestUhr implements Uhr {
  constructor(private ms = Date.UTC(2026, 10, 16, 12, 0, 0)) {}
  jetzt() {
    return this.ms;
  }
  vor(ms: number) {
    this.ms += ms;
  }
}
