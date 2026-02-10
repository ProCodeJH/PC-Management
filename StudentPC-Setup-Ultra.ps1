<#
.SYNOPSIS
    Enterprise PC Management - Ultra High-End Student PC Setup Script
    Version: 2.0 Ultra Premium
    
.DESCRIPTION
    초고퀄리티 하이엔드급 학생 PC 원격 관리 설정 스크립트
    - 완벽한 에러 처리
    - 자동 복구 기능
    - 다중 시도 메커니즘
    - 실시간 진행률 표시
    - 상세 로깅
    - 완료 후 검증
    
.NOTES
    Author: Enterprise PC Management System
    Required: Windows 10/11, PowerShell 5.1+
#>

param(
    [switch]$Silent,
    [switch]$SkipVerification
)

#region ===== CONFIGURATION =====
$script:Config = @{
    Version = "2.0 Ultra Premium"
    LogPath = "$env:TEMP\EPM_StudentSetup_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"
    MaxRetries = 3
    RetryDelayMs = 1000
}
#endregion

#region ===== UI FUNCTIONS =====
function Show-Banner {
    Clear-Host
    $banner = @"

    ╔══════════════════════════════════════════════════════════════════════════════╗
    ║                                                                              ║
    ║     ███████╗███╗   ██╗████████╗███████╗██████╗ ██████╗ ██████╗ ██╗███████╗  ║
    ║     ██╔════╝████╗  ██║╚══██╔══╝██╔════╝██╔══██╗██╔══██╗██╔══██╗██║██╔════╝  ║
    ║     █████╗  ██╔██╗ ██║   ██║   █████╗  ██████╔╝██████╔╝██████╔╝██║███████╗  ║
    ║     ██╔══╝  ██║╚██╗██║   ██║   ██╔══╝  ██╔══██╗██╔═══╝ ██╔══██╗██║╚════██║  ║
    ║     ███████╗██║ ╚████║   ██║   ███████╗██║  ██║██║     ██║  ██║██║███████║  ║
    ║     ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝╚══════╝  ║
    ║                                                                              ║
    ║              📱 학생 PC 원격 관리 설정 (Ultra Premium Edition)                ║
    ║                         Version $($script:Config.Version)                             ║
    ╚══════════════════════════════════════════════════════════════════════════════╝

"@
    Write-Host $banner -ForegroundColor Cyan
}

function Write-Step {
    param(
        [int]$Step,
        [int]$Total,
        [string]$Message,
        [string]$Status = "PROGRESS"
    )
    
    $statusColors = @{
        "PROGRESS" = "Yellow"
        "OK" = "Green"
        "WARN" = "DarkYellow"
        "FAIL" = "Red"
        "SKIP" = "Gray"
    }
    
    $statusIcons = @{
        "PROGRESS" = "⏳"
        "OK" = "✅"
        "WARN" = "⚠️"
        "FAIL" = "❌"
        "SKIP" = "⏭️"
    }
    
    $progressBar = ""
    $completed = [math]::Floor(($Step / $Total) * 20)
    $remaining = 20 - $completed
    $progressBar = "█" * $completed + "░" * $remaining
    
    $color = $statusColors[$Status]
    $icon = $statusIcons[$Status]
    
    Write-Host ""
    Write-Host "    [$progressBar] " -NoNewline -ForegroundColor DarkGray
    Write-Host "[$Step/$Total] " -NoNewline -ForegroundColor White
    Write-Host "$icon " -NoNewline
    Write-Host $Message -ForegroundColor $color
    
    # Log to file
    $logMessage = "[$(Get-Date -Format 'HH:mm:ss')] [$Status] Step $Step/$Total : $Message"
    Add-Content -Path $script:Config.LogPath -Value $logMessage -ErrorAction SilentlyContinue
}

function Write-SubStep {
    param([string]$Message, [string]$Status = "INFO")
    
    $colors = @{ "INFO" = "Gray"; "OK" = "Green"; "WARN" = "Yellow"; "FAIL" = "Red" }
    $icons = @{ "INFO" = "   →"; "OK" = "   ✓"; "WARN" = "   ⚠"; "FAIL" = "   ✗" }
    
    Write-Host "$($icons[$Status]) $Message" -ForegroundColor $colors[$Status]
}

