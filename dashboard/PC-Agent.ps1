# PC-Agent.ps1
# Client agent for dashboard communication

<#
.SYNOPSIS
    PC 에이전트 - 대시보드와 통신

.DESCRIPTION
    실시간 PC 상태를 대시보드에 전송
    원격 명령 수신 및 실행

.EXAMPLE
    .\PC-Agent.ps1
#>

[CmdletBinding()]
param(
    [string]$DashboardUrl = "http://localhost:3001"
)

# Node.js Socket.IO 클라이언트 (PowerShell에서 HTTP로 간단히 구현)
$pcName = $env:COMPUTERNAME
$ipAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" } | Select-Object -First 1).IPAddress

Write-Host "Starting PC Agent..." -ForegroundColor Cyan
Write-Host "  PC Name: $pcName" -ForegroundColor Gray
Write-Host "  IP: $ipAddress" -ForegroundColor Gray
Write-Host "  Dashboard: $DashboardUrl" -ForegroundColor Gray
Write-Host ""

# 무한 루프로 상태 전송
while ($true) {
    try {
        # CPU & Memory 사용률
        $cpu = (Get-Counter '\Processor(_Total)\% Processor Time').CounterSamples.CookedValue
        $memory = (Get-Counter '\Memory\% Committed Bytes In Use').CounterSamples.CookedValue
        
        # 상태 데이터
        $status = @{
            pcName = $pcName
            ipAddress = $ipAddress
            cpuUsage = [math]::Round($cpu, 2)
            memoryUsage = [math]::Round($memory, 2)
            timestamp = (Get-Date -Format "o")
        }
        
        # HTTP POST로 전송 (Socket.IO 대신 간단히)
        $json = $status | ConvertTo-Json
        $response = Invoke-RestMethod -Uri "$DashboardUrl/api/pcs/$pcName/status" -Method POST -Body $json -ContentType "application/json" -ErrorAction SilentlyContinue
        
        Write-Host "[$((Get-Date -Format 'HH:mm:ss'))] Status sent - CPU: $($status.cpuUsage)% | Memory: $($status.memoryUsage)%" -ForegroundColor Green
        
    } catch {
        Write-Host "[$((Get-Date -Format 'HH:mm:ss'))] Connection failed" -ForegroundColor Yellow
    }
    
    # 30초마다 전송
    Start-Sleep -Seconds 30
}
