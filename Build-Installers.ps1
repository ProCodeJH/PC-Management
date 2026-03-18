[CmdletBinding()]
param(
    [string]$OutputRoot,
    [string]$ReleaseRoot,
    [switch]$SkipExe
)

$ErrorActionPreference = "Stop"

if (-not $OutputRoot) {
    $OutputRoot = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "dist"
}

if (-not $ReleaseRoot) {
    $ReleaseRoot = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "release"
}

$TeacherStage = Join-Path $OutputRoot "Teacher-Setup"
$StudentStage = Join-Path $OutputRoot "Student-Setup"
$IExpressTemp = Join-Path $OutputRoot "_iexpress"
$TeacherWrapper = Join-Path $IExpressTemp "Teacher-Wrapper"
$StudentWrapper = Join-Path $IExpressTemp "Student-Wrapper"
$TeacherZip = Join-Path $OutputRoot "Teacher-Setup.zip"
$StudentZip = Join-Path $OutputRoot "Student-Setup.zip"
$TeacherExe = Join-Path $OutputRoot "Teacher-Setup.exe"
$StudentExe = Join-Path $OutputRoot "Student-Setup.exe"
$ReleaseTeacherExe = Join-Path $ReleaseRoot "Teacher-Setup.exe"
$ReleaseStudentExe = Join-Path $ReleaseRoot "Student-Setup.exe"
$ReleaseChecklist = Join-Path $ReleaseRoot "RELEASE-CHECKLIST.md"

function Write-Status {
    param(
        [string]$Message,
        [string]$Color = "Cyan"
    )

    Write-Host "[Build] $Message" -ForegroundColor $Color
}

function Reset-Directory {
    param([string]$Path)

    if (Test-Path $Path) {
        Remove-Item -Path $Path -Recurse -Force
    }

    New-Item -Path $Path -ItemType Directory -Force | Out-Null
}

function Invoke-Robocopy {
    param(
        [string]$Source,
        [string]$Destination,
        [string[]]$ExtraArgs = @()
    )

    New-Item -Path $Destination -ItemType Directory -Force | Out-Null
    & robocopy $Source $Destination /E /R:0 /W:0 /NFL /NDL /NJH /NJS @ExtraArgs | Out-Null
    if ($LASTEXITCODE -gt 7) {
        throw "robocopy failed ($LASTEXITCODE): $Source -> $Destination"
    }
}

function Copy-RequiredFile {
    param(
        [string]$Source,
        [string]$Destination
    )

    if (-not (Test-Path $Source)) {
        throw "Required file not found: $Source"
    }

    $destinationDir = Split-Path -Parent $Destination
    if ($destinationDir) {
        New-Item -Path $destinationDir -ItemType Directory -Force | Out-Null
    }

    Copy-Item -Path $Source -Destination $Destination -Force
}

function Set-Utf8BomEncoding {
    param([string]$Path)

    $content = [System.IO.File]::ReadAllText($Path)
    $encoding = New-Object System.Text.UTF8Encoding($true)
    [System.IO.File]::WriteAllText($Path, $content, $encoding)
}

function Normalize-PowerShellEncoding {
    param([string]$RootPath)

    Get-ChildItem -Path $RootPath -Recurse -Filter "*.ps1" -File | ForEach-Object {
        Set-Utf8BomEncoding -Path $_.FullName
    }
}

