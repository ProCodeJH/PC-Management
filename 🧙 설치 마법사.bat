@echo off
chcp 65001 >nul
title EPM Setup Wizard

echo.
echo   ╔════════════════════════════════════════════════════╗
echo   ║   Enterprise PC Management - Setup Wizard          ║
echo   ╚════════════════════════════════════════════════════╝
echo.
echo   ▶ 설치 마법사를 시작합니다...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup-Wizard.ps1"
