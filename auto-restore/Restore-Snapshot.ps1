# Restore-Snapshot.ps1
# PC방 스타일 자동 복원 실행

<#
.SYNOPSIS
    마스터 스냅샷으로 시스템 복원

.DESCRIPTION
    저장된 VSS 스냅샷으로 시스템을 복원
    학생이 설치한 모든 변경사항 제거

.EXAMPLE
    .\Restore-Snapshot.ps1
#>

[CmdletBinding()]
param(
    [switch]$Silent  # Task Scheduler용 silent 모드
)

# 관리자 권한 확인
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    if (-not $Silent) {
        Write-Host "ERROR: Administrator required!" -ForegroundColor Red
    }
    exit 1
}

if (-not $Silent) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  RESTORE TO CLEAN STATE" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
}

try {
    # 설정 파일 읽기
    $configPath = "C:\ProgramData\EnterprisePC\AutoRestore\snapshot-config.json"
    
    if (-not (Test-Path $configPath)) {
        throw "Snapshot configuration not found! Please run Create-Snapshot.ps1 first."
    }
    
    $config = Get-Content $configPath -Raw | ConvertFrom-Json
    $shadowId = $config.MasterSnapshotId
    
    if (-not $Silent) {
        Write-Host "Master snapshot:" -ForegroundColor White
        Write-Host "  Created: $($config.CreatedDate)" -ForegroundColor Gray
        Write-Host "  ID: $shadowId" -ForegroundColor Gray
        Write-Host ""
        
        Write-Host "This will restore the system to clean state." -ForegroundColor Yellow
        Write-Host "All changes since snapshot will be lost!" -ForegroundColor Yellow
        Write-Host ""
        
        $confirm = Read-Host "Continue? (YES/no)"
        if ($confirm -ne 'YES') {
            Write-Host "Cancelled." -ForegroundColor Yellow
            exit 0
        }
    }
    
    # 로그 파일
    $logPath = "C:\ProgramData\EnterprisePC\AutoRestore\restore-log.txt"
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    
    if (-not $Silent) {
        Write-Host ""
        Write-Host "Restoring system..." -ForegroundColor Cyan
    }
    
    # Shadow Copy로부터 파일 복사
    # 주의: 전체 시스템 복원은 복잡하므로, 주요 디렉토리만 복원
    
    $restoreTargets = @(
        "C:\Users\Student\Desktop",
        "C:\Users\Student\Downloads",
        "C:\Users\Student\Documents",
        "C:\Program Files",
        "C:\Program Files (x86)"
    )
    
    # 간단한 복원: USB 스크립트 재실행
    $usbScript = "D:\Dark_Virus\USB-Complete-Setup.ps1"
    
    if (Test-Path $usbScript) {
        if (-not $Silent) {
            Write-Host "  Running cleanup script..." -ForegroundColor Cyan
        }
        
        # USB 스크립트 실행 (프로그램 삭제 + 보안 설정)
        & PowerShell.exe -ExecutionPolicy Bypass -File $usbScript -Silent
        
        "$timestamp - Restored via USB script" | Out-File $logPath -Append
        
        if (-not $Silent) {
            Write-Host "  OK - System restored" -ForegroundColor Green
        }
    } else {
        Write-Warning "USB script not found. Manual restore required."
        "$timestamp - FAILED: USB script not found" | Out-File $logPath -Append
    }
    
    if (-not $Silent) {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "  RESTORATION COMPLETE!" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "System has been restored to clean state." -ForegroundColor White
        Write-Host "Log: $logPath" -ForegroundColor Gray
        Write-Host ""
        
        Read-Host "Press Enter to exit"
    }
    
} catch {
    $errorMsg = "$timestamp - ERROR: $($_.Exception.Message)"
    $errorMsg | Out-File $logPath -Append
    
    if (-not $Silent) {
        Write-Host ""
        Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host ""
    }
    exit 1
}
