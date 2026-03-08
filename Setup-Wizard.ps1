# EPM Setup Wizard v3 — Enhanced Edition
# 7 Improvements: Gradient UI, Icon, Animated Progress, Logging, Uninstall, i18n, Sound

# Robust path detection (works in .ps1, ps2exe .exe, and elevated context)
$ScriptPath = $null
if ($PSCommandPath -and $PSCommandPath -ne '') { $ScriptPath = $PSCommandPath }
if (-not $ScriptPath) { try { $ScriptPath = [System.Reflection.Assembly]::GetEntryAssembly().Location } catch {} }
if (-not $ScriptPath) { try { $ScriptPath = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName } catch {} }
if (-not $ScriptPath) { $ScriptPath = $MyInvocation.MyCommand.Path }

$ProjectRoot = if ($ScriptPath) { Split-Path -Parent $ScriptPath } else { $PWD.Path }

if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    if ($ScriptPath -and (Test-Path $ScriptPath)) {
        Start-Process $ScriptPath -Verb RunAs
    } else {
        Start-Process PowerShell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command `"Set-Location '$ProjectRoot'; & '$ProjectRoot\Setup-Wizard.ps1'`"" -Verb RunAs
    }
    exit
}

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Windows.Forms

$LogFile = Join-Path $ProjectRoot ('EPM-Setup-Log_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.txt')

# i18n
$Script:Lang = 'ko'
$T = @{
    ko = @{
        Welcome='Enterprise PC Management'; SubWelcome='Setup Wizard'; BtnNext='Next'; BtnPrev='Back'
        Step1='Welcome'; Step2='Mode'; Step3='Settings'; Step4='Install'; Step5='Done'
        WelcomeTitle='EPM Setup Wizard'; WelcomeDesc='Wizard to set up your PC'
        ModeTitle='Select Mode'; ModeDesc='Choose the role for this PC'
        TeacherPC='Teacher PC'; StudentPC='Student PC'
        TeacherDesc='Install dashboard server and manage student PCs'
        StudentDesc='Configure this PC for remote management'
        SettTitle='Settings'; SettDesc='Enter required information'
        ServerLabel='Dashboard Server Address'; ServerHint='Enter IP and port of Teacher PC'
        InstTitle='Installing...'; InstDesc='Configuring system...'
        DoneTitle='Setup Complete!'; DoneDesc='All settings applied successfully'
        BtnInstall='Install'; BtnFinish='Finish'; BtnUninstall='Uninstall'
        SummaryLabel='Summary'; ModeLabel='Mode'; CompLabel='Computer'
        IPLabel='IP Address'; ItemsLabel='Items'; DashLabel='Dashboard'; LoginLabel='Login'
        TeacherItems='Server + WinRM + Firewall'; StudentItems='WinRM + Auth + Firewall'
        LogTitle='Execution Log'
        UninstTitle='Uninstall'; UninstDesc='Reverting all EPM settings...'
        UninstDone='All EPM settings have been removed'
        LangBtn='EN'
    }
    en = @{
        Welcome='Enterprise PC Management'; SubWelcome='Setup Wizard'; BtnNext='Next'; BtnPrev='Back'
        Step1='Welcome'; Step2='Mode'; Step3='Settings'; Step4='Install'; Step5='Done'
        WelcomeTitle='EPM Setup Wizard'; WelcomeDesc='Wizard to set up your PC'
        ModeTitle='Select Install Mode'; ModeDesc='Choose the role for this PC'
        TeacherPC='Teacher PC'; StudentPC='Student PC'
        TeacherDesc='Install dashboard server and manage student PCs'
        StudentDesc='Configure this PC for remote management'
        SettTitle='Settings'; SettDesc='Enter required information'
        ServerLabel='Dashboard Server Address'; ServerHint='Enter IP and port of Teacher PC'
        InstTitle='Installing...'; InstDesc='Configuring system...'
        DoneTitle='Setup Complete!'; DoneDesc='All settings applied successfully'
        BtnInstall='Install'; BtnFinish='Finish'; BtnUninstall='Uninstall'
        SummaryLabel='Summary'; ModeLabel='Mode'; CompLabel='Computer'
        IPLabel='IP Address'; ItemsLabel='Items'; DashLabel='Dashboard'; LoginLabel='Login'
        TeacherItems='Server + WinRM + Firewall'; StudentItems='WinRM + Auth + Firewall'
        LogTitle='Execution Log'
        UninstTitle='Uninstall'; UninstDesc='Reverting all EPM settings...'
        UninstDone='All EPM settings have been removed'
        LangBtn='KO'
    }
}
function Get-Text([string]$key) { return $T[$Script:Lang][$key] }


