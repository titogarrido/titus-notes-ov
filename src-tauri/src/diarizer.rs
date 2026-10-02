//! Local Nemotron 3 Core ML diarization followed by word-level Parakeet alignment.
use crate::transcriber::{self, ActiveTranscription, TranscriberState};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;
use transcribe_rs::onnx::parakeet::{ParakeetModel, ParakeetParams, TimestampGranularity};
use transcribe_rs::onnx::Quantization;

const MODEL_NAME: &str = "Nemotron 3 Core ML INT8";
const SAMPLE_RATE: f32 = 16_000.0;

#[derive(Default)]
pub struct DiarizerState {
    downloading: AtomicBool,
    cancel_download: AtomicBool,
}

#[derive(Deserialize)]
pub(crate) struct Manifest {
    pub(crate) repository: String,
    pub(crate) revision: String,
    pub(crate) files: Vec<ModelFile>,
}
#[derive(Deserialize)]
pub(crate) struct ModelFile {
    pub(crate) path: String,
    pub(crate) size: u64,
}
fn manifest() -> Manifest {
    serde_json::from_str(include_str!("../diarization/model-manifest.json"))
        .expect("checked-in model manifest")
}
fn model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models/nemotron3-coreml-int8"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    supported: bool,
    pub(crate) ready: bool,
    downloading: bool,
    bytes_on_disk: u64,
    total_bytes: u64,
}

#[tauri::command]
pub fn diarization_model_status(
    app: AppHandle,
    state: State<'_, DiarizerState>,
) -> Result<ModelStatus, String> {
    model_status(
        &model_dir(&app)?,
        &manifest(),
        state.downloading.load(Ordering::SeqCst),
    )
}

pub(crate) fn model_status(
    dir: &std::path::Path,
    manifest: &Manifest,
    downloading: bool,
) -> Result<ModelStatus, String> {
    let files = &manifest.files;
    Ok(ModelStatus {
        supported: cfg!(target_os = "macos"),
        ready: files.iter().all(|f| {
            fs::metadata(dir.join(&f.path)).is_ok_and(|m| m.is_file() && m.len() == f.size)
        }),
        downloading,
        bytes_on_disk: files
            .iter()
            .filter_map(|f| fs::metadata(dir.join(&f.path)).ok())
            .map(|m| m.len())
            .sum(),
        total_bytes: files.iter().map(|f| f.size).sum(),
    })
}

#[tauri::command]
pub fn cancel_diarization_model_download(state: State<'_, DiarizerState>) {
    state.cancel_download.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn download_diarization_model(
    app: AppHandle,
    state: State<'_, DiarizerState>,
) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("Diarização Core ML disponível apenas no macOS.".into());
    }
    if state
        .downloading
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Download de diarização já está em andamento.".into());
    }
    state.cancel_download.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn(async move {
        let state = app.state::<DiarizerState>();
        let result = match model_dir(&app) {
            Ok(dir) => {
                download_model(
                    &app,
                    manifest(),
                    dir,
                    &state.cancel_download,
                    "diarization-model-progress",
                )
                .await
            }
            Err(e) => Err(e),
        };
        state.downloading.store(false, Ordering::SeqCst);
        match result {
            Ok(()) => {
                let _ = app.emit("diarization-model-finished", ());
            }
            Err(message) => {
                let _ = app.emit(
                    "diarization-model-error",
                    serde_json::json!({"message": message}),
                );
            }
        }
    });
    Ok(())
}

