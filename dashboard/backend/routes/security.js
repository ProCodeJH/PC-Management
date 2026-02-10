// routes/security.js
// Security, process management, and reporting routes
const express = require('express');
const { isValidIP, sanitizeForPS } = require('../utils/helpers');

module.exports = function ({ db, io, exec, authenticateToken, requireRole }) {
    const router = express.Router();

    // GET /pcs/:ip/processes - 실행 중인 프로세스 목록
    router.get('/pcs/:ip/processes', authenticateToken, (req, res) => {
        const { ip } = req.params;
        if (!isValidIP(ip)) return res.status(400).json({ success: false, error: 'Invalid IP address format' });

        const psCommand = `powershell.exe -Command "Invoke-Command -ComputerName ${ip} -ScriptBlock { Get-Process | Select-Object Name, Id, CPU, WorkingSet64, Description | ConvertTo-Json }"`;
        exec(psCommand, { timeout: 30000 }, (error, stdout, stderr) => {
            if (error) return res.status(500).json({ success: false, error: 'Failed to get processes', details: stderr });
            try {
                const processes = JSON.parse(stdout);
                res.json({ success: true, processes: Array.isArray(processes) ? processes : [processes] });
            } catch {
                res.json({ success: true, processes: [], raw: stdout });
            }
        });
    });

    // POST /pcs/:ip/kill-process - 프로세스 종료
    router.post('/pcs/:ip/kill-process', authenticateToken, requireRole('admin'), (req, res) => {
        const { ip } = req.params;
        const { processName, processId } = req.body;

        if (!isValidIP(ip)) return res.status(400).json({ success: false, error: 'Invalid IP address format' });
        if (!processName && !processId) return res.status(400).json({ success: false, error: 'processName or processId required' });

        // Validate processId is integer, sanitize processName
        if (processId && (isNaN(parseInt(processId)) || parseInt(processId) <= 0)) {
            return res.status(400).json({ success: false, error: 'processId must be a positive integer' });
        }
        const safeProcessName = processName ? sanitizeForPS(processName.replace('.exe', '')) : null;
        const killCmd = processId
            ? `Stop-Process -Id ${parseInt(processId)} -Force`
            : `Stop-Process -Name '${safeProcessName}' -Force`;

        const psCommand = `powershell.exe -Command "Invoke-Command -ComputerName ${ip} -ScriptBlock { ${killCmd} }"`;
        exec(psCommand, { timeout: 15000 }, (error, stdout, stderr) => {
            if (error) return res.status(500).json({ success: false, error: 'Failed to kill process', details: stderr });
            db.run(`INSERT INTO activity_logs (pc_name, user, activity_type, details) VALUES (?, ?, ?, ?)`,
                [ip, 'admin', 'KILL_PROCESS', `Killed: ${processName || processId}`]);
            io.emit('process-killed', { ip, processName, processId });
            res.json({ success: true, message: `Process terminated on ${ip}` });
        });
    });

    // POST /pcs/send-file - 파일/폴더 전송
    router.post('/pcs/send-file', authenticateToken, requireRole('admin'), (req, res) => {
        const { targetIPs, sourcePath, destPath } = req.body;
        if (!targetIPs || !sourcePath || !destPath) {
            return res.status(400).json({ success: false, error: 'targetIPs, sourcePath, destPath required' });
        }

        const results = [];
        let completed = 0;
        const ips = Array.isArray(targetIPs) ? targetIPs : [targetIPs];

        ips.forEach(ip => {
            if (!isValidIP(ip)) {
                results.push({ ip, success: false, error: 'Invalid IP' });
                completed++;
                if (completed === ips.length) res.json({ success: true, results });
                return;
            }
            const safeSrc = sanitizeForPS(sourcePath);
            const safeDest = sanitizeForPS(destPath);
            const uncPath = `\\\\${ip}\\${safeDest.replace(':', '$')}`;
            const psCommand = `powershell.exe -Command "Copy-Item -Path '${safeSrc}' -Destination '${uncPath}' -Recurse -Force"`;

            exec(psCommand, { timeout: 60000 }, (error, stdout, stderr) => {
                results.push({ ip, success: !error, error: error ? stderr : null });
                if (!error) {
                    db.run(`INSERT INTO activity_logs (pc_name, user, activity_type, details) VALUES (?, ?, ?, ?)`,
                        [ip, 'admin', 'FILE_TRANSFER', `Sent: ${sourcePath} → ${destPath}`]);
                }
                completed++;
                if (completed === ips.length) {
                    io.emit('file-transfer-complete', { results });
                    res.json({ success: true, results });
                }
            });
        });
    });

    // POST /pcs/:ip/block-program - 프로그램 실행 차단
    router.post('/pcs/:ip/block-program', authenticateToken, requireRole('admin'), (req, res) => {
        const { ip } = req.params;
        const { programName, blocked } = req.body;
        if (!programName) return res.status(400).json({ success: false, error: 'programName required' });
        if (!isValidIP(ip)) return res.status(400).json({ success: false, error: 'Invalid IP address format' });

        const safeProgramName = sanitizeForPS(programName);
        const blockScript = blocked
            ? `New-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\${safeProgramName}' -Name Debugger -Value 'ntsd -c q' -Force`
            : `Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\${safeProgramName}' -Name Debugger -Force -ErrorAction SilentlyContinue`;

        exec(`powershell.exe -Command "Invoke-Command -ComputerName ${ip} -ScriptBlock { ${blockScript} }"`, { timeout: 15000 }, (error) => {
            if (error) return res.status(500).json({ success: false, error: 'Failed to block program' });
            db.run(`INSERT INTO activity_logs (pc_name, user, activity_type, details) VALUES (?, ?, ?, ?)`,
                [ip, 'admin', blocked ? 'BLOCK_PROGRAM' : 'UNBLOCK_PROGRAM', programName]);
            io.emit('program-blocked', { ip, programName, blocked });
            res.json({ success: true, message: `${programName} ${blocked ? 'blocked' : 'unblocked'} on ${ip}` });
        });
    });

    // GET /pcs/:ip/blocked-programs - 차단된 프로그램 목록
    router.get('/pcs/:ip/blocked-programs', authenticateToken, (req, res) => {
        const { ip } = req.params;
        if (!isValidIP(ip)) return res.status(400).json({ success: false, error: 'Invalid IP' });

        const psCommand = `powershell.exe -Command "Invoke-Command -ComputerName ${ip} -ScriptBlock { Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options' | Where-Object { $_.GetValue('Debugger') } | Select-Object -ExpandProperty PSChildName | ConvertTo-Json }"`;
        exec(psCommand, { timeout: 15000 }, (error, stdout) => {
            if (error) return res.status(500).json({ success: false, error: 'Failed to get blocked programs' });
            try {
                const blocked = JSON.parse(stdout);
                res.json({ success: true, blockedPrograms: Array.isArray(blocked) ? blocked : [blocked] });
            } catch {
                res.json({ success: true, blockedPrograms: [] });
            }
        });
    });

    // POST /pcs/:name/report - 시스템 보고서 수신
    router.post('/pcs/:name/report', (req, res) => {
        const pcName = req.params.name;
        const report = req.body;
        db.run(`INSERT OR REPLACE INTO pc_reports (pc_name, report_data, created_at) VALUES (?, ?, datetime('now'))`,
            [pcName, JSON.stringify(report)], (err) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                io.emit('pc-report', { pcName, report });
                res.json({ success: true, message: 'Report received' });
            });
    });

    // GET /pcs/:name/report - 시스템 보고서 조회
    router.get('/pcs/:name/report', (req, res) => {
        const pcName = req.params.name;
        db.get(`SELECT * FROM pc_reports WHERE pc_name = ?`, [pcName], (err, row) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            if (!row) return res.status(404).json({ success: false, error: 'No report found' });
            res.json({ success: true, pcName, report: JSON.parse(row.report_data), createdAt: row.created_at });
        });
    });

    // POST /pcs/:ip/security/usb-block - USB 차단
    router.post('/pcs/:ip/security/usb-block', authenticateToken, requireRole('admin'), (req, res) => {
        const targetIP = req.params.ip;
        if (!isValidIP(targetIP)) return res.status(400).json({ success: false, error: 'Invalid IP' });
        const { fullBlock, remove, username, password } = req.body;

        let args = '';
        if (remove) args = '-Remove';
        else if (fullBlock) args = '-FullBlock';

        const escapedPassword = (password || '').replace(/'/g, "''").replace(/\$/g, '`$');
        const safeUsername = sanitizeForPS(username || '');
        const script = `
            $secPass = ConvertTo-SecureString '${escapedPassword}' -AsPlainText -Force
            $cred = New-Object System.Management.Automation.PSCredential('${safeUsername}', $secPass)
            Invoke-Command -ComputerName ${targetIP} -Credential $cred -ScriptBlock {
                & 'C:\\ProgramData\\EnterprisePC\\Scripts\\Block-USB.ps1' ${args} -Silent
            }
        `;
        exec(`powershell.exe -Command "${script.replace(/\n/g, ' ')}"`, { timeout: 30000 }, (err) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, action: remove ? 'unblocked' : (fullBlock ? 'fullBlock' : 'executeBlock') });
        });
    });

    // POST /pcs/:ip/security/program-block - 프로그램 차단
    router.post('/pcs/:ip/security/program-block', authenticateToken, requireRole('admin'), (req, res) => {
        const targetIP = req.params.ip;
        if (!isValidIP(targetIP)) return res.status(400).json({ success: false, error: 'Invalid IP' });
        const { action, program, username, password } = req.body;

        let args = '-Silent';
        if (action === 'install') args = '-InstallService -Silent';
        else if (action === 'remove') args = '-Remove -Silent';
        else if (action === 'add' && program) args = `-AddProgram "${sanitizeForPS(program)}" -Silent`;
        else if (action === 'removeProgram' && program) args = `-RemoveProgram "${sanitizeForPS(program)}" -Silent`;

        const escapedPassword = (password || '').replace(/'/g, "''").replace(/\$/g, '`$');
        const safeUsername = sanitizeForPS(username || '');
        const script = `
            $secPass = ConvertTo-SecureString '${escapedPassword}' -AsPlainText -Force
            $cred = New-Object System.Management.Automation.PSCredential('${safeUsername}', $secPass)
            Invoke-Command -ComputerName ${targetIP} -Credential $cred -ScriptBlock {
                & 'C:\\ProgramData\\EnterprisePC\\Scripts\\Program-Block.ps1' ${args}
            }
        `;
        exec(`powershell.exe -Command "${script.replace(/\n/g, ' ')}"`, { timeout: 30000 }, (err) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, action });
        });
    });

    // POST /pcs/:ip/security/get-report - 원격 시스템 보고서 생성
    router.post('/pcs/:ip/security/get-report', authenticateToken, (req, res) => {
        const targetIP = req.params.ip;
        if (!isValidIP(targetIP)) return res.status(400).json({ success: false, error: 'Invalid IP' });
        const { username, password } = req.body;

        const escapedPassword = (password || '').replace(/'/g, "''").replace(/\$/g, '`$');
        const safeUsername = sanitizeForPS(username || '');
        const script = `
            $secPass = ConvertTo-SecureString '${escapedPassword}' -AsPlainText -Force
            $cred = New-Object System.Management.Automation.PSCredential('${safeUsername}', $secPass)
            Invoke-Command -ComputerName ${targetIP} -Credential $cred -ScriptBlock {
                & 'C:\\ProgramData\\EnterprisePC\\Scripts\\Get-SystemReport.ps1' -Format JSON -Silent
            } | ConvertTo-Json -Depth 10
        `;
        exec(`powershell.exe -Command "${script.replace(/\n/g, ' ')}"`, { timeout: 60000, maxBuffer: 1024 * 1024 * 10 }, (err, stdout) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            try {
                const report = JSON.parse(stdout);
                io.emit('pc-report', { pcName: targetIP, report });
                res.json({ success: true, report });
            } catch {
                res.json({ success: true, rawOutput: stdout });
            }
        });
    });

    return router;
};
