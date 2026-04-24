@echo off
setlocal
set BACKEND=C:\Users\exodia\.local\bin\PC-Management\dashboard\backend
set LOG=%BACKEND%\server.log
set LOG_OLD=%BACKEND%\server.log.old
set MAX_BYTES=10485760

:: If server already running, exit
netstat -ano | find "LISTENING" | find ":3001" >NUL 2>NUL
if %ERRORLEVEL%==0 exit /b 0

:LOOP
:: Log rotation: if log >10MB, rename to .old (single rotation keeps disk bounded)
if exist "%LOG%" (
    for %%F in ("%LOG%") do set SIZE=%%~zF
    if defined SIZE if %SIZE% GTR %MAX_BYTES% (
        del "%LOG_OLD%" 2>NUL
        move /y "%LOG%" "%LOG_OLD%" >NUL
    )
)

echo [%date% %time%] Server starting... >> "%LOG%"
cd /d "%BACKEND%"
node server.js >> "%LOG%" 2>&1
echo [%date% %time%] Restarting in 5s... >> "%LOG%"
timeout /t 5 /nobreak >NUL
goto LOOP
