@echo off
chcp 65001 >nul
title Enterprise PC Management - System Diagnosis
color 0C

echo.
echo   ╔════════════════════════════════════════════════════════════════════════════╗
echo   ║              ENTERPRISE PC MANAGEMENT - SYSTEM DIAGNOSIS                   ║
echo   ║                          시스템 진단                                         ║
echo   ╚════════════════════════════════════════════════════════════════════════════╝
echo.
echo   🔍 시스템 상태를 진단합니다...
echo.

PowerShell -ExecutionPolicy Bypass -File "%~dp0START-DASHBOARD.ps1" -DiagnoseOnly