[xml]$XAML = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="EPM Setup Wizard" Width="860" Height="640"
        WindowStartupLocation="CenterScreen" ResizeMode="NoResize" FontFamily="Segoe UI" Foreground="White">
    <Window.Background>
        <LinearGradientBrush StartPoint="0,0" EndPoint="1,1">
            <GradientStop Color="#080c18" Offset="0"/><GradientStop Color="#0f1a30" Offset="1"/>
        </LinearGradientBrush>
    </Window.Background>
    <Window.Resources>
        <Style x:Key="BtnP" TargetType="Button">
            <Setter Property="Foreground" Value="White"/><Setter Property="FontSize" Value="14"/>
            <Setter Property="FontWeight" Value="SemiBold"/><Setter Property="Padding" Value="28,10"/>
            <Setter Property="BorderThickness" Value="0"/><Setter Property="Cursor" Value="Hand"/>
            <Setter Property="Template"><Setter.Value><ControlTemplate TargetType="Button">
                <Border x:Name="b" CornerRadius="8" Padding="{TemplateBinding Padding}">
                    <Border.Background><LinearGradientBrush StartPoint="0,0" EndPoint="1,0">
                        <GradientStop Color="#4f9cf9" Offset="0"/><GradientStop Color="#7c5cfc" Offset="1"/>
                    </LinearGradientBrush></Border.Background>
                    <Border.Effect><DropShadowEffect Color="#4f9cf9" BlurRadius="12" Opacity="0.3" ShadowDepth="0"/></Border.Effect>
                    <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
                </Border>
                <ControlTemplate.Triggers>
                    <Trigger Property="IsEnabled" Value="False"><Setter TargetName="b" Property="Opacity" Value="0.4"/></Trigger>
                </ControlTemplate.Triggers>
            </ControlTemplate></Setter.Value></Setter>
        </Style>
        <Style x:Key="BtnS" TargetType="Button">
            <Setter Property="Foreground" Value="#94a3b8"/><Setter Property="FontSize" Value="14"/>
            <Setter Property="FontWeight" Value="SemiBold"/><Setter Property="Padding" Value="28,10"/>
            <Setter Property="BorderThickness" Value="0"/><Setter Property="Cursor" Value="Hand"/>
            <Setter Property="Template"><Setter.Value><ControlTemplate TargetType="Button">
                <Border x:Name="b" CornerRadius="8" Background="#151c30" BorderBrush="#2a3050" BorderThickness="1" Padding="{TemplateBinding Padding}">
                    <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
                </Border>
            </ControlTemplate></Setter.Value></Setter>
        </Style>
        <Style x:Key="BtnG" TargetType="Button">
            <Setter Property="Foreground" Value="White"/><Setter Property="FontSize" Value="14"/>
            <Setter Property="FontWeight" Value="SemiBold"/><Setter Property="Padding" Value="28,10"/>
            <Setter Property="BorderThickness" Value="0"/><Setter Property="Cursor" Value="Hand"/>
            <Setter Property="Template"><Setter.Value><ControlTemplate TargetType="Button">
                <Border x:Name="b" CornerRadius="8" Padding="{TemplateBinding Padding}">
                    <Border.Background><LinearGradientBrush StartPoint="0,0" EndPoint="1,0">
                        <GradientStop Color="#34d399" Offset="0"/><GradientStop Color="#22d3ee" Offset="1"/>
                    </LinearGradientBrush></Border.Background>
                    <Border.Effect><DropShadowEffect Color="#34d399" BlurRadius="12" Opacity="0.3" ShadowDepth="0"/></Border.Effect>
                    <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
                </Border>
            </ControlTemplate></Setter.Value></Setter>
        </Style>
        <Style x:Key="BtnR" TargetType="Button">
            <Setter Property="Foreground" Value="White"/><Setter Property="FontSize" Value="13"/>
            <Setter Property="FontWeight" Value="SemiBold"/><Setter Property="Padding" Value="20,8"/>
            <Setter Property="BorderThickness" Value="0"/><Setter Property="Cursor" Value="Hand"/>
            <Setter Property="Template"><Setter.Value><ControlTemplate TargetType="Button">
                <Border x:Name="b" CornerRadius="8" Background="#dc2626" Padding="{TemplateBinding Padding}">
                    <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
                </Border>
            </ControlTemplate></Setter.Value></Setter>
        </Style>
        <Style x:Key="Card" TargetType="Border">
            <Setter Property="CornerRadius" Value="12"/><Setter Property="Padding" Value="16"/>
            <Setter Property="BorderBrush" Value="#2a3050"/><Setter Property="BorderThickness" Value="1"/>
            <Setter Property="Background" Value="#12182b"/>
            <Setter Property="Effect"><Setter.Value><DropShadowEffect Color="Black" BlurRadius="16" Opacity="0.2" ShadowDepth="2"/></Setter.Value></Setter>
        </Style>
        <Style x:Key="MR" TargetType="RadioButton">
            <Setter Property="Template"><Setter.Value><ControlTemplate TargetType="RadioButton">
                <Border x:Name="b" CornerRadius="12" Padding="20" BorderBrush="#2a3050" BorderThickness="2" Cursor="Hand" Margin="0,0,8,0">
                    <Border.Background><LinearGradientBrush StartPoint="0,0" EndPoint="1,1">
                        <GradientStop Color="#12182b" Offset="0"/><GradientStop Color="#1a2040" Offset="1"/>
                    </LinearGradientBrush></Border.Background>
                    <ContentPresenter/>
                </Border>
                <ControlTemplate.Triggers>
                    <Trigger Property="IsChecked" Value="True">
                        <Setter TargetName="b" Property="BorderBrush" Value="#4f9cf9"/>
                    </Trigger>
                </ControlTemplate.Triggers>
            </ControlTemplate></Setter.Value></Setter>
        </Style>
        <Style x:Key="TB" TargetType="TextBox">
            <Setter Property="Background" Value="#0d1225"/><Setter Property="Foreground" Value="White"/>
            <Setter Property="FontSize" Value="14"/><Setter Property="Padding" Value="12,10"/>
            <Setter Property="BorderBrush" Value="#2a3050"/><Setter Property="BorderThickness" Value="1"/>
            <Setter Property="CaretBrush" Value="White"/>
            <Setter Property="Template"><Setter.Value><ControlTemplate TargetType="TextBox">
                <Border x:Name="b" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="{TemplateBinding BorderThickness}" CornerRadius="8" Padding="{TemplateBinding Padding}">
                    <ScrollViewer x:Name="PART_ContentHost"/>
                </Border>
                <ControlTemplate.Triggers>
                    <Trigger Property="IsFocused" Value="True"><Setter TargetName="b" Property="BorderBrush" Value="#4f9cf9"/></Trigger>
                </ControlTemplate.Triggers>
            </ControlTemplate></Setter.Value></Setter>
        </Style>
    </Window.Resources>
    <Grid>
        <Grid.ColumnDefinitions><ColumnDefinition Width="210"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>
        <Border Grid.Column="0" BorderBrush="#1a2035" BorderThickness="0,0,1,0">
            <Border.Background><LinearGradientBrush StartPoint="0,0" EndPoint="0,1">
                <GradientStop Color="#0a0f1f" Offset="0"/><GradientStop Color="#0d1428" Offset="1"/>
            </LinearGradientBrush></Border.Background>
            <StackPanel Margin="16,24,16,0">
                <TextBlock Text="&#x26A1;" FontSize="36" HorizontalAlignment="Center" Margin="0,0,0,2"/>
                <TextBlock x:Name="TitleText" Text="EPM Setup" FontSize="16" FontWeight="Bold" Foreground="#4f9cf9" HorizontalAlignment="Center"/>
                <TextBlock Text="v3.0" FontSize="10" Foreground="#475569" HorizontalAlignment="Center" Margin="0,2,0,20"/>
                <Button x:Name="LangBtn" Content="EN" FontSize="11" Padding="12,4" HorizontalAlignment="Center" Margin="0,0,0,20" Style="{StaticResource BtnS}"/>
                <StackPanel x:Name="StepsPanel">
                    <StackPanel Orientation="Horizontal" Margin="8,0,0,0"><Border Width="28" Height="28" CornerRadius="14" Background="#4f9cf9" Margin="0,0,10,0" x:Name="S1C"><TextBlock Text="1" Foreground="White" FontSize="12" FontWeight="SemiBold" HorizontalAlignment="Center" VerticalAlignment="Center" x:Name="S1T"/></Border><TextBlock x:Name="S1L" Text="Welcome" Foreground="White" FontSize="12" VerticalAlignment="Center"/></StackPanel>
                    <Border Width="2" Height="18" Background="#2a3050" HorizontalAlignment="Left" Margin="21,0,0,0" x:Name="C1"/>
                    <StackPanel Orientation="Horizontal" Margin="8,0,0,0"><Border Width="28" Height="28" CornerRadius="14" BorderBrush="#475569" BorderThickness="2" Margin="0,0,10,0" x:Name="S2C"><TextBlock Text="2" Foreground="#475569" FontSize="12" FontWeight="SemiBold" HorizontalAlignment="Center" VerticalAlignment="Center" x:Name="S2T"/></Border><TextBlock x:Name="S2L" Text="Mode" Foreground="#475569" FontSize="12" VerticalAlignment="Center"/></StackPanel>
                    <Border Width="2" Height="18" Background="#2a3050" HorizontalAlignment="Left" Margin="21,0,0,0" x:Name="C2"/>
                    <StackPanel Orientation="Horizontal" Margin="8,0,0,0"><Border Width="28" Height="28" CornerRadius="14" BorderBrush="#475569" BorderThickness="2" Margin="0,0,10,0" x:Name="S3C"><TextBlock Text="3" Foreground="#475569" FontSize="12" FontWeight="SemiBold" HorizontalAlignment="Center" VerticalAlignment="Center" x:Name="S3T"/></Border><TextBlock x:Name="S3L" Text="Settings" Foreground="#475569" FontSize="12" VerticalAlignment="Center"/></StackPanel>
                    <Border Width="2" Height="18" Background="#2a3050" HorizontalAlignment="Left" Margin="21,0,0,0" x:Name="C3"/>
                    <StackPanel Orientation="Horizontal" Margin="8,0,0,0"><Border Width="28" Height="28" CornerRadius="14" BorderBrush="#475569" BorderThickness="2" Margin="0,0,10,0" x:Name="S4C"><TextBlock Text="4" Foreground="#475569" FontSize="12" FontWeight="SemiBold" HorizontalAlignment="Center" VerticalAlignment="Center" x:Name="S4T"/></Border><TextBlock x:Name="S4L" Text="Install" Foreground="#475569" FontSize="12" VerticalAlignment="Center"/></StackPanel>
                    <Border Width="2" Height="18" Background="#2a3050" HorizontalAlignment="Left" Margin="21,0,0,0" x:Name="C4"/>
                    <StackPanel Orientation="Horizontal" Margin="8,0,0,0"><Border Width="28" Height="28" CornerRadius="14" BorderBrush="#475569" BorderThickness="2" Margin="0,0,10,0" x:Name="S5C"><TextBlock Text="5" Foreground="#475569" FontSize="12" FontWeight="SemiBold" HorizontalAlignment="Center" VerticalAlignment="Center" x:Name="S5T"/></Border><TextBlock x:Name="S5L" Text="Done" Foreground="#475569" FontSize="12" VerticalAlignment="Center"/></StackPanel>
                </StackPanel>
            </StackPanel>
        </Border>
        <Grid Grid.Column="1"><Grid.RowDefinitions><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
            <StackPanel x:Name="Page0" Grid.Row="0" Margin="32,28,32,12" Visibility="Visible">
                <TextBlock x:Name="P0Title" Text="EPM Setup Wizard" FontSize="26" FontWeight="Bold" Margin="0,0,0,4"/>
                <TextBlock x:Name="P0Desc" Text="Setup wizard" FontSize="14" Foreground="#94a3b8" Margin="0,0,0,20"/>
                <UniformGrid Columns="2" Margin="0,0,0,16">
                    <Border Style="{StaticResource Card}" Margin="0,0,6,6"><StackPanel Orientation="Horizontal"><TextBlock Text="&#x1F4CA;" FontSize="22" Margin="0,0,10,0" VerticalAlignment="Top"/><StackPanel><TextBlock Text="Monitoring" FontWeight="SemiBold" FontSize="13"/><TextBlock Text="CPU, Memory, Process" FontSize="11" Foreground="#64748b"/></StackPanel></StackPanel></Border>
                    <Border Style="{StaticResource Card}" Margin="6,0,0,6"><StackPanel Orientation="Horizontal"><TextBlock Text="&#x1F4FA;" FontSize="22" Margin="0,0,10,0" VerticalAlignment="Top"/><StackPanel><TextBlock Text="Streaming" FontWeight="SemiBold" FontSize="13"/><TextBlock Text="Screen sharing" FontSize="11" Foreground="#64748b"/></StackPanel></StackPanel></Border>
                    <Border Style="{StaticResource Card}" Margin="0,0,6,0"><StackPanel Orientation="Horizontal"><TextBlock Text="&#x1F512;" FontSize="22" Margin="0,0,10,0" VerticalAlignment="Top"/><StackPanel><TextBlock Text="Security" FontWeight="SemiBold" FontSize="13"/><TextBlock Text="Block apps, USB control" FontSize="11" Foreground="#64748b"/></StackPanel></StackPanel></Border>
                    <Border Style="{StaticResource Card}" Margin="6,0,0,0"><StackPanel Orientation="Horizontal"><TextBlock Text="&#x1F680;" FontSize="22" Margin="0,0,10,0" VerticalAlignment="Top"/><StackPanel><TextBlock Text="Remote" FontWeight="SemiBold" FontSize="13"/><TextBlock Text="Shutdown, Lock, Message" FontSize="11" Foreground="#64748b"/></StackPanel></StackPanel></Border>
                </UniformGrid>
                <Border Style="{StaticResource Card}"><TextBlock x:Name="SysInfo" FontSize="11" Foreground="#64748b" TextWrapping="Wrap"/></Border>
            </StackPanel>
            <StackPanel x:Name="Page1" Grid.Row="0" Margin="32,28,32,12" Visibility="Collapsed">
                <TextBlock x:Name="P1Title" Text="Select Mode" FontSize="26" FontWeight="Bold" Margin="0,0,0,4"/>
                <TextBlock x:Name="P1Desc" Text="Choose role" FontSize="14" Foreground="#94a3b8" Margin="0,0,0,20"/>
                <UniformGrid Columns="2">
                    <RadioButton x:Name="ModeT" Style="{StaticResource MR}" IsChecked="True" GroupName="M"><StackPanel HorizontalAlignment="Center"><TextBlock Text="&#x1F468;&#x200D;&#x1F3EB;" FontSize="38" HorizontalAlignment="Center" Margin="0,0,0,6"/><TextBlock x:Name="MTLabel" Text="Teacher PC" FontSize="15" FontWeight="Bold" HorizontalAlignment="Center" Margin="0,0,0,4"/><TextBlock x:Name="MTDesc" TextWrapping="Wrap" TextAlignment="Center" FontSize="11" Foreground="#94a3b8" Width="170" Text="Install server"/></StackPanel></RadioButton>
                    <RadioButton x:Name="ModeS" Style="{StaticResource MR}" GroupName="M"><StackPanel HorizontalAlignment="Center"><TextBlock Text="&#x1F468;&#x200D;&#x1F393;" FontSize="38" HorizontalAlignment="Center" Margin="0,0,0,6"/><TextBlock x:Name="MSLabel" Text="Student PC" FontSize="15" FontWeight="Bold" HorizontalAlignment="Center" Margin="0,0,0,4"/><TextBlock x:Name="MSDesc" TextWrapping="Wrap" TextAlignment="Center" FontSize="11" Foreground="#94a3b8" Width="170" Text="Configure remote"/></StackPanel></RadioButton>
                </UniformGrid>
            </StackPanel>
            <StackPanel x:Name="Page2" Grid.Row="0" Margin="32,28,32,12" Visibility="Collapsed">
                <TextBlock x:Name="P2Title" Text="Settings" FontSize="26" FontWeight="Bold" Margin="0,0,0,4"/>
                <TextBlock x:Name="P2Desc" Text="Enter info" FontSize="14" Foreground="#94a3b8" Margin="0,0,0,20"/>
                <TextBlock x:Name="P2SrvLbl" Text="Server Address" FontSize="13" FontWeight="SemiBold" Margin="0,0,0,8"/>
                <TextBox x:Name="SrvUrl" Style="{StaticResource TB}" Text="http://localhost:3001" Margin="0,0,0,4"/>
                <TextBlock x:Name="P2SrvHint" Text="hint" FontSize="10" Foreground="#475569" Margin="2,0,0,20"/>
                <Border Style="{StaticResource Card}" Margin="0,8,0,0"><StackPanel><TextBlock x:Name="P2SumLbl" Text="Summary" FontSize="13" FontWeight="SemiBold" Foreground="#4f9cf9" Margin="0,0,0,10"/><TextBlock x:Name="SumText" FontSize="12" Foreground="#94a3b8" LineHeight="22"/></StackPanel></Border>
            </StackPanel>
            <StackPanel x:Name="Page3" Grid.Row="0" Margin="32,28,32,12" Visibility="Collapsed">
                <TextBlock x:Name="P3Title" Text="Installing..." FontSize="26" FontWeight="Bold" Margin="0,0,0,4"/>
                <TextBlock x:Name="P3Desc" Text="Configuring..." FontSize="14" Foreground="#94a3b8" Margin="0,0,0,16"/>
                <Border Background="#151c30" CornerRadius="6" Height="10" Margin="0,0,0,6"><Border x:Name="PBar" CornerRadius="6" HorizontalAlignment="Left" Width="0"><Border.Background><LinearGradientBrush StartPoint="0,0" EndPoint="1,0"><GradientStop Color="#4f9cf9" Offset="0"/><GradientStop Color="#7c5cfc" Offset="1"/></LinearGradientBrush></Border.Background></Border></Border>
                <TextBlock x:Name="PPct" Text="0%" FontSize="11" Foreground="#94a3b8" HorizontalAlignment="Right" Margin="0,0,0,12"/>
                <ScrollViewer MaxHeight="180" VerticalScrollBarVisibility="Auto" Margin="0,0,0,10"><StackPanel x:Name="StepList"/></ScrollViewer>
                <Border Background="#0d1225" CornerRadius="8" BorderBrush="#1a2035" BorderThickness="1"><StackPanel><Border Background="#080c18" CornerRadius="8,8,0,0" Padding="10,6"><TextBlock x:Name="P3LogLbl" Text="Log" FontSize="11" Foreground="#475569"/></Border><ScrollViewer x:Name="LogScr" MaxHeight="80" VerticalScrollBarVisibility="Auto" Padding="10,6"><TextBlock x:Name="LogTxt" FontSize="10" Foreground="#475569" FontFamily="Consolas" TextWrapping="Wrap"/></ScrollViewer></StackPanel></Border>
            </StackPanel>
            <StackPanel x:Name="Page4" Grid.Row="0" Margin="32,28,32,12" Visibility="Collapsed" VerticalAlignment="Center" HorizontalAlignment="Center">
                <TextBlock x:Name="DoneIcon" Text="&#x1F389;" FontSize="56" HorizontalAlignment="Center" Margin="0,0,0,12"/>
                <TextBlock x:Name="P4Title" Text="Done!" FontSize="26" FontWeight="Bold" HorizontalAlignment="Center" Margin="0,0,0,4"/>
                <TextBlock x:Name="P4Desc" Text="Success" FontSize="14" Foreground="#94a3b8" HorizontalAlignment="Center" Margin="0,0,0,20"/>
                <Border Style="{StaticResource Card}" MinWidth="380"><StackPanel x:Name="DoneInfo"/></Border>
            </StackPanel>
            <Border Grid.Row="1" BorderBrush="#1a2035" BorderThickness="0,1,0,0" Padding="32,10,32,16">
                <Grid><Grid.ColumnDefinitions><ColumnDefinition Width="Auto"/><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
                    <Button x:Name="BPrev" Content="Back" Style="{StaticResource BtnS}" Grid.Column="0" Visibility="Hidden"/>
                    <Button x:Name="BUninstall" Content="Uninstall" Style="{StaticResource BtnR}" Grid.Column="2" Visibility="Collapsed" Margin="0,0,8,0"/>
                    <Button x:Name="BNext" Content="Next" Style="{StaticResource BtnP}" Grid.Column="3"/>
                </Grid>
            </Border>
        </Grid>
    </Grid>