function New-IExpressPackage {
    param(
        [string]$SourceRoot,
        [string]$EntryFile,
        [string]$FriendlyName,
        [string]$TargetFile
    )

    $files = Get-ChildItem -Path $SourceRoot -Recurse -File | Sort-Object FullName | ForEach-Object {
        $_.FullName.Substring($SourceRoot.Length + 1)
    }

    if (-not $files) {
        throw "No files found for package: $FriendlyName"
    }

    $sedPath = Join-Path $IExpressTemp ("{0}.sed" -f ($FriendlyName -replace '[^A-Za-z0-9_-]', '_'))

    $builder = New-Object System.Collections.Generic.List[string]
    $builder.Add("[Version]")
    $builder.Add("Class=IEXPRESS")
    $builder.Add("SEDVersion=3")
    $builder.Add("")
    $builder.Add("[Options]")
    $builder.Add("PackagePurpose=InstallApp")
    $builder.Add("ShowInstallProgramWindow=1")
    $builder.Add("HideExtractAnimation=1")
    $builder.Add("UseLongFileName=1")
    $builder.Add("InsideCompressed=0")
    $builder.Add("CAB_FixedSize=0")
    $builder.Add("CAB_ResvCodeSigning=0")
    $builder.Add("RebootMode=N")
    $builder.Add("InstallPrompt=")
    $builder.Add("DisplayLicense=")
    $builder.Add("FinishMessage=")
    $builder.Add("TargetName=$TargetFile")
    $builder.Add("FriendlyName=$FriendlyName")
    $builder.Add("AppLaunched=cmd /c $EntryFile")
    $builder.Add("PostInstallCmd=<None>")
    $builder.Add("AdminQuietInstCmd=")
    $builder.Add("UserQuietInstCmd=")
    $builder.Add("SourceFiles=SourceFiles")
    $builder.Add("")
    $builder.Add("[SourceFiles]")
    $builder.Add("SourceFiles0=$SourceRoot\")
    $builder.Add("")
    $builder.Add("[SourceFiles0]")

    for ($i = 0; $i -lt $files.Count; $i++) {
        $builder.Add("%FILE$i%=")
    }

    $builder.Add("")
    $builder.Add("[Strings]")

    for ($i = 0; $i -lt $files.Count; $i++) {
        $builder.Add("FILE$i=""$($files[$i])""")
    }

    Set-Content -Path $sedPath -Value $builder -Encoding ASCII
    & iexpress.exe /N $sedPath | Out-Null

    if (-not (Test-Path $TargetFile)) {
        throw "IExpress did not produce $TargetFile"
    }
}

function Build-TeacherStage {
    Write-Status "Copying teacher payload"

    $teacherFiles = @(
        "README.md",
        "START-DASHBOARD.ps1",
        "Teacher-Setup.bat",
        "StudentPC-Setup-Ultra.ps1"
    )

    foreach ($file in $teacherFiles) {
        Copy-RequiredFile -Source (Join-Path $PSScriptRoot $file) -Destination (Join-Path $TeacherStage $file)
    }

    Invoke-Robocopy `
        (Join-Path $PSScriptRoot "dashboard\backend") `
        (Join-Path $TeacherStage "dashboard\backend") `
        @(
            "/XD", (Join-Path $PSScriptRoot "dashboard\backend\logs"),
            "/XF", "enterprise-pc.db",
            "/XF", "enterprise-pc.db-shm",
            "/XF", "enterprise-pc.db-wal",
            "/XF", "enterprise-pc.db.bak",
            "/XF", "stderr.txt",
            "/XF", "crash.txt"
        )

    Invoke-Robocopy `
        (Join-Path $PSScriptRoot "dashboard\frontend") `
        (Join-Path $TeacherStage "dashboard\frontend")

    Write-Status "Bundling local Node runtime"
    $nodeCommand = Get-Command node -ErrorAction Stop
    $runtimeDir = Join-Path $TeacherStage "runtime"
    New-Item -Path $runtimeDir -ItemType Directory -Force | Out-Null
    Copy-Item -Path $nodeCommand.Source -Destination (Join-Path $runtimeDir "node.exe") -Force
}

function Build-StudentStage {
    Write-Status "Copying student payload"

    $studentFiles = @(
        "README.md",
        "Student-Setup.bat",
        "StudentPC-Setup-Ultra.ps1"
    )

    foreach ($file in $studentFiles) {
        Copy-RequiredFile -Source (Join-Path $PSScriptRoot $file) -Destination (Join-Path $StudentStage $file)
    }

    # Include PC agent
    Write-Status "Bundling PC agent"
    Invoke-Robocopy `
        (Join-Path $PSScriptRoot "dashboard\agent") `
        (Join-Path $StudentStage "agent") `
        @("/XD", "node_modules")

    # Include Install-Agent.ps1
    Copy-RequiredFile `
        -Source (Join-Path $PSScriptRoot "installer\Install-Agent.ps1") `
        -Destination (Join-Path $StudentStage "Install-Agent.ps1")

    # Bundle local Node runtime for student PC (same as teacher)
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCommand) {
        Write-Status "Bundling Node.js runtime for student"
        $runtimeDir = Join-Path $StudentStage "runtime"
        New-Item -Path $runtimeDir -ItemType Directory -Force | Out-Null
        Copy-Item -Path $nodeCommand.Source -Destination (Join-Path $runtimeDir "node.exe") -Force
    }
}

