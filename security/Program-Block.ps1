# Program-Block.ps1
# 특정 프로그램 실행 차단 및 모니터링

<#
.SYNOPSIS
    프로그램 실행 차단

.DESCRIPTION
    - 블랙리스트 프로그램 실행 감시
    - 실행 시 자동 종료
    - 관리자에게 알림

.EXAMPLE
    .\Program-Block.ps1 -InstallService
    .\Program-Block.ps1 -Remove
#>

[CmdletBinding()]
param(
    [string[]]$BlockList = @(
        "chrome", "firefox", "opera", "brave",
        "LeagueClient", "RiotClientServices",
        "Steam", "EpicGamesLauncher",
        "Discord", "KakaoTalk",
        "Battle.net"
    ),
    [switch]$InstallService,
    [switch]$Remove,
    [switch]$Silent
)

if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "ERROR: Administrator required!" -ForegroundColor Red
    exit 1
}

$configPath = "C:\ProgramData\EnterprisePC\ProgramBlock"
$scriptFile = "$configPath\Block-Monitor.ps1"
$taskName = "Enterprise-ProgramBlock"

if ($Remove) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    if (Test-Path $configPath) { Remove-Item $configPath -Recurse -Force }
    Write-Host "  OK - Program block removed" -ForegroundColor Green
    exit 0
}

if (-not $Silent) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  PROGRAM BLOCK SETUP" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
}

# 설정 폴더 생성
if (-not (Test-Path $configPath)) {
    New-Item -Path $configPath -ItemType Directory -Force | Out-Null
}

# 블랙리스트 저장
$BlockList | ConvertTo-Json | Out-File "$configPath\blocklist.json" -Encoding UTF8

# 모니터링 스크립트 생성
$monitorScript = @'
$configPath = "C:\ProgramData\EnterprisePC\ProgramBlock"
$blocklist = Get-Content "$configPath\blocklist.json" | ConvertFrom-Json

foreach ($proc in $blocklist) {
    $running = Get-Process -Name $proc -ErrorAction SilentlyContinue
    if ($running) {
        $running | Stop-Process -Force
        
        # 로그 기록
        $log = @{
            Time = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
            Process = $proc
            Action = "Blocked"
        }
        $log | ConvertTo-Json | Add-Content "$configPath\block-log.json"
    }
}
'@

$monitorScript | Out-File $scriptFile -Encoding UTF8

if ($InstallService) {
    # Scheduled Task 등록 (1분마다)
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    
    $action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptFile`""
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 9999)
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    
    if (-not $Silent) {
        Write-Host "  OK - Program monitor service installed" -ForegroundColor Green
    }
}

if (-not $Silent) {
    Write-Host ""
    Write-Host "  Blocked programs:" -ForegroundColor Yellow
    foreach ($proc in $BlockList) {
        Write-Host "    - $proc" -ForegroundColor Gray
    }
    Write-Host ""
}

return @{ 
    Success      = $true
    BlockedCount = $BlockList.Count
}
