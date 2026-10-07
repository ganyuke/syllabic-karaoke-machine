//! Reading and writing project files, plus the autosave location.

use crate::model::{EmbeddedAudio, ProjectFile, APP_ID};
use base64::Engine as _;
use std::path::{Path, PathBuf};

pub struct Loaded {
    pub file: ProjectFile,
    /// Audio bytes that were embedded in the file, if any.
    pub embedded: Option<(Vec<u8>, String)>,
}

pub fn read_project(path: &Path) -> Result<Loaded, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    parse_project(&text)
}

pub fn parse_project(text: &str) -> Result<Loaded, String> {
    let value: serde_json::Value = serde_json::from_str(text).map_err(|e| format!("Not a project file: {e}"))?;
    // Older exports put the project at the top level.
    let value = if value.get("project").is_some() {
        value
    } else {
        serde_json::json!({ "project": value })
    };
    let file: ProjectFile = serde_json::from_value(value).map_err(|e| format!("Not a project file: {e}"))?;
    if !file.app_id.is_empty() && file.app_id != APP_ID {
        return Err("This file was made by a different app".into());
    }
    let embedded = match &file.audio {
        Some(audio) if !audio.data_url.is_empty() => {
            let bytes = decode_data_url(&audio.data_url)?;
            Some((bytes, audio.name.clone()))
        }
        _ => None,
    };
    Ok(Loaded { file, embedded })
}

fn decode_data_url(url: &str) -> Result<Vec<u8>, String> {
    let (_, data) = url.split_once(',').ok_or("Embedded audio is damaged")?;
    base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .map_err(|e| format!("Embedded audio is damaged: {e}"))
}

pub fn encode_audio(bytes: &[u8], name: &str, mime: &str) -> EmbeddedAudio {
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    EmbeddedAudio {
        data_url: format!("data:{mime};base64,{encoded}"),
        name: name.to_string(),
        kind: mime.to_string(),
    }
}

pub fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("flac") => "audio/flac",
        Some("ogg") | Some("oga") => "audio/ogg",
        Some("m4a") | Some("mp4") | Some("aac") => "audio/mp4",
        Some("mka") | Some("webm") => "audio/webm",
        _ => "audio/*",
    }
}

pub fn write_project(path: &Path, file: &ProjectFile) -> Result<(), String> {
    let text = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("Could not write {}: {e}", path.display()))
}

pub fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_' | ' ' | '.') { c } else { '_' })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() { "karaoke-project".into() } else { trimmed.to_string() }
}

pub fn data_dir() -> Option<PathBuf> {
    let base = if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
    }?;
    let dir = base.join("syllabic-karaoke-machine");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// Keeps a copy of audio that arrived inside a project file, so the next launch can find it.
pub fn cache_audio(bytes: &[u8], name: &str) -> Option<PathBuf> {
    let dir = data_dir()?.join("audio");
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join(format!("{}-{}", bytes.len(), sanitize_filename(name)));
    if std::fs::metadata(&path).map(|m| m.len() != bytes.len() as u64).unwrap_or(true) {
        std::fs::write(&path, bytes).ok()?;
    }
    Some(path)
}

pub fn autosave_path() -> Option<PathBuf> {
    data_dir().map(|d| d.join("autosave.json"))
}

/// UTC timestamp in the same shape the browser writes (`2026-05-03T03:05:13.055Z`).
pub fn iso_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    iso_from(now.as_secs() as i64, now.subsec_millis())
}

/// When this program was built, e.g. `2026-10-07 17:40 UTC`.
pub fn build_stamp() -> String {
    let secs: i64 = env!("SKM_BUILD_SECS").parse().unwrap_or(0);
    let iso = iso_from(secs, 0);
    format!("{} {} UTC", &iso[..10], &iso[11..16])
}

fn iso_from(secs: i64, millis: u32) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_shape() {
        let s = iso_now();
        assert_eq!(s.len(), 24);
        assert!(s.ends_with('Z') && &s[10..11] == "T");
    }

    #[test]
    fn data_url_roundtrip() {
        let audio = encode_audio(b"hello", "a.mp3", "audio/mpeg");
        assert_eq!(decode_data_url(&audio.data_url).unwrap(), b"hello");
    }

    #[test]
    fn demo_project_loads() {
        let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../examples/demo.json"));
        let Ok(text) = text else { return };
        let loaded = parse_project(&text).unwrap();
        assert!(!loaded.file.project.structure.is_empty());
        assert!(loaded.file.project.settings.keybinds.contains_key("tapTiming"));
    }
}
