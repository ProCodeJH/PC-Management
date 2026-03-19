// routes/deploy.js
// Deploy and OneClick setup routes — deploys full Node.js agent bundle to student PCs
const express = require('express');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { isValidIP, sanitizeForPS } = require('../utils/helpers');

// Agent bundle (created by: node scripts/bundle-agent.js)
const BUNDLE_ZIP = path.join(__dirname, '..', 'deploy-bundle', 'agent-bundle.zip');

module.exports = function ({ db, io, exec, authenticateToken, requireRole, encryptPassword, decryptPassword, PORT }) {
    const router = express.Router();

    // Helper: detect local subnet
    function detectSubnet() {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    const parts = iface.address.split('.');
                    if (parts.length === 4) return parts.slice(0, 3).join('.');
                }
            }
        }
        return '192.168.0';
    }

    function detectDashboardHost(requestHost) {
        if (requestHost && !['localhost', '127.0.0.1', '::1'].includes(requestHost)) {
            return requestHost;
        }

        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }

        return requestHost || 'localhost';
    }

    function execPowerShell(script, options = {}, callback) {
        const wrappedScript = `
            [Console]::InputEncoding = [System.Text.Encoding]::UTF8
            [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
            $OutputEncoding = [System.Text.Encoding]::UTF8
            ${script}
        `;
        const encoded = Buffer.from(wrappedScript, 'utf16le').toString('base64');
        exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, options, callback);
    }

    // Helper: execute remote PS with credentials
    function remoteExec(targetIP, username, password, scriptBlock, timeout = 60000) {
        return new Promise((resolve) => {
            const escapedPassword = password.replace(/'/g, "''").replace(/\$/g, '`$');
            const script = `
                $ErrorActionPreference = 'Continue'
                try {
                    $secPass = ConvertTo-SecureString '${escapedPassword}' -AsPlainText -Force
                    $cred = New-Object System.Management.Automation.PSCredential('${username}', $secPass)
                    $result = Invoke-Command -ComputerName ${targetIP} -Credential $cred -ScriptBlock {
                        ${scriptBlock}
                    } -ErrorAction Stop 2>&1 | Out-String
                    @{Success=$true; Output=$result} | ConvertTo-Json -Depth 3
                } catch {
                    @{Success=$false; Error=$_.Exception.Message} | ConvertTo-Json -Depth 3
                }
            `;
            execPowerShell(script, { timeout, maxBuffer: 1024 * 1024 * 10 }, (err, stdout) => {
                try { resolve(JSON.parse(stdout.trim())); }
                catch { resolve({ Success: false, Error: err?.message || 'Parse error' }); }
            });
        });
    }

    // Helper: format username for WinRM
    function formatUsername(username, targetIP) {
        if (!username.includes('\\') && !username.includes('@')) {
            return `${targetIP}\\${username}`;
        }
        return username;
    }

    function checkTcpPort(host, port, timeout = 2000) {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            let settled = false;

            const finalize = (result) => {
                if (settled) return;
                settled = true;
                socket.destroy();
                resolve(result);
            };

            socket.setTimeout(timeout);
            socket.once('connect', () => finalize(true));
            socket.once('timeout', () => finalize(false));
            socket.once('error', () => finalize(false));
            socket.connect(port, host);
        });
    }

    // POST /api/deploy - 원격 PC에 시스템 배포
    router.post('/', authenticateToken, requireRole('admin'), (req, res) => {
        const { targetIP, username, password } = req.body;

        if (!targetIP || !username || !password) {
            return res.status(400).json({ success: false, error: 'targetIP, username, password 필수' });
        }
        if (!isValidIP(targetIP)) {
            return res.status(400).json({ success: false, error: 'Invalid IP address format' });
        }

        const scriptPath = require('path').join(__dirname, '..', '..', 'StudentPC-Setup-Ultra.ps1');
        const dashboardUrl = `http://${detectDashboardHost(req.hostname)}:${PORT}`;
        const safeIP = sanitizeForPS(targetIP);
        const safeUser = sanitizeForPS(username);
        const safePass = sanitizeForPS(password);
        const psCommand = `powershell.exe -ExecutionPolicy Bypass -File "${scriptPath}" -TargetIP "${safeIP}" -Username "${safeUser}" -Password "${safePass}" -DashboardUrl "${dashboardUrl}"`;

        console.log(`[Deploy] Starting deployment to ${targetIP}...`);

        exec(psCommand, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            let result;
            try {
                result = JSON.parse(stdout);
            } catch (e) {
                result = { Status: 'Failed', Message: stdout || stderr || error?.message };
            }

            db.run(`INSERT INTO activity_logs (pc_name, user, activity_type, details) VALUES (?, ?, ?, ?)`,
                [targetIP, 'admin', 'DEPLOY', JSON.stringify(result)]);

            if (result.Status === 'Success') {
                io.emit('deploy-success', { targetIP, result });
                res.json({ success: true, result });
            } else {
                io.emit('deploy-failed', { targetIP, result, timestamp: new Date().toISOString() });
                res.status(500).json({ success: false, error: result.Message, details: result });
            }
        });
    });

    // GET /api/deploy/check/:ip - 대상 PC 연결 확인
    router.get('/check/:ip', authenticateToken, async (req, res) => {
        const { ip } = req.params;
        if (!isValidIP(ip)) {
            return res.status(400).json({ success: false, error: 'Invalid IP address format' });
        }

        const pingCmd = process.platform === 'win32' ? `ping -n 1 -w 2000 ${ip}` : `ping -c 1 -W 2 ${ip}`;
        const pingReachable = await new Promise((resolve) => {
            exec(pingCmd, (error) => resolve(!error));
        });
        const winrmAvailable = await checkTcpPort(ip, 5985);
        const reachable = pingReachable || winrmAvailable;

        let message = 'PC is offline or unreachable';
        if (winrmAvailable && !pingReachable) {
            message = 'WinRM reachable even though ICMP ping is blocked';
        } else if (winrmAvailable) {
            message = 'PC is online and WinRM is available';
        } else if (pingReachable) {
            message = 'PC is online';
        }

        res.json({ ip, reachable, pingReachable, winrmAvailable, message });
    });

    // POST /api/deploy/auto - 원클릭 자동 배포
    router.post('/auto', authenticateToken, requireRole('admin'), async (req, res) => {
        const { targetIP, username, password } = req.body;

        if (!targetIP || !username || !password) {
            return res.status(400).json({ success: false, error: 'targetIP, username, password 필수' });
        }

        const steps = [];
        const addStep = (name, status, message = '') => {
            const step = { name, status, message, timestamp: new Date().toISOString() };
            steps.push(step);
            io.emit('deploy-progress', { targetIP, step, steps });
        };

        try {
            // Step 1: TrustedHosts
            addStep('TrustedHosts 설정', 'PROGRESS');
            await new Promise((resolve) => {
                execPowerShell(`Set-Item WSMan:\\localhost\\Client\\TrustedHosts -Value '${targetIP}' -Concatenate -Force`, { timeout: 10000 }, (err) => {
                    addStep('TrustedHosts 설정', err ? 'WARN' : 'OK', err ? '이미 설정됨 또는 권한 필요' : '');
                    resolve();
                });
            });

            // Step 2: 연결 테스트
            addStep('연결 테스트', 'PROGRESS');
            const testResult = await new Promise((resolve) => {
                execPowerShell(`Test-WsMan -ComputerName ${targetIP}`, { timeout: 5000 }, (err) => resolve(!err));
            });
            if (!testResult) {
                addStep('연결 테스트', 'FAIL', 'WinRM 연결 실패');
                return res.status(400).json({ success: false, steps, error: 'WinRM 연결 실패' });
            }
            addStep('연결 테스트', 'OK');

            // Step 3: 자격 증명 테스트
            addStep('자격 증명 확인', 'PROGRESS');
            const formattedUsername = formatUsername(username, targetIP);
            const escapedPassword = password.replace(/'/g, "''").replace(/\$/g, '`$');
            const credResult = await new Promise((resolve) => {
                const credScript = `
                    $ErrorActionPreference = 'Stop'
                    try {
                        $secPass = ConvertTo-SecureString '${escapedPassword}' -AsPlainText -Force
                        $cred = New-Object System.Management.Automation.PSCredential('${formattedUsername}', $secPass)
                        $result = Invoke-Command -ComputerName ${targetIP} -Credential $cred -ScriptBlock { $env:COMPUTERNAME } -ErrorAction Stop
                        Write-Output "SUCCESS:$result"
                    } catch { Write-Output "FAIL:$($_.Exception.Message)" }
                `;
                execPowerShell(credScript, { timeout: 20000 }, (err, stdout) => {
                    if (stdout.includes('SUCCESS')) {
                        resolve({ success: true, computerName: stdout.split(':')[1]?.trim() });
                    } else {
                        resolve({ success: false, error: stdout.includes('FAIL:') ? stdout.split('FAIL:')[1]?.trim() : err?.message || 'Unknown' });
                    }
                });
            });

            if (!credResult.success) {
                let helpMessage = credResult.error;
                if (credResult.error?.includes('Access is denied') || credResult.error?.includes('액세스가 거부') || credResult.error?.includes('about_Remote_Troubleshooting')) {
                    helpMessage = '원격 인증이 거부되었습니다. 대상 PC의 관리자 계정, 비밀번호, 원격 관리자 권한을 확인하세요.';
                }
                else if (credResult.error?.includes('user name or password is incorrect')) {
                    helpMessage = '사용자명/비밀번호 오류';
                }
                else if (credResult.error?.includes('WinRM')) {
                    helpMessage = 'WinRM 비활성화됨';
                }
                addStep('자격 증명 확인', 'FAIL', helpMessage);
                return res.status(400).json({ success: false, steps, error: helpMessage });
            }
            addStep('자격 증명 확인', 'OK', `연결됨: ${credResult.computerName}`);

            // Step 4: Node.js 에이전트 번들 배포
            addStep('에이전트 번들 전송', 'PROGRESS');
            const dashboardUrl = `http://${detectDashboardHost(req.hostname)}:${PORT}`;

            if (!fs.existsSync(BUNDLE_ZIP)) {
                addStep('에이전트 번들 전송', 'FAIL', 'agent-bundle.zip 없음. node scripts/bundle-agent.js 실행 필요');
                return res.status(500).json({ success: false, steps, error: 'Agent bundle not found' });
            }

            // Copy zip to remote PC via PSSession, extract, install service
            const bundleZipWin = BUNDLE_ZIP.replace(/\//g, '\\');
            const deployScript = `
                $ErrorActionPreference = 'Continue'
                try {
                    $secPass = ConvertTo-SecureString '${escapedPassword}' -AsPlainText -Force
                    $cred = New-Object System.Management.Automation.PSCredential('${formattedUsername}', $secPass)
                    $session = New-PSSession -ComputerName ${targetIP} -Credential $cred -ErrorAction Stop

                    # Create agent directory on remote
                    Invoke-Command -Session $session -ScriptBlock {
                        $agentPath = 'C:\\ProgramData\\PCAgent'
                        if (Test-Path $agentPath) {
                            # Stop existing agent
                            Get-Process -Name node -ErrorAction SilentlyContinue |
                                Where-Object { $_.CommandLine -like '*agent.js*' } |
                                Stop-Process -Force -ErrorAction SilentlyContinue
                            schtasks /delete /tn 'PCAgent' /f 2>$null
                        }
                        New-Item -Path $agentPath -ItemType Directory -Force | Out-Null
                    }

                    # Copy bundle zip to remote
                    Copy-Item -Path '${bundleZipWin}' -Destination 'C:\\ProgramData\\PCAgent\\agent-bundle.zip' -ToSession $session -Force

                    # Extract and install on remote
                    Invoke-Command -Session $session -ScriptBlock {
                        param($serverUrl)
                        $agentPath = 'C:\\ProgramData\\PCAgent'
                        $zipPath = Join-Path $agentPath 'agent-bundle.zip'

                        # Extract (overwrite)
                        Expand-Archive -Path $zipPath -DestinationPath $agentPath -Force
                        Remove-Item $zipPath -Force

                        # Save server URL
                        "SERVER_URL=$serverUrl" | Out-File -FilePath (Join-Path $agentPath '.env') -Encoding UTF8 -Force

                        # Register scheduled task for auto-start
                        schtasks /delete /tn 'PCAgent' /f 2>$null
                        $taskCmd = "cmd /c cd /d $agentPath ^& set SERVER_URL=$serverUrl ^& node.exe agent.js"
                        schtasks /create /tn 'PCAgent' /tr $taskCmd /sc onlogon /rl highest /f 2>$null

                        # Start agent now
                        Start-Process -FilePath (Join-Path $agentPath 'node.exe') -ArgumentList (Join-Path $agentPath 'agent.js') -WorkingDirectory $agentPath -WindowStyle Hidden
                        Start-Sleep -Seconds 2

                        # Verify
                        $running = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*PCAgent*' }
                        if ($running) {
                            Write-Output "AGENT_INSTALLED:$env:COMPUTERNAME"
                        } else {
                            Write-Output "AGENT_STARTED_NO_VERIFY:$env:COMPUTERNAME"
                        }
                    } -ArgumentList '${dashboardUrl}'

                    Remove-PSSession $session
                } catch {
                    Write-Output "DEPLOY_ERROR:$($_.Exception.Message)"
                }
            `;

            const installResult = await new Promise((resolve) => {
                execPowerShell(deployScript, { timeout: 120000, maxBuffer: 1024 * 1024 * 10 }, (err, stdout) => {
                    const output = (stdout || '').trim();
                    if (output.includes('AGENT_INSTALLED')) {
                        resolve({ ok: true, verified: true, name: output.split(':')[1] });
                    } else if (output.includes('AGENT_STARTED_NO_VERIFY')) {
                        resolve({ ok: true, verified: false, name: output.split(':')[1] });
                    } else {
                        const errorMsg = output.includes('DEPLOY_ERROR:') ? output.split('DEPLOY_ERROR:')[1] : (err?.message || 'Unknown');
                        resolve({ ok: false, error: errorMsg });
                    }
                });
            });

            if (installResult.ok) {
                addStep('에이전트 번들 전송', 'OK', `Node.js 에이전트 설치됨${installResult.verified ? ' (확인)' : ''}: ${installResult.name || targetIP}`);
            } else {
                addStep('에이전트 번들 전송', 'WARN', installResult.error);
            }

            // Step 5: DB에 PC 등록
            addStep('PC 등록', 'PROGRESS');
            await new Promise((resolve) => {
                db.run(`INSERT OR REPLACE INTO pc_status (pc_name, ip_address, status, last_seen) VALUES (?, ?, 'online', datetime('now'))`,
                    [targetIP, targetIP], (err) => {
                        addStep('PC 등록', err ? 'WARN' : 'OK', err ? err.message : '');
                        resolve();
                    });
            });

            io.emit('deploy-completed', { targetIP, success: true, steps });
            res.json({ success: true, message: '원클릭 배포 완료!', steps });

        } catch (error) {
            addStep('오류 발생', 'FAIL', error.message);
            res.status(500).json({ success: false, error: error.message, steps });
        }
    });

    // POST /api/oneclick/full-setup - 원클릭으로 모든 것을 순차 처리
    router.post('/oneclick/full-setup', authenticateToken, requireRole('admin'), async (req, res) => {
        const dashboardUrl = `http://${detectDashboardHost(req.hostname)}:${PORT}`;
        const { username, password } = req.body;

        let defaultCred = null;
        if (username && password) {
            await new Promise(resolve => db.run(`DELETE FROM saved_credentials WHERE is_default = 1`, resolve));
            const encrypted = encryptPassword(password);
            await new Promise((resolve, reject) => {
                db.run(`INSERT INTO saved_credentials (name, username, password_encrypted, is_default) VALUES (?, ?, ?, 1)`,
                    ['default', username, encrypted], (err) => err ? reject(err) : resolve());
            });
            defaultCred = { username, password };
            io.emit('oneclick-progress', { step: 0, message: '🔐 자격 증명 저장됨' });
        } else {
            defaultCred = await new Promise((resolve) => {
                db.get(`SELECT * FROM saved_credentials WHERE is_default = 1`, (err, row) => {
                    if (row) resolve({ username: row.username, password: decryptPassword(row.password_encrypted) });
                    else resolve(null);
                });
            });
        }

        if (!defaultCred) {
            return res.status(400).json({
                success: false, error: '자격 증명이 필요합니다.',
                needCredentials: true, example: { username: 'Administrator', password: '비밀번호' }
            });
        }

        const results = { scanned: [], setupSuccess: [], setupFailed: [], agentInstalled: [], totalSteps: 4, currentStep: 0 };

        try {
            // Step 1: 네트워크 스캔
            results.currentStep = 1;
            io.emit('oneclick-progress', { step: 1, total: 4, message: '🔍 네트워크 스캔 중...', results });
            const subnet = detectSubnet();
            const scanRange = req.body.fullScan ? [1, 254] : [1, 50];

            for (let i = scanRange[0]; i <= scanRange[1]; i++) {
                const ip = `${subnet}.${i}`;
                try {
                    const pingResult = await new Promise((resolve) => {
                        exec(`ping -n 1 -w 100 ${ip}`, { timeout: 500 }, (err) => resolve(!err));
                    });
                    const winrmReady = await checkTcpPort(ip, 5985, 250);
                    if (pingResult || winrmReady) results.scanned.push({ ip, online: true, winrmReady });
                } catch { }
                if (i % 10 === 0) {
                    io.emit('oneclick-progress', { step: 1, message: `🔍 스캔 중... ${subnet}.${i}`, found: results.scanned.length });
                }
            }

            io.emit('oneclick-progress', { step: 1, message: `✅ ${results.scanned.length}대 PC 발견`, results });
            if (results.scanned.length === 0) {
                return res.json({ success: false, error: '발견된 PC가 없습니다', results });
            }

            // Step 2: Node.js 에이전트 번들 배포
            results.currentStep = 2;
            io.emit('oneclick-progress', { step: 2, total: 4, message: '🚀 Node.js 에이전트 배포 시작...', results });

            if (!fs.existsSync(BUNDLE_ZIP)) {
                io.emit('oneclick-error', { error: 'agent-bundle.zip not found' });
                return res.status(500).json({ success: false, error: 'Agent bundle not found. Run: node scripts/bundle-agent.js', results });
            }

            const bundleZipWin = BUNDLE_ZIP.replace(/\//g, '\\');

            for (let i = 0; i < results.scanned.length; i++) {
                const pc = results.scanned[i];
                io.emit('oneclick-progress', { step: 2, message: `🚀 [${i + 1}/${results.scanned.length}] ${pc.ip} 배포 중...`, current: pc.ip });

                try {
                    const fmtUser = formatUsername(defaultCred.username, pc.ip);
                    const escapedPass = defaultCred.password.replace(/'/g, "''").replace(/\$/g, '`$');

                    // Deploy full Node.js agent via PSSession + Copy-Item
                    const deployScript = `
                        $ErrorActionPreference = 'Continue'
                        try {
                            $secPass = ConvertTo-SecureString '${escapedPass}' -AsPlainText -Force
                            $cred = New-Object System.Management.Automation.PSCredential('${fmtUser}', $secPass)
                            $session = New-PSSession -ComputerName ${pc.ip} -Credential $cred -ErrorAction Stop

                            Invoke-Command -Session $session -ScriptBlock {
                                $agentPath = 'C:\\ProgramData\\PCAgent'
                                Get-Process -Name node -ErrorAction SilentlyContinue |
                                    Where-Object { $_.Path -like '*PCAgent*' } |
                                    Stop-Process -Force -ErrorAction SilentlyContinue
                                schtasks /delete /tn 'PCAgent' /f 2>$null
                                New-Item -Path $agentPath -ItemType Directory -Force | Out-Null
                            }

                            Copy-Item -Path '${bundleZipWin}' -Destination 'C:\\ProgramData\\PCAgent\\agent-bundle.zip' -ToSession $session -Force

                            Invoke-Command -Session $session -ScriptBlock {
                                param($serverUrl)
                                $agentPath = 'C:\\ProgramData\\PCAgent'
                                Expand-Archive -Path "$agentPath\\agent-bundle.zip" -DestinationPath $agentPath -Force
                                Remove-Item "$agentPath\\agent-bundle.zip" -Force
                                "SERVER_URL=$serverUrl" | Out-File "$agentPath\\.env" -Encoding UTF8 -Force
                                $taskCmd = "cmd /c cd /d $agentPath ^& set SERVER_URL=$serverUrl ^& node.exe agent.js"
                                schtasks /create /tn 'PCAgent' /tr $taskCmd /sc onlogon /rl highest /f 2>$null
                                Start-Process -FilePath "$agentPath\\node.exe" -ArgumentList "$agentPath\\agent.js" -WorkingDirectory $agentPath -WindowStyle Hidden
                                Start-Sleep -Seconds 2
                                $running = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*PCAgent*' }
                                if ($running) { Write-Output "AGENT_INSTALLED:$env:COMPUTERNAME" }
                                else { Write-Output "AGENT_STARTED_NO_VERIFY:$env:COMPUTERNAME" }
                            } -ArgumentList '${dashboardUrl}'

                            Remove-PSSession $session
                        } catch {
                            Write-Output "DEPLOY_ERROR:$($_.Exception.Message)"
                        }
                    `;

                    const output = await new Promise((resolve) => {
                        execPowerShell(deployScript, { timeout: 120000, maxBuffer: 1024 * 1024 * 10 }, (err, stdout) => {
                            resolve((stdout || '').trim());
                        });
                    });

                    if (output.includes('AGENT_INSTALLED') || output.includes('AGENT_STARTED_NO_VERIFY')) {
                        results.agentInstalled.push(pc.ip);
                        results.setupSuccess.push(pc.ip);
                        io.emit('oneclick-progress', { step: 2, message: `✅ ${pc.ip} Node.js 에이전트 설치 완료`, success: true });
                    } else {
                        const errMsg = output.includes('DEPLOY_ERROR:') ? output.split('DEPLOY_ERROR:')[1].substring(0, 80) : 'Unknown';
                        results.setupFailed.push({ ip: pc.ip, error: errMsg });
                        io.emit('oneclick-progress', { step: 2, message: `❌ ${pc.ip} 실패: ${errMsg}`, success: false });
                    }
                } catch (error) {
                    results.setupFailed.push({ ip: pc.ip, error: error.message });
                }
            }

            // Step 3: 결과 저장
            results.currentStep = 3;
            io.emit('oneclick-progress', { step: 3, message: '💾 결과 저장 중...', results });
            for (const ip of results.agentInstalled) {
                db.run(`INSERT OR REPLACE INTO pc_status (pc_name, ip_address, status, last_seen) VALUES (?, ?, 'online', datetime('now'))`, [ip, ip]);
            }

            // Step 4: 완료
            results.currentStep = 4;
            io.emit('oneclick-complete', { success: true, results, summary: { scanned: results.scanned.length, installed: results.agentInstalled.length, failed: results.setupFailed.length } });
            res.json({ success: true, message: `✅ 완료! ${results.agentInstalled.length}대 PC에 에이전트 설치됨`, results });

        } catch (error) {
            io.emit('oneclick-error', { error: error.message });
            res.status(500).json({ success: false, error: error.message, results });
        }
    });

    // POST /api/oneclick/save-credentials
    router.post('/oneclick/save-credentials', authenticateToken, async (req, res) => {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: '사용자명과 비밀번호를 입력하세요' });
        }
        await new Promise(resolve => db.run(`DELETE FROM saved_credentials WHERE is_default = 1`, resolve));
        const encrypted = encryptPassword(password);
        db.run(`INSERT INTO saved_credentials (name, username, password_encrypted, is_default) VALUES (?, ?, ?, 1)`,
            ['default', username, encrypted], function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, message: '자격 증명이 저장되었습니다' });
            });
    });

    // GET /api/deploy/bundle-status — check if agent bundle exists
    router.get('/bundle-status', authenticateToken, (req, res) => {
        const exists = fs.existsSync(BUNDLE_ZIP);
        let size = 0;
        let modified = null;
        if (exists) {
            const stat = fs.statSync(BUNDLE_ZIP);
            size = stat.size;
            modified = stat.mtime.toISOString();
        }
        res.json({
            success: true,
            bundleReady: exists,
            sizeMB: exists ? (size / 1024 / 1024).toFixed(1) : 0,
            modified,
            path: BUNDLE_ZIP,
        });
    });

    // POST /api/deploy/rebuild-bundle — regenerate agent bundle
    router.post('/rebuild-bundle', authenticateToken, requireRole('admin'), (req, res) => {
        try {
            const { bundle } = require('../scripts/bundle-agent');
            const zipPath = bundle();
            const stat = fs.statSync(zipPath);
            res.json({ success: true, sizeMB: (stat.size / 1024 / 1024).toFixed(1) });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};
