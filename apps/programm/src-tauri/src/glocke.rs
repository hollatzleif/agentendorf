//! Kirchturm-Glocke (E74): der einzige Ton des Dorfs. Zwei eingebaute Aufnahmen (eigene Synthese,
//! `toene/erzeugen.py`): ein Schlag (Timer, Pomodoro, Mitteilungen) und ein Geläut (Wecker).
//!
//! Abgespielt wird mit dem Bordmittel des Systems (macOS: afplay, Windows: Media.SoundPlayer, Linux: paplay/aplay),
//! damit es auch klingt, wenn das Fenster versteckt ist – ohne zusätzliche Audio-Bibliothek.
//! Die Seite wählt nur „schlag“ oder „gelaeut“ und wie oft – keine Pfade, keine Dateien von außen.

use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};

const SCHLAG: &[u8] = include_bytes!("../toene/schlag.wav");
const GELAEUT: &[u8] = include_bytes!("../toene/gelaeut.wav");

#[derive(Default)]
pub struct Glocke {
    /// jede neue Glocke (und jedes Stopp) zählt hoch – ältere Wiederholungen hören dann auf
    lauf: AtomicU64,
    kind: Mutex<Option<Child>>,
}

/// Welche Aufnahme? Nur diese zwei Namen sind erlaubt.
pub fn ton(art: &str) -> Option<(&'static str, &'static [u8])> {
    match art {
        "schlag" => Some(("schlag", SCHLAG)),
        "gelaeut" => Some(("gelaeut", GELAEUT)),
        _ => None,
    }
}

fn datei(app: &AppHandle, name: &str, daten: &[u8]) -> Result<PathBuf, String> {
    let ordner = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&ordner).map_err(|e| e.to_string())?;
    let pfad = ordner.join(format!("glocke-{name}-{}.wav", daten.len()));
    if std::fs::metadata(&pfad).map(|m| m.len() as usize != daten.len()).unwrap_or(true) {
        std::fs::write(&pfad, daten).map_err(|e| e.to_string())?;
    }
    Ok(pfad)
}

fn spieler(pfad: &std::path::Path) -> Vec<Command> {
    #[cfg(target_os = "macos")]
    {
        let mut c = Command::new("/usr/bin/afplay");
        c.arg(pfad);
        vec![c]
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const OHNE_FENSTER: u32 = 0x0800_0000;
        let p = pfad.to_string_lossy().replace('\'', "''");
        let mut c = Command::new("powershell.exe");
        c.args(["-NoProfile", "-NonInteractive", "-Command", &format!("(New-Object System.Media.SoundPlayer '{p}').PlaySync()")])
            .creation_flags(OHNE_FENSTER);
        vec![c]
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let mut a = Command::new("paplay");
        a.arg(pfad);
        let mut b = Command::new("aplay");
        b.arg("-q").arg(pfad);
        vec![a, b]
    }
}

/// Glocke `mal`-mal läuten (1–20); eine laufende Glocke hört dafür auf.
pub fn spielen(app: &AppHandle, art: &str, mal: u8) -> Result<(), String> {
    let (name, daten) = ton(art).ok_or("unbekannter Ton")?;
    let mal = mal.clamp(1, 20);
    #[cfg(debug_assertions)]
    if std::env::var("DORF_PROGRAMM_SELBSTTEST").is_ok() {
        println!("SELBSTTEST glocke {name} {mal}");
        return Ok(());
    }
    let pfad = datei(app, name, daten)?;
    stoppen(app);
    let g = app.state::<Glocke>();
    let nr = g.lauf.load(Ordering::SeqCst);
    let h = app.clone();
    std::thread::spawn(move || {
        let g = h.state::<Glocke>();
        for i in 0..mal {
            if g.lauf.load(Ordering::SeqCst) != nr {
                return;
            }
            let kind = spieler(&pfad).into_iter().find_map(|mut c| c.spawn().ok());
            let Some(kind) = kind else { return };
            *g.kind.lock().unwrap() = Some(kind);
            // warten, bis der Ton fertig ist – oder jemand stoppt
            loop {
                std::thread::sleep(Duration::from_millis(60));
                if g.lauf.load(Ordering::SeqCst) != nr {
                    return;
                }
                let mut k = g.kind.lock().unwrap();
                match k.as_mut().map(|c| c.try_wait()) {
                    Some(Ok(None)) => continue,
                    _ => {
                        *k = None;
                        break;
                    }
                }
            }
            if i + 1 < mal {
                std::thread::sleep(Duration::from_millis(400));
            }
        }
    });
    Ok(())
}

/// Glocke sofort verstummen lassen
pub fn stoppen(app: &AppHandle) {
    let g = app.state::<Glocke>();
    g.lauf.fetch_add(1, Ordering::SeqCst);
    let kind = g.kind.lock().unwrap().take();
    if let Some(mut k) = kind {
        let _ = k.kill();
        let _ = k.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nur_zwei_toene() {
        assert!(ton("schlag").is_some());
        assert!(ton("gelaeut").is_some());
        for boese in ["", "../../etc/passwd", "schlag.wav", "GELAEUT", "/tmp/x"] {
            assert!(ton(boese).is_none(), "{boese}");
        }
    }

    #[test]
    fn aufnahmen_sind_wav() {
        for (_, d) in [ton("schlag").unwrap(), ton("gelaeut").unwrap()] {
            assert_eq!(&d[0..4], b"RIFF");
            assert_eq!(&d[8..12], b"WAVE");
            assert!(d.len() > 50_000);
        }
    }
}
