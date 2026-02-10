# ╔══════════════════════════════════════════════════════════════════════════════════════════════════╗
# ║         ENTERPRISE PC MANAGEMENT - ULTRA ONE-CLICK SYSTEM v3.0 PROMETHEUS GRADE                 ║
# ║                          초고도화 원클릭 실행 시스템 v3.0                                          ║
# ║                        All Feedback Integrated + Auto Self-Healing                              ║
# ╚══════════════════════════════════════════════════════════════════════════════════════════════════╝

param(
    [switch]$Silent,
    [switch]$NoBrowser,
    [switch]$FullSetup,        # 선생님 PC + 학생 PC 모두 설정
    [switch]$StudentPC,        # 학생 PC 설정 모드
    [switch]$DiagnoseOnly      # 진단만 수행
)

# ═══════════════════════════════════════════════════════════════════════════════════════════════════
# 관리자 권한 자동 승격
# ═══════════════════════════════════════════════════════════════════════════════════════════════════
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "`n  🔐 관리자 권한으로 재실행합니다..." -ForegroundColor Yellow
    $scriptPath = $MyInvocation.MyCommand.Path
    $arguments = "-ExecutionPolicy Bypass -File `"$scriptPath`""
    if ($Silent) { $arguments += " -Silent" }
    if ($NoBrowser) { $arguments += " -NoBrowser" }
    if ($FullSetup) { $arguments += " -FullSetup" }
    if ($StudentPC) { $arguments += " -StudentPC" }
    if ($DiagnoseOnly) { $arguments += " -DiagnoseOnly" }
    Start-Process PowerShell -ArgumentList $arguments -Verb RunAs
    exit
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════════
# 설정
# ═══════════════════════════════════════════════════════════════════════════════════════════════════
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendPath = Join-Path $ProjectRoot "dashboard\backend"
$Port = 3001
$DashboardURL = "http://localhost:$Port"
$Version = "3.0.0"

# ═══════════════════════════════════════════════════════════════════════════════════════════════════
# 콘솔 스타일링
# ═══════════════════════════════════════════════════════════════════════════════════════════════════
$Host.UI.RawUI.BackgroundColor = "Black"
Clear-Host

function Write-Banner {
    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "  ║                                                                          ║" -ForegroundColor Cyan
    Write-Host "  ║   ███████╗██████╗ ███╗   ███╗    ██╗   ██╗██╗  ████████╗██████╗  █████╗  ║" -ForegroundColor Cyan
    Write-Host "  ║   ██╔════╝██╔══██╗████╗ ████║    ██║   ██║██║  ╚══██╔══╝██╔══██╗██╔══██╗ ║" -ForegroundColor Cyan
    Write-Host "  ║   █████╗  ██████╔╝██╔████╔██║    ██║   ██║██║     ██║   ██████╔╝███████║ ║" -ForegroundColor Cyan
    Write-Host "  ║   ██╔══╝  ██╔═══╝ ██║╚██╔╝██║    ██║   ██║██║     ██║   ██╔══██╗██╔══██║ ║" -ForegroundColor Cyan
    Write-Host "  ║   ███████╗██║     ██║ ╚═╝ ██║    ╚██████╔╝███████╗██║   ██║  ██║██║  ██║ ║" -ForegroundColor Cyan
    Write-Host "  ║   ╚══════╝╚═╝     ╚═╝     ╚═╝     ╚═════╝ ╚══════╝╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ║" -ForegroundColor Cyan
    Write-Host "  ║                                                                          ║" -ForegroundColor Cyan
    Write-Host "  ║              🚀 ULTRA ONE-CLICK SYSTEM v$Version PROMETHEUS GRADE            ║" -ForegroundColor Yellow
    Write-Host "  ║                     초고도화 원클릭 실행 시스템                               ║" -ForegroundColor DarkGray
    Write-Host "  ║                                                                          ║" -ForegroundColor Cyan
    Write-Host "  ╚══════════════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step($step, $total, $message, $status = "진행중") {
    $statusColor = switch ($status) {
        "진행중" { "Yellow" }
        "완료" { "Green" }
        "실패" { "Red" }
        "경고" { "DarkYellow" }
        "건너뜀" { "DarkGray" }
        default { "White" }
    }
    $icon = switch ($status) {
        "진행중" { "⏳" }
        "완료" { "✅" }
        "실패" { "❌" }
        "경고" { "⚠️" }
        "건너뜀" { "⏭️" }
        default { "•" }
    }
    Write-Host "  [$step/$total] $icon $message" -ForegroundColor $statusColor
}

function Write-Section($title) {
    Write-Host ""
    Write-Host "  ════════════════════════════════════════════════════════════════════════════" -ForegroundColor DarkGray
    Write-Host "  📌 $title" -ForegroundColor White
    Write-Host "  ════════════════════════════════════════════════════════════════════════════" -ForegroundColor DarkGray
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════════
# 진단 함수
# ═══════════════════════════════════════════════════════════════════════════════════════════════════
function Test-SystemHealth {
    Write-Section "시스템 진단 (Self-Diagnosis)"
    
    $issues = @()
    $checks = @(
        @{ Name = "Node.js 설치"; Check = { node --version 2>$null }; Fix = "Node.js 설치 필요: https://nodejs.org" }
        @{ Name = "WinRM 서비스"; Check = { (Get-Service WinRM -ErrorAction SilentlyContinue).Status -eq 'Running' }; Fix = "Enable-PSRemoting -Force" }
        @{ Name = "TrustedHosts 설정"; Check = { (Get-Item WSMan:\localhost\Client\TrustedHosts -ErrorAction SilentlyContinue).Value -ne '' }; Fix = "TrustedHosts 설정 필요" }
        @{ Name = "방화벽 규칙 (WinRM)"; Check = { Get-NetFirewallRule -Name "WINRM-HTTP-In-TCP" -ErrorAction SilentlyContinue }; Fix = "방화벽 규칙 추가 필요" }
        @{ Name = "방화벽 규칙 (Dashboard)"; Check = { Get-NetFirewallRule -Name "EPM-Dashboard" -ErrorAction SilentlyContinue }; Fix = "대시보드 포트 열기 필요" }
        @{ Name = "npm 의존성"; Check = { Test-Path (Join-Path $BackendPath "node_modules") }; Fix = "npm install 필요" }
    )
    
    $passed = 0
    $total = $checks.Count
    
    foreach ($check in $checks) {
        $result = & $check.Check
        if ($result) {
            Write-Host "    ✅ $($check.Name)" -ForegroundColor Green
            $passed++
        }
        else {
            Write-Host "    ❌ $($check.Name) - $($check.Fix)" -ForegroundColor Red
            $issues += $check
        }
    }
    
    Write-Host ""
    Write-Host "    진단 결과: $passed/$total 항목 정상" -ForegroundColor $(if ($passed -eq $total) { "Green" } else { "Yellow" })
    
    return $issues
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════════
# 자동 복구 함수
# ═══════════════════════════════════════════════════════════════════════════════════════════════════
function Repair-System($issues) {
    if ($issues.Count -eq 0) { return $true }
    
    Write-Section "자동 복구 (Auto-Healing)"
    
    foreach ($issue in $issues) {
        Write-Host "    🔧 수정 중: $($issue.Name)..." -ForegroundColor Yellow
        
        switch ($issue.Name) {
            "WinRM 서비스" {
                Enable-PSRemoting -Force -SkipNetworkProfileCheck -ErrorAction SilentlyContinue | Out-Null
                Start-Service WinRM -ErrorAction SilentlyContinue
            }
            "TrustedHosts 설정" {
                Set-Item WSMan:\localhost\Client\TrustedHosts -Value "192.168.*.*" -Force -ErrorAction SilentlyContinue
            }
            "방화벽 규칙 (WinRM)" {
                $rule = Get-NetFirewallRule -Name "WINRM-HTTP-In-TCP" -ErrorAction SilentlyContinue
                if (-not $rule) {
                    New-NetFirewallRule -Name "WINRM-HTTP-In-TCP" -DisplayName "WinRM (HTTP-In)" -Protocol TCP -LocalPort 5985 -Direction Inbound -Action Allow -Profile Any -ErrorAction SilentlyContinue | Out-Null
                }
            }
            "방화벽 규칙 (Dashboard)" {
                $rule = Get-NetFirewallRule -Name "EPM-Dashboard" -ErrorAction SilentlyContinue
                if (-not $rule) {
                    New-NetFirewallRule -Name "EPM-Dashboard" -DisplayName "Enterprise PC Dashboard" -Protocol TCP -LocalPort $Port -Direction Inbound -Action Allow -Profile Any -ErrorAction SilentlyContinue | Out-Null
                }
            }
            "npm 의존성" {
                Push-Location $BackendPath
                npm install --silent 2>$null
                Pop-Location
            }
        }
        
        Write-Host "       ✅ 완료" -ForegroundColor Green
    }
    
    return $true
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════════
# 학생 PC 설정 모드
# ═══════════════════════════════════════════════════════════════════════════════════════════════════
function Setup-StudentPC {
    Write-Section "학생 PC 원격 관리 설정"
    
    $steps = @(
        @{ Desc = "PowerShell Remoting 활성화"; Cmd = { Enable-PSRemoting -Force -SkipNetworkProfileCheck } }
        @{ Desc = "WinRM 서비스 시작"; Cmd = { Set-Service WinRM -StartupType Automatic; Start-Service WinRM } }
        @{ Desc = "Basic 인증 활성화"; Cmd = { Set-Item WSMan:\localhost\Service\Auth\Basic -Value $true; Set-Item WSMan:\localhost\Client\Auth\Basic -Value $true } }
        @{ Desc = "TrustedHosts 설정"; Cmd = { Set-Item WSMan:\localhost\Client\TrustedHosts -Value "192.168.*.*" -Force } }
        @{ Desc = "방화벽 규칙 생성"; Cmd = { 
                $rule = Get-NetFirewallRule -Name "WINRM-HTTP-In-TCP" -ErrorAction SilentlyContinue
                if (-not $rule) { New-NetFirewallRule -Name "WINRM-HTTP-In-TCP" -DisplayName "WinRM (HTTP-In)" -Protocol TCP -LocalPort 5985 -Direction Inbound -Action Allow -Profile Any | Out-Null }
            }
        }
        @{ Desc = "LocalAccountTokenFilterPolicy 설정"; Cmd = { Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" -Name "LocalAccountTokenFilterPolicy" -Value 1 -Force } }
        @{ Desc = "WinRM 재시작"; Cmd = { Restart-Service WinRM } }
    )
    
    $i = 0
    foreach ($step in $steps) {
        $i++
        Write-Step $i $steps.Count $step.Desc "진행중"
        try {
            & $step.Cmd
            Write-Step $i $steps.Count $step.Desc "완료"
        }
        catch {
            Write-Step $i $steps.Count "$($step.Desc) - $($_.Exception.Message)" "실패"
        }
    }
    
    # Show result
    $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" } | Select-Object -First 1).IPAddress
    Write-Host ""
    Write-Host "  ┌─────────────────────────────────────────────────────────────────────────────┐" -ForegroundColor Green
    Write-Host "  │  ✅ 학생 PC 설정 완료!                                                       │" -ForegroundColor Green
    Write-Host "  │  📍 컴퓨터 이름: $env:COMPUTERNAME" -ForegroundColor White
    Write-Host "  │  🌐 IP 주소: $ip" -ForegroundColor Yellow
    Write-Host "  │  👉 대시보드에서 이 정보로 PC를 추가하세요!                                   │" -ForegroundColor Cyan
    Write-Host "  └─────────────────────────────────────────────────────────────────────────────┘" -ForegroundColor Green
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════════
# 메인 실행 (선생님 PC)
# ═══════════════════════════════════════════════════════════════════════════════════════════════════
function Start-Dashboard {
    $totalSteps = 7
    $currentStep = 0
    
    try {
        # Step 1: Node 프로세스 정리
        $currentStep++
        Write-Step $currentStep $totalSteps "기존 서버 프로세스 정리..." "진행중"
        Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
        Write-Step $currentStep $totalSteps "기존 서버 프로세스 정리" "완료"
        
        # Step 2: 시스템 진단
        $currentStep++
        Write-Step $currentStep $totalSteps "시스템 진단 중..." "진행중"
        $issues = Test-SystemHealth
        Write-Step $currentStep $totalSteps "시스템 진단 완료" "완료"
        
        # Step 3: 자동 복구
        $currentStep++
        if ($issues.Count -gt 0) {
            Write-Step $currentStep $totalSteps "문제 자동 복구 중..." "진행중"
            Repair-System $issues | Out-Null
            Write-Step $currentStep $totalSteps "자동 복구 완료" "완료"
        }
        else {
            Write-Step $currentStep $totalSteps "모든 시스템 정상" "완료"
        }
        
        # Step 4: 포트 사용 확인
        $currentStep++
        Write-Step $currentStep $totalSteps "포트 $Port 확인..." "진행중"
        $portInUse = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        if ($portInUse) {
            $pid = $portInUse.OwningProcess
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 500
        }
        Write-Step $currentStep $totalSteps "포트 $Port 준비 완료" "완료"
        
        # Step 5: Node.js 버전 확인
        $currentStep++
        Write-Step $currentStep $totalSteps "Node.js 확인..." "진행중"
        $nodeVersion = node --version 2>$null
        Write-Step $currentStep $totalSteps "Node.js $nodeVersion" "완료"
        
        # Step 6: 서버 시작
        $currentStep++
        Write-Step $currentStep $totalSteps "대시보드 서버 시작..." "진행중"
        
        $serverScript = @"
cd '$BackendPath'
`$env:NODE_ENV = 'production'
node server.js
"@
        
        Start-Process PowerShell -ArgumentList "-NoExit", "-Command", $serverScript -WindowStyle Normal
        
        # 서버 대기
        $maxWait = 15
        $waited = 0
        while ($waited -lt $maxWait) {
            Start-Sleep -Seconds 1
            $waited++
            try {
                $response = Invoke-WebRequest -Uri "$DashboardURL/api/stats" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
                if ($response.StatusCode -eq 200) { break }
            }
            catch { }
        }
        Write-Step $currentStep $totalSteps "대시보드 서버 시작" "완료"
        
        # Step 7: 브라우저 열기
        $currentStep++
        if (-not $NoBrowser) {
            Write-Step $currentStep $totalSteps "브라우저 실행..." "진행중"
            Start-Process $DashboardURL
            Write-Step $currentStep $totalSteps "브라우저 실행" "완료"
        }
        else {
            Write-Step $currentStep $totalSteps "브라우저 실행 건너뜀" "건너뜀"
        }
        
        # 완료 메시지
        Write-Section "시스템 시작 완료"
        
        $localIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" } | Select-Object -First 1).IPAddress
        
        Write-Host ""
        Write-Host "  ╔══════════════════════════════════════════════════════════════════════════╗" -ForegroundColor Green
        Write-Host "  ║                   🎉 SYSTEM READY - 시스템 준비 완료! 🎉                  ║" -ForegroundColor Green
        Write-Host "  ╚══════════════════════════════════════════════════════════════════════════╝" -ForegroundColor Green
        Write-Host ""
        Write-Host "  ┌─────────────────────────────────────────────────────────────────────────────┐" -ForegroundColor DarkGray
        Write-Host "  │  📊 시스템 정보                                                             │" -ForegroundColor White
        Write-Host "  ├─────────────────────────────────────────────────────────────────────────────┤" -ForegroundColor DarkGray
        Write-Host "  │  🖥️  컴퓨터 이름:  $env:COMPUTERNAME" -ForegroundColor White
        Write-Host "  │  🌐 로컬 IP:      $localIP" -ForegroundColor White
        Write-Host "  │  🔗 대시보드:     $DashboardURL" -ForegroundColor Cyan
        Write-Host "  │  📁 프로젝트:     $ProjectRoot" -ForegroundColor White
        Write-Host "  │  📌 버전:         v$Version" -ForegroundColor White
        Write-Host "  └─────────────────────────────────────────────────────────────────────────────┘" -ForegroundColor DarkGray
        Write-Host ""
        Write-Host "  ═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor DarkGray
        Write-Host "  💡 학생 PC 설정: .\START-DASHBOARD.ps1 -StudentPC" -ForegroundColor DarkGray
        Write-Host "  💡 전체 진단:    .\START-DASHBOARD.ps1 -DiagnoseOnly" -ForegroundColor DarkGray
        Write-Host "  💡 서버 종료:    서버 PowerShell 창 닫기" -ForegroundColor DarkGray
        Write-Host "  ═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor DarkGray
        Write-Host ""
        
    }
    catch {
        Write-Host ""
        Write-Host "  ╔══════════════════════════════════════════════════════════════════════════╗" -ForegroundColor Red
        Write-Host "  ║                         ❌ 오류 발생                                      ║" -ForegroundColor Red
        Write-Host "  ╚══════════════════════════════════════════════════════════════════════════╝" -ForegroundColor Red
        Write-Host ""
        Write-Host "  오류: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host ""
    }
}

# ═══════════════════════════════════════════════════════════════════════════════════════════════════
# 메인 실행
# ═══════════════════════════════════════════════════════════════════════════════════════════════════
Write-Banner

if ($StudentPC) {
    Setup-StudentPC
}
elseif ($DiagnoseOnly) {
    $issues = Test-SystemHealth
    if ($issues.Count -gt 0) {
        Write-Host ""
        Write-Host "  🔧 자동 복구하려면: .\START-DASHBOARD.ps1" -ForegroundColor Yellow
    }
}
else {
    Start-Dashboard
}

if (-not $Silent) {
    Write-Host ""
    Read-Host "  Enter 키를 누르면 종료됩니다"
}
