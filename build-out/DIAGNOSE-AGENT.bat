@echo off
:: DIAGNOSE-AGENT.bat — Root cause finder for dead student PCs (e.g. 0.10/0.40)
:: Usage: double-click on the problem PC, inspect C:\PCAgent-diagnose.txt
:: Writes to both C:\PCAgent-diagnose.txt and USB root if detected

setlocal EnableDelayedExpansion
set LOG=C:\PCAgent-diagnose.txt
echo NAVA Agent Diagnostic Report > "%LOG%"
echo Generated: %date% %time% >> "%LOG%"
echo =================================== >> "%LOG%"

echo. >> "%LOG%"
echo [1] Windows version >> "%LOG%"
ver >> "%LOG%"
systeminfo | findstr /B /C:"OS Name" /C:"OS Version" /C:"System Type" >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo [2] Current user + session >> "%LOG%"
whoami >> "%LOG%"
whoami /groups | findstr /i "administrators" >> "%LOG%"
echo Session: >> "%LOG%"
query user 2>>"%LOG%"

echo. >> "%LOG%"
echo [3] C:\PCAgent directory state >> "%LOG%"
if exist "C:\PCAgent" (
    dir "C:\PCAgent" >> "%LOG%"
) else (
    echo MISSING — C:\PCAgent does not exist! >> "%LOG%"
)

echo. >> "%LOG%"
echo [4] Node.exe + agent.js presence >> "%LOG%"
if exist "C:\PCAgent\node.exe" (echo node.exe: OK >> "%LOG%") else (echo node.exe: MISSING >> "%LOG%")
if exist "C:\PCAgent\agent.js" (echo agent.js: OK >> "%LOG%") else (echo agent.js: MISSING >> "%LOG%")
if exist "C:\PCAgent\ffmpeg.exe" (echo ffmpeg.exe: OK >> "%LOG%") else (echo ffmpeg.exe: MISSING >> "%LOG%")
if exist "C:\PCAgent\autostart.bat" (echo autostart.bat: OK >> "%LOG%") else (echo autostart.bat: MISSING >> "%LOG%")
if exist "C:\PCAgent\start-hidden.vbs" (echo start-hidden.vbs: OK >> "%LOG%") else (echo start-hidden.vbs: MISSING >> "%LOG%")

echo. >> "%LOG%"
echo [5] Running processes >> "%LOG%"
tasklist /FI "IMAGENAME eq node.exe" /FO LIST >> "%LOG%" 2>&1
tasklist /FI "IMAGENAME eq wscript.exe" /FO LIST >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo [6] Scheduled tasks (autostart mechanism #1 + #2) >> "%LOG%"
schtasks /query /tn PCAgent /fo LIST /v 2>>"%LOG%" | findstr /i "Task\s*Name Status\s*:" >> "%LOG%"
schtasks /query /tn PCAgent_Watchdog /fo LIST /v 2>>"%LOG%" | findstr /i "Task\s*Name Status\s*:" >> "%LOG%"

echo. >> "%LOG%"
echo [7] HKLM Registry Run key (autostart mechanism #3) >> "%LOG%"
reg query "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v PCAgent 2>>"%LOG%"

echo. >> "%LOG%"
echo [8] Startup folder (autostart mechanism #4) >> "%LOG%"
if exist "%ALLUSERSPROFILE%\Microsoft\Windows\Start Menu\Programs\StartUp\PCAgent.vbs" (
    echo All Users Startup: EXISTS >> "%LOG%"
) else (
    echo All Users Startup: MISSING >> "%LOG%"
)

echo. >> "%LOG%"
echo [9] Firewall rules >> "%LOG%"
netsh advfirewall firewall show rule name="PCAgent" 2>>"%LOG%"

echo. >> "%LOG%"
echo [10] Network — can agent reach server? >> "%LOG%"
ping -n 2 192.168.0.5 >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo [11] Port 3001 HTTP check >> "%LOG%"
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://192.168.0.5:3001/api/health' -UseBasicParsing -TimeoutSec 5; Write-Output ('Server reachable: ' + $r.StatusCode) } catch { Write-Output ('Server UNREACHABLE: ' + $_.Exception.Message) }" >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo [12] Try to manually run agent and capture first 15 seconds >> "%LOG%"
echo === Manual agent launch test === >> "%LOG%"
if exist "C:\PCAgent\node.exe" if exist "C:\PCAgent\agent.js" (
    cd /d "C:\PCAgent"
    start /b "" cmd /c ""C:\PCAgent\node.exe" agent.js > "C:\PCAgent-manual.log" 2>&1"
    timeout /t 15 /nobreak >NUL
    taskkill /F /IM node.exe >NUL 2>&1
    if exist "C:\PCAgent-manual.log" (
        echo --- manual log (first 50 lines) --- >> "%LOG%"
        powershell -NoProfile -Command "Get-Content C:\PCAgent-manual.log -TotalCount 50" >> "%LOG%" 2>&1
    )
)

echo. >> "%LOG%"
echo [13] Anti-virus + SmartScreen blocking? >> "%LOG%"
powershell -NoProfile -Command "Get-MpComputerStatus | Select-Object -Property AMServiceEnabled, RealTimeProtectionEnabled | Format-List" >> "%LOG%" 2>&1
powershell -NoProfile -Command "Get-MpThreatDetection | Where-Object { $_.Resources -like '*PCAgent*' -or $_.Resources -like '*node.exe*' } | Format-List" >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo [14] Event log — last agent errors >> "%LOG%"
powershell -NoProfile -Command "Get-EventLog -LogName Application -Newest 20 -Source 'Node*','Application Error' -ErrorAction SilentlyContinue | Where-Object { $_.Message -like '*PCAgent*' -or $_.Message -like '*node.exe*' } | Format-List TimeGenerated, Source, Message" >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo =================================== >> "%LOG%"
echo Report saved: %LOG% >> "%LOG%"

:: Try to copy to USB drives (E-Z)
for %%D in (E F G H I J K) do (
    if exist "%%D:\" (
        copy /y "%LOG%" "%%D:\PCAgent-diagnose-%COMPUTERNAME%.txt" >NUL 2>&1
        if not errorlevel 1 echo Also copied to %%D: drive
    )
)

echo.
echo ======================================
echo  DIAGNOSIS COMPLETE
echo  Log: %LOG%
echo  Check the log on a working PC
echo ======================================
echo.
pause
