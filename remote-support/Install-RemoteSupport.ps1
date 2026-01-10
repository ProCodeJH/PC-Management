# Install-RemoteSupport.ps1
# 원격 지원 설정

<#
.SYNOPSIS
    관리자 원격 접속을 위한 RDP 설정

.DESCRIPTION
    Windows 원격 데스크톱을 활성화하고 필요한 설정을 구성합니다:
    - RDP 활성화
    - 방화벽 규칙 추가
    - 네트워크 레벨 인증 설정
    - 관리자 접속 권한

.PARAMETER Tool
    원격 지원 도구 (RDP, VNC), 기본값: RDP

.PARAMETER AllowUsers
    원격 접속을 허용할 사용자 (쉼표 구분)

.EXAMPLE
    .\Install-RemoteSupport.ps1 -Tool RDP
#>

[CmdletBinding()]
param(
    [ValidateSet("RDP", "VNC")]
    [string]$Tool = "RDP",
    
    [string]$AllowUsers = "",
    
    [switch]$Remove
)

# 관리자 권한 확인
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "ERROR: Administrator required!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  REMOTE SUPPORT CONFIGURATION" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($Remove) {
    Write-Host "Disabling remote support..." -ForegroundColor Yellow
    
    # RDP 비활성화
    Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name "fDenyTSConnections" -Value 1 -Force
    
    # 방화벽 규칙 비활성화
    Disable-NetFirewallRule -DisplayGroup "Remote Desktop" -ErrorAction SilentlyContinue
    
    Write-Host "Remote support disabled!" -ForegroundColor Green
    exit 0
}

if ($Tool -eq "RDP") {
    Write-Host "Configuring Windows Remote Desktop..." -ForegroundColor Cyan
    Write-Host ""
    
    try {
        # 1. RDP 활성화
        Write-Host "[1/5] Enabling Remote Desktop..." -ForegroundColor Cyan
        Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name "fDenyTSConnections" -Value 0 -Force
        Write-Host "  OK" -ForegroundColor Green
        
        # 2. 네트워크 레벨 인증 (NLA) 설정
        Write-Host "[2/5] Configuring Network Level Authentication..." -ForegroundColor Cyan
        Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp' -Name "UserAuthentication" -Value 1 -Force
        Write-Host "  OK" -ForegroundColor Green
        
        # 3. 방화벽 규칙 활성화
        Write-Host "[3/5] Configuring Firewall..." -ForegroundColor Cyan
        Enable-NetFirewallRule -DisplayGroup "Remote Desktop" -ErrorAction SilentlyContinue
        
        # 규칙이 없으면 생성
        $rdpRule = Get-NetFirewallRule -Name "RemoteDesktop-UserMode-In-TCP" -ErrorAction SilentlyContinue
        if (-not $rdpRule) {
            New-NetFirewallRule -Name "RemoteDesktop-UserMode-In-TCP" -DisplayName "Remote Desktop - User Mode (TCP-In)" -Protocol TCP -LocalPort 3389 -Direction Inbound -Action Allow -Profile Any | Out-Null
        }
        Write-Host "  OK - Port 3389 opened" -ForegroundColor Green
        
        # 4. Remote Desktop Users 그룹 확인
        Write-Host "[4/5] Checking Remote Desktop Users group..." -ForegroundColor Cyan
        
        if ($AllowUsers) {
            $users = $AllowUsers -split ","
            foreach ($user in $users) {
                try {
                    Add-LocalGroupMember -Group "Remote Desktop Users" -Member $user.Trim() -ErrorAction SilentlyContinue
                    Write-Host "  Added user: $user" -ForegroundColor Gray
                }
                catch {
                    Write-Host "  Warning: Could not add $user" -ForegroundColor Yellow
                }
            }
        }
        Write-Host "  OK" -ForegroundColor Green
        
        # 5. RDP 서비스 시작
        Write-Host "[5/5] Starting Remote Desktop Services..." -ForegroundColor Cyan
        Set-Service -Name "TermService" -StartupType Automatic
        Start-Service -Name "TermService" -ErrorAction SilentlyContinue
        Write-Host "  OK" -ForegroundColor Green
        
        # IP 주소 가져오기
        $ipAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" } | Select-Object -First 1).IPAddress
        
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "  REMOTE DESKTOP ENABLED!" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "Connection Information:" -ForegroundColor White
        Write-Host "  Computer: $env:COMPUTERNAME" -ForegroundColor Gray
        Write-Host "  IP Address: $ipAddress" -ForegroundColor Gray
        Write-Host "  Port: 3389" -ForegroundColor Gray
        Write-Host ""
        Write-Host "To connect from another PC:" -ForegroundColor Cyan
        Write-Host "  1. Open Remote Desktop Connection (mstsc.exe)" -ForegroundColor Gray
        Write-Host "  2. Enter: $ipAddress" -ForegroundColor Gray
        Write-Host "  3. Use admin credentials to login" -ForegroundColor Gray
        Write-Host ""
        Write-Host "To disable: .\Install-RemoteSupport.ps1 -Remove" -ForegroundColor Yellow
        Write-Host ""
        
    }
    catch {
        Write-Host ""
        Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host ""
        exit 1
    }
    
}
elseif ($Tool -eq "VNC") {
    Write-Host "VNC installation requires additional software." -ForegroundColor Yellow
    Write-Host "Consider using RDP which is built into Windows." -ForegroundColor Gray
    Write-Host ""
    Write-Host "For VNC, you can manually install:" -ForegroundColor White
    Write-Host "  - TightVNC: https://www.tightvnc.com/" -ForegroundColor Gray
    Write-Host "  - RealVNC: https://www.realvnc.com/" -ForegroundColor Gray
    Write-Host ""
}

Read-Host "Press Enter to exit"
