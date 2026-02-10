@echo off
setlocal EnableDelayedExpansion

:: ============================================================================
:: Enterprise PC Management - 완전 독립형 학생 PC 설정
:: Version 3.0 Ultra Standalone (Error-Free Edition)
:: 
:: 🎯 이 파일 하나만 있으면 됩니다!
:: 메일, USB, 공유폴더 어디서든 실행 가능
:: ============================================================================

:: UTF-8 인코딩
chcp 65001 >nul 2>&1

:: 타이틀 및 색상
title Enterprise PC Management - Student Setup
color 0B

:: 관리자 권한 자동 상승
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo.
    echo   [!] 관리자 권한이 필요합니다. 자동으로 권한을 요청합니다...
    echo.
    goto UACPrompt
) else ( goto gotAdmin )

:UACPrompt
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "%~s0", "", "", "runas", 1 >> "%temp%\getadmin.vbs"
    "%temp%\getadmin.vbs"
    del "%temp%\getadmin.vbs"
    exit /B

:gotAdmin
    pushd "%CD%"
    CD /D "%~dp0"

:: 임시 PowerShell 스크립트 생성
set "PS_SCRIPT=%temp%\EPM_StudentSetup_%RANDOM%.ps1"

:: PowerShell 스크립트 내용 작성
(
echo $Host.UI.RawUI.WindowTitle = 'Enterprise PC Management - Student Setup'
echo.
echo function Show-Banner {
echo     Clear-Host
echo     Write-Host ''
echo     Write-Host '    ========================================================================' -ForegroundColor Cyan
echo     Write-Host '    =                                                                      =' -ForegroundColor Cyan
echo     Write-Host '    =   ENTERPRISE PC MANAGEMENT - Student PC Setup                       =' -ForegroundColor Cyan
echo     Write-Host '    =   Version 3.0 Ultra Standalone                                      =' -ForegroundColor Cyan
echo     Write-Host '    =                                                                      =' -ForegroundColor Cyan
echo     Write-Host '    ========================================================================' -ForegroundColor Cyan
echo     Write-Host ''
echo }
echo.
echo function Write-Step {
echo     param([int]$Step, [int]$Total, [string]$Message, [string]$Status^)
echo     $colors = @{PROGRESS='Yellow';OK='Green';WARN='DarkYellow';FAIL='Red';SKIP='Gray'}
echo     $pct = [math]::Floor^(^($Step / $Total^) * 20^)
echo     $bar = ^('=' * $pct^) + ^('-' * ^(20 - $pct^)^)
echo     Write-Host ''
echo     Write-Host "    [$bar] " -NoNewline -ForegroundColor DarkGray
echo     Write-Host "[$Step/$Total] " -NoNewline -ForegroundColor White
echo     switch^($Status^) {
echo         'PROGRESS' { Write-Host '[...] ' -NoNewline -ForegroundColor Yellow }
echo         'OK' { Write-Host '[OK] ' -NoNewline -ForegroundColor Green }
echo         'WARN' { Write-Host '[WARN] ' -NoNewline -ForegroundColor Yellow }
echo         'FAIL' { Write-Host '[FAIL] ' -NoNewline -ForegroundColor Red }
echo         'SKIP' { Write-Host '[SKIP] ' -NoNewline -ForegroundColor Gray }
echo     }
echo     Write-Host $Message -ForegroundColor $colors[$Status]
echo }
echo.
echo function Invoke-WithRetry {
echo     param([scriptblock]$Block, [int]$Max = 3^)
echo     for ^($i = 1; $i -le $Max; $i++^) {
echo         try { 
echo             $result = ^& $Block
echo             return @{Success=$true;Result=$result} 
echo         }
echo         catch { 
echo             if ^($i -lt $Max^) { Start-Sleep -Milliseconds 500 } 
echo         }
echo     }
echo     return @{Success=$false}
echo }
echo.
echo # Main execution
echo Show-Banner
echo.
echo $admin = ^([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent^(^)^).IsInRole^([Security.Principal.WindowsBuiltInRole]::Administrator^)
echo if ^(-not $admin^) {
echo     Write-Host '    [X] Administrator privileges required!' -ForegroundColor Red
echo     Read-Host '    Press Enter to exit'
echo     exit
echo }
echo.
echo Write-Host '    [OK] Administrator privileges confirmed' -ForegroundColor Green
echo Write-Host '    [*] Starting setup... ^(approximately 30 seconds^)' -ForegroundColor Cyan
echo.
echo $results = @{}
echo $total = 8
echo.
echo # Step 1: WinRM Service
echo Write-Step 1 $total 'WinRM Service Activation' 'PROGRESS'
echo $r = Invoke-WithRetry { 
echo     Set-Service WinRM -StartupType Automatic -ErrorAction Stop
echo     Start-Service WinRM -ErrorAction Stop
echo     $true 
echo }
echo $results['WinRM_Service'] = $r.Success
echo Write-Step 1 $total 'WinRM Service Activation' $^(if^($r.Success^){'OK'}else{'WARN'}^)
echo.
echo # Step 2: PSRemoting
echo Write-Step 2 $total 'PSRemoting Activation' 'PROGRESS'
echo $r = Invoke-WithRetry { 
echo     Enable-PSRemoting -Force -SkipNetworkProfileCheck -ErrorAction Stop 2^>$null
echo     $true 
echo }
echo $results['PSRemoting'] = $r.Success
echo Write-Step 2 $total 'PSRemoting Activation' $^(if^($r.Success^){'OK'}else{'WARN'}^)
echo.
echo # Step 3: Basic Auth
echo Write-Step 3 $total 'Basic Authentication' 'PROGRESS'
echo $r = Invoke-WithRetry { 
echo     Set-Item WSMan:\localhost\Service\Auth\Basic -Value $true -Force -ErrorAction Stop
echo     $true 
echo }
echo $results['Basic_Auth'] = $r.Success
echo Write-Step 3 $total 'Basic Authentication' $^(if^($r.Success^){'OK'}else{'WARN'}^)
echo.
echo # Step 4: Negotiate Auth
echo Write-Step 4 $total 'Negotiate Authentication' 'PROGRESS'
echo $r = Invoke-WithRetry { 
echo     Set-Item WSMan:\localhost\Service\Auth\Negotiate -Value $true -Force -ErrorAction Stop
echo     $true 
echo }
echo $results['Negotiate_Auth'] = $r.Success
echo Write-Step 4 $total 'Negotiate Authentication' $^(if^($r.Success^){'OK'}else{'WARN'}^)
echo.
echo # Step 5: TrustedHosts
echo Write-Step 5 $total 'TrustedHosts Configuration' 'PROGRESS'
echo $r = Invoke-WithRetry { 
echo     Set-Item WSMan:\localhost\Client\TrustedHosts -Value '*' -Force -ErrorAction Stop
echo     $true 
echo }
echo $results['TrustedHosts'] = $r.Success
echo Write-Step 5 $total 'TrustedHosts Configuration' $^(if^($r.Success^){'OK'}else{'WARN'}^)
echo.
echo # Step 6: Firewall
echo Write-Step 6 $total 'Firewall Rules' 'PROGRESS'
echo $r = Invoke-WithRetry {
echo     Remove-NetFirewallRule -Name 'EPM-WinRM-*' -ErrorAction SilentlyContinue
echo     New-NetFirewallRule -Name 'EPM-WinRM-HTTP' -DisplayName 'WinRM HTTP ^(EPM^)' -Direction Inbound -Protocol TCP -LocalPort 5985 -Action Allow -Profile Any -ErrorAction Stop ^| Out-Null
echo     $true
echo }
echo $results['Firewall'] = $r.Success
echo Write-Step 6 $total 'Firewall Rules' $^(if^($r.Success^){'OK'}else{'WARN'}^)
echo.
echo # Step 7: Local Account Policy
echo Write-Step 7 $total 'Local Account Remote Policy' 'PROGRESS'
echo $r = Invoke-WithRetry { 
echo     Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'LocalAccountTokenFilterPolicy' -Value 1 -Force -ErrorAction Stop
echo     $true 
echo }
echo $results['Account_Policy'] = $r.Success
echo Write-Step 7 $total 'Local Account Remote Policy' $^(if^($r.Success^){'OK'}else{'WARN'}^)
echo.
echo # Step 8: Verification
echo Write-Step 8 $total 'WinRM Connection Verification' 'PROGRESS'
echo Restart-Service WinRM -Force -ErrorAction SilentlyContinue
echo Start-Sleep -Seconds 2
echo $winrmOK = $false
echo try { 
echo     Test-WSMan localhost -ErrorAction Stop ^| Out-Null
echo     $winrmOK = $true 
echo } catch {}
echo $results['Verification'] = $winrmOK
echo Write-Step 8 $total 'WinRM Connection Verification' $^(if^($winrmOK^){'OK'}else{'FAIL'}^)
echo.
echo $success = $results['WinRM_Service'] -and $winrmOK
echo.
echo Write-Host ''
echo Write-Host '    ========================================================================' -ForegroundColor DarkGray
echo.
echo if ^($success^) {
echo     Write-Host ''
echo     Write-Host '         ========================================' -ForegroundColor Green
echo     Write-Host '         =          SETUP COMPLETE!             =' -ForegroundColor Green
echo     Write-Host '         ========================================' -ForegroundColor Green
echo     Write-Host ''
echo     Write-Host '         Student PC setup completed successfully!' -ForegroundColor Green
echo     Write-Host ''
echo } else {
echo     Write-Host ''
echo     Write-Host '    [!] Some settings may have issues.' -ForegroundColor Yellow
echo     Write-Host '    Basic functionality may still work. Please test.' -ForegroundColor Yellow
echo     Write-Host ''
echo }
echo.
echo # Get IP
echo $ip = ^(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.InterfaceAlias -notlike '*Loopback*' -and $_.IPAddress -notlike '169.*' } ^| Select-Object -First 1^).IPAddress
echo if ^(-not $ip^) { $ip = 'N/A' }
echo $ws = if^($winrmOK^){'[OK] Running'}else{'[X] Stopped'}
echo.
echo Write-Host '    +------------------------------------------------------------------+' -ForegroundColor Cyan
echo Write-Host '    ^|  PC INFORMATION                                                 ^|' -ForegroundColor Cyan
echo Write-Host '    +------------------------------------------------------------------+' -ForegroundColor Cyan
echo Write-Host "    ^|  Computer Name: $^($env:COMPUTERNAME.PadRight^(48^)^)^|" -ForegroundColor White
echo Write-Host "    ^|  IP Address:    $^($ip.PadRight^(48^)^)^|" -ForegroundColor White
echo Write-Host "    ^|  WinRM Status:  $^($ws.PadRight^(48^)^)^|" -ForegroundColor White
echo Write-Host '    +------------------------------------------------------------------+' -ForegroundColor Cyan
echo.
echo Write-Host ''
echo Write-Host '    Result Summary:' -ForegroundColor White
echo foreach ^($k in $results.Keys^) {
echo     $v = if^($results[$k]^){'[OK]'}else{'[FAIL]'}
echo     $c = if^($results[$k]^){'Green'}else{'Red'}
echo     Write-Host "    $k : " -NoNewline -ForegroundColor Gray
echo     Write-Host $v -ForegroundColor $c
echo }
echo.
echo Write-Host ''
echo Write-Host '    ========================================================================' -ForegroundColor DarkGray
echo Write-Host ''
echo Write-Host '    Remote management is now available from the teacher PC!' -ForegroundColor White
echo Write-Host '    You can close this window.' -ForegroundColor Gray
echo Write-Host ''
) > "%PS_SCRIPT%"

:: PowerShell 스크립트 실행
PowerShell -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%"

:: 임시 스크립트 삭제
del "%PS_SCRIPT%" 2>nul

echo.
echo   Press any key to exit...
pause >nul