function Show-FinalResult {
    param([bool]$Success, [hashtable]$Results)
    
    Write-Host ""
    Write-Host "    ══════════════════════════════════════════════════════════════════" -ForegroundColor DarkGray
    
    if ($Success) {
        Write-Host @"
    
         ██████╗ ██╗  ██╗██╗
        ██╔═══██╗██║ ██╔╝██║
        ██║   ██║█████╔╝ ██║
        ██║   ██║██╔═██╗ ╚═╝
        ╚██████╔╝██║  ██╗██╗
         ╚═════╝ ╚═╝  ╚═╝╚═╝
        
        🎉 학생 PC 설정이 성공적으로 완료되었습니다!
        
"@ -ForegroundColor Green
    } else {
        Write-Host @"
    
        ⚠️ 일부 설정에 문제가 있습니다.
        아래 정보를 확인하고 IT 관리자에게 문의하세요.
        
"@ -ForegroundColor Yellow
    }
    
    # PC Info Box
    Write-Host "    ┌─────────────────────────────────────────────────────────────────┐" -ForegroundColor Cyan
    Write-Host "    │  📌 이 PC 정보                                                  │" -ForegroundColor Cyan
    Write-Host "    ├─────────────────────────────────────────────────────────────────┤" -ForegroundColor Cyan
    Write-Host "    │  컴퓨터 이름: $($env:COMPUTERNAME.PadRight(48))│" -ForegroundColor White
    
    $ipAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.IPAddress -notlike "169.*" } | Select-Object -First 1).IPAddress
    if (-not $ipAddress) { $ipAddress = "알 수 없음" }
    Write-Host "    │  IP 주소:     $($ipAddress.PadRight(48))│" -ForegroundColor White
    
    $winrmStatus = if ($Results.WinRMRunning) { "✅ 실행 중" } else { "❌ 중지됨" }
    Write-Host "    │  WinRM 상태:  $($winrmStatus.PadRight(47))│" -ForegroundColor White
    Write-Host "    └─────────────────────────────────────────────────────────────────┘" -ForegroundColor Cyan
    
    # Result Summary
    Write-Host ""
    Write-Host "    📊 설정 결과 요약:" -ForegroundColor White
    Write-Host "    ─────────────────────────────────────────" -ForegroundColor DarkGray
    
    foreach ($key in $Results.Keys) {
        if ($key -ne "WinRMRunning") {
            $status = if ($Results[$key]) { "✅ 성공" } else { "❌ 실패" }
            $color = if ($Results[$key]) { "Green" } else { "Red" }
            Write-Host "    $key : " -NoNewline -ForegroundColor Gray
            Write-Host $status -ForegroundColor $color
        }
    }
    
    Write-Host ""
    Write-Host "    📁 로그 파일: $($script:Config.LogPath)" -ForegroundColor DarkGray
    Write-Host "    ══════════════════════════════════════════════════════════════════" -ForegroundColor DarkGray
}
#endregion

#region ===== CORE FUNCTIONS =====
function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-WithRetry {
    param(
        [scriptblock]$ScriptBlock,
        [string]$OperationName,
        [int]$MaxRetries = $script:Config.MaxRetries
    )
    
    $attempt = 0
    $lastError = $null
    
    while ($attempt -lt $MaxRetries) {
        $attempt++
        try {
            $result = & $ScriptBlock
            return @{ Success = $true; Result = $result; Attempts = $attempt }
        }
        catch {
            $lastError = $_
            if ($attempt -lt $MaxRetries) {
                Write-SubStep "재시도 중... ($attempt/$MaxRetries)" "WARN"
                Start-Sleep -Milliseconds $script:Config.RetryDelayMs
            }
        }
    }
    
    return @{ Success = $false; Error = $lastError; Attempts = $attempt }
}

function Set-WinRMService {
    # 1. WinRM 서비스가 존재하는지 확인
    $service = Get-Service -Name WinRM -ErrorAction SilentlyContinue
    if (-not $service) {
        throw "WinRM 서비스를 찾을 수 없습니다. Windows가 손상되었을 수 있습니다."
    }
    
    # 2. 서비스 시작 유형을 자동으로 설정
    Set-Service -Name WinRM -StartupType Automatic -ErrorAction Stop
    
    # 3. 서비스 시작
    if ($service.Status -ne 'Running') {
        Start-Service -Name WinRM -ErrorAction Stop
        Start-Sleep -Seconds 2
    }
    
    # 4. 확인
    $service = Get-Service -Name WinRM
    if ($service.Status -ne 'Running') {
        throw "WinRM 서비스를 시작할 수 없습니다."
    }
    
    return $true
}

