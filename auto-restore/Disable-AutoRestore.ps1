# Disable-AutoRestore.ps1
# 자동 복원 시스템 비활성화

<#
.SYNOPSIS
    자동 복원 시스템 해제

.DESCRIPTION
    관리자가 시스템 변경 작업 시 자동 복원 방지

.EXAMPLE
    .\Disable-AutoRestore.ps1
#>

[CmdletBinding()]
param()

# 관리자 권한 확인
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "ERROR: Administrator required!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  DISABLE AUTO-RESTORE" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

Write-Host "This will disable automatic restoration." -ForegroundColor Yellow
Write-Host "Use this when you need to make permanent system changes." -ForegroundColor Gray
Write-Host ""

$confirm = Read-Host "Disable auto-restore? (YES/no)"
if ($confirm -ne 'YES') {
    Write-Host "Cancelled." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Disabling auto-restore..." -ForegroundColor Cyan

try {
    # Scheduled Tasks 비활성화
    Disable-ScheduledTask -TaskName "AutoRestore-Daily" -ErrorAction SilentlyContinue
    Disable-ScheduledTask -TaskName "AutoRestore-Startup" -ErrorAction SilentlyContinue
    
    Write-Host "  OK - Scheduled tasks disabled" -ForegroundColor Green
    
    # 상태 파일 생성
    $statusPath = "C:\ProgramData\EnterprisePC\AutoRestore\status.txt"
    "DISABLED at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File $statusPath
    
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  AUTO-RESTORE DISABLED!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Auto-restore is now disabled." -ForegroundColor White
    Write-Host "System will NOT automatically restore." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To re-enable: Run Enable-AutoRestore.ps1" -ForegroundColor Gray
    Write-Host ""
    
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Read-Host "Press Enter to exit"
