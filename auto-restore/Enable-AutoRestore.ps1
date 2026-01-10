# Enable-AutoRestore.ps1
# 자동 복원 시스템 재활성화

<#
.SYNOPSIS
    자동 복원 시스템 활성화

.DESCRIPTION
    비활성화된 자동 복원 재시작

.EXAMPLE
    .\Enable-AutoRestore.ps1
#>

[CmdletBinding()]
param()

# 관리자 권한 확인
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "ERROR: Administrator required!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ENABLE AUTO-RESTORE" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

try {
    # Scheduled Tasks 활성화
    Enable-ScheduledTask -TaskName "AutoRestore-Daily" -ErrorAction Stop
    Enable-ScheduledTask -TaskName "AutoRestore-Startup" -ErrorAction Stop
    
    Write-Host "  OK - Scheduled tasks enabled" -ForegroundColor Green
    
    # 상태 파일 업데이트
    $statusPath = "C:\ProgramData\EnterprisePC\AutoRestore\status.txt"
    "ENABLED at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File $statusPath
    
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  AUTO-RESTORE ENABLED!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Auto-restore is now active." -ForegroundColor White
    Write-Host "System will automatically restore:" -ForegroundColor White
    Write-Host "  - Every day at midnight" -ForegroundColor Gray
    Write-Host "  - Every system startup" -ForegroundColor Gray
    Write-Host ""
    
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Auto-restore may not be set up yet." -ForegroundColor Yellow
    Write-Host "Run Create-Snapshot.ps1 to set up auto-restore." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

Read-Host "Press Enter to exit"
