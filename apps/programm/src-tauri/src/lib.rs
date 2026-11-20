//! Agentendorf als Programm für Mac und Windows (Etappe 6).
//!
//! Das Programm öffnet die Dorf-Adresse (beim ersten Start abgefragt) in einem eigenen Fenster. Die Oberfläche kommt
//! immer vom Server – jedes Deploy ist sofort da. Dazu kommen: Systemmeldungen, Symbol in der Leiste mit der Zahl
//! offener Freigaben, Schnelleingabe per Tastenkürzel, Autostart, automatische (signierte) Updates.
//!
//! Sicherheit: Die Seiten vom Server dürfen nur fünf eigene Befehle aufrufen (melden, zaehler_setzen,
//! schnell_schliessen, glocke, glocke_stopp) – freigegeben zur Laufzeit genau für den Ursprung der Dorf-Adresse. Keine Dateien, keine Shell.
//! Fremde Links öffnen im normalen Browser.

mod adresse;
mod einstellungen;
mod glocke;

use std::net::TcpStream;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::CapabilityBuilder;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

const HAUPT: &str = "main";
const SCHNELL: &str = "schnell";
const EINRICHTEN: &str = "einrichten";
const LEISTE: &str = "leiste";
pub const SCHNELL_KUERZEL: &str = "CommandOrControl+Shift+Space";

#[derive(Default)]
struct Zustand {
    /// Dorf ist geöffnet (Befehle für diesen Ursprung freigegeben)
    offen: Mutex<Option<Url>>,
    /// Einrichtungsseite: Server war nicht erreichbar
    offline: Mutex<bool>,
}

fn erreichbar(url: &Url) -> bool {
    let Ok(adressen) = url.socket_addrs(|| url.port_or_known_default()) else { return false };
    adressen.iter().any(|a| TcpStream::connect_timeout(a, Duration::from_secs(4)).is_ok())
}

async fn erreichbar_async(url: Url) -> bool {
    tauri::async_runtime::spawn_blocking(move || erreichbar(&url)).await.unwrap_or(false)
}

