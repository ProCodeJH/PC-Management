# Remove-Programs.ps1
# 외부 프로그램 (게임, 브라우저 등) 자동 삭제

<#
.SYNOPSIS
    게임, 브라우저 등 외부 프로그램 자동 제거

.DESCRIPTION
    - Steam, LOL, Discord 등 게임 관련 프로그램 제거
    - Chrome, Firefox 등 비Edge 브라우저 제거
    - 관련 폴더 정리

.PARAMETER WhatIf
    실제 삭제하지 않고 대상만 표시

.EXAMPLE
    .\Remove-Programs.ps1
    .\Remove-Programs.ps1 -WhatIf
#>

[CmdletBinding()]
param(
    [switch]$WhatIf,
    [switch]$Silent
)

# 관리자 권한 확인
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "ERROR: Administrator required!" -ForegroundColor Red
    exit 1
}

$removedCount = 0

if (-not $Silent) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  REMOVE EXTERNAL PROGRAMS" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
}

# 삭제할 프로그램 패턴
$programsToRemove = @(
    # 게임
    "*League of Legends*", "*LOL*", "*Riot*",
    "*Steam*", "*Valve*",
    "*Epic*", "*Fortnite*",
    "*Battle*", "*Blizzard*",
    "*Valorant*", "*Overwatch*",
    "*Minecraft*", "*Discord*",
    # 브라우저 (Edge 제외)
    "*Chrome*", "*Google*",
    "*Firefox*", "*Mozilla*",
    "*Opera*", "*Brave*",
    # 메신저
    "*Kakao*", "*Naver*", "*LINE*",
    # 기타
    "*Game*", "*Torrent*"
)

# 레지스트리 기반 제거
$uninstallPaths = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
)

if (-not $Silent) {
    Write-Host "[1/3] Registry-based uninstall..." -ForegroundColor Yellow
}

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
            if ($WhatIf) {
                Write-Host "  [WhatIf] Would remove: $($program.DisplayName)" -ForegroundColor Gray
            }
            else {
                if (-not $Silent) {
                    Write-Host "  Removing: $($program.DisplayName)" -ForegroundColor Gray
                }
                try {
                    $uninstall = $program.UninstallString
                    
                    if ($uninstall -like "MsiExec.exe*") {
                        $productCode = $uninstall -replace "MsiExec.exe\s*/[IX]", ""
                        Start-Process "msiexec.exe" -ArgumentList "/x $productCode /qn /norestart" -Wait -NoNewWindow
                        $removedCount++
                    }
                    elseif ($uninstall -like "*.exe*") {
                        if ($uninstall -match '"([^"]+)"') {
                            $exePath = $matches[1]
                            Start-Process $exePath -ArgumentList "/S", "/SILENT", "/VERYSILENT" -Wait -NoNewWindow -ErrorAction Stop
                            $removedCount++
                        }
                    }
                }
                catch {
                    # Silently continue
                }
            }
        }
    }
}

# Windows Store 앱 제거
if (-not $Silent) {
    Write-Host ""
    Write-Host "[2/3] Windows Store apps..." -ForegroundColor Yellow
}

foreach ($pattern in $programsToRemove) {
    $storeApps = Get-AppxPackage -ErrorAction SilentlyContinue | 
    Where-Object { $_.Name -like $pattern }
    
    foreach ($app in $storeApps) {
        if ($WhatIf) {
            Write-Host "  [WhatIf] Would remove: $($app.Name)" -ForegroundColor Gray
        }
        else {
            try {
                Remove-AppxPackage -Package $app.PackageFullName -ErrorAction Stop
                $removedCount++
            }
            catch { }
        }
    }
}

# 폴더 삭제
if (-not $Silent) {
    Write-Host ""
    Write-Host "[3/3] Cleaning folders..." -ForegroundColor Yellow
}

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
        if ($WhatIf) {
            Write-Host "  [WhatIf] Would delete: $folder" -ForegroundColor Gray
        }
        else {
            try {
                Get-Process | Where-Object { $_.Path -like "$folder\*" } | Stop-Process -Force -ErrorAction SilentlyContinue
                Remove-Item -Path $folder -Recurse -Force -ErrorAction Stop
                $removedCount++
            }
            catch { }
        }
    }
}

if (-not $Silent) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  Removed/Cleaned: $removedCount items" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
}

return @{ RemovedCount = $removedCount }
