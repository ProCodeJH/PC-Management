# Enable-RemoteManagement.ps1
# Remote management feature activation (Run once on student PC)
# + Optional Clean PC feature

<#
.SYNOPSIS
    WinRM setup for remote deployment + Clean PC option

.DESCRIPTION
    Run this script once on student PC
    Then admin can deploy systems remotely from admin PC.
    
    Use -CleanPC option to remove all programs like a new PC

.EXAMPLE
    .\Enable-RemoteManagement.ps1
    .\Enable-RemoteManagement.ps1 -CleanPC
    .\Enable-RemoteManagement.ps1 -CleanPC -KeepOffice
#>

param(
    [switch]$CleanPC,
    [switch]$KeepOffice,
    [switch]$Auto
)

# Administrator check
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host ""
    Write-Host "  ERROR: Administrator required!" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

$Host.UI.RawUI.BackgroundColor = "Black"
Clear-Host

Write-Host ""
Write-Host "  ================================================================" -ForegroundColor Cyan
Write-Host "  |                                                              |" -ForegroundColor Cyan
Write-Host "  |     ENTERPRISE PC MANAGEMENT                                 |" -ForegroundColor Cyan
Write-Host "  |     Remote Management Setup                                  |" -ForegroundColor Cyan
Write-Host "  |                                                              |" -ForegroundColor Cyan
Write-Host "  ================================================================" -ForegroundColor Cyan
Write-Host ""

# ========================================
# Clean PC option processing
# ========================================
if ($CleanPC) {
    Write-Host "  ================================================================" -ForegroundColor Red
    Write-Host "  |  WARNING: CLEAN PC MODE ENABLED                             |" -ForegroundColor Red
    Write-Host "  |  All programs will be removed!                              |" -ForegroundColor Red
    Write-Host "  ================================================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "  This will REMOVE:" -ForegroundColor Yellow
    Write-Host "    * ALL installed programs (games, browsers, messengers...)" -ForegroundColor White
    Write-Host "    * ALL Windows Store apps (except essential)" -ForegroundColor White
    Write-Host "    * ALL user data (Downloads, browser data...)" -ForegroundColor White
    Write-Host ""
    
    if ($KeepOffice) {
        Write-Host "  [OK] Microsoft Office will be KEPT" -ForegroundColor Green
    }
    
    Write-Host ""
    
    if (-not $Auto) {
        Write-Host "  WARNING: This CANNOT be undone!" -ForegroundColor Red
        Write-Host ""
        $cleanConfirm = Read-Host "  Type 'CLEAN' to enable clean mode, or Enter to skip"
        
        if ($cleanConfirm -ne 'CLEAN') {
            Write-Host ""
            Write-Host "  Clean PC mode cancelled. Continuing with remote setup only..." -ForegroundColor Yellow
            $CleanPC = $false
        }
    }
    Write-Host ""
}

Write-Host "----------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host ""

if (-not $Auto) {
    Write-Host "  This will enable remote management on this PC." -ForegroundColor Gray
    Write-Host "  After this, admin can deploy systems remotely." -ForegroundColor Gray
    Write-Host ""
    $confirm = Read-Host "  Continue? (Y/N)"
    if ($confirm -ne "Y" -and $confirm -ne "y") {
        Write-Host "`n  Cancelled.`n" -ForegroundColor Yellow
        exit 0
    }
    Write-Host ""
}

$totalSteps = 4
if ($CleanPC) { $totalSteps = 9 }
$currentStep = 0

function Write-Step($message) {
    $script:currentStep++
    Write-Host "  [$currentStep/$totalSteps] $message" -ForegroundColor Cyan
}