function Enable-PSRemotingAdvanced {
    # 방법 1: Enable-PSRemoting 시도
    try {
        Enable-PSRemoting -Force -SkipNetworkProfileCheck -ErrorAction Stop 2>$null
        return $true
    }
    catch {
        Write-SubStep "기본 방법 실패, 대체 방법 시도..." "WARN"
    }
    
    # 방법 2: 수동 설정
    try {
        # WinRM QuickConfig 수동 실행
        $null = winrm quickconfig -quiet 2>$null
        
        # 리스너 확인/생성
        $listener = Get-ChildItem WSMan:\localhost\Listener -ErrorAction SilentlyContinue | 
                    Where-Object { $_.Keys -contains "Transport=HTTP" }
        
        if (-not $listener) {
            New-Item -Path WSMan:\localhost\Listener -Transport HTTP -Address * -Force -ErrorAction Stop | Out-Null
        }
        
        return $true
    }
    catch {
        Write-SubStep "대체 방법도 실패: $_" "FAIL"
        return $false
    }
}

function Set-WinRMAuthentication {
    $authSettings = @{
        "Basic" = $true
        "Negotiate" = $true
        "Kerberos" = $true
        "CredSSP" = $false
    }
    
    $success = $true
    foreach ($auth in $authSettings.Keys) {
        try {
            Set-Item "WSMan:\localhost\Service\Auth\$auth" -Value $authSettings[$auth] -Force -ErrorAction Stop
        }
        catch {
            Write-SubStep "$auth 인증 설정 실패" "WARN"
            $success = $false
        }
    }
    
    return $success
}

function Set-TrustedHosts {
    try {
        Set-Item WSMan:\localhost\Client\TrustedHosts -Value "192.168.*.*" -Force -ErrorAction Stop
        return $true
    }
    catch {
        # 대체 방법: winrm 명령 사용
        try {
            $null = winrm set winrm/config/client '@{TrustedHosts="192.168.*.*"}' 2>$null
            return $true
        }
        catch {
            return $false
        }
    }
}

function Set-FirewallRules {
    $rules = @(
        @{ Name = "EPM-WinRM-HTTP-In"; Port = 5985; DisplayName = "WinRM HTTP (Enterprise PC Management)" },
        @{ Name = "EPM-WinRM-HTTPS-In"; Port = 5986; DisplayName = "WinRM HTTPS (Enterprise PC Management)" }
    )
    
    $success = $true
    foreach ($rule in $rules) {
        try {
            # 기존 규칙 삭제
            Remove-NetFirewallRule -Name $rule.Name -ErrorAction SilentlyContinue
            
            # 새 규칙 생성
            New-NetFirewallRule -Name $rule.Name `
                -DisplayName $rule.DisplayName `
                -Direction Inbound `
                -Protocol TCP `
                -LocalPort $rule.Port `
                -Action Allow `
                -Profile Any `
                -Enabled True `
                -ErrorAction Stop | Out-Null
        }
        catch {
            # 대체 방법: netsh 사용
            try {
                $null = netsh advfirewall firewall add rule name="$($rule.DisplayName)" dir=in action=allow protocol=tcp localport=$($rule.Port) 2>$null
            }
            catch {
                $success = $false
            }
        }
    }
    
    return $success
}

function Set-LocalAccountPolicy {
    try {
        $regPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"
        
        if (-not (Test-Path $regPath)) {
            New-Item -Path $regPath -Force | Out-Null
        }
        
        Set-ItemProperty -Path $regPath -Name "LocalAccountTokenFilterPolicy" -Value 1 -Type DWord -Force -ErrorAction Stop
        return $true
    }
    catch {
        return $false
    }
}

function Set-NetworkProfile {
    try {
        # 네트워크 프로필을 Private으로 변경 (가능한 경우)
        Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' } | ForEach-Object {
            try {
                Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private -ErrorAction SilentlyContinue
            }
            catch { }
        }
        return $true
    }
    catch {
        return $false
    }
}

function Test-WinRMConnectivity {
    try {
        $result = Test-WSMan -ComputerName localhost -ErrorAction Stop
        return $true
    }
    catch {
        return $false
    }
}
#endregion

