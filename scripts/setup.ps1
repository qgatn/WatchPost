# WatchPost setup — Windows
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$CargoHome = if ($env:WATCHPOST_CARGO_HOME) { $env:WATCHPOST_CARGO_HOME } else { Join-Path $env:USERPROFILE ".cargo" }

function Add-ToSessionPath([string]$Dir) {
    if ($Dir -and (Test-Path $Dir) -and ($env:Path -split ';' -notcontains $Dir)) {
        $env:Path = "$Dir;$env:Path"
    }
}

function Import-CargoEnv {
    $env:CARGO_HOME = $CargoHome
    if (-not $env:RUSTUP_HOME) {
        $env:RUSTUP_HOME = if ($env:WATCHPOST_RUSTUP_HOME) {
            $env:WATCHPOST_RUSTUP_HOME
        } else {
            Join-Path $env:USERPROFILE ".rustup"
        }
    }
    Add-ToSessionPath (Join-Path $CargoHome "bin")
}

function Refresh-DevPath {
    Add-ToSessionPath "C:\Program Files\nodejs"
    if ($env:WATCHPOST_NODE_DIR) { Add-ToSessionPath $env:WATCHPOST_NODE_DIR }
    Import-CargoEnv
    Add-ToSessionPath "C:\Program Files\Git\cmd"
}

function Test-Tool($Label, $Command) {
    if (Get-Command $Command -ErrorAction SilentlyContinue) {
        $version = & $Command --version 2>&1 | Select-Object -First 1
        Write-Host "OK  $Label — $version" -ForegroundColor Green
        return $true
    }
    # Rust may be installed but not yet on PATH in this session.
    if ($Command -in @("cargo", "rustc")) {
        $exe = Join-Path $CargoHome "bin\$Command.exe"
        if (Test-Path $exe) {
            Add-ToSessionPath (Join-Path $CargoHome "bin")
            $version = & $exe --version 2>&1 | Select-Object -First 1
            Write-Host "OK  $Label — $version" -ForegroundColor Green
            return $true
        }
    }
    Write-Host "MISSING  $Label" -ForegroundColor Red
    return $false
}

Refresh-DevPath

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
    Write-Host ""
    Write-Host "Full install guide (downloads, verify, PATH):"
    Write-Host "  wiki/Build-from-source.md"
    Write-Host ""
    Write-Host "After installing, reopen the terminal (or run the prerequisite script again), then:"
    Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/install-prerequisites-windows.ps1"
    Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/setup.ps1   # or: npm run setup"
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
Write-Host "  Build installer: npm run package"
