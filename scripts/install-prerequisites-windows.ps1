# WatchPost — install Windows build prerequisites.
# Run from the repo root (PowerShell):
#   powershell -ExecutionPolicy Bypass -File scripts/install-prerequisites-windows.ps1
#
# Requires PowerShell 5.1+ (Windows 10/11). Some steps need Administrator.

[CmdletBinding()]
param(
    [string]$DownloadDir = $env:WATCHPOST_DOWNLOAD_DIR,
    [string]$CargoHome = $env:WATCHPOST_CARGO_HOME,
    [string]$NodeInstallDir = $env:WATCHPOST_NODE_DIR,
    [switch]$SkipVS,
    [switch]$SkipWebView2,
    [switch]$SkipNode,
    [switch]$SkipRust,
    [switch]$SkipGit,
    [switch]$CheckOnly,
    [switch]$Help
)

$ErrorActionPreference = "Stop"
$MinNodeMajor = 20
$Root = Split-Path -Parent $PSScriptRoot
$FailedSteps = [System.Collections.Generic.List[string]]::new()

if (-not $DownloadDir) { $DownloadDir = Join-Path $env:TEMP "WatchPostInstall" }
if (-not $CargoHome) { $CargoHome = Join-Path $env:USERPROFILE ".cargo" }

function Show-Help {
    @"
WatchPost — Windows prerequisite installer

Usage:
  powershell -ExecutionPolicy Bypass -File scripts/install-prerequisites-windows.ps1 [options]

Installs (or verifies):
  • Visual Studio 2022 Build Tools (C++ workload) — MSVC linker for Rust
  • Microsoft Edge WebView2 Runtime
  • Node.js LTS 20+ (includes npm)
  • Rust stable via rustup (includes cargo)
  • Git (for cloning the repository)

Options:
  -DownloadDir PATH     Cache downloads (default: %TEMP%\WatchPostInstall)
  -CargoHome PATH       Rust/cargo home (default: %USERPROFILE%\.cargo)
  -NodeInstallDir PATH  Expected Node.js folder (default: C:\Program Files\nodejs)
  -SkipVS               Skip Visual Studio Build Tools
  -SkipWebView2         Skip WebView2 Runtime
  -SkipNode             Skip Node.js
  -SkipRust             Skip Rust
  -SkipGit              Skip Git
  -CheckOnly            Verify only; do not download or install
  -Help                 Show this help

Environment (same as parameters):
  WATCHPOST_DOWNLOAD_DIR, WATCHPOST_CARGO_HOME, WATCHPOST_NODE_DIR

After this script succeeds, from the WatchPost repo run:
  npm run setup
  npm run start

Manual fallback: wiki/Build-from-source.md
"@
}

if ($Help) {
    Show-Help
    exit 0
}

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host "OK  $Message" -ForegroundColor Green
}

function Write-WarnMsg([string]$Message) {
    Write-Host "WARN $Message" -ForegroundColor Yellow
}

function Write-Fail([string]$Step, [string]$Detail, [string[]]$Manual = @()) {
    $script:FailedSteps.Add($Step)
    Write-Host "FAIL $Step — $Detail" -ForegroundColor Red
    foreach ($line in $Manual) {
        Write-Host "  $line" -ForegroundColor DarkGray
    }
}

function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal $id
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Ensure-DownloadDir {
    if (-not (Test-Path $DownloadDir)) {
        New-Item -ItemType Directory -Path $DownloadDir -Force | Out-Null
    }
}

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

function Refresh-Path {
    if (-not $NodeInstallDir) { $NodeInstallDir = "C:\Program Files\nodejs" }
    Add-ToSessionPath $NodeInstallDir
    Add-ToSessionPath "C:\Program Files\nodejs"
    Import-CargoEnv
    Add-ToSessionPath "C:\Program Files\Git\cmd"
}

function Test-HasWinget {
    return [bool](Get-Command winget -ErrorAction SilentlyContinue)
}

function Get-NodeMajor {
    try {
        $v = (node --version 2>$null) -replace '^v', ''
        return [int]($v -split '\.')[0]
    } catch {
        return 0
    }
}

function Test-HasNode {
    Refresh-Path
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { return $false }
    return (Get-NodeMajor) -ge $MinNodeMajor
}