</Window>
'@


$R = [System.Xml.XmlNodeReader]::new($XAML); $W = [Windows.Markup.XamlReader]::Load($R)
$Pages = @($W.FindName('Page0'),$W.FindName('Page1'),$W.FindName('Page2'),$W.FindName('Page3'),$W.FindName('Page4'))
$BPrev=$W.FindName('BPrev'); $BNext=$W.FindName('BNext'); $BUninst=$W.FindName('BUninstall')
$ModeT=$W.FindName('ModeT'); $SrvUrl=$W.FindName('SrvUrl'); $SumText=$W.FindName('SumText')
$PBar=$W.FindName('PBar'); $PPct=$W.FindName('PPct'); $P3Desc=$W.FindName('P3Desc')
$StepList=$W.FindName('StepList'); $LogTxt=$W.FindName('LogTxt'); $LogScr=$W.FindName('LogScr')
$LangBtn=$W.FindName('LangBtn')

$SC=@($W.FindName('S1C'),$W.FindName('S2C'),$W.FindName('S3C'),$W.FindName('S4C'),$W.FindName('S5C'))
$ST=@($W.FindName('S1T'),$W.FindName('S2T'),$W.FindName('S3T'),$W.FindName('S4T'),$W.FindName('S5T'))
$SL=@($W.FindName('S1L'),$W.FindName('S2L'),$W.FindName('S3L'),$W.FindName('S4L'),$W.FindName('S5L'))
$CN=@($W.FindName('C1'),$W.FindName('C2'),$W.FindName('C3'),$W.FindName('C4'))

