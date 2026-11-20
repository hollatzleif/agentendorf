import { spawn, type ChildProcess } from 'node:child_process';
import type { Writable } from 'node:stream';

/**
 * Terminal im Codehaus (E197): eine Shell an einem echten Pseudo-Terminal – ohne natives Node-Modul.
 *
 * Node kann von sich aus kein PTY öffnen (node-pty ist ein natives Modul und müsste im Image gebaut werden). Im
 * Coding-Container gibt es aber Python 3, und dessen Standardbibliothek kann es (pty.fork, termios): Ein kleiner Helfer
 * (unten, wird mit `python3 -c` gestartet – keine zusätzliche Datei im Image) hält das PTY und reicht durch:
 *   Standardeingabe → PTY, PTY → Standardausgabe, Deskriptor 3 = Steuerkanal („<spalten> <zeilen>\n“ → TIOCSWINSZ).
 * Endet die Eingabe oder kommt SIGTERM, bekommt die Shell SIGHUP (wie beim Schließen eines Terminalfensters).
 */
export const PTY_HELFER = `
import os, pty, sys, select, struct, fcntl, termios, signal, errno
spalten, zeilen = int(sys.argv[1]), int(sys.argv[2])
pid, fd = pty.fork()
if pid == 0:
    try:
        os.close(3)
    except OSError:
        pass
    os.execvp(sys.argv[3], sys.argv[3:])
def groesse(s, z):
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', max(1, min(z, 500)), max(1, min(s, 1000)), 0, 0))
    except OSError:
        pass
groesse(spalten, zeilen)
def ende(*_):
    try:
        os.killpg(pid, signal.SIGHUP)
    except OSError:
        pass
    try:
        os.close(fd)
    except OSError:
        pass
    os._exit(0)
signal.signal(signal.SIGTERM, ende)
signal.signal(signal.SIGHUP, ende)
quellen = [0, 3, fd]
steuer = b''
while True:
    try:
        bereit, _, _ = select.select(quellen, [], [])
    except OSError as e:
        if e.errno == errno.EINTR:
            continue
        raise
    if fd in bereit:
        try:
            daten = os.read(fd, 65536)
        except OSError:
            daten = b''
        if not daten:
            break
        os.write(1, daten)
    if 0 in bereit:
        daten = os.read(0, 65536)
        if not daten:
            ende()
        while daten:
            n = os.write(fd, daten)
            daten = daten[n:]
    if 3 in bereit:
        daten = os.read(3, 4096)
        if not daten:
            quellen.remove(3)
        else:
            steuer += daten
            while b'\\n' in steuer:
                zeile, steuer = steuer.split(b'\\n', 1)
                try:
                    s, z = zeile.split()
                    groesse(int(s), int(z))
                except ValueError:
                    pass
try:
    _, status = os.waitpid(pid, 0)
    sys.exit(os.waitstatus_to_exitcode(status) if hasattr(os, 'waitstatus_to_exitcode') else 0)
except OSError:
    sys.exit(0)
`;

export const TERMINAL_MAX = 8;
const zahl = (w: unknown, min: number, max: number, sonst: number) => (typeof w === 'number' && Number.isFinite(w) ? Math.max(min, Math.min(max, Math.floor(w))) : sonst);

export interface TerminalStart {
  id: string;
  cwd: string;
  umgebung: NodeJS.ProcessEnv;
  spalten?: unknown;
  zeilen?: unknown;
  /** Programm im Terminal (Standard: bash – keine Anmelde-Shell, /etc/profile würde den PATH des Images ersetzen) – nur für Tests anders */
  befehl?: string[];
  python?: string;
}

/** Alle offenen Terminals des Runners. */
export class Terminals {
  private offen = new Map<string, ChildProcess>();

  get anzahl() {
    return this.offen.size;
  }

  hat(id: string) {
    return this.offen.has(id);
  }

  /** Startet eine Shell am PTY. `aus` bekommt alles, was sie schreibt; `ende` genau einmal. */
  starten(s: TerminalStart, aus: (d: Buffer) => void, ende: (code: number | null) => void): void {
    const p = spawn(s.python ?? 'python3', ['-u', '-c', PTY_HELFER, String(zahl(s.spalten, 2, 1000, 80)), String(zahl(s.zeilen, 2, 500, 24)), ...(s.befehl ?? ['bash'])], {
      cwd: s.cwd,
      env: { ...s.umgebung, TERM: 'xterm-256color', COLORTERM: 'truecolor', DORF_TERMINAL: '1' },
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });
    this.offen.set(s.id, p);
    let fertig = false;
    const schluss = (code: number | null) => {
      if (fertig) return;
      fertig = true;
      this.offen.delete(s.id);
      ende(code);
    };
    p.stdout!.on('data', aus);
    p.stderr!.on('data', aus);
    for (const strom of [p.stdin!, p.stdio[3] as Writable]) strom.on('error', () => {});
    p.on('error', (e) => {
      aus(Buffer.from(`\r\nTerminal ließ sich nicht starten: ${e.message}\r\n`));
      schluss(null);
    });
    p.on('close', (code) => schluss(code));
  }

  eingabe(id: string, daten: Buffer): boolean {
    const p = this.offen.get(id);
    if (!p?.stdin?.writable) return false;
    p.stdin.write(daten);
    return true;
  }

  groesse(id: string, spalten: unknown, zeilen: unknown): boolean {
    const p = this.offen.get(id);
    const kanal = p?.stdio[3] as Writable | undefined;
    if (!kanal?.writable) return false;
    kanal.write(`${zahl(spalten, 2, 1000, 80)} ${zahl(zeilen, 2, 500, 24)}\n`);
    return true;
  }

  schliessen(id: string): boolean {
    const p = this.offen.get(id);
    if (!p) return false;
    p.kill('SIGTERM');
    setTimeout(() => p.exitCode === null && p.kill('SIGKILL'), 3000).unref();
    return true;
  }

  alleSchliessen(): number {
    const n = this.offen.size;
    for (const id of [...this.offen.keys()]) this.schliessen(id);
    return n;
  }
}
