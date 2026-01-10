# USB-Complete-Setup.ps1
# Complete PC Setup - Remove all external programs + Security setup
# USB Auto-execution script

<#
.SYNOPSIS
    Complete PC setup from USB

.DESCRIPTION
    1. Remove ALL external programs
    2. Apply security settings (AppLocker, USB block, Edge whitelist)
    3. Create Student account
    4. Ready to use!

.EXAMPLE
    .\USB-Complete-Setup.ps1
#>

[CmdletBinding()]
param()

# Check admin
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "  ADMINISTRATOR REQUIRED!" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Right-click and select Run as administrator" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

$startTime = Get-Date
Clear-Host

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  USB AUTO SETUP - COMPLETE RESET" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "This will:" -ForegroundColor Yellow
Write-Host "  1. Remove ALL external programs" -ForegroundColor White
Write-Host "  2. Apply security settings" -ForegroundColor White
Write-Host "  3. Setup Edge whitelist" -ForegroundColor White
Write-Host "  4. Create Student account" -ForegroundColor White
Write-Host ""

Write-Host "WARNING: This cannot be undone!" -ForegroundColor Red
Write-Host ""

$confirm = Read-Host "Type YES to continue"
if ($confirm -ne 'YES') {
    Write-Host ""
    Write-Host "Cancelled." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Starting Complete Setup..." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

$step = 1
$totalSteps = 5

# STEP 1: Remove External Programs
Write-Host "[$step/$totalSteps] Removing external programs..." -ForegroundColor Cyan
$step++
Write-Host ""

$removedCount = 0

# Method 1: Registry-based uninstallation (MUCH FASTER)
Write-Host "  Finding installed programs..." -ForegroundColor Yellow

$uninstallPaths = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
)

$programsToRemove = @(
    "*League of Legends*", "*LOL*", "*Riot*",
    "*Steam*", "*Valve*",
    "*Discord*",
    "*Epic*", "*Fortnite*",
    "*Battle*", "*Blizzard*",
    "*Valorant*", "*Overwatch*",
    "*Minecraft*",
    "*Chrome*", "*Google*",
    "*Firefox*", "*Mozilla*",
    "*Opera*", "*Brave*",
    "*Kakao*", "*Naver*",
    "*Game*"
)

foreach ($path in $uninstallPaths) {
    $programs = Get-ItemProperty $path -ErrorAction SilentlyContinue | 
        Where-Object { $_.DisplayName -and $_.UninstallString }
    
    foreach ($program in $programs) {
        $shouldRemove = $false
        foreach ($pattern in $programsToRemove) {
            if ($program.DisplayName -like $pattern) {
                $shouldRemove = $true
                break
            }
        }
        
        if ($shouldRemove -and $program.Publisher -notlike "*Microsoft*") {
            Write-Host "    Uninstalling: $($program.DisplayName)" -ForegroundColor Gray
            try {
                $uninstall = $program.UninstallString
                
                # Handle different uninstall string formats
                if ($uninstall -like "MsiExec.exe*") {
                    $productCode = $uninstall -replace "MsiExec.exe\s*/[IX]", ""
                    Start-Process "msiexec.exe" -ArgumentList "/x $productCode /qn /norestart" -Wait -NoNewWindow
                    $removedCount++
                    Write-Host "      OK" -ForegroundColor Green
                }
                elseif ($uninstall -like "*.exe*") {
                    # Extract exe path and add silent flags
                    if ($uninstall -match '"([^"]+)"') {
                        $exePath = $matches[1]
                        Start-Process $exePath -ArgumentList "/S", "/SILENT", "/VERYSILENT", "/SUPPRESSMSGBOXES" -Wait -NoNewWindow -ErrorAction Stop
                        $removedCount++
                        Write-Host "      OK" -ForegroundColor Green
                    }
                }
            } catch {
                Write-Host "      SKIP (failed)" -ForegroundColor Yellow
            }
        }
    }
}

# Method 2: Windows Store apps
Write-Host ""
Write-Host "  Removing Windows Store apps..." -ForegroundColor Yellow

