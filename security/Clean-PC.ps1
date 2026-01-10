# Clean-PC.ps1
# 모든 설치 프로그램 제거 - 새 PC처럼 클린 상태로

<#
.SYNOPSIS
    PC를 새 본체처럼 클린 상태로 초기화

.DESCRIPTION
    Windows 기본 프로그램만 남기고 모든 프로그램 제거:
    - Microsoft Office 제외한 모든 프로그램 제거
    - Windows Store 앱 제거 (필수 제외)
    - 휴지통, 임시 파일 정리
    - 브라우저 기록 삭제

.PARAMETER KeepOffice
    Microsoft Office 유지

.PARAMETER KeepBrowsers
    Edge 외 브라우저도 유지

.EXAMPLE
    .\Clean-PC.ps1
    .\Clean-PC.ps1 -KeepOffice
    .\Clean-PC.ps1 -WhatIf
#>

[CmdletBinding()]
param(
    [switch]$KeepOffice,
    [switch]$KeepBrowsers,
    [switch]$WhatIf,
    [switch]$Force
)

if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "`n  ERROR: Administrator required!`n" -ForegroundColor Red
    exit 1
}

$Host.UI.RawUI.BackgroundColor = "Black"
Clear-Host

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Red
Write-Host "  ║                                                              ║" -ForegroundColor Red
Write-Host "  ║     ⚠️  PC CLEAN RESET                                       ║" -ForegroundColor Red
Write-Host "  ║     Factory-Level Clean Installation                         ║" -ForegroundColor Red
Write-Host "  ║                                                              ║" -ForegroundColor Red
Write-Host "  ╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Red
Write-Host ""

Write-Host "  This will REMOVE:                                " -ForegroundColor Yellow
Write-Host "    • ALL installed programs" -ForegroundColor White
Write-Host "    • ALL Windows Store apps (except essential)" -ForegroundColor White
Write-Host "    • ALL browser data & extensions" -ForegroundColor White
Write-Host "    • Temporary files & cache" -ForegroundColor White
Write-Host ""
Write-Host "  This will KEEP:" -ForegroundColor Green
Write-Host "    • Windows OS" -ForegroundColor Gray
Write-Host "    • Microsoft Edge" -ForegroundColor Gray
if ($KeepOffice) { Write-Host "    • Microsoft Office" -ForegroundColor Gray }
Write-Host "    • Essential Windows components" -ForegroundColor Gray
Write-Host ""

if (-not $Force) {
    Write-Host "  ⚠️  WARNING: This CANNOT be undone!" -ForegroundColor Red
    Write-Host ""
    $confirm = Read-Host "  Type 'CLEAN PC' to continue"
    if ($confirm -ne 'CLEAN PC') {
        Write-Host "`n  Cancelled.`n" -ForegroundColor Yellow
        exit 0
    }
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
Write-Host ""

$removedCount = 0
$startTime = Get-Date

# 제거하지 않을 프로그램 (화이트리스트)
$whitelist = @(
    "*Microsoft*Edge*",
    "*Windows*",
    "*Microsoft Visual C++*",
    "*Microsoft .NET*",
    "*.NET Framework*",
    "*DirectX*"
)

if ($KeepOffice) {
    $whitelist += "*Microsoft Office*"
    $whitelist += "*Microsoft 365*"
    $whitelist += "*Word*"
    $whitelist += "*Excel*"
    $whitelist += "*PowerPoint*"
    $whitelist += "*Outlook*"
}

# ========================================
# 1. 레지스트리 기반 프로그램 제거
# ========================================
Write-Host "  [1/5] Removing installed programs..." -ForegroundColor Cyan

$uninstallPaths = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
)

foreach ($path in $uninstallPaths) {
    $programs = Get-ItemProperty $path -ErrorAction SilentlyContinue | 
    Where-Object { $_.DisplayName -and $_.UninstallString }
    
    foreach ($program in $programs) {
        $shouldKeep = $false
        foreach ($pattern in $whitelist) {
            if ($program.DisplayName -like $pattern -or $program.Publisher -like $pattern) {
                $shouldKeep = $true
                break
            }
        }
        
        if (-not $shouldKeep) {
            if ($WhatIf) {
                Write-Host "    [WhatIf] Would remove: $($program.DisplayName)" -ForegroundColor Gray
            }
            else {
                Write-Host "    Removing: $($program.DisplayName)" -ForegroundColor DarkGray
                try {
                    $uninstall = $program.UninstallString
                    
                    if ($uninstall -like "MsiExec.exe*") {
                        $productCode = $uninstall -replace "MsiExec.exe\s*/[IX]", "" -replace "/I", "" -replace "/X", ""
                        $productCode = $productCode.Trim()
                        Start-Process "msiexec.exe" -ArgumentList "/x $productCode /qn /norestart" -Wait -NoNewWindow -ErrorAction SilentlyContinue
                        $removedCount++
                    }
                    elseif ($uninstall -like "*.exe*") {
                        if ($uninstall -match '"([^"]+)"') {
                            $exePath = $matches[1]
                            if (Test-Path $exePath) {
                                Start-Process $exePath -ArgumentList "/S", "/SILENT", "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART" -Wait -NoNewWindow -ErrorAction SilentlyContinue
                                $removedCount++
                            }
                        }
                    }
                }
                catch { }
            }
        }
    }
}

Write-Host "    ✓ Registry programs processed" -ForegroundColor Green
Write-Host ""

# ========================================
# 2. Windows Store 앱 제거
# ========================================
Write-Host "  [2/5] Removing Windows Store apps..." -ForegroundColor Cyan