$Script:Step = 0
$BC = [System.Windows.Media.BrushConverter]::new()

# System info
$lip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.*' } | Select-Object -First 1).IPAddress
if (-not $lip) { $lip = 'N/A' }
$mem = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
$W.FindName('SysInfo').Text = "PC: $env:COMPUTERNAME  |  IP: $lip  |  OS: Win $([Environment]::OSVersion.Version)  |  RAM: ${mem}GB  |  Admin: OK"

# Logging
function Write-Log([string]$m) {
    $ts = Get-Date -Format 'HH:mm:ss'
    $line = "[$ts] $m"
    Add-Content -Path $LogFile -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
    $LogTxt.Text += "$line`n"
    $LogScr.ScrollToEnd()
    [System.Windows.Forms.Application]::DoEvents()
}

# Update UI text for language
function Update-Lang {
    $SL[0].Text = Get-Text 'Step1'; $SL[1].Text = Get-Text 'Step2'; $SL[2].Text = Get-Text 'Step3'
    $SL[3].Text = Get-Text 'Step4'; $SL[4].Text = Get-Text 'Step5'
    $W.FindName('P0Title').Text = Get-Text 'WelcomeTitle'; $W.FindName('P0Desc').Text = Get-Text 'WelcomeDesc'
    $W.FindName('P1Title').Text = Get-Text 'ModeTitle'; $W.FindName('P1Desc').Text = Get-Text 'ModeDesc'
    $W.FindName('MTLabel').Text = Get-Text 'TeacherPC'; $W.FindName('MSLabel').Text = Get-Text 'StudentPC'
    $W.FindName('MTDesc').Text = Get-Text 'TeacherDesc'; $W.FindName('MSDesc').Text = Get-Text 'StudentDesc'
    $W.FindName('P2Title').Text = Get-Text 'SettTitle'; $W.FindName('P2Desc').Text = Get-Text 'SettDesc'
    $W.FindName('P2SrvLbl').Text = Get-Text 'ServerLabel'; $W.FindName('P2SrvHint').Text = Get-Text 'ServerHint'
    $W.FindName('P2SumLbl').Text = Get-Text 'SummaryLabel'
    $W.FindName('P3LogLbl').Text = Get-Text 'LogTitle'
    $LangBtn.Content = Get-Text 'LangBtn'
    $BUninst.Content = Get-Text 'BtnUninstall'
}