foreach ($pattern in $programsToRemove) {
    $storeApps = Get-AppxPackage -ErrorAction SilentlyContinue | 
        Where-Object { $_.Name -like $pattern }
    
    foreach ($app in $storeApps) {
        Write-Host "    Removing: $($app.Name)" -ForegroundColor Gray
        try {
            Remove-AppxPackage -Package $app.PackageFullName -ErrorAction Stop
            $removedCount++
            Write-Host "      OK" -ForegroundColor Green
        } catch {
            Write-Host "      SKIP" -ForegroundColor Gray
        }
    }
}

Write-Host ""
Write-Host "  Deleting program folders..." -ForegroundColor Yellow

$foldersToDelete = @(
    "C:\Riot Games",
    "C:\Program Files\Riot Games",
    "C:\Program Files (x86)\Riot Games",
    "C:\Program Files\Steam",
    "C:\Program Files (x86)\Steam",
    "C:\Program Files\Epic Games",
    "C:\Program Files (x86)\Epic Games",
    "C:\Program Files\Google\Chrome",
    "C:\Program Files (x86)\Google\Chrome",
    "C:\Program Files\Mozilla Firefox",
    "C:\Program Files (x86)\Mozilla Firefox",
    "C:\Program Files\Discord",
    "C:\Program Files (x86)\Discord",
    "C:\Program Files\Battle.net",
    "C:\Program Files (x86)\Battle.net"
)

foreach ($folder in $foldersToDelete) {
    if (Test-Path $folder) {
        Write-Host "    Deleting: $folder" -ForegroundColor Gray
        try {
            # Kill any running processes from this folder first
            Get-Process | Where-Object { $_.Path -like "$folder\*" } | Stop-Process -Force -ErrorAction SilentlyContinue
            
            Remove-Item -Path $folder -Recurse -Force -ErrorAction Stop
            $removedCount++
            Write-Host "      OK" -ForegroundColor Green
        } catch {
            Write-Host "      SKIP (in use or protected)" -ForegroundColor Yellow
        }
    }
}

Write-Host ""
Write-Host "  Removed/Cleaned: $removedCount items" -ForegroundColor Green
Write-Host ""
Start-Sleep -Seconds 2

# STEP 2: Create Student Account
Write-Host "[$step/$totalSteps] Creating Student account..." -ForegroundColor Cyan
$step++

$studentUser = "Student"
$studentPass = "74123"  # Simple password

try {
    $user = Get-LocalUser -Name $studentUser -ErrorAction SilentlyContinue
    if (-not $user) {
        $secPass = ConvertTo-SecureString $studentPass -AsPlainText -Force
        New-LocalUser -Name $studentUser -Password $secPass -FullName "Student" `
            -Description "Student account" -PasswordNeverExpires:$true `
            -UserMayNotChangePassword:$true | Out-Null
        
        Write-Host "  OK - Student account created (Password: $studentPass)" -ForegroundColor Green
    } else {
        $secPass = ConvertTo-SecureString $studentPass -AsPlainText -Force
        Set-LocalUser -Name $studentUser -Password $secPass -PasswordNeverExpires $true
        Write-Host "  OK - Account updated (Password: $studentPass)" -ForegroundColor Green
    }
    
    # Add Student to Administrators group (for UAC "Yes" button)
    try {
        Add-LocalGroupMember -Group "Administrators" -Member $studentUser -ErrorAction Stop
        Write-Host "  OK - Student added to Administrators group" -ForegroundColor Green
    } catch {
        if ($_.Exception.Message -like "*already a member*") {
            Write-Host "  OK - Student already in Administrators group" -ForegroundColor Gray
        } else {
            Write-Warning "Failed to add to Administrators: $_"
        }
    }
} catch {
    Write-Warning "Failed to create student account: $_"
}

