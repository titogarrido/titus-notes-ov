// Smoke test da transcrição local, fora do app:
//   cargo run --example transcribe_smoke -- <model_dir> <audio.mp3> [segundos]
//
// Decodifica o MP3 com o mesmo caminho de código do app e transcreve os
// primeiros N segundos (padrão 90) com o Parakeet v3 int8.

use std::path::PathBuf;
use transcribe_rs::onnx::parakeet::ParakeetModel;
use transcribe_rs::onnx::Quantization;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("uso: transcribe_smoke <model_dir> <audio.mp3> [segundos]");
        std::process::exit(2);
    }
    let model_dir = PathBuf::from(&args[1]);
    let audio = PathBuf::from(&args[2]);
    let secs: f32 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(90.0);

    let t0 = std::time::Instant::now();
    let samples =
        titus_notes_lib::transcriber::decode_to_16k_mono(&audio, |_| true).expect("decode mp3");
    println!(
        "decodificado: {} amostras ({:.1}s de áudio) em {:.1}s",
        samples.len(),
        samples.len() as f32 / 16000.0,
        t0.elapsed().as_secs_f32()
    );

    let take = ((secs * 16000.0) as usize).min(samples.len());
    let t1 = std::time::Instant::now();
    let mut model = ParakeetModel::load(&model_dir, &Quantization::Int8).expect("load model");
    println!("modelo carregado em {:.1}s", t1.elapsed().as_secs_f32());

    let t2 = std::time::Instant::now();
    let text = titus_notes_lib::transcriber::transcribe_samples_chunked(
        &mut model,
        &samples[..take],
        |processed| {
            println!("  progresso: {:.0}s / {:.0}s", processed, take as f32 / 16000.0);
            true
        },
    )
    .expect("transcribe");
    println!(
        "transcritos {:.1}s de áudio em {:.1}s ({:.1}x tempo real)\n",
        take as f32 / 16000.0,
        t2.elapsed().as_secs_f32(),
        (take as f32 / 16000.0) / t2.elapsed().as_secs_f32()
    );
    println!("{}", text);
}
