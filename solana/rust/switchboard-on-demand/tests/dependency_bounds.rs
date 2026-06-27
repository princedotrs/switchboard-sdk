fn dependency_line<'a>(manifest: &'a str, name: &str) -> &'a str {
    let prefix = format!("{name} = ");
    manifest
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with(&prefix))
        .unwrap_or_else(|| panic!("missing dependency line for {}", name))
}

#[test]
fn solana_v2_dependencies_start_at_the_client_compatible_2_1_line() {
    let manifest = include_str!("../Cargo.toml");

    for dependency in [
        "solana-account-decoder-v2",
        "solana-client-v2",
        "solana-program-v2",
        "solana-sdk-v2",
    ] {
        let line = dependency_line(manifest, dependency);
        assert!(
            line.contains("version = \">=2.1,<3\""),
            "{} must stay bounded to Solana >=2.1,<3 because the client feature uses SPL crates that require Solana 2.1+; got `{}`",
            dependency,
            line
        );
    }
}

#[test]
fn solana_v3_dependencies_do_not_resolve_to_solana_4_x() {
    let manifest = include_str!("../Cargo.toml");

    for dependency in [
        "solana-account-decoder-v3",
        "solana-client-v3",
        "solana-program-v3",
        "solana-sdk-v3",
    ] {
        let line = dependency_line(manifest, dependency);
        assert!(
            line.contains("version = \">=3,<4\""),
            "{} must stay bounded to Solana 3.x because the v3 compatibility layer uses 3.x module paths; got `{}`",
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
        line.contains("version = \">=0.1.17, <0.2\""),
        "tokio-stream must stay bounded to the compatible 0.1 line; got `{}`",
        line
    );
}

#[test]
fn optional_anchor_dependency_stays_on_the_compatible_0_31_line() {
    let manifest = include_str!("../Cargo.toml");
    let line = dependency_line(manifest, "anchor-lang");

    assert!(
        line.contains("version = \">=0.31.0, <0.32\""),
        "anchor-lang must stay bounded to the compatible 0.31 line; got `{}`",
        line
    );
}

#[test]
fn switchboard_protos_dependency_stays_on_the_compatible_0_2_line() {
    let manifest = include_str!("../Cargo.toml");
    let line = dependency_line(manifest, "switchboard-protos");

    assert!(
        line.contains("\">=0.2.3, <0.3\""),
        "switchboard-protos must stay bounded to the compatible 0.2 line; got `{}`",
        line
    );
}