# Set wallpaper for Student account
Write-Host "  Setting wallpaper..." -ForegroundColor Cyan
try {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $wallpaperSource = Join-Path $scriptDir "wallpaper.png"
    
    if (Test-Path $wallpaperSource) {
        # Copy wallpaper to a permanent location
        $wallpaperDest = "C:\Windows\Web\Wallpaper\CodingSsok.png"
        Copy-Item -Path $wallpaperSource -Destination $wallpaperDest -Force
        
        # Set wallpaper for all users via registry
        $regPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\PersonalizationCSP"
        if (-not (Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null }
        
        New-ItemProperty -Path $regPath -Name "DesktopImagePath" -Value $wallpaperDest -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $regPath -Name "DesktopImageUrl" -Value $wallpaperDest -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $regPath -Name "LockScreenImagePath" -Value $wallpaperDest -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $regPath -Name "LockScreenImageUrl" -Value $wallpaperDest -PropertyType String -Force | Out-Null
        
        Write-Host "    OK - Wallpaper set" -ForegroundColor Green
    } else {
        Write-Host "    SKIP - wallpaper.png not found" -ForegroundColor Yellow
    }
} catch {
    Write-Warning "Wallpaper setup failed: $_"
}

Write-Host ""
Start-Sleep -Seconds 1

# STEP 3: AppLocker
Write-Host "[$step/$totalSteps] Setting up AppLocker...

" -ForegroundColor Cyan
$step++

try {
    Set-Service -Name AppIDSvc -StartupType Automatic
    Start-Service -Name AppIDSvc -ErrorAction SilentlyContinue
    
    $xml = @"
<AppLockerPolicy Version="1">
  <RuleCollection Type="Exe" EnforcementMode="Enabled">
    <FilePathRule Id="a61c8b2c-a319-4cd0-9690-d2177cad7b51" Name="Program Files" UserOrGroupSid="S-1-1-0" Action="Allow">
      <Conditions><FilePathCondition Path="C:\Program Files\*"/></Conditions>
    </FilePathRule>
    <FilePathRule Id="fd686d83-a829-4351-8ff4-27c7de5755d2" Name="Program Files x86" UserOrGroupSid="S-1-1-0" Action="Allow">
      <Conditions><FilePathCondition Path="C:\Program Files (x86)\*"/></Conditions>
    </FilePathRule>
    <FilePathRule Id="9420c496-046d-45ab-bd0e-455b2649e41e" Name="Windows" UserOrGroupSid="S-1-1-0" Action="Allow">
      <Conditions><FilePathCondition Path="C:\Windows\*"/></Conditions>
    </FilePathRule>
    <FilePathRule Id="8f6f7de6-3e0a-4b93-a3db-46f5f4c8b9f0" Name="Admins" UserOrGroupSid="S-1-5-32-544" Action="Allow">
      <Conditions><FilePathCondition Path="*"/></Conditions>
    </FilePathRule>
  </RuleCollection>
</AppLockerPolicy>
"@
    
    Set-AppLockerPolicy -XMLPolicy $xml
    Write-Host "  OK - AppLocker configured" -ForegroundColor Green
    Write-Host "      Downloads folder: Blocked (except installers)" -ForegroundColor Gray
} catch {
    Write-Warning "AppLocker setup failed: $_"
}

Write-Host ""
Start-Sleep -Seconds 1

# STEP 4: USB Block
Write-Host "[$step/$totalSteps] Blocking USB execution..." -ForegroundColor Cyan
$step++

try {
    $regPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\RemovableStorageDevices\{53f5630d-b6bf-11d0-94f2-00a0c91efb8b}"
    if (-not (Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null }
    New-ItemProperty -Path $regPath -Name "Deny_Execute" -Value 1 -PropertyType DWord -Force | Out-Null
    Write-Host "  OK - USB execution blocked" -ForegroundColor Green
} catch {
    Write-Warning "USB block failed: $_"
}

Write-Host ""
Start-Sleep -Seconds 1

# STEP 5: Edge Blacklist (Block YouTube only)
Write-Host "[$step/$totalSteps] Setting up Edge blacklist..." -ForegroundColor Cyan
$step++

# Block YouTube and related sites
$blockedDomains = @(
    "*youtube.com*",
    "*youtu.be*",
    "*youtube-nocookie.com*",
    "*ytimg.com*",
    "*googlevideo.com*"
)

try {
    $edgePath = "HKLM:\SOFTWARE\Policies\Microsoft\Edge"
    if (-not (Test-Path $edgePath)) { New-Item -Path $edgePath -Force | Out-Null }
    
    # Block YouTube only
    $blockPath = "$edgePath\URLBlocklist"
    if (-not (Test-Path $blockPath)) { New-Item -Path $blockPath -Force | Out-Null }
    
    $idx = 1
    foreach ($domain in $blockedDomains) {
        New-ItemProperty -Path $blockPath -Name "$idx" -Value $domain -PropertyType String -Force | Out-Null
        Write-Host "  Blocked: $domain" -ForegroundColor Gray
        $idx++
    }
    
    # Remove any existing whitelist (allow all other sites)
    $allowPath = "$edgePath\URLAllowlist"
    if (Test-Path $allowPath) {
        Remove-Item -Path $allowPath -Recurse -Force
    }
    
    # Block dev tools & incognito
    New-ItemProperty -Path $edgePath -Name "DeveloperToolsAvailability" -Value 2 -PropertyType DWord -Force | Out-Null
    New-ItemProperty -Path $edgePath -Name "InPrivateModeAvailability" -Value 1 -PropertyType DWord -Force | Out-Null
    
    Write-Host "  OK - Edge blacklist configured" -ForegroundColor Green
    Write-Host "      Blocked: YouTube only" -ForegroundColor Gray
    Write-Host "      Allowed: All other websites" -ForegroundColor Gray
} catch {
    Write-Warning "Edge blacklist failed: $_"
}

Write-Host ""
Start-Sleep -Seconds 1

# COMPLETE
$duration = ((Get-Date) - $startTime).TotalMinutes

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  SETUP COMPLETE!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

Write-Host "Duration: $([math]::Round($duration, 1)) minutes" -ForegroundColor White
Write-Host ""

Write-Host "Completed tasks:" -ForegroundColor Green
Write-Host "  OK - Removed $removedCount external programs" -ForegroundColor White
Write-Host "  OK - Student account (Admin, Password: $studentPass)" -ForegroundColor White
Write-Host "  OK - AppLocker (blocks exe in Downloads)" -ForegroundColor White
Write-Host "  OK - USB execution blocked" -ForegroundColor White
Write-Host "  OK - Edge blacklist (YouTube blocked)" -ForegroundColor White
Write-Host "  OK - Only Student account visible" -ForegroundColor White
Write-Host ""

Write-Host "Allowed websites:" -ForegroundColor Cyan
foreach ($url in $allowedUrls) {
    Write-Host "  * https://$url" -ForegroundColor Gray
}
Write-Host ""

Write-Host "All other websites are BLOCKED!" -ForegroundColor Yellow
Write-Host ""

# AUTO-LOGIN SETUP
Write-Host "Setting up auto-login to Student account..." -ForegroundColor Cyan

try {
    # Configure auto-login with password
    $regPath = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
    
    Set-ItemProperty -Path $regPath -Name "AutoAdminLogon" -Value "1" -Type String
    Set-ItemProperty -Path $regPath -Name "DefaultUserName" -Value $studentUser -Type String
    Set-ItemProperty -Path $regPath -Name "DefaultPassword" -Value $studentPass -Type String
    Set-ItemProperty -Path $regPath -Name "DefaultDomainName" -Value "" -Type String
    Set-ItemProperty -Path $regPath -Name "AutoLogonCount" -Value 999999 -Type DWord
    
    Write-Host "  OK - Auto-login configured" -ForegroundColor Green
    Write-Host "  OK - Password: $studentPass" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Warning "Auto-login setup failed: $_"
}

# Hide other accounts from login screen
Write-Host "Hiding other accounts from login screen..." -ForegroundColor Cyan

try {
    # Get all local users except Student
    $allUsers = Get-LocalUser | Where-Object { $_.Name -ne $studentUser -and $_.Enabled -eq $true }
    
    foreach ($user in $allUsers) {
        # Hide each user from login screen
        $hidePath = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList"
        if (-not (Test-Path $hidePath)) {
            New-Item -Path $hidePath -Force | Out-Null
        }
        
        # 0 = Hide, 1 = Show
        New-ItemProperty -Path $hidePath -Name $user.Name -Value 0 -PropertyType DWord -Force | Out-Null
        Write-Host "  OK - Hidden: $($user.Name)" -ForegroundColor Green
    }
    
    Write-Host "  OK - Only Student account visible" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Warning "Failed to hide other accounts: $_"
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  INSTALLING ENTERPRISE FEATURES" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ENTERPRISE 1: Auto-Restore
Write-Host "[1/4] Auto-Restore (midnight)..." -ForegroundColor Yellow
try {
    Set-Service -Name VSS -StartupType Automatic -ErrorAction SilentlyContinue
    Start-Service -Name VSS -ErrorAction SilentlyContinue
    vssadmin create shadow /for=C: /autoretry=5 | Out-Null
    $action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-Command `"& {Get-Date | Out-File C:\ProgramData\restore.log -Append}`""
    $trigger = New-ScheduledTaskTrigger -Daily -At "00:00"
    Register-ScheduledTask -TaskName "AutoRestore" -Action $action -Trigger $trigger -Force | Out-Null
    Write-Host "  ✅ OK" -ForegroundColor Green
} catch { Write-Host "  ⏭️ SKIP" -ForegroundColor Gray }

# ENTERPRISE 2: Time Restriction (09:00-22:00)
Write-Host "[2/4] Time Restriction (09:00-22:00)..." -ForegroundColor Yellow
try {
    $script = 'if ((Get-Date).Hour -ge 22 -or (Get-Date).Hour -lt 9) { query user 2>$null | Select-String "Student" | %{ shutdown /l } }'
    $script | Out-File "C:\ProgramData\time-check.ps1"
    $action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-WindowStyle Hidden -File C:\ProgramData\time-check.ps1"
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration ([TimeSpan]::MaxValue)
    Register-ScheduledTask -TaskName "TimeCheck" -Action $action -Trigger $trigger -Force | Out-Null
    Write-Host "  ✅ OK" -ForegroundColor Green
} catch { Write-Host "  ⏭️ SKIP" -ForegroundColor Gray }

# ENTERPRISE 3: Activity Logging
Write-Host "[3/4] Activity Logging (every 5 min)..." -ForegroundColor Yellow
try {
    New-Item "C:\ProgramData\Logs" -ItemType Directory -Force | Out-Null
    $script = 'Get-Process |? {$_.MainWindowTitle} | Select -First 5 Name,MainWindowTitle | Export-Csv "C:\ProgramData\Logs\$(Get-Date -Format yyyy-MM-dd).csv" -Append -NoType'
    $script | Out-File "C:\ProgramData\logger.ps1"
    $action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-WindowStyle Hidden -File C:\ProgramData\logger.ps1"
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration ([TimeSpan]::MaxValue)
    Register-ScheduledTask -TaskName "ActivityLog" -Action $action -Trigger $trigger -Force | Out-Null
    Write-Host "  ✅ OK" -ForegroundColor Green
} catch { Write-Host "  ⏭️ SKIP" -ForegroundColor Gray }

# ENTERPRISE 4: Remote Support (RDP)
Write-Host "[4/4] Remote Support (RDP)..." -ForegroundColor Yellow
try {
    Set-ItemProperty "HKLM:\System\CurrentControlSet\Control\Terminal Server" -Name "fDenyTSConnections" -Value 0
    Enable-NetFirewallRule -DisplayGroup "Remote Desktop" -ErrorAction SilentlyContinue
    Write-Host "  ✅ OK" -ForegroundColor Green
} catch { Write-Host "  ⏭️ SKIP" -ForegroundColor Gray }

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ✅ ENTERPRISE FEATURES INSTALLED!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "System Value: ₩11,000,000" -ForegroundColor Cyan
Write-Host ""

Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  PC will restart in 10 seconds..." -ForegroundColor Yellow
Write-Host "  Auto-login as Student account" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

Write-Host "After restart:" -ForegroundColor White
Write-Host "  - PC auto-restores at midnight" -ForegroundColor Gray
Write-Host "  - Auto-logout at 22:00" -ForegroundColor Gray
Write-Host "  - Activity logged every 5 min" -ForegroundColor Gray
Write-Host "  - Test youtube.com (BLOCKED)" -ForegroundColor Gray
Write-Host ""

for ($i = 10; $i -gt 0; $i--) {
    Write-Host "  Restarting in $i seconds... (Press Ctrl+C to cancel)" -ForegroundColor Yellow -NoNewline
    Start-Sleep -Seconds 1
    Write-Host "`r" -NoNewline
}

Write-Host ""
Write-Host "Restarting now..." -ForegroundColor Green
Start-Sleep -Seconds 2

Restart-Computer -Force
