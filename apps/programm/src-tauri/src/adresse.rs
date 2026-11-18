//! Dorf-Adresse prüfen: nur https (http nur für den eigenen Rechner), keine Zugangsdaten in der Adresse,
//! gespeichert wird nur der Ursprung (Schema, Host, Port) – Pfade werden verworfen.
use url::Url;

pub fn pruefen(eingabe: &str) -> Result<Url, String> {
    let t = eingabe.trim().trim_end_matches('/');
    if t.is_empty() {
        return Err("Bitte die Adresse deines Dorfs eintragen.".into());
    }
    let mit_schema = if t.contains("://") { t.to_string() } else { format!("https://{t}") };
    let url = Url::parse(&mit_schema).map_err(|_| format!("„{t}“ ist keine gültige Adresse."))?;
    let host = url.host_str().ok_or_else(|| "Die Adresse braucht einen Rechnernamen.".to_string())?.to_string();
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Bitte keine Zugangsdaten in die Adresse schreiben.".into());
    }
    let lokal = host == "localhost" || host == "127.0.0.1" || host == "[::1]";
    match url.scheme() {
        "https" => {}
        "http" if lokal => {}
        _ => return Err("Die Adresse muss mit https:// beginnen.".into()),
    }
    let ursprung = url.origin().ascii_serialization();
    Url::parse(&format!("{ursprung}/")).map_err(|e| e.to_string())
}

/// Ursprung für die Freigabe der Befehle (z. B. „https://dorf.example.at“)
pub fn ursprung(url: &Url) -> String {
    url.origin().ascii_serialization()
}

/// Gehört eine Adresse zum Dorf (gleicher Ursprung) oder ist sie harmlos (about:, data:, blob:)?
pub fn intern(dorf: &Url, ziel: &Url) -> bool {
    matches!(ziel.scheme(), "about" | "data" | "blob") || ziel.origin() == dorf.origin()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ergaenzt_https_und_kuerzt_auf_den_ursprung() {
        assert_eq!(pruefen("dorf.example.at").unwrap().as_str(), "https://dorf.example.at/");
        assert_eq!(pruefen(" https://dorf.example.at/gebaeude/Uni?x=1 ").unwrap().as_str(), "https://dorf.example.at/");
        assert_eq!(pruefen("https://dorf.example.at:8443").unwrap().as_str(), "https://dorf.example.at:8443/");
        assert_eq!(pruefen("http://localhost:3000").unwrap().as_str(), "http://localhost:3000/");
    }

    #[test]
    fn lehnt_unsicheres_ab() {
        assert!(pruefen("").is_err());
        assert!(pruefen("http://dorf.example.at").is_err());
        assert!(pruefen("ftp://dorf.example.at").is_err());
        assert!(pruefen("https://leif:geheim@dorf.example.at").is_err());
        assert!(pruefen("javascript:alert(1)").is_err());
        assert!(pruefen("file:///etc/passwd").is_err());
    }

    #[test]
    fn intern_nur_gleicher_ursprung() {
        let d = pruefen("dorf.example.at").unwrap();
        assert!(intern(&d, &Url::parse("https://dorf.example.at/chats/1").unwrap()));
        assert!(intern(&d, &Url::parse("about:blank").unwrap()));
        assert!(!intern(&d, &Url::parse("https://moodle.jku.at/").unwrap()));
        assert!(!intern(&d, &Url::parse("http://dorf.example.at/").unwrap()));
        assert!(!intern(&d, &Url::parse("https://dorf.example.at.boese.de/").unwrap()));
        assert_eq!(ursprung(&d), "https://dorf.example.at");
    }
}
