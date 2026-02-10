# Generate-Report.ps1
# 시스템 상태 종합 보고서 생성

<#
.SYNOPSIS
    Enterprise PC Management - 시스템 종합 보고서 생성

.DESCRIPTION
    로컬 또는 원격 PC의 종합 보고서를 생성합니다:
    - 시스템 정보 (OS, CPU, RAM, Disk)
    - 보안 상태 (방화벽, Windows Update, 안티바이러스)
    - 설치된 프로그램 목록
    - 사용자 계정 상태
    - 네트워크 구성
    - 최근 이벤트 로그

.PARAMETER Format
    출력 형식 (JSON, HTML, TEXT), 기본값: HTML

.PARAMETER Silent
    무인 모드 (UI 출력 없음)

.PARAMETER OutputPath
    보고서 저장 경로

.EXAMPLE
    .\Generate-Report.ps1
    .\Generate-Report.ps1 -Format JSON -Silent
    .\Generate-Report.ps1 -Format HTML -OutputPath "C:\Reports"
#>

[CmdletBinding()]
param(
    [ValidateSet("JSON", "HTML", "TEXT")]
    [string]$Format = "HTML",
    [switch]$Silent,
    [string]$OutputPath = "C:\ProgramData\EnterprisePC\Reports"
)

# 관리자 권한 확인
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    if (-not $Silent) { Write-Host "ERROR: Administrator required!" -ForegroundColor Red }
    exit 1
}

if (-not $Silent) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  SYSTEM REPORT GENERATOR" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Collecting system information..." -ForegroundColor Gray
}

# 보고서 디렉토리 생성
if (-not (Test-Path $OutputPath)) {
    New-Item -Path $OutputPath -ItemType Directory -Force | Out-Null
}

$report = @{}

# 1. 시스템 정보
try {
    $os = Get-CimInstance Win32_OperatingSystem
    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    $disk = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object -First 1

    $report.System = @{
        ComputerName = $env:COMPUTERNAME
        OS           = $os.Caption
        OSVersion    = $os.Version
        Architecture = $os.OSArchitecture
        CPU          = $cpu.Name
        CPUCores     = $cpu.NumberOfCores
        TotalRAM     = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
        FreeRAM      = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
        DiskTotal    = if ($disk) { [math]::Round($disk.Size / 1GB, 2) } else { 0 }
        DiskFree     = if ($disk) { [math]::Round($disk.FreeSpace / 1GB, 2) } else { 0 }
        Uptime       = (Get-Date) - $os.LastBootUpTime | ForEach-Object { "$($_.Days)d $($_.Hours)h $($_.Minutes)m" }
    }
    if (-not $Silent) { Write-Host "  [OK] System info collected" -ForegroundColor Green }
} catch {
    $report.System = @{ Error = $_.Exception.Message }
    if (-not $Silent) { Write-Host "  [WARN] System info: $($_.Exception.Message)" -ForegroundColor Yellow }
}

# 2. 보안 상태
try {
    $firewall = Get-NetFirewallProfile | Select-Object Name, Enabled
    $defender = Get-MpComputerStatus -ErrorAction SilentlyContinue

    $report.Security = @{
        FirewallProfiles    = $firewall | ForEach-Object { @{ Name = $_.Name; Enabled = $_.Enabled } }
        AntivirusEnabled    = if ($defender) { $defender.AntivirusEnabled } else { "Unknown" }
        RealTimeProtection  = if ($defender) { $defender.RealTimeProtectionEnabled } else { "Unknown" }
        LastQuickScan       = if ($defender) { $defender.QuickScanEndTime.ToString("yyyy-MM-dd HH:mm") } else { "Unknown" }
    }
    if (-not $Silent) { Write-Host "  [OK] Security status collected" -ForegroundColor Green }
} catch {
    $report.Security = @{ Error = $_.Exception.Message }
    if (-not $Silent) { Write-Host "  [WARN] Security: $($_.Exception.Message)" -ForegroundColor Yellow }
}