pub(crate) async fn download_model(
    app: &AppHandle,
    manifest: Manifest,
    dir: PathBuf,
    cancel: &AtomicBool,
    event: &str,
) -> Result<(), String> {
    let total: u64 = manifest.files.iter().map(|f| f.size).sum();
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(1800))
        .build()
        .map_err(|e| e.to_string())?;
    let mut downloaded = 0;
    for file in &manifest.files {
        if cancel.load(Ordering::SeqCst) {
            return Err("Download cancelado.".into());
        }
        let dest = dir.join(&file.path);
        if fs::metadata(&dest).is_ok_and(|m| m.len() == file.size && m.is_file()) {
            downloaded += file.size;
            continue;
        }
        fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
        let partial = dest.with_extension("download");
        let result = async {
            let url = format!("https://huggingface.co/{}/resolve/{}/{}", manifest.repository, manifest.revision, file.path);
            let request = client.get(url).send();
            tokio::pin!(request);
            let response = loop {
                tokio::select! {
                    result = &mut request => break result.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?,
                    _ = tokio::time::sleep(Duration::from_millis(100)) => {
                        if cancel.load(Ordering::SeqCst) { return Err("Download cancelado.".to_string()); }
                    }
                }
            };
            let mut stream = response.bytes_stream();
            let mut output = tokio::fs::File::create(&partial).await.map_err(|e| e.to_string())?;
            let mut count = 0;
            let mut last = std::time::Instant::now();
            loop {
                if cancel.load(Ordering::SeqCst) { return Err("Download cancelado.".to_string()); }
                let chunk = tokio::select! {
                    chunk = stream.next() => match chunk { Some(chunk) => chunk, None => break },
                    _ = tokio::time::sleep(Duration::from_millis(100)) => continue,
                };
                let bytes = chunk.map_err(|e| e.to_string())?;
                output.write_all(&bytes).await.map_err(|e| e.to_string())?;
                count += bytes.len() as u64;
                if count > file.size { return Err(format!("Tamanho inválido: {}", file.path)); }
                if last.elapsed() >= Duration::from_millis(150) {
                    let _ = app.emit(event, serde_json::json!({"downloaded": downloaded + count, "total": total}));
                    last = std::time::Instant::now();
                }
            }
            output.flush().await.map_err(|e| e.to_string())?;
            drop(output);
            if count != file.size { return Err(format!("Download incompleto: {}", file.path)); }
            tokio::fs::rename(&partial, &dest).await.map_err(|e| e.to_string())?;
            Ok(())
        }.await;
        if result.is_err() {
            let _ = tokio::fs::remove_file(&partial).await;
        }
        result?;
        downloaded += file.size;
        let _ = app.emit(
            event,
            serde_json::json!({"downloaded": downloaded, "total": total}),
        );
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Speaker {
    pub id: u32,
    pub name: String,
    #[serde(default)]
    pub person_id: Option<String>,
    #[serde(default)]
    pub is_self: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice_signature: Option<crate::voice_identity::VoiceSignature>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice_match: Option<serde_json::Value>,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VoiceTurn {
    pub start: f32,
    pub end: f32,
    pub speaker_id: u32,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub start: f32,
    pub end: f32,
    pub speaker_ids: Vec<u32>,
    pub text: String,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Diarization {
    pub filename: String,
    pub model: String,
    pub speakers: Vec<Speaker>,
    pub turns: Vec<VoiceTurn>,
    pub segments: Vec<TranscriptSegment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity_warning: Option<String>,
}

#[tauri::command]
pub fn diarize_audio(
    app: AppHandle,
    state: State<'_, TranscriberState>,
    note_id: String,
    filename: String,
) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("Diarização Core ML disponível apenas no macOS.".into());
    }
    if !crate::is_safe_filename(&filename) {
        return Err("Nome de áudio inválido.".into());
    }
    if app
        .state::<crate::recorder::RecorderState>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .is_some()
    {
        return Err("Finalize a gravação antes de diarizar.".into());
    }
    let diarizer = app.state::<DiarizerState>();
    if !diarization_model_status(app.clone(), diarizer)?.ready {
        return Err("Baixe o modelo de diarização primeiro.".into());
    }
    if !transcriber::model_status_internal(&app, &state)?.ready {
        return Err("Baixe também o modelo Parakeet para gerar o texto das falas.".into());
    }
    if !crate::get_audio_dir(&app)?.join(&filename).is_file() {
        return Err("Gravação não encontrada.".into());
    }
    {
        let mut active = state.active.lock().map_err(|e| e.to_string())?;
        if active.is_some() {
            return Err("Já há um áudio sendo processado. Aguarde ou cancele.".into());
        }
        state.cancel.store(false, Ordering::SeqCst);
        *active = Some(ActiveTranscription {
            note_id: note_id.clone(),
            filename: filename.clone(),
            phase: "diarizing".into(),
            processed_secs: 0.0,
            total_secs: 0.0,
        });
    }
    let worker_app = app.clone();
    let worker_note = note_id.clone();
    let worker_file = filename.clone();
    if let Err(error) = std::thread::Builder::new().name("diarization".into()).spawn(move || {
        let state = worker_app.state::<TranscriberState>();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run(&worker_app, &state, &worker_note, &worker_file)))
            .unwrap_or_else(|_| Err("O processamento de diarização foi interrompido.".into()));
        if let Ok(mut active) = state.active.lock() { *active = None; }
        match result {
            Ok(result) => { let _ = worker_app.emit("diarization-finished", serde_json::json!({"noteId": worker_note, "filename": worker_file, "diarization": result})); }
            Err(message) => { let _ = worker_app.emit("transcription-error", serde_json::json!({"noteId": worker_note, "filename": worker_file, "message": message})); }
        }
    }) {
        *state.active.lock().map_err(|e| e.to_string())? = None;
        return Err(error.to_string());
    }
    Ok(())
}

