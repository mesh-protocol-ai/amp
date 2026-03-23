// mesh-proto: generated protobuf types will be available via `tonic_build` in OUT_DIR
// Consumers should depend on this crate to get generated DataPlane types.

// tonic_build will place generated files in OUT_DIR. Include the generated module.
include!(concat!(env!("OUT_DIR"), "/amp.dataplane.v1.rs"));