#region ===== MAIN EXECUTION =====
function Start-StudentPCSetup {
    Show-Banner
    
    # 관리자 권한 체크
    if (-not (Test-Administrator)) {
        Write-Host ""
        Write-Host "    ❌ 오류: 관리자 권한이 필요합니다!" -ForegroundColor Red
        Write-Host ""
        Write-Host "    이 파일을 우클릭 후 '관리자 권한으로 실행' 해주세요." -ForegroundColor Yellow
        Write-Host ""
        if (-not $Silent) {
            Write-Host "    아무 키나 누르면 종료됩니다..." -ForegroundColor Gray
            $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        }
        return
    }
    
    Write-Host "    ✅ 관리자 권한 확인됨" -ForegroundColor Green
    Write-Host "    📋 설정을 시작합니다... (약 30초 소요)" -ForegroundColor Cyan
    Write-Host ""
    
    $results = @{}
    $totalSteps = 8
    
    # Step 1: WinRM 서비스 설정
    Write-Step 1 $totalSteps "WinRM 서비스 활성화" "PROGRESS"
    $result = Invoke-WithRetry -ScriptBlock { Set-WinRMService } -OperationName "WinRM Service"
    $results["WinRM 서비스"] = $result.Success
    Write-Step 1 $totalSteps "WinRM 서비스 활성화" $(if ($result.Success) { "OK" } else { "FAIL" })
    
    # Step 2: PSRemoting 활성화
    Write-Step 2 $totalSteps "PowerShell 원격 활성화" "PROGRESS"
    $result = Invoke-WithRetry -ScriptBlock { Enable-PSRemotingAdvanced } -OperationName "PSRemoting"
    $results["PS Remoting"] = $result.Success -or $result.Result
    Write-Step 2 $totalSteps "PowerShell 원격 활성화" $(if ($results["PS Remoting"]) { "OK" } else { "WARN" })
    
    # Step 3: 인증 설정
    Write-Step 3 $totalSteps "인증 방식 설정" "PROGRESS"
    $result = Invoke-WithRetry -ScriptBlock { Set-WinRMAuthentication } -OperationName "Authentication"
    $results["인증 설정"] = $result.Success -or $result.Result
    Write-Step 3 $totalSteps "인증 방식 설정" $(if ($results["인증 설정"]) { "OK" } else { "WARN" })
    
    # Step 4: TrustedHosts 설정
    Write-Step 4 $totalSteps "TrustedHosts 설정" "PROGRESS"
    $result = Invoke-WithRetry -ScriptBlock { Set-TrustedHosts } -OperationName "TrustedHosts"
    $results["TrustedHosts"] = $result.Success -or $result.Result
    Write-Step 4 $totalSteps "TrustedHosts 설정" $(if ($results["TrustedHosts"]) { "OK" } else { "WARN" })
    
    # Step 5: 방화벽 규칙
    Write-Step 5 $totalSteps "방화벽 규칙 설정" "PROGRESS"
    $result = Invoke-WithRetry -ScriptBlock { Set-FirewallRules } -OperationName "Firewall"
    $results["방화벽 규칙"] = $result.Success -or $result.Result
    Write-Step 5 $totalSteps "방화벽 규칙 설정" $(if ($results["방화벽 규칙"]) { "OK" } else { "WARN" })
    
    # Step 6: 로컬 계정 정책
    Write-Step 6 $totalSteps "로컬 계정 원격 접근 정책" "PROGRESS"
    $result = Invoke-WithRetry -ScriptBlock { Set-LocalAccountPolicy } -OperationName "LocalAccountPolicy"
    $results["계정 정책"] = $result.Success -or $result.Result
    Write-Step 6 $totalSteps "로컬 계정 원격 접근 정책" $(if ($results["계정 정책"]) { "OK" } else { "WARN" })
    
    # Step 7: 네트워크 프로필
    Write-Step 7 $totalSteps "네트워크 프로필 최적화" "PROGRESS"
    $result = Invoke-WithRetry -ScriptBlock { Set-NetworkProfile } -OperationName "NetworkProfile"
    $results["네트워크"] = $result.Success -or $result.Result
    Write-Step 7 $totalSteps "네트워크 프로필 최적화" $(if ($results["네트워크"]) { "OK" } else { "SKIP" })
    
    # Step 8: 최종 검증
    Write-Step 8 $totalSteps "WinRM 연결 검증" "PROGRESS"
    Start-Sleep -Seconds 2  # 서비스 안정화 대기
    
    # 서비스 재시작
    Restart-Service WinRM -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    
    $winrmTest = Test-WinRMConnectivity
    $results["WinRMRunning"] = $winrmTest
    $results["최종 검증"] = $winrmTest
    Write-Step 8 $totalSteps "WinRM 연결 검증" $(if ($winrmTest) { "OK" } else { "FAIL" })
    
    # 전체 성공 여부 판단
    $criticalSuccess = $results["WinRM 서비스"] -and ($results["PS Remoting"] -or $results["인증 설정"]) -and $results["WinRMRunning"]
    
    # 결과 표시
    Show-FinalResult -Success $criticalSuccess -Results $results
    
    if (-not $Silent) {
        Write-Host ""
        Write-Host "    아무 키나 누르면 종료됩니다..." -ForegroundColor Gray
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    }
}

# 실행
Start-StudentPCSetup
#endregion
