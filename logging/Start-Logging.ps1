# Start-Logging.ps1
# 활동 모니터링 및 로깅 시작

<#
.SYNOPSIS
    학생 PC 활동 모니터링 시작

.DESCRIPTION
    다음 활동을 기록합니다:
    - 실행 중인 프로그램
    - 활성 창 제목
    - 웹 브라우저 기록 (Chrome, Edge)
    - 시스템 이벤트

.PARAMETER Interval
    로깅 간격 (초), 기본값: 60초

.PARAMETER Dashboard
    대시보드 서버 URL (선택사항)

.EXAMPLE
    .\Start-Logging.ps1

.EXAMPLE
    .\Start-Logging.ps1 -Interval 30 -Dashboard "http://192.168.1.100:3001"
#>

[CmdletBinding()]
param(
    [int]$Interval = 60,
    [string]$Dashboard = "",
    [switch]$InstallService
)

$configPath = "C:\ProgramData\EnterprisePC\Logs"
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path

# 관리자 권한 확인
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "ERROR: Administrator required!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ACTIVITY LOGGING SYSTEM" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 로그 디렉토리 생성
if (-not (Test-Path $configPath)) {
    New-Item -Path $configPath -ItemType Directory -Force | Out-Null
}

if (-not (Test-Path "$configPath\Programs")) {
    New-Item -Path "$configPath\Programs" -ItemType Directory -Force | Out-Null
}

if (-not (Test-Path "$configPath\Websites")) {
    New-Item -Path "$configPath\Websites" -ItemType Directory -Force | Out-Null
}

if (-not (Test-Path "$configPath\Reports")) {
    New-Item -Path "$configPath\Reports" -ItemType Directory -Force | Out-Null
}

# 서비스 설치 모드
if ($InstallService) {
    Write-Host "Installing as scheduled task..." -ForegroundColor Cyan
    
    # 기존 Task 제거
    Unregister-ScheduledTask -TaskName "Enterprise-ActivityLogging" -Confirm:$false -ErrorAction SilentlyContinue
    
    # Task 등록
    $action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath\Start-Logging.ps1`" -Interval $Interval -Dashboard `"$Dashboard`""
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 3
    
    Register-ScheduledTask -TaskName "Enterprise-ActivityLogging" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    
    Write-Host "Installed as scheduled task!" -ForegroundColor Green
    Write-Host "Service will start automatically on boot." -ForegroundColor Gray
    exit 0
}

Write-Host "Configuration:" -ForegroundColor White
Write-Host "  Log interval: ${Interval} seconds" -ForegroundColor Gray
Write-Host "  Log path: $configPath" -ForegroundColor Gray
if ($Dashboard) {
    Write-Host "  Dashboard: $Dashboard" -ForegroundColor Gray
}
Write-Host ""
Write-Host "Starting activity monitoring..." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

# 현재 사용자
$currentUser = $env:USERNAME

# 활성 창 제목 가져오기
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class Win32 {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@

function Get-ActiveWindowTitle {
    $hwnd = [Win32]::GetForegroundWindow()
    $sb = New-Object System.Text.StringBuilder 256
    [Win32]::GetWindowText($hwnd, $sb, 256) | Out-Null
    return $sb.ToString()
}

# 웹 브라우저 기록 가져오기
function Get-BrowserHistory {
    $history = @()
    
    # Chrome 기록
    $chromePath = "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\History"
    if (Test-Path $chromePath) {
        try {
            # Chrome History DB 복사 (잠금 우회)
            $tempDb = "$env:TEMP\chrome_history_temp.db"
            Copy-Item $chromePath $tempDb -Force -ErrorAction SilentlyContinue
            
            # SQLite 쿼리 (최근 10개)
            # 주의: SQLite 모듈 필요
        } catch {
            # 무시
        }
    }
    
    # Edge 기록
    $edgePath = "$env:LOCALAPPDATA\Microsoft\Edge\User Data\Default\History"
    if (Test-Path $edgePath) {
        try {
            # Edge History 처리
        } catch {
            # 무시
        }
    }
    
    return $history
}

# 메인 로깅 루프
while ($true) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $dateStr = Get-Date -Format "yyyy-MM-dd"
    
    try {
        # 1. 실행 중인 프로세스 기록
        $processes = Get-Process | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object ProcessName, MainWindowTitle, CPU, WorkingSet64
        
        $programLog = @()
        foreach ($proc in $processes) {
            $programLog += [PSCustomObject]@{
                Timestamp = $timestamp
                User = $currentUser
                Program = $proc.ProcessName
                Window = $proc.MainWindowTitle
                CPU = [math]::Round($proc.CPU, 2)
                Memory = [math]::Round($proc.WorkingSet64 / 1MB, 2)
            }
        }
        
        # CSV에 추가
        $programFile = "$configPath\Programs\programs-$dateStr.csv"
        $programLog | Export-Csv -Path $programFile -Append -NoTypeInformation -Encoding UTF8
        
        # 2. 활성 창 기록
        $activeWindow = Get-ActiveWindowTitle
        if ($activeWindow) {
            $windowLog = [PSCustomObject]@{
                Timestamp = $timestamp
                User = $currentUser
                ActiveWindow = $activeWindow
            }
            
            $windowFile = "$configPath\Programs\active-windows-$dateStr.csv"
            $windowLog | Export-Csv -Path $windowFile -Append -NoTypeInformation -Encoding UTF8
        }
        
        # 3. 대시보드에 전송 (옵션)
        if ($Dashboard) {
            try {
                $activity = @{
                    pcName = $env:COMPUTERNAME
                    user = $currentUser
                    activityType = "program"
                    details = "Active: $activeWindow"
                    timestamp = $timestamp
                }
                
                Invoke-RestMethod -Uri "$Dashboard/api/logs" -Method POST -Body ($activity | ConvertTo-Json) -ContentType "application/json" -ErrorAction SilentlyContinue
            } catch {
                # 네트워크 오류 무시
            }
        }
        
        Write-Host "[$timestamp] Logged: $($processes.Count) programs, Active: $activeWindow" -ForegroundColor Gray
        
    } catch {
        Write-Host "[$timestamp] Error: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    
    Start-Sleep -Seconds $Interval
}
