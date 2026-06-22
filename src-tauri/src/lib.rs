mod mic_monitor;
mod recorder;
pub mod transcriber;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub id: String,
    pub name: String,
    pub role: String,
    pub email: String,
    pub department: String,
    pub manager_id: Option<String>,
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub company_id: Option<String>,
    #[serde(default)]
    pub is_contact: bool,
    #[serde(default)]
    pub ai_profile: Option<AIPersonProfile>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AIPersonProfile {
    pub content: String,
    pub generated_at: String,
    pub model: String,
    #[serde(default)]
    pub source_note_count: u32,
    #[serde(default)]
    pub source_summary_count: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Company {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub r#type: String,
    #[serde(default)]
    pub sector: String,
    #[serde(default)]
    pub size_label: String,
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub subtitle: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: String,
    pub people_ids: Vec<String>,
    /// "em-andamento" | "quase-la" | "pausado" | "concluido" | "ideacao"
    #[serde(default)]
    pub status: String,
    /// ISO timestamp da última atualização (mantido pelo frontend)
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub ai_summary: Option<AIProjectSummary>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AIProjectSummary {
    pub content: String,
    pub generated_at: String,
    pub model: String,
    #[serde(default)]
    pub source_note_count: u32,
    #[serde(default)]
    pub source_summary_count: u32,
    #[serde(default)]
    pub source_task_count: u32,
    #[serde(default)]
    pub source_people_count: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: String,
    pub template_id: Option<String>,
    pub template_name: String,
    pub content: String,
    pub generated_at: String,
    pub model: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub date: String,
    /// Timestamp ISO da última edição — usado para "notas recentes" (vazio se ausente).
    #[serde(default)]
    pub updated_at: String,
    pub project_id: Option<String>,
    pub people_ids: Vec<String>,
    #[serde(default)]
    pub summaries: Vec<Summary>,
    #[serde(default)]
    pub transcript: String,
    /// Transcrição só do microfone (o que VOCÊ falou) — base para "meus" itens de ação.
    #[serde(default)]
    pub self_transcript: String,
    /// Nome do arquivo de áudio (relativo a files/audio/) — vazio se não houver
    #[serde(default)]
    pub audio_file: String,
    /// Nome do sidecar mono do microfone (`*.mic.mp3`), enquanto existir em disco.
    #[serde(default)]
    pub mic_file: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub completed: bool,
    pub due_date: String,
    pub project_id: Option<String>,
    pub person_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub avatar_url: Option<String>,
    /// Apelidos/variações de como te chamam nas reuniões.
    #[serde(default)]
    pub aliases: Vec<String>,
    /// Descrição livre das suas áreas/atividades — desempate p/ itens implícitos.
    #[serde(default)]
    pub responsibilities: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct OllamaSettings {
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub language: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SummaryTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub sections: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Database {
    pub people: Vec<Person>,
    pub projects: Vec<Project>,
    pub notes: Vec<Note>,
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub companies: Vec<Company>,
    #[serde(default)]
    pub settings: OllamaSettings,
    #[serde(default)]
    pub templates: Vec<SummaryTemplate>,
    #[serde(default)]
    pub hyprnote_path: String,
    #[serde(default)]
    pub profile: Option<UserProfile>,
    /// "batch" (padrão/vazio) ou "realtime" — transcrição ao vivo durante a gravação.
    #[serde(default)]
    pub transcription_mode: String,
    #[serde(default)]
    pub s3_schedule: String,
    #[serde(default)]
    pub s3_last_backup_at: String,
    #[serde(default)]
    pub s3_retention: u32,
    /// Horário do dia (HH:MM) do backup automático; vazio = padrão "03:00" no front.
    #[serde(default)]
    pub s3_backup_time: String,
    #[serde(default)]
    pub hyprnote_schedule: String,
    #[serde(default)]
    pub hyprnote_last_import_at: String,
    #[serde(default)]
    pub audio_cleanup_age: String,
    #[serde(default)]
    pub audio_cleanup_schedule: String,
    #[serde(default)]
    pub audio_cleanup_last_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportedHyprnoteSession {
    pub folder_name: String,
    pub meta_json: Option<String>,
    pub memo_md: Option<String>,
    pub transcript_json: Option<String>,
    /// Lista de (nome_arquivo, conteúdo) dos arquivos .md que não começam com "_"
    pub summary_files: Vec<(String, String)>,
    /// Caminho absoluto para o arquivo de áudio da sessão (audio.mp3/wav/...) — se existir
    pub audio_path: Option<String>,
    /// Extensão (sem ponto) do áudio encontrado — útil pra montar o nome de destino
    pub audio_ext: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default)]
    pub data_root: Option<String>,
}

fn get_default_data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn get_app_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = get_default_data_root(app)?;
    path.push(".config.json");
    Ok(path)
}

fn read_app_config(app: &AppHandle) -> AppConfig {
    let cfg_path = match get_app_config_path(app) {
        Ok(p) => p,
        Err(_) => return AppConfig::default(),
    };
    if !cfg_path.exists() {
        return AppConfig::default();
    }
    match fs::read_to_string(&cfg_path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => AppConfig::default(),
    }
}

fn write_app_config(app: &AppHandle, cfg: &AppConfig) -> Result<(), String> {
    let cfg_path = get_app_config_path(app)?;
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(cfg_path, json).map_err(|e| e.to_string())
}

fn get_data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let cfg = read_app_config(app);
    if let Some(custom) = cfg.data_root.as_ref().filter(|s| !s.trim().is_empty()) {
        let p = PathBuf::from(custom);
        fs::create_dir_all(&p).map_err(|e| e.to_string())?;
        return Ok(p);
    }
    get_default_data_root(app)
}

fn get_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = get_data_root(app)?;
    path.push("db.json");
    Ok(path)
}

