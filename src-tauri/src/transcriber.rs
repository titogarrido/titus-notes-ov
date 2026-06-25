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
/// Fatia menor na transcrição por canais — timestamps mais frequentes melhoram
/// o entrelaçamento (turnos) ao mesclar microfone + sistema.
const CHANNEL_CHUNK_SECS: f32 = 20.0;
/// Janela (± segundos em torno do alvo) onde se procura o ponto mais silencioso pro corte.
const SPLIT_SEARCH_SECS: f32 = 5.0;
/// Frame de análise de energia (30 ms @ 16 kHz).
const ENERGY_FRAME: usize = 480;
/// Sobreposição (s) reincluída no início do próximo chunk no batch: a fronteira
/// é re-transcrita nos dois lados e a duplicata removida (`dedupe_seam`), para
/// não perder a palavra que cai exatamente no ponto de corte.
const CHUNK_OVERLAP_SECS: f32 = 0.7;

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
                Ok((text, self_text)) => {
                    let _ = app.emit(
                        "transcription-finished",
                        serde_json::json!({
                            "noteId": note_id,
                            "filename": filename,
                            "text": text,
                            "selfText": self_text,
                        }),
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

/// Retorna `(transcrição, Option<transcrição_só_do_microfone>)`.
///
/// Quando existem os sidecars por canal (`*.mic.mp3` + `*.sys.mp3`), transcreve
/// cada canal isolado (no nível nativo, sem o desbalanceamento da mistura) e os
/// mescla num transcript rotulado por quem falou. A segunda parte (microfone) é
/// o que VOCÊ falou — base para a IA separar os "meus" itens de ação.
/// Sem os sidecars, transcreve o arquivo único normalmente.
fn run_transcription(
    app: &AppHandle,
    state: &TranscriberState,
    model_dir: &PathBuf,
    note_id: &str,
    filename: &str,
) -> Result<(String, Option<String>), String> {
    let audio_dir = crate::get_audio_dir(app)?;

    // Modo por canais: precisa dos dois sidecars (mic + sistema).
    let mic_name = crate::recorder::mic_sidecar_name(filename);
    let sys_name = crate::recorder::sys_sidecar_name(filename);
    let mic_path = audio_dir.join(&mic_name);
    let sys_path = audio_dir.join(&sys_name);
    if mic_name != filename && mic_path.exists() && sys_path.exists() {
        return run_channel_transcription(
            app, state, model_dir, note_id, filename, &mic_path, &sys_path,
        );
    }

    // Fallback: arquivo único (gravações sem áudio do sistema, importadas ou coladas).
    let audio_path = audio_dir.join(filename);
    update_progress(app, state, note_id, filename, "decoding", 0.0, 0.0);

    let mut last_emit = std::time::Instant::now();
    let mut samples = decode_to_16k_mono(&audio_path, |decoded_secs| {
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
    // Normaliza o loudness (AGC) antes da inferência para não perder trechos baixos.
    agc_normalize(&mut samples);
    let total_secs = samples.len() as f32 / SAMPLE_RATE as f32;
    update_progress(app, state, note_id, filename, "transcribing", 0.0, total_secs);

    let mut model = ParakeetModel::load(model_dir, &Quantization::Int8)
        .map_err(|e| format!("Falha ao carregar o modelo: {}", e))?;

    let text = transcribe_samples_chunked(&mut model, &samples, |processed_secs| {
        if state.cancel.load(Ordering::SeqCst) {
            return false;
        }
        update_progress(app, state, note_id, filename, "transcribing", processed_secs, total_secs);
        true
    })?;

    Ok((text, None))
}

/// Transcrição por canais separados: microfone (Você) + sistema (Outros),
/// cada um no seu nível nativo, mesclados por tempo. Resolve o caso do áudio
/// remoto que some ao transcrever só a mistura. Em sucesso, apaga os sidecars
/// (mantemos só o texto + o MP3 mixado para playback).
fn run_channel_transcription(
    app: &AppHandle,
    state: &TranscriberState,
    model_dir: &PathBuf,
    note_id: &str,
    filename: &str,
    mic_path: &PathBuf,
    sys_path: &PathBuf,
) -> Result<(String, Option<String>), String> {
    update_progress(app, state, note_id, filename, "decoding", 0.0, 0.0);

    let mut last_emit = std::time::Instant::now();
    let mut mic_samples = decode_to_16k_mono(mic_path, |decoded_secs| {
        let now = std::time::Instant::now();
        if now.duration_since(last_emit).as_millis() >= 500 {
            update_progress(app, state, note_id, filename, "decoding", decoded_secs, 0.0);
            last_emit = now;
        }
        !state.cancel.load(Ordering::SeqCst)
    })?;
    let mut sys_samples = decode_to_16k_mono(sys_path, |_| !state.cancel.load(Ordering::SeqCst))?;
    if mic_samples.is_empty() && sys_samples.is_empty() {
        return Err("Áudio vazio ou ilegível.".to_string());
    }

    // Normaliza o loudness de cada canal (AGC) antes da inferência — levanta
    // vozes baixas (esp. participantes remotos) sem mexer no áudio salvo.
    agc_normalize(&mut sys_samples);
    agc_normalize(&mut mic_samples);

    let mic_secs = mic_samples.len() as f32 / SAMPLE_RATE as f32;
    let sys_secs = sys_samples.len() as f32 / SAMPLE_RATE as f32;
    let total_secs = mic_secs + sys_secs;
    update_progress(app, state, note_id, filename, "transcribing", 0.0, total_secs);

    let mut model = ParakeetModel::load(model_dir, &Quantization::Int8)
        .map_err(|e| format!("Falha ao carregar o modelo: {}", e))?;

    // Canal do microfone (Você).
    let mic_segs = transcribe_samples_segments(
        &mut model,
        &mic_samples,
        CHANNEL_CHUNK_SECS,
        |processed_secs| {
            if state.cancel.load(Ordering::SeqCst) {
                return false;
            }
            update_progress(app, state, note_id, filename, "transcribing", processed_secs, total_secs);
            true
        },
    )?;

    // Canal do sistema (Outros) — continua a barra de onde o microfone parou.
    let sys_segs = transcribe_samples_segments(
        &mut model,
        &sys_samples,
        CHANNEL_CHUNK_SECS,
        |processed_secs| {
            if state.cancel.load(Ordering::SeqCst) {
                return false;
            }
            update_progress(
                app,
                state,
                note_id,
                filename,
                "transcribing",
                mic_secs + processed_secs,
                total_secs,
            );
            true
        },
    )?;

    let merged = merge_labeled(&mic_segs, "Você", &sys_segs, "Outros");
    let self_text = mic_segs
        .iter()
        .map(|(t, s)| format!("[{}] {}", format_timestamp(*t), s))
        .collect::<Vec<_>>()
        .join("\n\n");
    let self_text = if self_text.trim().is_empty() {
        None
    } else {
        Some(self_text)
    };

    // Sucesso: os sidecars já cumpriram o papel — apaga para não dobrar o disco.
    let _ = fs::remove_file(mic_path);
    let _ = fs::remove_file(sys_path);

    Ok((merged, self_text))
}

/// Fatia o áudio em janelas de ~`chunk_secs` (cortando em pausas) e transcreve
/// cada fatia, retornando segmentos `(início_em_segundos, texto)`.
///
/// `on_progress(processed_secs)` é chamado após cada fatia; retornar `false`
/// cancela o trabalho.
pub fn transcribe_samples_segments(
    model: &mut ParakeetModel,
    samples: &[f32],
    chunk_secs: f32,
    mut on_progress: impl FnMut(f32) -> bool,
) -> Result<Vec<(f32, String)>, String> {
    let target = (chunk_secs * SAMPLE_RATE as f32) as usize;
    let search = (SPLIT_SEARCH_SECS * SAMPLE_RATE as f32) as usize;
    let min_chunk = SAMPLE_RATE as usize; // 1 s — fatias menores são zero-padded
    let overlap = (CHUNK_OVERLAP_SECS * SAMPLE_RATE as f32) as usize;

    let mut segments: Vec<(f32, String)> = Vec::new();
    let mut pos: usize = 0;
    // Texto cru do chunk anterior, usado pra remover a duplicação da sobreposição.
    let mut prev_text = String::new();
    while pos < samples.len() {
        let remaining = samples.len() - pos;
        let reached_end = remaining <= target + search;
        let end = if reached_end {
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
        let raw = result.text.trim().to_string();
        if !raw.is_empty() {
            // Remove as palavras iniciais que repetem o fim do chunk anterior
            // (a fronteira sobreposta foi transcrita nos dois chunks).
            let text = if prev_text.is_empty() {
                raw.clone()
            } else {
                dedupe_seam(&prev_text, &raw)
            };
            let text = text.trim().to_string();
            if !text.is_empty() {
                segments.push((pos as f32 / SAMPLE_RATE as f32, text));
            }
            prev_text = raw;
        } else {
            // Chunk silencioso: não há fronteira a deduplicar com o próximo.
            prev_text.clear();
        }

        if !on_progress(end as f32 / SAMPLE_RATE as f32) {
            return Err("Transcrição cancelada.".to_string());
        }
        if reached_end {
            break;
        }
        // Recua o início do próximo chunk pra reincluir a fronteira sobreposta
        // (target ≫ overlap, então `pos` sempre avança).
        pos = end.saturating_sub(overlap);
    }

    Ok(segments)
}

/// Como `transcribe_samples_segments`, mas devolve o texto já formatado com um
/// timestamp por parágrafo (fatias de ~CHUNK_SECS).
pub fn transcribe_samples_chunked(
    model: &mut ParakeetModel,
    samples: &[f32],
    on_progress: impl FnMut(f32) -> bool,
) -> Result<String, String> {
    let segments = transcribe_samples_segments(model, samples, CHUNK_SECS, on_progress)?;
    Ok(segments
        .into_iter()
        .map(|(t, s)| format!("[{}] {}", format_timestamp(t), s))
        .collect::<Vec<_>>()
        .join("\n\n"))
}

/// Remove do começo de `next` as palavras que repetem o fim de `prev` — limpa a
/// duplicação criada pela sobreposição entre chunks (`CHUNK_OVERLAP_SECS`).
/// Compara só tokens normalizados (minúsculas, sem pontuação) e no máximo `MAX_K`
/// palavras, pra não apagar repetições legítimas distantes do corte.
fn dedupe_seam(prev: &str, next: &str) -> String {
    const MAX_K: usize = 8;
    let prev_words: Vec<&str> = prev.split_whitespace().collect();
    let next_words: Vec<&str> = next.split_whitespace().collect();
    let norm = |w: &str| -> String {
        w.chars()
            .filter(|c| c.is_alphanumeric())
            .flat_map(|c| c.to_lowercase())
            .collect()
    };
    let max_k = prev_words.len().min(next_words.len()).min(MAX_K);
    let mut best = 0;
    for k in 1..=max_k {
        let prev_tail = &prev_words[prev_words.len() - k..];
        let next_head = &next_words[..k];
        if prev_tail
            .iter()
            .map(|w| norm(w))
            .eq(next_head.iter().map(|w| norm(w)))
        {
            best = k;
        }
    }
    if best > 0 {
        next_words[best..].join(" ")
    } else {
        next.to_string()
    }
}

/// Mescla segmentos de dois canais num transcript único, ordenado por tempo e
/// rotulado com quem falou. Ex.: `[0:09] (Outros) ...`.
fn merge_labeled(
    a: &[(f32, String)],
    label_a: &str,
    b: &[(f32, String)],
    label_b: &str,
) -> String {
    let mut all: Vec<(f32, &str, &str)> = Vec::with_capacity(a.len() + b.len());
    for (t, s) in a {
        all.push((*t, label_a, s.as_str()));
    }
    for (t, s) in b {
        all.push((*t, label_b, s.as_str()));
    }
    all.sort_by(|x, y| x.0.partial_cmp(&y.0).unwrap_or(std::cmp::Ordering::Equal));
    all.into_iter()
        .map(|(t, label, text)| format!("[{}] ({}) {}", format_timestamp(t), label, text))
        .collect::<Vec<_>>()
        .join("\n\n")
}

// ---------------------------------------------------------------------
// Transcrição ao vivo (durante a gravação)
// ---------------------------------------------------------------------
//
// O gravador encaminha DOIS canais separados (microfone = "Você", áudio do
// sistema = "Outros") para esta sessão. Cada canal acumula janelas próprias
// (cortando em pausas via VAD), transcreve com o MESMO modelo (carregado uma vez,
// em RAM durante a reunião) e emite `transcription-live` rotulado com quem falou —
// igual ao batch por canais. Janelas só de silêncio avançam o relógio sem inferir.

/// Janela MÁXIMA (s) acumulada antes de forçar a transcrição ao vivo mesmo sem
/// pausa. Menor = menos latência; o flush por pausa (VAD) abaixo costuma disparar
/// bem antes disso.
const LIVE_MAX_WINDOW_SECS: f32 = 8.0;
/// Fala mínima acumulada (s) antes de um flush antecipado por pausa — evita
/// fragmentar o transcript em micro-pausas.
const LIVE_MIN_FLUSH_SECS: f32 = 2.5;
/// Silêncio no fim do buffer (s) que dispara o flush antecipado (fim de turno).
const LIVE_PAUSE_SECS: f32 = 0.6;
/// RMS abaixo disso conta como silêncio para o VAD do flush ao vivo.
const LIVE_SILENCE_RMS: f32 = 0.01;
/// Margem (s) de busca por uma pausa perto do fim da janela máxima.
const LIVE_SPLIT_SEARCH_SECS: f32 = 1.5;
/// RMS mínimo da janela para valer a inferência ao vivo — abaixo disso é
/// silêncio/ruído: avança o relógio do canal sem chamar o modelo.
const LIVE_SPEECH_RMS: f32 = 0.006;

enum LiveMsg {
    /// Lote do microfone (Você), mono 16 kHz.
    Mic(Vec<f32>),
    /// Lote do áudio do sistema (Outros), mono 16 kHz.
    Sys(Vec<f32>),
    Finish,
    Abort,
}

/// Handle de uma sessão ao vivo, segurado pelo gravador. O worker roda destacado
/// (não bloqueamos a thread de gravação no encerramento — ela só sinaliza e o
/// worker transcreve a última janela em background, emitindo `live-finished`).
pub struct LiveHandle {
    tx: std::sync::mpsc::Sender<LiveMsg>,
}

impl LiveHandle {
    /// Encaminha um lote do microfone (Você), mono 16 kHz.
    pub fn feed_mic(&self, samples: Vec<f32>) {
        let _ = self.tx.send(LiveMsg::Mic(samples));
    }
    /// Encaminha um lote do áudio do sistema (Outros), mono 16 kHz.
    pub fn feed_sys(&self, samples: Vec<f32>) {
        let _ = self.tx.send(LiveMsg::Sys(samples));
    }
    /// Encerra normalmente: o worker transcreve o resto e finaliza sozinho.
    pub fn finish(self) {
        let _ = self.tx.send(LiveMsg::Finish);
    }
    /// Aborta (gravação cancelada): o worker descarta e finaliza sozinho.
    pub fn abort(self) {
        let _ = self.tx.send(LiveMsg::Abort);
    }
}

/// Estado de um canal ao vivo: buffer acumulado, posição já emitida (relógio do
/// canal) e o rótulo de quem falou (`None` = sem rótulo, gravação só-microfone).
struct LiveChannel {
    buf: Vec<f32>,
    emitted: usize,
    speaker: Option<&'static str>,
}

impl LiveChannel {
    fn new(speaker: Option<&'static str>, max_window: usize) -> Self {
        Self {
            buf: Vec::with_capacity(max_window * 2),
            emitted: 0,
            speaker,
        }
    }
}

/// Inicia uma sessão de transcrição ao vivo para `note_id`. Com `labeled = true`
/// (há áudio do sistema), as emissões vêm rotuladas "Você"/"Outros"; sem ele, a
/// gravação é só-microfone e o texto sai sem rótulo. Falha (sem efeito colateral)
/// se o modelo não estiver baixado — o chamador cai para batch.
pub fn spawn_live_session(
    app: &AppHandle,
    note_id: String,
    labeled: bool,
) -> Result<LiveHandle, String> {
    let status = {
        let state = app.state::<TranscriberState>();
        model_status_internal(app, &state)?
    };
    if !status.ready {
        return Err("Modelo de transcrição não baixado.".to_string());
    }
    let model_dir = PathBuf::from(&status.model_dir);
    let (tx, rx) = std::sync::mpsc::channel::<LiveMsg>();
    let app2 = app.clone();
    std::thread::Builder::new()
        .name("live-transcriber".to_string())
        .spawn(move || run_live_session(app2, model_dir, note_id, labeled, rx))
        .map_err(|e| format!("Falha ao iniciar transcrição ao vivo: {}", e))?;
    Ok(LiveHandle { tx })
}

/// Parâmetros (em amostras) compartilhados pelos dois canais ao vivo.
struct LiveParams {
    max_window: usize,
    min_flush: usize,
    pause: usize,
    search: usize,
    min_chunk: usize,
}

fn run_live_session(
    app: AppHandle,
    model_dir: PathBuf,
    note_id: String,
    labeled: bool,
    rx: std::sync::mpsc::Receiver<LiveMsg>,
) {
    let mut model = match ParakeetModel::load(&model_dir, &Quantization::Int8) {
        Ok(m) => m,
        Err(e) => {
            let _ = app.emit(
                "transcription-live-error",
                serde_json::json!({
                    "noteId": note_id,
                    "message": format!("Falha ao carregar o modelo: {}", e),
                }),
            );
            return;
        }
    };
    let _ = app.emit(
        "transcription-live-started",
        serde_json::json!({ "noteId": note_id }),
    );

    let p = LiveParams {
        max_window: (LIVE_MAX_WINDOW_SECS * SAMPLE_RATE as f32) as usize,
        min_flush: (LIVE_MIN_FLUSH_SECS * SAMPLE_RATE as f32) as usize,
        pause: (LIVE_PAUSE_SECS * SAMPLE_RATE as f32) as usize,
        search: (LIVE_SPLIT_SEARCH_SECS * SAMPLE_RATE as f32) as usize,
        min_chunk: SAMPLE_RATE as usize, // 1 s
    };

    // Microfone só ganha rótulo "Você" quando há também o canal do sistema; sem
    // ele a gravação é só-microfone (sem rótulo, igual ao batch de arquivo único).
    let mut mic = LiveChannel::new(if labeled { Some("Você") } else { None }, p.max_window);
    let mut sys = LiveChannel::new(Some("Outros"), p.max_window);

    loop {
        match rx.recv() {
            Ok(LiveMsg::Mic(s)) => {
                mic.buf.extend(s);
                live_flush_channel(&app, &mut model, &mut mic, &note_id, &p, false);
            }
            Ok(LiveMsg::Sys(s)) => {
                sys.buf.extend(s);
                live_flush_channel(&app, &mut model, &mut sys, &note_id, &p, false);
            }
            Ok(LiveMsg::Finish) => {
                live_flush_channel(&app, &mut model, &mut mic, &note_id, &p, true);
                live_flush_channel(&app, &mut model, &mut sys, &note_id, &p, true);
                break;
            }
            Ok(LiveMsg::Abort) | Err(_) => break,
        }
    }

    // Em qualquer saída (fim normal, abort ou canal fechado) sinaliza o término
    // para a UI limpar o indicador "ao vivo".
    let _ = app.emit(
        "transcription-live-finished",
        serde_json::json!({ "noteId": note_id }),
    );
}

/// Drena o buffer de um canal emitindo as janelas prontas. `final_flush` força a
/// saída do resto parcial (encerramento). Cada janela drenada avança o relógio do
/// canal mesmo quando é só silêncio (mantém os timestamps alinhados ao tempo real
/// sem gastar inferência à toa).
fn live_flush_channel(
    app: &AppHandle,
    model: &mut ParakeetModel,
    ch: &mut LiveChannel,
    note_id: &str,
    p: &LiveParams,
    final_flush: bool,
) {
    loop {
        // Decide a próxima janela a drenar:
        //  - TETO: buffer atingiu a janela máxima → corta numa pausa perto do fim;
        //  - PAUSA (VAD): há fala suficiente e o buffer termina num silêncio;
        //  - FINAL: encerramento → drena o resto.
        let split = if ch.buf.len() >= p.max_window {
            let target = p.max_window.saturating_sub(p.search / 2);
            find_quiet_split(&ch.buf, target, p.search).clamp(p.min_chunk, ch.buf.len())
        } else if ch.buf.len() >= p.min_flush
            && trailing_silence(&ch.buf, LIVE_SILENCE_RMS) >= p.pause
        {
            ch.buf.len()
        } else if final_flush && !ch.buf.is_empty() {
            ch.buf.len()
        } else {
            return;
        };

        let chunk: Vec<f32> = ch.buf.drain(..split).collect();
        // Só infere se a janela tiver energia de fala — silêncio/ruído avança o
        // relógio sem chamar o modelo (economia e sem texto fantasma).
        if rms(&chunk) >= LIVE_SPEECH_RMS {
            live_emit_chunk(app, model, &chunk, ch.emitted, note_id, p.min_chunk, ch.speaker);
        }
        ch.emitted += split;
        if final_flush {
            return; // no encerramento drenamos o resto de uma vez
        }
    }
}

/// RMS de uma janela (raiz da energia média).
fn rms(chunk: &[f32]) -> f32 {
    if chunk.is_empty() {
        return 0.0;
    }
    (chunk.iter().map(|s| s * s).sum::<f32>() / chunk.len() as f32).sqrt()
}

/// Transcreve uma janela e emite `transcription-live` (com `speaker`, se houver)
/// quando há texto.
fn live_emit_chunk(
    app: &AppHandle,
    model: &mut ParakeetModel,
    chunk: &[f32],
    start_samples: usize,
    note_id: &str,
    min_chunk: usize,
    speaker: Option<&str>,
) {
    // Cópia mutável: zero-pad fatias < 1 s e normaliza o loudness (AGC) antes da
    // inferência — levanta trechos baixos (ex.: remoto falando mais baixo).
    let mut input: Vec<f32> = chunk.to_vec();
    if input.len() < min_chunk {
        input.resize(min_chunk, 0.0);
    }
    agc_normalize(&mut input);
    if let Ok(result) = model.transcribe_with(&input, &ParakeetParams::default()) {
        let text = result.text.trim().to_string();
        if !text.is_empty() {
            let _ = app.emit(
                "transcription-live",
                serde_json::json!({
                    "noteId": note_id,
                    "text": text,
                    "start": start_samples as f32 / SAMPLE_RATE as f32,
                    "speaker": speaker,
                }),
            );
        }
    }
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

/// Normalização de loudness por janela (AGC) aplicada ANTES da inferência — não
/// toca no áudio salvo. Levanta trechos de fala baixos a um nível alvo para o
/// modelo não perder vozes remotas mais baixas. É boost-only (nunca abaixa uma
/// fala já boa), com noise gate (não amplifica silêncio/ruído) e ganho suavizado
/// (ataque rápido ao chegar som alto, release lento — evita "pumping").
///
/// Constantes conservadoras e fáceis de calibrar.
fn agc_normalize(samples: &mut [f32]) {
    const FRAME: usize = 480; // 30 ms @ 16 kHz
    const TARGET_RMS: f32 = 0.1; // ~ -20 dBFS
    const NOISE_FLOOR_RMS: f32 = 0.006; // abaixo disso: silêncio/ruído → ganho 1.0
    const MAX_GAIN: f32 = 8.0; // teto menor: não amplifica ruído de fundo a nível de fala
    const ATTACK: f32 = 0.5; // ganho caindo (som alto): reage rápido
    const RELEASE: f32 = 0.05; // ganho subindo (trecho baixo): sobe devagar

    if samples.is_empty() {
        return;
    }

    let mut gain = 1.0f32;
    let mut i = 0;
    while i < samples.len() {
        let end = (i + FRAME).min(samples.len());
        let span = end - i;
        // RMS do frame (sobre as amostras ainda originais).
        let rms = {
            let frame = &samples[i..end];
            (frame.iter().map(|s| s * s).sum::<f32>() / span as f32).sqrt()
        };
        let desired = if rms < NOISE_FLOOR_RMS {
            1.0
        } else {
            (TARGET_RMS / rms).clamp(1.0, MAX_GAIN)
        };
        let coeff = if desired < gain { ATTACK } else { RELEASE };
        let start_gain = gain;
        let target_gain = start_gain + (desired - start_gain) * coeff;

        // Interpola o ganho ao longo do frame (transição suave) e clampa o sinal.
        for (k, s) in samples[i..end].iter_mut().enumerate() {
            let g = if span > 1 {
                start_gain + (target_gain - start_gain) * (k as f32 / (span - 1) as f32)
            } else {
                target_gain
            };
            *s = (*s * g).clamp(-1.0, 1.0);
        }
        gain = target_gain;
        i = end;
    }
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

/// Conta quantas amostras de silêncio (RMS < `threshold`, em frames de 30 ms) há
/// no FIM de `buf` — usado pelo VAD do flush ao vivo pra detectar a pausa (fim de
/// turno) sem partir palavra.
fn trailing_silence(buf: &[f32], threshold: f32) -> usize {
    const FRAME: usize = 480; // 30 ms @ 16 kHz
    let mut silent = 0usize;
    let mut end = buf.len();
    while end >= FRAME {
        let start = end - FRAME;
        let rms = (buf[start..end].iter().map(|s| s * s).sum::<f32>() / FRAME as f32).sqrt();
        if rms < threshold {
            silent += FRAME;
            end = start;
        } else {
            break;
        }
    }
    silent
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
