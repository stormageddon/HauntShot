fn main() {
    // Baked into the binary by `api_base()`, so a change has to force a rebuild.
    println!("cargo:rerun-if-env-changed=HAUNTSHOT_API_BASE");
    tauri_build::build()
}
