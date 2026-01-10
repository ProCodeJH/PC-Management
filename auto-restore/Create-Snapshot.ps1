# Create-Snapshot.ps1
# 깨끗한 상태의 시스템 스냅샷 생성

<#
.SYNOPSIS
    PC방 스타일 자동 복원을 위한 마스터 스냅샷 생성

.DESCRIPTION
    현재 시스템 상태를 VSS (Volume Shadow Copy)로 저장
    이 스냅샷이 복원의 기준점이 됨

.EXAMPLE
    .\Create-Snapshot.ps1
#>

[CmdletBinding()]
param()

# 관리자 권한 확인
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "ERROR: Administrator required!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  CREATE MASTER SNAPSHOT" -ForegroundColor Cyan
Write-Host "  Deep Freeze Style Auto-Restore" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "This will create a master snapshot of the current system state." -ForegroundColor Yellow
Write-Host "After restoration, the system will return to THIS exact state." -ForegroundColor Yellow
Write-Host ""

Write-Host "Current system state:" -ForegroundColor White
Write-Host "  - All installed programs" -ForegroundColor Gray
Write-Host "  - All system settings" -ForegroundColor Gray
Write-Host "  - All user files" -ForegroundColor Gray
Write-Host ""

$confirm = Read-Host "Is this the clean state you want to preserve? (YES/no)"
if ($confirm -ne 'YES') {
    Write-Host "Cancelled." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Creating snapshot..." -ForegroundColor Cyan
Write-Host ""

try {
    # VSS 서비스 시작
    Write-Host "[1/5] Starting Volume Shadow Copy Service..." -ForegroundColor Cyan
    Set-Service -Name VSS -StartupType Automatic
    Start-Service -Name VSS
    Write-Host "  OK" -ForegroundColor Green
    
    # 스냅샷 생성
    Write-Host "[2/5] Creating shadow copy..." -ForegroundColor Cyan
    $result = vssadmin create shadow /for=C: /autoretry=5
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  OK - Shadow copy created" -ForegroundColor Green
        
        # Shadow Copy ID 추출
        $shadowId = ($result | Select-String "Shadow Copy ID: (.+)" | ForEach-Object { $_.Matches.Groups[1].Value }).Trim()
        
        # 설정 파일에 저장
        $config = @{
            MasterSnapshotId = $shadowId
            CreatedDate = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
            SystemVersion = (Get-ComputerInfo).OsVersion
            Description = "Clean master state for auto-restore"
        }
        
        Write-Host "[3/5] Saving configuration..." -ForegroundColor Cyan
        $configPath = "C:\ProgramData\EnterprisePC\AutoRestore"
        if (-not (Test-Path $configPath)) {
            New-Item -Path $configPath -ItemType Directory -Force | Out-Null
        }
        
        $config | ConvertTo-Json | Out-File "$configPath\snapshot-config.json" -Encoding UTF8
        Write-Host "  OK - Configuration saved" -ForegroundColor Green
        
    } else {
        throw "Failed to create shadow copy"
    }
    
    # 자동 복원 스케줄 생성
    Write-Host "[4/5] Creating restore schedule..." -ForegroundColor Cyan
    
    $scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
    $restoreScript = Join-Path $scriptPath "Restore-Snapshot.ps1"
    
    # 매일 자정 복원 Task
    $action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-ExecutionPolicy Bypass -File `"$restoreScript`""
    $trigger = New-ScheduledTaskTrigger -Daily -At "00:00"
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    
    Register-ScheduledTask -TaskName "AutoRestore-Daily" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    
    # 시작 시 복원 Task
    $triggerStartup = New-ScheduledTaskTrigger -AtStartup
    Register-ScheduledTask -TaskName "AutoRestore-Startup" -Action $action -Trigger $triggerStartup -Principal $principal -Settings $settings -Force | Out-Null
    
    Write-Host "  OK - Scheduled tasks created" -ForegroundColor Green
    
    # 최대 Shadow Copy 개수 설정
    Write-Host "[5/5] Configuring shadow storage..." -ForegroundColor Cyan
    vssadmin resize shadowstorage /for=C: /on=C: /maxsize=50GB | Out-Null
    Write-Host "  OK - Shadow storage configured (50GB max)" -ForegroundColor Green
    
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  SNAPSHOT CREATED!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    
    Write-Host "Master snapshot information:" -ForegroundColor White
    Write-Host "  ID: $shadowId" -ForegroundColor Gray
    Write-Host "  Created: $($config.CreatedDate)" -ForegroundColor Gray
    Write-Host "  Config: $configPath\snapshot-config.json" -ForegroundColor Gray
    Write-Host ""
    
    Write-Host "Automatic restoration schedule:" -ForegroundColor White
    Write-Host "  Daily: Every day at midnight (00:00)" -ForegroundColor Gray
    Write-Host "  Startup: Every time PC boots" -ForegroundColor Gray
    Write-Host ""
    
    Write-Host "Effect: PC will automatically restore to this state!" -ForegroundColor Green
    Write-Host "  - Students can install anything" -ForegroundColor Gray
    Write-Host "  - Changes will be discarded at midnight or reboot" -ForegroundColor Gray
    Write-Host "  - System stays clean forever!" -ForegroundColor Gray
    Write-Host ""
    
    Write-Host "To disable auto-restore: Run Disable-AutoRestore.ps1" -ForegroundColor Yellow
    Write-Host ""
    
} catch {
    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    exit 1
}

Read-Host "Press Enter to exit"