fn get_initial_database() -> Database {
    // O app inicia com banco vazio; cada tela tem seu proprio empty state.
    // Mantemos apenas configuracao generica (Ollama local) e um template de
    // resumo padrao -- nenhum dado pessoal.
    let settings = OllamaSettings {
        url: "http://localhost:11434".to_string(),
        model: "llama3.2".to_string(),
        language: "pt-BR".to_string(),
    };

    let templates = vec![SummaryTemplate {
        id: "tpl-default".to_string(),
        name: "Sumário Executivo".to_string(),
        description: "Resumo geral de reuniões".to_string(),
        sections: vec![
            "Resumo".to_string(),
            "Pontos-chave".to_string(),
            "Próximos passos".to_string(),
        ],
    }];

    Database {
        people: Vec::new(),
        projects: Vec::new(),
        notes: Vec::new(),
        tasks: Vec::new(),
        companies: Vec::new(),
        settings,
        templates,
        hyprnote_path: String::new(),
        profile: None,
        transcription_mode: String::new(),
        s3_schedule: String::new(),
        s3_last_backup_at: String::new(),
        s3_retention: 0,
        s3_backup_time: String::new(),
        hyprnote_schedule: String::new(),
        hyprnote_last_import_at: String::new(),
        audio_cleanup_age: String::new(),
        audio_cleanup_schedule: String::new(),
        audio_cleanup_last_at: String::new(),
    }
}

#[tauri::command]
fn load_db(app: AppHandle) -> Result<Database, String> {
    let db_path = get_db_path(&app)?;
    if !db_path.exists() {
        let initial_db = get_initial_database();
        let json = serde_json::to_string_pretty(&initial_db).map_err(|e| e.to_string())?;
        fs::write(&db_path, json).map_err(|e| e.to_string())?;
        return Ok(initial_db);
    }
    let content = fs::read_to_string(&db_path).map_err(|e| e.to_string())?;
    let db: Database = match serde_json::from_str(&content) {
        Ok(db) => db,
        Err(_) => {
            // Backup corrupted db and recreate
            let backup_path = db_path.with_extension("json.bak");
            let _ = fs::copy(&db_path, backup_path);
            let initial_db = get_initial_database();
            if let Ok(json) = serde_json::to_string_pretty(&initial_db) {
                let _ = fs::write(&db_path, json);
            }
            initial_db
        }
    };
    Ok(db)
}

