// scripts/bundle-agent.js
// Creates a portable agent bundle (zip) with node.exe + agent code + node_modules.
// The bundle deploys to student PCs without requiring a Node.js installation.
// All exec calls use hardcoded paths only — no user input is interpolated.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const AGENT_DIR = path.join(__dirname, '..', '..', 'agent');
const BUNDLE_DIR = path.join(__dirname, '..', 'deploy-bundle');
const BUNDLE_ZIP = path.join(BUNDLE_DIR, 'agent-bundle.zip');
const NODE_EXE = process.execPath;

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyDirSync(src, dest) {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDirSync(srcPath, destPath);
        else fs.copyFileSync(srcPath, destPath);
    }
}

function bundle() {
    console.log('[Bundle] Starting agent bundle creation...');

    const staging = path.join(BUNDLE_DIR, 'staging');
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    ensureDir(staging);

    // 1. Copy node.exe
    const sizeMB = (fs.statSync(NODE_EXE).size / 1024 / 1024).toFixed(1);
    console.log(`[Bundle] Copying node.exe (${sizeMB}MB)...`);
    fs.copyFileSync(NODE_EXE, path.join(staging, 'node.exe'));

    // 2. Copy agent source files
    for (const file of ['agent.js', 'package.json']) {
        const src = path.join(AGENT_DIR, file);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(staging, file));
            console.log(`[Bundle] Copied ${file}`);
        }
    }

    // 3. Copy node_modules (pre-installed)
    const nmSrc = path.join(AGENT_DIR, 'node_modules');
    if (fs.existsSync(nmSrc)) {
        console.log('[Bundle] Copying node_modules...');
        copyDirSync(nmSrc, path.join(staging, 'node_modules'));
    }

    // 4. Create start.bat launcher
    fs.writeFileSync(path.join(staging, 'start.bat'), [
        '@echo off',
        'cd /d "%~dp0"',
        'if not "%~1"=="" set SERVER_URL=%~1',
        'if "%SERVER_URL%"=="" set SERVER_URL=http://localhost:3001',
        '"%~dp0node.exe" "%~dp0agent.js"',
    ].join('\r\n') + '\r\n');

    // 5. Create install-service.bat (registers auto-start + runs agent)
    fs.writeFileSync(path.join(staging, 'install-service.bat'), [
        '@echo off',
        'chcp 65001 >nul',
        'if not "%~1"=="" set SERVER_URL=%~1',
        'if "%SERVER_URL%"=="" set SERVER_URL=http://localhost:3001',
        '',
        ':: Save server URL',
        'echo SERVER_URL=%SERVER_URL%> "%~dp0.env"',
        '',
        ':: Kill existing agent',
        'taskkill /FI "WINDOWTITLE eq PCAgent" /F >nul 2>&1',
        '',
        ':: Register scheduled task (runs on logon, auto-restart)',
        'schtasks /delete /tn "PCAgent" /f >nul 2>&1',
        'schtasks /create /tn "PCAgent" /tr "cmd /c cd /d %~dp0 ^& set SERVER_URL=%SERVER_URL% ^& node.exe agent.js" /sc onlogon /rl highest /f >nul 2>&1',
        'if %errorlevel% equ 0 (',
        '    echo [OK] Scheduled task registered',
        ') else (',
        '    echo [WARN] Using startup folder fallback',
        '    copy /y "%~dp0start.bat" "%ALLUSERSPROFILE%\\Microsoft\\Windows\\Start Menu\\Programs\\StartUp\\PCAgent.bat" >nul',
        ')',
        '',
        ':: Start agent now (minimized window)',
        'start "PCAgent" /min cmd /c "cd /d %~dp0 ^& set SERVER_URL=%SERVER_URL% ^& node.exe agent.js"',
        'echo [OK] Agent started. Server: %SERVER_URL%',
    ].join('\r\n') + '\r\n');

    // 6. Create uninstall.bat
    fs.writeFileSync(path.join(staging, 'uninstall.bat'), [
        '@echo off',
        'chcp 65001 >nul',
        'taskkill /FI "WINDOWTITLE eq PCAgent" /F >nul 2>&1',
        'schtasks /delete /tn "PCAgent" /f >nul 2>&1',
        'del "%ALLUSERSPROFILE%\\Microsoft\\Windows\\Start Menu\\Programs\\StartUp\\PCAgent.bat" >nul 2>&1',
        'echo [OK] Agent stopped and unregistered',
    ].join('\r\n') + '\r\n');

    // 7. Zip using PowerShell (no user input in paths)
    if (fs.existsSync(BUNDLE_ZIP)) fs.unlinkSync(BUNDLE_ZIP);
    console.log('[Bundle] Creating zip...');
    const stagingWin = staging.replace(/\//g, '\\');
    const zipWin = BUNDLE_ZIP.replace(/\//g, '\\');
    execFileSync('powershell.exe', [
        '-NoProfile', '-Command',
        `Compress-Archive -Path '${stagingWin}\\*' -DestinationPath '${zipWin}' -Force`
    ]);

    // 8. Clean staging
    fs.rmSync(staging, { recursive: true, force: true });

    const zipMB = (fs.statSync(BUNDLE_ZIP).size / 1024 / 1024).toFixed(1);
    console.log(`[Bundle] Done! ${BUNDLE_ZIP} (${zipMB}MB)`);
    return BUNDLE_ZIP;
}

if (require.main === module) {
    bundle();
} else {
    module.exports = { bundle, BUNDLE_ZIP, BUNDLE_DIR };
}
