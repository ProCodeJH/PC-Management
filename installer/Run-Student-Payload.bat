@echo off
chcp 65001 >nul
title PC Management - Student Agent Setup
echo.
echo ╔══════════════════════════════════════════╗
echo ║  PC Management - 학생용 에이전트 설치     ║
echo ╚══════════════════════════════════════════╝
echo.

:: Extract and install agent
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Student-Payload.ps1"
pause
