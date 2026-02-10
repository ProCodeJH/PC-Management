// routes/remote.js
// Remote command execution routes
const express = require('express');
const { isValidIP, sanitizeForPS } = require('../utils/helpers');

module.exports = function ({ db, io, exec, authenticateToken, requireRole, decryptPassword }) {
    const router = express.Router();

    // Quick command presets
    const QUICK_COMMANDS = {
        'shutdown': 'shutdown /s /t 60 /c "관리자에 의해 1분 후 종료됩니다"',
        'restart': 'shutdown /r /t 60 /c "관리자에 의해 1분 후 재시작됩니다"',
        'cancel-shutdown': 'shutdown /a',
        'lock': 'rundll32.exe user32.dll,LockWorkStation',
        'logoff': 'logoff',
        'get-info': '$env:COMPUTERNAME + " | " + (Get-CimInstance Win32_OperatingSystem).Caption',
        'get-users': 'Get-LocalUser | Select-Object Name, Enabled | ConvertTo-Json',
        'get-processes': 'Get-Process | Select-Object -First 10 Name, CPU | ConvertTo-Json',
        'clear-temp': 'Remove-Item -Path "$env:TEMP\\*" -Recurse -Force -ErrorAction SilentlyContinue; "Temp cleared"',
        'enable-winrm': 'Enable-PSRemoting -Force -SkipNetworkProfileCheck; Set-Item WSMan:\\localhost\\Service\\Auth\\Basic -Value $true'
    };

    // Helper: resolve credentials from request or DB default
    async function resolveCredentials(username, password) {
        if (username && password) return { username, password };
        return new Promise((resolve) => {
            db.get(`SELECT * FROM saved_credentials WHERE is_default = 1`, (err, row) => {
                if (row) {
                    resolve({ username: row.username, password: decryptPassword(row.password_encrypted) });
                } else {
                    resolve(null);
                }
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

    // Helper: execute remote PowerShell
    function executeRemotePS(targetIP, creds, command, timeout = 60000) {
        return new Promise((resolve) => {
            const escapedPassword = creds.password.replace(/'/g, "''").replace(/\$/g, '`$');
            const escapedCommand = command.replace(/'/g, "''").replace(/"/g, '\\"');
            const formattedUsername = formatUsername(creds.username, targetIP);

            const script = `
                $ErrorActionPreference = 'Continue'
                try {
                    $secPass = ConvertTo-SecureString '${escapedPassword}' -AsPlainText -Force
                    $cred = New-Object System.Management.Automation.PSCredential('${formattedUsername}', $secPass)
                    $result = Invoke-Command -ComputerName ${targetIP} -Credential $cred -ScriptBlock {
                        ${escapedCommand}
                    } -ErrorAction Stop 2>&1 | Out-String
                    @{Success=$true; Output=$result} | ConvertTo-Json -Depth 3
                } catch {
                    @{Success=$false; Error=$_.Exception.Message} | ConvertTo-Json -Depth 3
                }
            `;

            exec(`powershell.exe -Command "${script.replace(/\n/g, ' ')}"`, { timeout }, (err, stdout, stderr) => {
                try {
                    resolve(JSON.parse(stdout.trim()));
                } catch {
                    resolve({ Success: false, Error: err?.message || stderr || 'Parse error', Raw: stdout });
                }
            });
        });
    }

    // POST /execute - 단일 PC에 명령 실행
    router.post('/execute', authenticateToken, requireRole('admin'), async (req, res) => {
        const { targetIP, command, username, password } = req.body;

        if (!targetIP || !command) {
            return res.status(400).json({ error: 'targetIP, command 필수' });
        }
        if (!isValidIP(targetIP)) {
            return res.status(400).json({ error: 'Invalid IP address format' });
        }

        const creds = await resolveCredentials(username, password);
        if (!creds) {
            return res.status(400).json({ error: '자격 증명이 필요합니다. 기본 자격 증명을 설정하거나 직접 입력하세요.' });
        }

        io.emit('remote-command-started', { targetIP, command });

        const result = await executeRemotePS(targetIP, creds, command);

        // 기록 저장
        db.run(`INSERT INTO remote_commands (target_ip, command, result, status) VALUES (?, ?, ?, ?)`,
            [targetIP, command, JSON.stringify(result), result.Success ? 'success' : 'failed']);

        io.emit('remote-command-completed', { targetIP, command, result });

        if (result.Success) {
            res.json({ success: true, output: result.Output, targetIP });
        } else {
            res.json({ success: false, error: result.Error, targetIP });
        }
    });

    // POST /execute-all - 모든 온라인 PC에 명령 실행
    router.post('/execute-all', authenticateToken, requireRole('admin'), async (req, res) => {
        const { command, targets } = req.body;

        if (!command) {
            return res.status(400).json({ error: 'command 필수' });
        }

        let targetPCs = targets;
        if (!targets || targets.length === 0) {
            targetPCs = await new Promise((resolve) => {
                db.all(`SELECT ip_address FROM pc_status WHERE status = 'online'`, (err, rows) => {
                    resolve(rows?.map(r => r.ip_address).filter(Boolean) || []);
                });
            });
        }

        if (targetPCs.length === 0) {
            return res.json({ success: false, error: '대상 PC가 없습니다', results: [] });
        }

        io.emit('batch-command-started', { command, targets: targetPCs, total: targetPCs.length });

        const creds = await resolveCredentials(null, null);
        if (!creds) {
            return res.status(400).json({ error: '기본 자격 증명을 설정해주세요.' });
        }

        const results = [];
        for (const ip of targetPCs) {
            if (!isValidIP(ip)) {
                results.push({ ip, success: false, error: 'Invalid IP' });
                continue;
            }

            const result = await executeRemotePS(ip, creds, command);
            const entry = {
                ip,
                success: result.Success,
                output: result.Output,
                error: result.Error
            };
            results.push(entry);

            io.emit('batch-command-progress', {
                completed: results.length,
                total: targetPCs.length,
                current: ip,
                result: entry
            });
        }

        io.emit('batch-command-completed', { command, results });
        res.json({ success: true, results, total: targetPCs.length });
    });

    // GET /history - 명령 기록 조회
    router.get('/history', (req, res) => {
        const limit = parseInt(req.query.limit) || 50;
        db.all(`SELECT * FROM remote_commands ORDER BY executed_at DESC LIMIT ?`, [limit], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    // GET /quick-commands - 빠른 명령 목록
    router.get('/quick-commands', (req, res) => {
        const commands = Object.entries(QUICK_COMMANDS).map(([key, cmd]) => ({
            id: key, name: key, command: cmd
        }));
        res.json(commands);
    });

    // POST /quick/:id - 빠른 명령 실행
    router.post('/quick/:id', authenticateToken, requireRole('admin'), async (req, res) => {
        const { id } = req.params;
        const { targetIP, targets, username, password } = req.body;

        const command = QUICK_COMMANDS[id];
        if (!command) {
            return res.status(404).json({ error: '알 수 없는 빠른 명령' });
        }

        const creds = await resolveCredentials(username, password);
        if (!creds) {
            return res.status(400).json({ error: '자격 증명이 필요합니다.' });
        }

        if (targets && targets.length > 0) {
            // Multi-target
            const results = [];
            for (const ip of targets) {
                if (!isValidIP(ip)) { results.push({ ip, success: false, error: 'Invalid IP' }); continue; }
                const r = await executeRemotePS(ip, creds, command);
                results.push({ ip, success: r.Success, output: r.Output, error: r.Error });
            }
            res.json({ success: true, results });
        } else if (targetIP) {
            if (!isValidIP(targetIP)) return res.status(400).json({ error: 'Invalid IP' });
            const r = await executeRemotePS(targetIP, creds, command);
            res.json({ success: r.Success, output: r.Output, error: r.Error, targetIP });
        } else {
            return res.status(400).json({ error: 'targetIP 또는 targets 필요' });
        }
    });

    // Expose helpers for other modules
    router.resolveCredentials = resolveCredentials;
    router.formatUsername = formatUsername;
    router.executeRemotePS = executeRemotePS;

    return router;
};