function Set-Step([int]$s) {
    for ($i=0;$i -lt $Pages.Count;$i++) { if ($i -eq $s) { $Pages[$i].Visibility='Visible' } else { $Pages[$i].Visibility='Collapsed' } }
    for ($i=0;$i -lt $SC.Count;$i++) {
        if ($i -lt $s) { $SC[$i].Background=$BC.ConvertFromString('#34d399'); $SC[$i].BorderBrush=$BC.ConvertFromString('#34d399'); $ST[$i].Foreground=$BC.ConvertFromString('White'); $SL[$i].Foreground=$BC.ConvertFromString('#34d399') }
        elseif ($i -eq $s) { $SC[$i].Background=$BC.ConvertFromString('#4f9cf9'); $SC[$i].BorderBrush=$BC.ConvertFromString('#4f9cf9'); $ST[$i].Foreground=$BC.ConvertFromString('White'); $SL[$i].Foreground=$BC.ConvertFromString('White') }
        else { $SC[$i].Background=[System.Windows.Media.Brushes]::Transparent; $SC[$i].BorderBrush=$BC.ConvertFromString('#475569'); $ST[$i].Foreground=$BC.ConvertFromString('#475569'); $SL[$i].Foreground=$BC.ConvertFromString('#475569') }
    }
    for ($i=0;$i -lt $CN.Count;$i++) { if ($i -lt $s) { $CN[$i].Background=$BC.ConvertFromString('#34d399') } else { $CN[$i].Background=$BC.ConvertFromString('#2a3050') } }
    if ($s -eq 0) { $BPrev.Visibility='Hidden' } else { $BPrev.Visibility='Visible' }
    $BUninst.Visibility = 'Collapsed'
    switch ($s) {
        0 { $BNext.Content = Get-Text 'BtnNext'; $BNext.Style=$W.FindResource('BtnP'); $BNext.Visibility='Visible'; $BUninst.Visibility='Visible' }
        2 { $BNext.Content = Get-Text 'BtnInstall'; $BNext.Style=$W.FindResource('BtnP'); $BNext.Visibility='Visible'; Update-Summary }
        3 { $BNext.Visibility='Collapsed'; $BPrev.Visibility='Collapsed' }
        4 { $BNext.Content = Get-Text 'BtnFinish'; $BNext.Style=$W.FindResource('BtnG'); $BNext.Visibility='Visible'; $BPrev.Visibility='Collapsed' }
        default { $BNext.Content = Get-Text 'BtnNext'; $BNext.Style=$W.FindResource('BtnP'); $BNext.Visibility='Visible' }
    }
    $Script:Step = $s
}

