<#
.SYNOPSIS
    학생용 PC Agent 설치 — Node.js 포함, 설치 불필요
.DESCRIPTION
    Student-Payload.zip을 C:\ProgramData\PCAgent에 설치하고
    서버 주소를 설정한 후 에이전트를 시작 + 자동 시작 등록
#>

$ErrorActionPreference = "Continue"
$AgentPath = "C:\ProgramData\PCAgent"
$PayloadZip = Join-Path $PSScriptRoot "Student-Payload.zip"
$TaskName = "PCAgent"

function Write-Status($msg, $color = "Cyan") {
    Write-Host "  [Student] $msg" -ForegroundColor $color
}

# 1. Extract payload
if (-not (Test-Path $PayloadZip)) {
    Write-Host "  [ERROR] Student-Payload.zip not found" -ForegroundColor Red
    exit 1
}

# 2. Stop existing agent
Write-Status "Stopping existing agent..."
Get-Process -Name node -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "*PCAgent*" } |
    Stop-Process -Force -ErrorAction SilentlyContinue
schtasks /delete /tn $TaskName /f 2>$null | Out-Null

# 3. Extract
Write-Status "Installing agent to $AgentPath..."
New-Item -Path $AgentPath -ItemType Directory -Force | Out-Null
Expand-Archive -Path $PayloadZip -DestinationPath $AgentPath -Force
Write-Status "Agent files extracted" "Green"

# 4. Verify node.exe exists in bundle
$NodePath = Join-Path $AgentPath "node.exe"
if (-not (Test-Path $NodePath)) {
    # Try runtime subfolder
    $runtimeNode = Join-Path $AgentPath "runtime\node.exe"
    if (Test-Path $runtimeNode) {
        Copy-Item $runtimeNode $NodePath -Force
    } else {
        Write-Host "  [ERROR] node.exe not found in bundle" -ForegroundColor Red
        exit 1
    }
}
$nodeVer = & $NodePath --version
Write-Status "Node.js: $nodeVer"

# 5. Ask for server URL
Write-Host ""
Write-Host "  ┌─────────────────────────────────────────────┐" -ForegroundColor Yellow
Write-Host "  │  교사 PC의 서버 주소를 입력하세요             │" -ForegroundColor Yellow
Write-Host "  │  (교사 화면에 표시된 주소를 그대로 입력)      │" -ForegroundColor Yellow
Write-Host "  │  예: http://192.168.0.10:3001                │" -ForegroundColor DarkGray
Write-Host "  └─────────────────────────────────────────────┘" -ForegroundColor Yellow
Write-Host ""
$ServerUrl = Read-Host "  서버 주소"
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

# 8. Register scheduled task (auto-start on logon)
$taskCmd = "cmd /c cd /d $AgentPath ^& set SERVER_URL=$ServerUrl ^& `"$NodePath`" agent.js"
schtasks /create /tn $TaskName /tr $taskCmd /sc onlogon /rl highest /f 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Status "Auto-start registered (scheduled task)" "Green"
} else {
    # Fallback: startup folder
    $startupBat = "$env:ALLUSERSPROFILES\Microsoft\Windows\Start Menu\Programs\StartUp\PCAgent.bat"
    "@echo off`r`ncd /d `"$AgentPath`"`r`nset SERVER_URL=$ServerUrl`r`n`"$NodePath`" agent.js" | Out-File $startupBat -Encoding ASCII -Force
    Write-Status "Auto-start registered (startup folder)" "Yellow"
}

# 9. Start agent now
Write-Status "Starting agent..."
$agentJs = Join-Path $AgentPath "agent.js"
$env:SERVER_URL = $ServerUrl
Start-Process -FilePath $NodePath -ArgumentList $agentJs -WorkingDirectory $AgentPath -WindowStyle Hidden

Start-Sleep -Seconds 3

# 10. Verify connection
$pcName = $env:COMPUTERNAME
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║  Student Agent Installed!                        ║" -ForegroundColor Green
Write-Host "  ╠══════════════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "  ║  PC Name: $($pcName.PadRight(39))║" -ForegroundColor White
Write-Host "  ║  Server:  $($ServerUrl.PadRight(39))║" -ForegroundColor Cyan
Write-Host "  ║  Path:    $($AgentPath.PadRight(39))║" -ForegroundColor White
Write-Host "  ║                                                  ║" -ForegroundColor Green
Write-Host "  ║  Agent is running in background.                 ║" -ForegroundColor White
Write-Host "  ║  It will auto-start on next login.               ║" -ForegroundColor White
Write-Host "  ╚══════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
