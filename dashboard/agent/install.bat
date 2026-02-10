@echo off
chcp 65001 >nul
title 🖥️ Enterprise PC Agent 설치

echo.
echo ╔══════════════════════════════════════════╗
echo ║     Enterprise PC Agent Installer        ║
echo ║     학생 PC 에이전트 자동 설치           ║
echo ╚══════════════════════════════════════════╝
echo.

:: Node.js 확인
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js가 설치되지 않았습니다!
    echo    https://nodejs.org 에서 LTS 버전을 설치하세요.
    pause
    exit /b 1
)

echo ✅ Node.js 확인됨: 
node -v
echo.

:: 서버 주소 입력
set /p SERVER_URL="서버 주소를 입력하세요 (기본: http://localhost:3001): "
if "%SERVER_URL%"=="" set SERVER_URL=http://localhost:3001

:: 의존성 설치
echo.
echo 📦 패키지 설치 중...
cd /d "%~dp0"
call npm install
if %errorlevel% neq 0 (
    echo ❌ 패키지 설치 실패!
    pause
    exit /b 1
)

echo.
echo ✅ 설치 완료!
echo.

:: 에이전트 시작
echo 🚀 에이전트를 시작합니다...
echo    서버: %SERVER_URL%
echo    종료: Ctrl+C
echo.

set SERVER_URL=%SERVER_URL%
node agent.js

pause
