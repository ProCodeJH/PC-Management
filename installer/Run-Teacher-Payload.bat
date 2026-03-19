@echo off
chcp 65001 >nul
title PC Management - Teacher Setup
echo.
echo ╔══════════════════════════════════════════╗
echo ║  PC Management - 교사용 설치 시작        ║
echo ╚══════════════════════════════════════════╝
echo.

:: Extract payload
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Teacher-Payload.ps1"
pause
