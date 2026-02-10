// routes/network.js
// Network scanning and WinRM setup routes
const express = require('express');
const os = require('os');
const { isValidIP, sanitizeForPS } = require('../utils/helpers');
const config = require('../config');

module.exports = function ({ db, io, exec, authenticateToken, requireRole, PORT }) {
    const router = express.Router();

    // GET /my-ip - 서버 IP 주소 감지
    router.get('/my-ip', (req, res) => {
        const interfaces = os.networkInterfaces();
        let localIP = '192.168.0.1';
        let subnet = '192.168.0';

        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    localIP = iface.address;
                    const parts = localIP.split('.');
                    if (parts.length === 4) subnet = parts.slice(0, 3).join('.');
                    break;
                }
            }
        }
        res.json({ success: true, ip: localIP, subnet, port: PORT });
    });

    // GET /scan - 네트워크 자동 스캔
    router.get('/scan', (req, res) => {
        const { subnet } = req.query;
        const baseSubnet = subnet || '192.168.0';
        const scanRange = req.query.range || '1-254';
        const [start, end] = scanRange.split('-').map(Number);

        io.emit('scan-started', { subnet: baseSubnet, range: scanRange });

        const results = [];
        let completed = 0;
        const total = end - start + 1;

        const scanIP = (ip) => {
            return new Promise((resolve) => {
                exec(`ping -n 1 -w ${config.SCAN_PING_TIMEOUT_MS} ${ip}`, { timeout: 1000 }, (error) => {
                    if (!error) {
                        exec(`powershell.exe -Command "Test-WsMan -ComputerName ${ip} -ErrorAction SilentlyContinue"`, { timeout: 3000 }, (wsError) => {
                            resolve({ ip, online: true, winrmReady: !wsError, hostname: null });
                        });
                    } else {
                        resolve({ ip, online: false, winrmReady: false });
                    }
                });
            });
        };

        const batchSize = config.SCAN_BATCH_SIZE;
        const processInBatches = async () => {
            for (let i = start; i <= end; i += batchSize) {
                const batch = [];
                for (let j = i; j < Math.min(i + batchSize, end + 1); j++) {
                    batch.push(scanIP(`${baseSubnet}.${j}`));
                }
                const batchResults = await Promise.all(batch);
                batchResults.forEach(r => {
                    if (r.online) results.push(r);
                    completed++;
                });
                io.emit('scan-progress', { completed, total, percent: Math.round((completed / total) * 100), found: results.length });
            }
            io.emit('scan-completed', { results });
            res.json({ success: true, results, scanned: total });
        };

        processInBatches().catch(err => res.status(500).json({ success: false, error: err.message }));
    });

    // POST /setup-winrm - 원격 PC WinRM 자동 설정
    router.post('/setup-winrm', authenticateToken, requireRole('admin'), async (req, res) => {
        const { targetIP, username, password } = req.body;

        if (!targetIP) return res.status(400).json({ success: false, error: 'targetIP 필수' });
        if (!isValidIP(targetIP)) return res.status(400).json({ success: false, error: 'Invalid IP' });

        const steps = [];
        const addStep = (name, status, message = '') => {
            const step = { name, status, message, timestamp: new Date().toISOString() };
            steps.push(step);
            io.emit('winrm-setup-progress', { targetIP, step, steps });
        };

        try {
            // Step 1: TrustedHosts
            addStep('TrustedHosts 설정', 'PROGRESS');
            await new Promise((resolve) => {
                exec(`powershell.exe -Command "Set-Item WSMan:\\localhost\\Client\\TrustedHosts -Value '${targetIP}' -Concatenate -Force -ErrorAction SilentlyContinue"`, { timeout: 10000 }, () => {
                    addStep('TrustedHosts 설정', 'OK');
                    resolve();
                });
            });

            if (username && password) {
                // Step 2: 원격 WinRM 활성화
                addStep('원격 WinRM 활성화', 'PROGRESS');
                const safeUser = sanitizeForPS(username);
                const escapedPass = (password || '').replace(/'/g, "''").replace(/\$/g, '`$');

                const credentialScript = `
                    $securePass = ConvertTo-SecureString '${escapedPass}' -AsPlainText -Force
                    $cred = New-Object System.Management.Automation.PSCredential('${safeUser}', $securePass)
                    try {
                        $result = Invoke-WmiMethod -ComputerName '${targetIP}' -Credential $cred -Class Win32_Process -Name Create -ArgumentList 'powershell.exe -Command "Enable-PSRemoting -Force -SkipNetworkProfileCheck; Set-Item WSMan:\\localhost\\Service\\Auth\\Basic -Value $true; Set-ItemProperty -Path HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System -Name LocalAccountTokenFilterPolicy -Value 1 -Force; Restart-Service WinRM"' -ErrorAction Stop
                        @{Success=$true; Message='WMI를 통해 WinRM 설정 완료'} | ConvertTo-Json
                    } catch {
                        try {
                            $session = New-PSSession -ComputerName '${targetIP}' -Credential $cred -ErrorAction Stop
                            Invoke-Command -Session $session -ScriptBlock {
                                Enable-PSRemoting -Force -SkipNetworkProfileCheck
                                Set-Item WSMan:\\localhost\\Service\\Auth\\Basic -Value $true
                                Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name 'LocalAccountTokenFilterPolicy' -Value 1 -Force
                            }
                            Remove-PSSession $session
                            @{Success=$true; Message='PSSession을 통해 WinRM 설정 완료'} | ConvertTo-Json
                        } catch {
                            @{Success=$false; Message=$_.Exception.Message} | ConvertTo-Json
                        }
                    }
                `.replace(/\n/g, ' ');

                const result = await new Promise((resolve) => {
                    exec(`powershell.exe -Command "${credentialScript}"`, { timeout: 60000 }, (error, stdout) => {
                        try { resolve(JSON.parse(stdout.trim())); }
                        catch { resolve({ Success: false, Message: error?.message || 'Unknown error' }); }
                    });
                });

                addStep('원격 WinRM 활성화', result.Success ? 'OK' : 'WARN', result.Message);

                // Step 3: 연결 테스트
                addStep('연결 테스트', 'PROGRESS');
                const testOK = await new Promise((resolve) => {
                    exec(`powershell.exe -Command "Test-WsMan -ComputerName '${targetIP}' -ErrorAction SilentlyContinue"`, { timeout: 10000 }, (error) => resolve(!error));
                });

                if (testOK) {
                    addStep('연결 테스트', 'OK', 'WinRM 연결 성공!');
                    io.emit('winrm-setup-completed', { targetIP, success: true, steps });
                    res.json({ success: true, message: 'WinRM 설정 완료', steps });
                } else {
                    addStep('연결 테스트', 'FAIL', '수동 설정 필요');
                    io.emit('winrm-setup-completed', { targetIP, success: false, steps });
                    res.json({ success: false, message: '원격 설정 실패', steps });
                }
            } else {
                addStep('WinRM 체크', 'PROGRESS');
                const testOK = await new Promise((resolve) => {
                    exec(`powershell.exe -Command "Test-WsMan -ComputerName '${targetIP}' -ErrorAction SilentlyContinue"`, { timeout: 10000 }, (error) => resolve(!error));
                });
                if (testOK) {
                    addStep('WinRM 체크', 'OK', '이미 WinRM 활성화됨');
                    io.emit('winrm-setup-completed', { targetIP, success: true, steps });
                    res.json({ success: true, message: 'WinRM 이미 활성화됨', steps });
                } else {
                    addStep('WinRM 체크', 'FAIL', '자격 증명이 필요합니다');
                    io.emit('winrm-setup-completed', { targetIP, success: false, steps });
                    res.json({ success: false, message: '자격 증명 입력 후 다시 시도', steps, needCredentials: true });
                }
            }
        } catch (error) {
            addStep('오류', 'FAIL', error.message);
            res.status(500).json({ success: false, error: error.message, steps });
        }
    });

    return router;
};
