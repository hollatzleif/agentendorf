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

/// E205: Ist das die Adresse von VS Code im Codehaus (`code.<Dorf-Rechner>`, gleiches Schema, gleicher Port)?
/// Die Dorf-App bettet sie als Rahmen ein (/codehaus/vscode). WKWebView (Mac) und WebKitGTK (Linux) fragen den
/// Navigations-Filter auch für eingebettete Rahmen – ohne diese Ausnahme landete VS Code im normalen Browser statt im Rahmen.
/// Befehle des Programms bekommt diese Adresse nicht: die Freigabe gilt nur für den Ursprung des Dorfs (`ursprung`).
pub fn codehaus(dorf: &Url, ziel: &Url) -> bool {
    match (dorf.host_str(), ziel.host_str()) {
        (Some(d), Some(z)) => {
            ziel.scheme() == dorf.scheme() && ziel.port_or_known_default() == dorf.port_or_known_default() && z == format!("code.{d}")
        }
        _ => false,
    }
}

/// Review E205: Webviews von VS Code (Markdown-Vorschau, Einzelheiten einer Erweiterung, Panels von Erweiterungen) sind
/// Rahmen auf `https://<kennung>.vscode-cdn.net/…` (product.json von openvscode-server 1.109.5:
/// `webviewContentExternalBaseUrlTemplate = https://{{uuid}}.vscode-cdn.net/…`; die Kennung ist ein Hash aus 52 Zeichen
/// 0–9/a–v). Auf Mac/Linux läuft auch deren Navigation durch den Filter – ohne diese Ausnahme bliebe jede Webview leer
/// und es öffnete sich je Mal ein Browser-Tab. Nur https auf dem Standard-Port, genau EIN Namensteil vor vscode-cdn.net.
/// Befehle des Programms bekommt auch diese Adresse nicht (Freigabe nur für den Ursprung des Dorfs).
pub fn vscode_webview(ziel: &Url) -> bool {
    if ziel.scheme() != "https" || ziel.port().is_some() || !ziel.username().is_empty() || ziel.password().is_some() {
        return false;
    }
    match ziel.host_str().and_then(|h| h.strip_suffix(".vscode-cdn.net")) {
        Some(k) => !k.is_empty() && k.len() <= 64 && k.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()),
        None => false,
    }
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

    #[test]
    fn vscode_webview_nur_ein_namensteil_vor_vscode_cdn_net() {
        let ja = |u: &str| vscode_webview(&Url::parse(u).unwrap());
        // so sieht die Adresse einer Webview aus (Hash aus 52 Zeichen)
        assert!(ja("https://0c2tlk3r8tbrqi1q7fj1v6j0s0q3f6m9a7v1b8m5n4e2d0c9h8g7.vscode-cdn.net/insider/ef65ac1ba57f57f2a3961bfe94aa20481caca4c6/out/vs/workbench/contrib/webview/browser/pre/index.html?id=x"));
        assert!(ja("https://abc123.vscode-cdn.net/"));
        // Fälschungen
        assert!(!ja("https://vscode-cdn.net.boese.de/"));
        assert!(!ja("https://abc.vscode-cdn.net.boese.de/"));
        assert!(!ja("https://boese.de/abc.vscode-cdn.net/"));
        assert!(!ja("https://boese.de/?x=.vscode-cdn.net"));
        assert!(!ja("https://x.vscode-cdn.net:8443/"));
        assert!(!ja("http://x.vscode-cdn.net/"));
        assert!(!ja("https://vscode-cdn.net/"));
        assert!(!ja("https://.vscode-cdn.net/"));
        assert!(!ja("https://a.b.vscode-cdn.net/"));
        assert!(!ja("https://a-b.vscode-cdn.net/"));
        assert!(!ja("https://xvscode-cdn.net/"));
        assert!(!ja("https://x.vscode-cdn.net.evil/"));
        assert!(!ja("https://leif:geheim@x.vscode-cdn.net/"));
        assert!(!ja("https://x.vscode-cdn.net@boese.de/"));
        assert!(!ja(&format!("https://{}.vscode-cdn.net/", "a".repeat(65))));
        assert!(!ja("about:blank"));
        // Großbuchstaben macht die URL-Bibliothek klein – das bleibt derselbe Rechner
        assert!(ja("https://ABC.VSCODE-CDN.NET/"));
        // die Freigabe der Befehle bleibt beim Dorf
        let d = pruefen("dorf.example.at").unwrap();
        assert!(!intern(&d, &Url::parse("https://abc.vscode-cdn.net/").unwrap()));
        assert_ne!(ursprung(&d), "https://abc.vscode-cdn.net");
    }

    #[test]
    fn codehaus_nur_code_unteradresse_des_dorfs() {
        let d = pruefen("dorf.example.at").unwrap();
        assert!(codehaus(&d, &Url::parse("https://code.dorf.example.at/_dorf/eintritt?karte=x").unwrap()));
        assert!(codehaus(&d, &Url::parse("https://code.dorf.example.at/?folder=/arbeit/x").unwrap()));
        assert!(!codehaus(&d, &Url::parse("http://code.dorf.example.at/").unwrap()));
        assert!(!codehaus(&d, &Url::parse("https://code.dorf.example.at:8443/").unwrap()));
        assert!(!codehaus(&d, &Url::parse("https://code.dorf.example.at.boese.de/").unwrap()));
        assert!(!codehaus(&d, &Url::parse("https://xcode.dorf.example.at/").unwrap()));
        assert!(!codehaus(&d, &Url::parse("https://code.code.dorf.example.at/").unwrap()));
        assert!(!codehaus(&d, &Url::parse("https://code.example.at/").unwrap()));
        assert!(!codehaus(&d, &Url::parse("https://dorf.example.at/").unwrap()));
        assert!(!codehaus(&d, &Url::parse("about:blank").unwrap()));
        // die Freigabe der Befehle bleibt beim Dorf
        assert!(!intern(&d, &Url::parse("https://code.dorf.example.at/").unwrap()));
    }
}
