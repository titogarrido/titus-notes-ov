//! Local voice signatures. Only explicit user enrollment updates a person's profile.
use crate::diarizer::{self, Manifest, ModelStatus, VoiceTurn};
use crate::transcriber::{self, ActiveTranscription, TranscriberState};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, State};

pub const MODEL_ID: &str = "redimnet2-b6-1272aa38";
#[derive(Default)]
pub struct VoiceIdentityState {
    downloading: AtomicBool,
    cancel: AtomicBool,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VoiceSignature {
    pub model: String,
    pub embedding: Vec<f32>,
    pub duration: f32,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VoiceSample {
    #[serde(flatten)]
    pub signature: VoiceSignature,
    pub source_note_id: String,
    pub filename: String,
    pub created_at: String,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VoiceProfile {
    pub model: String,
    pub samples: Vec<VoiceSample>,
    pub is_self: bool,
    pub updated_at: String,
}
fn manifest() -> Manifest {
    serde_json::from_str(include_str!("../diarization/voice-model-manifest.json"))
        .expect("checked-in voice manifest")
}
fn model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models/redimnet2-b6-coreml"))
}
pub(crate) fn ready(app: &AppHandle) -> Result<bool, String> {
    Ok(diarizer::model_status(&model_dir(app)?, &manifest(), false)?.ready)
}
#[tauri::command]
pub fn voice_identity_model_status(
    app: AppHandle,
    state: State<'_, VoiceIdentityState>,
) -> Result<ModelStatus, String> {
    diarizer::model_status(
        &model_dir(&app)?,
        &manifest(),
        state.downloading.load(Ordering::SeqCst),
    )
}
#[tauri::command]
pub fn cancel_voice_identity_model_download(state: State<'_, VoiceIdentityState>) {
    state.cancel.store(true, Ordering::SeqCst);
}
#[tauri::command]
pub fn download_voice_identity_model(
    app: AppHandle,
    state: State<'_, VoiceIdentityState>,
) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("Reconhecimento de voz Core ML disponível apenas no macOS.".into());
    }
    if state
        .downloading
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Download de reconhecimento de voz em andamento.".into());
    }
    state.cancel.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn(async move {
        let state = app.state::<VoiceIdentityState>();
        let result = match model_dir(&app) {
            Ok(dir) => {
                diarizer::download_model(
                    &app,
                    manifest(),
                    dir,
                    &state.cancel,
                    "voice-identity-model-progress",
                )
                .await
            }
            Err(error) => Err(error),
        };
        state.downloading.store(false, Ordering::SeqCst);
        match result {
            Ok(()) => {
                let _ = app.emit("voice-identity-model-finished", ());
            }
            Err(message) => {
                let _ = app.emit(
                    "voice-identity-model-error",
                    serde_json::json!({"message": message}),
                );
            }
        }
    });
    Ok(())
}

// Subtract every other voice before enrollment. No fallback to overlapping audio.
// Leave 150 ms at boundaries to reduce diarization jitter and use at most 6 s.
fn clean_ranges(turns: &[VoiceTurn], sample_count: usize) -> Vec<VoiceTurn> {
    let total = sample_count as f32 / 16000.0;
    let valid: Vec<_> = turns
        .iter()
        .filter(|t| {
            t.start.is_finite()
                && t.end.is_finite()
                && t.start >= 0.0
                && t.end > t.start
                && t.end <= total + 0.1
                && t.speaker_id < 8
        })
        .collect();
    let mut output = Vec::new();
    for id in 0..8 {
        let mut clean = Vec::new();
        for own in valid.iter().filter(|t| t.speaker_id == id) {
            let mut pieces = vec![(own.start, own.end.min(total))];
            for other in valid.iter().filter(|t| t.speaker_id != id) {
                pieces = pieces
                    .into_iter()
                    .flat_map(|(start, end)| {
                        if other.end <= start || other.start >= end {
                            return vec![(start, end)];
                        }
                        let mut remaining = Vec::new();
                        if other.start > start {
                            remaining.push((start, other.start));
                        }
                        if other.end < end {
                            remaining.push((other.end, end));
                        }
                        remaining
                    })
                    .collect();
            }
            clean.extend(
                pieces
                    .into_iter()
                    .map(|(s, e)| (s + 0.15, e - 0.15))
                    .filter(|(s, e)| e - s >= 2.0),
            );
        }
        if let Some((start, end)) = clean
            .into_iter()
            .max_by(|a, b| (a.1 - a.0).total_cmp(&(b.1 - b.0)))
        {
            let duration = (end - start).min(6.0);
            let start = start + ((end - start) - duration) / 2.0;
            output.push(VoiceTurn {
                start,
                end: start + duration,
                speaker_id: id,
            });
        }
    }
    output
}

