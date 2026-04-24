@echo off
chcp 65001 >NUL
echo.
echo  ========================================
echo   JHS PC Agent v3.21 — Full Install (self-healing)
echo  ========================================
echo.

:: 1. Kill existing agent (node.exe + wscript.exe watchdog + vbs processes)
echo  [1/10] Kill agent...
REM Kill by commandline (catches wscript running PCAgent vbs files)
for /f "tokens=2" %%a in ('wmic process where "commandline like '%%PCAgent%%'" get processid 2^>NUL ^| findstr /r "[0-9]"') do (
    taskkill /F /PID %%a >NUL 2>&1
)
REM Kill by executable path (catches node.exe in C:\PCAgent)
for /f "tokens=2" %%a in ('wmic process where "executablepath like '%%PCAgent%%'" get processid 2^>NUL ^| findstr /r "[0-9]"') do (
    taskkill /F /PID %%a >NUL 2>&1
)
REM Wait for file handles to release
ping -n 2 127.0.0.1 >NUL
echo         OK

:: 2. Clean legacy autostart
echo  [2/10] Clean autostart...
schtasks /delete /tn PCAgent /f >NUL 2>&1
schtasks /delete /tn PCAgent_Boot /f >NUL 2>&1
schtasks /delete /tn PCAgent_Watch /f >NUL 2>&1
schtasks /delete /tn PCAgent_Watchdog /f >NUL 2>&1
schtasks /delete /tn PCManagementAgent /f >NUL 2>&1
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v PCAgent /f >NUL 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v PCAgent /f >NUL 2>&1
del "%ALLUSERSPROFILE%\Microsoft\Windows\Start Menu\Programs\StartUp\PCAgent.vbs" >NUL 2>&1
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\PCAgent.vbs" >NUL 2>&1
echo         OK

:: 3. Preserve config + Remove old install (with retry for stubborn file locks)
echo  [3/10] Backup config + remove old...
if exist "C:\PCAgent\.env" copy /y "C:\PCAgent\.env" "%TEMP%\pcagent-env.bak" >NUL 2>&1
if exist "C:\PCAgent" (
    rmdir /s /q "C:\PCAgent" >NUL 2>&1
    if exist "C:\PCAgent" (
        REM rmdir failed (likely file lock) — kill any remaining processes + retry
        for /f "tokens=2" %%a in ('wmic process where "commandline like '%%PCAgent%%'" get processid 2^>NUL ^| findstr /r "[0-9]"') do (
            taskkill /F /PID %%a >NUL 2>&1
        )
        ping -n 3 127.0.0.1 >NUL
        rmdir /s /q "C:\PCAgent" >NUL 2>&1
    )
    if exist "C:\PCAgent" (
        echo  [WARN] C:\PCAgent still exists — files may be locked. Try reboot.
    )
)
echo         OK

:: 4. Copy files (with integrity check)
echo  [4/10] Copy files...
mkdir "C:\PCAgent" >NUL 2>&1
xcopy /E /Y /Q "%~dp0Student-Setup\*" "C:\PCAgent\" >NUL
if not exist "C:\PCAgent\agent.js" (
    echo  [ERROR] Copy failed!
    pause
    exit /b 1
)
if not exist "C:\PCAgent\node.exe" (
    echo  [ERROR] node.exe missing — aborting
    pause
    exit /b 1
)
if not exist "C:\PCAgent\ffmpeg.exe" (
    echo  [WARN] ffmpeg.exe missing — live view will use screenshot fallback
)
echo         OK

:: 5. Create launchers
echo  [5/10] Create launchers...
(
echo @echo off
echo :LOOP
echo cd /d "C:\PCAgent"
echo set SERVER_URL=http://192.168.0.5:3001
echo "C:\PCAgent\node.exe" agent.js
echo ping -n 6 127.0.0.1 ^>NUL
echo goto LOOP
) > "C:\PCAgent\autostart.bat"

(
echo Set ws = CreateObject("WScript.Shell"^)
echo ws.Run """C:\PCAgent\autostart.bat""", 0, False
) > "C:\PCAgent\start-hidden.vbs"

(
echo Set ws = CreateObject("WScript.Shell"^)
echo Set fs = CreateObject("Scripting.FileSystemObject"^)
echo Do
echo     Dim alive : alive = False
echo     On Error Resume Next
echo     Set procs = GetObject("winmgmts:\\.\root\cimv2"^).ExecQuery("SELECT ExecutablePath FROM Win32_Process WHERE Name = 'node.exe'"^)
echo     If Err.Number = 0 Then
echo         For Each p In procs
echo             If InStr(1, p.ExecutablePath, "C:\PCAgent", 1^) ^> 0 Then alive = True
echo         Next
echo     End If
echo     Err.Clear
echo     On Error Goto 0
echo     If Not alive Then
echo         If fs.FileExists("C:\PCAgent\autostart.bat"^) Then
echo             ws.Run """C:\PCAgent\autostart.bat""", 0, False
echo         End If
echo     End If
echo     WScript.Sleep 15000
echo Loop
) > "C:\PCAgent\watchdog.vbs"

