fn main() {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    println!("cargo:rustc-env=SKM_BUILD_SECS={secs}");
    println!("cargo:rerun-if-changed=src");
}
