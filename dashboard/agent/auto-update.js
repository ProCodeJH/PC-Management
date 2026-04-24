// auto-update.js — Agent self-update for classroom PC management
// Trusted local network only (192.168.x.x)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function checkAndUpdate(serverUrl, currentVersion, agentDir, logger) {
    const versionUrl = serverUrl + '/api/agent-version';
    http.get(versionUrl, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
            try {
                const info = JSON.parse(data);
                if (!info.version || info.version === currentVersion) return;
                logger('Update: v' + currentVersion + ' -> v' + info.version);
                downloadAndApply(serverUrl + (info.url || '/agent-latest.js'), agentDir, logger);
            } catch (e) { /* skip */ }
        });
    }).on('error', () => {});
}

function downloadAndApply(dlUrl, agentDir, logger) {
    const tmpPath = path.join(agentDir, 'agent-new.js');
    const agentPath = path.join(agentDir, 'agent.js');
    const file = fs.createWriteStream(tmpPath);
    http.get(dlUrl, (res) => {
        if (res.statusCode !== 200) {
            file.close();
            try { fs.unlinkSync(tmpPath); } catch (e) { /* ok */ }
            return;
        }
        res.pipe(file);
        file.on('finish', () => {
            file.close();
            const content = fs.readFileSync(tmpPath, 'utf-8');
            if (content.length < 1000 || !content.includes('AGENT_VERSION')) {
                try { fs.unlinkSync(tmpPath); } catch (e) { /* ok */ }
                return;
            }
            try {
                fs.copyFileSync(tmpPath, agentPath);
                fs.unlinkSync(tmpPath);
                logger('Updated! Restarting...');
                const vbs = path.join(agentDir, 'start-hidden.vbs');
                if (fs.existsSync(vbs)) {
                    // execFile with wscript is safe — path is hardcoded from agent install dir
                    execFile('wscript.exe', [vbs], { timeout: 5000 }, () => {});
                }
                setTimeout(() => process.exit(0), 2000);
            } catch (e) {
                logger('Update failed: ' + e.message);
            }
        });
    }).on('error', () => {
        file.close();
        try { fs.unlinkSync(tmpPath); } catch (e) { /* ok */ }
    });
}

module.exports = { checkAndUpdate };
