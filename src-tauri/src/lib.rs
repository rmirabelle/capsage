mod browse;
mod capture;
mod document;
mod updater;

use std::{path::Path, sync::Mutex};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const CAPTURE_SHORTCUT: &str = "Ctrl+Alt+PrintScreen";

struct PendingOpenDocument(Mutex<Option<String>>);

struct ShortcutRegistration {
    inner: Mutex<ShortcutRegistrationState>,
}

struct ShortcutRegistrationState {
    shortcut: String,
    error: Option<String>,
}

fn capsage_document_from_args(args: &[String], cwd: &str) -> Option<String> {
    args.iter().skip(1).find_map(|argument| {
        let path = Path::new(argument);
        let is_capsage = path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("capsage"));
        if !is_capsage {
            return None;
        }
        let resolved = if path.is_absolute() {
            path.to_path_buf()
        } else {
            Path::new(cwd).join(path)
        };
        Some(resolved.to_string_lossy().into_owned())
    })
}

#[tauri::command]
fn take_pending_open_document(state: State<'_, PendingOpenDocument>) -> Option<String> {
    state
        .0
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .take()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ShortcutStatus {
    registered: bool,
    shortcut: String,
    error: Option<String>,
}

#[tauri::command]
fn shortcut_status(registration: State<'_, ShortcutRegistration>) -> ShortcutStatus {
    let state = registration
        .inner
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    ShortcutStatus {
        registered: state.error.is_none(),
        shortcut: state.shortcut.clone(),
        error: state.error.clone(),
    }
}

fn register_capture_shortcut(app: &tauri::AppHandle, shortcut: &str) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = app.emit("capture-hotkey", ());
            }
        })
        .map_err(|error| error.to_string())
}

fn restore_main_window(app: &tauri::AppHandle) {
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.destroy();
    }
    if let Some(menu) = app.get_webview_window("tray-menu") {
        let _ = menu.destroy();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
}

fn open_tray_menu(app: &tauri::AppHandle, click: PhysicalPosition<f64>) -> Result<(), String> {
    const MENU_WIDTH: f64 = 230.0;
    const MENU_HEIGHT: f64 = 132.0;

    if let Some(existing) = app.get_webview_window("tray-menu") {
        let _ = existing.destroy();
    }

    let monitor = app
        .monitor_from_point(click.x, click.y)
        .map_err(|error| format!("Could not identify the tray monitor: {error}"))?
        .or_else(|| app.primary_monitor().ok().flatten());
    let (x, y) = if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let width = MENU_WIDTH * scale;
        let height = MENU_HEIGHT * scale;
        let left = monitor.position().x as f64;
        let top = monitor.position().y as f64;
        let right = left + monitor.size().width as f64;
        let bottom = top + monitor.size().height as f64;
        (
            if click.x + width > right {
                click.x - width
            } else {
                click.x
            }
            .clamp(left, (right - width).max(left)),
            if click.y + height > bottom {
                click.y - height
            } else {
                click.y
            }
            .clamp(top, (bottom - height).max(top)),
        )
    } else {
        (click.x - MENU_WIDTH, click.y - MENU_HEIGHT)
    };

    let menu = WebviewWindowBuilder::new(app, "tray-menu", WebviewUrl::App("index.html".into()))
        .title("CapSage")
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible(false)
        .inner_size(MENU_WIDTH, MENU_HEIGHT)
        .shadow(true)
        .build()
        .map_err(|error| format!("Could not open the tray menu: {error}"))?;
    menu.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
        .map_err(|error| format!("Could not position the tray menu: {error}"))?;
    Ok(())
}

#[tauri::command]
fn activate_tray_menu(app: tauri::AppHandle) -> Result<(), String> {
    let menu = app
        .get_webview_window("tray-menu")
        .ok_or_else(|| "The tray menu is no longer open.".to_string())?;
    menu.show()
        .map_err(|error| format!("Could not show the tray menu: {error}"))?;
    menu.set_focus()
        .map_err(|error| format!("Could not focus the tray menu: {error}"))
}

#[tauri::command]
fn close_tray_menu(app: tauri::AppHandle) {
    if let Some(menu) = app.get_webview_window("tray-menu") {
        let _ = menu.destroy();
    }
}

#[tauri::command]
fn show_capsage(app: tauri::AppHandle) {
    restore_main_window(&app);
}

