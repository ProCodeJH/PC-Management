<#
.SYNOPSIS
    학생용 PC Agent 설치 — Node.js 포함, 설치 불필요
.DESCRIPTION
    같은 폴더의 agent 파일들(node.exe, agent.js 등)을
    C:\ProgramData\PCAgent에 복사하고 서버 주소 설정 + 자동 시작 등록
#>

$ErrorActionPreference = "Continue"
$AgentPath = "C:\ProgramData\PCAgent"
$TaskName = "PCAgent"

function Write-Status($msg, $color = "Cyan") {
    Write-Host "  [Student] $msg" -ForegroundColor $color
}

# 1. Verify source files exist
$sourceNode = Join-Path $PSScriptRoot "node.exe"
$sourceAgent = Join-Path $PSScriptRoot "agent.js"
if (-not (Test-Path $sourceNode)) {
    Write-Host "  [ERROR] node.exe not found in $PSScriptRoot" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $sourceAgent)) {
    Write-Host "  [ERROR] agent.js not found in $PSScriptRoot" -ForegroundColor Red
    exit 1
}

# 2. Stop existing agent
Write-Status "Stopping existing agent..."
Get-Process -Name node -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "*PCAgent*" } |
    Stop-Process -Force -ErrorAction SilentlyContinue
schtasks /delete /tn $TaskName /f 2>$null | Out-Null

# 3. Copy files to install path
Write-Status "Installing agent to $AgentPath..."
New-Item -Path $AgentPath -ItemType Directory -Force | Out-Null
Copy-Item -Path "$PSScriptRoot\*" -Destination $AgentPath -Recurse -Force -Exclude "Install-Student-Payload.ps1","INSTALL.bat"
Write-Status "Agent files copied" "Green"

# 4. Verify node.exe
$NodePath = Join-Path $AgentPath "node.exe"
if (-not (Test-Path $NodePath)) {
    Write-Host "  [ERROR] node.exe not found after copy" -ForegroundColor Red
    exit 1
}
$nodeVer = & $NodePath --version
Write-Status "Node.js: $nodeVer"

# 5. Ask for server URL
Write-Host ""
Write-Host "  Enter the teacher PC server URL" -ForegroundColor Yellow
Write-Host "  (shown on teacher's screen after setup)" -ForegroundColor Yellow
Write-Host "  Example: http://192.168.0.10:3001" -ForegroundColor DarkGray
Write-Host ""
$ServerUrl = Read-Host "  Server URL"
if ([string]::IsNullOrWhiteSpace($ServerUrl)) {
    $ServerUrl = "http://localhost:3001"
}
# Normalize: ensure http:// prefix
if ($ServerUrl -notmatch "^https?://") {
    $ServerUrl = "http://$ServerUrl"
}
# Ensure port
if ($ServerUrl -notmatch ":\d+$") {
    $ServerUrl = "${ServerUrl}:3001"
}

Write-Status "Server URL: $ServerUrl"

# 6. Save .env
"SERVER_URL=$ServerUrl" | Out-File -FilePath (Join-Path $AgentPath ".env") -Encoding UTF8 -Force

# 7. npm install if node_modules missing
if (-not (Test-Path (Join-Path $AgentPath "node_modules"))) {
    Write-Status "Installing dependencies..."
    $npmCmd = Join-Path (Split-Path -Parent $NodePath) "npm.cmd"
    if (Test-Path $npmCmd) {
        & $npmCmd install --prefix $AgentPath --production 2>&1 | Out-Null
    }
    Write-Status "Dependencies ready" "Green"
}

# 8. Create start script + register auto-start scheduled task
# This is a classroom PC management agent — teacher enters the server URL manually
$startBat = Join-Path $AgentPath "autostart.bat"
$batContent = "@echo off`r`ncd /d `"$AgentPath`"`r`nset SERVER_URL=$ServerUrl`r`n`"$NodePath`" agent.js`r`n"
[System.IO.File]::WriteAllText($startBat, $batContent, [System.Text.Encoding]::ASCII)

$schtaskResult = & schtasks /create /tn $TaskName /tr "`"$startBat`"" /sc onlogon /rl highest /f 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Status "Auto-start registered (scheduled task)" "Green"
} else {
    # Fallback: startup folder
    $startupDir = "$env:ALLUSERSPROFILE\Microsoft\Windows\Start Menu\Programs\StartUp"
    Copy-Item $startBat (Join-Path $startupDir "PCAgent.bat") -Force -ErrorAction SilentlyContinue
    Write-Status "Auto-start registered (startup folder)" "Yellow"
}

# 9. Start agent now
Write-Status "Starting agent..."
$agentJs = Join-Path $AgentPath "agent.js"
$env:SERVER_URL = $ServerUrl
Start-Process -FilePath $NodePath -ArgumentList $agentJs -WorkingDirectory $AgentPath -WindowStyle Hidden

Start-Sleep -Seconds 3

# 10. Done
$pcName = $env:COMPUTERNAME
Write-Host ""
Write-Host "  ========================================" -ForegroundColor Green
Write-Host "   Student Agent Installed!" -ForegroundColor Green
Write-Host "  ========================================" -ForegroundColor Green
Write-Host "   PC Name: $pcName" -ForegroundColor White
Write-Host "   Server:  $ServerUrl" -ForegroundColor Cyan
Write-Host "   Path:    $AgentPath" -ForegroundColor White
Write-Host ""
Write-Host "   Agent is running in background." -ForegroundColor White
Write-Host "   It will auto-start on next login." -ForegroundColor White
Write-Host "  ========================================" -ForegroundColor Green
Write-Host ""
