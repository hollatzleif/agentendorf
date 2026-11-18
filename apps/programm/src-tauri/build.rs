fn main() {
    // Eigene Befehle bekommen Berechtigungen „allow-<befehl>“ (Unterstriche → Bindestriche).
    // Ohne ausdrückliche Freigabe (Capability) kann keine Seite sie aufrufen.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
        "adresse_speichern",
        "adresse_lesen",
        "neu_verbinden",
        "melden",
        "zaehler_setzen",
        "schnell_schliessen",
        "glocke",
        "glocke_stopp",
    ])))
    .expect("tauri-build");
}