fn progress(
    app: &AppHandle,
    state: &TranscriberState,
    note: &str,
    filename: &str,
    phase: &str,
    processed: f32,
    total: f32,
) {
    let job = ActiveTranscription {
        note_id: note.into(),
        filename: filename.into(),
        phase: phase.into(),
        processed_secs: processed,
        total_secs: total,
    };
    if let Ok(mut active) = state.active.lock() {
        *active = Some(job.clone());
    }
    let _ = app.emit("transcription-progress", job);
}
fn check_cancel(state: &TranscriberState) -> Result<(), String> {
    if state.cancel.load(Ordering::SeqCst) {
        Err("Diarização cancelada.".into())
    } else {
        Ok(())
    }
}

fn run(
    app: &AppHandle,
    state: &TranscriberState,
    note: &str,
    filename: &str,
) -> Result<Diarization, String> {
    progress(app, state, note, filename, "decoding", 0.0, 0.0);
    let path = crate::get_audio_dir(app)?.join(filename);
    let samples = transcriber::decode_to_16k_mono(&path, |_| !state.cancel.load(Ordering::SeqCst))?;
    if samples.is_empty() {
        return Err("Áudio vazio ou ilegível.".into());
    }
    check_cancel(state)?;
    let total = samples.len() as f32 / SAMPLE_RATE;
    progress(app, state, note, filename, "diarizing", 0.0, total);
    let mut turns = infer_voices(app, state, &samples, |fraction| {
        progress(
            app,
            state,
            note,
            filename,
            "diarizing",
            fraction * total,
            total,
        )
    })?;
    turns.retain(|t| {
        t.start.is_finite()
            && t.end.is_finite()
            && t.start >= 0.0
            && t.end > t.start
            && t.end <= total + 0.1
            && t.speaker_id < 8
    });
    turns.sort_by(|a, b| {
        a.start
            .total_cmp(&b.start)
            .then(a.speaker_id.cmp(&b.speaker_id))
    });
    if turns.is_empty() {
        return Err("Nenhuma voz foi detectada. A transcrição atual foi preservada.".into());
    }
    check_cancel(state)?;
    // The Core ML subprocess has exited before loading Parakeet, limiting RAM use.
    progress(app, state, note, filename, "transcribing", 0.0, total);
    let mut words = transcribe_turns(
        &transcriber::get_model_dir(app)?,
        &samples,
        &turns,
        |processed| {
            progress(app, state, note, filename, "transcribing", processed, total);
            !state.cancel.load(Ordering::SeqCst)
        },
    )?;
    check_cancel(state)?;
    if words.is_empty() {
        return Err(
            "Não foi possível transcrever as falas. A transcrição atual foi preservada.".into(),
        );
    }
    words.sort_by(|a, b| a.start.total_cmp(&b.start));
    let segments = align_words(words, &turns);
    let mut ids = turns.iter().map(|t| t.speaker_id).collect::<Vec<_>>();
    ids.sort_unstable();
    ids.dedup();
    let mut speakers: Vec<Speaker> = ids
        .into_iter()
        .map(|id| Speaker {
            id,
            name: format!("Interlocutor {}", id + 1),
            person_id: None,
            is_self: false,
            voice_signature: None,
            voice_match: None,
        })
        .collect();
    let mut identity_warning = None;
    if crate::voice_identity::ready(app)? {
        progress(app, state, note, filename, "identifying", 0.0, total);
        match crate::voice_identity::signatures(app, state, &samples, &turns) {
            Ok(signatures) => {
                for speaker in &mut speakers {
                    speaker.voice_signature = signatures.get(&speaker.id).cloned();
                }
            }
            Err(error) => {
                check_cancel(state)?;
                identity_warning = Some(format!("Reconhecimento de voz indisponível: {error}"));
            }
        }
    }
    check_cancel(state)?;
    Ok(Diarization {
        identity_warning,
        filename: filename.into(),
        model: MODEL_NAME.into(),
        speakers,
        turns,
        segments,
    })
}

