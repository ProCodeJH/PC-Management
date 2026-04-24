@echo off
chcp 65001 >nul
title Enterprise PC Agent - Uninstaller

echo.
echo ============================================
echo   Enterprise PC Agent Uninstaller
echo ============================================
echo.

:: Check admin privileges
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Administrator privileges required!
    pause
    exit /b 1
)

set AGENT_DIR=C:\ProgramData\PCAgent

:: Stop and remove scheduled task
echo [1/3] Stopping agent...
schtasks /End /TN "PCManagementAgent" >nul 2>&1
schtasks /Delete /TN "PCManagementAgent" /F >nul 2>&1
echo [OK] Scheduled task removed

:: Kill any running agent processes
taskkill /F /FI "WINDOWTITLE eq *PCAgent*" >nul 2>&1

:: Remove files
echo [2/3] Removing files...
if exist "%AGENT_DIR%" (
    rmdir /S /Q "%AGENT_DIR%" >nul 2>&1
    echo [OK] %AGENT_DIR% removed
) else (
    echo [OK] Already clean
)

echo [3/3] Cleanup complete
echo.
echo ============================================
echo   Agent uninstalled successfully
echo ============================================
echo.

pause
