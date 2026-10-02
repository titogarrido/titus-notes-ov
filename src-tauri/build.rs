fn main() {
    // O bridge Swift do crate `screencapturekit` (áudio do sistema na gravação
    // de reuniões) linka contra @rpath/libswift_*.dylib. O rpath que o build
    // script do crate emite NÃO se propaga para binários de pacotes
    // dependentes (`cargo:rustc-link-arg` só vale para os targets do próprio
    // pacote), então precisamos bake-ar os rpaths aqui:
    //  - /usr/lib/swift: runtime do sistema (dyld shared cache, macOS 12+)
    //  - toolchain do Xcode: onde vive libswift_Concurrency.dylib em dev
    #[cfg(target_os = "macos")]
    {
        // Pure Core ML helper; embedded in the Rust executable so installed apps
        // need neither Xcode nor a separately installed Swift/MLX runtime.
        let out = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
        let source_dir = std::path::Path::new("diarization");
        println!("cargo:rerun-if-changed=diarization");
        let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap();
        let swift_arch = if arch == "aarch64" { "arm64" } else { &arch };
        let mut sources = std::fs::read_dir(source_dir.join("vendor"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "swift"))
            .collect::<Vec<_>>();
        sources.sort();
        sources.push(source_dir.join("Main.swift"));
        let status = std::process::Command::new("xcrun")
            .args([
                "swiftc",
                "-O",
                "-whole-module-optimization",
                "-parse-as-library",
                "-target",
            ])
            .arg(format!("{swift_arch}-apple-macosx15.0"))
            .arg("-module-cache-path")
            .arg(out.join("swift-module-cache"))
            .args(sources)
            .arg("-o")
            .arg(out.join("titus-diarize"))
            .status()
            .expect("Xcode Swift compiler is required for Core ML diarization");
        assert!(
            status.success(),
            "Could not compile Core ML diarization helper"
        );
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
        if let Ok(output) = std::process::Command::new("xcode-select")
            .arg("-p")
            .output()
        {
            if output.status.success() {
                let xcode_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                println!(
                    "cargo:rustc-link-arg=-Wl,-rpath,{xcode_path}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx"
                );
                println!(
                    "cargo:rustc-link-arg=-Wl,-rpath,{xcode_path}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift-5.5/macosx"
                );
            }
        }
    }
    tauri_build::build()
}
