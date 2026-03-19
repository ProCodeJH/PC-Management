@echo off
:: Copy payload to temp before IExpress cleans up
set WORKDIR=%TEMP%\PCAgent-Setup
if exist "%WORKDIR%" rmdir /s /q "%WORKDIR%"
mkdir "%WORKDIR%"
copy /y "%~dp0Student-Payload.zip" "%WORKDIR%\" >nul
copy /y "%~dp0Install-Student-Payload.ps1" "%WORKDIR%\" >nul

:: Write launcher in temp (avoids nested quote issues)
> "%WORKDIR%\go.bat" echo @echo off
>> "%WORKDIR%\go.bat" echo title PC Agent Setup
>> "%WORKDIR%\go.bat" echo powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%WORKDIR%\Install-Student-Payload.ps1"
>> "%WORKDIR%\go.bat" echo pause

:: Run in new interactive window
start "Setup" /wait "%WORKDIR%\go.bat"

:: Cleanup
rmdir /s /q "%WORKDIR%" 2>nul