$essentialApps = @(
    "*WindowsStore*",
    "*Calculator*",
    "*Photos*",
    "*WindowsCamera*",
    "*WindowsAlarms*",
    "*WindowsMaps*",
    "*WindowsNotepad*",
    "*Paint*",
    "*ScreenSketch*",
    "*WebMediaExtensions*",
    "*VCLibs*",
    "*UI.Xaml*",
    "*NET.Native*",
    "*DesktopAppInstaller*",
    "*Microsoft.Windows*"
)

$storeApps = Get-AppxPackage -AllUsers -ErrorAction SilentlyContinue

foreach ($app in $storeApps) {
    $shouldKeep = $false
    foreach ($pattern in $essentialApps) {
        if ($app.Name -like $pattern) {
            $shouldKeep = $true
            break
        }
    }
    
    if (-not $shouldKeep) {
        if ($WhatIf) {
            Write-Host "    [WhatIf] Would remove: $($app.Name)" -ForegroundColor Gray
        }
        else {
            try {
                Remove-AppxPackage -Package $app.PackageFullName -AllUsers -ErrorAction SilentlyContinue
                $removedCount++
            }
            catch { }
        }
    }
}

Write-Host "    ✓ Store apps processed" -ForegroundColor Green
Write-Host ""

# ========================================
# 3. 프로그램 폴더 정리
# ========================================
Write-Host "  [3/5] Cleaning program folders..." -ForegroundColor Cyan

$foldersToClean = @(
    "C:\Program Files",
    "C:\Program Files (x86)"
)

$folderWhitelist = @(
    "Common Files",
    "Microsoft*",
    "Windows*",
    "Internet Explorer",
    "WindowsPowerShell",
    "dotnet",
    "Reference Assemblies",
    "MSBuild"
)

foreach ($basePath in $foldersToClean) {
    if (Test-Path $basePath) {
        $folders = Get-ChildItem $basePath -Directory -ErrorAction SilentlyContinue
        
        foreach ($folder in $folders) {
            $shouldKeep = $false
            foreach ($pattern in $folderWhitelist) {
                if ($folder.Name -like $pattern) {
                    $shouldKeep = $true
                    break
                }
            }
            
            if (-not $shouldKeep) {
                if ($WhatIf) {
                    Write-Host "    [WhatIf] Would delete: $($folder.FullName)" -ForegroundColor Gray
                }
                else {
                    try {
                        # 프로세스 종료
                        Get-Process | Where-Object { $_.Path -like "$($folder.FullName)\*" } | Stop-Process -Force -ErrorAction SilentlyContinue
                        Start-Sleep -Milliseconds 500
                        Remove-Item -Path $folder.FullName -Recurse -Force -ErrorAction SilentlyContinue
                        $removedCount++
                    }
                    catch { }
                }
            }
        }
    }
}

Write-Host "    ✓ Program folders cleaned" -ForegroundColor Green
Write-Host ""

# ========================================
# 4. 사용자 데이터 정리
# ========================================
Write-Host "  [4/5] Cleaning user data..." -ForegroundColor Cyan

$userDataPaths = @(
    "$env:LOCALAPPDATA\Google",
    "$env:LOCALAPPDATA\Mozilla",
    "$env:LOCALAPPDATA\Discord",
    "$env:LOCALAPPDATA\Kakao",
    "$env:APPDATA\Discord",
    "$env:APPDATA\kakao",
    "$env:LOCALAPPDATA\Steam",
    "$env:LOCALAPPDATA\Programs"
)

foreach ($path in $userDataPaths) {
    if (Test-Path $path) {
        if ($WhatIf) {
            Write-Host "    [WhatIf] Would delete: $path" -ForegroundColor Gray
        }
        else {
            try {
                Remove-Item -Path $path -Recurse -Force -ErrorAction SilentlyContinue
                $removedCount++
            }
            catch { }
        }
    }
}

Write-Host "    ✓ User data cleaned" -ForegroundColor Green
Write-Host ""

# ========================================
# 5. 시스템 정리
# ========================================
Write-Host "  [5/5] System cleanup..." -ForegroundColor Cyan

if (-not $WhatIf) {
    # 임시 파일
    Remove-Item -Path "$env:TEMP\*" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "C:\Windows\Temp\*" -Recurse -Force -ErrorAction SilentlyContinue
    
    # 휴지통
    Clear-RecycleBin -Force -ErrorAction SilentlyContinue
    
    # 다운로드 폴더
    Remove-Item -Path "$env:USERPROFILE\Downloads\*" -Recurse -Force -ErrorAction SilentlyContinue
    
    # 바탕화면 정리 (시스템 아이콘 제외)
    Get-ChildItem "$env:USERPROFILE\Desktop" -File -ErrorAction SilentlyContinue | 
    Where-Object { $_.Extension -notin @(".lnk") } | 
    Remove-Item -Force -ErrorAction SilentlyContinue
}

Write-Host "    ✓ System cleanup complete" -ForegroundColor Green
Write-Host ""

# ========================================
# 완료
# ========================================
$duration = ((Get-Date) - $startTime).TotalSeconds

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║                                                              ║" -ForegroundColor Green
Write-Host "  ║     ✓ PC CLEAN COMPLETE!                                    ║" -ForegroundColor Green
Write-Host "  ║                                                              ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Duration:  $([math]::Round($duration, 1)) seconds" -ForegroundColor DarkGray
Write-Host "  Removed:   $removedCount items" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  PC is now in factory-like clean state!" -ForegroundColor Cyan
Write-Host ""

if (-not $WhatIf) {
    Write-Host "  ⚠️  Restart recommended for complete cleanup" -ForegroundColor Yellow
    Write-Host ""
    
    $restart = Read-Host "  Restart now? (Y/N)"
    if ($restart -eq 'Y') {
        Restart-Computer -Force
    }
}
