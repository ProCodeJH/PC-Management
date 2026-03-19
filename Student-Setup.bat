@echo off
chcp 65001 >nul
title Enterprise PC Management - Student Agent
echo.
echo   ╔══════════════════════════════════════════╗
echo   ║  Enterprise PC Management                ║
echo   ║  학생용 에이전트 설치                     ║
echo   ╚══════════════════════════════════════════╝
echo.

:: Find node.exe
set NODE_PATH=
if exist "%~dp0node.exe" (
    set NODE_PATH=%~dp0node.exe
) else if exist "%~dp0runtime\node.exe" (
    set NODE_PATH=%~dp0runtime\node.exe
) else (
    where node >nul 2>&1
    if %errorlevel% equ 0 (
        set NODE_PATH=node
    ) else (
        echo   [ERROR] Node.js not found!
        pause
        exit /b 1
    )
)

:: Ask server URL
set /p SERVER_URL="  교사 PC 서버 주소 (예: http://192.168.0.10:3001): "
if "%SERVER_URL%"=="" set SERVER_URL=http://localhost:3001

echo.
echo   Server: %SERVER_URL%
echo   Starting agent... (Ctrl+C to stop)
echo.

cd /d "%~dp0"
set SERVER_URL=%SERVER_URL%
"%NODE_PATH%" agent.js
pause
