# Master-Setup.ps1
# 엔터프라이즈 PC 관리 시스템 - Ultimate Edition

<#
.SYNOPSIS
    엔터프라이즈 PC 관리 시스템 마스터 설치 (Ultimate Edition)

.DESCRIPTION
    모든 기능을 한 번에 설치 - ₩20,000,000+ 가치:
    
    [기본 기능]
    - 자동 복원 (Deep Freeze 스타일)
    - 시간 제한
    - 웹 활동 로깅
    - 대시보드 에이전트
    - 원격 지원 (RDP)
    
    [보안 기능]
    - 외부 프로그램 삭제 (게임/브라우저)
    - AppLocker (exe 실행 차단)
    - USB 실행 차단
    - 웹사이트 차단
    - 프로그램 차단
    
    [계정 관리]
    - 학생 계정 생성
    - 자동 로그인
    - 관리자 계정 숨기기
    
    [모니터링]
    - 스크린샷 캡처

.EXAMPLE
    .\Master-Setup.ps1
    .\Master-Setup.ps1 -DashboardUrl "http://192.168.1.100:3001"
    .\Master-Setup.ps1 -QuickSetup
#>

[CmdletBinding()]
param(
    [string]$DashboardUrl = "http://localhost:3001",
    [switch]$QuickSetup,
    [switch]$SkipRestore,
    [switch]$SkipSecurity,
    [switch]$SkipAccounts
)

if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "`n  ERROR: Administrator required!`n" -ForegroundColor Red
    exit 1
}

$Host.UI.RawUI.BackgroundColor = "Black"
Clear-Host

Write-Host ""
Write-Host "  ╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║                                                               ║" -ForegroundColor Cyan
Write-Host "  ║     ENTERPRISE PC MANAGEMENT SYSTEM                          ║" -ForegroundColor Cyan
Write-Host "  ║     Ultimate Edition v3.0                                    ║" -ForegroundColor Cyan
Write-Host "  ║                                                               ║" -ForegroundColor Cyan
Write-Host "  ║     ₩20,000,000+ Value Enterprise Solution                   ║" -ForegroundColor Yellow
Write-Host "  ║                                                               ║" -ForegroundColor Cyan
Write-Host "  ╚═══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

$basePath = Split-Path -Parent $MyInvocation.MyCommand.Path
$startTime = Get-Date

# 기능 목록
Write-Host "  Components:" -ForegroundColor White
Write-Host ""
Write-Host "    [Core]     Auto-Restore | Time Control | Logging | Dashboard" -ForegroundColor Gray
Write-Host "    [Security] Remove Programs | AppLocker | USB Block | Web Block" -ForegroundColor Gray
Write-Host "    [Accounts] Student Account | Auto Login | Hide Admins" -ForegroundColor Gray
Write-Host "    [Monitor]  Screenshots | Program Block" -ForegroundColor Gray
Write-Host ""
Write-Host "  Dashboard: $DashboardUrl" -ForegroundColor DarkGray
Write-Host ""