// Transcribe around voice onsets, retaining the entire recording (including
// unassigned speech). Each window has context on both sides; only words whose
// midpoint belongs to its core survive, so context is never duplicated.
fn transcription_boundaries(samples: &[f32], turns: &[VoiceTurn]) -> Vec<usize> {
    let sr = SAMPLE_RATE as usize;
    let mut cuts = vec![0];
    for target in turns
        .iter()
        .map(|turn| (turn.start * SAMPLE_RATE) as usize)
        .chain(std::iter::once(samples.len()))
    {
        if target > samples.len() {
            continue;
        }
        let mut last = *cuts.last().unwrap();
        while target.saturating_sub(last) > 65 * sr {
            last = transcriber::find_quiet_split(samples, last + 60 * sr, 5 * sr);
            cuts.push(last);
        }
        if target.saturating_sub(last) >= sr && samples.len().saturating_sub(target) >= sr {
            cuts.push(target);
        }
    }
    if *cuts.last().unwrap() != samples.len() {
        cuts.push(samples.len());
    }
    cuts
}

fn transcribe_turns(
    model_dir: &std::path::Path,
    samples: &[f32],
    turns: &[VoiceTurn],
    mut on_progress: impl FnMut(f32) -> bool,
) -> Result<Vec<TranscriptSegment>, String> {
    if !on_progress(0.0) {
        return Err("Diarização cancelada.".into());
    }
    let mut model =
        ParakeetModel::load(model_dir, &Quantization::Int8).map_err(|e| e.to_string())?;
    let params = ParakeetParams {
        timestamp_granularity: Some(TimestampGranularity::Word),
        ..Default::default()
    };
    let total = samples.len() as f32 / SAMPLE_RATE;
    let context = (0.25 * SAMPLE_RATE) as usize;
    let mut words = Vec::new();
    for window in transcription_boundaries(samples, turns).windows(2) {
        if !on_progress(window[0] as f32 / SAMPLE_RATE) {
            return Err("Diarização cancelada.".into());
        }
        let start = window[0].saturating_sub(context);
        let end = (window[1] + context).min(samples.len());
        let mut chunk = samples[start..end].to_vec();
        transcriber::agc_normalize(&mut chunk);
        chunk.resize(chunk.len().max(SAMPLE_RATE as usize), 0.0);
        let result = model
            .transcribe_with(&chunk, &params)
            .map_err(|e| format!("Falha na transcrição das falas: {e}"))?;
        let offset = start as f32 / SAMPLE_RATE;
        for word in result.segments.unwrap_or_default() {
            let word_start = (offset + word.start).max(0.0);
            let word_end = (offset + word.end).min(total);
            let midpoint = (word_start + word_end) / 2.0;
            if word_start.is_finite()
                && word_end.is_finite()
                && word_end >= word_start
                && !word.text.trim().is_empty()
                && midpoint >= window[0] as f32 / SAMPLE_RATE
                && midpoint < window[1] as f32 / SAMPLE_RATE
            {
                words.push(TranscriptSegment {
                    start: word_start,
                    end: word_end,
                    speaker_ids: vec![],
                    text: word.text.trim().into(),
                });
            }
        }
        if !on_progress(window[1] as f32 / SAMPLE_RATE) {
            return Err("Diarização cancelada.".into());
        }
    }
    words.sort_by(|a, b| a.start.total_cmp(&b.start));
    Ok(words)
}

