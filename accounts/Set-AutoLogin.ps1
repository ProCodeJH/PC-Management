# Set-AutoLogin.ps1
# 자동 로그인 설정

<#
.SYNOPSIS
    Windows 자동 로그인 설정

.DESCRIPTION
    - 지정된 계정으로 자동 로그인
    - 재부팅 시 비밀번호 없이 로그인

.EXAMPLE
    .\Set-AutoLogin.ps1 -Username "Student" -Password "74123"
    .\Set-AutoLogin.ps1 -Remove
#>

[CmdletBinding()]
param(
    [string]$Username = "Student",
    [string]$Password = "74123",
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
    Write-Host "  AUTO LOGIN SETUP" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
}

$regPath = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"

if ($Remove) {
    try {
        Set-ItemProperty -Path $regPath -Name "AutoAdminLogon" -Value "0" -Type String
        Remove-ItemProperty -Path $regPath -Name "DefaultPassword" -ErrorAction SilentlyContinue
        Write-Host "  OK - Auto login disabled" -ForegroundColor Green
    }
    catch {
        Write-Warning "Failed to disable auto login: $_"
    }
    exit 0
}

try {
    Set-ItemProperty -Path $regPath -Name "AutoAdminLogon" -Value "1" -Type String
    Set-ItemProperty -Path $regPath -Name "DefaultUserName" -Value $Username -Type String
    Set-ItemProperty -Path $regPath -Name "DefaultPassword" -Value $Password -Type String
    Set-ItemProperty -Path $regPath -Name "DefaultDomainName" -Value "" -Type String
    
    if (-not $Silent) {
        Write-Host "  OK - Auto login enabled" -ForegroundColor Green
        Write-Host ""
        Write-Host "  Account: $Username" -ForegroundColor Gray
        Write-Host "  On reboot: Auto login" -ForegroundColor Gray
        Write-Host ""
    }
    
}
catch {
    Write-Warning "Auto login setup failed: $_"
}

return @{ 
    Success  = $true
    Username = $Username
}
