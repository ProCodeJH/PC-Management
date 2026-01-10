# Block-Websites.ps1
# Edge 웹사이트 블랙리스트/화이트리스트 설정

<#
.SYNOPSIS
    웹사이트 차단 (Edge 브라우저)

.DESCRIPTION
    - 블랙리스트: 특정 사이트만 차단
    - 화이트리스트: 지정 사이트만 허용
    - 개발자 도구/InPrivate 차단

.PARAMETER Mode
    blacklist 또는 whitelist

.PARAMETER Sites
    차단/허용할 사이트 목록

.EXAMPLE
    .\Block-Websites.ps1 -Mode blacklist -Sites "youtube.com","twitch.tv"
    .\Block-Websites.ps1 -Mode whitelist -Sites "google.com","naver.com"
#>

[CmdletBinding()]
param(
    [ValidateSet("blacklist", "whitelist")]
    [string]$Mode = "blacklist",
    
    [string[]]$Sites = @(
        "youtube.com",
        "youtu.be",
        "twitch.tv",
        "tiktok.com"
    ),
    
    [switch]$BlockDevTools = $true,
    [switch]$BlockInPrivate = $true,
    [switch]$Remove,
    [switch]$Silent
)

if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "ERROR: Administrator required!" -ForegroundColor Red
    exit 1
}

if (-not $Silent) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  EDGE WEBSITE CONTROL" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
}

$edgePath = "HKLM:\SOFTWARE\Policies\Microsoft\Edge"
$blockPath = "$edgePath\URLBlocklist"
$allowPath = "$edgePath\URLAllowlist"

if ($Remove) {
    try {
        if (Test-Path $blockPath) { Remove-Item -Path $blockPath -Recurse -Force }
        if (Test-Path $allowPath) { Remove-Item -Path $allowPath -Recurse -Force }
        Remove-ItemProperty -Path $edgePath -Name "DeveloperToolsAvailability" -ErrorAction SilentlyContinue
        Remove-ItemProperty -Path $edgePath -Name "InPrivateModeAvailability" -ErrorAction SilentlyContinue
        Write-Host "  OK - Website restrictions removed" -ForegroundColor Green
    }
    catch {
        Write-Warning "Failed to remove restrictions: $_"
    }
    exit 0
}

try {
    if (-not (Test-Path $edgePath)) { 
        New-Item -Path $edgePath -Force | Out-Null 
    }
    
    if ($Mode -eq "blacklist") {
        # 블랙리스트 모드: 특정 사이트만 차단
        if (Test-Path $allowPath) { Remove-Item -Path $allowPath -Recurse -Force }
        if (-not (Test-Path $blockPath)) { New-Item -Path $blockPath -Force | Out-Null }
        
        # 기존 항목 제거
        Get-ItemProperty $blockPath -ErrorAction SilentlyContinue | 
        Get-Member -MemberType NoteProperty | 
        Where-Object { $_.Name -match '^\d+$' } | 
        ForEach-Object { Remove-ItemProperty -Path $blockPath -Name $_.Name -ErrorAction SilentlyContinue }
        
        $idx = 1
        foreach ($site in $Sites) {
            $pattern = "*$site*"
            New-ItemProperty -Path $blockPath -Name "$idx" -Value $pattern -PropertyType String -Force | Out-Null
            if (-not $Silent) {
                Write-Host "  BLOCKED: $site" -ForegroundColor Red
            }
            $idx++
        }
        
    }
    else {
        # 화이트리스트 모드: 지정 사이트만 허용
        if (-not (Test-Path $blockPath)) { New-Item -Path $blockPath -Force | Out-Null }
        if (-not (Test-Path $allowPath)) { New-Item -Path $allowPath -Force | Out-Null }
        
        # 모든 사이트 차단
        New-ItemProperty -Path $blockPath -Name "1" -Value "*" -PropertyType String -Force | Out-Null
        
        $idx = 1
        foreach ($site in $Sites) {
            New-ItemProperty -Path $allowPath -Name "$idx" -Value "*$site*" -PropertyType String -Force | Out-Null
            if (-not $Silent) {
                Write-Host "  ALLOWED: $site" -ForegroundColor Green
            }
            $idx++
        }
    }
    
    # 개발자 도구 차단
    if ($BlockDevTools) {
        New-ItemProperty -Path $edgePath -Name "DeveloperToolsAvailability" -Value 2 -PropertyType DWord -Force | Out-Null
        if (-not $Silent) {
            Write-Host ""
            Write-Host "  Developer Tools: BLOCKED" -ForegroundColor Yellow
        }
    }
    
    # InPrivate 차단
    if ($BlockInPrivate) {
        New-ItemProperty -Path $edgePath -Name "InPrivateModeAvailability" -Value 1 -PropertyType DWord -Force | Out-Null
        if (-not $Silent) {
            Write-Host "  InPrivate Mode:  BLOCKED" -ForegroundColor Yellow
        }
    }
    
    if (-not $Silent) {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "  Website restrictions applied!" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Host ""
    }
    
}
catch {
    Write-Warning "Website block failed: $_"
}

return @{ 
    Success    = $true
    Mode       = $Mode
    SitesCount = $Sites.Count
}