#[tauri::command]
fn save_db(app: AppHandle, data: Database) -> Result<(), String> {
    let db_path = get_db_path(&app)?;
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(db_path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_db_dir(app: AppHandle) -> Result<String, String> {
    let path = get_data_root(&app)?;
    Ok(path.to_string_lossy().to_string())
}

fn get_files_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = get_data_root(app)?;
    path.push("files");
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn get_audio_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = get_data_root(app)?;
    path.push("files");
    path.push("audio");
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn is_safe_filename(name: &str) -> bool {
    if name.is_empty() || name.len() > 255 {
        return false;
    }
    let bad = ['/', '\\', '\0', '<', '>', ':', '"', '|', '?', '*'];
    if name.chars().any(|c| bad.contains(&c) || c.is_control()) {
        return false;
    }
    if name.contains("..") || name.starts_with('.') {
        return false;
    }
    let reserved = [
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let base = name.split('.').next().unwrap_or("").to_uppercase();
    if reserved.contains(&base.as_str()) {
        return false;
    }
    true
}

#[tauri::command]
fn save_image(app: AppHandle, data: Vec<u8>, ext: String) -> Result<String, String> {
    const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
    if data.is_empty() {
        return Err("Imagem vazia".to_string());
    }
    if data.len() > MAX_IMAGE_BYTES {
        return Err(format!(
            "Imagem grande demais ({} bytes; máximo {} MB)",
            data.len(),
            MAX_IMAGE_BYTES / 1024 / 1024
        ));
    }
    let files_dir = get_files_dir(&app)?;

    let safe_ext: String = ext
        .trim_start_matches('.')
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect();
    let safe_ext = safe_ext.to_lowercase();
    let allowed = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
    let safe_ext = if allowed.contains(&safe_ext.as_str()) {
        safe_ext
    } else {
        "png".to_string()
    };

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let filename = format!("img-{}.{}", nanos, safe_ext);

    let mut file_path = files_dir;
    file_path.push(&filename);
    fs::write(&file_path, &data).map_err(|e| e.to_string())?;

    Ok(filename)
}

#[tauri::command]
fn read_image(app: AppHandle, filename: String) -> Result<Vec<u8>, String> {
    if !is_safe_filename(&filename) {
        return Err("Invalid filename".to_string());
    }
    let mut file_path = get_files_dir(&app)?;
    file_path.push(&filename);
    fs::read(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_import_log(app: AppHandle, content: String) -> Result<String, String> {
    let mut path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    path.push("import.log");
    // truncate + write — sempre reseta para evitar crescimento ilimitado
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn scan_hyprnote_sessions(path: String) -> Result<Vec<ImportedHyprnoteSession>, String> {
    let root = PathBuf::from(&path);
    if !root.exists() {
        return Err(format!("Pasta não existe: {}", path));
    }
    if !root.is_dir() {
        return Err(format!("Caminho não é um diretório: {}", path));
    }

    let mut sessions: Vec<ImportedHyprnoteSession> = Vec::new();
    let entries = fs::read_dir(&root).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let folder_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        // ignora pastas começadas em "." (hidden)
        if folder_name.starts_with('.') {
            continue;
        }

        let mut meta_json: Option<String> = None;
        let mut memo_md: Option<String> = None;
        let mut transcript_json: Option<String> = None;
        let mut summary_files: Vec<(String, String)> = Vec::new();
        let mut audio_path: Option<String> = None;
        let mut audio_ext: Option<String> = None;

        let inner = match fs::read_dir(&path) {
            Ok(it) => it,
            Err(_) => continue,
        };
        for inner_entry in inner {
            let inner_entry = match inner_entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let inner_path = inner_entry.path();
            if !inner_path.is_file() {
                continue;
            }
            let fname = match inner_path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            match fname.as_str() {
                "_meta.json" => {
                    meta_json = fs::read_to_string(&inner_path).ok();
                }
                "_memo.md" => {
                    memo_md = fs::read_to_string(&inner_path).ok();
                }
                "transcript.json" => {
                    transcript_json = fs::read_to_string(&inner_path).ok();
                }
                _ => {
                    let lower = fname.to_lowercase();
                    // áudio da sessão (gravação) — preferimos audio.* mas aceitamos outros
                    // áudios comuns caso o usuário tenha renomeado.
                    let is_audio = (lower.starts_with("audio.")
                        && (lower.ends_with(".mp3")
                            || lower.ends_with(".wav")
                            || lower.ends_with(".m4a")
                            || lower.ends_with(".ogg")
                            || lower.ends_with(".webm")
                            || lower.ends_with(".flac")))
                        && audio_path.is_none();
                    if is_audio {
                        let ext = lower.rsplit('.').next().unwrap_or("mp3").to_string();
                        audio_ext = Some(ext);
                        audio_path = Some(inner_path.to_string_lossy().to_string());
                    } else if lower.ends_with(".md") && !fname.starts_with('_') {
                        // qualquer outro arquivo .md que NÃO começa com '_' é considerado sumário
                        if let Ok(content) = fs::read_to_string(&inner_path) {
                            summary_files.push((fname, content));
                        }
                    }
                }
            }
        }

        // Só inclui pasta que tenha pelo menos _meta.json OU _memo.md OU algum sumário
        if meta_json.is_some()
            || memo_md.is_some()
            || !summary_files.is_empty()
            || transcript_json.is_some()
            || audio_path.is_some()
        {
            sessions.push(ImportedHyprnoteSession {
                folder_name,
                meta_json,
                memo_md,
                transcript_json,
                summary_files,
                audio_path,
                audio_ext,
            });
        }
    }

    Ok(sessions)
}

#[tauri::command]
fn import_audio_file(
    app: AppHandle,
    source_path: String,
    dest_filename: String,
) -> Result<String, String> {
    if !is_safe_filename(&dest_filename) {
        return Err("Invalid dest_filename".to_string());
    }
    let src = PathBuf::from(&source_path);
    if !src.exists() || !src.is_file() {
        return Err(format!("Áudio não encontrado: {}", source_path));
    }
    let audio_dir = get_audio_dir(&app)?;
    let mut dest = audio_dir;
    dest.push(&dest_filename);
    fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(dest_filename)
}

#[tauri::command]
fn get_audio_path(app: AppHandle, filename: String) -> Result<String, String> {
    if !is_safe_filename(&filename) {
        return Err("Invalid filename".to_string());
    }
    let mut file_path = get_audio_dir(&app)?;
    file_path.push(&filename);
    if !file_path.exists() {
        return Err(format!("Áudio não encontrado: {}", filename));
    }
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
fn read_audio(app: AppHandle, filename: String) -> Result<Vec<u8>, String> {
    if !is_safe_filename(&filename) {
        return Err("Invalid filename".to_string());
    }
    let mut file_path = get_audio_dir(&app)?;
    file_path.push(&filename);
    fs::read(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_audios(app: AppHandle, filenames: Vec<String>) -> Result<(), String> {
    let audio_dir = get_audio_dir(&app)?;
    for filename in filenames {
        if !is_safe_filename(&filename) {
            continue;
        }
        let mut file_path = audio_dir.clone();
        file_path.push(&filename);
        let _ = fs::remove_file(&file_path);
        // Remove também os sidecars mono por canal (microfone e sistema), se existirem.
        for sidecar in [
            crate::recorder::mic_sidecar_name(&filename),
            crate::recorder::sys_sidecar_name(&filename),
        ] {
            if sidecar != filename {
                let _ = fs::remove_file(audio_dir.join(&sidecar));
            }
        }
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AudioCleanupResult {
    pub deleted: Vec<String>,
    pub bytes_freed: u64,
    pub errors: Vec<String>,
}

#[tauri::command]
fn cleanup_old_audios(app: AppHandle, months: u32) -> Result<AudioCleanupResult, String> {
    let mut result = AudioCleanupResult::default();
    let audio_dir = get_audio_dir(&app)?;
    if !audio_dir.exists() {
        return Ok(result);
    }
    let months = months.max(1);
    let threshold_secs: u64 = months as u64 * 30 * 24 * 60 * 60;
    let now = std::time::SystemTime::now();

    let entries = match fs::read_dir(&audio_dir) {
        Ok(e) => e,
        Err(e) => return Err(format!("Falha ao ler diretório de áudios: {}", e)),
    };
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                result.errors.push(e.to_string());
                continue;
            }
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let metadata = match fs::metadata(&path) {
            Ok(m) => m,
            Err(e) => {
                result.errors.push(format!("{}: {}", path.display(), e));
                continue;
            }
        };
        let modified = match metadata.modified() {
            Ok(m) => m,
            Err(e) => {
                result.errors.push(format!("{}: {}", path.display(), e));
                continue;
            }
        };
        let age_secs = match now.duration_since(modified) {
            Ok(d) => d.as_secs(),
            Err(_) => continue,
        };
        if age_secs < threshold_secs {
            continue;
        }
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let size = metadata.len();
        match fs::remove_file(&path) {
            Ok(_) => {
                result.bytes_freed += size;
                result.deleted.push(name);
            }
            Err(e) => result.errors.push(format!("{}: {}", path.display(), e)),
        }
    }
    Ok(result)
}

fn collect_files_recursive(
    dir: &PathBuf,
    base: &PathBuf,
    out: &mut Vec<(String, PathBuf)>,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let rel = path.strip_prefix(base).map_err(|e| e.to_string())?;
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        if path.is_dir() {
            collect_files_recursive(&path, base, out)?;
        } else if path.is_file() {
            out.push((rel_str, path));
        }
    }
    Ok(())
}

fn create_backup_internal(
    app: &AppHandle,
    dest_path: &str,
    emit_progress: bool,
) -> Result<(), String> {
    use std::io::Write;
    let data_root = get_data_root(app)?;
    let dest = PathBuf::from(dest_path);

    let mut files: Vec<(String, PathBuf)> = Vec::new();
    let db_path = data_root.join("db.json");
    if db_path.exists() {
        files.push(("db.json".to_string(), db_path));
    }
    let files_dir = data_root.join("files");
    if files_dir.exists() {
        collect_files_recursive(&files_dir, &data_root, &mut files)?;
    }
    let total = files.len() as u64;

    if emit_progress {
        let _ = app.emit(
            "s3-zip-started",
            serde_json::json!({ "total": total }),
        );
    }

    let file = fs::File::create(&dest).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mut last_emit = std::time::Instant::now();
    for (idx, (rel, path)) in files.iter().enumerate() {
        zip.start_file(rel.as_str(), opts)
            .map_err(|e| e.to_string())?;
        let content = fs::read(path).map_err(|e| e.to_string())?;
        zip.write_all(&content).map_err(|e| e.to_string())?;

        if emit_progress {
            let processed = (idx + 1) as u64;
            let now = std::time::Instant::now();
            let done = processed == total;
            if now.duration_since(last_emit).as_millis() >= 80 || done {
                let _ = app.emit(
                    "s3-zip-progress",
                    serde_json::json!({
                        "processed": processed,
                        "total": total,
                        "currentFile": rel,
                    }),
                );
                last_emit = now;
            }
        }
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn create_backup(app: AppHandle, dest_path: String) -> Result<(), String> {
    create_backup_internal(&app, &dest_path, false)
}

fn is_safe_zip_entry_name(name: &str) -> bool {
    use std::path::Component;
    let p = std::path::Path::new(name);
    if p.is_absolute() {
        return false;
    }
    for c in p.components() {
        match c {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return false,
            _ => {}
        }
    }
    true
}

#[tauri::command]
fn restore_backup(app: AppHandle, backup_path: String) -> Result<(), String> {
    let data_root = get_data_root(&app)?;
    let src = PathBuf::from(&backup_path);
    if !src.exists() {
        return Err(format!("Arquivo não encontrado: {}", backup_path));
    }
    let file = fs::File::open(&src).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let canonical_root = data_root.canonicalize().unwrap_or_else(|_| data_root.clone());
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if !is_safe_zip_entry_name(&name) {
            return Err(format!("Entrada inválida no backup: {}", name));
        }
        let out_path = data_root.join(&name);
        // Sanity check pós-join via parent canonicalizado (parent existe ou é criado abaixo)
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            let canonical_parent = parent.canonicalize().unwrap_or_else(|_| parent.to_path_buf());
            if !canonical_parent.starts_with(&canonical_root) {
                return Err(format!("Entrada fora do diretório de dados: {}", name));
            }
        }
        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            let mut out_file = fs::File::create(&out_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out_file).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DataRootInfo {
    pub current: String,
    pub default: String,
    pub is_custom: bool,
}

#[tauri::command]
fn get_data_root_info(app: AppHandle) -> Result<DataRootInfo, String> {
    let default = get_default_data_root(&app)?;
    let current = get_data_root(&app)?;
    let is_custom = current != default;
    Ok(DataRootInfo {
        current: current.to_string_lossy().to_string(),
        default: default.to_string_lossy().to_string(),
        is_custom,
    })
}

fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if from.is_file() {
            fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn set_data_root(
    app: AppHandle,
    path: Option<String>,
    migrate: bool,
) -> Result<DataRootInfo, String> {
    let source = get_data_root(&app)?;

    let new_root: PathBuf = match &path {
        Some(p) if !p.trim().is_empty() => {
            let pb = PathBuf::from(p);
            fs::create_dir_all(&pb).map_err(|e| e.to_string())?;
            if !pb.is_dir() {
                return Err(format!("Não é um diretório: {}", p));
            }
            pb
        }
        _ => get_default_data_root(&app)?,
    };

    if migrate && source != new_root {
        let src_db = source.join("db.json");
        if src_db.exists() {
            fs::copy(&src_db, new_root.join("db.json")).map_err(|e| e.to_string())?;
        }
        let src_files = source.join("files");
        if src_files.exists() {
            copy_dir_recursive(&src_files, &new_root.join("files"))?;
        }
    }

    let mut cfg = read_app_config(&app);
    cfg.data_root = match &path {
        Some(p) if !p.trim().is_empty() => Some(p.clone()),
        _ => None,
    };
    write_app_config(&app, &cfg)?;

    let audio_dir = new_root.join("files").join("audio");
    let _ = fs::create_dir_all(&audio_dir);
    let _ = app
        .asset_protocol_scope()
        .allow_directory(&audio_dir, true);

    get_data_root_info(app)
}

#[tauri::command]
fn delete_images(app: AppHandle, filenames: Vec<String>) -> Result<(), String> {
    let files_dir = get_files_dir(&app)?;
    for filename in filenames {
        if !is_safe_filename(&filename) {
            continue;
        }
        let mut file_path = files_dir.clone();
        file_path.push(&filename);
        let _ = fs::remove_file(&file_path);
    }
    Ok(())
}

// =====================================================================
// S3-compatible remote backup
// =====================================================================

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct S3Credentials {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub access_key: String,
    pub secret_key: String,
    #[serde(default)]
    pub prefix: String,
    #[serde(default)]
    pub path_style: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct S3BackupItem {
    pub key: String,
    pub size: u64,
    pub last_modified: String,
}

fn get_s3_creds_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_data_root(app)?.join(".s3-creds"))
}

fn build_bucket(c: &S3Credentials) -> Result<s3::bucket::Bucket, String> {
    use s3::creds::Credentials as AwsCreds;
    use s3::region::Region;

    if c.bucket.trim().is_empty() {
        return Err("Bucket vazio".to_string());
    }
    if c.access_key.trim().is_empty() || c.secret_key.trim().is_empty() {
        return Err("Credenciais S3 ausentes".to_string());
    }

    let region = if !c.endpoint.trim().is_empty() {
        Region::Custom {
            region: if c.region.trim().is_empty() {
                "us-east-1".to_string()
            } else {
                c.region.clone()
            },
            endpoint: c.endpoint.clone(),
        }
    } else {
        c.region
            .parse::<Region>()
            .map_err(|e| format!("Região inválida: {}", e))?
    };

    let creds = AwsCreds::new(
        Some(c.access_key.as_str()),
        Some(c.secret_key.as_str()),
        None,
        None,
        None,
    )
    .map_err(|e| e.to_string())?;

    let bucket = s3::bucket::Bucket::new(c.bucket.as_str(), region, creds)
        .map_err(|e| e.to_string())?;
    let bucket = if c.path_style {
        bucket.with_path_style()
    } else {
        bucket
    };
    Ok(bucket)
}

fn s3_key(prefix: &str, name: &str) -> String {
    let p = prefix.trim().trim_matches('/');
    if p.is_empty() {
        name.to_string()
    } else {
        format!("{}/{}", p, name)
    }
}

#[tauri::command]
fn save_s3_credentials(app: AppHandle, creds: S3Credentials) -> Result<(), String> {
    let path = get_s3_creds_path(&app)?;
    let json = serde_json::to_string_pretty(&creds).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[tauri::command]
fn load_s3_credentials(app: AppHandle) -> Result<Option<S3Credentials>, String> {
    let path = get_s3_creds_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let creds: S3Credentials = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(creds))
}

#[tauri::command]
fn clear_s3_credentials(app: AppHandle) -> Result<(), String> {
    let path = get_s3_creds_path(&app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn test_s3_connection(creds: S3Credentials) -> Result<u32, String> {
    let bucket = build_bucket(&creds)?;
    let prefix = creds.prefix.trim().trim_matches('/').to_string();
    let list = bucket
        .list(prefix, Some("/".to_string()))
        .await
        .map_err(|e| e.to_string())?;
    let count: usize = list.iter().map(|r| r.contents.len()).sum();
    Ok(count as u32)
}

#[tauri::command]
async fn backup_to_s3(
    app: AppHandle,
    creds: S3Credentials,
    retention: Option<u32>,
) -> Result<String, String> {
    use futures_util::StreamExt;
    use std::sync::{Arc, Mutex};
    use tokio_util::io::ReaderStream;

    let ts = chrono_like_timestamp();
    let filename = format!("titus-notes-backup-{}.zip", ts);
    let tmp = std::env::temp_dir().join(&filename);

    create_backup_internal(&app, &tmp.to_string_lossy(), true)?;

    let total = fs::metadata(&tmp).map_err(|e| e.to_string())?.len();
    let bucket = build_bucket(&creds)?;
    let key = s3_key(&creds.prefix, &filename);

    // Presigned PUT URL — keeps signing inside rust-s3 but we drive the HTTP
    // ourselves so we get real on-wire progress.
    let url = bucket
        .presign_put(format!("/{}", key), 3600, None)
        .await
        .map_err(|e| e.to_string())?;

    let _ = app.emit(
        "s3-upload-started",
        serde_json::json!({ "total": total, "filename": filename, "key": key }),
    );

    let file = tokio::fs::File::open(&tmp).await.map_err(|e| e.to_string())?;
    let state = Arc::new(Mutex::new((0u64, std::time::Instant::now(), 0u64)));
    let state_for_stream = state.clone();
    let app_for_stream = app.clone();

    let stream = ReaderStream::new(file).inspect(move |item| {
        if let Ok(chunk) = item {
            let len = chunk.len() as u64;
            let mut s = state_for_stream.lock().unwrap();
            s.0 += len;
            let now = std::time::Instant::now();
            let bytes_since = s.0 - s.2;
            let done = s.0 == total;
            if now.duration_since(s.1).as_millis() >= 100
                || bytes_since >= 64 * 1024
                || done
            {
                let _ = app_for_stream.emit(
                    "s3-upload-progress",
                    serde_json::json!({ "uploaded": s.0, "total": total }),
                );
                s.1 = now;
                s.2 = s.0;
            }
        }
    });

    let body = reqwest::Body::wrap_stream(stream);
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .put(&url)
        .header("Content-Length", total)
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let body_text = resp.text().await.unwrap_or_default();
    let _ = fs::remove_file(&tmp);

    if !(200..300).contains(&status) {
        let snippet = body_text.chars().take(240).collect::<String>();
        let _ = app.emit(
            "s3-upload-error",
            serde_json::json!({ "message": format!("HTTP {} — {}", status, snippet) }),
        );
        return Err(format!("S3 PUT falhou: HTTP {} — {}", status, snippet));
    }

    let _ = app.emit(
        "s3-upload-finished",
        serde_json::json!({ "key": key, "total": total }),
    );

    // Prune: keep most-recent N backups, delete the rest.
    let keep = retention.filter(|n| *n > 0).unwrap_or(3) as usize;
    if let Err(err) = prune_old_backups(&bucket, &creds.prefix, keep).await {
        eprintln!("Falha ao podar backups antigos no S3: {}", err);
    }

    Ok(key)
}

async fn prune_old_backups(
    bucket: &s3::bucket::Bucket,
    prefix: &str,
    keep: usize,
) -> Result<(), String> {
    let prefix = prefix.trim().trim_matches('/').to_string();
    let pages = bucket
        .list(prefix, Some("/".to_string()))
        .await
        .map_err(|e| e.to_string())?;
    let mut items: Vec<(String, String)> = Vec::new();
    for page in pages {
        for obj in page.contents {
            if obj.key.ends_with(".zip") {
                items.push((obj.last_modified, obj.key));
            }
        }
    }
    items.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, key) in items.into_iter().skip(keep) {
        let _ = bucket.delete_object(&key).await;
    }
    Ok(())
}

#[tauri::command]
async fn list_s3_backups(creds: S3Credentials) -> Result<Vec<S3BackupItem>, String> {
    let bucket = build_bucket(&creds)?;
    let prefix = creds.prefix.trim().trim_matches('/').to_string();
    let pages = bucket
        .list(prefix, Some("/".to_string()))
        .await
        .map_err(|e| e.to_string())?;
    let mut out: Vec<S3BackupItem> = Vec::new();
    for page in pages {
        for obj in page.contents {
            if obj.key.ends_with(".zip") {
                out.push(S3BackupItem {
                    key: obj.key,
                    size: obj.size,
                    last_modified: obj.last_modified,
                });
            }
        }
    }
    out.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(out)
}

#[tauri::command]
async fn restore_from_s3(app: AppHandle, creds: S3Credentials, key: String) -> Result<(), String> {
    let bucket = build_bucket(&creds)?;
    let resp = bucket
        .get_object(&key)
        .await
        .map_err(|e| e.to_string())?;
    if resp.status_code() < 200 || resp.status_code() >= 300 {
        return Err(format!(
            "S3 get_object falhou: HTTP {}",
            resp.status_code()
        ));
    }
    let tmp = std::env::temp_dir().join(format!(
        "titus-notes-restore-{}.zip",
        chrono_like_timestamp()
    ));
    fs::write(&tmp, resp.as_slice()).map_err(|e| e.to_string())?;
    let res = restore_backup(app, tmp.to_string_lossy().to_string());
    let _ = fs::remove_file(&tmp);
    res
}

fn chrono_like_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // 2-digit fields YYYYMMDD-HHMMSS (UTC, simple — no chrono dep)
    let days = secs / 86400;
    let rem = secs % 86400;
    let hh = rem / 3600;
    let mm = (rem % 3600) / 60;
    let ss = rem % 60;
    // Naive epoch-to-date — good enough for unique filenames
    let (year, month, day) = epoch_days_to_ymd(days as i64);
    format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}",
        year, month, day, hh, mm, ss
    )
}

fn epoch_days_to_ymd(days: i64) -> (i32, u32, u32) {
    // Howard Hinnant's algorithm — public domain
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(recorder::RecorderState(std::sync::Mutex::new(None)))
        .manage(transcriber::TranscriberState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let handle = app.handle();
            if let Ok(root) = get_data_root(handle) {
                let audio_dir = root.join("files").join("audio");
                let _ = fs::create_dir_all(&audio_dir);
                let _ = app.asset_protocol_scope().allow_directory(&audio_dir, true);
            }
            mic_monitor::spawn(handle.clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (window, event);
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_db,
            save_db,
            get_db_dir,
            save_image,
            read_image,
            delete_images,
            scan_hyprnote_sessions,
            write_import_log,
            import_audio_file,
            read_audio,
            get_audio_path,
            delete_audios,
            create_backup,
            restore_backup,
            get_data_root_info,
            set_data_root,
            save_s3_credentials,
            load_s3_credentials,
            clear_s3_credentials,
            test_s3_connection,
            backup_to_s3,
            list_s3_backups,
            restore_from_s3,
            cleanup_old_audios,
            recorder::start_recording,
            recorder::stop_recording,
            recorder::cancel_recording,
            recorder::recording_status,
            transcriber::transcription_model_status,
            transcriber::download_transcription_model,
            transcriber::cancel_transcription_model_download,
            transcriber::delete_transcription_model,
            transcriber::transcribe_audio,
            transcriber::cancel_transcription,
            transcriber::transcription_status
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen {
            has_visible_windows, ..
        } = event
        {
            if !has_visible_windows {
                if let Some(w) = app_handle.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app_handle, event);
        }
    });
}
