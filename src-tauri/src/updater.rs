//! In-app updates (UPD-001..006) through `tauri-plugin-updater`.
//!
//! The update manifest (`latest.json`) and installer come from the project's
//! latest GitHub Release. Every download is verified against the minisign
//! public key in `tauri.conf.json` before anything runs; an unsigned or
//! tampered installer is rejected. On Windows the verified NSIS installer
//! replaces the installed version in place and restarts the app.
//! These are app commands, so the frontend needs no updater permissions.

use crate::commands::AppState;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::UpdaterExt;

pub const UPDATE_PROGRESS_EVENT: &str = "update-progress";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProgress {
    downloaded: u64,
    total: Option<u64>,
}

fn updater_error(e: impl std::fmt::Display) -> AppError {
    AppError::Io(format!("Update failed: {e}"))
}

/// A portable copy has nothing to install over: the app points to the download instead.
fn refuse_portable(state: &AppState) -> AppResult<()> {
    if state.install == crate::install::InstallKind::Portable {
        return Err(AppError::NotFound("A portable copy doesn't update itself. Download the new version and replace this folder's files.".into()));
    }
    Ok(())
}

async fn find_update(app: &AppHandle, state: &AppState) -> AppResult<Option<tauri_plugin_updater::Update>> {
    refuse_portable(state)?;
    // The per-user install has its own installer in the manifest, which never asks for elevation.
    let updater = match crate::install::updater_target(state.install, std::env::consts::OS, std::env::consts::ARCH) {
        Some(target) => app.updater_builder().target(target).build(),
        None => app.updater(),
    };
    updater.map_err(updater_error)?.check().await.map_err(updater_error)
}

/// Returns the newer version published on GitHub, if there is one.
#[tauri::command]
pub async fn check_app_update(app: AppHandle, state: State<'_, AppState>) -> AppResult<Option<UpdateInfo>> {
    let update = state.track("update.check", find_update(&app, &state).await)?;
    Ok(update.map(|u| UpdateInfo {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    }))
}

/// Downloads, verifies and installs the latest version, reporting progress as
/// `update-progress` events. On Windows the installer takes over and the app
/// exits; if anything fails before that, the current version keeps running.
#[tauri::command]
pub async fn install_app_update(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let update = state
        .track("update.check", find_update(&app, &state).await)?
        .ok_or_else(|| AppError::NotFound("No update is available.".into()))?;
    state.logger.log("info", "update.install", &format!("{} -> {}", update.current_version, update.version));
    let mut downloaded: u64 = 0;
    let events = app.clone();
    let result = update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = events.emit(UPDATE_PROGRESS_EVENT, UpdateProgress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(updater_error);
    state.track("update.install", result)?;
    // Windows exits inside download_and_install; other platforms restart here.
    app.restart();
}
