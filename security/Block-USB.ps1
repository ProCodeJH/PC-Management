# Block-USB.ps1
# USB 저장장치 실행 차단

<#
.SYNOPSIS
    USB 저장장치 실행 차단

.DESCRIPTION
    - USB 드라이브에서 프로그램 실행 방지
    - 파일 읽기/복사는 가능
    - 레지스트리 정책 사용

.EXAMPLE
    .\Block-USB.ps1
    .\Block-USB.ps1 -Remove
#>

[CmdletBinding()]
param(
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
    Write-Host "  USB EXECUTION BLOCK" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
}

$regPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\RemovableStorageDevices\{53f5630d-b6bf-11d0-94f2-00a0c91efb8b}"

if ($Remove) {
    try {
        if (Test-Path $regPath) {
            Remove-ItemProperty -Path $regPath -Name "Deny_Execute" -ErrorAction SilentlyContinue
        }
        Write-Host "  OK - USB execution unblocked" -ForegroundColor Green
    }
    catch {
        Write-Warning "Failed to unblock USB: $_"
    }
    exit 0
}

try {
    if (-not (Test-Path $regPath)) {
        New-Item -Path $regPath -Force | Out-Null
    }
    
    New-ItemProperty -Path $regPath -Name "Deny_Execute" -Value 1 -PropertyType DWord -Force | Out-Null
    
    if (-not $Silent) {
        Write-Host "  OK - USB execution blocked" -ForegroundColor Green
        Write-Host ""
        Write-Host "  Status:" -ForegroundColor Gray
        Write-Host "    - USB files: Can READ/COPY" -ForegroundColor Gray
        Write-Host "    - USB exe:   BLOCKED" -ForegroundColor Yellow
        Write-Host ""
    }
    
}
catch {
    Write-Warning "USB block failed: $_"
}

return @{ Success = $true }
