// =====================================================
// 🖥️ Enterprise PC Agent v2.0
// 학생 PC에서 실행 — 서버와 WebSocket 실시간 통신
// =====================================================

const { io } = require('socket.io-client');
const os = require('os');
const { exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── 설정 ──────────────────────────────────────────────
const CONFIG = {
    SERVER_URL: process.env.SERVER_URL || 'http://localhost:3001',
    REPORT_INTERVAL: 10000,       // 상태 보고 간격 (10초)
    RECONNECT_DELAY: 5000,        // 재연결 간격 (5초)
    SCREENSHOT_QUALITY: 60,       // 스크린샷 품질 (1-100)
    STREAM_FPS: 5,                // 스트리밍 FPS (초기값)
    STREAM_QUALITY: 40,           // 스트리밍 JPEG 품질 (1-100)
    STREAM_MAX_FPS: 10,           // 최대 FPS
    STREAM_MIN_FPS: 2,            // 최소 FPS
    STREAM_MAX_SIZE: 150000,      // 프레임 최대 크기 (bytes) - 초과 시 품질 자동 감소
    VERBOSE: process.argv.includes('--verbose'),
    PC_NAME: os.hostname(),
    IP_ADDRESS: getLocalIP(),
};

// ── 차단 프로그램 목록 (런타임 상태) ─────────────────────
const blockedPrograms = new Set(); // program_name (lowercase, no .exe required)
let blockMonitorInterval = null;

function startBlockMonitor() {
    if (blockMonitorInterval) return;
    blockMonitorInterval = setInterval(() => {
        if (blockedPrograms.size === 0) return;
        blockedPrograms.forEach(prog => {
            exec(`tasklist /FI "IMAGENAME eq ${prog}" /NH /FO CSV`, (err, out) => {
                if (out && out.toLowerCase().includes(prog.toLowerCase())) {
                    exec(`taskkill /IM "${prog}" /F`, () => {});
                }
            });
        });
    }, 3000); // 3초마다 체크
}

function stopBlockMonitor() {
    if (blockMonitorInterval) { clearInterval(blockMonitorInterval); blockMonitorInterval = null; }
}

// ── 유틸 ──────────────────────────────────────────────
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

function log(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('ko-KR');
    const icons = { info: 'ℹ️', success: '✅', error: '❌', warn: '⚠️', cmd: '🔧' };
    console.log(`[${time}] ${icons[type] || 'ℹ️'} ${msg}`);
}

function getCPUUsage() {
    return new Promise((resolve) => {
        const cpus1 = os.cpus();
        setTimeout(() => {
            const cpus2 = os.cpus();
            let totalIdle = 0, totalTick = 0;
            for (let i = 0; i < cpus2.length; i++) {
                const c1 = cpus1[i].times;
                const c2 = cpus2[i].times;
                const idle = c2.idle - c1.idle;
                const total = (c2.user - c1.user) + (c2.nice - c1.nice) + (c2.sys - c1.sys) + (c2.irq - c1.irq) + idle;
                totalIdle += idle;
                totalTick += total;
            }
            resolve(Math.round((1 - totalIdle / totalTick) * 100 * 10) / 10);
        }, 1000);
    });
}

function getMemoryUsage() {
    const total = os.totalmem();
    const free = os.freemem();
    return Math.round((1 - free / total) * 100 * 10) / 10;
}

// ── 프로세스 목록 ─────────────────────────────────────
function getProcessList() {
    return new Promise((resolve) => {
        if (process.platform === 'win32') {
            exec('tasklist /FO CSV /NH', { maxBuffer: 1024 * 1024 }, (err, stdout) => {
                if (err) { resolve([]); return; }
                const processes = stdout.trim().split('\n')
                    .filter(line => line.trim())
                    .map(line => {
                        const parts = line.match(/"([^"]*)"/g);
                        if (!parts || parts.length < 5) return null;
                        return {
                            Name: parts[0].replace(/"/g, ''),
                            Id: parseInt(parts[1].replace(/"/g, '')),
                            Memory: parts[4].replace(/"/g, '').replace(/[, K]/g, '')
                        };
                    })
                    .filter(p => p && p.Name);
                resolve(processes);
            });
        } else {
            exec('ps -eo comm,pid,%mem --sort=-%mem | head -30', (err, stdout) => {
                if (err) { resolve([]); return; }
                resolve(stdout.trim().split('\n').slice(1).map(line => {
                    const parts = line.trim().split(/\s+/);
                    return { Name: parts[0], Id: parseInt(parts[1]), Memory: parts[2] };
                }));
            });
        }
    });
}

// ── 스크린샷 캡처 ─────────────────────────────────────
async function captureScreenshot() {
    try {
        const screenshot = require('screenshot-desktop');
        const imgBuffer = await screenshot({ format: 'jpg' });
        return imgBuffer.toString('base64');
    } catch (err) {
        // Fallback: PowerShell 스크린 캡처 (Windows)
        if (process.platform === 'win32') {
            try {
                const tmpPath = path.join(os.tmpdir(), `screenshot_${Date.now()}.jpg`);
                execSync(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height); $graphics = [System.Drawing.Graphics]::FromImage($bitmap); $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size); $bitmap.Save('${tmpPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Jpeg); $graphics.Dispose(); $bitmap.Dispose()"`, { timeout: 10000 });
                const buffer = fs.readFileSync(tmpPath);
                fs.unlinkSync(tmpPath);
                return buffer.toString('base64');
            } catch (e) {
                log(`스크린샷 fallback 실패: ${e.message}`, 'error');
                return null;
            }
        }
        log(`스크린샷 실패: ${err.message}`, 'error');
        return null;
    }
}

// ── 명령 실행 ─────────────────────────────────────────
function executeCommand(command, params = {}) {
    log(`명령 수신: ${command}`, 'cmd');

    switch (command) {
        case 'shutdown':
            log('시스템 종료 명령 실행', 'warn');
            if (process.platform === 'win32') exec('shutdown /s /t 30 /c "관리자가 종료를 요청했습니다"');
            else exec('shutdown -h +1');
            return { success: true, message: '30초 후 종료됩니다' };

        case 'restart':
            log('시스템 재시작 명령 실행', 'warn');
            if (process.platform === 'win32') exec('shutdown /r /t 30 /c "관리자가 재시작을 요청했습니다"');
            else exec('shutdown -r +1');
            return { success: true, message: '30초 후 재시작됩니다' };

        case 'logoff':
            log('로그오프 명령 실행', 'warn');
            if (process.platform === 'win32') exec('logoff');
            else exec('pkill -KILL -u $(whoami)');
            return { success: true, message: '로그오프 실행' };

        case 'lock':
            log('화면 잠금 명령 실행', 'cmd');
            if (process.platform === 'win32') exec('rundll32.exe user32.dll,LockWorkStation');
            return { success: true, message: '화면 잠금' };

        case 'message':
            const msg = params.message || '관리자 메시지';
            log(`메시지 표시: ${msg}`, 'cmd');
            if (process.platform === 'win32') {
                exec(`msg * /TIME:30 "${msg.replace(/"/g, '\\"')}"`);
            }
            return { success: true, message: '메시지 표시 완료' };

        case 'kill-process':
            const procName = params.processName;
            if (!procName) return { success: false, message: '프로세스 이름 없음' };
            log(`프로세스 종료: ${procName}`, 'cmd');
            if (process.platform === 'win32') exec(`taskkill /IM "${procName}" /F`);
            else exec(`pkill -f "${procName}"`);
            return { success: true, message: `${procName} 종료됨` };

        case 'open-url':
            const url = params.url;
            if (!url) return { success: false, message: 'URL 없음' };
            log(`URL 열기: ${url}`, 'cmd');
            if (process.platform === 'win32') exec(`start "" "${url}"`);
            else exec(`xdg-open "${url}"`);
            return { success: true, message: `${url} 열기 완료` };

        case 'run':
            const cmd = params.cmd;
            if (!cmd) return { success: false, message: '명령어 없음' };
            log(`커스텀 명령 실행: ${cmd}`, 'cmd');
            exec(cmd, { timeout: 30000 }, (err, stdout) => {
                if (err) log(`명령 실행 오류: ${err.message}`, 'error');
            });
            return { success: true, message: `실행: ${cmd}` };

        case 'screenshot':
            // 비동기 처리 — 결과는 별도 이벤트로 전송
            return { success: true, message: '스크린샷 캡처 시작' };

        case 'cancel-shutdown':
            if (process.platform === 'win32') exec('shutdown /a');
            return { success: true, message: '종료 취소' };

        default:
            log(`알 수 없는 명령: ${command}`, 'warn');
            return { success: false, message: `알 수 없는 명령: ${command}` };
    }
}

// ── 사이트 차단 ───────────────────────────────────────
function blockSite(domain) {
    if (process.platform !== 'win32') return { success: false, message: 'Windows만 지원' };

    const hostsPath = 'C:\\Windows\\System32\\drivers\\etc\\hosts';
    try {
        const content = fs.readFileSync(hostsPath, 'utf-8');
        if (content.includes(domain)) {
            return { success: true, message: `${domain} 이미 차단됨` };
        }
        fs.appendFileSync(hostsPath, `\n127.0.0.1 ${domain}\n127.0.0.1 www.${domain}\n`);
        // DNS 캐시 클리어
        exec('ipconfig /flushdns');
        log(`사이트 차단: ${domain}`, 'success');
        return { success: true, message: `${domain} 차단 완료` };
    } catch (err) {
        log(`사이트 차단 실패 (관리자 권한 필요): ${err.message}`, 'error');
        return { success: false, message: '관리자 권한이 필요합니다' };
    }
}

function unblockSite(domain) {
    if (process.platform !== 'win32') return { success: false, message: 'Windows만 지원' };

    const hostsPath = 'C:\\Windows\\System32\\drivers\\etc\\hosts';
    try {
        let content = fs.readFileSync(hostsPath, 'utf-8');
        content = content.replace(new RegExp(`\\n?127\\.0\\.0\\.1\\s+${domain.replace(/\./g, '\\.')}`, 'g'), '');
        content = content.replace(new RegExp(`\\n?127\\.0\\.0\\.1\\s+www\\.${domain.replace(/\./g, '\\.')}`, 'g'), '');
        fs.writeFileSync(hostsPath, content);
        exec('ipconfig /flushdns');
        log(`사이트 차단 해제: ${domain}`, 'success');
        return { success: true, message: `${domain} 차단 해제` };
    } catch (err) {
        return { success: false, message: '관리자 권한이 필요합니다' };
    }
}

// ══════════════════════════════════════════════════════
// 메인 에이전트
// ══════════════════════════════════════════════════════
class PCAgent {
    constructor() {
        this.socket = null;
        this.statusInterval = null;
        this.streamInterval = null;
        this.streaming = false;
        this.streamFPS = CONFIG.STREAM_FPS;
        this.streamQuality = CONFIG.STREAM_QUALITY;
        this.connected = false;

        this.printBanner();
        this.connect();
    }

    printBanner() {
        console.log('');
        console.log('╔══════════════════════════════════════════╗');
        console.log('║     🖥️  Enterprise PC Agent v2.0         ║');
        console.log('╠══════════════════════════════════════════╣');
        console.log(`║  PC Name:  ${CONFIG.PC_NAME.padEnd(29)}║`);
        console.log(`║  IP:       ${CONFIG.IP_ADDRESS.padEnd(29)}║`);
        console.log(`║  Server:   ${CONFIG.SERVER_URL.padEnd(29)}║`);
        console.log('╚══════════════════════════════════════════╝');
        console.log('');
    }

    connect() {
        log(`서버 연결 중: ${CONFIG.SERVER_URL}...`);

        this.socket = io(CONFIG.SERVER_URL, {
            reconnection: true,
            reconnectionDelay: CONFIG.RECONNECT_DELAY,
            reconnectionAttempts: Infinity,
            timeout: 10000,
            transports: ['websocket', 'polling'],
        });

        this.setupEvents();
    }

    setupEvents() {
        // ── 연결 성공 ──
        this.socket.on('connect', () => {
            this.connected = true;
            log('서버 연결 성공!', 'success');

            // PC 등록
            this.socket.emit('register-pc', {
                pcName: CONFIG.PC_NAME,
                ipAddress: CONFIG.IP_ADDRESS,
            });

            // 로그인 활동 기록
            this.socket.emit('log-activity', {
                pcName: CONFIG.PC_NAME,
                user: os.userInfo().username,
                activityType: 'login',
                details: `에이전트 연결 (${CONFIG.IP_ADDRESS})`,
            });

            // 상태 보고 시작
            this.startStatusReport();
        });

        // ── 연결 끊김 ──
        this.socket.on('disconnect', (reason) => {
            this.connected = false;
            log(`서버 연결 끊김: ${reason}`, 'warn');
            this.stopStatusReport();
        });

        // ── 재연결 시도 ──
        this.socket.on('reconnect_attempt', (attempt) => {
            if (CONFIG.VERBOSE || attempt % 5 === 0) {
                log(`재연결 시도 #${attempt}...`, 'warn');
            }
        });

        // ── 명령 수신 ──
        this.socket.on(`command-${CONFIG.PC_NAME}`, async (data) => {
            const { command, params } = data;
            log(`명령 수신: ${command}`, 'cmd');

            const result = executeCommand(command, params || {});

            // 스크린샷 명령은 별도 처리
            if (command === 'screenshot') {
                const imgData = await captureScreenshot();
                if (imgData) {
                    const filename = `${CONFIG.PC_NAME}_${Date.now()}.jpg`;
                    this.socket.emit('screenshot', {
                        pcName: CONFIG.PC_NAME,
                        filename,
                        fileData: imgData,
                    });
                    log('스크린샷 전송 완료', 'success');
                }
            }

            // 명령 결과를 활동 로그로 전송
            this.socket.emit('log-activity', {
                pcName: CONFIG.PC_NAME,
                user: 'system',
                activityType: 'command',
                details: `${command}: ${result.message}`,
            });
        });

        // ── 사이트 차단 명령 ──
        this.socket.on(`block-site-${CONFIG.PC_NAME}`, (data) => {
            const { domain, blocked } = data;
            if (blocked) {
                blockSite(domain);
            } else {
                unblockSite(domain);
            }
        });

        // ── 프로그램 차단/해제 명령 ──
        this.socket.on(`block-program-${CONFIG.PC_NAME}`, (data) => {
            const { programName, blocked } = data;
            const name = programName.endsWith('.exe') ? programName : programName + '.exe';
            if (blocked) {
                blockedPrograms.add(name.toLowerCase());
                startBlockMonitor();
                // Kill immediately if running
                exec(`taskkill /IM "${name}" /F`, () => {});
                console.log(`[BLOCK] ${name} 차단됨`);
            } else {
                blockedPrograms.delete(name.toLowerCase());
                if (blockedPrograms.size === 0) stopBlockMonitor();
                console.log(`[BLOCK] ${name} 해제됨`);
            }
        });


        // ── 차단 프로그램 목록 요청 ──
        this.socket.on(`get-blocked-programs-${CONFIG.PC_NAME}`, (callback) => {
            if (typeof callback === 'function') {
                callback({ success: true, blockedPrograms: [...blockedPrograms] });
            }
        });

        // ── 프로세스 목록 요청 ──
        this.socket.on(`get-processes-${CONFIG.PC_NAME}`, async (callback) => {
            const processes = await getProcessList();
            if (typeof callback === 'function') {
                callback({ success: true, processes });
            }
        });

        // ── 에러 ──
        this.socket.on('connect_error', (err) => {
            if (CONFIG.VERBOSE) {
                log(`연결 오류: ${err.message}`, 'error');
            }
        });

        // ── 스트리밍 시작 요청 ──
        this.socket.on(`start-stream-${CONFIG.PC_NAME}`, (data) => {
            const fps = data?.fps || CONFIG.STREAM_FPS;
            const quality = data?.quality || CONFIG.STREAM_QUALITY;
            log(`스트리밍 시작 요청 (FPS: ${fps}, Quality: ${quality})`, 'cmd');
            this.startStreaming(fps, quality);
        });

        // ── 스트리밍 중단 요청 ──
        this.socket.on(`stop-stream-${CONFIG.PC_NAME}`, () => {
            log('스트리밍 중단 요청', 'cmd');
            this.stopStreaming();
        });
    }

    // ── 상태 보고 ─────────────────────────────────────
    startStatusReport() {
        this.stopStatusReport(); // 중복 방지

        const report = async () => {
            try {
                const cpuUsage = await getCPUUsage();
                const memoryUsage = getMemoryUsage();

                this.socket.emit('update-status', {
                    pcName: CONFIG.PC_NAME,
                    ipAddress: CONFIG.IP_ADDRESS,
                    cpuUsage,
                    memoryUsage,
                });

                if (CONFIG.VERBOSE) {
                    log(`상태 보고 — CPU: ${cpuUsage}% | MEM: ${memoryUsage}%`);
                }
            } catch (err) {
                log(`상태 보고 오류: ${err.message}`, 'error');
            }
        };

        report(); // 즉시 1회 보고
        this.statusInterval = setInterval(report, CONFIG.REPORT_INTERVAL);
    }

    stopStatusReport() {
        if (this.statusInterval) {
            clearInterval(this.statusInterval);
            this.statusInterval = null;
        }
    }

    // ── 실시간 스트리밍 ────────────────────────────────
    startStreaming(fps = CONFIG.STREAM_FPS, quality = CONFIG.STREAM_QUALITY) {
        this.stopStreaming(); // 중복 방지
        this.streaming = true;
        this.streamFPS = Math.min(CONFIG.STREAM_MAX_FPS, Math.max(CONFIG.STREAM_MIN_FPS, fps));
        this.streamQuality = Math.min(80, Math.max(10, quality));

        log(`🎬 스트리밍 시작 — FPS: ${this.streamFPS}, Quality: ${this.streamQuality}%`, 'success');

        const captureAndSend = async () => {
            if (!this.streaming || !this.connected) return;

            try {
                const startTime = Date.now();

                // 스크린 캡처
                let frameData;
                try {
                    const screenshot = require('screenshot-desktop');
                    const imgBuffer = await screenshot({ format: 'jpg', quality: this.streamQuality });
                    frameData = imgBuffer.toString('base64');
                } catch (e) {
                    // PowerShell fallback
                    if (process.platform === 'win32') {
                        const tmpPath = path.join(os.tmpdir(), `stream_${Date.now()}.jpg`);
                        try {
                            execSync(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $b = New-Object System.Drawing.Bitmap($s.Width, $s.Height); $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen($s.Location, [System.Drawing.Point]::Empty, $s.Size); $ep = New-Object System.Drawing.Imaging.EncoderParameters(1); $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, ${this.streamQuality}); $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageDecoders() | Where-Object { $_.FormatID -eq [System.Drawing.Imaging.ImageFormat]::Jpeg.Guid }; $b.Save('${tmpPath.replace(/\\/g, '\\\\')}', $codec, $ep); $g.Dispose(); $b.Dispose()"`, { timeout: 5000 });
                            const buffer = fs.readFileSync(tmpPath);
                            fs.unlinkSync(tmpPath);
                            frameData = buffer.toString('base64');
                        } catch (e2) { return; }
                    } else { return; }
                }

                if (!frameData) return;

                const frameSize = frameData.length;
                const captureTime = Date.now() - startTime;

                // 적응형 품질 조정
                if (frameSize > CONFIG.STREAM_MAX_SIZE && this.streamQuality > 15) {
                    this.streamQuality = Math.max(15, this.streamQuality - 5);
                    if (CONFIG.VERBOSE) log(`품질 감소 → ${this.streamQuality}% (프레임: ${(frameSize / 1024).toFixed(0)}KB)`);
                } else if (frameSize < CONFIG.STREAM_MAX_SIZE * 0.5 && this.streamQuality < 60) {
                    this.streamQuality = Math.min(60, this.streamQuality + 2);
                }

                // 적응형 FPS 조정 (캡처 시간 기반)
                const targetInterval = 1000 / this.streamFPS;
                if (captureTime > targetInterval * 0.8 && this.streamFPS > CONFIG.STREAM_MIN_FPS) {
                    this.streamFPS = Math.max(CONFIG.STREAM_MIN_FPS, this.streamFPS - 1);
                    if (CONFIG.VERBOSE) log(`FPS 감소 → ${this.streamFPS} (캡처: ${captureTime}ms)`);
                }

                // 프레임 전송
                this.socket.emit('screen-frame', {
                    pcName: CONFIG.PC_NAME,
                    frame: frameData,
                    timestamp: Date.now(),
                    fps: this.streamFPS,
                    quality: this.streamQuality,
                    size: frameSize,
                });

            } catch (err) {
                if (CONFIG.VERBOSE) log(`스트리밍 오류: ${err.message}`, 'error');
            }

            // 다음 프레임 예약
            if (this.streaming) {
                this.streamTimeout = setTimeout(captureAndSend, 1000 / this.streamFPS);
            }
        };

        captureAndSend();
    }

    stopStreaming() {
        if (this.streaming) {
            log('🎬 스트리밍 중단', 'warn');
        }
        this.streaming = false;
        if (this.streamTimeout) {
            clearTimeout(this.streamTimeout);
            this.streamTimeout = null;
        }
    }
}

// ── 시작 ──────────────────────────────────────────────
const agent = new PCAgent();

// Graceful shutdown
process.on('SIGINT', () => {
    log('에이전트 종료 중...', 'warn');
    if (agent.socket) {
        agent.socket.emit('log-activity', {
            pcName: CONFIG.PC_NAME,
            user: os.userInfo().username,
            activityType: 'logout',
            details: '에이전트 종료',
        });
        agent.socket.disconnect();
    }
    process.exit(0);
});

process.on('SIGTERM', () => process.emit('SIGINT'));
