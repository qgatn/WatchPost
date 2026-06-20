# WatchPost setup — Windows
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Test-Tool($Label, $Command) {
    if (Get-Command $Command -ErrorAction SilentlyContinue) {
        $version = & $Command --version 2>&1 | Select-Object -First 1
        Write-Host "OK  $Label — $version" -ForegroundColor Green
        return $true
    }
    Write-Host "MISSING  $Label" -ForegroundColor Red
    return $false
}

Write-Host "WatchPost setup (Windows)"
Write-Host "========================="

$ok = $true
$ok = (Test-Tool "Node.js" "node") -and $ok
$ok = (Test-Tool "npm" "npm") -and $ok
$ok = (Test-Tool "Rust (cargo)" "cargo") -and $ok
$ok = (Test-Tool "rustc" "rustc") -and $ok

if (-not $ok) {
    Write-Host ""
    Write-Host "Cannot continue — install the missing tools first." -ForegroundColor Yellow
    Write-Host "WatchPost cannot bundle Node/npm/Rust; they must exist on your machine."
    Write-Host ""
    Write-Host "  Node (includes npm) — https://nodejs.org/  (LTS)"
    Write-Host "  Rust (includes cargo) — https://rustup.rs/  (restart terminal after)"
    Write-Host ""
    Write-Host "  C++ Build Tools (required for Tauri on Windows):"
    Write-Host "  https://visualstudio.microsoft.com/visual-cpp-build-tools/"
    Write-Host "  Workload: Desktop development with C++"
    Write-Host ""
    Write-Host "  WebView2 — usually preinstalled on Windows 11"
    Write-Host ""
    Write-Host "After installing, reopen the terminal and run:"
    Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/setup.ps1"
    Write-Host "  # or: npm run setup"
    exit 1
}

Write-Host ""
Write-Host "Installing npm dependencies..."
npm install

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host ""
Write-Host "  Run the app:     npm run start"
Write-Host "  Run tests:       npm test"
Write-Host "  Build installer: npm run tauri build"
