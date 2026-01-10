# Analyze-ScreenTime.ps1
# 스크린타임 분석 및 리포트 생성

param(
    [int]$Days = 7
)

Write-Host "Screen Time Analysis (Last $Days days)" -ForegroundColor Cyan

$logPath = "C:\ProgramData\EnterprisePC\Logs\Programs"
$data = @()

for ($i = 0; $i -lt $Days; $i++) {
    $date = (Get-Date).AddDays(-$i).ToString("yyyy-MM-dd")
    $file = Join-Path $logPath "programs-$date.csv"
    
    if (Test-Path $file) {
        $data += Import-Csv $file
    }
}

if ($data.Count -eq 0) {
    Write-Host "No data found" -ForegroundColor Yellow
    exit
}

# 프로그램별 사용 시간
$programStats = $data | Group-Object Program | ForEach-Object {
    [PSCustomObject]@{
        Program = $_.Name
        Minutes = $_.Count
        Hours = [math]::Round($_.Count / 60, 1)
    }
} | Sort-Object Minutes -Descending

Write-Host ""
Write-Host "Top 10 Programs:" -ForegroundColor Green
$programStats | Select-Object -First 10 | ForEach-Object {
    Write-Host "  $($_.Program): $($_.Hours) hours" -ForegroundColor Gray
}

# HTML 리포트 생성
$html = @"
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Screen Time Analysis</title>
    <style>
        body { font-family: Arial; margin: 40px; }
        h1 { color: #2c3e50; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 10px; border: 1px solid #ddd; text-align: left; }
        th { background: #3498db; color: white; }
    </style>
</head>
<body>
    <h1>📊 Screen Time Analysis</h1>
    <p>Period: Last $Days days</p>
    <table>
        <tr><th>Program</th><th>Hours</th></tr>
        $(($programStats | Select-Object -First 20 | ForEach-Object { "<tr><td>$($_.Program)</td><td>$($_.Hours)</td></tr>" }) -join "`n")
    </table>
</body>
</html>
"@

$reportFile = "C:\ProgramData\EnterprisePC\Logs\Reports\screentime-analysis.html"
$html | Out-File $reportFile -Encoding UTF8
Write-Host ""
Write-Host "Report generated: $reportFile" -ForegroundColor Green
Start-Process $reportFile
