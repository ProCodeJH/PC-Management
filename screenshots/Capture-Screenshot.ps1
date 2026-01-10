# Capture-Screenshot.ps1
# 정기적 스크린샷 캡처

<#
.SYNOPSIS
    현재 화면 스크린샷 캡처

.DESCRIPTION
    - 전체 화면 캡처
    - 날짜별 폴더에 저장
    - 대시보드 전송 (선택)

.EXAMPLE
    .\Capture-Screenshot.ps1
    .\Capture-Screenshot.ps1 -DashboardUrl "http://server:3001"
#>

[CmdletBinding()]
param(
    [string]$SavePath = "C:\ProgramData\EnterprisePC\Screenshots",
    [string]$DashboardUrl = "",
    [int]$Quality = 80,
    [switch]$Silent
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# 저장 경로 생성
$datePath = Join-Path $SavePath (Get-Date -Format "yyyy-MM-dd")
if (-not (Test-Path $datePath)) {
    New-Item -Path $datePath -ItemType Directory -Force | Out-Null
}

$filename = "screenshot_$(Get-Date -Format 'HH-mm-ss').jpg"
$filepath = Join-Path $datePath $filename

try {
    # 전체 화면 캡처
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen
    $bounds = $screen.Bounds
    
    $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    
    # JPEG로 저장 (품질 설정)
    $encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | 
    Where-Object { $_.MimeType -eq 'image/jpeg' }
    $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
        [System.Drawing.Imaging.Encoder]::Quality, $Quality
    )
    
    $bitmap.Save($filepath, $encoder, $encoderParams)
    
    $graphics.Dispose()
    $bitmap.Dispose()
    
    if (-not $Silent) {
        Write-Host "Screenshot saved: $filepath" -ForegroundColor Green
    }
    
    # 대시보드로 전송
    if ($DashboardUrl) {
        try {
            $base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($filepath))
            $body = @{
                pcName    = $env:COMPUTERNAME
                timestamp = (Get-Date -Format "o")
                image     = $base64
                filename  = $filename
            } | ConvertTo-Json
            
            Invoke-RestMethod -Uri "$DashboardUrl/api/screenshots" -Method POST -Body $body -ContentType "application/json" -ErrorAction SilentlyContinue
            
            if (-not $Silent) {
                Write-Host "Screenshot sent to dashboard" -ForegroundColor Green
            }
        }
        catch {
            # Silent fail for dashboard upload
        }
    }
    
    return @{
        Success  = $true
        FilePath = $filepath
    }
    
}
catch {
    Write-Warning "Screenshot failed: $_"
    return @{ Success = $false }
}