pub(crate) fn signatures(
    app: &AppHandle,
    state: &TranscriberState,
    samples: &[f32],
    turns: &[VoiceTurn],
) -> Result<HashMap<u32, VoiceSignature>, String> {
    signatures_for(app, state, samples, turns, None)
}
fn signatures_for(
    app: &AppHandle,
    state: &TranscriberState,
    samples: &[f32],
    turns: &[VoiceTurn],
    target: Option<u32>,
) -> Result<HashMap<u32, VoiceSignature>, String> {
    let ranges: Vec<_> = clean_ranges(turns, samples.len())
        .into_iter()
        .filter(|range| target.is_none_or(|id| range.speaker_id == id))
        .collect();
    if ranges.is_empty() {
        return Ok(HashMap::new());
    }
    let args = vec![
        "identity".to_string(),
        serde_json::to_string(&ranges).map_err(|e| e.to_string())?,
    ];
    let result = diarizer::run_coreml(
        app,
        state,
        samples,
        &model_dir(app)?,
        &args,
        "signatures",
        |_| {},
    )?;
    let signatures: HashMap<u32, VoiceSignature> =
        serde_json::from_value(result).map_err(|e| e.to_string())?;
    if signatures.values().any(|s| {
        s.model != MODEL_ID
            || s.embedding.len() != 192
            || !s.duration.is_finite()
            || s.duration < 2.0
            || s.embedding.iter().any(|v| !v.is_finite())
            || s.embedding.iter().map(|v| v * v).sum::<f32>() < 0.001
    }) {
        return Err("O modelo retornou um perfil de voz inválido.".into());
    }
    Ok(signatures)
}

