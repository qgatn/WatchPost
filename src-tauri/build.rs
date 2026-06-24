use std::fs;
use std::path::Path;

fn main() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));

    let tauri_conf_text =
        fs::read_to_string(root.join("tauri.conf.json")).expect("read tauri.conf.json");
    let tauri_conf: serde_json::Value =
        serde_json::from_str(&tauri_conf_text).expect("parse tauri.conf.json");
    let version = tauri_conf["version"]
        .as_str()
        .expect("tauri.conf.json missing version");

    let cargo_toml = fs::read_to_string(root.join("Cargo.toml")).expect("read Cargo.toml");
    let cargo_version = cargo_toml
        .lines()
        .find_map(|line| {
            let line = line.trim();
            line.strip_prefix("version = ")
                .and_then(|rest| rest.trim().strip_prefix('"'))
                .and_then(|v| v.strip_suffix('"'))
        })
        .expect("Cargo.toml missing version");
    if cargo_version != version {
        panic!(
            "version mismatch: tauri.conf.json={version} Cargo.toml={cargo_version} — keep them in sync"
        );
    }

    let pkg_text = fs::read_to_string(root.join("../package.json")).expect("read package.json");
    let pkg: serde_json::Value = serde_json::from_str(&pkg_text).expect("parse package.json");
    let pkg_version = pkg["version"]
        .as_str()
        .expect("package.json missing version");
    if pkg_version != version {
        panic!(
            "version mismatch: tauri.conf.json={version} package.json={pkg_version} — run: node scripts/sync-version.mjs {version}"
        );
    }

    let meta_text = fs::read_to_string(root.join("app-meta.json")).expect("read app-meta.json");
    let meta: serde_json::Value = serde_json::from_str(&meta_text).expect("parse app-meta.json");
    let author = meta["author"]
        .as_str()
        .expect("app-meta.json missing author");
    let copyright = meta["copyright"].as_str().unwrap_or(author);

    let build_utc = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    let gen_dir = root.join("gen");
    fs::create_dir_all(&gen_dir).expect("create gen/");
    let about = format!(
        "# WatchPost — About this build\n\n\
         Version: {version}\n\
         Built (UTC): {build_utc}\n\
         Author: {author}\n\
         {copyright}\n\n\
         WatchPost is a lightweight desktop monitor for your PC and remote Linux servers over SSH.\n\n\
         ## Where this file lives\n\n\
         This file is bundled inside the app package at build time (`npm run package`).\n\
         It is regenerated on every release build with the version and build timestamp above.\n\n\
         ## More help\n\n\
         - SSH setup: see the project wiki FAQ\n\
         - Build from source: wiki/Build-from-source.md in the repository\n"
    );
    fs::write(gen_dir.join("ABOUT.md"), about).expect("write gen/ABOUT.md");

    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=app-meta.json");
    println!("cargo:rerun-if-changed=Cargo.toml");
    println!("cargo:rerun-if-changed=../package.json");

    println!("cargo:rustc-env=WATCHPOST_VERSION={version}");
    println!("cargo:rustc-env=WATCHPOST_AUTHOR={author}");
    println!("cargo:rustc-env=WATCHPOST_COPYRIGHT={copyright}");
    println!("cargo:rustc-env=WATCHPOST_BUILD_UTC={build_utc}");

    tauri_build::build()
}
