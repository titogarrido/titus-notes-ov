// Gravação de reuniões: mixa o microfone (cpal) com o áudio do sistema
// (ScreenCaptureKit — pega o som de Zoom/Teams/Meet mesmo com fone de ouvido)
// e codifica MP3 (LAME) em streaming direto para files/audio/.
//
// Saída fixa em mono 16 kHz @ 32 kbps — voz com qualidade suficiente para
// transcrição (Whisper reamostra para 16 kHz de qualquer forma) ocupando
// ~14 MB por hora.
//
// O fim da reunião é detectado por silêncio: se o sinal mixado ficar abaixo
// do limiar de RMS por `auto_stop_secs` contínuos, a gravação é finalizada
// sozinha. Toda finalização (manual, automática ou erro) é comunicada ao
// frontend pelos eventos `recording-finished` / `recording-error`, que são a
// fonte única de verdade para atualizar a nota.

use std::fs;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use screencapturekit::prelude::*;
use screencapturekit::stream::configuration::audio::{AudioChannelCount, AudioSampleRate};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

const TARGET_SAMPLE_RATE: u32 = 16_000;
const TARGET_BITRATE: mp3lame_encoder::Birtate = mp3lame_encoder::Birtate::Kbps32;
/// Lote de amostras mono (16 kHz) mixado/codificado por vez (~256 ms).
const ENCODE_CHUNK_SAMPLES: usize = 4096;
/// Cap do FIFO de áudio do sistema (1 s) — limita drift entre os dois clocks.
const SYS_FIFO_MAX_SAMPLES: usize = TARGET_SAMPLE_RATE as usize;
/// RMS abaixo disso (~-40 dBFS) conta como silêncio para o auto-stop.
const SILENCE_RMS_THRESHOLD: f32 = 0.01;

pub struct RecorderState(pub Mutex<Option<ActiveRecording>>);

