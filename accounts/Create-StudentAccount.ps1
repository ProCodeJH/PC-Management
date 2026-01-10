# Create-StudentAccount.ps1
# 학생 계정 생성

<#
.SYNOPSIS
    학생용 로컬 계정 생성

.DESCRIPTION
    - Student 계정 생성
    - 관리자 그룹 추가 (선택)
    - 비밀번호 만료 안함

.PARAMETER Password
    학생 계정 비밀번호

.PARAMETER AddToAdmin
    관리자 그룹에 추가

.EXAMPLE
    .\Create-StudentAccount.ps1
    .\Create-StudentAccount.ps1 -Password "mypass123" -AddToAdmin
#>

[CmdletBinding()]
param(
    [string]$Username = "Student",
    [string]$Password = "74123",
    [switch]$AddToAdmin,
    [switch]$Silent
)

if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "ERROR: Administrator required!" -ForegroundColor Red
    exit 1
}

if (-not $Silent) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  CREATE STUDENT ACCOUNT" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
}

try {
    $user = Get-LocalUser -Name $Username -ErrorAction SilentlyContinue
    $secPass = ConvertTo-SecureString $Password -AsPlainText -Force
    
    if (-not $user) {
        # 새 계정 생성
        New-LocalUser -Name $Username -Password $secPass -FullName $Username `
            -Description "Student account" -PasswordNeverExpires:$true `
            -UserMayNotChangePassword:$true | Out-Null
        
        if (-not $Silent) {
            Write-Host "  OK - Account created: $Username" -ForegroundColor Green
        }
    }
    else {
        # 기존 계정 업데이트
        Set-LocalUser -Name $Username -Password $secPass -PasswordNeverExpires $true
        if (-not $Silent) {
            Write-Host "  OK - Account updated: $Username" -ForegroundColor Green
        }
    }
    
    # 관리자 그룹 추가
    if ($AddToAdmin) {
        try {
            Add-LocalGroupMember -Group "Administrators" -Member $Username -ErrorAction Stop
            if (-not $Silent) {
                Write-Host "  OK - Added to Administrators group" -ForegroundColor Green
            }
        }
        catch {
            if ($_.Exception.Message -like "*already a member*") {
                if (-not $Silent) {
                    Write-Host "  OK - Already in Administrators group" -ForegroundColor Gray
                }
            }
        }
    }
    
    if (-not $Silent) {
        Write-Host ""
        Write-Host "  Account: $Username" -ForegroundColor Gray
        Write-Host "  Password: $Password" -ForegroundColor Gray
        Write-Host ""
    }
    
}
catch {
    Write-Warning "Account creation failed: $_"
}

return @{ 
    Success  = $true
    Username = $Username
    Password = $Password
}
