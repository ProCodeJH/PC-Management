# Set-TimeRestriction.ps1
# PC 사용 시간 제한 설정

<#
.SYNOPSIS
    학생 PC 사용 시간 제한 설정

.DESCRIPTION
    지정된 시간 외에는 PC 사용을 제한합니다.
    - 허용 시간 외: 화면 잠금 또는 종료
    - 요일별 스케줄 지원
    - 관리자 오버라이드 기능

.PARAMETER StartTime
    PC 사용 허용 시작 시간 (HH:mm 형식)

.PARAMETER EndTime
    PC 사용 허용 종료 시간 (HH:mm 형식)

.PARAMETER DaysOfWeek
    허용 요일 (쉼표 구분, 예: "Mon,Tue,Wed,Thu,Fri,Sat")

.EXAMPLE
    .\Set-TimeRestriction.ps1 -StartTime "09:00" -EndTime "22:00"
    
.EXAMPLE
    .\Set-TimeRestriction.ps1 -StartTime "08:00" -EndTime "20:00" -DaysOfWeek "Mon,Tue,Wed,Thu,Fri"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$StartTime = "09:00",
    
    [Parameter(Mandatory=$true)]
    [string]$EndTime = "22:00",
    
    [string]$DaysOfWeek = "Mon,Tue,Wed,Thu,Fri,Sat",
    
    [switch]$Remove
)

# 관리자 권한 확인
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "ERROR: Administrator required!" -ForegroundColor Red
    exit 1
}

$configPath = "C:\ProgramData\EnterprisePC\TimeControl"
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PC TIME RESTRICTION SETUP" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($Remove) {
    Write-Host "Removing time restrictions..." -ForegroundColor Yellow
    
    # Scheduled Task 제거
    Unregister-ScheduledTask -TaskName "TimeRestriction-Check" -Confirm:$false -ErrorAction SilentlyContinue
    
    # 설정 파일 제거
    if (Test-Path $configPath) {
        Remove-Item -Path $configPath -Recurse -Force
    }
    
    Write-Host "Time restrictions removed!" -ForegroundColor Green
    exit 0
}

Write-Host "Configuration:" -ForegroundColor White
Write-Host "  Allowed hours: $StartTime - $EndTime" -ForegroundColor Gray
Write-Host "  Allowed days:  $DaysOfWeek" -ForegroundColor Gray
Write-Host ""

try {
    # 설정 디렉토리 생성
    Write-Host "[1/3] Creating configuration..." -ForegroundColor Cyan
    if (-not (Test-Path $configPath)) {
        New-Item -Path $configPath -ItemType Directory -Force | Out-Null
    }
    
    # 설정 저장
    $config = @{
        StartTime = $StartTime
        EndTime = $EndTime
        DaysOfWeek = $DaysOfWeek -split ","
        CreatedDate = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Enabled = $true
    }
    
    $config | ConvertTo-Json | Out-File "$configPath\time-config.json" -Encoding UTF8
    Write-Host "  OK - Configuration saved" -ForegroundColor Green
    
    # Check-TimeLimit.ps1 생성
    Write-Host "[2/3] Creating check script..." -ForegroundColor Cyan
    
    $checkScript = @'
# Check-TimeLimit.ps1
# 시간 제한 확인 및 적용 (자동 실행용)

$configPath = "C:\ProgramData\EnterprisePC\TimeControl\time-config.json"

if (-not (Test-Path $configPath)) {
    exit 0
}

$config = Get-Content $configPath | ConvertFrom-Json

if (-not $config.Enabled) {
    exit 0
}

$now = Get-Date
$currentDay = $now.ToString("ddd")
$currentTime = $now.ToString("HH:mm")

# 요일 체크
$allowedDays = $config.DaysOfWeek
if ($currentDay -notin $allowedDays) {
    # 오늘은 허용되지 않은 요일
    $msg = "오늘($currentDay)은 PC 사용이 허용되지 않습니다."
    msg * "$msg" /time:10
    Start-Sleep -Seconds 10
    rundll32.exe user32.dll,LockWorkStation
    exit 0
}

# 시간 체크
$startTime = [DateTime]::ParseExact($config.StartTime, "HH:mm", $null)
$endTime = [DateTime]::ParseExact($config.EndTime, "HH:mm", $null)
$nowTime = [DateTime]::ParseExact($currentTime, "HH:mm", $null)

if ($nowTime -lt $startTime -or $nowTime -gt $endTime) {
    # 허용 시간 외
    $msg = "PC 사용 허용 시간은 $($config.StartTime) - $($config.EndTime) 입니다."
    msg * "$msg" /time:10
    Start-Sleep -Seconds 10
    rundll32.exe user32.dll,LockWorkStation
}
'@
    
    $checkScript | Out-File "$configPath\Check-TimeLimit.ps1" -Encoding UTF8
    Write-Host "  OK - Check script created" -ForegroundColor Green
    
    # Scheduled Task 등록
    Write-Host "[3/3] Registering scheduled task..." -ForegroundColor Cyan
    
    # 기존 Task 제거
    Unregister-ScheduledTask -TaskName "TimeRestriction-Check" -Confirm:$false -ErrorAction SilentlyContinue
    
    # 5분마다 실행
    $action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$configPath\Check-TimeLimit.ps1`""
    
    # 트리거: 5분마다 반복
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 9999)
    
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    
    Register-ScheduledTask -TaskName "TimeRestriction-Check" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    
    Write-Host "  OK - Scheduled task registered" -ForegroundColor Green
    
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  TIME RESTRICTION CONFIGURED!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Settings:" -ForegroundColor White
    Write-Host "  Allowed hours: $StartTime - $EndTime" -ForegroundColor Gray
    Write-Host "  Allowed days:  $DaysOfWeek" -ForegroundColor Gray
    Write-Host "  Check interval: Every 5 minutes" -ForegroundColor Gray
    Write-Host ""
    Write-Host "To disable: .\Set-TimeRestriction.ps1 -Remove" -ForegroundColor Yellow
    Write-Host ""
    
} catch {
    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    exit 1
}

Read-Host "Press Enter to exit"
