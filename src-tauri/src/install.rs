//! How this copy of Markpion got onto the computer, read from a marker file
//! next to the executable:
//!
//! * **Portable** (`portable.txt`, from the portable `.zip`): nothing is
//!   installed. Settings, recent files, File History, recovery, logs and the
//!   web view's storage live in a `data` folder beside the executable, so the
//!   folder can sit on a USB stick or a network drive and leaves nothing in
//!   the user's profile. It doesn't update itself: it points to the download.
//! * **Per-user** (`per-user-install`, written by the installer that never
//!   asks for administrator rights): updates come from that same installer,
//!   so an update never asks either.
//! * **Standard**: the installer that offers "everyone" or "only me".

use serde::Serialize;
use std::path::{Path, PathBuf};

pub const PORTABLE_MARKER: &str = "portable.txt";
pub const PER_USER_MARKER: &str = "per-user-install";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallKind {
    Standard,
    PerUser,
    Portable,
}

/// The kind of copy whose executable is in `exe_dir`.
pub fn detect(exe_dir: &Path) -> InstallKind {
    if exe_dir.join(PORTABLE_MARKER).is_file() {
        InstallKind::Portable
    } else if exe_dir.join(PER_USER_MARKER).is_file() {
        InstallKind::PerUser
    } else {
        InstallKind::Standard
    }
}

/// The portable copy's data folder, created if needed; `None` when it can't be
/// written to (a read-only share or disc), in which case the copy behaves like
/// an installed one and uses the user's profile.
pub fn portable_data_dir(exe_dir: &Path) -> Option<PathBuf> {
    let dir = exe_dir.join("data");
    std::fs::create_dir_all(&dir).ok()?;
    let probe = dir.join(".write-test");
    std::fs::write(&probe, b"").ok()?;
    let _ = std::fs::remove_file(&probe);
    Some(dir)
}

/// The key of this copy's updates in the update manifest, when it isn't the
/// platform's default one.
pub fn updater_target(kind: InstallKind, os: &str, arch: &str) -> Option<String> {
    (kind == InstallKind::PerUser && os == "windows").then(|| format!("windows-{arch}-user"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_kind_from_the_marker_next_to_the_executable() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(detect(dir.path()), InstallKind::Standard);
        std::fs::write(dir.path().join(PER_USER_MARKER), "").unwrap();
        assert_eq!(detect(dir.path()), InstallKind::PerUser);
        // A portable copy stays portable whatever else is in its folder.
        std::fs::write(dir.path().join(PORTABLE_MARKER), "Portable copy").unwrap();
        assert_eq!(detect(dir.path()), InstallKind::Portable);
        // A folder with the marker's name isn't a marker.
        let other = tempfile::tempdir().unwrap();
        std::fs::create_dir(other.path().join(PORTABLE_MARKER)).unwrap();
        assert_eq!(detect(other.path()), InstallKind::Standard);
    }

    #[test]
    fn keeps_portable_data_beside_the_executable_when_it_can_write_there() {
        let dir = tempfile::tempdir().unwrap();
        let data = portable_data_dir(dir.path()).unwrap();
        assert_eq!(data, dir.path().join("data"));
        assert!(data.is_dir());
        assert_eq!(std::fs::read_dir(&data).unwrap().count(), 0, "the write test leaves nothing behind");
        // Where no folder can be made (the path is a file), there's no portable data.
        let file = dir.path().join("not-a-folder");
        std::fs::write(&file, "").unwrap();
        assert_eq!(portable_data_dir(&file), None);
    }

    #[test]
    fn only_the_per_user_windows_install_has_its_own_updates() {
        assert_eq!(updater_target(InstallKind::PerUser, "windows", "x86_64").as_deref(), Some("windows-x86_64-user"));
        assert_eq!(updater_target(InstallKind::PerUser, "windows", "aarch64").as_deref(), Some("windows-aarch64-user"));
        assert_eq!(updater_target(InstallKind::Standard, "windows", "x86_64"), None);
        assert_eq!(updater_target(InstallKind::Portable, "windows", "x86_64"), None);
        assert_eq!(updater_target(InstallKind::PerUser, "linux", "x86_64"), None);
    }
}