if exist "%TEMP%\pcagent-env.bak" (
    copy /y "%TEMP%\pcagent-env.bak" "C:\PCAgent\.env" >NUL 2>&1
    del /q "%TEMP%\pcagent-env.bak" >NUL 2>&1
    echo         OK (config restored)
) else (
    echo SERVER_URL=http://192.168.0.5:3001> "C:\PCAgent\.env"
    echo         OK (default config)
)

:: 6. Register 4-way autostart (highest privileges)
echo  [6/10] Register autostart...
schtasks /create /tn PCAgent /tr "wscript.exe \"C:\PCAgent\start-hidden.vbs\"" /sc onlogon /rl highest /f >NUL 2>&1
schtasks /create /tn PCAgent_Watchdog /tr "wscript.exe \"C:\PCAgent\watchdog.vbs\"" /sc onlogon /rl highest /f >NUL 2>&1
reg add "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v PCAgent /t REG_SZ /d "wscript.exe \"C:\PCAgent\start-hidden.vbs\"" /f >NUL 2>&1
copy /y "C:\PCAgent\start-hidden.vbs" "%ALLUSERSPROFILE%\Microsoft\Windows\Start Menu\Programs\StartUp\PCAgent.vbs" >NUL 2>&1
echo         OK (schtask + registry + startup + watchdog)

:: 7. Firewall
echo  [7/10] Firewall...
netsh advfirewall firewall delete rule name="PCAgent" >NUL 2>&1
netsh advfirewall firewall add rule name="PCAgent" dir=out action=allow program="C:\PCAgent\node.exe" >NUL 2>&1
netsh advfirewall firewall add rule name="PCAgent" dir=in action=allow program="C:\PCAgent\node.exe" >NUL 2>&1
echo         OK

:: 8. Lock agent folder (student can't modify/delete)
echo  [8/10] Lock agent folder...
icacls "C:\PCAgent" /inheritance:r >NUL 2>&1
icacls "C:\PCAgent" /grant:r SYSTEM:(OI)(CI)F >NUL 2>&1
icacls "C:\PCAgent" /grant:r Administrators:(OI)(CI)F >NUL 2>&1
icacls "C:\PCAgent" /grant:r Users:(OI)(CI)RX >NUL 2>&1
echo         OK (read+execute only for students)

:: 9. WOL + power settings (fast startup off, NIC WOL enabled)
echo  [9/10] WOL setup...
powercfg /h off >NUL 2>&1
powershell -NoProfile -Command ^
  "Get-NetAdapter | ForEach-Object{" ^
  "  try{Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName 'Wake on Magic Packet' -DisplayValue 'Enabled' -EA Stop}catch{};" ^
  "  try{Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName 'Energy Efficient Ethernet' -DisplayValue 'Disabled' -EA SilentlyContinue}catch{}" ^
  "}" >NUL 2>&1
echo         OK (fast startup off, WOL enabled)

:: 10. Auto-login (so agent starts after WOL without manual login)
echo  [10/10] Auto-login setup...
powershell -NoProfile -Command ^
  "$u=(Get-WmiObject Win32_UserAccount | Where-Object{$_.LocalAccount -and $_.Name -ne 'Administrator' -and $_.Name -ne 'exodia'} | Select-Object -First 1).Name;" ^
  "if(-not $u){$u=(Get-WmiObject Win32_ComputerSystem).UserName -replace '.*\\',''};" ^
  "if($u){" ^
  "  $p='HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon';" ^
  "  Set-ItemProperty $p -Name AutoAdminLogon -Value '1';" ^
  "  Set-ItemProperty $p -Name DefaultUserName -Value $u;" ^
  "  Set-ItemProperty $p -Name DefaultPassword -Value '74123';" ^
  "  Write-Host \"        $u auto-login enabled\" -ForegroundColor Green" ^
  "}else{Write-Host '        No student account found' -ForegroundColor Yellow}"

:: Start agent
echo  Starting agent...
start "" wscript.exe "C:\PCAgent\start-hidden.vbs"
start "" wscript.exe "C:\PCAgent\watchdog.vbs"
echo         OK

echo.
echo  ========================================
echo   Install complete! (v3.20)
echo   - Path: C:\PCAgent
echo   - Server: http://192.168.0.5:3001
echo   - Autostart: 4-way failsafe
echo   - Folder: locked (student can't modify)
echo   - WOL: enabled
echo   - Auto-login: enabled
echo  ========================================
echo.
echo  ** BIOS: Wake on LAN = Enabled **
echo  ** BIOS: ErP/Deep Sleep = Disabled **
echo.
pause
