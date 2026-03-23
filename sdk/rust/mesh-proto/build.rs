fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));

    // Prefer local proto directory inside the crate (packaged with the crate).
    // If not present (dev workflow), fall back to repo-level proto directory.
    let local_proto = manifest_dir.join("proto/amp/dataplane/v1/dataplane.proto");
    let (proto_path, proto_include) = if local_proto.exists() {
        (local_proto, manifest_dir.join("proto"))
    } else {
        // repo root relative to this crate
        let repo_root = manifest_dir.join("../../../");
        (repo_root.join("proto/amp/dataplane/v1/dataplane.proto"), repo_root.join("proto"))
    };

    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .compile(&[proto_path], &[proto_include])?;
    Ok(())
}
