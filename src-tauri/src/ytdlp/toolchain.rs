//! Finding yt-dlp and the programs it leans on.
//!
//! An app opened from Finder does not inherit the shell's PATH: it gets
//! `/usr/bin:/bin:/usr/sbin:/sbin`, which has none of Homebrew, `~/.local/bin`
//! or `uv tool` installs. So every binary is looked up in the usual install
//! locations too, and the absolute paths are handed to yt-dlp explicitly
//! (`--ffmpeg-location`, `--js-runtimes deno:<path>`). Without deno, YouTube
//! downloads fail on the signature challenge; without ffmpeg, video and audio
//! cannot be merged.

use std::path::{Path, PathBuf};

/// Absolute paths of the external programs, resolved once at startup.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Toolchain {
    pub ytdlp: Option<PathBuf>,
    pub ffmpeg: Option<PathBuf>,
    pub deno: Option<PathBuf>,
}

impl Toolchain {
    /// Look everything up from the real environment.
    pub fn detect() -> Self {
        let dirs = search_dirs(std::env::var_os("PATH"), std::env::var_os("HOME"));
        Self {
            ytdlp: override_path("YTDLP_PATH").or_else(|| find_in("yt-dlp", &dirs)),
            ffmpeg: find_in("ffmpeg", &dirs),
            deno: find_in("deno", &dirs),
        }
    }

    /// The yt-dlp to run. Falls back to the bare name so the spawn error
    /// ("No such file or directory") reaches the user instead of a panic.
    pub fn ytdlp_program(&self) -> PathBuf {
        self.ytdlp.clone().unwrap_or_else(|| PathBuf::from("yt-dlp"))
    }

    /// A yt-dlp command with [`Self::common_args`] already applied. Every
    /// download and info call goes through this, so none can forget the
    /// ffmpeg and deno pinning.
    pub fn command(&self) -> tokio::process::Command {
        let mut command = tokio::process::Command::new(self.ytdlp_program());
        command.args(self.common_args());
        command
    }

    /// Arguments every yt-dlp invocation gets, whatever it is for.
    pub fn common_args(&self) -> Vec<String> {
        let mut args = vec!["--no-update".to_string()];
        if let Some(ffmpeg) = &self.ffmpeg {
            args.push("--ffmpeg-location".into());
            args.push(ffmpeg.display().to_string());
        }
        if let Some(deno) = &self.deno {
            args.push("--js-runtimes".into());
            args.push(format!("deno:{}", deno.display()));
        }
        args
    }
}

fn override_path(var: &str) -> Option<PathBuf> {
    std::env::var_os(var)
        .map(PathBuf::from)
        .filter(|path| is_executable(path))
}

/// PATH first (respects the user's choice when launched from a terminal),
/// then the places installers put things on macOS.
pub fn search_dirs(
    path_var: Option<std::ffi::OsString>,
    home: Option<std::ffi::OsString>,
) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = path_var
        .map(|raw| std::env::split_paths(&raw).collect())
        .unwrap_or_default();
    if let Some(home) = home {
        let home = PathBuf::from(home);
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join(".deno/bin"));
    }
    for fixed in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin"] {
        dirs.push(PathBuf::from(fixed));
    }
    dirs
}

pub fn find_in(name: &str, dirs: &[PathBuf]) -> Option<PathBuf> {
    dirs.iter()
        .map(|dir| dir.join(name))
        .find(|candidate| is_executable(candidate))
}

fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

/// `yt-dlp --version`, or None when it cannot run.
pub async fn ytdlp_version(toolchain: &Toolchain) -> Option<String> {
    let output = tokio::process::Command::new(toolchain.ytdlp_program())
        .arg("--version")
        .output()
        .await
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::fixtures::temp_dir;
    use std::os::unix::fs::PermissionsExt;

    fn touch(path: &Path, mode: u32) {
        std::fs::write(path, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).unwrap();
    }

    #[test]
    fn finds_the_first_executable_and_skips_plain_files() {
        let first = temp_dir("tool-a");
        let second = temp_dir("tool-b");
        touch(&first.join("yt-dlp"), 0o644);
        touch(&second.join("yt-dlp"), 0o755);
        let dirs = vec![first.clone(), second.clone()];
        assert_eq!(find_in("yt-dlp", &dirs), Some(second.join("yt-dlp")));
        assert_eq!(find_in("ffmpeg", &dirs), None);
        let _ = std::fs::remove_dir_all(first);
        let _ = std::fs::remove_dir_all(second);
    }

    #[test]
    fn finder_launches_still_search_homebrew_and_local_bin() {
        let dirs = search_dirs(Some("/usr/bin:/bin".into()), Some("/Users/me".into()));
        assert_eq!(dirs[0], PathBuf::from("/usr/bin"));
        assert!(dirs.contains(&PathBuf::from("/Users/me/.local/bin")));
        assert!(dirs.contains(&PathBuf::from("/opt/homebrew/bin")));
    }

    #[test]
    fn common_args_pin_ffmpeg_and_deno_when_found() {
        let none = Toolchain::default();
        assert_eq!(none.common_args(), vec!["--no-update"]);

        let full = Toolchain {
            ytdlp: None,
            ffmpeg: Some("/opt/homebrew/bin/ffmpeg".into()),
            deno: Some("/opt/homebrew/bin/deno".into()),
        };
        assert_eq!(
            full.common_args(),
            vec![
                "--no-update",
                "--ffmpeg-location",
                "/opt/homebrew/bin/ffmpeg",
                "--js-runtimes",
                "deno:/opt/homebrew/bin/deno",
            ]
        );
    }
}