# 3. 설치된 프로그램
try {
    $programs = Get-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName } |
        Select-Object DisplayName, DisplayVersion, Publisher, InstallDate |
        Sort-Object DisplayName

    $report.InstalledPrograms = $programs | ForEach-Object {
        @{
            Name    = $_.DisplayName
            Version = $_.DisplayVersion
            Publisher = $_.Publisher
        }
    }
    $report.ProgramCount = $programs.Count
    if (-not $Silent) { Write-Host "  [OK] $($programs.Count) programs found" -ForegroundColor Green }
} catch {
    $report.InstalledPrograms = @()
    if (-not $Silent) { Write-Host "  [WARN] Programs: $($_.Exception.Message)" -ForegroundColor Yellow }
}

# 4. 사용자 계정
try {
    $users = Get-LocalUser | Select-Object Name, Enabled, LastLogon
    $report.Users = $users | ForEach-Object {
        @{
            Name      = $_.Name
            Enabled   = $_.Enabled
            LastLogon = if ($_.LastLogon) { $_.LastLogon.ToString("yyyy-MM-dd HH:mm") } else { "Never" }
        }
    }
    if (-not $Silent) { Write-Host "  [OK] $($users.Count) users found" -ForegroundColor Green }
} catch {
    $report.Users = @()
    if (-not $Silent) { Write-Host "  [WARN] Users: $($_.Exception.Message)" -ForegroundColor Yellow }
}

# 5. 네트워크
try {
    $adapters = Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.InterfaceAlias -notlike "*Loopback*" } |
        Select-Object InterfaceAlias, IPAddress, PrefixLength

    $report.Network = $adapters | ForEach-Object {
        @{
            Interface = $_.InterfaceAlias
            IP        = $_.IPAddress
            Subnet    = $_.PrefixLength
        }
    }
    if (-not $Silent) { Write-Host "  [OK] Network info collected" -ForegroundColor Green }
} catch {
    $report.Network = @()
    if (-not $Silent) { Write-Host "  [WARN] Network: $($_.Exception.Message)" -ForegroundColor Yellow }
}

# 6. 최근 이벤트 (오류/경고)
try {
    $events = Get-EventLog -LogName System -EntryType Error, Warning -Newest 10 -ErrorAction SilentlyContinue |
        Select-Object TimeGenerated, EntryType, Source, Message

    $report.RecentEvents = $events | ForEach-Object {
        @{
            Time    = $_.TimeGenerated.ToString("yyyy-MM-dd HH:mm")
            Type    = $_.EntryType.ToString()
            Source  = $_.Source
            Message = $_.Message.Substring(0, [Math]::Min(200, $_.Message.Length))
        }
    }
    if (-not $Silent) { Write-Host "  [OK] Recent events collected" -ForegroundColor Green }
} catch {
    $report.RecentEvents = @()
}

$report.GeneratedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$report.ComputerName = $env:COMPUTERNAME

# 출력
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

