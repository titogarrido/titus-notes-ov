// Transcrição local on-demand com Parakeet TDT 0.6b v3 (ONNX, int8).
//
// O modelo (~670 MB) é baixado sob demanda do HuggingFace para
// <app_data>/models/parakeet-tdt-0.6b-v3-int8/ e carregado a cada
// transcrição (a RAM é liberada ao final). O MP3 da gravação (mono 16 kHz)
// é decodificado com symphonia e fatiado em janelas de ~60 s com corte no
// ponto de menor energia (pausas naturais), pra manter a atenção do encoder
// dentro de um tamanho tratável em reuniões longas.
//
// Assim como o gravador, o progresso/fim/erro são comunicados por eventos
// globais (`transcription-*`) — a UI pode trocar de tela sem perder o job.

use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use transcribe_rs::onnx::parakeet::{ParakeetModel, ParakeetParams};
use transcribe_rs::onnx::Quantization;

const MODEL_DIR_NAME: &str = "parakeet-tdt-0.6b-v3-int8";
const HF_BASE: &str = "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main";
const MODEL_FILES: [&str; 4] = [
    "encoder-model.int8.onnx",
    "decoder_joint-model.int8.onnx",
    "nemo128.onnx",
    "vocab.txt",
];

const SAMPLE_RATE: u32 = 16_000;
/// Tamanho alvo de cada fatia transcrita de uma vez.
const CHUNK_SECS: f32 = 60.0;
/// Janela (± segundos em torno do alvo) onde se procura o ponto mais silencioso pro corte.
const SPLIT_SEARCH_SECS: f32 = 5.0;
/// Frame de análise de energia (30 ms @ 16 kHz).
const ENERGY_FRAME: usize = 480;

pub struct TranscriberState {
    pub active: Mutex<Option<ActiveTranscription>>,
    pub cancel: AtomicBool,
    pub downloading: AtomicBool,
    pub cancel_download: AtomicBool,
}

