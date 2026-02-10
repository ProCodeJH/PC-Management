# Program-Logger.ps1
# 프로그램 실행 모니터링 및 기록

<#
.SYNOPSIS
    Enterprise PC Management - 프로그램 실행 실시간 모니터링

.DESCRIPTION
    WMI 이벤트 구독을 사용하여 프로그램 실행/종료를 실시간 감지합니다:
    - 프로세스 시작/종료 이벤트 구독
    - 실행 시간 추적
    - 차단 목록 프로그램 자동 종료
    - 대시보드에 실시간 알림

.PARAMETER Dashboard
    대시보드 서버 URL

.PARAMETER BlockList
    차단할 프로그램 목록 (쉼표 구분)

.PARAMETER LogOnly
    로깅만 수행 (차단 안 함)

.PARAMETER InstallService
    예약 작업으로 설치 (자동 시작)

.EXAMPLE
    .\Program-Logger.ps1
    .\Program-Logger.ps1 -Dashboard "http://192.168.0.100:3001"
    .\Program-Logger.ps1 -BlockList "notepad.exe,calc.exe"
#>

[CmdletBinding()]
param(
    [string]$Dashboard = "",
    [string]$BlockList = "",
    [switch]$LogOnly,
    [switch]$InstallService,
    [switch]$Silent
)

$logPath = "C:\ProgramData\EnterprisePC\Logs\Programs"
$scriptPath = $PSScriptRoot

# 관리자 권한 확인
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    if (-not $Silent) { Write-Host "ERROR: Administrator required!" -ForegroundColor Red }
    exit 1
}

# 로그 디렉토리 생성
if (-not (Test-Path $logPath)) {
    New-Item -Path $logPath -ItemType Directory -Force | Out-Null
}

# 서비스 설치 모드
if ($InstallService) {
    Write-Host "Installing Program Logger as scheduled task..." -ForegroundColor Cyan

    Unregister-ScheduledTask -TaskName "Enterprise-ProgramLogger" -Confirm:$false -ErrorAction SilentlyContinue

    $args = "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath\Program-Logger.ps1`" -Silent"
    if ($Dashboard) { $args += " -Dashboard `"$Dashboard`"" }
    if ($BlockList) { $args += " -BlockList `"$BlockList`"" }

    $action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument $args
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

    Register-ScheduledTask -TaskName "Enterprise-ProgramLogger" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

    Write-Host "[OK] Installed as scheduled task!" -ForegroundColor Green
    exit 0
}

if (-not $Silent) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  PROGRAM EXECUTION LOGGER" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
}

# 차단 목록 파싱
$blockedPrograms = @()
if ($BlockList) {
    $blockedPrograms = $BlockList -split ',' | ForEach-Object { $_.Trim().ToLower() }
    if (-not $Silent) {
        Write-Host "Block list: $($blockedPrograms -join ', ')" -ForegroundColor Yellow
    }
}

# 대시보드 알림 함수
function Send-DashboardNotification {
    param([string]$EventType, [string]$ProcessName, [string]$Details)

    if (-not $Dashboard) { return }

    try {
        $body = @{
            pcName       = $env:COMPUTERNAME
            user         = $env:USERNAME
            activityType = $EventType
            details      = "$ProcessName - $Details"
            timestamp    = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        } | ConvertTo-Json

        Invoke-RestMethod -Uri "$Dashboard/api/logs" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 5 -ErrorAction SilentlyContinue | Out-Null
    } catch {
        # 네트워크 오류 무시
    }
}

# 프로세스 로그 기록 함수
function Write-ProcessLog {
    param([string]$Action, [string]$ProcessName, [int]$PID, [string]$CommandLine)

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $dateStr = Get-Date -Format "yyyy-MM-dd"
    $logFile = "$logPath\process-events-$dateStr.csv"

    $entry = [PSCustomObject]@{
        Timestamp   = $timestamp
        Action      = $Action
        ProcessName = $ProcessName
        PID         = $PID
        User        = $env:USERNAME
        Computer    = $env:COMPUTERNAME
        CommandLine = if ($CommandLine) { $CommandLine.Substring(0, [Math]::Min(500, $CommandLine.Length)) } else { "" }
    }

    $entry | Export-Csv -Path $logFile -Append -NoTypeInformation -Encoding UTF8

    if (-not $Silent) {
        $color = if ($Action -eq "START") { "Green" } else { "Red" }
        Write-Host "[$timestamp] $Action: $ProcessName (PID: $PID)" -ForegroundColor $color
    }
}

if (-not $Silent) {
    Write-Host "Monitoring process events..." -ForegroundColor Green
    Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
    Write-Host ""
}

# WMI 이벤트 구독 - 프로세스 시작
$startQuery = "SELECT * FROM __InstanceCreationEvent WITHIN 2 WHERE TargetInstance ISA 'Win32_Process'"
$startEvent = Register-WmiEvent -Query $startQuery -SourceIdentifier "ProcessStart" -ErrorAction SilentlyContinue

# WMI 이벤트 구독 - 프로세스 종료
$stopQuery = "SELECT * FROM __InstanceDeletionEvent WITHIN 2 WHERE TargetInstance ISA 'Win32_Process'"
$stopEvent = Register-WmiEvent -Query $stopQuery -SourceIdentifier "ProcessStop" -ErrorAction SilentlyContinue

try {
    while ($true) {
        # 프로세스 시작 이벤트 처리
        $events = Get-Event -SourceIdentifier "ProcessStart" -ErrorAction SilentlyContinue
        foreach ($event in $events) {
            $proc = $event.SourceEventArgs.NewEvent.TargetInstance
            $processName = $proc.Name
            $pid = $proc.ProcessId
            $cmdLine = $proc.CommandLine

            Write-ProcessLog -Action "START" -ProcessName $processName -PID $pid -CommandLine $cmdLine
            Send-DashboardNotification -EventType "PROCESS_START" -ProcessName $processName -Details "PID: $pid"

            # 차단 목록 확인
            if (-not $LogOnly -and $blockedPrograms -contains $processName.ToLower()) {
                try {
                    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                    Write-ProcessLog -Action "BLOCKED" -ProcessName $processName -PID $pid -CommandLine $cmdLine
                    Send-DashboardNotification -EventType "PROCESS_BLOCKED" -ProcessName $processName -Details "Auto-killed"
                    if (-not $Silent) {
                        Write-Host "  >>> BLOCKED: $processName" -ForegroundColor Red
                    }
                } catch {
                    # 프로세스가 이미 종료됨
                }
            }

            Remove-Event -SourceIdentifier "ProcessStart" -ErrorAction SilentlyContinue
        }

        # 프로세스 종료 이벤트 처리
        $events = Get-Event -SourceIdentifier "ProcessStop" -ErrorAction SilentlyContinue
        foreach ($event in $events) {
            $proc = $event.SourceEventArgs.NewEvent.TargetInstance
            Write-ProcessLog -Action "STOP" -ProcessName $proc.Name -PID $proc.ProcessId -CommandLine ""
            Remove-Event -SourceIdentifier "ProcessStop" -ErrorAction SilentlyContinue
        }

        Start-Sleep -Milliseconds 500
    }
} finally {
    # 이벤트 구독 정리
    Unregister-Event -SourceIdentifier "ProcessStart" -ErrorAction SilentlyContinue
    Unregister-Event -SourceIdentifier "ProcessStop" -ErrorAction SilentlyContinue
    if (-not $Silent) {
        Write-Host ""
        Write-Host "Program Logger stopped." -ForegroundColor Yellow
    }
}
