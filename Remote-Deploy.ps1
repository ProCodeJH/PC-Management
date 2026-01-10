# Remote-Deploy.ps1
# 원격 PC에 Enterprise PC Management 시스템 배포

<#
.SYNOPSIS
    원격 PC에 자동 시스템 배포

.DESCRIPTION
    PowerShell Remoting (WinRM)을 사용하여 원격 PC에 시스템을 설치합니다.
    - 파일 복사
    - Master-Setup.ps1 실행
    - 결과 반환

.PARAMETER TargetIP
    대상 PC의 IP 주소

.PARAMETER Credential
    원격 접속에 사용할 자격 증명

.PARAMETER SkipSetup
    Master-Setup 실행 건너뛰기 (파일 복사만)

.EXAMPLE
    .\Remote-Deploy.ps1 -TargetIP "192.168.1.100" -Username "admin" -Password "password"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TargetIP,
    
    [Parameter(Mandatory = $true)]
    [string]$Username,
    
    [Parameter(Mandatory = $true)]
    [string]$Password,
    
    [switch]$SkipSetup,
    
    [string]$DashboardUrl = "http://localhost:3001"
)

$ErrorActionPreference = "Stop"

# 결과 객체
$result = @{
    Success  = $false
    TargetIP = $TargetIP
    Message  = ""
    Steps    = @()
}

