@echo off
echo === JHS PC Manager 서버 자동 시작 등록 ===
echo.

:: 현재 경로
set "BACKEND=%~dp0"
set "NODE=node.exe"

:: autostart.bat 생성 (watchdog 포함)
echo @echo off > "%BACKEND%autostart-server.bat"
echo :LOOP >> "%BACKEND%autostart-server.bat"
echo echo [%%date%% %%time%%] Server starting... >> "%BACKEND%server.log" >> "%BACKEND%autostart-server.bat"
echo cd /d "%BACKEND%" >> "%BACKEND%autostart-server.bat"
echo %NODE% server.js >> "%BACKEND%server.log" 2^>^&1 >> "%BACKEND%autostart-server.bat"
echo echo [%%date%% %%time%%] Server crashed, restarting in 5s... >> "%BACKEND%server.log" >> "%BACKEND%autostart-server.bat"
echo timeout /t 5 /nobreak ^>NUL >> "%BACKEND%autostart-server.bat"
echo goto LOOP >> "%BACKEND%autostart-server.bat"

:: VBS 숨김 실행
echo Set ws = CreateObject("WScript.Shell") > "%BACKEND%start-server-hidden.vbs"
echo ws.Run "%BACKEND%autostart-server.bat", 0, False >> "%BACKEND%start-server-hidden.vbs"

:: 부팅 시 자동 시작 (schtask)
schtasks /create /tn "JHS_PCManager_Server" /tr "wscript.exe \"%BACKEND%start-server-hidden.vbs\"" /sc onstart /ru SYSTEM /rl highest /f
schtasks /create /tn "JHS_PCManager_Watchdog" /tr "wscript.exe \"%BACKEND%start-server-hidden.vbs\"" /sc minute /mo 5 /ru SYSTEM /rl highest /f

echo.
echo === 등록 완료! ===
echo  - 부팅 시 자동 시작
echo  - 5분마다 생존 확인
echo  - 죽으면 5초 후 자동 재시작
echo.

:: 지금 바로 시작
echo 서버 시작 중...
wscript.exe "%BACKEND%start-server-hidden.vbs"
timeout /t 3 /nobreak >NUL

:: 확인
tasklist /FI "IMAGENAME eq node.exe" | find /I "node.exe" >NUL
if %ERRORLEVEL%==0 (
    echo 서버 실행 중! http://localhost:3001 에서 접속하세요.
) else (
    echo 서버 시작 실패. server.log를 확인하세요.
)
echo.
pause
