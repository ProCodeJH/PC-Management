# Enable-RemoteManagement.ps1
# 원격 관리 기능 활성화 (학생 PC에서 1회 실행)
# + 선택적 클린 PC 기능

<#
.SYNOPSIS
    원격 배포를 위한 WinRM 설정 + 클린 PC 옵션

.DESCRIPTION
    이 스크립트를 학생 PC에서 1회 실행하면
    관리자 PC에서 원격으로 시스템을 배포할 수 있습니다.
    
    -CleanPC 옵션 사용 시 새 본체처럼 모든 프로그램 제거

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

# 관리자 권한 확인
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
Write-Host "  ╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║                                                              ║" -ForegroundColor Cyan
Write-Host "  ║     🚀  ENTERPRISE PC MANAGEMENT                            ║" -ForegroundColor Cyan
Write-Host "  ║         Remote Management Setup                              ║" -ForegroundColor Cyan
Write-Host "  ║                                                              ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ========================================
# Clean PC 옵션 처리
# ========================================
if ($CleanPC) {
    Write-Host "  ╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Red
    Write-Host "  ║  ⚠️  CLEAN PC MODE ENABLED                                  ║" -ForegroundColor Red
    Write-Host "  ║  All programs will be removed!                              ║" -ForegroundColor Red
    Write-Host "  ╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Red
    Write-Host ""
    Write-Host "  This will REMOVE:" -ForegroundColor Yellow
    Write-Host "    • ALL installed programs (games, browsers, messengers...)" -ForegroundColor White
    Write-Host "    • ALL Windows Store apps (except essential)" -ForegroundColor White
    Write-Host "    • ALL user data (Downloads, browser data...)" -ForegroundColor White
    Write-Host ""
    
    if ($KeepOffice) {
        Write-Host "  ✓ Microsoft Office will be KEPT" -ForegroundColor Green
    }
    
    Write-Host ""
    
    if (-not $Auto) {
        Write-Host "  ⚠️  WARNING: This CANNOT be undone!" -ForegroundColor Red
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

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
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
    # CLEAN PC 실행 (옵션)
    # ========================================
    if ($CleanPC) {
        Write-Step "Removing installed programs..."
        
        # 화이트리스트
        $whitelist = @(
            "*Microsoft*Edge*", "*Windows*", "*Microsoft Visual C++*",
            "*Microsoft .NET*", "*.NET Framework*", "*DirectX*"
        )
        if ($KeepOffice) {
            $whitelist += @("*Microsoft Office*", "*Microsoft 365*", "*Word*", "*Excel*", "*PowerPoint*", "*Outlook*")
        }
        
        # 레지스트리 프로그램 제거
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
        Write-Host "    ✓ Removed $removedCount programs" -ForegroundColor Green
        Write-Host ""
        
        # Windows Store 앱 제거
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
        Write-Host "    ✓ Store apps cleaned" -ForegroundColor Green
        Write-Host ""
        
        # 프로그램 폴더 정리
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
        Write-Host "    ✓ Program folders cleaned" -ForegroundColor Green
        Write-Host ""
        
        # 사용자 데이터 정리
        Write-Step "Cleaning user data..."
        @(
            "$env:LOCALAPPDATA\Google", "$env:LOCALAPPDATA\Mozilla", "$env:LOCALAPPDATA\Discord",
            "$env:LOCALAPPDATA\Kakao", "$env:LOCALAPPDATA\Steam", "$env:APPDATA\Discord"
        ) | ForEach-Object {
            if (Test-Path $_) { Remove-Item -Path $_ -Recurse -Force -ErrorAction SilentlyContinue }
        }
        Write-Host "    ✓ User data cleaned" -ForegroundColor Green
        Write-Host ""
        
        # 시스템 정리
        Write-Step "System cleanup..."
        Remove-Item -Path "$env:TEMP\*" -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -Path "C:\Windows\Temp\*" -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -Path "$env:USERPROFILE\Downloads\*" -Recurse -Force -ErrorAction SilentlyContinue
        Clear-RecycleBin -Force -ErrorAction SilentlyContinue
        Write-Host "    ✓ System cleaned" -ForegroundColor Green
        Write-Host ""
    }
    
    # ========================================
    # 원격 관리 설정
    # ========================================
    Write-Step "Enabling PowerShell Remoting..."
    Enable-PSRemoting -Force -SkipNetworkProfileCheck
    Write-Host "    ✓ Done" -ForegroundColor Green
    Write-Host ""
    
    Write-Step "Configuring WinRM Service..."
    Set-Service -Name WinRM -StartupType Automatic
    Start-Service -Name WinRM
    Write-Host "    ✓ Done" -ForegroundColor Green
    Write-Host ""
    
    Write-Step "Configuring Firewall..."
    $rule = Get-NetFirewallRule -Name "WINRM-HTTP-In-TCP" -ErrorAction SilentlyContinue
    if (-not $rule) {
        New-NetFirewallRule -Name "WINRM-HTTP-In-TCP" -DisplayName "WinRM (HTTP-In)" -Protocol TCP -LocalPort 5985 -Direction Inbound -Action Allow -Profile Any | Out-Null
    }
    else {
        Enable-NetFirewallRule -Name "WINRM-HTTP-In-TCP"
    }
    Write-Host "    ✓ Port 5985 opened" -ForegroundColor Green
    Write-Host ""
    
    Write-Step "Setting Trusted Hosts..."
    Set-Item WSMan:\localhost\Client\TrustedHosts -Value "*" -Force
    Write-Host "    ✓ Done" -ForegroundColor Green
    Write-Host ""
    
    # ========================================
    # 완료
    # ========================================
    $ipAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" } | Select-Object -First 1).IPAddress
    
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "  ║                                                              ║" -ForegroundColor Green
    Write-Host "  ║     ✓ SETUP COMPLETE!                                       ║" -ForegroundColor Green
    Write-Host "  ║                                                              ║" -ForegroundColor Green
    Write-Host "  ╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
    
    if ($CleanPC) {
        Write-Host "  ✓ PC cleaned to factory-like state!" -ForegroundColor Cyan
    }
    
    Write-Host ""
    Write-Host "  PC Information:" -ForegroundColor White
    Write-Host "  ───────────────────────────" -ForegroundColor DarkGray
    Write-Host "    Computer:   $env:COMPUTERNAME" -ForegroundColor Gray
    Write-Host "    IP Address: $ipAddress" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  👉 Enter this IP in the admin dashboard to deploy!" -ForegroundColor Cyan
    Write-Host ""
    
    if ($CleanPC) {
        Write-Host "  ⚠️  Restart recommended for complete cleanup" -ForegroundColor Yellow
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
    Read-Host "  Press Enter to exit"
}