function Test-HasRust {
    Import-CargoEnv
    if ((Get-Command rustc -ErrorAction SilentlyContinue) -and (Get-Command cargo -ErrorAction SilentlyContinue)) {
        return $true
    }
    $rustcExe = Join-Path $CargoHome "bin\rustc.exe"
    $cargoExe = Join-Path $CargoHome "bin\cargo.exe"
    if ((Test-Path $rustcExe) -and (Test-Path $cargoExe)) {
        Add-ToSessionPath (Join-Path $CargoHome "bin")
        return $true
    }
    return $false
}

function Test-HasGit {
    Refresh-Path
    return [bool](Get-Command git -ErrorAction SilentlyContinue)
}

function Test-HasWebView2 {
    $paths = @(
        "${env:ProgramFiles(x86)}\Microsoft\EdgeWebView\Application",
        "$env:ProgramFiles\Microsoft\EdgeWebView\Application"
    )
    foreach ($p in $paths) {
        if (Test-Path $p) { return $true }
    }
    return $false
}

function Test-HasMSVC {
    try {
        $cl = Get-Command cl.exe -ErrorAction SilentlyContinue
        if ($cl) { return $true }
    } catch {}
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (-not (Test-Path $vswhere)) { return $false }
    $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    return [bool]$installPath
}

function Invoke-WingetInstall {
    param(
        [string]$Id,
        [string]$Label,
        [string[]]$ExtraArgs = @()
    )
    if (-not (Test-HasWinget)) { return $false }
    Write-Step "Installing $Label via winget ($Id)"
    $args = @("install", "--id", $Id, "-e", "--accept-package-agreements", "--accept-source-agreements") + $ExtraArgs
    & winget @args
    if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq 3010) { return $true }
    return $false
}

function Get-NodeLtsVersion {
    try {
        $index = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json" -TimeoutSec 60
        $lts = $index | Where-Object { $_.lts } | Select-Object -First 1
        if ($lts) { return ($lts.version -replace '^v', '') }
    } catch {}
    return "22.16.0"
}

function Step-VisualStudio {
    Write-Step "Visual Studio Build Tools (C++ / MSVC)"
    if (Test-HasMSVC) {
        Write-Ok "MSVC (cl.exe or VS C++ workload) detected"
        return
    }
    if ($CheckOnly) {
        Write-Fail "Visual Studio Build Tools" "not found (re-run without -CheckOnly)" @(
            "Manual: https://visualstudio.microsoft.com/visual-cpp-build-tools/",
            "Workload: Desktop development with C++"
        )
        return
    }
    if (-not (Test-IsAdmin)) {
        Write-Fail "Visual Studio Build Tools" "Administrator PowerShell required for silent install" @(
            "Right-click PowerShell → Run as administrator, then re-run this script",
            "Or install manually from the link above"
        )
        return
    }
    $wingetOk = Invoke-WingetInstall -Id "Microsoft.VisualStudio.2022.BuildTools" -Label "VS Build Tools" -ExtraArgs @(
        "--override",
        "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    )
    Refresh-Path
    if (Test-HasMSVC) {
        Write-Ok "Visual Studio Build Tools installed"
        return
    }
    if (-not $wingetOk) {
        Write-WarnMsg "winget install failed or winget missing — downloading Build Tools bootstrapper"
        $bootstrapper = Join-Path $DownloadDir "vs_BuildTools.exe"
        $url = "https://aka.ms/vs/17/release/vs_BuildTools.exe"
        try {
            Invoke-WebRequest -Uri $url -OutFile $bootstrapper -UseBasicParsing
        } catch {
            Write-Fail "Visual Studio Build Tools" "download failed: $url" @(
                "Manual: https://visualstudio.microsoft.com/visual-cpp-build-tools/"
            )
            return
        }
        Write-Step "Running VS Build Tools installer (several GB, may take 15+ minutes)"
        $installArgs = @(
            "--quiet", "--wait", "--norestart",
            "--add", "Microsoft.VisualStudio.Workload.VCTools",
            "--includeRecommended"
        )
        $p = Start-Process -FilePath $bootstrapper -ArgumentList $installArgs -Wait -PassThru
        if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
            Write-Fail "Visual Studio Build Tools" "installer exited with code $($p.ExitCode)" @(
                "Re-run the installer manually and select 'Desktop development with C++'"
            )
            return
        }
    }
    Refresh-Path
    if (Test-HasMSVC) {
        Write-Ok "Visual Studio Build Tools ready"
    } else {
        Write-Fail "Visual Studio Build Tools" "install finished but cl.exe / C++ workload not detected" @(
            "Reboot, open a new PowerShell, run: where.exe cl",
            "If still missing, reinstall with C++ workload"
        )
    }
}

