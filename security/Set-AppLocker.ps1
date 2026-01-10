# Set-AppLocker.ps1
# AppLocker 정책 설정 - Downloads 폴더 exe 실행 차단

<#
.SYNOPSIS
    AppLocker 정책 설정

.DESCRIPTION
    - Program Files, Windows 폴더만 exe 실행 허용
    - Downloads, 바탕화면 등에서 exe 실행 차단
    - 관리자는 모든 곳에서 실행 가능

.EXAMPLE
    .\Set-AppLocker.ps1
    .\Set-AppLocker.ps1 -Remove
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
    Write-Host "  APPLOCKER SETUP" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
}

if ($Remove) {
    try {
        # AppLocker 정책 제거
        $emptyPolicy = @"
<AppLockerPolicy Version="1">
  <RuleCollection Type="Exe" EnforcementMode="NotConfigured">
  </RuleCollection>
</AppLockerPolicy>
"@
        Set-AppLockerPolicy -XMLPolicy $emptyPolicy
        Write-Host "  OK - AppLocker disabled" -ForegroundColor Green
    }
    catch {
        Write-Warning "Failed to remove AppLocker: $_"
    }
    exit 0
}

try {
    # AppIDSvc 서비스 활성화
    Set-Service -Name AppIDSvc -StartupType Automatic
    Start-Service -Name AppIDSvc -ErrorAction SilentlyContinue
    
    # AppLocker 정책 XML
    $policy = @"
<AppLockerPolicy Version="1">
  <RuleCollection Type="Exe" EnforcementMode="Enabled">
    <!-- Program Files 허용 -->
    <FilePathRule Id="a61c8b2c-a319-4cd0-9690-d2177cad7b51" Name="Program Files" UserOrGroupSid="S-1-1-0" Action="Allow">
      <Conditions><FilePathCondition Path="C:\Program Files\*"/></Conditions>
    </FilePathRule>
    <FilePathRule Id="fd686d83-a829-4351-8ff4-27c7de5755d2" Name="Program Files x86" UserOrGroupSid="S-1-1-0" Action="Allow">
      <Conditions><FilePathCondition Path="C:\Program Files (x86)\*"/></Conditions>
    </FilePathRule>
    <!-- Windows 폴더 허용 -->
    <FilePathRule Id="9420c496-046d-45ab-bd0e-455b2649e41e" Name="Windows" UserOrGroupSid="S-1-1-0" Action="Allow">
      <Conditions><FilePathCondition Path="C:\Windows\*"/></Conditions>
    </FilePathRule>
    <!-- 관리자는 모든 곳 허용 -->
    <FilePathRule Id="8f6f7de6-3e0a-4b93-a3db-46f5f4c8b9f0" Name="Admins" UserOrGroupSid="S-1-5-32-544" Action="Allow">
      <Conditions><FilePathCondition Path="*"/></Conditions>
    </FilePathRule>
    <!-- Enterprise 폴더 허용 -->
    <FilePathRule Id="c1d2e3f4-5678-90ab-cdef-1234567890ab" Name="Enterprise" UserOrGroupSid="S-1-1-0" Action="Allow">
      <Conditions><FilePathCondition Path="C:\Enterprise-PC-Management\*"/></Conditions>
    </FilePathRule>
  </RuleCollection>
</AppLockerPolicy>
"@
    
    Set-AppLockerPolicy -XMLPolicy $policy
    
    if (-not $Silent) {
        Write-Host "  OK - AppLocker enabled" -ForegroundColor Green
        Write-Host ""
        Write-Host "  Allowed locations:" -ForegroundColor Gray
        Write-Host "    - C:\Program Files\*" -ForegroundColor Gray
        Write-Host "    - C:\Program Files (x86)\*" -ForegroundColor Gray
        Write-Host "    - C:\Windows\*" -ForegroundColor Gray
        Write-Host "    - C:\Enterprise-PC-Management\*" -ForegroundColor Gray
        Write-Host ""
        Write-Host "  Blocked locations:" -ForegroundColor Yellow
        Write-Host "    - Downloads folder" -ForegroundColor Yellow
        Write-Host "    - Desktop" -ForegroundColor Yellow
        Write-Host "    - USB drives" -ForegroundColor Yellow
        Write-Host ""
    }
    
}
catch {
    Write-Warning "AppLocker setup failed: $_"
    Write-Host "  Note: AppLocker requires Windows Pro/Enterprise" -ForegroundColor Yellow
}

return @{ Success = $true }