impl Default for TranscriberState {
    fn default() -> Self {
        Self {
            active: Mutex::new(None),
            cancel: AtomicBool::new(false),
            downloading: AtomicBool::new(false),
            cancel_download: AtomicBool::new(false),
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ActiveTranscription {
    pub note_id: String,
    pub filename: String,
    /// "decoding" enquanto o MP3 vira PCM; "transcribing" durante a inferência.
    pub phase: String,
    pub processed_secs: f32,
    pub total_secs: f32,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionModelStatus {
    pub ready: bool,
    pub downloading: bool,
    pub model_dir: String,
    pub bytes_on_disk: u64,
    pub missing_files: Vec<String>,
}

/// Os modelos ficam sempre no app data padrão (nunca na pasta de dados
/// customizada, que pode estar em um drive sincronizado — 670 MB lá seria
/// desperdício de banda do usuário).
fn get_model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    path.push("models");
    path.push(MODEL_DIR_NAME);
    Ok(path)
}

fn model_status_internal(app: &AppHandle, state: &TranscriberState) -> Result<TranscriptionModelStatus, String> {
    let dir = get_model_dir(app)?;
    let mut missing: Vec<String> = Vec::new();
    let mut bytes: u64 = 0;
    for f in MODEL_FILES {
        let p = dir.join(f);
        match fs::metadata(&p) {
            Ok(m) if m.is_file() && m.len() > 0 => bytes += m.len(),
            _ => missing.push(f.to_string()),
        }
    }
    Ok(TranscriptionModelStatus {
        ready: missing.is_empty(),
        downloading: state.downloading.load(Ordering::SeqCst),
        model_dir: dir.to_string_lossy().to_string(),
        bytes_on_disk: bytes,
        missing_files: missing,
    })
}

#[tauri::command]
pub fn transcription_model_status(
    app: AppHandle,
    state: State<'_, TranscriberState>,
) -> Result<TranscriptionModelStatus, String> {
    model_status_internal(&app, &state)
}

#[tauri::command]
pub fn transcription_status(
    state: State<'_, TranscriberState>,
) -> Result<Option<ActiveTranscription>, String> {
    Ok(state.active.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
pub fn cancel_transcription(state: State<'_, TranscriberState>) -> Result<(), String> {
    state.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn cancel_transcription_model_download(
    state: State<'_, TranscriberState>,
) -> Result<(), String> {
    state.cancel_download.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn delete_transcription_model(
    app: AppHandle,
    state: State<'_, TranscriberState>,
) -> Result<(), String> {
    if state.downloading.load(Ordering::SeqCst) {
        return Err("Download do modelo em andamento — aguarde ou cancele primeiro.".to_string());
    }
    if state.active.lock().map_err(|e| e.to_string())?.is_some() {
        return Err("Há uma transcrição em andamento usando o modelo.".to_string());
    }
    let dir = get_model_dir(&app)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Assim como `transcribe_audio`, retorna na hora e roda o download numa task
// própria — aguardar aqui seguraria a thread principal e os eventos de
// progresso só chegariam ao webview no final.
#[tauri::command]
pub fn download_transcription_model(
    app: AppHandle,
    state: State<'_, TranscriberState>,
) -> Result<(), String> {
    if state
        .downloading
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Download já em andamento.".to_string());
    }
    state.cancel_download.store(false, Ordering::SeqCst);

    tauri::async_runtime::spawn(async move {
        let result = {
            let state = app.state::<TranscriberState>();
            let result = run_model_download(&app, &state).await;
            state.downloading.store(false, Ordering::SeqCst);
            result
        };
        match &result {
            Ok(_) => {
                let _ = app.emit("transcription-model-finished", serde_json::json!({}));
            }
            Err(msg) => {
                let _ = app.emit(
                    "transcription-model-error",
                    serde_json::json!({ "message": msg }),
                );
            }
        }
    });

    Ok(())
}

async fn run_model_download(app: &AppHandle, state: &TranscriberState) -> Result<(), String> {
    use futures_util::StreamExt;

    let dir = get_model_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;

    // Resolve os tamanhos primeiro pra ter um total real na barra de progresso.
    let mut sizes: Vec<u64> = Vec::with_capacity(MODEL_FILES.len());
    for f in MODEL_FILES {
        let url = format!("{}/{}", HF_BASE, f);
        let resp = client
            .head(&url)
            .send()
            .await
            .map_err(|e| format!("Falha ao consultar {}: {}", f, e))?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {} ao consultar {}", resp.status().as_u16(), f));
        }
        sizes.push(resp.content_length().unwrap_or(0));
    }
    let overall_total: u64 = sizes.iter().sum();
    let mut overall_downloaded: u64 = 0;

    for (idx, f) in MODEL_FILES.iter().enumerate() {
        let dest = dir.join(f);
        if fs::metadata(&dest).map(|m| m.is_file() && m.len() == sizes[idx] && m.len() > 0).unwrap_or(false) {
            overall_downloaded += sizes[idx];
            continue; // já baixado e íntegro — segue pro próximo
        }

        let url = format!("{}/{}", HF_BASE, f);
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Falha ao baixar {}: {}", f, e))?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {} ao baixar {}", resp.status().as_u16(), f));
        }
        let file_total = resp.content_length().unwrap_or(sizes[idx]);

        let part = dir.join(format!("{}.part", f));
        let mut out = fs::File::create(&part).map_err(|e| e.to_string())?;
        let mut stream = resp.bytes_stream();
        let mut file_downloaded: u64 = 0;
        let mut last_emit = std::time::Instant::now();

        while let Some(chunk) = stream.next().await {
            if state.cancel_download.load(Ordering::SeqCst) {
                drop(out);
                let _ = fs::remove_file(&part);
                return Err("Download cancelado.".to_string());
            }
            let chunk = chunk.map_err(|e| format!("Falha ao baixar {}: {}", f, e))?;
            use std::io::Write;
            out.write_all(&chunk).map_err(|e| e.to_string())?;
            file_downloaded += chunk.len() as u64;
            overall_downloaded += chunk.len() as u64;

            let now = std::time::Instant::now();
            let done = file_downloaded == file_total;
            if now.duration_since(last_emit).as_millis() >= 150 || done {
                let _ = app.emit(
                    "transcription-model-progress",
                    serde_json::json!({
                        "file": f,
                        "fileIndex": idx,
                        "fileCount": MODEL_FILES.len(),
                        "fileDownloaded": file_downloaded,
                        "fileTotal": file_total,
                        "overallDownloaded": overall_downloaded,
                        "overallTotal": overall_total,
                    }),
                );
                last_emit = now;
            }
        }
        drop(out);
        fs::rename(&part, &dest).map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ---------------------------------------------------------------------
// Transcrição
// ---------------------------------------------------------------------

// IMPORTANTE: este comando NÃO pode aguardar a transcrição — comandos async
// com parâmetros emprestados (State<'_>) são executados na thread principal,
// a mesma que entrega eventos ao webview. Se o comando segurasse a thread até
// o fim, todos os eventos `transcription-progress` chegariam de uma vez só no
// final (sem barra de progresso na UI). Padrão igual ao do gravador: valida,
// registra o job, dispara o worker e retorna na hora.
#[tauri::command]
pub fn transcribe_audio(
    app: AppHandle,
    state: State<'_, TranscriberState>,
    note_id: String,
    filename: String,
) -> Result<(), String> {
    if !crate::is_safe_filename(&filename) {
        return Err("Invalid filename".to_string());
    }

    let status = model_status_internal(&app, &state)?;
    if !status.ready {
        return Err(
            "Modelo de transcrição não baixado. Baixe-o em Configurações → Transcrição local."
                .to_string(),
        );
    }

    let mut audio_path = crate::get_audio_dir(&app)?;
    audio_path.push(&filename);
    if !audio_path.exists() {
        return Err(format!("Áudio não encontrado: {}", filename));
    }

    {
        let mut active = state.active.lock().map_err(|e| e.to_string())?;
        if active.is_some() {
            return Err("Já existe uma transcrição em andamento.".to_string());
        }
        *active = Some(ActiveTranscription {
            note_id: note_id.clone(),
            filename: filename.clone(),
            phase: "decoding".to_string(),
            processed_secs: 0.0,
            total_secs: 0.0,
        });
    }
    state.cancel.store(false, Ordering::SeqCst);

    let model_dir = PathBuf::from(&status.model_dir);

    std::thread::Builder::new()
        .name("transcriber".to_string())
        .spawn(move || {
            let result = {
                // O estado gerenciado vive pelo app inteiro — recupera via handle.
                let state = app.state::<TranscriberState>();
                run_transcription(&app, &state, &model_dir, &note_id, &filename)
            };

            if let Ok(mut active) = app.state::<TranscriberState>().active.lock() {
                *active = None;
            }

            match &result {
                Ok(text) => {
                    let _ = app.emit(
                        "transcription-finished",
                        serde_json::json!({ "noteId": note_id, "filename": filename, "text": text }),
                    );
                }
                Err(msg) => {
                    let _ = app.emit(
                        "transcription-error",
                        serde_json::json!({ "noteId": note_id, "filename": filename, "message": msg }),
                    );
                }
            }
        })
        .map_err(|e| format!("Falha ao iniciar o worker de transcrição: {}", e))?;

    Ok(())
}

fn run_transcription(
    app: &AppHandle,
    state: &TranscriberState,
    model_dir: &PathBuf,
    note_id: &str,
    filename: &str,
) -> Result<String, String> {
    let mut audio_path = crate::get_audio_dir(app)?;
    audio_path.push(filename);

    // Primeiro evento imediato — a UI mostra "Preparando áudio…" sem esperar
    // a decodificação terminar.
    update_progress(app, state, note_id, filename, "decoding", 0.0, 0.0);

    let mut last_emit = std::time::Instant::now();
    let samples = decode_to_16k_mono(&audio_path, |decoded_secs| {
        let now = std::time::Instant::now();
        if now.duration_since(last_emit).as_millis() >= 500 {
            update_progress(app, state, note_id, filename, "decoding", decoded_secs, 0.0);
            last_emit = now;
        }
        !state.cancel.load(Ordering::SeqCst)
    })?;
    if samples.is_empty() {
        return Err("Áudio vazio ou ilegível.".to_string());
    }
    let total_secs = samples.len() as f32 / SAMPLE_RATE as f32;
    update_progress(app, state, note_id, filename, "transcribing", 0.0, total_secs);

    let mut model = ParakeetModel::load(model_dir, &Quantization::Int8)
        .map_err(|e| format!("Falha ao carregar o modelo: {}", e))?;

    transcribe_samples_chunked(&mut model, &samples, |processed_secs| {
        if state.cancel.load(Ordering::SeqCst) {
            return false;
        }
        update_progress(
            app,
            state,
            note_id,
            filename,
            "transcribing",
            processed_secs,
            total_secs,
        );
        true
    })
}

/// Fatia o áudio em janelas de ~CHUNK_SECS (cortando em pausas), transcreve
/// cada fatia e monta o texto final com um timestamp por parágrafo.
///
/// `on_progress(processed_secs)` é chamado após cada fatia; retornar `false`
/// cancela o trabalho.
pub fn transcribe_samples_chunked(
    model: &mut ParakeetModel,
    samples: &[f32],
    mut on_progress: impl FnMut(f32) -> bool,
) -> Result<String, String> {
    let target = (CHUNK_SECS * SAMPLE_RATE as f32) as usize;
    let search = (SPLIT_SEARCH_SECS * SAMPLE_RATE as f32) as usize;
    let min_chunk = SAMPLE_RATE as usize; // 1 s — fatias menores são zero-padded

    let mut lines: Vec<String> = Vec::new();
    let mut pos: usize = 0;
    while pos < samples.len() {
        let remaining = samples.len() - pos;
        let end = if remaining <= target + search {
            samples.len()
        } else {
            find_quiet_split(samples, pos + target, search)
        };

        let mut chunk = samples[pos..end].to_vec();
        if chunk.len() < min_chunk {
            chunk.resize(min_chunk, 0.0);
        }

        let result = model
            .transcribe_with(&chunk, &ParakeetParams::default())
            .map_err(|e| format!("Falha na inferência: {}", e))?;
        let text = result.text.trim().to_string();
        if !text.is_empty() {
            lines.push(format!(
                "[{}] {}",
                format_timestamp(pos as f32 / SAMPLE_RATE as f32),
                text
            ));
        }

        pos = end;
        if !on_progress(pos as f32 / SAMPLE_RATE as f32) {
            return Err("Transcrição cancelada.".to_string());
        }
    }

    Ok(lines.join("\n\n"))
}

fn update_progress(
    app: &AppHandle,
    state: &TranscriberState,
    note_id: &str,
    filename: &str,
    phase: &str,
    processed_secs: f32,
    total_secs: f32,
) {
    if let Ok(mut active) = state.active.lock() {
        if let Some(a) = active.as_mut() {
            a.phase = phase.to_string();
            a.processed_secs = processed_secs;
            a.total_secs = total_secs;
        }
    }
    let _ = app.emit(
        "transcription-progress",
        serde_json::json!({
            "noteId": note_id,
            "filename": filename,
            "phase": phase,
            "processedSecs": processed_secs,
            "totalSecs": total_secs,
        }),
    );
}

/// Procura, em ± `search` amostras ao redor de `target`, o frame de 30 ms com
/// menor energia RMS — corta a fatia numa pausa natural em vez de no meio de
/// uma palavra.
fn find_quiet_split(samples: &[f32], target: usize, search: usize) -> usize {
    let start = target.saturating_sub(search) / ENERGY_FRAME * ENERGY_FRAME;
    let end = (target + search).min(samples.len());

    let mut best = target.min(samples.len());
    let mut best_rms = f32::MAX;
    let mut offset = start;
    while offset + ENERGY_FRAME <= end {
        let frame = &samples[offset..offset + ENERGY_FRAME];
        let rms = (frame.iter().map(|s| s * s).sum::<f32>() / ENERGY_FRAME as f32).sqrt();
        if rms < best_rms {
            best_rms = rms;
            best = offset + ENERGY_FRAME;
        }
        offset += ENERGY_FRAME;
    }
    best
}

fn format_timestamp(secs: f32) -> String {
    let total = secs.max(0.0) as u64;
    let h = total / 3600;
    let m = (total % 3600) / 60;
    let s = total % 60;
    if h > 0 {
        format!("{}:{:02}:{:02}", h, m, s)
    } else {
        format!("{}:{:02}", m, s)
    }
}

// ---------------------------------------------------------------------
// Decodificação de áudio (MP3 e WAV) → f32 mono 16 kHz
// ---------------------------------------------------------------------

/// `on_progress(segundos_decodificados)` é chamado conforme o arquivo é lido;
/// retornar `false` cancela a decodificação.
pub fn decode_to_16k_mono(
    path: &PathBuf,
    mut on_progress: impl FnMut(f32) -> bool,
) -> Result<Vec<f32>, String> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::errors::Error as SymError;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("Formato de áudio não suportado: {}", e))?;
    let mut format = probed.format;

    let track = format
        .default_track()
        .ok_or_else(|| "Arquivo sem trilha de áudio".to_string())?;
    let track_id = track.id;
    let src_rate = track.codec_params.sample_rate.unwrap_or(SAMPLE_RATE);

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("Decoder de áudio: {}", e))?;

    let mut mono: Vec<f32> = Vec::new();
    let mut sample_buf: Option<SampleBuffer<f32>> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(SymError::ResetRequired) => break,
            Err(e) => return Err(format!("Falha lendo o áudio: {}", e)),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            // Frame corrompido (ex.: gravação interrompida) — pula e segue.
            Err(SymError::DecodeError(_)) => continue,
            Err(e) => return Err(format!("Falha decodificando o áudio: {}", e)),
        };

        let spec = *decoded.spec();
        let channels = spec.channels.count().max(1);
        let needed = decoded.capacity() as u64;
        let recreate = sample_buf
            .as_ref()
            .map(|b| (b.capacity() as u64) < needed * channels as u64)
            .unwrap_or(true);
        if recreate {
            sample_buf = Some(SampleBuffer::<f32>::new(needed, spec));
        }
        let buf = sample_buf.as_mut().unwrap();
        buf.copy_interleaved_ref(decoded);

        if channels == 1 {
            mono.extend_from_slice(buf.samples());
        } else {
            for frame in buf.samples().chunks_exact(channels) {
                mono.push(frame.iter().sum::<f32>() / channels as f32);
            }
        }

        if !on_progress(mono.len() as f32 / src_rate as f32) {
            return Err("Transcrição cancelada.".to_string());
        }
    }

    if src_rate != SAMPLE_RATE {
        mono = resample_linear(&mono, src_rate, SAMPLE_RATE);
    }
    Ok(mono)
}

/// Reamostragem linear simples — suficiente pra voz; as gravações do app já
/// são 16 kHz, isso cobre só áudios importados com outra taxa.
fn resample_linear(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if input.is_empty() || from == to {
        return input.to_vec();
    }
    let ratio = from as f64 / to as f64;
    let out_len = ((input.len() as f64) / ratio).floor() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = i as f64 * ratio;
        let idx = src as usize;
        let frac = (src - idx as f64) as f32;
        let a = input[idx];
        let b = input[(idx + 1).min(input.len() - 1)];
        out.push(a + (b - a) * frac);
    }
    out
}
