@echo off
chcp 65001 >nul
taskkill /FI "WINDOWTITLE eq PCAgent" /F >nul 2>&1
schtasks /delete /tn "PCAgent" /f >nul 2>&1
del "%ALLUSERSPROFILE%\Microsoft\Windows\Start Menu\Programs\StartUp\PCAgent.bat" >nul 2>&1
echo [OK] Agent stopped and unregistered
