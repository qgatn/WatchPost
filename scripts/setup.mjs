#!/usr/bin/env node
/**
 * Cross-platform setup entry point.
 * Requires Node.js to run (npm run setup).
 * If npm is missing, install Node first, or run the platform script directly:
 *   macOS:   bash scripts/setup.sh
 *   Windows: powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform === "win32") {
  const ps = spawnSync(
    "powershell",
    ["-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts", "setup.ps1")],
    { stdio: "inherit", cwd: root },
  );
  process.exit(ps.status ?? 1);
}

const sh = spawnSync("bash", [path.join(root, "scripts", "setup.sh")], {
  stdio: "inherit",
  cwd: root,
});
process.exit(sh.status ?? 1);
