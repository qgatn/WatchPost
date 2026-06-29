//! Locate MobaXterm.exe on Windows (saved path, common installs, registry).

use std::path::{Path, PathBuf};

fn mobaxterm_exe_name(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.eq_ignore_ascii_case("MobaXterm.exe"))
}

pub fn mobaxterm_exe_valid(path: &Path) -> bool {
    mobaxterm_exe_name(path) && path.is_file()
}

/// Resolve MobaXterm.exe: user-saved path first, then auto-detect.
pub fn resolve_moba_xterm_path(saved: Option<&str>) -> Option<PathBuf> {
    if let Some(s) = saved {
        let trimmed = s.trim();
        if !trimmed.is_empty() {
            let path = PathBuf::from(trimmed);
            if mobaxterm_exe_valid(&path) {
                return Some(path);
            }
        }
    }
    for path in common_install_paths() {
        if mobaxterm_exe_valid(&path) {
            return Some(path);
        }
    }
    registry_mobaxterm_path()
}

fn common_install_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(pf) = std::env::var("ProgramFiles") {
        out.push(PathBuf::from(pf).join("MobaXterm").join("MobaXterm.exe"));
    }
    if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
        out.push(PathBuf::from(pf86).join("MobaXterm").join("MobaXterm.exe"));
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        out.push(
            PathBuf::from(local)
                .join("Programs")
                .join("MobaXterm")
                .join("MobaXterm.exe"),
        );
    }
    if let Ok(pd) = std::env::var("ProgramData") {
        let tools_dir = PathBuf::from(&pd)
            .join("chocolatey")
            .join("lib")
            .join("mobaxterm")
            .join("tools");
        let tools_exe = tools_dir.join("MobaXterm.exe");
        out.push(tools_exe);
        if tools_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&tools_dir) {
                for entry in entries.flatten() {
                    out.push(entry.path().join("MobaXterm.exe"));
                }
            }
        }
    }
    out
}

fn parse_exe_from_display_value(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim().trim_matches('"');
    if trimmed.is_empty() {
        return None;
    }
    let exe = trimmed.split(',').next()?.trim();
    let path = PathBuf::from(exe);
    if mobaxterm_exe_name(&path) {
        Some(path)
    } else {
        None
    }
}

fn registry_mobaxterm_path() -> Option<PathBuf> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    for subkey_path in [
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ] {
        let Ok(uninstall) = hklm.open_subkey(subkey_path) else {
            continue;
        };
        for name in uninstall.enum_keys().filter_map(Result::ok) {
            let Ok(app_key) = uninstall.open_subkey(&name) else {
                continue;
            };
            let display_name: String = app_key.get_value("DisplayName").unwrap_or_default();
            if !display_name.to_ascii_lowercase().starts_with("mobaxterm") {
                continue;
            }
            if let Ok(icon) = app_key.get_value::<String, _>("DisplayIcon") {
                if let Some(path) = parse_exe_from_display_value(&icon) {
                    return Some(path);
                }
            }
            if let Ok(loc) = app_key.get_value::<String, _>("InstallLocation") {
                let trimmed = loc.trim().trim_matches('"');
                if !trimmed.is_empty() {
                    let path = PathBuf::from(trimmed).join("MobaXterm.exe");
                    if mobaxterm_exe_valid(&path) {
                        return Some(path);
                    }
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mobaxterm_exe_name_checks_filename() {
        assert!(mobaxterm_exe_name(Path::new(r"C:\Apps\MobaXterm.exe")));
        assert!(!mobaxterm_exe_name(Path::new(r"C:\Apps\putty.exe")));
    }

    #[test]
    fn parse_display_icon_strips_index_suffix() {
        let p = parse_exe_from_display_value(r"C:\Program Files\MobaXterm\MobaXterm.exe,0");
        assert_eq!(
            p,
            Some(PathBuf::from(r"C:\Program Files\MobaXterm\MobaXterm.exe"))
        );
    }
}
