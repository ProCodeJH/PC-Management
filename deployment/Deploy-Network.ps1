# Deploy-Network.ps1
# 네트워크로 여러 PC에 동시 배포

param(
    [string[]]$PCNames = @("PC-01", "PC-02", "PC-03"),
    [string]$ScriptPath = "D:\Dark_Virus\USB-Complete-Setup.ps1"
)

Write-Host "Network Deployment" -ForegroundColor Cyan
Write-Host "Target PCs: $($PCNames.Count)" -ForegroundColor Gray

foreach ($pc in $PCNames) {
    Write-Host "Deploying to $pc..." -ForegroundColor Yellow
    
    try {
        # PowerShell Remoting으로 원격 실행
        Invoke-Command -ComputerName $pc -ScriptBlock {
            param($script)
            & PowerShell.exe -ExecutionPolicy Bypass -File $script
        } -ArgumentList $ScriptPath -ErrorAction Stop
        
        Write-Host "  $pc - OK" -ForegroundColor Green
    }
    catch {
        Write-Host "  $pc - FAILED: $_" -ForegroundColor Red
    }
}

Write-Host " Deployment Complete!" -ForegroundColor Green