function Add-Step {
    param($Name, $Status, $Message = "")
    $result.Steps += @{
        Name      = $Name
        Status    = $Status
        Message   = $Message
        Timestamp = Get-Date -Format "HH:mm:ss"
    }
    
    if ($Status -eq "OK") {
        Write-Host "  ✓ $Name" -ForegroundColor Green
    }
    elseif ($Status -eq "FAIL") {
        Write-Host "  ✗ $Name - $Message" -ForegroundColor Red
    }
    else {
        Write-Host "  → $Name..." -ForegroundColor Cyan
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  REMOTE DEPLOYMENT" -ForegroundColor Cyan
Write-Host "  Target: $TargetIP" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

try {
    # 1. 자격 증명 생성
    Add-Step "Creating credentials" "PROGRESS"
    $securePassword = ConvertTo-SecureString $Password -AsPlainText -Force
    $credential = New-Object System.Management.Automation.PSCredential ($Username, $securePassword)
    Add-Step "Credentials created" "OK"
    
    # 2. 연결 테스트
    Add-Step "Testing connection to $TargetIP" "PROGRESS"
    $pingResult = Test-Connection -ComputerName $TargetIP -Count 1 -Quiet
    if (-not $pingResult) {
        throw "Cannot reach $TargetIP - PC may be offline"
    }
    Add-Step "Connection test passed" "OK"
    
    # 3. WinRM 연결
    Add-Step "Establishing WinRM session" "PROGRESS"
    $sessionOption = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck
    $session = New-PSSession -ComputerName $TargetIP -Credential $credential -SessionOption $sessionOption -ErrorAction Stop
    Add-Step "WinRM session established" "OK"
    
    # 4. 대상 디렉토리 생성
    Add-Step "Creating target directory" "PROGRESS"
    Invoke-Command -Session $session -ScriptBlock {
        $targetPath = "C:\Enterprise-PC-Management"
        if (-not (Test-Path $targetPath)) {
            New-Item -Path $targetPath -ItemType Directory -Force | Out-Null
        }
        return $targetPath
    }
    Add-Step "Target directory ready" "OK"
    
    # 5. 파일 복사
    Add-Step "Copying system files" "PROGRESS"
    $sourcePath = Split-Path -Parent $MyInvocation.MyCommand.Path
    $targetPath = "C:\Enterprise-PC-Management"
    
    # 주요 폴더들 복사
    $folders = @("auto-restore", "time-control", "logging", "remote-support", "dashboard", "analytics")
    
    foreach ($folder in $folders) {
        $localFolder = Join-Path $sourcePath $folder
        if (Test-Path $localFolder) {
            Copy-Item -Path $localFolder -Destination $targetPath -ToSession $session -Recurse -Force
        }
    }
    
    # Master-Setup.ps1 복사
    Copy-Item -Path "$sourcePath\Master-Setup.ps1" -Destination $targetPath -ToSession $session -Force
    
    Add-Step "Files copied successfully" "OK"
    
    # 6. Master-Setup 실행
    if (-not $SkipSetup) {
        Add-Step "Running Master-Setup" "PROGRESS"
        
        $setupResult = Invoke-Command -Session $session -ScriptBlock {
            param($targetPath, $dashboardUrl)
            
            Set-Location $targetPath
            
            # 비대화형 실행을 위한 환경 설정
            $env:ENTERPRISE_DASHBOARD = $dashboardUrl
            
            # 각 컴포넌트 직접 설정 (Master-Setup의 핵심 로직)
            try {
                # Time Restriction
                if (Test-Path "$targetPath\time-control\Set-TimeRestriction.ps1") {
                    & "$targetPath\time-control\Set-TimeRestriction.ps1" -StartTime "09:00" -EndTime "22:00" -DaysOfWeek "Mon,Tue,Wed,Thu,Fri,Sat" 2>$null
                }
                
                # Activity Logging
                if (Test-Path "$targetPath\logging\Start-Logging.ps1") {
                    & "$targetPath\logging\Start-Logging.ps1" -InstallService -Dashboard $dashboardUrl 2>$null
                }
                
                # Dashboard Agent
                $agentPath = "$targetPath\dashboard\PC-Agent.ps1"
                if (Test-Path $agentPath) {
                    $action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$agentPath`" -DashboardUrl `"$dashboardUrl`""
                    $trigger = New-ScheduledTaskTrigger -AtStartup
                    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
                    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
                    
                    Unregister-ScheduledTask -TaskName "Enterprise-DashboardAgent" -Confirm:$false -ErrorAction SilentlyContinue
                    Register-ScheduledTask -TaskName "Enterprise-DashboardAgent" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
                    
                    # 에이전트 즉시 시작
                    Start-Process -FilePath "PowerShell.exe" -ArgumentList "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$agentPath`" -DashboardUrl `"$dashboardUrl`"" -WindowStyle Hidden
                }
                
                # Remote Support (RDP)
                Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name "fDenyTSConnections" -Value 0 -Force
                Enable-NetFirewallRule -DisplayGroup "Remote Desktop" -ErrorAction SilentlyContinue
                
                return @{
                    Success      = $true
                    ComputerName = $env:COMPUTERNAME
                    IP           = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" } | Select-Object -First 1).IPAddress
                }
            }
            catch {
                return @{
                    Success = $false
                    Error   = $_.Exception.Message
                }
            }
        } -ArgumentList $targetPath, $DashboardUrl
        
        if ($setupResult.Success) {
            Add-Step "Master-Setup completed on $($setupResult.ComputerName)" "OK"
        }
        else {
            throw "Setup failed: $($setupResult.Error)"
        }
    }
    
    # 7. 세션 종료
    Remove-PSSession -Session $session
    
    $result.Success = $true
    $result.Message = "Deployment completed successfully"
    
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  ✓ DEPLOYMENT SUCCESSFUL" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Target: $TargetIP" -ForegroundColor Gray
    Write-Host "  PC Name: $($setupResult.ComputerName)" -ForegroundColor Gray
    Write-Host ""
    
}
catch {
    $result.Success = $false
    $result.Message = $_.Exception.Message
    Add-Step "Deployment failed" "FAIL" $_.Exception.Message
    
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "  ✗ DEPLOYMENT FAILED" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "  1. Ensure target PC is online" -ForegroundColor Gray
    Write-Host "  2. Run on target PC: Enable-PSRemoting -Force" -ForegroundColor Gray
    Write-Host "  3. Check firewall allows WinRM (port 5985)" -ForegroundColor Gray
    Write-Host "  4. Verify admin credentials" -ForegroundColor Gray
    Write-Host ""
}

# JSON 결과 반환 (API 호출용)
return $result | ConvertTo-Json -Depth 3
