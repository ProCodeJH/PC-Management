@echo off
chcp 65001 >NUL
echo.
echo  ========================================
echo   Old Agent Cleanup
echo  ========================================
echo.

echo  [1/4] Kill agent processes...
taskkill /F /IM wscript.exe >NUL 2>&1
for /f "tokens=2" %%a in ('wmic process where "executablepath like '%%PCAgent%%'" get processid 2^>NUL ^| findstr /r "[0-9]"') do (
    taskkill /F /PID %%a >NUL 2>&1
)
echo        OK

echo  [2/4] Remove autostart...
schtasks /delete /tn PCAgent /f >NUL 2>&1
schtasks /delete /tn PCAgent_Boot /f >NUL 2>&1
schtasks /delete /tn PCAgent_Watch /f >NUL 2>&1
schtasks /delete /tn PCAgent_Watchdog /f >NUL 2>&1
schtasks /delete /tn PCManagementAgent /f >NUL 2>&1
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v PCAgent /f >NUL 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v PCAgent /f >NUL 2>&1
del "%ALLUSERSPROFILE%\Microsoft\Windows\Start Menu\Programs\StartUp\PCAgent.vbs" >NUL 2>&1
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\PCAgent.vbs" >NUL 2>&1
echo        OK

echo  [3/4] Delete C:\PCAgent...
if exist "C:\PCAgent" rmdir /s /q "C:\PCAgent" >NUL 2>&1
if exist "C:\PCAgent" (echo        Reboot needed) else (echo        OK)

echo  [4/4] Restore admin rights...
net localgroup administrators "%USERNAME%" /add >NUL 2>&1
reg delete "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoClose /f >NUL 2>&1
echo        OK

echo.
echo  ========================================
echo   Cleanup done. Now run INSTALL-STUDENT.bat
echo  ========================================
echo.
pause
