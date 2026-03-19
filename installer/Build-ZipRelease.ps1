<#
.SYNOPSIS
    Student-Setup.zip + Teacher-Setup.zip 생성
    exe 대신 zip 배포 — zip 풀고 bat 더블클릭
#>

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$OutDir = Join-Path $Root "release"

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Write-Status($msg, $color = "Cyan") {
    Write-Host "  [Build] $msg" -ForegroundColor $color
}

# Clean
if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force -ErrorAction SilentlyContinue }
New-Item $OutDir -ItemType Directory -Force | Out-Null

# ═══════════════════════════════════════
# Student Package
# ═══════════════════════════════════════
Write-Status "Building Student package..."
$studentDir = Join-Path $OutDir "_student-stage"
New-Item $studentDir -ItemType Directory -Force | Out-Null

# Extract agent bundle (node.exe + agent.js + node_modules)
$bundleZip = Join-Path $Root "dashboard\backend\deploy-bundle\agent-bundle.zip"
if (-not (Test-Path $bundleZip)) {
    Write-Status "Building agent bundle first..."
    & node (Join-Path $Root "dashboard\backend\scripts\bundle-agent.js")
}
Expand-Archive -Path $bundleZip -DestinationPath $studentDir -Force

# Add install script
Copy-Item (Join-Path $Root "installer\Install-Student-Payload.ps1") $studentDir -Force

# Create simple launcher bat
@"
@echo off
title PC Agent - Student Setup
echo.
echo   ========================================
echo    PC Management - Student Agent Install
echo   ========================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Student-Payload.ps1"
pause
"@ | Out-File -FilePath (Join-Path $studentDir "INSTALL.bat") -Encoding ASCII

# Zip
$studentZip = Join-Path $OutDir "Student-Setup.zip"
[System.IO.Compression.ZipFile]::CreateFromDirectory($studentDir, $studentZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
Remove-Item $studentDir -Recurse -Force
$sizeMB = [math]::Round((Get-Item $studentZip).Length / 1MB, 1)
Write-Status "Student-Setup.zip: ${sizeMB}MB" "Green"

# ═══════════════════════════════════════
# Teacher Package
# ═══════════════════════════════════════
Write-Status "Building Teacher package..."
$teacherDir = Join-Path $OutDir "_teacher-stage"
New-Item $teacherDir -ItemType Directory -Force | Out-Null

# Backend
$backendSrc = Join-Path $Root "dashboard\backend"
$backendDst = Join-Path $teacherDir "dashboard\backend"
robocopy $backendSrc $backendDst /E /R:0 /W:0 /NFL /NDL /NJH /NJS `
    /XD "logs" "screenshots" "deploy-bundle" /XF "*.db" "*.db-shm" "*.db-wal" "*.db.bak" "stderr.txt" "crash.txt" | Out-Null

# Frontend
robocopy (Join-Path $Root "dashboard\frontend") (Join-Path $teacherDir "dashboard\frontend") /E /R:0 /W:0 /NFL /NDL /NJH /NJS | Out-Null

# Bundled node.exe
$runtimeDir = Join-Path $teacherDir "runtime"
New-Item $runtimeDir -ItemType Directory -Force | Out-Null
Copy-Item (Get-Command node).Source (Join-Path $runtimeDir "node.exe") -Force

# Teacher install script
Copy-Item (Join-Path $Root "installer\Install-Teacher-Payload.ps1") $teacherDir -Force

# Launcher bat
@"
@echo off
title PC Management - Teacher Dashboard
echo.
echo   ========================================
echo    PC Management - Teacher Server Setup
echo   ========================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Teacher-Payload.ps1"
pause
"@ | Out-File -FilePath (Join-Path $teacherDir "INSTALL.bat") -Encoding ASCII

# Zip
$teacherZip = Join-Path $OutDir "Teacher-Setup.zip"
[System.IO.Compression.ZipFile]::CreateFromDirectory($teacherDir, $teacherZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
Remove-Item $teacherDir -Recurse -Force
$sizeMB = [math]::Round((Get-Item $teacherZip).Length / 1MB, 1)
Write-Status "Teacher-Setup.zip: ${sizeMB}MB" "Green"

Write-Host ""
Write-Host "  Done! Release files:" -ForegroundColor Green
Get-ChildItem $OutDir | ForEach-Object {
    $s = [math]::Round($_.Length / 1MB, 1)
    Write-Host "    $($_.Name) (${s}MB)" -ForegroundColor White
}
Write-Host ""
Write-Host "  Usage:" -ForegroundColor Yellow
Write-Host "    1. Teacher: Unzip Teacher-Setup.zip -> run INSTALL.bat" -ForegroundColor Gray
Write-Host "    2. Student: Unzip Student-Setup.zip -> run INSTALL.bat" -ForegroundColor Gray
