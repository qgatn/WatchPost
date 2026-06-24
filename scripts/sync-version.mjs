#!/usr/bin/env node
/**
 * Set the app version in all manifest files (must stay in sync for Tauri builds).
 * Usage: node scripts/sync-version.mjs 0.2.1
 *        node scripts/sync-version.mjs v0.2.1   (leading v is stripped)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/sync-version.mjs <version>");
  process.exit(1);
}
if (version.startsWith("v")) version = version.slice(1);
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Invalid semver: ${version}`);
  process.exit(1);
}

function readJson(rel) {
  const file = path.join(root, rel);
  return { file, data: JSON.parse(fs.readFileSync(file, "utf8")) };
}

function writeJson(rel, data) {
  const file = path.join(root, rel);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

const pkg = readJson("package.json");
pkg.data.version = version;
writeJson("package.json", pkg.data);

const lock = readJson("package-lock.json");
lock.data.version = version;
if (lock.data.packages?.[""]) lock.data.packages[""].version = version;
writeJson("package-lock.json", lock.data);

const tauri = readJson("src-tauri/tauri.conf.json");
tauri.data.version = version;
writeJson("src-tauri/tauri.conf.json", tauri.data);

const cargoPath = path.join(root, "src-tauri/Cargo.toml");
const cargo = fs.readFileSync(cargoPath, "utf8");
const cargoMatch = cargo.match(/^version = "([^"]+)"/m);
if (!cargoMatch) {
  console.error("Could not find version in src-tauri/Cargo.toml");
  process.exit(1);
}
if (cargoMatch[1] !== version) {
  const updated = cargo.replace(/^version = "[^"]+"/m, `version = "${version}"`);
  fs.writeFileSync(cargoPath, updated);
}

console.log(`Version set to ${version} in package.json, tauri.conf.json, Cargo.toml`);
