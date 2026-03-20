<#
.SYNOPSIS
    교사용 PC Management 서버 설치 + 실행
.DESCRIPTION
    같은 폴더의 dashboard/ + runtime/ 파일들을
    C:\Enterprise-PC-Management에 복사하고 서버 시작
#>

$ErrorActionPreference = "Continue"
$InstallPath = "C:\Enterprise-PC-Management"
$Port = 3001

function Write-Status($msg, $color = "Cyan") {
    Write-Host "  [Teacher] $msg" -ForegroundColor $color
}

# 1. Copy files to install path
Write-Status "Installing to $InstallPath..."
if (Test-Path $InstallPath) {
    Write-Status "Stopping existing server..." "Yellow"
    Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

New-Item -Path $InstallPath -ItemType Directory -Force | Out-Null
Copy-Item -Path "$PSScriptRoot\*" -Destination $InstallPath -Recurse -Force -Exclude "Install-Teacher-Payload.ps1","INSTALL.bat"
Write-Status "Files copied" "Green"

# 2. Find node.exe
$NodePath = $null
$runtimeNode = Join-Path $InstallPath "runtime\node.exe"
if (Test-Path $runtimeNode) {
    $NodePath = $runtimeNode
    Write-Status "Using bundled Node.js runtime"
} else {
    $cmd = Get-Command node -ErrorAction SilentlyContinue; if ($cmd) { $NodePath = $cmd.Source }
}

if (-not $NodePath) {
    Write-Host "  [ERROR] Node.js not found. Install from https://nodejs.org" -ForegroundColor Red
    exit 1
}

$nodeVersion = & $NodePath --version
Write-Status "Node.js: $nodeVersion"

# 3. npm install (if node_modules missing)
$backendPath = Join-Path $InstallPath "dashboard\backend"
if (-not (Test-Path (Join-Path $backendPath "node_modules"))) {
    Write-Status "Installing dependencies..."
    $npmCmd = Join-Path (Split-Path -Parent $NodePath) "npm.cmd"
    if (Test-Path $npmCmd) {
        & $npmCmd install --prefix $backendPath --production 2>&1 | Out-Null
    } else {
        & $NodePath (Join-Path (Split-Path -Parent $NodePath) "node_modules\npm\bin\npm-cli.js") install --prefix $backendPath --production 2>&1 | Out-Null
    }
    Write-Status "Dependencies installed" "Green"
}

# 4. Generate .env if missing
$envPath = Join-Path $backendPath ".env"
if (-not (Test-Path $envPath)) {
    Write-Status "Generating secure .env..."
    & $NodePath (Join-Path $backendPath "setup-env.js")
    Write-Status ".env created" "Green"
}

# 5. Open firewall
$rule = Get-NetFirewallRule -Name "EPM-Dashboard" -ErrorAction SilentlyContinue
if (-not $rule) {
    New-NetFirewallRule -Name "EPM-Dashboard" -DisplayName "Enterprise PC Dashboard" `
        -Protocol TCP -LocalPort $Port -Direction Inbound -Action Allow -Profile Any -ErrorAction SilentlyContinue | Out-Null
    Write-Status "Firewall rule added (port $Port)"
}

# 6. Start server
Write-Status "Starting dashboard server..."
$serverJs = Join-Path $backendPath "server.js"
Start-Process -FilePath $NodePath -ArgumentList $serverJs -WorkingDirectory $backendPath -WindowStyle Minimized

# 7. Wait and open browser
$maxWait = 10
for ($i = 0; $i -lt $maxWait; $i++) {
    Start-Sleep -Seconds 1
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$Port/api/health" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
        if ($r.StatusCode -eq 200) { break }
    } catch { }
}

Start-Process "http://localhost:$Port"

# 8. Done
$localIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" } | Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Green
Write-Host "   Teacher Setup Complete!" -ForegroundColor Green
Write-Host "  ========================================" -ForegroundColor Green
Write-Host "   Dashboard: http://localhost:$Port" -ForegroundColor White
Write-Host "   Network:   http://${localIP}:$Port" -ForegroundColor Yellow
Write-Host "   Login:     admin / admin123" -ForegroundColor White
Write-Host "" -ForegroundColor Green
Write-Host "   Student PC agent server URL:" -ForegroundColor White
Write-Host "   http://${localIP}:$Port" -ForegroundColor Cyan
Write-Host "  ========================================" -ForegroundColor Green
Write-Host ""
