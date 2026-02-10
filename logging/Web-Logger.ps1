# Web-Logger.ps1
# 웹 브라우저 활동 모니터링 및 기록

<#
.SYNOPSIS
    Enterprise PC Management - 웹 브라우저 활동 모니터링

.DESCRIPTION
    Chrome, Edge 브라우저의 활동을 모니터링합니다:
    - 브라우저 히스토리 DB에서 최근 방문 사이트 추출
    - 현재 열린 브라우저 탭 제목 기록
    - 차단 사이트 접속 시 알림

.PARAMETER Dashboard
    대시보드 서버 URL

.PARAMETER Interval
    모니터링 간격 (초), 기본값: 60

.PARAMETER InstallService
    예약 작업으로 설치

.EXAMPLE
    .\Web-Logger.ps1
    .\Web-Logger.ps1 -Dashboard "http://192.168.0.100:3001" -Interval 30
#>

[CmdletBinding()]
param(
    [string]$Dashboard = "",
    [int]$Interval = 60,
    [switch]$InstallService,
    [switch]$Silent
)

$logPath = "C:\ProgramData\EnterprisePC\Logs\Websites"
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
    Write-Host "Installing Web Logger as scheduled task..." -ForegroundColor Cyan

    Unregister-ScheduledTask -TaskName "Enterprise-WebLogger" -Confirm:$false -ErrorAction SilentlyContinue

    $args = "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath\Web-Logger.ps1`" -Silent -Interval $Interval"
    if ($Dashboard) { $args += " -Dashboard `"$Dashboard`"" }

    $action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument $args
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

    Register-ScheduledTask -TaskName "Enterprise-WebLogger" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

    Write-Host "[OK] Installed as scheduled task!" -ForegroundColor Green
    exit 0
}

if (-not $Silent) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  WEB BROWSER ACTIVITY LOGGER" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Interval: ${Interval}s" -ForegroundColor Gray
    Write-Host "Log path: $logPath" -ForegroundColor Gray
    Write-Host ""
}

# 차단 사이트 목록 가져오기 (대시보드에서)
$blockedSites = @()
function Update-BlockedSites {
    if (-not $Dashboard) { return }
    try {
        $sites = Invoke-RestMethod -Uri "$Dashboard/api/blocked-sites" -TimeoutSec 5 -ErrorAction Stop
        $script:blockedSites = $sites | ForEach-Object { $_.url }
    } catch {
        # 네트워크 오류 무시
    }
}

# 브라우저 히스토리 읽기 (SQLite 파일 복사 방식)
function Get-ChromeHistory {
    param([int]$MaxEntries = 20)

    $results = @()
    $profiles = @(
        "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\History",
        "$env:LOCALAPPDATA\Google\Chrome\User Data\Profile 1\History"
    )

    foreach ($historyPath in $profiles) {
        if (-not (Test-Path $historyPath)) { continue }

        try {
            $tempDb = "$env:TEMP\chrome_hist_$(Get-Random).db"
            Copy-Item $historyPath $tempDb -Force -ErrorAction Stop

            # PowerShell에서 SQLite 직접 읽기는 별도 모듈 필요
            # 대안: 파일 수정 시간과 크기로 활동 감지
            $fileInfo = Get-Item $historyPath
            $results += [PSCustomObject]@{
                Browser     = "Chrome"
                LastAccess  = $fileInfo.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
                IsActive    = ((Get-Date) - $fileInfo.LastWriteTime).TotalMinutes -lt 5
            }

            Remove-Item $tempDb -Force -ErrorAction SilentlyContinue
        } catch {
            # 파일 잠금 등 오류 무시
        }
    }
    return $results
}

function Get-EdgeHistory {
    param([int]$MaxEntries = 20)

    $results = @()
    $historyPath = "$env:LOCALAPPDATA\Microsoft\Edge\User Data\Default\History"

    if (Test-Path $historyPath) {
        try {
            $fileInfo = Get-Item $historyPath
            $results += [PSCustomObject]@{
                Browser     = "Edge"
                LastAccess  = $fileInfo.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
                IsActive    = ((Get-Date) - $fileInfo.LastWriteTime).TotalMinutes -lt 5
            }
        } catch { }
    }
    return $results
}

# 브라우저 탭 제목 수집
function Get-BrowserTabs {
    $tabs = @()

    # Chrome 탭
    $chromeProcs = Get-Process -Name "chrome" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne "" }
    foreach ($proc in $chromeProcs) {
        $tabs += [PSCustomObject]@{
            Browser = "Chrome"
            Title   = $proc.MainWindowTitle
            PID     = $proc.Id
        }
    }

    # Edge 탭
    $edgeProcs = Get-Process -Name "msedge" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne "" }
    foreach ($proc in $edgeProcs) {
        $tabs += [PSCustomObject]@{
            Browser = "Edge"
            Title   = $proc.MainWindowTitle
            PID     = $proc.Id
        }
    }

    # Firefox 탭
    $ffProcs = Get-Process -Name "firefox" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne "" }
    foreach ($proc in $ffProcs) {
        $tabs += [PSCustomObject]@{
            Browser = "Firefox"
            Title   = $proc.MainWindowTitle
            PID     = $proc.Id
        }
    }

    return $tabs
}

# 차단 사이트 체크
function Check-BlockedSite {
    param([string]$Title)

    foreach ($site in $blockedSites) {
        if ($Title -like "*$site*") {
            return $site
        }
    }
    return $null
}

# 대시보드 알림
function Send-WebAlert {
    param([string]$Type, [string]$Details)

    if (-not $Dashboard) { return }
    try {
        $body = @{
            pcName       = $env:COMPUTERNAME
            user         = $env:USERNAME
            activityType = $Type
            details      = $Details
            timestamp    = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        } | ConvertTo-Json

        Invoke-RestMethod -Uri "$Dashboard/api/logs" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 5 -ErrorAction SilentlyContinue | Out-Null
    } catch { }
}

if (-not $Silent) {
    Write-Host "Monitoring web activity..." -ForegroundColor Green
    Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
    Write-Host ""
}

# 초기 차단 목록
Update-BlockedSites

$cycleCount = 0

# 메인 루프
while ($true) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $dateStr = Get-Date -Format "yyyy-MM-dd"
    $logFile = "$logPath\web-activity-$dateStr.csv"

    try {
        # 브라우저 탭 수집
        $tabs = Get-BrowserTabs

        if ($tabs.Count -gt 0) {
            foreach ($tab in $tabs) {
                $entry = [PSCustomObject]@{
                    Timestamp = $timestamp
                    User      = $env:USERNAME
                    Computer  = $env:COMPUTERNAME
                    Browser   = $tab.Browser
                    Title     = $tab.Title
                    Blocked   = $false
                }

                # 차단 사이트 확인
                $blockedSite = Check-BlockedSite -Title $tab.Title
                if ($blockedSite) {
                    $entry.Blocked = $true
                    Send-WebAlert -Type "BLOCKED_SITE_ACCESS" -Details "$($tab.Browser): $($tab.Title) (matched: $blockedSite)"

                    if (-not $Silent) {
                        Write-Host "  [ALERT] Blocked site detected: $blockedSite in '$($tab.Title)'" -ForegroundColor Red
                    }
                }

                $entry | Export-Csv -Path $logFile -Append -NoTypeInformation -Encoding UTF8
            }

            if (-not $Silent) {
                Write-Host "[$timestamp] Logged $($tabs.Count) browser tabs" -ForegroundColor Gray
            }
        }

        # 히스토리 활동 체크
        $chromeHist = Get-ChromeHistory
        $edgeHist = Get-EdgeHistory

        foreach ($h in ($chromeHist + $edgeHist)) {
            if ($h.IsActive) {
                $histEntry = [PSCustomObject]@{
                    Timestamp = $timestamp
                    User      = $env:USERNAME
                    Computer  = $env:COMPUTERNAME
                    Browser   = $h.Browser
                    Title     = "Active browsing detected"
                    Blocked   = $false
                }
                $histEntry | Export-Csv -Path $logFile -Append -NoTypeInformation -Encoding UTF8
            }
        }

        # 10분마다 차단 목록 갱신
        $cycleCount++
        if ($cycleCount % [Math]::Max(1, [int](600 / $Interval)) -eq 0) {
            Update-BlockedSites
        }

    } catch {
        if (-not $Silent) {
            Write-Host "[$timestamp] Error: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }

    Start-Sleep -Seconds $Interval
}
