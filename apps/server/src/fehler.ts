/** Fehler mit HTTP-Status und einer Meldung, die der Nutzer sehen darf. */
export class DorfFehler extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