pub struct ActiveRecording {
    filename: String,
    note_id: String,
    started_at: Instant,
    system_audio: bool,
    warning: Option<String>,
    stop: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
    /// Sinalizado pelo mic_monitor quando o app de reunião solta o microfone.
    meeting_stop: Arc<AtomicBool>,
    /// Se false, a gravação ignora o fim de reunião detectado pelo monitor.
    stop_on_meeting_end: bool,
    handle: JoinHandle<Result<(), String>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStatus {
    pub filename: String,
    pub note_id: String,
    pub elapsed_secs: u64,
    pub system_audio: bool,
    pub warning: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecordingResult {
    pub filename: String,
    pub duration_secs: u64,
    pub size_bytes: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LevelPayload {
    level: f32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FinishedPayload {
    note_id: String,
    filename: String,
    /// Sidecar mono só do microfone (`*.mic.mp3`), quando houve áudio do sistema.
    mic_filename: Option<String>,
    duration_secs: u64,
    size_bytes: u64,
    /// "manual" (botão parar), "auto" (silêncio) ou "meeting" (app de reunião
    /// soltou o microfone)
    reason: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ErrorPayload {
    note_id: String,
    message: String,
}

/// Resultado do handshake de inicialização da thread de gravação.
struct StartInfo {
    system_audio: bool,
    warning: Option<String>,
}

#[tauri::command]
pub fn start_recording(
    app: AppHandle,
    state: State<RecorderState>,
    note_id: String,
    auto_stop_secs: Option<u64>,
    system_audio: Option<bool>,
    stop_on_meeting_end: Option<bool>,
    live: Option<bool>,
) -> Result<RecordingStatus, String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Estado de gravação corrompido".to_string())?;
    if guard.is_some() {
        return Err("Já existe uma gravação em andamento".to_string());
    }

    let audio_dir = crate::get_audio_dir(&app)?;
    let filename = format!("rec-{}.mp3", crate::chrono_like_timestamp());
    let path = audio_dir.join(&filename);

    let stop = Arc::new(AtomicBool::new(false));
    let cancel = Arc::new(AtomicBool::new(false));
    let meeting_stop = Arc::new(AtomicBool::new(false));
    let auto_stop = auto_stop_secs
        .filter(|s| *s > 0)
        .map(Duration::from_secs);
    let want_system_audio = system_audio.unwrap_or(true);
    let stop_on_meeting_end = stop_on_meeting_end.unwrap_or(true);
    let live = live.unwrap_or(false);

    // Handshake: a thread confirma que a captura abriu antes do comando retornar.
    let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<StartInfo, String>>(1);

    let thread_app = app.clone();
    let thread_stop = stop.clone();
    let thread_cancel = cancel.clone();
    let thread_meeting_stop = meeting_stop.clone();
    let thread_path = path.clone();
    let thread_filename = filename.clone();
    let thread_note_id = note_id.clone();
    let handle = std::thread::spawn(move || {
        let result = run_recording(RecordingJob {
            app: thread_app.clone(),
            path: thread_path.clone(),
            filename: thread_filename.clone(),
            note_id: thread_note_id.clone(),
            stop: thread_stop,
            cancel: thread_cancel,
            meeting_stop: thread_meeting_stop,
            auto_stop,
            want_system_audio,
            live,
            ready_tx,
        });
        if let Err(e) = &result {
            let _ = fs::remove_file(&thread_path);
            if let Some(name) = thread_path.file_name().and_then(|n| n.to_str()) {
                let _ = fs::remove_file(thread_path.with_file_name(mic_sidecar_name(name)));
                let _ = fs::remove_file(thread_path.with_file_name(sys_sidecar_name(name)));
            }
            // Remove a si própria do estado (se ainda presente) para não deixar
            // uma gravação zumbi após um erro no meio da captura.
            let st = thread_app.state::<RecorderState>();
            if let Ok(mut g) = st.0.lock() {
                if g.as_ref().map(|a| a.filename == thread_filename) == Some(true) {
                    g.take();
                }
            }
            let _ = thread_app.emit(
                "recording-error",
                ErrorPayload {
                    note_id: thread_note_id,
                    message: e.clone(),
                },
            );
        }
        result
    });

    let info = match ready_rx.recv_timeout(Duration::from_secs(15)) {
        Ok(Ok(info)) => info,
        Ok(Err(e)) => {
            let _ = handle.join();
            return Err(e);
        }
        Err(_) => {
            stop.store(true, Ordering::Relaxed);
            let _ = handle.join();
            return Err("Tempo esgotado ao iniciar a captura de áudio".to_string());
        }
    };

    *guard = Some(ActiveRecording {
        filename: filename.clone(),
        note_id: note_id.clone(),
        started_at: Instant::now(),
        system_audio: info.system_audio,
        warning: info.warning.clone(),
        stop,
        cancel,
        meeting_stop,
        stop_on_meeting_end,
        handle,
    });

    Ok(RecordingStatus {
        filename,
        note_id,
        elapsed_secs: 0,
        system_audio: info.system_audio,
        warning: info.warning,
    })
}

#[tauri::command]
pub fn stop_recording(
    app: AppHandle,
    state: State<RecorderState>,
) -> Result<RecordingResult, String> {
    let active = state
        .0
        .lock()
        .map_err(|_| "Estado de gravação corrompido".to_string())?
        .take()
        .ok_or("Nenhuma gravação em andamento")?;
    let duration_secs = active.started_at.elapsed().as_secs();
    active.stop.store(true, Ordering::Relaxed);
    active
        .handle
        .join()
        .map_err(|_| "A thread de gravação encerrou de forma inesperada".to_string())??;

    let path = crate::get_audio_dir(&app)?.join(&active.filename);
    let size_bytes = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    Ok(RecordingResult {
        filename: active.filename,
        duration_secs,
        size_bytes,
    })
}

#[tauri::command]
pub fn cancel_recording(app: AppHandle, state: State<RecorderState>) -> Result<(), String> {
    let active = state
        .0
        .lock()
        .map_err(|_| "Estado de gravação corrompido".to_string())?
        .take()
        .ok_or("Nenhuma gravação em andamento")?;
    active.cancel.store(true, Ordering::Relaxed);
    active.stop.store(true, Ordering::Relaxed);
    let _ = active.handle.join();
    let audio_dir = crate::get_audio_dir(&app)?;
    let _ = fs::remove_file(audio_dir.join(&active.filename));
    let _ = fs::remove_file(audio_dir.join(mic_sidecar_name(&active.filename)));
    let _ = fs::remove_file(audio_dir.join(sys_sidecar_name(&active.filename)));
    Ok(())
}

#[tauri::command]
pub fn recording_status(state: State<RecorderState>) -> Result<Option<RecordingStatus>, String> {
    let guard = state
        .0
        .lock()
        .map_err(|_| "Estado de gravação corrompido".to_string())?;
    Ok(guard.as_ref().map(|a| RecordingStatus {
        filename: a.filename.clone(),
        note_id: a.note_id.clone(),
        elapsed_secs: a.started_at.elapsed().as_secs(),
        system_audio: a.system_audio,
        warning: a.warning.clone(),
    }))
}

// ---------------------------------------------------------------------------

enum Msg {
    /// Frames intercalados crus do microfone, na taxa do dispositivo.
    Mic(Vec<f32>),
    /// Áudio do sistema já em mono 16 kHz (configurado no ScreenCaptureKit).
    Sys(Vec<f32>),
}

/// Reamostragem linear para 16 kHz. Suficiente para voz; evita dependência
/// de um resampler pesado.
struct LinearResampler {
    step: f64,
    pos: f64,
    prev: f32,
    primed: bool,
}

impl LinearResampler {
    fn new(in_rate: u32, out_rate: u32) -> Self {
        Self {
            step: in_rate as f64 / out_rate as f64,
            pos: 0.0,
            prev: 0.0,
            primed: false,
        }
    }

    fn push(&mut self, cur: f32, out: &mut Vec<f32>) {
        if !self.primed {
            self.prev = cur;
            self.primed = true;
            return;
        }
        while self.pos < 1.0 {
            out.push(self.prev + (cur - self.prev) * self.pos as f32);
            self.pos += self.step;
        }
        self.pos -= 1.0;
        self.prev = cur;
    }

    /// Downmix dos canais intercalados para mono + reamostragem.
    fn process_interleaved(&mut self, data: &[f32], channels: usize, out: &mut Vec<f32>) {
        let channels = channels.max(1);
        for frame in data.chunks_exact(channels) {
            let mono = frame.iter().sum::<f32>() / channels as f32;
            self.push(mono, out);
        }
    }
}

/// Nome do sidecar mono do microfone para um arquivo de gravação `rec-*.mp3`.
/// Ex.: `rec-2026....mp3` -> `rec-2026....mic.mp3`.
pub fn mic_sidecar_name(main: &str) -> String {
    sidecar_name(main, "mic")
}

/// Nome do sidecar mono do áudio do sistema (o que os outros falaram).
/// Ex.: `rec-2026....mp3` -> `rec-2026....sys.mp3`.
pub fn sys_sidecar_name(main: &str) -> String {
    sidecar_name(main, "sys")
}

fn sidecar_name(main: &str, kind: &str) -> String {
    match main.strip_suffix(".mp3") {
        Some(stem) => format!("{}.{}.mp3", stem, kind),
        None => format!("{}.{}.mp3", main, kind),
    }
}

/// Cria (encoder, writer) para um sidecar opcional. `None` quando o caminho é
/// `None` (ex.: gravação sem áudio do sistema).
fn open_sidecar(
    path: &Option<std::path::PathBuf>,
    label: &str,
) -> Result<
    (
        Option<mp3lame_encoder::Encoder>,
        Option<std::io::BufWriter<fs::File>>,
    ),
    String,
> {
    match path {
        Some(p) => {
            let enc = build_mp3_encoder()?;
            let f = fs::File::create(p)
                .map_err(|e| format!("Falha ao criar o arquivo {}: {}", label, e))?;
            Ok((Some(enc), Some(std::io::BufWriter::new(f))))
        }
        None => Ok((None, None)),
    }
}

/// Finaliza (flush) um sidecar opcional, gravando o tail do MP3.
fn finish_sidecar(
    enc: Option<mp3lame_encoder::Encoder>,
    w: Option<std::io::BufWriter<fs::File>>,
) -> Result<(), String> {
    if let (Some(mut e), Some(mut wr)) = (enc, w) {
        let mut tail: Vec<u8> = Vec::with_capacity(7200);
        let n = e
            .flush::<mp3lame_encoder::FlushNoGap>(tail.spare_capacity_mut())
            .map_err(|e| format!("Falha ao finalizar sidecar MP3: {:?}", e))?;
        // SAFETY: o encoder inicializou exatamente `n` bytes do spare capacity.
        unsafe { tail.set_len(n) };
        wr.write_all(&tail).map_err(|e| e.to_string())?;
        wr.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Cria um encoder LAME mono 16 kHz @ 32 kbps (mesma config da saída mixada).
fn build_mp3_encoder() -> Result<mp3lame_encoder::Encoder, String> {
    let mut builder =
        mp3lame_encoder::Builder::new().ok_or("Falha ao criar o encoder LAME".to_string())?;
    builder
        .set_num_channels(1)
        .map_err(|e| format!("LAME canais: {:?}", e))?;
    builder
        .set_sample_rate(TARGET_SAMPLE_RATE)
        .map_err(|e| format!("LAME sample rate: {:?}", e))?;
    builder
        .set_brate(TARGET_BITRATE)
        .map_err(|e| format!("LAME bitrate: {:?}", e))?;
    builder
        .set_quality(mp3lame_encoder::Quality::Good)
        .map_err(|e| format!("LAME qualidade: {:?}", e))?;
    builder
        .build()
        .map_err(|e| format!("Falha ao inicializar o encoder LAME: {:?}", e))
}

fn encode_and_write(
    encoder: &mut mp3lame_encoder::Encoder,
    samples: &[i16],
    writer: &mut impl Write,
) -> Result<(), String> {
    if samples.is_empty() {
        return Ok(());
    }
    let mut buf: Vec<u8> =
        Vec::with_capacity(mp3lame_encoder::max_required_buffer_size(samples.len()));
    let n = encoder
        .encode(mp3lame_encoder::MonoPcm(samples), buf.spare_capacity_mut())
        .map_err(|e| format!("Falha ao codificar MP3: {:?}", e))?;
    // SAFETY: o encoder inicializou exatamente `n` bytes do spare capacity.
    unsafe { buf.set_len(n) };
    writer.write_all(&buf).map_err(|e| e.to_string())
}

/// Handler do ScreenCaptureKit: converte os buffers (f32, mono ou multi-canal)
/// para mono e envia para a thread de mixagem.
struct SysAudioHandler {
    tx: Mutex<mpsc::Sender<Msg>>,
}

impl SCStreamOutputTrait for SysAudioHandler {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        if of_type != SCStreamOutputType::Audio {
            return;
        }
        let Some(list) = sample.audio_buffer_list() else {
            return;
        };
        let num_buffers = list.num_buffers();
        if num_buffers == 0 {
            return;
        }
        // Não-intercalado: um buffer por canal — média entre buffers.
        // Intercalado (1 buffer, N canais): média por frame.
        let mut mono: Vec<f32> = Vec::new();
        for (i, buf) in list.iter().enumerate() {
            let samples = buf
                .data()
                .chunks_exact(4)
                .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]));
            if i == 0 {
                mono = samples.collect();
                let ch = buf.number_channels.max(1) as usize;
                if ch > 1 {
                    mono = mono
                        .chunks_exact(ch)
                        .map(|f| f.iter().sum::<f32>() / ch as f32)
                        .collect();
                }
            } else {
                for (d, s) in mono.iter_mut().zip(samples) {
                    *d += s;
                }
            }
        }
        if num_buffers > 1 {
            let inv = 1.0 / num_buffers as f32;
            for d in mono.iter_mut() {
                *d *= inv;
            }
        }
        if let Ok(tx) = self.tx.lock() {
            let _ = tx.send(Msg::Sys(mono));
        }
    }
}

fn setup_system_audio(tx: mpsc::Sender<Msg>) -> Result<SCStream, String> {
    let content = SCShareableContent::get().map_err(|e| {
        format!(
            "Sem acesso ao áudio do sistema (conceda em Ajustes do Sistema → Privacidade e \
             Segurança → Gravação de Tela e Áudio do Sistema): {}",
            e
        )
    })?;
    let display = content
        .displays()
        .into_iter()
        .next()
        .ok_or("Nenhum display disponível para captura de áudio do sistema")?;
    let filter = SCContentFilter::create()
        .with_display(&display)
        .with_excluding_windows(&[])
        .build();
    // Vídeo mínimo (frames são descartados — nenhum handler de Screen é registrado).
    let config = SCStreamConfiguration::new()
        .with_width(2)
        .with_height(2)
        .with_fps(1)
        .with_captures_audio(true)
        .with_sample_rate(AudioSampleRate::Rate16000)
        .with_channel_count(AudioChannelCount::Mono)
        .with_excludes_current_process_audio(true);
    let mut stream = SCStream::new(&filter, &config);
    stream.add_output_handler(SysAudioHandler { tx: Mutex::new(tx) }, SCStreamOutputType::Audio);
    stream
        .start_capture()
        .map_err(|e| format!("Falha ao iniciar a captura do áudio do sistema: {}", e))?;
    Ok(stream)
}

fn setup_microphone(
    tx: mpsc::Sender<Msg>,
) -> Result<(cpal::Stream, u32, usize), String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("Nenhum microfone encontrado")?;
    let config = device
        .default_input_config()
        .map_err(|e| format!("Configuração do microfone indisponível: {}", e))?;
    let in_rate = config.sample_rate().0;
    let channels = config.channels() as usize;
    let err_fn = |e| eprintln!("Erro no stream de áudio: {}", e);

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config.into(),
            move |data: &[f32], _| {
                let _ = tx.send(Msg::Mic(data.to_vec()));
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config.into(),
            move |data: &[i16], _| {
                let _ = tx.send(Msg::Mic(data.iter().map(|s| *s as f32 / 32768.0).collect()));
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::U16 => device.build_input_stream(
            &config.into(),
            move |data: &[u16], _| {
                let _ = tx.send(Msg::Mic(
                    data.iter()
                        .map(|s| (*s as f32 - 32768.0) / 32768.0)
                        .collect(),
                ));
            },
            err_fn,
            None,
        ),
        other => return Err(format!("Formato de amostra não suportado: {:?}", other)),
    }
    .map_err(|e| format!("Falha ao abrir o microfone: {}", e))?;
    stream
        .play()
        .map_err(|e| format!("Falha ao iniciar a captura: {}", e))?;
    Ok((stream, in_rate, channels))
}

struct RecordingJob {
    app: AppHandle,
    path: std::path::PathBuf,
    filename: String,
    note_id: String,
    stop: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
    meeting_stop: Arc<AtomicBool>,
    auto_stop: Option<Duration>,
    want_system_audio: bool,
    live: bool,
    ready_tx: mpsc::SyncSender<Result<StartInfo, String>>,
}

/// Chamado pelo mic_monitor quando o app de reunião solta o microfone.
/// Sinaliza a gravação ativa (se houver e se ela aceita esse encerramento);
/// a própria thread de gravação finaliza, remove-se do estado e emite
/// `recording-finished` com reason "meeting".
pub fn request_meeting_stop(app: &AppHandle) {
    let state = app.state::<RecorderState>();
    if let Ok(guard) = state.0.lock() {
        if let Some(active) = guard.as_ref() {
            if active.stop_on_meeting_end {
                active.meeting_stop.store(true, Ordering::Relaxed);
            }
        }
    };
}

fn run_recording(job: RecordingJob) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<Msg>();

    // Microfone é obrigatório; áudio do sistema é melhor-esforço (cai para
    // mic-only se a permissão de gravação de tela/áudio não foi concedida).
    let mic = setup_microphone(tx.clone());
    let (mic_stream, in_rate, channels) = match mic {
        Ok(v) => v,
        Err(e) => {
            let _ = job.ready_tx.send(Err(e.clone()));
            return Err(e);
        }
    };

    let (sys_stream, warning) = if job.want_system_audio {
        match setup_system_audio(tx.clone()) {
            Ok(s) => (Some(s), None),
            Err(e) => (None, Some(e)),
        }
    } else {
        (None, None)
    };
    drop(tx);

    let has_system_audio = sys_stream.is_some();
    let _ = job.ready_tx.send(Ok(StartInfo {
        system_audio: has_system_audio,
        warning,
    }));

    let mut encoder = build_mp3_encoder()?;

    let file =
        fs::File::create(&job.path).map_err(|e| format!("Falha ao criar o arquivo: {}", e))?;
    let mut writer = std::io::BufWriter::new(file);

    // Sidecars mono separados por canal — habilitados apenas quando há áudio do
    // sistema (sem ele, o mixado já é só o microfone). Cada canal é gravado no
    // seu nível nativo (sem o desbalanceamento da mistura), o que permite
    // transcrever microfone e sistema isoladamente e mesclar com rótulo de quem
    // falou — base para os "meus" itens de ação.
    let mic_filename = has_system_audio.then(|| mic_sidecar_name(&job.filename));
    let sys_filename = has_system_audio.then(|| sys_sidecar_name(&job.filename));
    let mic_path = mic_filename.as_ref().map(|n| job.path.with_file_name(n));
    let sys_path = sys_filename.as_ref().map(|n| job.path.with_file_name(n));
    let (mut mic_encoder, mut mic_writer) = open_sidecar(&mic_path, "do microfone")?;
    let (mut sys_encoder, mut sys_writer) = open_sidecar(&sys_path, "do sistema")?;

    let mut resampler = LinearResampler::new(in_rate, TARGET_SAMPLE_RATE);
    let mut mic_fifo: Vec<f32> = Vec::with_capacity(ENCODE_CHUNK_SAMPLES * 4);
    let mut sys_fifo: Vec<f32> = Vec::with_capacity(SYS_FIFO_MAX_SAMPLES);
    let mut pcm_i16: Vec<i16> = Vec::with_capacity(ENCODE_CHUNK_SAMPLES);
    let mut side_pcm: Vec<i16> = Vec::with_capacity(ENCODE_CHUNK_SAMPLES);
    let mut total_samples: u64 = 0;
    let mut peak = 0f32;
    let mut last_level_emit = Instant::now();
    let mut silence_since: Option<Instant> = None;
    // "manual" = stop_recording assumiu o estado; nos demais a thread se remove.
    let mut finish_reason = "manual";

    // Sessão de transcrição ao vivo (opcional): encaminha o mix conforme grava.
    // Se o modelo não estiver baixado, cai silenciosamente para batch.
    let mut live_handle: Option<crate::transcriber::LiveHandle> = if job.live {
        crate::transcriber::spawn_live_session(&job.app, job.note_id.clone()).ok()
    } else {
        None
    };

    // Processa um lote: mic é o clock mestre; o sistema entra do FIFO (zeros se
    // faltar). Grava os sidecars por canal (microfone pré-mix e sistema alinhado)
    // e o arquivo mixado para playback. Retorna o RMS do mix p/ detecção de silêncio.
    let mut mix_and_encode = |mic_chunk: &mut Vec<f32>,
                              sys_fifo: &mut Vec<f32>,
                              encoder: &mut mp3lame_encoder::Encoder,
                              writer: &mut std::io::BufWriter<fs::File>,
                              peak: &mut f32,
                              total: &mut u64,
                              live: &Option<crate::transcriber::LiveHandle>|
     -> Result<f32, String> {
        if mic_chunk.is_empty() {
            return Ok(0.0);
        }
        let n = mic_chunk.len();
        let take = n.min(sys_fifo.len());

        // Sidecar do microfone (pré-mix) — o que VOCÊ falou.
        if let (Some(enc), Some(w)) = (mic_encoder.as_mut(), mic_writer.as_mut()) {
            side_pcm.clear();
            for v in mic_chunk.iter() {
                let v = v.clamp(-1.0, 1.0);
                side_pcm.push((v * i16::MAX as f32) as i16);
            }
            encode_and_write(enc, &side_pcm, w)?;
        }
        // Sidecar do sistema (alinhado ao mic, zero-padded) — o que os OUTROS falaram.
        if let (Some(enc), Some(w)) = (sys_encoder.as_mut(), sys_writer.as_mut()) {
            side_pcm.clear();
            for i in 0..n {
                let v = if i < take { sys_fifo[i] } else { 0.0 };
                let v = v.clamp(-1.0, 1.0);
                side_pcm.push((v * i16::MAX as f32) as i16);
            }
            encode_and_write(enc, &side_pcm, w)?;
        }

        // Mix: soma o sistema no microfone e codifica o arquivo principal.
        for (i, s) in sys_fifo.drain(..take).enumerate() {
            mic_chunk[i] += s;
        }
        let mut sq_sum = 0f64;
        pcm_i16.clear();
        for v in mic_chunk.iter() {
            let v = v.clamp(-1.0, 1.0);
            let a = v.abs();
            if a > *peak {
                *peak = a;
            }
            sq_sum += (v as f64) * (v as f64);
            pcm_i16.push((v * i16::MAX as f32) as i16);
        }
        let rms = (sq_sum / n as f64).sqrt() as f32;
        *total += n as u64;
        encode_and_write(encoder, &pcm_i16, writer)?;
        // Transcrição ao vivo: encaminha o mix (todos) antes de limpar o lote.
        if let Some(h) = live.as_ref() {
            h.feed(mic_chunk.clone());
        }
        mic_chunk.clear();
        Ok(rms)
    };

    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(Msg::Mic(raw)) => {
                resampler.process_interleaved(&raw, channels, &mut mic_fifo);
                while mic_fifo.len() >= ENCODE_CHUNK_SAMPLES {
                    let mut chunk: Vec<f32> = mic_fifo.drain(..ENCODE_CHUNK_SAMPLES).collect();
                    let rms = mix_and_encode(
                        &mut chunk,
                        &mut sys_fifo,
                        &mut encoder,
                        &mut writer,
                        &mut peak,
                        &mut total_samples,
                        &live_handle,
                    )?;
                    if rms < SILENCE_RMS_THRESHOLD {
                        if silence_since.is_none() {
                            silence_since = Some(Instant::now());
                        }
                    } else {
                        silence_since = None;
                    }
                }
                if last_level_emit.elapsed() >= Duration::from_millis(150) {
                    let _ = job.app.emit("recording-level", LevelPayload { level: peak });
                    peak = 0.0;
                    last_level_emit = Instant::now();
                }
            }
            Ok(Msg::Sys(v)) => {
                sys_fifo.extend(v);
                if sys_fifo.len() > SYS_FIFO_MAX_SAMPLES {
                    let excess = sys_fifo.len() - SYS_FIFO_MAX_SAMPLES;
                    sys_fifo.drain(..excess);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
        if job.stop.load(Ordering::Relaxed) {
            break;
        }
        if job.meeting_stop.load(Ordering::Relaxed) {
            finish_reason = "meeting";
            break;
        }
        if let (Some(limit), Some(t0)) = (job.auto_stop, silence_since) {
            if t0.elapsed() >= limit {
                finish_reason = "auto";
                break;
            }
        }
    }

    // Encerra as capturas e drena o que restou no canal.
    drop(mic_stream);
    if let Some(s) = &sys_stream {
        let _ = s.stop_capture();
    }
    if job.cancel.load(Ordering::Relaxed) {
        // Descarte: o comando cancel_recording apaga o arquivo principal; aqui
        // soltamos e removemos os sidecars por canal e abortamos o ao vivo.
        if let Some(h) = live_handle.take() {
            h.abort();
        }
        drop(mic_writer.take());
        drop(mic_encoder.take());
        drop(sys_writer.take());
        drop(sys_encoder.take());
        for p in [mic_path.as_ref(), sys_path.as_ref()].into_iter().flatten() {
            let _ = fs::remove_file(p);
        }
        return Ok(());
    }
    while let Ok(msg) = rx.try_recv() {
        if let Msg::Mic(raw) = msg {
            resampler.process_interleaved(&raw, channels, &mut mic_fifo);
        }
    }
    let mut rest: Vec<f32> = std::mem::take(&mut mic_fifo);
    mix_and_encode(
        &mut rest,
        &mut sys_fifo,
        &mut encoder,
        &mut writer,
        &mut peak,
        &mut total_samples,
        &live_handle,
    )?;

    // Encerra a transcrição ao vivo: transcreve o resto e aguarda o worker.
    if let Some(h) = live_handle.take() {
        h.finish();
    }

    let mut tail: Vec<u8> = Vec::with_capacity(7200);
    let n = encoder
        .flush::<mp3lame_encoder::FlushNoGap>(tail.spare_capacity_mut())
        .map_err(|e| format!("Falha ao finalizar o MP3: {:?}", e))?;
    // SAFETY: o encoder inicializou exatamente `n` bytes do spare capacity.
    unsafe { tail.set_len(n) };
    writer.write_all(&tail).map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())?;

    // Finaliza os sidecars por canal, se houver.
    finish_sidecar(mic_encoder.take(), mic_writer.take())?;
    finish_sidecar(sys_encoder.take(), sys_writer.take())?;

    // Nos encerramentos automáticos (silêncio/fim de reunião) a thread é dona
    // do encerramento: remove a gravação do estado antes de anunciar. No stop
    // manual o comando já a removeu.
    if finish_reason != "manual" {
        let st = job.app.state::<RecorderState>();
        if let Ok(mut g) = st.0.lock() {
            if g.as_ref().map(|a| a.filename == job.filename) == Some(true) {
                g.take();
            }
        };
    }

    let size_bytes = fs::metadata(&job.path).map(|m| m.len()).unwrap_or(0);
    let _ = job.app.emit(
        "recording-finished",
        FinishedPayload {
            note_id: job.note_id.clone(),
            filename: job.filename.clone(),
            mic_filename: mic_filename.clone(),
            duration_secs: total_samples / TARGET_SAMPLE_RATE as u64,
            size_bytes,
            reason: finish_reason.to_string(),
        },
    );
    Ok(())
}