struct TemporaryAudio(PathBuf);
impl Drop for TemporaryAudio {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn infer_voices(
    app: &AppHandle,
    state: &TranscriberState,
    samples: &[f32],
    on_progress: impl FnMut(f32),
) -> Result<Vec<VoiceTurn>, String> {
    let value = run_coreml(
        app,
        state,
        samples,
        &model_dir(app)?,
        &[],
        "segments",
        on_progress,
    )?;
    serde_json::from_value(value).map_err(|e| format!("Intervalos Core ML inválidos: {e}"))
}

#[cfg(target_os = "macos")]
pub(crate) fn run_coreml(
    app: &AppHandle,
    state: &TranscriberState,
    samples: &[f32],
    model: &std::path::Path,
    args: &[String],
    result_key: &str,
    mut on_progress: impl FnMut(f32),
) -> Result<serde_json::Value, String> {
    use std::os::unix::fs::PermissionsExt;
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("diarization");
    fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    let helper_bytes = include_bytes!(concat!(env!("OUT_DIR"), "/titus-diarize"));
    // Content-derived name also handles local rebuilds without a version bump.
    use std::hash::{Hash, Hasher};
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    helper_bytes.hash(&mut hash);
    let helper = cache.join(format!("titus-diarize-{:x}", hash.finish()));
    if !fs::metadata(&helper).is_ok_and(|m| m.is_file() && m.len() == helper_bytes.len() as u64) {
        let staging = cache.join(format!("helper-{}", uuid::Uuid::new_v4()));
        fs::write(&staging, helper_bytes).map_err(|e| e.to_string())?;
        fs::set_permissions(&staging, fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
        fs::rename(&staging, &helper).map_err(|e| e.to_string())?;
    }
    let audio = TemporaryAudio(cache.join(format!("{}.f32", uuid::Uuid::new_v4())));
    {
        use std::os::unix::fs::OpenOptionsExt;
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&audio.0)
            .map_err(|e| e.to_string())?;
        let mut output = BufWriter::new(file);
        for sample in samples {
            output
                .write_all(&sample.to_le_bytes())
                .map_err(|e| e.to_string())?;
        }
        output.flush().map_err(|e| e.to_string())?;
    }
    check_cancel(state)?;
    let mut child = Command::new(helper)
        .arg(model)
        .arg(&audio.0)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Falha ao iniciar Core ML: {e}"))?;
    let stdout = child.stdout.take().unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    if tx.send(line).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
    let mut result = None;
    let mut error = None;
    loop {
        if state.cancel.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            return Err("Diarização cancelada.".into());
        }
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(line) => {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                    if let Some(fraction) = value["progress"].as_f64() {
                        on_progress((fraction as f32).clamp(0.0, 1.0));
                    }
                    if let Some(message) = value["error"].as_str() {
                        error = Some(message.to_string());
                    }
                    if let Some(segments) = value.get(result_key) {
                        result = Some(segments.clone());
                    }
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let _ = reader.join();
    check_cancel(state)?;
    if !status.success() {
        return Err(error.unwrap_or_else(|| format!("Core ML terminou com erro ({status}).")));
    }
    result.ok_or_else(|| "O modelo Core ML não retornou um resultado válido.".into())
}
#[cfg(not(target_os = "macos"))]
pub(crate) fn run_coreml(
    _: &AppHandle,
    _: &TranscriberState,
    _: &[f32],
    _: &std::path::Path,
    _: &[String],
    _: &str,
    _: impl FnMut(f32),
) -> Result<serde_json::Value, String> {
    Err("Core ML requer macOS.".into())
}

// Align at word resolution. Several voices at the word midpoint represent
// overlap, not isolated audio streams; unassigned words remain in the transcript.
fn align_words(words: Vec<TranscriptSegment>, turns: &[VoiceTurn]) -> Vec<TranscriptSegment> {
    let mut output: Vec<TranscriptSegment> = Vec::new();
    let mut active: Vec<&VoiceTurn> = Vec::new();
    let mut cursor = 0;
    for mut word in words {
        let middle = (word.start + word.end) / 2.0;
        while cursor < turns.len() && turns[cursor].start <= word.end + 0.3 {
            active.push(&turns[cursor]);
            cursor += 1;
        }
        active.retain(|turn| turn.end >= word.start - 0.3);
        word.speaker_ids = active
            .iter()
            .filter(|turn| turn.start <= middle && turn.end > middle)
            .map(|turn| turn.speaker_id)
            .collect();
        if word.speaker_ids.is_empty() {
            let best = active.iter().max_by(|a, b| {
                let score = |turn: &&VoiceTurn| {
                    (word.end.min(turn.end) - word.start.max(turn.start)).max(0.0)
                };
                score(a).total_cmp(&score(b))
            });
            if let Some(turn) = best.filter(|t| word.end.min(t.end) > word.start.max(t.start)) {
                word.speaker_ids.push(turn.speaker_id);
            }
        }
        word.speaker_ids.sort_unstable();
        word.speaker_ids.dedup();
        if let Some(previous) = output.last_mut() {
            if previous.speaker_ids == word.speaker_ids && word.start - previous.end < 1.5 {
                previous.end = previous.end.max(word.end);
                previous.text.push(' ');
                previous.text.push_str(&word.text);
                continue;
            }
        }
        output.push(word);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_notes_load_and_speaker_identity_survives_json_round_trip() {
        let mut note: crate::Note = serde_json::from_value(serde_json::json!({
            "id": "test", "title": "Meeting", "content": "", "date": "2026-10-02", "projectId": null, "peopleIds": []
        })).unwrap();
        assert!(note.diarization.is_none());
        note.diarization = Some(Diarization {
            identity_warning: None,
            filename: "test.mp3".into(),
            model: MODEL_NAME.into(),
            speakers: vec![Speaker {
                id: 0,
                name: "Ana".into(),
                person_id: Some("person-1".into()),
                is_self: true,
                voice_signature: None,
                voice_match: None,
            }],
            turns: vec![VoiceTurn {
                start: 0.0,
                end: 2.0,
                speaker_id: 0,
            }],
            segments: vec![TranscriptSegment {
                start: 0.0,
                end: 2.0,
                speaker_ids: vec![0],
                text: "Bom dia".into(),
            }],
        });
        let restored: crate::Note =
            serde_json::from_str(&serde_json::to_string(&note).unwrap()).unwrap();
        let diarization = restored.diarization.unwrap();
        assert_eq!(
            diarization.speakers[0].person_id.as_deref(),
            Some("person-1")
        );
        assert!(diarization.speakers[0].is_self);
        assert_eq!(diarization.segments[0].speaker_ids, vec![0]);
        assert_eq!(diarization.filename, "test.mp3");
    }

    #[test]
    #[cfg(target_os = "macos")]
    #[ignore = "requires local Core ML/Parakeet weights and a two-voice mono 16 kHz Float32 fixture"]
    fn coreml_and_parakeet_align_real_audio() {
        let model_path =
            std::env::var("TITUS_DIARIZATION_TEST_MODEL").expect("Core ML fixture directory");
        let pcm_path = std::env::var("TITUS_DIARIZATION_TEST_PCM").expect("Float32 fixture");
        let asr_path =
            std::env::var("TITUS_PARAKEET_TEST_MODEL").expect("Parakeet fixture directory");
        let result = Command::new(concat!(env!("OUT_DIR"), "/titus-diarize"))
            .arg(model_path)
            .arg(&pcm_path)
            .output()
            .unwrap();
        assert!(result.status.success(), "Core ML helper failed");
        let json = String::from_utf8(result.stdout).unwrap();
        let payload: serde_json::Value =
            serde_json::from_str(json.lines().last().unwrap()).unwrap();
        let turns: Vec<VoiceTurn> = serde_json::from_value(payload["segments"].clone()).unwrap();
        assert_eq!(
            turns
                .iter()
                .map(|turn| turn.speaker_id)
                .collect::<std::collections::HashSet<_>>()
                .len(),
            2
        );
        let bytes = fs::read(pcm_path).unwrap();
        let samples: Vec<f32> = bytes
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
            .collect();
        let words = transcribe_turns(&PathBuf::from(asr_path), &samples, &turns, |_| true).unwrap();
        let word_count = words.len();
        let aligned = align_words(words, &turns);
        assert!(aligned.iter().any(|turn| turn.speaker_ids == vec![0]));
        assert!(aligned.iter().any(|turn| turn.speaker_ids == vec![1]));
        assert_eq!(
            aligned
                .iter()
                .map(|segment| segment.text.split_whitespace().count())
                .sum::<usize>(),
            word_count
        );
        println!(
            "Core ML + Parakeet: two voices, {word_count} words, {} aligned turns",
            aligned.len()
        );
    }

    #[test]
    fn aligns_changes_overlap_and_unassigned_words_without_losing_text() {
        let turns = vec![
            VoiceTurn {
                start: 0.0,
                end: 2.0,
                speaker_id: 0,
            },
            VoiceTurn {
                start: 1.0,
                end: 3.0,
                speaker_id: 1,
            },
        ];
        let words = [
            (0.2, 0.5, "Olá"),
            (0.5, 0.9, "pessoal."),
            (1.2, 1.8, "Sobreposição."),
            (2.2, 2.8, "Resposta."),
            (4.0, 4.2, "Sem voz."),
        ]
        .into_iter()
        .map(|(start, end, text)| TranscriptSegment {
            start,
            end,
            text: text.into(),
            speaker_ids: vec![],
        })
        .collect();
        let result = align_words(words, &turns);
        assert_eq!(result.len(), 4);
        assert_eq!(result[0].text, "Olá pessoal.");
        assert_eq!(result[0].speaker_ids, vec![0]);
        assert_eq!(result[1].speaker_ids, vec![0, 1]);
        assert_eq!(result[2].speaker_ids, vec![1]);
        assert!(result[3].speaker_ids.is_empty());
        assert_eq!(result[3].text, "Sem voz.");
    }
}