function Build-IExpressWrapper {
    param(
        [string]$WrapperRoot,
        [string]$PayloadZip,
        [string]$InstallerScript,
        [string]$LauncherScript,
        [string]$PayloadName
    )

    Reset-Directory $WrapperRoot
    Copy-RequiredFile -Source $PayloadZip -Destination (Join-Path $WrapperRoot $PayloadName)
    Copy-RequiredFile -Source (Join-Path $PSScriptRoot "installer\$InstallerScript") -Destination (Join-Path $WrapperRoot $InstallerScript)
    Copy-RequiredFile -Source (Join-Path $PSScriptRoot "installer\$LauncherScript") -Destination (Join-Path $WrapperRoot $LauncherScript)
}

function Publish-ReleaseFiles {
    Reset-Directory $ReleaseRoot
    Copy-RequiredFile -Source $TeacherExe -Destination $ReleaseTeacherExe
    Copy-RequiredFile -Source $StudentExe -Destination $ReleaseStudentExe
    Copy-RequiredFile -Source (Join-Path $PSScriptRoot "installer\RELEASE-CHECKLIST.md") -Destination $ReleaseChecklist
}

Write-Status "Preparing output directories"
Reset-Directory $TeacherStage
Reset-Directory $StudentStage
Reset-Directory $IExpressTemp

Build-TeacherStage
Build-StudentStage
Normalize-PowerShellEncoding -RootPath $TeacherStage
Normalize-PowerShellEncoding -RootPath $StudentStage

Write-Status "Creating zip archives"
Compress-Archive -Path (Join-Path $TeacherStage "*") -DestinationPath $TeacherZip -Force
Compress-Archive -Path (Join-Path $StudentStage "*") -DestinationPath $StudentZip -Force

if (-not $SkipExe) {
    Write-Status "Preparing IExpress wrapper payloads"
    Build-IExpressWrapper `
        -WrapperRoot $TeacherWrapper `
        -PayloadZip $TeacherZip `
        -InstallerScript "Install-Teacher-Payload.ps1" `
        -LauncherScript "Run-Teacher-Payload.bat" `
        -PayloadName "Teacher-Payload.zip"

    Build-IExpressWrapper `
        -WrapperRoot $StudentWrapper `
        -PayloadZip $StudentZip `
        -InstallerScript "Install-Student-Payload.ps1" `
        -LauncherScript "Run-Student-Payload.bat" `
        -PayloadName "Student-Payload.zip"

    Write-Status "Building Teacher-Setup.exe"
    if (Test-Path $TeacherExe) { Remove-Item $TeacherExe -Force }
    New-IExpressPackage -SourceRoot $TeacherWrapper -EntryFile "Run-Teacher-Payload.bat" -FriendlyName "PC Management Teacher Setup" -TargetFile $TeacherExe

    Write-Status "Building Student-Setup.exe"
    if (Test-Path $StudentExe) { Remove-Item $StudentExe -Force }
    New-IExpressPackage -SourceRoot $StudentWrapper -EntryFile "Run-Student-Payload.bat" -FriendlyName "PC Management Student Setup" -TargetFile $StudentExe

    Write-Status "Publishing clean release folder"
    Publish-ReleaseFiles
}

Write-Status "Done" "Green"
Write-Host ""
Write-Host "Teacher folder : $TeacherStage" -ForegroundColor White
Write-Host "Student folder : $StudentStage" -ForegroundColor White
Write-Host "Teacher zip    : $TeacherZip" -ForegroundColor White
Write-Host "Student zip    : $StudentZip" -ForegroundColor White
if (-not $SkipExe) {
    Write-Host "Teacher exe    : $TeacherExe" -ForegroundColor White
    Write-Host "Student exe    : $StudentExe" -ForegroundColor White
    Write-Host "Release folder : $ReleaseRoot" -ForegroundColor White
}
