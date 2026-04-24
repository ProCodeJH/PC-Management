# JHS PC Manager — Admin PC Full Setup
# Server v23.0.0 + Agent v3.20
# Removes ALL student agent traces + sets up server autostart
# Run as Administrator (UAC required)

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "   JHS Admin PC Setup" -ForegroundColor Cyan
Write-Host "   Server v23.0.0 + Agent v3.20" -ForegroundColor Cyan
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Kill ALL agent + old server processes ──
Write-Host "  [1/7] Kill agents + old server..." -ForegroundColor Yellow
# Kill PCAgent node processes
Get-WmiObject Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
    if ($_.ExecutablePath -like "*PCAgent*" -or $_.CommandLine -like "*PCAgent*") {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "        Killed agent PID $($_.ProcessId)" -ForegroundColor DarkGray
    }
}
# Kill wscript running PCAgent
Get-WmiObject Win32_Process -Filter "Name='wscript.exe'" | ForEach-Object {
    if ($_.CommandLine -like "*PCAgent*") {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "        Killed wscript PID $($_.ProcessId)" -ForegroundColor DarkGray
    }
}
# Kill old server (will restart with v23 later)
$serverPids = netstat -ano | Select-String ":3001.*LISTEN" | ForEach-Object {
    if ($_ -match '\s+(\d+)\s*$') { $Matches[1] }
}
foreach ($sp in $serverPids) {
    Stop-Process -Id $sp -Force -ErrorAction SilentlyContinue
    Write-Host "        Killed server PID $sp" -ForegroundColor DarkGray
}
Start-Sleep -Seconds 2
Write-Host "        OK" -ForegroundColor Green

# ── 2. Remove ALL PCAgent autostart mechanisms ──
Write-Host "  [2/7] Remove agent autostart..." -ForegroundColor Yellow
# schtasks
schtasks /delete /tn "PCAgent" /f 2>$null | Out-Null
schtasks /delete /tn "PCAgent_Boot" /f 2>$null | Out-Null
schtasks /delete /tn "PCAgent_Watch" /f 2>$null | Out-Null
schtasks /delete /tn "PCAgent_Watchdog" /f 2>$null | Out-Null
schtasks /delete /tn "PCManagementAgent" /f 2>$null | Out-Null
Write-Host "        schtasks cleaned" -ForegroundColor Green
# Registry
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v PCAgent /f 2>$null | Out-Null
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v PCAgent /f 2>$null | Out-Null
Write-Host "        registry cleaned" -ForegroundColor Green
# Startup folders (all accounts)
Remove-Item "$env:ALLUSERSPROFILE\Microsoft\Windows\Start Menu\Programs\StartUp\PCAgent.vbs" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\PCAgent.vbs" -Force -ErrorAction SilentlyContinue
Write-Host "        startup folders cleaned" -ForegroundColor Green

# ── 3. Delete C:\PCAgent folder ──
Write-Host "  [3/7] Delete C:\PCAgent..." -ForegroundColor Yellow
if (Test-Path "C:\PCAgent") {
    Remove-Item "C:\PCAgent" -Recurse -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path "C:\PCAgent")) {
        Write-Host "        Deleted" -ForegroundColor Green
    } else {
        # Fallback: .NET method
        try {
            [System.IO.Directory]::Delete("C:\PCAgent", $true)
            Write-Host "        Deleted (.NET)" -ForegroundColor Green
        } catch {
            # Schedule deletion on next reboot via RunOnce + MoveFileEx
            reg add "HKLM\Software\Microsoft\Windows\CurrentVersion\RunOnce" /v "CleanPCAgent" /t REG_SZ /d "cmd /c rmdir /s /q C:\PCAgent" /f 2>$null | Out-Null
            # Also try MoveFileEx API
            try {
                Add-Type 'using System;using System.Runtime.InteropServices;public class FD{[DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)]public static extern bool MoveFileEx(string a,string b,int f);}'
                [FD]::MoveFileEx("C:\PCAgent", $null, 4) | Out-Null
            } catch {}
            Write-Host "        Scheduled for deletion on next reboot" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "        Already gone" -ForegroundColor Green
}

# ── 4. Clean hosts file ──
Write-Host "  [4/7] Clean hosts file..." -ForegroundColor Yellow
$hostsPath = "C:\Windows\System32\drivers\etc\hosts"
$content = [IO.File]::ReadAllText($hostsPath)
$startM = "# === PC-AGENT BLOCKED SITES START ==="
$endM = "# === PC-AGENT BLOCKED SITES END ==="
$si = $content.IndexOf($startM)
$ei = $content.IndexOf($endM)
if ($si -ge 0 -and $ei -gt $si) {
    $blocked = ($content.Substring($si, $ei - $si) -split "`n" | Where-Object { $_ -match "^127" }).Count
    $before = $content.Substring(0, $si).TrimEnd()
    $after = $content.Substring($ei + $endM.Length)
    [IO.File]::WriteAllText($hostsPath, ($before + $after).TrimEnd() + "`r`n")
    & ipconfig /flushdns 2>$null | Out-Null
    Write-Host "        $blocked sites unblocked" -ForegroundColor Green
} else {
    Write-Host "        Already clean" -ForegroundColor Green
}

# ── 5. Remove duplicate schtask ──
Write-Host "  [5/7] Clean duplicate autostart..." -ForegroundColor Yellow
schtasks /delete /tn "JHS-Server" /f 2>$null | Out-Null
# Remove exodia-only startup link (All Users already has it)
$exodiaOnly = "C:\Users\exodia\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\JHS-Server.lnk"
if (Test-Path $exodiaOnly) { Remove-Item $exodiaOnly -Force -ErrorAction SilentlyContinue }
Write-Host "        OK" -ForegroundColor Green

# ── 6. Ensure All Users Startup has v23 server shortcut ──
Write-Host "  [6/7] Setup v23 autostart..." -ForegroundColor Yellow
$dst = "$env:ALLUSERSPROFILE\Microsoft\Windows\Start Menu\Programs\StartUp\JHS-Server.lnk"
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut($dst)
$lnk.TargetPath = "C:\Program Files\nodejs\node.exe"
$lnk.Arguments = "server.js"
$lnk.WorkingDirectory = "C:\Users\exodia\.local\bin\PC-Management\dashboard\backend"
$lnk.Description = "JHS PC Manager Server v23"
$lnk.WindowStyle = 7  # minimized
$lnk.Save()
Write-Host "        All Users Startup shortcut set (v23)" -ForegroundColor Green

# ── 7. Start v23 server + open dashboard ──
Write-Host "  [7/7] Start v23 server..." -ForegroundColor Yellow
Start-Process -FilePath "C:\Program Files\nodejs\node.exe" -ArgumentList "server.js" -WorkingDirectory "C:\Users\exodia\.local\bin\PC-Management\dashboard\backend" -WindowStyle Minimized
Start-Sleep -Seconds 4
try {
    $r = Invoke-RestMethod -Uri "http://localhost:3001/api/health" -TimeoutSec 3
    Write-Host "        v$($r.version) running ($($r.status))" -ForegroundColor Green
} catch {
    Write-Host "        Server starting (check http://localhost:3001)" -ForegroundColor Yellow
}
Start-Process "http://localhost:3001"
Write-Host "        Dashboard opened" -ForegroundColor Green

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "   DONE" -ForegroundColor Cyan
Write-Host "   - Agent traces: ALL removed (5 locations)" -ForegroundColor White
Write-Host "   - Hosts: unblocked (YouTube/games/SNS OK)" -ForegroundColor White
Write-Host "   - Server v23: auto-starts on ANY account" -ForegroundColor White
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""
pause
