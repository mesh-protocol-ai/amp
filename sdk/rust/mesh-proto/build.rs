fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    // repo root relative to this crate: ../../.. (mesh-proto -> mesh-rust -> sdk -> repo root)
    let repo_root = manifest_dir.join("../../../");
    let proto_path = repo_root.join("proto/amp/dataplane/v1/dataplane.proto");
    let proto_include = repo_root.join("proto");

    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .compile(&[proto_path], &[proto_include])?;
    Ok(())
}
