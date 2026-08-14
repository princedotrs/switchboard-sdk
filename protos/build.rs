use std::{env, fs, path::PathBuf};

fn main() {
    let protoc = protoc_bin_vendored::protoc_bin_path().unwrap();
    env::set_var("PROTOC", protoc);

    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let fds_path = out_dir.join("oracle_job.fds.bin");

    let mut config = prost_build::Config::new();
    config.file_descriptor_set_path(&fds_path);
    config
        .compile_protos(&["job_schemas.proto"], &["."])
        .unwrap();

    let descriptors = fs::read(&fds_path).unwrap();
    let mut builder = pbjson_build::Builder::new();
    builder.register_descriptors(&descriptors).unwrap();
    builder.ignore_unknown_fields();
    builder.build(&[".oracle_job"]).unwrap();
}
