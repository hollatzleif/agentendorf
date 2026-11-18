//! Einstellungen des Programms – eine kleine JSON-Datei im Konfigurationsordner des Programms.
//! Darin steht nur die Dorf-Adresse und ob der Autostart schon eingerichtet wurde (keine Geheimnisse).
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Einstellungen {
    pub adresse: Option<String>,
    #[serde(default)]
    pub autostart_eingerichtet: bool,
}

fn datei<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("einstellungen.json"))
}

pub fn laden<R: Runtime>(app: &AppHandle<R>) -> Einstellungen {
    datei(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn speichern<R: Runtime>(app: &AppHandle<R>, e: &Einstellungen) -> Result<(), String> {
    let p = datei(app).ok_or("Kein Konfigurationsordner gefunden.")?;
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let tmp = p.with_extension("json.neu");
    std::fs::write(&tmp, serde_json::to_vec_pretty(e).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(tmp, p).map_err(|e| e.to_string())
}
