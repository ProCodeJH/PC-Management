<#
.SYNOPSIS
    PC Agent 자동 설치 — 학생 PC에서 실행
.DESCRIPTION
    Node.js 에이전트를 C:\ProgramData\PCAgent에 설치하고
    Windows 시작 시 자동 실행되도록 설정
.PARAMETER ServerUrl
    대시보드 서버 주소 (기본: 환경변수 SERVER_URL 또는 http://192.168.0.1:3001)
#>
[CmdletBinding()]
param(
    [string]$ServerUrl = ($env:SERVER_URL -or "http://192.168.0.1:3001")
)

$AgentRoot = "C:\ProgramData\PCAgent"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$TaskName = "PCAgent-AutoStart"

function Write-Status {
    param([string]$Msg, [string]$Color = "Cyan")
    Write-Host "  [Agent] $Msg" -ForegroundColor $Color
}

# Find node.exe
$NodePath = $null
@("node.exe", "$ScriptRoot\..\runtime\node.exe", "C:\Program Files\nodejs\node.exe",
  "$env:ProgramFiles\nodejs\node.exe", "$env:APPDATA\nvm\current\node.exe") | ForEach-Object {
    if (-not $NodePath -and (Test-Path $_)) {
        $NodePath = (Resolve-Path $_).Path
    }
}
if (-not $NodePath) {
    $NodePath = (Get-Command node -ErrorAction SilentlyContinue)?.Source
}
if (-not $NodePath) {
    Write-Status "Node.js not found — using PowerShell fallback agent" "Yellow"
    $NodePath = $null
}

# Create agent directory
New-Item -Path $AgentRoot -ItemType Directory -Force | Out-Null

# Copy agent files
$AgentSrc = Join-Path $ScriptRoot "agent"
if (Test-Path $AgentSrc) {
    Copy-Item -Path "$AgentSrc\*" -Destination $AgentRoot -Force -Recurse
    Write-Status "Agent files copied to $AgentRoot" "Green"
} else {
    Write-Status "Agent source not found at $AgentSrc" "Red"
    exit 1
}

# Save server URL config
"SERVER_URL=$ServerUrl" | Out-File -FilePath "$AgentRoot\.env" -Encoding UTF8 -Force

# Install npm packages if node available
if ($NodePath) {
    Write-Status "Installing npm packages..."
    $npm = Join-Path (Split-Path -Parent $NodePath) "npm.cmd"
    if (Test-Path $npm) {
        & $npm install --prefix $AgentRoot --production 2>&1 | Out-Null
        Write-Status "npm install done" "Green"
    }
}

# Create launcher bat
$launcherContent = if ($NodePath) {
    "@echo off`r`nset SERVER_URL=$ServerUrl`r`n`"$NodePath`" `"$AgentRoot\agent.js`"`r`n"
} else {
    # PowerShell fallback: minimal status poller
    "@echo off`r`npowershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$AgentRoot\poller.ps1`"`r`n"
}
$launcherContent | Out-File -FilePath "$AgentRoot\start.bat" -Encoding ASCII -Force

# PowerShell fallback poller (if no Node.js)
if (-not $NodePath) {
    $pollerScript = @"
`$dashUrl = '$ServerUrl'
while(`$true) {
    try {
        `$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
        `$mem = (Get-CimInstance Win32_OperatingSystem | % { [math]::Round((1-`$_.FreePhysicalMemory/`$_.TotalVisibleMemorySize)*100,1) })
        `$ip = (Get-NetIPAddress -AddressFamily IPv4 | ? { `$_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1).IPAddress
        `$body = @{ pcName=`$env:COMPUTERNAME; ipAddress=`$ip; cpuUsage=`$cpu; memoryUsage=`$mem } | ConvertTo-Json
        Invoke-RestMethod -Uri "`$dashUrl/api/pcs/`$env:COMPUTERNAME/status" -Method POST -Body `$body -ContentType 'application/json' -TimeoutSec 5 | Out-Null
    } catch {}
    Start-Sleep -Seconds 15
}
"@
    $pollerScript | Out-File -FilePath "$AgentRoot\poller.ps1" -Encoding UTF8 -Force
    Write-Status "PowerShell fallback poller created" "Yellow"
}

# Remove old scheduled task if exists
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# Create scheduled task (auto-start on logon)
$action = New-ScheduledTaskAction -Execute "$AgentRoot\start.bat" -WorkingDirectory $AgentRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "BUILTIN\Users" -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null
Write-Status "Scheduled task '$TaskName' registered" "Green"

# Also add to startup folder for redundancy
$startupPath = "$env:ALLUSERSPROFILE\Microsoft\Windows\Start Menu\Programs\StartUp"
if (Test-Path $startupPath) {
    Copy-Item "$AgentRoot\start.bat" "$startupPath\PCAgent.bat" -Force
}

# Start agent now
Write-Status "Starting agent..." "Green"
Start-Process -FilePath "$AgentRoot\start.bat" -WindowStyle Hidden
Write-Status "Agent installed and started. Server: $ServerUrl" "Green"
Write-Host ""