fn fenster_zeigen(app: &AppHandle) {
    let w = app.get_webview_window(HAUPT).or_else(|| app.get_webview_window(EINRICHTEN));
    if let Some(w) = w {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn schnell_umschalten(app: &AppHandle) {
    let Some(w) = app.get_webview_window(SCHNELL) else {
        fenster_zeigen(app);
        return;
    };
    if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
        let _ = w.hide();
    } else {
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn einrichten_zeigen(app: &AppHandle, offline: bool) -> tauri::Result<()> {
    *app.state::<Zustand>().offline.lock().unwrap() = offline;
    if let Some(w) = app.get_webview_window(EINRICHTEN) {
        let _ = w.eval("window.location.reload()");
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(app, EINRICHTEN, WebviewUrl::App("index.html".into()))
        .title("Agentendorf einrichten")
        .inner_size(520.0, 440.0)
        .resizable(false)
        .center()
        .build()?;
    Ok(())
}

/// Öffnet das Dorf: Befehle für genau diesen Ursprung freigeben, Haupt- und Schnell-Fenster anlegen.
fn dorf_oeffnen(app: &AppHandle, url: Url, sichtbar: bool) -> tauri::Result<()> {
    {
        let z = app.state::<Zustand>();
        let mut offen = z.offen.lock().unwrap();
        if offen.is_some() {
            drop(offen);
            fenster_zeigen(app);
            return Ok(());
        }
        app.add_capability(
            CapabilityBuilder::new("dorf")
                .remote(adresse::ursprung(&url))
                .local(false)
                .windows([HAUPT, SCHNELL])
                .permission("allow-melden")
                .permission("allow-zaehler-setzen")
                .permission("allow-schnell-schliessen")
                .permission("allow-glocke")
                .permission("allow-glocke-stopp"),
        )?;
        *offen = Some(url.clone());
    }

    let dorf = url.clone();
    let dorf_dl = url.clone();
    let h = app.clone();
    let h2 = app.clone();
    let h3 = app.clone();
    #[allow(unused_mut)]
    let mut haupt = WebviewWindowBuilder::new(app, HAUPT, WebviewUrl::External(url.clone()));
    // Nur in Debug-Builds: Selbsttest der Freigaben (DORF_PROGRAMM_SELBSTTEST=1), siehe test/selbsttest.sh
    #[cfg(debug_assertions)]
    if std::env::var("DORF_PROGRAMM_SELBSTTEST").is_ok() {
        haupt = haupt.on_page_load(|w, p| {
            if p.event() == tauri::webview::PageLoadEvent::Finished {
                let _ = w.eval(SELBSTTEST_JS);
            }
        });
    }
    haupt
        .title("Agentendorf")
        .inner_size(1280.0, 820.0)
        .min_inner_size(420.0, 520.0)
        .visible(sichtbar)
        .on_navigation(move |ziel| {
            if adresse::intern(&dorf, ziel) {
                return true;
            }
            let _ = h.opener().open_url(ziel.as_str(), None::<&str>);
            false
        })
        .on_new_window(move |ziel, _| {
            let _ = h2.opener().open_url(ziel.as_str(), None::<&str>);
            tauri::webview::NewWindowResponse::Deny
        })
        // E207: Downloads aus dem Dorf (Bibliothek, Chat, Atelier …) – ohne eigenen Handler lädt WKWebView (Mac) gar nichts,
        // und die WebView zeigt nirgends, wo die Datei landet. Ziel ist der Download-Ordner (Vorschlag der WebView, gleiche
        // Namen bekommen „(1)“ …); danach Meldung und der Ordner mit der Datei geht auf. Nur vom eigenen Dorf.
        .on_download(move |_w, ereignis| match ereignis {
            tauri::webview::DownloadEvent::Requested { url, .. } => adresse::intern(&dorf_dl, &url),
            tauri::webview::DownloadEvent::Finished { path, success, .. } => {
                let name = path
                    .as_ref()
                    .and_then(|p| p.file_name())
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "Datei".into());
                let _ = h3
                    .notification()
                    .builder()
                    .title(if success { "Heruntergeladen" } else { "Download fehlgeschlagen" })
                    .body(if success { format!("{name} liegt im Download-Ordner.") } else { format!("{name} konnte nicht gespeichert werden.") })
                    .show();
                if success {
                    if let Some(p) = path {
                        let _ = h3.opener().reveal_item_in_dir(p);
                    }
                }
                true
            }
            _ => true,
        })
        .build()?;

    let schnell = url.join("schnell").unwrap_or_else(|_| url.clone());
    WebviewWindowBuilder::new(app, SCHNELL, WebviewUrl::External(schnell))
        .title("Agentendorf – Schnelleingabe")
        .inner_size(560.0, 240.0)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .center()
        .build()?;

    if let Some(w) = app.get_webview_window(EINRICHTEN) {
        let _ = w.close();
    }
    #[cfg(not(debug_assertions))]
    updates_starten(app.clone(), url);
    Ok(())
}

// ---- Befehle der Einrichtungsseite (lokal) ----------------------------------------------------------

#[derive(Serialize)]
struct AdresseStand {
    adresse: Option<String>,
    offline: bool,
}

#[tauri::command]
fn adresse_lesen(app: AppHandle) -> AdresseStand {
    AdresseStand { adresse: einstellungen::laden(&app).adresse, offline: *app.state::<Zustand>().offline.lock().unwrap() }
}

#[tauri::command]
async fn adresse_speichern(app: AppHandle, adresse: String) -> Result<String, String> {
    let url = adresse::pruefen(&adresse)?;
    if !erreichbar_async(url.clone()).await {
        return Err(format!("Unter {} antwortet gerade kein Server. Stimmt die Adresse? Bist du online?", adresse::ursprung(&url)));
    }
    let mut e = einstellungen::laden(&app);
    e.adresse = Some(url.to_string());
    einstellungen::speichern(&app, &e)?;
    // Wechsel der Adresse bei offenem Dorf: neu starten, damit nur der neue Ursprung Befehle aufrufen darf
    if app.state::<Zustand>().offen.lock().unwrap().is_some() {
        app.restart();
    }
    dorf_oeffnen(&app, url.clone(), true).map_err(|e| e.to_string())?;
    Ok(url.to_string())
}

#[tauri::command]
async fn neu_verbinden(app: AppHandle) -> Result<(), String> {
    let url = einstellungen::laden(&app).adresse.and_then(|a| adresse::pruefen(&a).ok()).ok_or("Noch keine Adresse eingetragen.")?;
    if !erreichbar_async(url.clone()).await {
        return Err("Das Dorf ist noch nicht erreichbar.".into());
    }
    dorf_oeffnen(&app, url, true).map_err(|e| e.to_string())
}

// ---- Befehle der Dorf-Seiten (nur für den Ursprung der Dorf-Adresse freigegeben) --------------------

#[tauri::command]
fn melden(app: AppHandle, titel: String, text: String) -> Result<(), String> {
    let titel: String = titel.chars().take(120).collect();
    let text: String = text.chars().take(400).collect();
    app.notification().builder().title(titel).body(text).show().map_err(|e| e.to_string())
}

/// E74: Kirchturm-Glocke – nur „schlag“ oder „gelaeut“, 1–20 Mal
#[tauri::command]
fn glocke(app: AppHandle, art: String, mal: u8) -> Result<(), String> {
    glocke::spielen(&app, &art, mal)
}

#[tauri::command]
fn glocke_stopp(app: AppHandle) {
    #[cfg(debug_assertions)]
    if std::env::var("DORF_PROGRAMM_SELBSTTEST").is_ok() {
        println!("SELBSTTEST glocke_stopp");
    }
    glocke::stoppen(&app);
}

#[tauri::command]
fn zaehler_setzen(app: AppHandle, anzahl: u32) {
    #[cfg(debug_assertions)]
    if std::env::var("DORF_PROGRAMM_SELBSTTEST").is_ok() {
        println!("SELBSTTEST zaehler {anzahl}");
        if anzahl >= 700 {
            app.exit(0);
        }
    }
    let n = anzahl.min(999);
    if let Some(t) = app.tray_by_id(LEISTE) {
        let tipp = match n {
            0 => "Agentendorf".to_string(),
            1 => "Agentendorf – 1 Freigabe wartet".to_string(),
            _ => format!("Agentendorf – {n} Freigaben warten"),
        };
        let _ = t.set_tooltip(Some(tipp));
        #[cfg(target_os = "macos")]
        let _ = t.set_title(if n > 0 { Some(n.to_string()) } else { None });
    }
    #[cfg(target_os = "macos")]
    if let Some(w) = app.get_webview_window(HAUPT) {
        let _ = w.set_badge_count(if n > 0 { Some(n as i64) } else { None });
    }
}

#[tauri::command]
fn schnell_schliessen(app: AppHandle) {
    if let Some(w) = app.get_webview_window(SCHNELL) {
        let _ = w.hide();
    }
}

/// Selbsttest (nur Debug): läuft in der Dorf-Seite wie deren eigenes JavaScript.
/// Erlaubt: zaehler_setzen, glocke (nur bekannte Töne). Verboten: adresse_speichern (nur Einrichtungsseite), Plugin-Befehle ohne Freigabe.
#[cfg(debug_assertions)]
const SELBSTTEST_JS: &str = r#"
(async () => {
  const i = window.__TAURI_INTERNALS__;
  const darf = async (b, a) => { try { await i.invoke(b, a); return true; } catch (e) { return false; } };
  await i.invoke('zaehler_setzen', { anzahl: 3 });
  await i.invoke('glocke', { art: 'schlag', mal: 2 });
  await i.invoke('glocke_stopp');
  const verboten = [
    await darf('glocke', { art: '../../etc/passwd', mal: 1 }),
    await darf('adresse_speichern', { adresse: 'https://boese.example' }),
    await darf('neu_verbinden'),
    await darf('plugin:opener|open_url', { url: 'https://boese.example' }),
    await darf('plugin:autostart|disable'),
  ];
  await i.invoke('zaehler_setzen', { anzahl: verboten.some(Boolean) ? 666 : 777 });
})();
"#;

// ---- Updates ------------------------------------------------------------------------------------------

#[cfg(not(debug_assertions))]
fn updates_starten(app: AppHandle, dorf: Url) {
    tauri::async_runtime::spawn(async move {
        tokio_schlaf(Duration::from_secs(20)).await;
        loop {
            if let Err(e) = update_pruefen(&app, &dorf).await {
                eprintln!("Update-Prüfung: {e}");
            }
            tokio_schlaf(Duration::from_secs(6 * 3600)).await;
        }
    });
}

#[cfg(not(debug_assertions))]
async fn tokio_schlaf(d: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}

#[cfg(not(debug_assertions))]
async fn update_pruefen(app: &AppHandle, dorf: &Url) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_updater::UpdaterExt;
    let ende = dorf.join("programme/latest.json")?;
    if let Some(u) = app.updater_builder().endpoints(vec![ende])?.build()?.check().await? {
        let _ = app
            .notification()
            .builder()
            .title("Agentendorf wird aktualisiert")
            .body(format!("Version {} wird installiert – das Programm startet gleich neu.", u.version))
            .show();
        u.download_and_install(|_, _| {}, || {}).await?;
        app.restart();
    }
    Ok(())
}

// ---- Leiste (Tray) --------------------------------------------------------------------------------------

fn leiste_bauen(app: &AppHandle) -> tauri::Result<()> {
    use tauri_plugin_autostart::ManagerExt;
    let an = app.autolaunch().is_enabled().unwrap_or(false);
    let oeffnen = MenuItem::with_id(app, "oeffnen", "Dorf öffnen", true, None::<&str>)?;
    let schnell = MenuItem::with_id(app, "schnell", "Schnelleingabe (Strg/⌘ + Umschalt + Leertaste)", true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(app, "autostart", "Beim Anmelden starten", true, an, None::<&str>)?;
    let adresse = MenuItem::with_id(app, "adresse", "Dorf-Adresse ändern …", true, None::<&str>)?;
    let beenden = MenuItem::with_id(app, "beenden", "Beenden", true, None::<&str>)?;
    let t1 = PredefinedMenuItem::separator(app)?;
    let t2 = PredefinedMenuItem::separator(app)?;
    let menue = Menu::with_items(app, &[&oeffnen, &schnell, &t1, &autostart, &adresse, &t2, &beenden])?;
    let auto = autostart.clone();
    let mut b = TrayIconBuilder::with_id(LEISTE)
        .tooltip("Agentendorf")
        .menu(&menue)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, e| match e.id.as_ref() {
            "oeffnen" => fenster_zeigen(app),
            "schnell" => schnell_umschalten(app),
            "autostart" => {
                let a = app.autolaunch();
                let jetzt = a.is_enabled().unwrap_or(false);
                let _ = if jetzt { a.disable() } else { a.enable() };
                let _ = auto.set_checked(a.is_enabled().unwrap_or(!jetzt));
            }
            "adresse" => {
                let _ = einrichten_zeigen(app, false);
            }
            "beenden" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|leiste, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                fenster_zeigen(leiste.app_handle());
            }
        });
    if let Some(i) = app.default_window_icon() {
        b = b.icon(i.clone());
    }
    b.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let autostart_lauf = std::env::args().any(|a| a == "--autostart");
    tauri::Builder::default()
        // muss als erstes Plugin registriert sein: zweiter Start → vorhandenes Fenster zeigen
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| fenster_zeigen(app)))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().with_denylist(&[SCHNELL, EINRICHTEN]).build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--autostart"])))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _kuerzel, ereignis| {
                    if ereignis.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        schnell_umschalten(app);
                    }
                })
                .build(),
        )
        .manage(Zustand::default())
        .manage(glocke::Glocke::default())
        .invoke_handler(tauri::generate_handler![adresse_lesen, adresse_speichern, neu_verbinden, melden, zaehler_setzen, schnell_schliessen, glocke, glocke_stopp])
        .setup(move |app| {
            let h = app.handle().clone();
            leiste_bauen(&h)?;
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                if let Err(e) = h.global_shortcut().register(SCHNELL_KUERZEL) {
                    eprintln!("Tastenkürzel {SCHNELL_KUERZEL} nicht verfügbar: {e}");
                }
            }
            // Autostart beim ersten Start einschalten (Leifs Wunsch); danach entscheidet das Häkchen in der Leiste
            let mut e = einstellungen::laden(&h);
            if !e.autostart_eingerichtet {
                use tauri_plugin_autostart::ManagerExt;
                let _ = h.autolaunch().enable();
                e.autostart_eingerichtet = true;
                let _ = einstellungen::speichern(&h, &e);
            }
            match e.adresse.as_deref().and_then(|a| adresse::pruefen(a).ok()) {
                None => einrichten_zeigen(&h, false)?,
                Some(url) if erreichbar(&url) => dorf_oeffnen(&h, url, !autostart_lauf)?,
                Some(_) if autostart_lauf => {
                    // beim Anmelden noch kein Netz: still in der Leiste warten, später erneut versuchen
                    let h2 = h.clone();
                    tauri::async_runtime::spawn(async move {
                        for _ in 0..60 {
                            let _ = tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_secs(30))).await;
                            let url = einstellungen::laden(&h2).adresse.and_then(|a| adresse::pruefen(&a).ok());
                            if let Some(url) = url {
                                if erreichbar_async(url.clone()).await {
                                    let h3 = h2.clone();
                                    let _ = h2.run_on_main_thread(move || {
                                        let _ = dorf_oeffnen(&h3, url, false);
                                    });
                                    break;
                                }
                            }
                        }
                    });
                }
                Some(_) => einrichten_zeigen(&h, true)?,
            }
            Ok(())
        })
        .on_window_event(|w, e| {
            // Haupt- und Schnell-Fenster nur ausblenden – das Programm bleibt in der Leiste (Tastenkürzel, Meldungen)
            if let WindowEvent::CloseRequested { api, .. } = e {
                if w.label() == HAUPT || w.label() == SCHNELL {
                    api.prevent_close();
                    let _ = w.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("Agentendorf konnte nicht starten")
        .run(|app, e| match e {
            // ohne offene Fenster weiterlaufen (Leiste), solange das Dorf eingerichtet ist
            RunEvent::ExitRequested { code: None, api, .. } if app.get_webview_window(HAUPT).is_some() => api.prevent_exit(),
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => fenster_zeigen(app),
            _ => {}
        });
}
