fn dependency_line<'a>(manifest: &'a str, name: &str) -> &'a str {
    let prefix = format!("{name} = ");
    manifest
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with(&prefix))
        .unwrap_or_else(|| panic!("missing dependency line for {}", name))
}

#[test]
fn solana_dependencies_do_not_resolve_past_supported_1_x_api() {
    let manifest = include_str!("../Cargo.toml");

    for dependency in ["solana-client", "solana-sdk"] {
        let line = dependency_line(manifest, dependency);
        assert!(
            line.contains("\">=1.18.22, <2\""),
            "{} must stay bounded to Solana 1.x because this crate uses 1.x SDK module paths; got `{}`",
            dependency,
            line
        );
    }
}

#[test]
fn tokio_stream_dependency_stays_on_the_compatible_0_1_line() {
    let manifest = include_str!("../Cargo.toml");
    let line = dependency_line(manifest, "tokio-stream");

    assert!(
        line.contains("\">=0.1.17, <0.2\""),
        "tokio-stream must stay bounded to the compatible 0.1 line; got `{}`",
        line
    );
}