switch ($Format) {
    "JSON" {
        $jsonOutput = $report | ConvertTo-Json -Depth 10
        if ($Silent) {
            Write-Output $jsonOutput
        } else {
            $filePath = "$OutputPath\report-$timestamp.json"
            $jsonOutput | Out-File $filePath -Encoding UTF8
            Write-Host ""
            Write-Host "Report saved: $filePath" -ForegroundColor Green
        }
    }
    "TEXT" {
        $text = @"
========================================
  SYSTEM REPORT - $($report.ComputerName)
  Generated: $($report.GeneratedAt)
========================================

--- SYSTEM ---
OS:       $($report.System.OS) ($($report.System.Architecture))
CPU:      $($report.System.CPU)
RAM:      $($report.System.FreeRAM) GB free / $($report.System.TotalRAM) GB total
Disk:     $($report.System.DiskFree) GB free / $($report.System.DiskTotal) GB total
Uptime:   $($report.System.Uptime)

--- SECURITY ---
Firewall: $(($report.Security.FirewallProfiles | ForEach-Object { "$($_.Name):$($_.Enabled)" }) -join ", ")
Antivirus: $($report.Security.AntivirusEnabled)
Realtime:  $($report.Security.RealTimeProtection)

--- PROGRAMS ---
Total: $($report.ProgramCount) installed

--- USERS ---
$(($report.Users | ForEach-Object { "  $($_.Name) (Enabled: $($_.Enabled), Last: $($_.LastLogon))" }) -join "`n")

--- NETWORK ---
$(($report.Network | ForEach-Object { "  $($_.Interface): $($_.IP)/$($_.Subnet)" }) -join "`n")
"@
        if ($Silent) {
            Write-Output $text
        } else {
            $filePath = "$OutputPath\report-$timestamp.txt"
            $text | Out-File $filePath -Encoding UTF8
            Write-Host ""
            Write-Host "Report saved: $filePath" -ForegroundColor Green
        }
    }
    "HTML" {
        $htmlPrograms = ($report.InstalledPrograms | Select-Object -First 30 | ForEach-Object {
            "<tr><td>$($_.Name)</td><td>$($_.Version)</td><td>$($_.Publisher)</td></tr>"
        }) -join "`n"

        $htmlUsers = ($report.Users | ForEach-Object {
            "<tr><td>$($_.Name)</td><td>$($_.Enabled)</td><td>$($_.LastLogon)</td></tr>"
        }) -join "`n"

        $html = @"
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>System Report - $($report.ComputerName)</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', sans-serif; background: #0a0a0f; color: #fff; padding: 40px; }
        .container { max-width: 1000px; margin: 0 auto; }
        h1 { background: linear-gradient(135deg, #3b82f6, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 2rem; }
        .meta { color: rgba(255,255,255,0.4); margin-bottom: 32px; }
        .card { background: rgba(26,26,37,0.8); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 24px; margin-bottom: 20px; }
        .card h2 { font-size: 1.1rem; margin-bottom: 16px; color: #3b82f6; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 0.9rem; }
        th { color: rgba(255,255,255,0.5); text-transform: uppercase; font-size: 0.75rem; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .kv { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .kv .k { color: rgba(255,255,255,0.5); }
        .kv .v { font-weight: 600; }
    </style>
</head>
<body>
<div class="container">
    <h1>System Report</h1>
    <p class="meta">$($report.ComputerName) • $($report.GeneratedAt)</p>

    <div class="grid">
        <div class="card">
            <h2>System</h2>
            <div class="kv"><span class="k">OS</span><span class="v">$($report.System.OS)</span></div>
            <div class="kv"><span class="k">CPU</span><span class="v">$($report.System.CPU)</span></div>
            <div class="kv"><span class="k">RAM</span><span class="v">$($report.System.FreeRAM) / $($report.System.TotalRAM) GB</span></div>
            <div class="kv"><span class="k">Disk</span><span class="v">$($report.System.DiskFree) / $($report.System.DiskTotal) GB</span></div>
            <div class="kv"><span class="k">Uptime</span><span class="v">$($report.System.Uptime)</span></div>
        </div>
        <div class="card">
            <h2>Security</h2>
            <div class="kv"><span class="k">Antivirus</span><span class="v">$($report.Security.AntivirusEnabled)</span></div>
            <div class="kv"><span class="k">Realtime</span><span class="v">$($report.Security.RealTimeProtection)</span></div>
            <div class="kv"><span class="k">Last Scan</span><span class="v">$($report.Security.LastQuickScan)</span></div>
        </div>
    </div>

    <div class="card">
        <h2>Users ($($report.Users.Count))</h2>
        <table><tr><th>Name</th><th>Enabled</th><th>Last Logon</th></tr>$htmlUsers</table>
    </div>

    <div class="card">
        <h2>Installed Programs ($($report.ProgramCount))</h2>
        <table><tr><th>Name</th><th>Version</th><th>Publisher</th></tr>$htmlPrograms</table>
    </div>
</div>
</body>
</html>
"@
        $filePath = "$OutputPath\report-$timestamp.html"
        $html | Out-File $filePath -Encoding UTF8
        if (-not $Silent) {
            Write-Host ""
            Write-Host "Report saved: $filePath" -ForegroundColor Green
            Start-Process $filePath
        }
    }
}