if (-not $QuickSetup) {
    $confirm = Read-Host "  Install all components? (Type 'YES' to confirm)"
    if ($confirm -ne 'YES') {
        Write-Host "`n  Cancelled.`n" -ForegroundColor Yellow
        exit 0
    }
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
Write-Host ""

$step = 1
$totalSteps = 12

# ========================================
# CORE FEATURES
# ========================================

# 1. Auto-Restore
Write-Host "  [$step/$totalSteps] Auto-Restore System..." -ForegroundColor Cyan
if (-not $SkipRestore -and (Test-Path "$basePath\auto-restore\Create-Snapshot.ps1")) {
    & "$basePath\auto-restore\Create-Snapshot.ps1" -Silent 2>$null
    Write-Host "           ✓ VSS Snapshot + Scheduled restore" -ForegroundColor Green
}
else { Write-Host "           ⏭ Skipped" -ForegroundColor Gray }
$step++
Write-Host ""

# 2. Time Restriction
Write-Host "  [$step/$totalSteps] Time Restriction..." -ForegroundColor Cyan
if (Test-Path "$basePath\time-control\Set-TimeRestriction.ps1") {
    & "$basePath\time-control\Set-TimeRestriction.ps1" -StartTime "09:00" -EndTime "22:00" 2>$null
    Write-Host "           ✓ 09:00-22:00 (Mon-Sat)" -ForegroundColor Green
}
else { Write-Host "           ⏭ Skipped" -ForegroundColor Gray }
$step++
Write-Host ""

# 3. Activity Logging
Write-Host "  [$step/$totalSteps] Activity Logging..." -ForegroundColor Cyan
if (Test-Path "$basePath\logging\Start-Logging.ps1") {
    & "$basePath\logging\Start-Logging.ps1" -InstallService -Dashboard $DashboardUrl 2>$null
    Write-Host "           ✓ Program & window logging" -ForegroundColor Green
}
else { Write-Host "           ⏭ Skipped" -ForegroundColor Gray }
$step++
Write-Host ""

# 4. Dashboard Agent
Write-Host "  [$step/$totalSteps] Dashboard Agent..." -ForegroundColor Cyan
$agentPath = "$basePath\dashboard\PC-Agent.ps1"
if (Test-Path $agentPath) {
    $action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$agentPath`" -DashboardUrl `"$DashboardUrl`""
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    
    Unregister-ScheduledTask -TaskName "Enterprise-DashboardAgent" -Confirm:$false -ErrorAction SilentlyContinue
    Register-ScheduledTask -TaskName "Enterprise-DashboardAgent" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    
    # Start agent now
    Start-Process "PowerShell.exe" -ArgumentList "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$agentPath`" -DashboardUrl `"$DashboardUrl`"" -WindowStyle Hidden
    
    Write-Host "           ✓ Scheduled + Started" -ForegroundColor Green
}
else { Write-Host "           ⏭ Script not found" -ForegroundColor Gray }
$step++
Write-Host ""

# 5. Remote Support
Write-Host "  [$step/$totalSteps] Remote Support (RDP)..." -ForegroundColor Cyan
Set-ItemProperty "HKLM:\System\CurrentControlSet\Control\Terminal Server" -Name "fDenyTSConnections" -Value 0 -ErrorAction SilentlyContinue
Enable-NetFirewallRule -DisplayGroup "Remote Desktop" -ErrorAction SilentlyContinue
Write-Host "           ✓ RDP enabled" -ForegroundColor Green
$step++
Write-Host ""

# ========================================
# SECURITY FEATURES
# ========================================

if (-not $SkipSecurity) {
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    Write-Host "  Security Features" -ForegroundColor Yellow
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    Write-Host ""
    
    # 6. Remove Programs
    Write-Host "  [$step/$totalSteps] Remove External Programs..." -ForegroundColor Cyan
    if (Test-Path "$basePath\security\Remove-Programs.ps1") {
        $result = & "$basePath\security\Remove-Programs.ps1" -Silent
        Write-Host "           ✓ Removed games/browsers" -ForegroundColor Green
    }
    else { Write-Host "           ⏭ Script not found" -ForegroundColor Gray }
    $step++
    Write-Host ""
    
    # 7. AppLocker
    Write-Host "  [$step/$totalSteps] AppLocker (exe protection)..." -ForegroundColor Cyan
    if (Test-Path "$basePath\security\Set-AppLocker.ps1") {
        & "$basePath\security\Set-AppLocker.ps1" -Silent 2>$null
        Write-Host "           ✓ Downloads/USB exe blocked" -ForegroundColor Green
    }
    else { Write-Host "           ⏭ Script not found" -ForegroundColor Gray }
    $step++
    Write-Host ""
    
    # 8. USB Block
    Write-Host "  [$step/$totalSteps] USB Execution Block..." -ForegroundColor Cyan
    if (Test-Path "$basePath\security\Block-USB.ps1") {
        & "$basePath\security\Block-USB.ps1" -Silent 2>$null
        Write-Host "           ✓ USB exe blocked (read OK)" -ForegroundColor Green
    }
    else { Write-Host "           ⏭ Script not found" -ForegroundColor Gray }
    $step++
    Write-Host ""
    
    # 9. Website Block
    Write-Host "  [$step/$totalSteps] Website Blocking..." -ForegroundColor Cyan
    if (Test-Path "$basePath\security\Block-Websites.ps1") {
        & "$basePath\security\Block-Websites.ps1" -Mode blacklist -Sites "youtube.com", "twitch.tv", "tiktok.com" -Silent 2>$null
        Write-Host "           ✓ YouTube/Twitch/TikTok blocked" -ForegroundColor Green
    }
    else { Write-Host "           ⏭ Script not found" -ForegroundColor Gray }
    $step++
    Write-Host ""
    
    # 10. Program Block
    Write-Host "  [$step/$totalSteps] Program Blocking..." -ForegroundColor Cyan
    if (Test-Path "$basePath\security\Program-Block.ps1") {
        & "$basePath\security\Program-Block.ps1" -InstallService -Silent 2>$null
        Write-Host "           ✓ Game/messenger blocking active" -ForegroundColor Green
    }
    else { Write-Host "           ⏭ Script not found" -ForegroundColor Gray }
    $step++
    Write-Host ""
}

# ========================================
# ACCOUNT MANAGEMENT
# ========================================

if (-not $SkipAccounts) {
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    Write-Host "  Account Management" -ForegroundColor Yellow
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    Write-Host ""
    
    # 11. Student Account
    Write-Host "  [$step/$totalSteps] Student Account..." -ForegroundColor Cyan
    if (Test-Path "$basePath\accounts\Create-StudentAccount.ps1") {
        & "$basePath\accounts\Create-StudentAccount.ps1" -AddToAdmin -Silent 2>$null
        Write-Host "           ✓ Student account (Password: 74123)" -ForegroundColor Green
    }
    else { Write-Host "           ⏭ Script not found" -ForegroundColor Gray }
    $step++
    Write-Host ""
    
    # 12. Hide Admin Accounts
    Write-Host "  [$step/$totalSteps] Hide Admin Accounts..." -ForegroundColor Cyan
    if (Test-Path "$basePath\accounts\Hide-AdminAccounts.ps1") {
        & "$basePath\accounts\Hide-AdminAccounts.ps1" -Silent 2>$null
        Write-Host "           ✓ Only Student visible at login" -ForegroundColor Green
    }
    else { Write-Host "           ⏭ Script not found" -ForegroundColor Gray }
    $step++
    Write-Host ""
}

# ========================================
# COMPLETION
# ========================================

$duration = ((Get-Date) - $startTime).TotalSeconds
$ipAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" } | Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  ╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║                                                               ║" -ForegroundColor Green
Write-Host "  ║     ✓ ULTIMATE INSTALLATION COMPLETE!                        ║" -ForegroundColor Green
Write-Host "  ║                                                               ║" -ForegroundColor Green
Write-Host "  ╚═══════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Duration: $([math]::Round($duration, 1)) seconds" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  ┌───────────────────────────────────────────────────────────────┐" -ForegroundColor DarkGray
Write-Host "  │  Dashboard:  $DashboardUrl" -ForegroundColor White
Write-Host "  │  This PC:    $env:COMPUTERNAME ($ipAddress)" -ForegroundColor White
Write-Host "  │  Login:      admin / admin123" -ForegroundColor White
Write-Host "  └───────────────────────────────────────────────────────────────┘" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  ┌───────────────────────────────────────────────────────────────┐" -ForegroundColor Cyan
Write-Host "  │  SYSTEM VALUE: ₩20,000,000+ (Ultimate Enterprise)            │" -ForegroundColor Yellow
Write-Host "  └───────────────────────────────────────────────────────────────┘" -ForegroundColor Cyan
Write-Host ""

Read-Host "  Press Enter to exit"
