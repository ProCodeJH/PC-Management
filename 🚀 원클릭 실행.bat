@echo off
chcp 65001 >nul
title Enterprise PC Management - Ultra One-Click System v3.0
color 0B

echo.
echo   ╔════════════════════════════════════════════════════════════════════════════╗
echo   ║     ENTERPRISE PC MANAGEMENT - ULTRA ONE-CLICK SYSTEM v3.0                 ║
echo   ║                   초고도화 원클릭 실행 시스템                                ║
echo   ║                        PROMETHEUS GRADE                                    ║
echo   ╚════════════════════════════════════════════════════════════════════════════╝
echo.
echo   🚀 시스템을 시작합니다...
echo.

PowerShell -ExecutionPolicy Bypass -File "%~dp0START-DASHBOARD.ps1"