try {
    # ========================================
    # CLEAN PC execution (option)
    # ========================================
    if ($CleanPC) {
        Write-Step "Removing installed programs..."
        
        # Whitelist
        $whitelist = @(
            "*Microsoft*Edge*", "*Windows*", "*Microsoft Visual C++*",
            "*Microsoft .NET*", "*.NET Framework*", "*DirectX*"
        )
        if ($KeepOffice) {
            $whitelist += @("*Microsoft Office*", "*Microsoft 365*", "*Word*", "*Excel*", "*PowerPoint*", "*Outlook*")
        }
        
        # Registry program removal
        $uninstallPaths = @(
            "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
            "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
        )
        
        $removedCount = 0
        foreach ($path in $uninstallPaths) {
            $programs = Get-ItemProperty $path -ErrorAction SilentlyContinue | 
            Where-Object { $_.DisplayName -and $_.UninstallString }
            
            foreach ($program in $programs) {
                $shouldKeep = $false
                foreach ($pattern in $whitelist) {
                    if ($program.DisplayName -like $pattern) { $shouldKeep = $true; break }
                }
                
                if (-not $shouldKeep) {
                    Write-Host "    Removing: $($program.DisplayName)" -ForegroundColor DarkGray
                    try {
                        $uninstall = $program.UninstallString
                        if ($uninstall -like "MsiExec.exe*") {
                            $productCode = ($uninstall -replace "MsiExec.exe\s*/[IX]", "").Trim()
                            Start-Process "msiexec.exe" -ArgumentList "/x $productCode /qn /norestart" -Wait -NoNewWindow -ErrorAction SilentlyContinue
                            $removedCount++
                        }
                    }
                    catch { }
                }
            }
        }
        Write-Host "    [OK] Removed $removedCount programs" -ForegroundColor Green
        Write-Host ""
        
        # Windows Store app removal
        Write-Step "Removing Windows Store apps..."
        $essentialApps = @("*WindowsStore*", "*Calculator*", "*Photos*", "*WindowsCamera*", "*Microsoft.Windows*", "*VCLibs*", "*UI.Xaml*")
        
        Get-AppxPackage -AllUsers -ErrorAction SilentlyContinue | ForEach-Object {
            $keep = $false
            foreach ($pattern in $essentialApps) {
                if ($_.Name -like $pattern) { $keep = $true; break }
            }
            if (-not $keep) {
                try { Remove-AppxPackage -Package $_.PackageFullName -AllUsers -ErrorAction SilentlyContinue } catch { }
            }
        }
        Write-Host "    [OK] Store apps cleaned" -ForegroundColor Green
        Write-Host ""
        
        # Program folder cleanup
        Write-Step "Cleaning program folders..."
        $folderWhitelist = @("Common Files", "Microsoft*", "Windows*", "Internet Explorer", "WindowsPowerShell", "dotnet")
        
        foreach ($basePath in @("C:\Program Files", "C:\Program Files (x86)")) {
            if (Test-Path $basePath) {
                Get-ChildItem $basePath -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                    $keep = $false
                    foreach ($pattern in $folderWhitelist) {
                        if ($_.Name -like $pattern) { $keep = $true; break }
                    }
                    if (-not $keep) {
                        try {
                            Get-Process | Where-Object { $_.Path -like "$($_.FullName)\*" } | Stop-Process -Force -ErrorAction SilentlyContinue
                            Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
                        }
                        catch { }
                    }
                }
            }
        }
        Write-Host "    [OK] Program folders cleaned" -ForegroundColor Green
        Write-Host ""
        
        # User data cleanup
        Write-Step "Cleaning user data..."
        @(
            "$env:LOCALAPPDATA\Google", "$env:LOCALAPPDATA\Mozilla", "$env:LOCALAPPDATA\Discord",
            "$env:LOCALAPPDATA\Kakao", "$env:LOCALAPPDATA\Steam", "$env:APPDATA\Discord"
        ) | ForEach-Object {
            if (Test-Path $_) { Remove-Item -Path $_ -Recurse -Force -ErrorAction SilentlyContinue }
        }
        Write-Host "    [OK] User data cleaned" -ForegroundColor Green
        Write-Host ""
        
        # System cleanup
        Write-Step "System cleanup..."
        Remove-Item -Path "$env:TEMP\*" -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -Path "C:\Windows\Temp\*" -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -Path "$env:USERPROFILE\Downloads\*" -Recurse -Force -ErrorAction SilentlyContinue
        Clear-RecycleBin -Force -ErrorAction SilentlyContinue
        Write-Host "    [OK] System cleaned" -ForegroundColor Green
        Write-Host ""
    }
    
    # ========================================
    # Remote management setup
    # ========================================
    Write-Step "Enabling PowerShell Remoting..."
    Enable-PSRemoting -Force -SkipNetworkProfileCheck
    Write-Host "    [OK] Done" -ForegroundColor Green
    Write-Host ""
    
    Write-Step "Configuring WinRM Service..."
    Set-Service -Name WinRM -StartupType Automatic
    Start-Service -Name WinRM
    Write-Host "    [OK] Done" -ForegroundColor Green
    Write-Host ""
    
    Write-Step "Configuring Firewall..."
    $rule = Get-NetFirewallRule -Name "WINRM-HTTP-In-TCP" -ErrorAction SilentlyContinue
    if (-not $rule) {
        New-NetFirewallRule -Name "WINRM-HTTP-In-TCP" -DisplayName "WinRM (HTTP-In)" -Protocol TCP -LocalPort 5985 -Direction Inbound -Action Allow -Profile Any | Out-Null
    }
    else {
        Enable-NetFirewallRule -Name "WINRM-HTTP-In-TCP"
    }
    Write-Host "    [OK] Port 5985 opened" -ForegroundColor Green
    Write-Host ""
    
    Write-Step "Setting Trusted Hosts..."
    # 보안: 내부 서브넷으로 제한 (전체 허용 제거)
    # 필요시 IP 범위를 환경에 맞게 수정하세요
    Set-Item WSMan:\localhost\Client\TrustedHosts -Value "192.168.*.*" -Force
    Write-Host "    [OK] Done" -ForegroundColor Green
    Write-Host ""
    
    # ========================================
    # Complete
    # ========================================
    $ipAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" } | Select-Object -First 1).IPAddress
    
    Write-Host "----------------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  ================================================================" -ForegroundColor Green
    Write-Host "  |                                                              |" -ForegroundColor Green
    Write-Host "  |     [OK] SETUP COMPLETE!                                     |" -ForegroundColor Green
    Write-Host "  |                                                              |" -ForegroundColor Green
    Write-Host "  ================================================================" -ForegroundColor Green
    Write-Host ""
    
    if ($CleanPC) {
        Write-Host "  [OK] PC cleaned to factory-like state!" -ForegroundColor Cyan
    }
    
    Write-Host ""
    Write-Host "  PC Information:" -ForegroundColor White
    Write-Host "  ---------------------------" -ForegroundColor DarkGray
    Write-Host "    Computer:   $env:COMPUTERNAME" -ForegroundColor Gray
    Write-Host "    IP Address: $ipAddress" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  --> Enter this IP in the admin dashboard to deploy!" -ForegroundColor Cyan
    Write-Host ""
    
    if ($CleanPC) {
        Write-Host "  WARNING: Restart recommended for complete cleanup" -ForegroundColor Yellow
        Write-Host ""
        $restart = Read-Host "  Restart now? (Y/N)"
        if ($restart -eq 'Y' -or $restart -eq 'y') {
            Restart-Computer -Force
        }
    }
    
}
catch {
    Write-Host ""
    Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    exit 1
}

if (-not $Auto) {
    Write-Host ""
    Read-Host "Press Enter to exit"
}