function Step-WebView2 {
    Write-Step "WebView2 Runtime"
    if (Test-HasWebView2) {
        Write-Ok "WebView2 Runtime present"
        return
    }
    if ($CheckOnly) {
        Write-Fail "WebView2" "not found (re-run without -CheckOnly)" @(
            "Manual: https://developer.microsoft.com/microsoft-edge/webview2/"
        )
        return
    }
    if (Invoke-WingetInstall -Id "Microsoft.EdgeWebView2Runtime" -Label "WebView2 Runtime") {
        if (Test-HasWebView2) {
            Write-Ok "WebView2 installed"
            return
        }
    }
    Write-WarnMsg "winget WebView2 install failed — download Evergreen Standalone x64 manually"
    Write-Fail "WebView2" "not installed" @(
        "https://developer.microsoft.com/microsoft-edge/webview2/",
        "Download Evergreen Standalone Installer (x64)"
    )
}

function Step-Node {
    Write-Step "Node.js (>= v$MinNodeMajor)"
    if (Test-HasNode) {
        Write-Ok "node — $(node --version)"
        Write-Ok "npm  — $(npm --version)"
        return
    }
    if ($CheckOnly) {
        Write-Fail "Node.js" "not found or version < $MinNodeMajor" @("https://nodejs.org/")
        return
    }
    if (Invoke-WingetInstall -Id "OpenJS.NodeJS.LTS" -Label "Node.js LTS") {
        Refresh-Path
        if (Test-HasNode) {
            Write-Ok "node — $(node --version)"
            return
        }
    }
    $ver = Get-NodeLtsVersion
    $msi = Join-Path $DownloadDir "node-v$ver-x64.msi"
    $url = "https://nodejs.org/dist/v$ver/node-v$ver-x64.msi"
    Write-Step "Downloading $url"
    try {
        Invoke-WebRequest -Uri $url -OutFile $msi -UseBasicParsing
    } catch {
        Write-Fail "Node.js" "download failed" @("Manual: https://nodejs.org/ (LTS .msi)")
        return
    }
    Write-Step "Installing Node.js MSI"
    $p = Start-Process msiexec.exe -ArgumentList "/i", "`"$msi`"", "/qn", "/norestart" -Wait -PassThru
    Refresh-Path
    if (Test-HasNode) {
        Write-Ok "node — $(node --version)"
    } else {
        Write-Fail "Node.js" "MSI finished but node not on PATH" @(
            "Close and reopen PowerShell",
            "Confirm Path contains: C:\Program Files\nodejs\"
        )
    }
}

function Step-Rust {
    Write-Step "Rust (rustup)"
    Import-CargoEnv
    if (Test-HasRust) {
        Write-Ok "rustc — $(rustc --version)"
        Write-Ok "cargo — $(cargo --version)"
        return
    }
    if ($CheckOnly) {
        Write-Fail "Rust" "not installed" @("https://rustup.rs/")
        return
    }
    if (-not (Test-HasMSVC)) {
        Write-WarnMsg "MSVC not detected — install Visual Studio Build Tools before Rust if rustup fails"
    }
    if (Invoke-WingetInstall -Id "Rustlang.Rustup" -Label "Rustup") {
        Start-Sleep -Seconds 2
        Import-CargoEnv
        if (Test-HasRust) {
            Write-Ok "rustc — $(rustc --version)"
            return
        }
        Write-WarnMsg "Rustup installed via winget but not on PATH yet — running rustup-init to finish setup"
    }
    $init = Join-Path $DownloadDir "rustup-init.exe"
    $url = "https://win.rustup.rs/x86_64"
    Write-Step "Downloading rustup-init"
    try {
        Invoke-WebRequest -Uri $url -OutFile $init -UseBasicParsing
    } catch {
        Write-Fail "Rust" "download failed" @("Manual: https://rustup.rs/")
        return
    }
    Write-Step "Running rustup-init (default MSVC toolchain)"
    & $init -y --default-toolchain stable --default-host x86_64-pc-windows-msvc
    Import-CargoEnv
    if (Test-HasRust) {
        Write-Ok "rustc — $(rustc --version)"
        Write-Ok "Cargo home: $CargoHome"
        return
    }
    Write-Fail "Rust" "rustup finished but cargo not on PATH" @(
        "Close and reopen PowerShell, then run: cargo --version",
        "If missing, add to user Path: $CargoHome\bin",
        "Then: rustup default stable-msvc"
    )
}

function Step-Git {
    Write-Step "Git"
    if (Test-HasGit) {
        Write-Ok "git — $(git --version)"
        return
    }
    if ($CheckOnly) {
        Write-Fail "Git" "not installed" @("https://git-scm.com/download/win")
        return
    }
    if (Invoke-WingetInstall -Id "Git.Git" -Label "Git") {
        Refresh-Path
        if (Test-HasGit) {
            Write-Ok "git — $(git --version)"
            return
        }
    }
    Write-Fail "Git" "not installed" @(
        "https://git-scm.com/download/win",
        "Use Git from the command line (recommended) in the installer"
    )
}

function Show-Summary {
    Import-CargoEnv
    Refresh-Path
    Write-Host ""
    Write-Host "================================" -ForegroundColor White
    Write-Host "WatchPost prerequisite summary" -ForegroundColor White
    Write-Host "================================" -ForegroundColor White

    $checks = @()
    if (-not $SkipVS)       { $checks += @{ Name = "MSVC / VS Build Tools"; Ok = (Test-HasMSVC) } }
    if (-not $SkipWebView2) { $checks += @{ Name = "WebView2"; Ok = (Test-HasWebView2) } }
    if (-not $SkipNode)     { $checks += @{ Name = "Node.js"; Ok = (Test-HasNode) } }
    if (-not $SkipRust)     { $checks += @{ Name = "Rust"; Ok = (Test-HasRust) } }
    if (-not $SkipGit)      { $checks += @{ Name = "Git"; Ok = (Test-HasGit) } }

    foreach ($c in $checks) {
        if ($c.Ok) { Write-Ok $c.Name } else { Write-Host "FAIL $($c.Name)" -ForegroundColor Red }
    }

    # Drop step failures that recovered after PATH refresh (common right after rustup).
    if ($FailedSteps.Count -gt 0) {
        $stillFailed = [System.Collections.Generic.List[string]]::new()
        foreach ($s in $FailedSteps) {
            $ok = $true
            if ($s -like "Rust*") { $ok = Test-HasRust }
            elseif ($s -like "Node*") { $ok = Test-HasNode }
            elseif ($s -like "Git*") { $ok = Test-HasGit }
            elseif ($s -like "WebView2*") { $ok = Test-HasWebView2 }
            elseif ($s -like "Visual Studio*") { $ok = Test-HasMSVC }
            if (-not $ok) { $stillFailed.Add($s) }
        }
        $script:FailedSteps = $stillFailed
    }

    if ($FailedSteps.Count -gt 0) {
        Write-Host ""
        Write-Host "Steps that failed:" -ForegroundColor Red
        foreach ($s in $FailedSteps) { Write-Host "  • $s" }
        Write-Host ""
        Write-Host "See wiki/Build-from-source.md for manual steps."
        exit 1
    }

    $allOk = ($checks | Where-Object { -not $_.Ok }).Count -eq 0
    if ($allOk) {
        Write-Host ""
        Write-Host "All prerequisites ready." -ForegroundColor Green
        Write-Host ""
        Write-Host "Next:"
        Write-Host "  cd `"$Root`""
        Write-Host "  npm run setup"
        Write-Host "  npm run start"
        exit 0
    }
    exit 1
}

# --- main ---
Ensure-DownloadDir
Refresh-Path

Write-Host "WatchPost — Windows prerequisites"
Write-Host "Repo:  $Root"
Write-Host "Cache: $DownloadDir"
Write-Host "Cargo: $CargoHome"
if ($CheckOnly) { Write-Host "Mode: check only" }

if (-not $SkipVS)       { Step-VisualStudio } else { Write-WarnMsg "Skipping Visual Studio Build Tools" }
if (-not $SkipWebView2) { Step-WebView2 } else { Write-WarnMsg "Skipping WebView2" }
if (-not $SkipNode)     { Step-Node } else { Write-WarnMsg "Skipping Node.js" }
if (-not $SkipRust)     { Step-Rust } else { Write-WarnMsg "Skipping Rust" }
if (-not $SkipGit)      { Step-Git } else { Write-WarnMsg "Skipping Git" }

Show-Summary
