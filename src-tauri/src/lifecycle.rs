//! Leaving the app. Quitting kills every running yt-dlp (see `kill_all`), so
//! a quit with downloads in flight asks first. The red button and Cmd+Q both
//! land in [`request_quit`].
//!
//! macOS sends a Dock "Quit" or a logout straight to the application
//! terminating, which Tauri reports only once it is too late to refuse.

use crate::db::queue;
use crate::downloads::DownloadManager;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem, MenuItemKind};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// Menu id of our own Quit, which replaces the predefined one.
pub const QUIT_MENU_ID: &str = "yank-quit";

/// The question to ask before quitting, or None when nothing would be lost.
pub fn quit_question(in_flight: i64) -> Option<String> {
    match in_flight {
        n if n <= 0 => None,
        1 => Some("1 download is still in progress. Quitting stops it. You can resume it the next time you open Yank.".into()),
        n => Some(format!("{n} downloads are still in progress. Quitting stops them. You can resume them the next time you open Yank.")),
    }
}

/// Keeps a second Cmd+Q from stacking a second dialog on the first.
#[derive(Default)]
struct OneAtATime(AtomicBool);

impl OneAtATime {
    fn enter(&self) -> bool {
        !self.0.swap(true, Ordering::SeqCst)
    }

    fn leave(&self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

static ASKING: OneAtATime = OneAtATime(AtomicBool::new(false));

/// Quit now, or after the user has confirmed. A database error must never
/// trap the user in the app, so it counts as nothing in flight.
pub fn request_quit(app: AppHandle) {
    if !ASKING.enter() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let in_flight = match app.try_state::<DownloadManager>() {
            Some(manager) => queue::count_in_flight(manager.pool()).await.unwrap_or_else(|error| {
                log::warn!("could not count downloads before quitting: {error}");
                0
            }),
            None => 0,
        };
        let confirmed = match quit_question(in_flight) {
            None => true,
            Some(question) => {
                let dialog = app.clone();
                // A blocking dialog must stay off the main thread.
                tauri::async_runtime::spawn_blocking(move || {
                    dialog
                        .dialog()
                        .message(question)
                        .title("Quit Yank?")
                        .kind(MessageDialogKind::Warning)
                        .buttons(MessageDialogButtons::OkCancelCustom("Quit".into(), "Keep downloading".into()))
                        .blocking_show()
                })
                .await
                .unwrap_or(false)
            }
        };
        ASKING.leave();
        if confirmed {
            app.exit(0);
        }
    });
}

/// The default menu, with its Quit routed through [`request_quit`]: the
/// predefined item terminates the app without telling anyone.
pub fn install_menu(app: &AppHandle) -> tauri::Result<()> {
    let menu = Menu::default(app)?;
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
        // macOS puts Quit last in the application menu.
        if let Some(MenuItemKind::Predefined(quit)) = app_menu.items()?.last() {
            app_menu.remove(quit)?;
            let label = format!("Quit {}", app.package_info().name);
            app_menu.append(&MenuItem::with_id(app, QUIT_MENU_ID, label, true, Some("CmdOrCtrl+Q"))?)?;
        }
    }
    app.set_menu(menu)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_in_flight_means_no_question() {
        assert_eq!(quit_question(0), None);
    }

    #[test]
    fn the_question_counts_the_downloads() {
        assert!(quit_question(1).unwrap().starts_with("1 download is"));
        assert!(quit_question(3).unwrap().starts_with("3 downloads are"));
    }

    #[test]
    fn only_one_question_at_a_time() {
        let gate = OneAtATime::default();
        assert!(gate.enter());
        assert!(!gate.enter());
        gate.leave();
        assert!(gate.enter());
    }
}