function Update-Summary {
    if ($ModeT.IsChecked) { $m = Get-Text 'TeacherPC'; $it = Get-Text 'TeacherItems' }
    else { $m = Get-Text 'StudentPC'; $it = Get-Text 'StudentItems' }
    $u = $SrvUrl.Text
    $SumText.Text = ((Get-Text 'ModeLabel') + ": $m`n" + (Get-Text 'ServerLabel') + ": $u`n" + (Get-Text 'ItemsLabel') + ": $it")
}

function Start-Install {
    Set-Step 3
    $isT = $ModeT.IsChecked; $url = $SrvUrl.Text
    Write-Log ('=== EPM Setup Start === Mode: ' + $(if($isT){'Teacher'}else{'Student'}) + ' ===')
    $steps = @()
    if ($isT) {
        $steps += @{L='Node.js';A={$v=cmd /c 'node --version' 2>&1; if($v -match 'v\d'){Write-Log "Node.js $v OK"}else{Write-Log 'Node.js not found - please install Node.js first';return 'err'}}}
        $steps += @{L='Clean processes';A={Get-Process -Name 'node' -ErrorAction SilentlyContinue|Stop-Process -Force -ErrorAction SilentlyContinue; Write-Log 'Processes cleaned'}}
        $steps += @{L='npm install';A={$bp=Join-Path $ProjectRoot 'dashboard\backend'; $pj=Join-Path $bp 'package.json'; if(Test-Path $pj){Write-Log "Running npm install in $bp"; $r=cmd /c "cd /d `"$bp`" && npm install 2>&1"; $nm=Join-Path $bp 'node_modules'; if(Test-Path $nm){Write-Log 'npm install OK'}else{Write-Log "npm install failed: $r"; return 'err'}}else{Write-Log "No package.json at $pj";return 'err'}}}
        $steps += @{L='WinRM';A={try{Enable-PSRemoting -Force -SkipNetworkProfileCheck -ErrorAction Stop 2>$null}catch{Write-Log "PSRemoting: $($_.Exception.Message)"}; Set-Service WinRM -StartupType Automatic -ErrorAction SilentlyContinue; Start-Service WinRM -ErrorAction SilentlyContinue; Write-Log 'WinRM OK'}}
        $steps += @{L='TrustedHosts';A={try{Set-Item WSMan:\localhost\Client\TrustedHosts -Value '*' -Force -ErrorAction Stop;Write-Log 'TrustedHosts OK'}catch{Write-Log "TH: $($_.Exception.Message)";return 'err'}}}
        $steps += @{L='Firewall';A={if(-not(Get-NetFirewallRule -Name 'EPM-Dashboard' -ErrorAction SilentlyContinue)){New-NetFirewallRule -Name 'EPM-Dashboard' -DisplayName 'EPM Dashboard' -Protocol TCP -LocalPort 3001 -Direction Inbound -Action Allow -Profile Any -ErrorAction Stop|Out-Null};if(-not(Get-NetFirewallRule -Name 'EPM-WinRM-HTTP' -ErrorAction SilentlyContinue)){New-NetFirewallRule -Name 'EPM-WinRM-HTTP' -DisplayName 'WinRM HTTP' -Protocol TCP -LocalPort 5985 -Direction Inbound -Action Allow -Profile Any -ErrorAction Stop|Out-Null};Write-Log 'Firewall OK'}}
        $steps += @{L='Server start';A={$bp=Join-Path $ProjectRoot 'dashboard\backend';$sj=Join-Path $bp 'server.js';$nm=Join-Path $bp 'node_modules';if(-not(Test-Path $nm)){Write-Log 'node_modules missing - run npm install first';return 'err'};if(Test-Path $sj){Start-Process cmd -ArgumentList '/k',"cd /d `"$bp`" && node server.js" -WindowStyle Normal;Write-Log 'Waiting for server...';for($w=0;$w -lt 10;$w++){Start-Sleep 1;[System.Windows.Forms.Application]::DoEvents();try{Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop|Out-Null;Write-Log 'Server is running!';break}catch{if($w -eq 9){Write-Log 'Server may still be starting'}}}}else{Write-Log "No server.js at $sj";return 'err'}}}
        $steps += @{L='Auto-start';A={$startup=[Environment]::GetFolderPath('Startup');$bat=Join-Path $startup 'EPM-Dashboard.bat';$bp=Join-Path $ProjectRoot 'dashboard\backend';$content="@echo off`r`ntitle EPM Dashboard Server`r`ncd /d `"$bp`"`r`nnode server.js";Set-Content -Path $bat -Value $content -Encoding ASCII -Force;if(Test-Path $bat){Write-Log "Auto-start registered: $bat"}else{Write-Log 'Auto-start registration failed';return 'err'}}}
        $steps += @{L='Browser';A={Start-Process $url; Write-Log "Opened: $url"}}
    } else {
        $steps += @{L='WinRM service';A={Set-Service WinRM -StartupType Automatic -ErrorAction Stop;Start-Service WinRM -ErrorAction Stop;Write-Log 'WinRM OK'}}
        $steps += @{L='PSRemoting';A={try{Enable-PSRemoting -Force -SkipNetworkProfileCheck -ErrorAction Stop 2>$null;Write-Log 'PSRemoting OK'}catch{Write-Log "PR: $($_.Exception.Message)";return 'err'}}}
        $steps += @{L='Basic Auth';A={Set-Item WSMan:\localhost\Service\Auth\Basic -Value $true -Force -ErrorAction SilentlyContinue;Set-Item WSMan:\localhost\Client\Auth\Basic -Value $true -Force -ErrorAction SilentlyContinue;Write-Log 'Basic Auth OK'}}
        $steps += @{L='TrustedHosts';A={try{Set-Item WSMan:\localhost\Client\TrustedHosts -Value '*' -Force -ErrorAction Stop;Write-Log 'TH=*'}catch{Write-Log "TH: $($_.Exception.Message)";return 'err'}}}
        $steps += @{L='Firewall';A={Remove-NetFirewallRule -Name 'EPM-WinRM-*' -ErrorAction SilentlyContinue;New-NetFirewallRule -Name 'EPM-WinRM-HTTP' -DisplayName 'WinRM HTTP' -Direction Inbound -Protocol TCP -LocalPort 5985 -Action Allow -Profile Any -ErrorAction Stop|Out-Null;Write-Log 'Firewall OK'}}
        $steps += @{L='Registry';A={Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'LocalAccountTokenFilterPolicy' -Value 1 -Force -ErrorAction Stop;Write-Log 'Registry OK'}}
        $steps += @{L='Verify WinRM';A={Restart-Service WinRM -Force -ErrorAction SilentlyContinue;Start-Sleep 2;try{Test-WSMan localhost -ErrorAction Stop|Out-Null;Write-Log 'WinRM verified'}catch{Write-Log 'WinRM verify failed';return 'err'}}}
    }
    $tot=$steps.Count; $ok=0; $rows=@()
    foreach($s in $steps){$r=New-Object System.Windows.Controls.TextBlock;$r.FontSize=12;$r.Foreground=$BC.ConvertFromString('#475569');$r.Margin='0,3,0,0';$r.Text="  $($s.L)";$StepList.Children.Add($r);$rows+=$r}
    [System.Windows.Forms.Application]::DoEvents()
    for($i=0;$i -lt $tot;$i++){
        $pct=[math]::Floor(($i/$tot)*100); $PBar.Width=($pct/100)*530; $PPct.Text="$pct%"
        $P3Desc.Text="$($steps[$i].L)..."; $rows[$i].Text="  $($steps[$i].L)"; $rows[$i].Foreground=$BC.ConvertFromString('#fbbf24')
        [System.Windows.Forms.Application]::DoEvents()
        $err=$null
        try{$result=& $steps[$i].A; if($result -eq 'err'){$err='err'}}catch{Write-Log "Error: $($_.Exception.Message)";$err=$_.Exception.Message}
        if($err){$rows[$i].Text="  $($steps[$i].L)";$rows[$i].Foreground=$BC.ConvertFromString('#f87171')}
        else{$rows[$i].Text="  $($steps[$i].L)";$rows[$i].Foreground=$BC.ConvertFromString('#34d399');$ok++}
        [System.Windows.Forms.Application]::DoEvents()
    }
    $PBar.Width=530; $PPct.Text='100%'; $P3Desc.Text=(Get-Text 'DoneTitle')
    Write-Log "=== Complete: $ok/$tot ==="
    [System.Windows.Forms.Application]::DoEvents(); Start-Sleep 1
    # Sound effect
    [System.Media.SystemSounds]::Exclamation.Play()
    Show-Done $isT $url $ok $tot
}

function Show-Done([bool]$isT,[string]$url,[int]$ok,[int]$tot) {
    Set-Step 4
    $W.FindName('P4Title').Text = Get-Text 'DoneTitle'; $W.FindName('P4Desc').Text = Get-Text 'DoneDesc'
    $p=$W.FindName('DoneInfo'); $p.Children.Clear()
    if($isT){$ml=Get-Text 'TeacherPC'}else{$ml=Get-Text 'StudentPC'}
    $rows=@(@((Get-Text 'ModeLabel'),$ml),@((Get-Text 'CompLabel'),$env:COMPUTERNAME),@((Get-Text 'IPLabel'),$lip),@((Get-Text 'ItemsLabel'),"$ok / $tot"))
    if($isT){$rows+=,@((Get-Text 'DashLabel'),$url);$rows+=,@((Get-Text 'LoginLabel'),'admin / admin123')}
    foreach($r in $rows){
        $sp=New-Object System.Windows.Controls.StackPanel;$sp.Orientation='Horizontal';$sp.Margin='0,5,0,5'
        $l=New-Object System.Windows.Controls.TextBlock;$l.Text=$r[0];$l.Width=110;$l.FontSize=12;$l.Foreground=$BC.ConvertFromString('#64748b')
        $v=New-Object System.Windows.Controls.TextBlock;$v.Text=$r[1];$v.FontSize=12;$v.FontWeight='SemiBold';$v.Foreground=$BC.ConvertFromString('White')
        $sp.Children.Add($l)|Out-Null;$sp.Children.Add($v)|Out-Null;$p.Children.Add($sp)|Out-Null
    }
}

# Uninstall
function Start-Uninstall {
    $confirm = [System.Windows.MessageBox]::Show((Get-Text 'UninstDesc'), (Get-Text 'UninstTitle'), 'YesNo', 'Warning')
    if ($confirm -ne 'Yes') { return }
    Write-Log '=== Uninstall Start ==='
    try {
        Remove-NetFirewallRule -Name 'EPM-Dashboard' -ErrorAction SilentlyContinue; Write-Log 'Removed EPM-Dashboard rule'
        Remove-NetFirewallRule -Name 'EPM-WinRM-HTTP' -ErrorAction SilentlyContinue; Write-Log 'Removed WinRM rule'
        Set-Item WSMan:\localhost\Client\TrustedHosts -Value '' -Force -ErrorAction SilentlyContinue; Write-Log 'TrustedHosts cleared'
        Remove-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'LocalAccountTokenFilterPolicy' -Force -ErrorAction SilentlyContinue; Write-Log 'Registry cleaned'
        Get-Process -Name 'node' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Write-Log 'Node processes stopped'
    } catch { Write-Log "Uninstall error: $($_.Exception.Message)" }
    Write-Log '=== Uninstall Done ==='
    [System.Media.SystemSounds]::Asterisk.Play()
    [System.Windows.MessageBox]::Show((Get-Text 'UninstDone'), (Get-Text 'UninstTitle'), 'OK', 'Information')
}

# Events
$BNext.Add_Click({ if($Script:Step -eq 2){Start-Install}elseif($Script:Step -eq 4){$W.Close()}else{Set-Step($Script:Step+1)} })
$BPrev.Add_Click({ if($Script:Step -gt 0 -and $Script:Step -ne 3){Set-Step($Script:Step-1)} })
$BUninst.Add_Click({ Start-Uninstall })
$LangBtn.Add_Click({ if($Script:Lang -eq 'ko'){$Script:Lang='en'}else{$Script:Lang='ko'}; Update-Lang; Set-Step $Script:Step })

Update-Lang; Set-Step 0; $W.ShowDialog() | Out-Null
