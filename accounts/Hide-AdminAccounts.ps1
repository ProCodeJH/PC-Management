# Hide-AdminAccounts.ps1
# 관리자 계정 로그인 화면에서 숨기기

<#
.SYNOPSIS
    관리자 계정을 로그인 화면에서 숨김

.DESCRIPTION
    - Student 계정만 로그인 화면에 표시
    - 다른 모든 계정 숨김
    - 숨겨진 계정도 로그인 가능 (계정명 직접 입력)

.EXAMPLE
    .\Hide-AdminAccounts.ps1
    .\Hide-AdminAccounts.ps1 -ShowAccount "Student"
    .\Hide-AdminAccounts.ps1 -Remove
#>

[CmdletBinding()]
param(
    [string]$ShowAccount = "Student",
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
    Write-Host "  HIDE ADMIN ACCOUNTS" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
}

$hidePath = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList"

if ($Remove) {
    try {
        if (Test-Path $hidePath) {
            Remove-Item -Path $hidePath -Recurse -Force
        }
        Write-Host "  OK - All accounts visible" -ForegroundColor Green
    }
    catch {
        Write-Warning "Failed to show accounts: $_"
    }
    exit 0
}

try {
    if (-not (Test-Path $hidePath)) {
        New-Item -Path $hidePath -Force | Out-Null
    }
    
    # 모든 로컬 사용자 가져오기
    $allUsers = Get-LocalUser | Where-Object { $_.Enabled -eq $true }
    
    foreach ($user in $allUsers) {
        if ($user.Name -eq $ShowAccount) {
            # 보여줄 계정: 1 = Show
            New-ItemProperty -Path $hidePath -Name $user.Name -Value 1 -PropertyType DWord -Force | Out-Null
            if (-not $Silent) {
                Write-Host "  VISIBLE: $($user.Name)" -ForegroundColor Green
            }
        }
        else {
            # 숨길 계정: 0 = Hide
            New-ItemProperty -Path $hidePath -Name $user.Name -Value 0 -PropertyType DWord -Force | Out-Null
            if (-not $Silent) {
                Write-Host "  HIDDEN:  $($user.Name)" -ForegroundColor Yellow
            }
        }
    }
    
    if (-not $Silent) {
        Write-Host ""
        Write-Host "  Note: Hidden accounts can still login" -ForegroundColor Gray
        Write-Host "  (Enter username manually at login)" -ForegroundColor Gray
        Write-Host ""
    }
    
}
catch {
    Write-Warning "Hide accounts failed: $_"
}

return @{ 
    Success        = $true
    VisibleAccount = $ShowAccount
}
