fn main() {
    // `option_env!` alone is not enough: Cargo can re-run this script when the
    // env changes and then skip recompiling the crate if nothing in the script
    // output changed. Emitting rustc-env ties the value into the compile unit.
    println!("cargo:rerun-if-env-changed=HAUNTSHOT_API_BASE");
    match std::env::var("HAUNTSHOT_API_BASE") {
        Ok(base) if !base.is_empty() => {
            println!("cargo:rustc-env=HAUNTSHOT_API_BASE={base}");
        }
        _ => {}
    }
    tauri_build::build()
}