#[tauri::command]
pub async fn voice_profile_sample(
    app: AppHandle,
    note_id: String,
    filename: String,
    speaker_id: u32,
    turns: Vec<VoiceTurn>,
) -> Result<VoiceSignature, String> {
    if !crate::is_safe_filename(&filename) || speaker_id >= 8 || turns.len() > 50_000 {
        return Err("Dados de áudio inválidos.".into());
    }
    if !ready(&app)? {
        return Err("Baixe o modelo de reconhecimento de voz primeiro.".into());
    }
    if app
        .state::<crate::recorder::RecorderState>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .is_some()
    {
        return Err("Finalize a gravação antes de salvar o perfil.".into());
    }
    let state = app.state::<TranscriberState>();
    {
        let mut active = state.active.lock().map_err(|e| e.to_string())?;
        if active.is_some() {
            return Err("Já há um áudio sendo processado. Aguarde ou cancele.".into());
        }
        state.cancel.store(false, Ordering::SeqCst);
        let job = ActiveTranscription {
            note_id,
            filename: filename.clone(),
            phase: "identifying".into(),
            processed_secs: 0.0,
            total_secs: 0.0,
        };
        *active = Some(job.clone());
        let _ = app.emit("transcription-progress", job);
    }
    let worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let state = worker.state::<TranscriberState>();
            let samples = transcriber::decode_to_16k_mono(&crate::get_audio_dir(&worker)?.join(filename), |_| !state.cancel.load(Ordering::SeqCst))?;
            // Keep other turns: removing them would accidentally enroll overlapping speech.
            let signatures = signatures_for(&worker, &state, &samples, &turns, Some(speaker_id))?;
            signatures.get(&speaker_id).cloned().ok_or_else(|| "Este interlocutor precisa de ao menos 2 segundos de fala sem sobreposição para salvar um perfil.".into())
        })).unwrap_or_else(|_| Err("A extração do perfil de voz foi interrompida.".into()))
    }).await.map_err(|e| e.to_string()).and_then(|r| r);
    if let Ok(mut active) = state.active.lock() {
        *active = None;
    }
    let _ = app.emit("voice-profile-sample-finished", ());
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[cfg(target_os = "macos")]
    #[ignore = "requires pinned ReDimNet Core ML weights and /tmp/titus-voices.f32 two-voice fixture"]
    fn coreml_voice_signatures_distinguish_speakers_and_tolerate_gain() {
        let model = std::env::var("TITUS_IDENTITY_TEST_MODEL").expect("identity weights");
        let pcm = std::env::var("TITUS_IDENTITY_TEST_PCM").expect("two-voice Float32 fixture");
        let ranges =
            r#"[{"speakerId":0,"start":0.6,"end":3.8},{"speakerId":1,"start":5.71,"end":7.79}]"#;
        let infer = |path: &std::path::Path| -> HashMap<u32, VoiceSignature> {
            let result = std::process::Command::new(concat!(env!("OUT_DIR"), "/titus-diarize"))
                .arg(&model)
                .arg(path)
                .args(["identity", ranges])
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stdout)
            );
            let json = String::from_utf8(result.stdout).unwrap();
            let payload: serde_json::Value =
                serde_json::from_str(json.lines().last().unwrap()).unwrap();
            serde_json::from_value(payload["signatures"].clone()).unwrap()
        };
        let first = infer(std::path::Path::new(&pcm));
        let temp =
            std::env::temp_dir().join(format!("titus-identity-test-{}.f32", uuid::Uuid::new_v4()));
        let bytes = std::fs::read(&pcm).unwrap();
        let quieter: Vec<u8> = bytes
            .chunks_exact(4)
            .flat_map(|b| (f32::from_le_bytes(b.try_into().unwrap()) * 0.5).to_le_bytes())
            .collect();
        std::fs::write(&temp, quieter).unwrap();
        let second = infer(&temp);
        std::fs::remove_file(temp).unwrap();
        for sample in first.values() {
            assert_eq!(sample.model, MODEL_ID);
            assert_eq!(sample.embedding.len(), 192);
            assert!((sample.embedding.iter().map(|v| v * v).sum::<f32>() - 1.0).abs() < 0.001);
        }
        let cosine = |a: &VoiceSignature, b: &VoiceSignature| {
            a.embedding
                .iter()
                .zip(&b.embedding)
                .map(|(x, y)| x * y)
                .sum::<f32>()
        };
        let different = cosine(&first[&0], &first[&1]);
        let same = cosine(&first[&0], &second[&0]);
        assert!(
            different < 0.55,
            "Different test voices were conflated: {different}"
        );
        assert!(
            same > 0.80,
            "Same voice at lower gain was not recognized: {same}"
        );
        println!("ReDimNet: two 192-D normalized signatures; same voice/lower gain {same:.3}, different voice {different:.3}");
    }
    #[test]
    fn enrollment_excludes_overlap_short_and_invalid_turns() {
        let turns = vec![
            VoiceTurn {
                start: 0.0,
                end: 10.0,
                speaker_id: 0,
            },
            VoiceTurn {
                start: 0.0,
                end: 4.0,
                speaker_id: 1,
            },
            VoiceTurn {
                start: 7.0,
                end: 10.0,
                speaker_id: 1,
            },
        ];
        let ranges = clean_ranges(&turns, 160_000);
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0].speaker_id, 0);
        assert!((ranges[0].start - 4.15).abs() < 0.001);
        assert!((ranges[0].end - 6.85).abs() < 0.001);
        assert!(clean_ranges(
            &[
                VoiceTurn {
                    start: 0.0,
                    end: 1.9,
                    speaker_id: 0
                },
                VoiceTurn {
                    start: f32::NAN,
                    end: 5.0,
                    speaker_id: 1
                }
            ],
            160_000
        )
        .is_empty());
    }
    #[test]
    fn profile_survives_database_serialization_and_old_people_load() {
        let mut person: crate::Person = serde_json::from_value(serde_json::json!({"id":"p", "name":"Ana", "role":"", "email":"", "department":"", "managerId":null})).unwrap();
        assert!(person.voice_profile.is_none());
        person.voice_profile = Some(VoiceProfile {
            model: MODEL_ID.into(),
            is_self: true,
            updated_at: "now".into(),
            samples: vec![VoiceSample {
                signature: VoiceSignature {
                    model: MODEL_ID.into(),
                    embedding: vec![0.1; 192],
                    duration: 3.0,
                },
                source_note_id: "n".into(),
                filename: "audio.mp3".into(),
                created_at: "now".into(),
            }],
        });
        let restored: crate::Person =
            serde_json::from_str(&serde_json::to_string(&person).unwrap()).unwrap();
        let profile = restored.voice_profile.unwrap();
        assert_eq!(profile.samples[0].signature.embedding.len(), 192);
        assert_eq!(profile.samples[0].source_note_id, "n");
        assert!(profile.is_self);
    }
}
