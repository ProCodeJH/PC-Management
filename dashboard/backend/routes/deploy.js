// routes/deploy.js
// Deploy and OneClick setup routes
const express = require('express');
const os = require('os');
const { isValidIP, sanitizeForPS } = require('../utils/helpers');

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
            exec(`powershell.exe -Command "${script.replace(/\n/g, ' ')}"`, { timeout, maxBuffer: 1024 * 1024 * 10 }, (err, stdout) => {
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
        const dashboardUrl = `http://${req.hostname}:${PORT}`;
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
    router.get('/check/:ip', authenticateToken, (req, res) => {
        const { ip } = req.params;
        if (!isValidIP(ip)) {
            return res.status(400).json({ success: false, error: 'Invalid IP address format' });
        }
        const pingCmd = process.platform === 'win32' ? `ping -n 1 -w 2000 ${ip}` : `ping -c 1 -W 2 ${ip}`;
        exec(pingCmd, (error) => {
            res.json({ ip, reachable: !error, message: !error ? 'PC is online' : 'PC is offline or unreachable' });
        });
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
                exec(`powershell.exe -Command "Set-Item WSMan:\\localhost\\Client\\TrustedHosts -Value '${targetIP}' -Concatenate -Force"`, { timeout: 10000 }, (err) => {
                    addStep('TrustedHosts 설정', err ? 'WARN' : 'OK', err ? '이미 설정됨 또는 권한 필요' : '');
                    resolve();
                });
            });

            // Step 2: 연결 테스트
            addStep('연결 테스트', 'PROGRESS');
            const testResult = await new Promise((resolve) => {
                exec(`powershell.exe -Command "Test-WsMan -ComputerName ${targetIP}"`, { timeout: 5000 }, (err) => resolve(!err));
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
                exec(`powershell.exe -Command "${credScript.replace(/\n/g, ' ')}"`, { timeout: 20000 }, (err, stdout) => {
                    if (stdout.includes('SUCCESS')) {
                        resolve({ success: true, computerName: stdout.split(':')[1]?.trim() });
                    } else {
                        resolve({ success: false, error: stdout.includes('FAIL:') ? stdout.split('FAIL:')[1]?.trim() : err?.message || 'Unknown' });
                    }
                });
            });

            if (!credResult.success) {
                let helpMessage = credResult.error;
                if (credResult.error?.includes('Access is denied') || credResult.error?.includes('액세스가 거부')) helpMessage = '비밀번호가 틀리거나 관리자 계정이 아닙니다';
                else if (credResult.error?.includes('user name or password is incorrect')) helpMessage = '사용자명/비밀번호 오류';
                else if (credResult.error?.includes('WinRM')) helpMessage = 'WinRM 비활성화됨';
                addStep('자격 증명 확인', 'FAIL', helpMessage);
                return res.status(400).json({ success: false, steps, error: helpMessage });
            }
            addStep('자격 증명 확인', 'OK', `연결됨: ${credResult.computerName}`);

            // Step 4: 에이전트 설치
            addStep('에이전트 설치', 'PROGRESS');
            const dashboardUrl = `http://${req.hostname}:${PORT}`;
            const agentScript = `
                $dashboardUrl = '${dashboardUrl}'
                $agentPath = 'C:\\\\ProgramData\\\\PCAgent'
                New-Item -Path $agentPath -ItemType Directory -Force | Out-Null
                $script = @'
                while($true) {
                    try {
                        $cpu = (Get-WmiObject Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
                        $mem = (Get-WmiObject Win32_OperatingSystem)
                        $memUsed = [math]::Round((($mem.TotalVisibleMemorySize - $mem.FreePhysicalMemory) / $mem.TotalVisibleMemorySize) * 100, 1)
                        $body = @{ pcName = $env:COMPUTERNAME; ipAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike '*Loopback*' } | Select-Object -First 1).IPAddress; cpuUsage = $cpu; memoryUsage = $memUsed } | ConvertTo-Json
                        Invoke-RestMethod -Uri "$dashboardUrl/api/pcs/$env:COMPUTERNAME/status" -Method POST -Body $body -ContentType 'application/json' -ErrorAction SilentlyContinue
                    } catch {}
                    Start-Sleep -Seconds 30
                }
'@
                $script = $script.Replace('$dashboardUrl', '${dashboardUrl}')
                Set-Content -Path "$agentPath\\\\Agent.ps1" -Value $script -Force
                $action = New-ScheduledTaskAction -Execute 'PowerShell.exe' -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File $agentPath\\\\Agent.ps1"
                $trigger = New-ScheduledTaskTrigger -AtStartup
                $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
                Register-ScheduledTask -TaskName 'PCManagementAgent' -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
                Start-ScheduledTask -TaskName 'PCManagementAgent' -ErrorAction SilentlyContinue
                Write-Output 'AGENT_INSTALLED'
            `;

            const installResult = await new Promise((resolve) => {
                const installScript = `
                    $secPass = ConvertTo-SecureString '${password}' -AsPlainText -Force
                    $cred = New-Object System.Management.Automation.PSCredential('${username}', $secPass)
                    Invoke-Command -ComputerName ${targetIP} -Credential $cred -ScriptBlock { ${agentScript.replace(/'/g, "''")} }
                `;
                exec(`powershell.exe -Command "${installScript.replace(/\n/g, ' ')}"`, { timeout: 60000, maxBuffer: 1024 * 1024 * 10 }, (err, stdout) => {
                    resolve(stdout.includes('AGENT_INSTALLED'));
                });
            });

            addStep('에이전트 설치', installResult ? 'OK' : 'WARN', installResult ? '' : '설치 확인 필요');

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
        const dashboardUrl = `http://${req.hostname}:${PORT}`;
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
                    if (pingResult) results.scanned.push({ ip, online: true });
                } catch { }
                if (i % 10 === 0) {
                    io.emit('oneclick-progress', { step: 1, message: `🔍 스캔 중... ${subnet}.${i}`, found: results.scanned.length });
                }
            }

            io.emit('oneclick-progress', { step: 1, message: `✅ ${results.scanned.length}대 PC 발견`, results });
            if (results.scanned.length === 0) {
                return res.json({ success: false, error: '발견된 PC가 없습니다', results });
            }

            // Step 2: 에이전트 설치
            results.currentStep = 2;
            io.emit('oneclick-progress', { step: 2, total: 4, message: '🚀 에이전트 설치 시작...', results });

            const agentScript = `
                $agentPath = 'C:\\\\ProgramData\\\\PCAgent'
                $dashboardUrl = '${dashboardUrl}'
                New-Item -Path $agentPath -ItemType Directory -Force | Out-Null
                $monitorScript = @'
                $dashboardUrl = "${dashboardUrl}"
                while($true) {
                    try {
                        $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
                        $mem = (Get-CimInstance Win32_OperatingSystem | ForEach-Object { [math]::Round((1 - $_.FreePhysicalMemory/$_.TotalVisibleMemorySize)*100, 1) })
                        $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" } | Select-Object -First 1).IPAddress
                        $body = @{ pcName = $env:COMPUTERNAME; ipAddress = $ip; cpuUsage = $cpu; memoryUsage = $mem } | ConvertTo-Json
                        Invoke-RestMethod -Uri "$dashboardUrl/api/pcs/$env:COMPUTERNAME/status" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 5 | Out-Null
                    } catch { }
                    Start-Sleep -Seconds 30
                }
'@
                $monitorScript | Out-File -FilePath "$agentPath\\\\Monitor.ps1" -Encoding UTF8 -Force
                $startScript = @"
                Start-Process powershell.exe -ArgumentList '-WindowStyle Hidden -ExecutionPolicy Bypass -File C:\\\\ProgramData\\\\PCAgent\\\\Monitor.ps1' -WindowStyle Hidden
"@
                $startScript | Out-File -FilePath "$agentPath\\\\Start.bat" -Encoding ASCII -Force
                $startupPath = "$env:APPDATA\\\\Microsoft\\\\Windows\\\\Start Menu\\\\Programs\\\\Startup\\\\PCAgent.bat"
                Copy-Item "$agentPath\\\\Start.bat" $startupPath -Force
                Start-Process powershell.exe -ArgumentList '-WindowStyle Hidden -ExecutionPolicy Bypass -File C:\\\\ProgramData\\\\PCAgent\\\\Monitor.ps1' -WindowStyle Hidden
                Write-Output "AGENT_INSTALLED:$env:COMPUTERNAME"
            `;

            for (let i = 0; i < results.scanned.length; i++) {
                const pc = results.scanned[i];
                io.emit('oneclick-progress', { step: 2, message: `🚀 [${i + 1}/${results.scanned.length}] ${pc.ip} 설정 중...`, current: pc.ip });

                try {
                    const fmtUser = formatUsername(defaultCred.username, pc.ip);
                    const escapedPass = defaultCred.password.replace(/'/g, "''").replace(/\$/g, '`$');

                    const installResult = await remoteExec(pc.ip, fmtUser, defaultCred.password, agentScript.replace(/'/g, "''").replace(/\$/g, '`$'), 120000);

                    if (installResult.Success && installResult.Output?.includes('AGENT_INSTALLED')) {
                        results.agentInstalled.push(pc.ip);
                        results.setupSuccess.push(pc.ip);
                        io.emit('oneclick-progress', { step: 2, message: `✅ ${pc.ip} 설치 완료`, success: true });
                    } else {
                        results.setupFailed.push({ ip: pc.ip, error: installResult.Error || 'Unknown' });
                        io.emit('oneclick-progress', { step: 2, message: `❌ ${pc.ip} 실패: ${installResult.Error?.substring(0, 50)}`, success: false });
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

    return router;
};
