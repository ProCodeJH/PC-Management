# Export-Logs.ps1
# 로그 데이터를 리포트로 내보내기

<#
.SYNOPSIS
    활동 로그를 HTML 리포트로 생성

.PARAMETER Days
    분석할 기간 (일), 기본값: 7일

.PARAMETER Output
    출력 형식 (HTML, CSV), 기본값: HTML

.EXAMPLE
    .\Export-Logs.ps1 -Days 7
#>

[CmdletBinding()]
param(
    [int]$Days = 7,
    [ValidateSet("HTML", "CSV")]
    [string]$Output = "HTML"
)

$logPath = "C:\ProgramData\EnterprisePC\Logs"
$reportPath = "$logPath\Reports"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ACTIVITY REPORT GENERATOR" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 데이터 수집
$allData = @()

for ($i = 0; $i -lt $Days; $i++) {
    $date = (Get-Date).AddDays(-$i).ToString("yyyy-MM-dd")
    $file = "$logPath\Programs\programs-$date.csv"
    
    if (Test-Path $file) {
        $data = Import-Csv $file
        $allData += $data
    }
}

if ($allData.Count -eq 0) {
    Write-Host "No data found for the last $Days days" -ForegroundColor Yellow
    exit 0
}

Write-Host "Processing $($allData.Count) records..." -ForegroundColor Gray

# 프로그램별 통계
$programStats = $allData | Group-Object Program | ForEach-Object {
    [PSCustomObject]@{
        Program = $_.Name
        Count = $_.Count
        Hours = [math]::Round($_.Count / 60, 2)
    }
} | Sort-Object Count -Descending

# 시간대별 활동
$hourlyStats = $allData | ForEach-Object {
    $hour = ([datetime]$_.Timestamp).Hour
    [PSCustomObject]@{ Hour = $hour }
} | Group-Object Hour | ForEach-Object {
    [PSCustomObject]@{
        Hour = $_.Name
        Count = $_.Count
    }
} | Sort-Object { [int]$_.Hour }

# 리포트 생성
if ($Output -eq "HTML") {
    $reportFile = "$reportPath\activity-report-$(Get-Date -Format 'yyyyMMdd-HHmmss').html"
    
    $html = @"
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>Activity Report</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', Arial, sans-serif; 
            background: #0a0a0f; 
            color: #fff; 
            padding: 40px;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 { 
            font-size: 2rem; 
            margin-bottom: 8px;
            background: linear-gradient(135deg, #3b82f6, #8b5cf6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .subtitle { color: rgba(255,255,255,0.5); margin-bottom: 32px; }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 20px;
            margin-bottom: 40px;
        }
        .stat-card {
            background: rgba(26, 26, 37, 0.8);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            padding: 20px;
        }
        .stat-label { font-size: 0.875rem; color: rgba(255,255,255,0.5); }
        .stat-value { font-size: 2rem; font-weight: 700; margin-top: 8px; }
        .stat-value.blue { color: #3b82f6; }
        .stat-value.green { color: #10b981; }
        .stat-value.purple { color: #8b5cf6; }
        .stat-value.orange { color: #f59e0b; }
        .card {
            background: rgba(26, 26, 37, 0.8);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 24px;
        }
        .card h2 { font-size: 1.25rem; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { 
            padding: 12px; 
            text-align: left; 
            border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        th { 
            font-size: 0.75rem; 
            text-transform: uppercase; 
            color: rgba(255,255,255,0.5);
            font-weight: 600;
        }
        tr:hover { background: rgba(255,255,255,0.02); }
        .bar-container {
            width: 100%;
            height: 8px;
            background: rgba(255,255,255,0.1);
            border-radius: 4px;
            overflow: hidden;
        }
        .bar-fill {
            height: 100%;
            background: linear-gradient(90deg, #3b82f6, #8b5cf6);
            border-radius: 4px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 Activity Report</h1>
        <p class="subtitle">Last $Days days • Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")</p>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">Total Records</div>
                <div class="stat-value blue">$($allData.Count)</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Unique Programs</div>
                <div class="stat-value green">$($programStats.Count)</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Estimated Hours</div>
                <div class="stat-value purple">$([math]::Round($allData.Count / 60, 1))</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Analysis Period</div>
                <div class="stat-value orange">$Days days</div>
            </div>
        </div>
        
        <div class="card">
            <h2>Top Programs</h2>
            <table>
                <tr>
                    <th>Program</th>
                    <th>Usage</th>
                    <th style="width: 40%">Activity</th>
                </tr>
                $(($programStats | Select-Object -First 15 | ForEach-Object {
                    $maxCount = ($programStats | Measure-Object -Property Count -Maximum).Maximum
                    $width = [math]::Round(($_.Count / $maxCount) * 100, 0)
                    "<tr><td>$($_.Program)</td><td>$($_.Hours) hrs</td><td><div class='bar-container'><div class='bar-fill' style='width: $width%'></div></div></td></tr>"
                }) -join "`n")
            </table>
        </div>
    </div>
</body>
</html>
"@
    
    $html | Out-File $reportFile -Encoding UTF8
    Write-Host ""
    Write-Host "Report generated: $reportFile" -ForegroundColor Green
    Start-Process $reportFile
    
} else {
    # CSV 출력
    $reportFile = "$reportPath\activity-report-$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"
    $programStats | Export-Csv -Path $reportFile -NoTypeInformation -Encoding UTF8
    Write-Host ""
    Write-Host "Report generated: $reportFile" -ForegroundColor Green
}
