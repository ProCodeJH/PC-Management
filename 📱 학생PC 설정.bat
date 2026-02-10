@echo off
setlocal EnableDelayedExpansion

:: ============================================================================
:: Enterprise PC Management - Ultra Premium Student PC Setup Launcher
:: Version 2.0 Ultra Premium
:: ============================================================================

:: UTF-8 인코딩 설정
chcp 65001 >nul 2>&1

:: 타이틀 및 색상
title ⚡ Enterprise PC Management - Ultra Premium Setup
color 0B

:: 관리자 권한 체크 및 자동 권한 상승
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo.
    echo   ⚠️  관리자 권한이 필요합니다. 권한 상승 중...
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

:: 메인 실행
cls
echo.
echo   ╔══════════════════════════════════════════════════════════════════════════╗
echo   ║                                                                          ║
echo   ║   ███████╗██╗   ██╗██████╗ ███████╗██████╗                               ║
echo   ║   ██╔════╝██║   ██║██╔══██╗██╔════╝██╔══██╗                              ║
echo   ║   ███████╗██║   ██║██████╔╝█████╗  ██████╔╝                              ║
echo   ║   ╚════██║██║   ██║██╔═══╝ ██╔══╝  ██╔══██╗                              ║
echo   ║   ███████║╚██████╔╝██║     ███████╗██║  ██║                              ║
echo   ║   ╚══════╝ ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═╝                              ║
echo   ║                                                                          ║
echo   ║         📱 학생 PC 원격 관리 설정 - Ultra Premium Edition                 ║
echo   ║                                                                          ║
echo   ╠══════════════════════════════════════════════════════════════════════════╣
echo   ║                                                                          ║
echo   ║   이 도구는 학생 PC를 원격 관리할 수 있도록 자동 설정합니다.             ║
echo   ║                                                                          ║
echo   ║   ✅ WinRM 서비스 활성화                                                 ║
echo   ║   ✅ PowerShell 원격 관리 활성화                                          ║
echo   ║   ✅ 방화벽 규칙 자동 설정                                                ║
echo   ║   ✅ 인증 방식 최적화                                                     ║
echo   ║   ✅ 다중 시도 및 자동 복구                                               ║
echo   ║                                                                          ║
echo   ╚══════════════════════════════════════════════════════════════════════════╝
echo.

:: PowerShell 스크립트 존재 여부 확인
set "SCRIPT_PATH=%~dp0StudentPC-Setup-Ultra.ps1"

if exist "%SCRIPT_PATH%" (
    echo   ✅ Ultra Premium 스크립트 발견
    echo.
    echo   ⏳ 설정을 시작합니다... (약 30초 소요)
    echo.
    PowerShell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_PATH%"
) else (
    echo   ⚠️ Ultra Premium 스크립트를 찾을 수 없습니다.
    echo   📁 기본 설정 모드로 실행합니다...
    echo.
    
    :: 인라인 PowerShell 실행 (폴백)
    PowerShell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference = 'Continue'; ^
    Write-Host '  [1/6] WinRM 서비스 활성화...' -ForegroundColor Cyan; ^
    try { Set-Service WinRM -StartupType Automatic; Start-Service WinRM; Write-Host '       ✅ 성공' -ForegroundColor Green } catch { Write-Host '       ⚠️ 계속 진행' -ForegroundColor Yellow }; ^
    Write-Host '  [2/6] PSRemoting 활성화...' -ForegroundColor Cyan; ^
    try { Enable-PSRemoting -Force -SkipNetworkProfileCheck 2>$null; Write-Host '       ✅ 성공' -ForegroundColor Green } catch { Write-Host '       ⚠️ 계속 진행' -ForegroundColor Yellow }; ^
    Write-Host '  [3/6] Basic 인증 활성화...' -ForegroundColor Cyan; ^
    try { Set-Item WSMan:\localhost\Service\Auth\Basic -Value $true -Force 2>$null; Write-Host '       ✅ 성공' -ForegroundColor Green } catch { Write-Host '       ⚠️ 계속 진행' -ForegroundColor Yellow }; ^
    Write-Host '  [4/6] TrustedHosts 설정...' -ForegroundColor Cyan; ^
    try { Set-Item WSMan:\localhost\Client\TrustedHosts -Value '*' -Force 2>$null; Write-Host '       ✅ 성공' -ForegroundColor Green } catch { Write-Host '       ⚠️ 계속 진행' -ForegroundColor Yellow }; ^
    Write-Host '  [5/6] 방화벽 규칙...' -ForegroundColor Cyan; ^
    try { New-NetFirewallRule -Name 'WinRM-HTTP' -DisplayName 'WinRM HTTP' -Protocol TCP -LocalPort 5985 -Direction Inbound -Action Allow -Profile Any -ErrorAction SilentlyContinue 2>$null; Write-Host '       ✅ 성공' -ForegroundColor Green } catch { Write-Host '       ⚠️ 계속 진행' -ForegroundColor Yellow }; ^
    Write-Host '  [6/6] 로컬 계정 정책...' -ForegroundColor Cyan; ^
    try { Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'LocalAccountTokenFilterPolicy' -Value 1 -Force 2>$null; Write-Host '       ✅ 성공' -ForegroundColor Green } catch { Write-Host '       ⚠️ 계속 진행' -ForegroundColor Yellow }; ^
    Restart-Service WinRM -Force 2>$null; ^
    Write-Host ''; ^
    Write-Host '  ════════════════════════════════════════════════════' -ForegroundColor Green; ^
    Write-Host '  ✅ 학생 PC 설정 완료!' -ForegroundColor Green; ^
    Write-Host '  ════════════════════════════════════════════════════' -ForegroundColor Green; ^
    "
)

echo.
echo   ══════════════════════════════════════════════════════════════════════════
echo   설정이 완료되었습니다. 아무 키나 누르면 종료됩니다...
echo   ══════════════════════════════════════════════════════════════════════════
pause >nul
