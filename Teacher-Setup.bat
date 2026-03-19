@echo off
chcp 65001 >nul
title Enterprise PC Management - Teacher Setup
echo.
echo   ╔══════════════════════════════════════════╗
echo   ║  Enterprise PC Management                ║
echo   ║  교사용 서버 시작                         ║
echo   ╚══════════════════════════════════════════╝
echo.

:: Find node.exe (bundled runtime or system)
set NODE_PATH=
if exist "%~dp0runtime\node.exe" (
    set NODE_PATH=%~dp0runtime\node.exe
    echo   [OK] Using bundled Node.js
) else (
    where node >nul 2>&1
    if %errorlevel% equ 0 (
        set NODE_PATH=node
        echo   [OK] Using system Node.js
    ) else (
        echo   [ERROR] Node.js not found!
        echo   Install from https://nodejs.org
        pause
        exit /b 1
    )
)

:: Start server
cd /d "%~dp0dashboard\backend"
echo.
echo   Starting server...
echo   Dashboard: http://localhost:3001
echo   Close this window to stop the server.
echo.
"%NODE_PATH%" server.js
pause