#[tauri::command]
fn exit_capsage(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn suspend_capture_shortcut(
    app: tauri::AppHandle,
    registration: State<'_, ShortcutRegistration>,
) -> Result<(), String> {
    let mut state = registration
        .inner
        .lock()
        .unwrap_or_else(|error| error.into_inner());

    if state.error.is_some() {
        return Ok(());
    }

    app.global_shortcut()
        .unregister(state.shortcut.as_str())
        .map_err(|error| format!("Could not pause the current shortcut: {error}"))?;
    state.error = Some("Shortcut paused while it is being edited.".into());
    Ok(())
}

#[tauri::command]
fn set_capture_shortcut(
    app: tauri::AppHandle,
    registration: State<'_, ShortcutRegistration>,
    shortcut: String,
) -> ShortcutStatus {
    let requested = shortcut.trim().to_string();
    if requested.parse::<Shortcut>().is_err() {
        let state = registration
            .inner
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        return ShortcutStatus {
            registered: state.error.is_none(),
            shortcut: state.shortcut.clone(),
            error: Some("That key combination is not supported.".into()),
        };
    }

    let mut state = registration
        .inner
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let previous = state.shortcut.clone();
    let previous_registered = state.error.is_none();

    if requested == previous && previous_registered {
        return ShortcutStatus {
            registered: true,
            shortcut: previous,
            error: None,
        };
    }

    if previous_registered {
        if let Err(error) = app.global_shortcut().unregister(previous.as_str()) {
            return ShortcutStatus {
                registered: true,
                shortcut: previous,
                error: Some(format!("Could not release the current shortcut: {error}")),
            };
        }
    }

    match register_capture_shortcut(&app, &requested) {
        Ok(()) => {
            state.shortcut = requested.clone();
            state.error = None;
            ShortcutStatus {
                registered: true,
                shortcut: requested,
                error: None,
            }
        }
        Err(error) => {
            let rollback = if previous_registered {
                register_capture_shortcut(&app, &previous)
            } else {
                Err("No previous shortcut was registered.".into())
            };

            match rollback {
                Ok(()) => {
                    state.shortcut = previous.clone();
                    state.error = None;
                    ShortcutStatus {
                        registered: true,
                        shortcut: previous,
                        error: Some(format!("Windows could not register that shortcut: {error}")),
                    }
                }
                Err(rollback_error) => {
                    state.shortcut = previous.clone();
                    state.error = Some(rollback_error.clone());
                    ShortcutStatus {
                        registered: false,
                        shortcut: previous,
                        error: Some(format!(
                            "Windows could not register that shortcut ({error}), and the previous shortcut could not be restored ({rollback_error})."
                        )),
                    }
                }
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let window_state_flags = tauri_plugin_window_state::StateFlags::SIZE
        | tauri_plugin_window_state::StateFlags::POSITION
        | tauri_plugin_window_state::StateFlags::MAXIMIZED
        | tauri_plugin_window_state::StateFlags::DECORATIONS
        | tauri_plugin_window_state::StateFlags::FULLSCREEN;

    let initial_args = std::env::args_os()
        .map(|argument| argument.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    let initial_cwd = std::env::current_dir()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let initial_document = capsage_document_from_args(&initial_args, &initial_cwd);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Some(path) = capsage_document_from_args(&args, &cwd) {
                let _ = app.emit("open-document-requested", path);
            }
            restore_main_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_state_flags)
                .with_denylist(&["splash", "region-selector", "tray-menu"])
                .build(),
        )
        .manage(PendingOpenDocument(Mutex::new(initial_document)))
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = window.hide();
            }
            tauri::WindowEvent::Resized(_) if window.label() == "main" => {
                if window.is_minimized().unwrap_or(false) {
                    let _ = window.hide();
                    let _ = window.unminimize();
                }
            }
            tauri::WindowEvent::CloseRequested { .. } if window.label() == "region-selector" => {
                let _ = window.app_handle().emit("region-selection-cancelled", ());
                if let Some(main) = window.app_handle().get_webview_window("main") {
                    let _ = main.show();
                    let _ = main.unminimize();
                    let _ = main.set_focus();
                }
            }
            _ => {}
        })
        .setup(|app| {
            let registration = register_capture_shortcut(app.handle(), CAPTURE_SHORTCUT);
            app.manage(ShortcutRegistration {
                inner: Mutex::new(ShortcutRegistrationState {
                    shortcut: CAPTURE_SHORTCUT.into(),
                    error: registration.err(),
                }),
            });
            let mut tray = TrayIconBuilder::with_id("capsage")
                .tooltip("CapSage — Ready to capture")
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        restore_main_window(tray.app_handle());
                    } else if let TrayIconEvent::Click {
                        button: MouseButton::Right,
                        button_state: MouseButtonState::Up,
                        position,
                        ..
                    } = event
                    {
                        let _ = open_tray_menu(tray.app_handle(), position);
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)
                .map_err(|error| format!("Could not create the CapSage tray icon: {error}"))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            capture::capture_active_window,
            capture::start_region_selection,
            capture::activate_region_selector,
            capture::cancel_region_selection,
            capture::capture_selector_region,
            capture::save_image,
            document::open_capture_file,
            document::save_capsage_document,
            browse::list_browse_directory,
            browse::browse_places,
            browse::rename_browse_entry,
            browse::delete_browse_entry,
            browse::copy_browse_entry,
            activate_tray_menu,
            close_tray_menu,
            show_capsage,
            take_pending_open_document,
            exit_capsage,
            shortcut_status,
            suspend_capture_shortcut,
            set_capture_shortcut,
            updater::check_for_update,
            updater::download_and_run_installer,
            updater::get_app_version
        ])
        .run(tauri::generate_context!())
        .expect("error while running CapSage");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_capsage_document_arguments_case_insensitively() {
        let args = vec!["capsage.exe".into(), "Capture.CAPSAGE".into()];
        assert_eq!(
            capsage_document_from_args(&args, r"C:\Captures"),
            Some(r"C:\Captures\Capture.CAPSAGE".into())
        );
    }

    #[test]
    fn ignores_unassociated_file_arguments() {
        let args = vec!["capsage.exe".into(), "capture.png".into()];
        assert_eq!(capsage_document_from_args(&args, r"C:\Captures"), None);
    }
}
