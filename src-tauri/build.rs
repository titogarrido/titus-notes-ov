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
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
        if let Ok(output) = std::process::Command::new("xcode-select").arg("-p").output() {
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
