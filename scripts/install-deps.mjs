#!/usr/bin/env node
/**
 * Cross-platform prerequisite installer entry point.
 * Installs system tools (Node, Rust, compilers). Does not run npm install.
 *
 *   npm run install-deps
 *
 * Or run the platform script directly (no Node required for the shell scripts):
 *   macOS:   bash scripts/install-prerequisites-macos.sh
 *   Windows: powershell -ExecutionPolicy Bypass -File scripts/install-prerequisites-windows.ps1
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform === "win32") {
  const ps = spawnSync(
    "powershell",
    [
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(root, "scripts", "install-prerequisites-windows.ps1"),
      ...process.argv.slice(2),
    ],
    { stdio: "inherit", cwd: root },
  );
  process.exit(ps.status ?? 1);
}

const sh = spawnSync("bash", [path.join(root, "scripts", "install-prerequisites-macos.sh"), ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: root,
});
process.exit(sh.status ?? 1);
