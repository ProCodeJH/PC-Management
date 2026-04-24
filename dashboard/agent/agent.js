// =====================================================
// Enterprise PC Agent v3.21 — Self-healing edition
// - Atomic update (renameSync, same-volume)
// - Update lock auto-release (5min)
// - HTTP download timeout (60s)
// - Memory watchdog (RSS > 600MB sustained 3min -> self-exit)
// - Crash counter (5+ uncaught in 10min -> self-exit, watchdog reboots)
// - hostname-IP suffix for unique PC identification
// =====================================================

const { io } = require('socket.io-client');
const os = require('os');
const { exec, execSync, execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
// Auto-update is inline (single-file deployment)

// ── Load .env manually (no dotenv dependency needed) ──
function loadEnv() {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    try {
        const content = fs.readFileSync(envPath, 'utf-8');
        content.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const eq = trimmed.indexOf('=');
            if (eq === -1) return;
            const key = trimmed.substring(0, eq).trim();
            const val = trimmed.substring(eq + 1).trim();
            if (!process.env[key]) process.env[key] = val;
        });
    } catch (e) { /* ok */ }
}
loadEnv();

// ── Config ───────────────────────────────────────────
const _ip = getLocalIP();
const _ipSuffix = _ip.split('.').pop() || '0';
const CONFIG = {
    SERVER_URL: process.env.SERVER_URL || 'http://192.168.0.5:3001',
    REPORT_INTERVAL: 10000,
    RECONNECT_DELAY: 5000,
    // Streaming defaults tuned for 1080p high quality (live view default)
    STREAM_FPS: 15,          // 15 fps — smooth enough for monitoring, half bandwidth of 30
    STREAM_QUALITY: 90,      // slider value (maps to low q:v for high quality)
    STREAM_MAX_FPS: 30,
    STREAM_MIN_FPS: 2,
    VERBOSE: process.argv.includes('--verbose'),
    PC_NAME: process.env.PC_NAME || (os.hostname() + '-' + _ipSuffix),
    IP_ADDRESS: _ip,
    AGENT_VERSION: '3.21',
};

// ── Blocked programs (runtime) ───────────────────────
const blockedPrograms = new Set();
let blockMonitorInterval = null;

// Flag: when true, agent is using powershell internally — skip killing it
let _agentUsingPowershell = false;

// Agent-internal processes that must never be killed.
// Killing these mid-operation crashes the agent or its helpers.
const AGENT_PROTECTED_PROCS = new Set(['cmd.exe', 'wscript.exe', 'node.exe', 'conhost.exe']);

// Windows system processes that must NEVER be killed (BSOD/desktop crash).
// Used by exam mode to only kill user-space applications.
const SYSTEM_PROTECTED_PROCS = new Set([
    'system', 'system idle process', 'registry', 'smss.exe', 'csrss.exe',
    'wininit.exe', 'winlogon.exe', 'services.exe', 'lsass.exe', 'lsaiso.exe',
    'svchost.exe', 'dwm.exe', 'explorer.exe', 'sihost.exe', 'taskhostw.exe',
    'runtimebroker.exe', 'searchhost.exe', 'startmenuexperiencehost.exe',
    'textinputhost.exe', 'ctfmon.exe', 'fontdrvhost.exe', 'dllhost.exe',
    'conhost.exe', 'audiodg.exe', 'spoolsv.exe', 'searchindexer.exe',
    'securityhealthservice.exe', 'sgrmbroker.exe', 'memcompression',
    'shellexperiencehost.exe', 'applicationframehost.exe', 'lockapp.exe',
]);

function startBlockMonitor() {
    if (blockMonitorInterval) return;
    blockMonitorInterval = setInterval(() => {
        if (blockedPrograms.size === 0) return;
        // Query running processes ONCE, then kill only blocked ones (instead of 50 taskkill spawns)
        const tasklistExe = path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'tasklist.exe');
        const taskkillExe = path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'taskkill.exe');
        execFile(tasklistExe, ['/FO', 'CSV', '/NH'], { timeout: 5000 }, (err, stdout) => {
            if (err || !stdout) return;
            const running = new Set();
            for (const line of stdout.split('\n')) {
                const m = line.match(/"([^"]+)"/);
                if (m) running.add(m[1].toLowerCase());
            }
            blockedPrograms.forEach(prog => {
                if (!running.has(prog)) return;
                if (AGENT_PROTECTED_PROCS.has(prog)) return;
                if (prog === 'powershell.exe' && _agentUsingPowershell) return;
                execFile(taskkillExe, ['/IM', prog, '/F'], { timeout: 5000 }, (killErr) => {
                    if (!killErr && _agentSocket) {
                        log('Blocked program killed: ' + prog, 'warn');
                        const violationTs = Date.now();
                        _agentSocket.emit('block-violation', {
                            pcName: CONFIG.PC_NAME,
                            program: prog,
                            timestamp: violationTs,
                        });
                        const lastShot = _violationShotCache.get(prog) || 0;
                        if (violationTs - lastShot > 60000) {
                            _violationShotCache.set(prog, violationTs);
                            captureScreenshot().then(base64 => {
                                if (base64 && _agentSocket && _agentSocket.connected) {
                                    _agentSocket.emit('screenshot', {
                                        pcName: CONFIG.PC_NAME,
                                        filename: 'violation_' + prog.replace(/\./g, '_') + '_' + violationTs + '.jpg',
                                        fileData: base64,
                                        reason: 'block-violation',
                                        program: prog,
                                    });
                                }
                            }).catch(() => {});
                        }
                    }
                });
            });
        });
    }, 3000);
}

// Throttle map: programName -> last screenshot timestamp
const _violationShotCache = new Map();
// Purge stale entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, ts] of _violationShotCache) {
        if (now - ts > 120_000) _violationShotCache.delete(key);
    }
}, 300_000);
// Reference to socket for block monitor alerts
let _agentSocket = null;

function stopBlockMonitor() {
    if (blockMonitorInterval) { clearInterval(blockMonitorInterval); blockMonitorInterval = null; }
}

// ── Wallpaper Lock ──────────────────────────────────
// Downloads branded wallpaper from the management server (CONFIG.SERVER_URL/wallpaper.png)
// and enforces it as the desktop background. Falls back to solid black if download fails.
// Wallpaper is cached locally at C:\ProgramData\PCAgent\wallpaper.png.
let wallpaperLocked = false;
let wallpaperInterval = null;
const WALLPAPER_DIR = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'PCAgent');
const WALLPAPER_PATH = path.join(WALLPAPER_DIR, 'wallpaper.png');

function downloadWallpaper(callback) {
    if (fs.existsSync(WALLPAPER_PATH)) return callback(true);
    try {
        if (!fs.existsSync(WALLPAPER_DIR)) fs.mkdirSync(WALLPAPER_DIR, { recursive: true });
    } catch (e) {
        log('Cannot create wallpaper dir: ' + e.message, 'error');
        return callback(false);
    }
    const http = require('http');
    const wpUrl = CONFIG.SERVER_URL + '/wallpaper.png';
    log('Downloading wallpaper from server', 'cmd');
    const file = fs.createWriteStream(WALLPAPER_PATH);
    http.get(wpUrl, (res) => {
        if (res.statusCode !== 200) {
            file.close();
            try { fs.unlinkSync(WALLPAPER_PATH); } catch (e) { /* ok */ }
            log('Wallpaper download HTTP ' + res.statusCode, 'error');
            return callback(false);
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); log('Wallpaper downloaded', 'success'); callback(true); });
    }).on('error', (err) => {
        file.close();
        try { fs.unlinkSync(WALLPAPER_PATH); } catch (e) { /* ok */ }
        log('Wallpaper download error: ' + err.message, 'error');
        callback(false);
    });
}

function forceWallpaper() {
    const wpExists = fs.existsSync(WALLPAPER_PATH);
    const wpPath = wpExists ? WALLPAPER_PATH : '';
    const wpEsc = wpPath.replace(/\\/g, '\\\\');
    const style = wpExists ? '10' : '0';
    const ps = [
        `Set-ItemProperty 'HKCU:\\Control Panel\\Desktop' -Name Wallpaper -Value '${wpEsc}'`,
        `Set-ItemProperty 'HKCU:\\Control Panel\\Desktop' -Name WallpaperStyle -Value '${style}'`,
        `Set-ItemProperty 'HKCU:\\Control Panel\\Desktop' -Name TileWallpaper -Value '0'`,
        `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class W{[DllImport("user32.dll",CharSet=CharSet.Auto)]public static extern int SystemParametersInfo(int a,int b,string c,int d);}'`,
        `[W]::SystemParametersInfo(20, 0, '${wpEsc}', 3)`,
    ].join('; ');
    _agentUsingPowershell = true;
    exec(`powershell -NoProfile -Command "${ps}"`, { timeout: 10000 }, (err) => {
        _agentUsingPowershell = false;
        if (err) log('Wallpaper set error: ' + err.message, 'error');
        else log('Wallpaper applied', 'success');
    });
}

function startWallpaperLock() {
    if (wallpaperInterval) return;
    downloadWallpaper((ok) => {
        if (!ok) log('Using black fallback wallpaper', 'warn');
        forceWallpaper();
    });
    wallpaperInterval = setInterval(() => {
        if (_agentUsingPowershell) return; // skip check while applying
        _agentUsingPowershell = true;
        exec('powershell -NoProfile -Command "(Get-ItemProperty \'HKCU:\\Control Panel\\Desktop\').Wallpaper"',
            { timeout: 5000 }, (err, stdout) => {
                _agentUsingPowershell = false;
                const current = (stdout || '').trim().toLowerCase();
                const expected = fs.existsSync(WALLPAPER_PATH) ? WALLPAPER_PATH.toLowerCase() : '';
                if (current !== expected) {
                    log('Wallpaper changed, restoring', 'warn');
                    forceWallpaper();
                }
            });
    }, 3000);
    log('Wallpaper lock ON', 'cmd');
}

function stopWallpaperLock() {
    if (wallpaperInterval) { clearInterval(wallpaperInterval); wallpaperInterval = null; }
    log('Wallpaper lock OFF', 'cmd');
}

// ── Utils ────────────────────────────────────────────
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    let fallback = '127.0.0.1';
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                if (iface.address.startsWith('192.168.')) return iface.address;
                if (fallback === '127.0.0.1') fallback = iface.address;
            }
        }
    }
    return fallback;
}

function getMACAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
                return iface.mac;
            }
        }
    }
    return '';
}

function log(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('ko-KR');
    const tags = { info: '[INFO]', success: '[OK]', error: '[ERR]', warn: '[WARN]', cmd: '[CMD]' };
    console.log(`[${time}] ${tags[type] || '[INFO]'} ${msg}`);
}

// Active window detection via PowerShell + Win32 API.
// Uses Add-Type with semicolons (NOT here-strings) so it works in -Command mode.
// PowerShell here-strings (@"..."@) require real newlines, which break in -Command.
const _ACTIVE_WINDOW_PS = [
    'Add-Type -Language CSharp -TypeDefinition \'using System;using System.Runtime.InteropServices;using System.Text;public class FgW{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll",CharSet=CharSet.Auto)]public static extern int GetWindowText(IntPtr h,StringBuilder t,int n);[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);}\'',
    '$h=[FgW]::GetForegroundWindow()',
    '$sb=New-Object Text.StringBuilder 256',
    '[FgW]::GetWindowText($h,$sb,256)|Out-Null',
    '$wpid=0;[FgW]::GetWindowThreadProcessId($h,[ref]$wpid)|Out-Null',
    '$p=Get-Process -Id $wpid -EA SilentlyContinue',
    'Write-Output "$($p.ProcessName)|$($sb.ToString())"',
].join(';');

function getActiveWindow() {
    return new Promise((resolve) => {
        execFile(PS_EXE, ['-NoProfile', '-NonInteractive', '-Command', _ACTIVE_WINDOW_PS],
            { timeout: 4000 }, (err, stdout) => {
            if (err) return resolve(null);
            const [proc, title] = (stdout || '').trim().split('|', 2);
            resolve(proc && title ? { process: proc, title } : null);
        });
    });
}

// Non-blocking CPU usage: stores previous sample, computes delta instantly on next call.
// First call returns 0 (no previous sample). Subsequent calls return accurate usage.
let _prevCpuSample = null;
function getCPUUsage() {
    const cpus = os.cpus();
    if (!_prevCpuSample) {
        _prevCpuSample = cpus;
        return Promise.resolve(0);
    }
    let totalIdle = 0, totalTick = 0;
    for (let i = 0; i < cpus.length; i++) {
        const c1 = _prevCpuSample[i].times;
        const c2 = cpus[i].times;
        const idle = c2.idle - c1.idle;
        const total = (c2.user - c1.user) + (c2.nice - c1.nice) + (c2.sys - c1.sys) + (c2.irq - c1.irq) + idle;
        totalIdle += idle;
        totalTick += total;
    }
    _prevCpuSample = cpus;
    return Promise.resolve(totalTick === 0 ? 0 : Math.round((1 - totalIdle / totalTick) * 100 * 10) / 10);
}

function getMemoryUsage() {
    const total = os.totalmem();
    const free = os.freemem();
    return Math.round((1 - free / total) * 100 * 10) / 10;
}

// ── System paths (bundled node.exe has no PATH) ──
const SYS32 = path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32');
const PS_EXE = path.join(SYS32, "WindowsPowerShell", "v1.0", "powershell.exe");
const MSHTA_EXE = path.join(SYS32, "mshta.exe");
const MSG_EXE = path.join(SYS32, "msg.exe");

// ── PowerShell helper (single call, no interactive) ──
function runPS(script, timeout = 10000) {
    return new Promise((resolve, reject) => {
        execFile(PS_EXE, ['-NoProfile', '-NonInteractive', '-Command', script],
            { timeout, maxBuffer: 2 * 1024 * 1024 },
            (err, stdout, stderr) => {
                if (err) reject(err);
                else resolve(stdout);
            });
    });
}

// ── InputHelper: persistent C# child process for fast input ──
// Check both locations: ProgramData (compiled) and PCAgent (pre-built from USB)
const _INPUT_HELPER_PROGRAMDATA = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'PCAgent', 'input-helper.exe');
const _INPUT_HELPER_LOCAL = path.join(__dirname, 'input-helper.exe');
const INPUT_HELPER_EXE = fs.existsSync(_INPUT_HELPER_LOCAL) ? _INPUT_HELPER_LOCAL : _INPUT_HELPER_PROGRAMDATA;
const INPUT_HELPER_VERSION = '1.2.0';  // 1.2.0: Win/Meta key support for Win+D, Win+E, Win+L etc.

const INPUT_HELPER_CS = `
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

// Minimal JSON parser — no external deps
class Json {
    public static Dictionary<string,string> Parse(string s) {
        var d = new Dictionary<string,string>();
        s = s.Trim();
        if (s.Length < 2 || s[0] != '{') return d;
        int i = 1;
        while (i < s.Length) {
            while (i < s.Length && (s[i] == ' ' || s[i] == ',' || s[i] == '\\r' || s[i] == '\\n')) i++;
            if (i >= s.Length || s[i] == '}') break;
            if (s[i] != '"') { i++; continue; }
            i++;
            var kb = new StringBuilder();
            while (i < s.Length && s[i] != '"') { if (s[i] == '\\\\') i++; kb.Append(s[i]); i++; }
            i++; // closing quote
            while (i < s.Length && s[i] != ':') i++;
            i++; // colon
            while (i < s.Length && s[i] == ' ') i++;
            var vb = new StringBuilder();
            if (i < s.Length && s[i] == '"') {
                i++;
                while (i < s.Length && s[i] != '"') { if (s[i] == '\\\\') i++; vb.Append(s[i]); i++; }
                i++;
            } else {
                while (i < s.Length && s[i] != ',' && s[i] != '}') { vb.Append(s[i]); i++; }
            }
            d[kb.ToString()] = vb.ToString().Trim();
        }
        return d;
    }
}

class Program {
    [DllImport("user32.dll")] static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int n);
    [DllImport("user32.dll")] static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public INPUTUNION u; }
    [StructLayout(LayoutKind.Explicit)]
    struct INPUTUNION {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx; public int dy; public uint data; public uint flags; public uint time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort vk; public ushort scan; public uint flags; public uint time; public IntPtr extra; }

    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_EXTENDEDKEY = 0x0001;

    static Dictionary<string,ushort> VK = new Dictionary<string,ushort> {
        {"Enter",0x0D},{"Return",0x0D},{"Backspace",0x08},{"Tab",0x09},
        {"Escape",0x1B},{"Esc",0x1B},{"Delete",0x2E},{"Del",0x2E},
        {"ArrowLeft",0x25},{"ArrowUp",0x26},{"ArrowRight",0x27},{"ArrowDown",0x28},
        {"Home",0x24},{"End",0x23},{"PageUp",0x21},{"PageDown",0x22},
        {"Insert",0x2D},{"Space",' '},
        {"F1",0x70},{"F2",0x71},{"F3",0x72},{"F4",0x73},
        {"F5",0x74},{"F6",0x75},{"F7",0x76},{"F8",0x77},
        {"F9",0x78},{"F10",0x79},{"F11",0x7A},{"F12",0x7B},
        {"CapsLock",0x14},{"NumLock",0x90},{"ScrollLock",0x91},
        {"PrintScreen",0x2C},{"Pause",0x13},
        {"a",0x41},{"b",0x42},{"c",0x43},{"d",0x44},{"e",0x45},
        {"f",0x46},{"g",0x47},{"h",0x48},{"i",0x49},{"j",0x4A},
        {"k",0x4B},{"l",0x4C},{"m",0x4D},{"n",0x4E},{"o",0x4F},
        {"p",0x50},{"q",0x51},{"r",0x52},{"s",0x53},{"t",0x54},
        {"u",0x55},{"v",0x56},{"w",0x57},{"x",0x58},{"y",0x59},{"z",0x5A},
        {"A",0x41},{"B",0x42},{"C",0x43},{"D",0x44},{"E",0x45},
        {"F",0x46},{"G",0x47},{"H",0x48},{"I",0x49},{"J",0x4A},
        {"K",0x4B},{"L",0x4C},{"M",0x4D},{"N",0x4E},{"O",0x4F},
        {"P",0x50},{"Q",0x51},{"R",0x52},{"S",0x53},{"T",0x54},
        {"U",0x55},{"V",0x56},{"W",0x57},{"X",0x58},{"Y",0x59},{"Z",0x5A},
        {"0",0x30},{"1",0x31},{"2",0x32},{"3",0x33},{"4",0x34},
        {"5",0x35},{"6",0x36},{"7",0x37},{"8",0x38},{"9",0x39},
        {" ",0x20},{"\`",0xC0},{"~",0xC0},{"-",0xBD},{"_",0xBD},
        {"=",0xBB},{"+",0xBB},{"[",0xDB},{"{",0xDB},{"]",0xDD},{"}",0xDD},
        {"\\\\",0xDC},{"|",0xDC},{";",0xBA},{":"  ,0xBA},{"'",0xDE},{"\"",0xDE},
        {",",0xBC},{"<",0xBC},{".",0xBE},{">",0xBE},{"/",0xBF},{"?",0xBF},
    };

    static bool IsExtended(ushort vk) {
        return vk == 0x25 || vk == 0x26 || vk == 0x27 || vk == 0x28 ||
               vk == 0x24 || vk == 0x23 || vk == 0x21 || vk == 0x22 ||
               vk == 0x2D || vk == 0x2E || vk == 0x2C;
    }

    static void SendKey(ushort vk, bool ctrl, bool alt, bool shift, bool meta) {
        var inputs = new List<INPUT>();
        if (ctrl)  inputs.Add(MakeKey(0x11, false));
        if (alt)   inputs.Add(MakeKey(0x12, false));
        if (shift) inputs.Add(MakeKey(0x10, false));
        if (meta)  inputs.Add(MakeKey(0x5B, false));
        inputs.Add(MakeKey(vk, false));
        inputs.Add(MakeKey(vk, true));
        if (meta)  inputs.Add(MakeKey(0x5B, true));
        if (shift) inputs.Add(MakeKey(0x10, true));
        if (alt)   inputs.Add(MakeKey(0x12, true));
        if (ctrl)  inputs.Add(MakeKey(0x11, true));
        SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf(typeof(INPUT)));
    }

    static INPUT MakeKey(ushort vk, bool up) {
        uint flags = up ? KEYEVENTF_KEYUP : 0;
        if (IsExtended(vk)) flags |= KEYEVENTF_EXTENDEDKEY;
        var inp = new INPUT { type = 1 };
        inp.u.ki = new KEYBDINPUT { vk = vk, flags = flags };
        return inp;
    }

    static void Main() {
        Console.OutputEncoding = Encoding.UTF8;
        Console.WriteLine("{\\"s\\":\\"ok\\"}");
        Console.Out.Flush();
        string line;
        while ((line = Console.ReadLine()) != null) {
            line = line.Trim();
            if (line.Length == 0) continue;
            try {
                var d = Json.Parse(line);
                string t = d.ContainsKey("t") ? d["t"] : "";
                if (t == "m") {
                    int x = int.Parse(d["x"]);
                    int y = int.Parse(d["y"]);
                    int sw = d.ContainsKey("sw") ? int.Parse(d["sw"]) : 1920;
                    int sh = d.ContainsKey("sh") ? int.Parse(d["sh"]) : 1080;
                    int lw = GetSystemMetrics(0);
                    int lh = GetSystemMetrics(1);
                    int rx = (int)Math.Round((double)x * lw / sw);
                    int ry = (int)Math.Round((double)y * lh / sh);
                    string a = d.ContainsKey("a") ? d["a"] : "move";
                    SetCursorPos(rx, ry);
                    if (a == "click") {
                        int b = d.ContainsKey("b") ? int.Parse(d["b"]) : 0;
                        uint dn = (b == 2) ? 8u : 2u;
                        uint up = (b == 2) ? 16u : 4u;
                        mouse_event(dn, 0, 0, 0, IntPtr.Zero);
                        mouse_event(up, 0, 0, 0, IntPtr.Zero);
                    } else if (a == "dblclick") {
                        mouse_event(2, 0, 0, 0, IntPtr.Zero);
                        mouse_event(4, 0, 0, 0, IntPtr.Zero);
                        System.Threading.Thread.Sleep(50);
                        mouse_event(2, 0, 0, 0, IntPtr.Zero);
                        mouse_event(4, 0, 0, 0, IntPtr.Zero);
                    } else if (a == "mousedown") {
                        int b = d.ContainsKey("b") ? int.Parse(d["b"]) : 0;
                        uint dn = (b == 2) ? 8u : 2u;
                        mouse_event(dn, 0, 0, 0, IntPtr.Zero);
                    } else if (a == "mouseup") {
                        int b = d.ContainsKey("b") ? int.Parse(d["b"]) : 0;
                        uint up = (b == 2) ? 16u : 4u;
                        mouse_event(up, 0, 0, 0, IntPtr.Zero);
                    } else if (a == "scroll") {
                        int delta = d.ContainsKey("d") ? int.Parse(d["d"]) : -120;
                        mouse_event(0x0800, 0, 0, (uint)delta, IntPtr.Zero);
                    }
                    Console.WriteLine("{\\"s\\":\\"ok\\"}");
                } else if (t == "k") {
                    string k = d.ContainsKey("k") ? d["k"] : "";
                    bool ctrl  = d.ContainsKey("c") && d["c"] == "true";
                    bool alt   = d.ContainsKey("a") && d["a"] == "true";
                    bool shift = d.ContainsKey("s") && d["s"] == "true";
                    bool meta  = d.ContainsKey("m") && d["m"] == "true";
                    ushort vk = 0;
                    if (k.Length == 1 && VK.ContainsKey(k)) {
                        vk = VK[k];
                        if (k.Length == 1 && char.IsUpper(k[0])) shift = true;
                    } else if (VK.ContainsKey(k)) {
                        vk = VK[k];
                    }
                    if (vk != 0) SendKey(vk, ctrl, alt, shift, meta);
                    Console.WriteLine("{\\"s\\":\\"ok\\"}");
                } else if (t == "ping") {
                    Console.WriteLine("{\\"s\\":\\"pong\\"}");
                }
                Console.Out.Flush();
            } catch {
                Console.WriteLine("{\\"s\\":\\"err\\"}");
                Console.Out.Flush();
            }
        }
    }
}
`;

class InputHelper {
    constructor() {
        this.proc = null;
        this.ready = false;
        this.retries = 0;
        this.maxRetries = 3;
        this._starting = false;
    }

    async init() {
        try {
            await this._ensureCompiled();
            await this._spawn();
        } catch (err) {
            log('InputHelper init failed, falling back to PS: ' + err.message, 'warn');
        }
    }

    async _ensureCompiled() {
        // Check if exe exists (version tag baked into comment at start of file)
        const versionFile = INPUT_HELPER_EXE + '.ver';
        if (fs.existsSync(INPUT_HELPER_EXE) && fs.existsSync(versionFile)) {
            const ver = fs.readFileSync(versionFile, 'utf-8').trim();
            if (ver === INPUT_HELPER_VERSION) {
                log('InputHelper exe cached v' + INPUT_HELPER_VERSION, 'info');
                return;
            }
        }

        log('Compiling InputHelper...', 'info');
        const dir = 'C:\\ProgramData\\PCAgent';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const csPath = dir + '\\input-helper.cs';
        fs.writeFileSync(csPath, INPUT_HELPER_CS, 'utf-8');

        const compilationScript = `
Add-Type -OutputAssembly "${INPUT_HELPER_EXE}" -OutputType ConsoleApplication -TypeDefinition (Get-Content -Raw -LiteralPath "${csPath}")
Write-Output "compiled"
`.trim();

        await new Promise((resolve, reject) => {
            execFile(PS_EXE, ['-NoProfile', '-NonInteractive', '-Command', compilationScript],
                { timeout: 30000 },
                (err, stdout, stderr) => {
                    if (err) {
                        reject(new Error('Compile failed: ' + (stderr || err.message)));
                    } else {
                        fs.writeFileSync(versionFile, INPUT_HELPER_VERSION, 'utf-8');
                        log('InputHelper compiled OK', 'success');
                        resolve();
                    }
                });
        });
    }

    async _spawn() {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(INPUT_HELPER_EXE)) {
                return reject(new Error('Exe not found: ' + INPUT_HELPER_EXE));
            }
            this._starting = true;
            this.proc = spawn(INPUT_HELPER_EXE, [], {
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true,
            });

            let resolved = false;
            const timeout = setTimeout(() => {
                if (!resolved) { resolved = true; reject(new Error('InputHelper startup timeout')); }
            }, 5000);

            this.proc.stdout.once('data', (data) => {
                const line = data.toString().trim();
                if (line.includes('"ok"')) {
                    this.ready = true;
                    this.retries = 0;
                    this._starting = false;
                    clearTimeout(timeout);
                    if (!resolved) { resolved = true; log('InputHelper ready', 'success'); resolve(); }
                }
            });

            this.proc.stderr.on('data', (d) => {
                if (CONFIG.VERBOSE) log('InputHelper stderr: ' + d.toString().trim(), 'warn');
            });

            this.proc.on('exit', (code) => {
                this.ready = false;
                this.proc = null;
                this._starting = false;
                log('InputHelper exited (code ' + code + ')', 'warn');
                if (!resolved) { resolved = true; clearTimeout(timeout); reject(new Error('Exited early')); }
                else this._autoRestart();
            });

            this.proc.on('error', (err) => {
                this.ready = false;
                this._starting = false;
                log('InputHelper error: ' + err.message, 'error');
                if (!resolved) { resolved = true; clearTimeout(timeout); reject(err); }
            });
        });
    }

    _autoRestart() {
        if (this.retries >= this.maxRetries) {
            log('InputHelper max retries reached, falling back to PS', 'warn');
            return;
        }
        this.retries++;
        log('InputHelper restart #' + this.retries + '...', 'warn');
        setTimeout(() => {
            this._spawn().catch(err => log('InputHelper restart failed: ' + err.message, 'error'));
        }, 1000 * this.retries);
    }

    sendCommand(obj) {
        if (!this.ready || !this.proc) return false;
        try {
            this.proc.stdin.write(JSON.stringify(obj) + '\n');
            return true;
        } catch (err) {
            log('InputHelper send error: ' + err.message, 'error');
            this.ready = false;
            return false;
        }
    }

    destroy() {
        this.ready = false;
        this.retries = this.maxRetries; // prevent auto-restart
        if (this.proc) {
            try { this.proc.kill(); } catch (e) { /* ok */ }
            this.proc = null;
        }
    }
}

const inputHelper = new InputHelper();

// ── Mouse control: pre-compiled C# type (legacy fallback) ────
const MOUSE_PS_INIT = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class MouseCtrl {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
    public static int ScreenW() { return GetSystemMetrics(0); }
    public static int ScreenH() { return GetSystemMetrics(1); }
}
"@
`;

// Initialize input systems at startup
function initInputSystems() {
    inputHelper.init().catch(e => log('InputHelper unavailable: ' + e.message, 'warn'));
}

// ── Process list (tasklist — fast, 2-3s) ─────────────
function getProcessList() {
    return new Promise((resolve) => {
        const tasklistExe = path.join(SYS32, 'tasklist.exe');
        execFile(tasklistExe, ['/FO', 'CSV', '/NH'], { maxBuffer: 4 * 1024 * 1024, timeout: 10000 }, (err, stdout) => {
            if (err) { log('tasklist failed: ' + err.message, 'warn'); resolve([]); return; }
            try {
                const processes = stdout.trim().split('\n')
                    .filter(line => line.trim())
                    .map(line => {
                        const parts = line.match(/"([^"]*)"/g);
                        if (!parts || parts.length < 5) return null;
                        // Parse memory: strip all non-digit chars, result is KB
                        const memRaw = parts[4].replace(/"/g, '');
                        const memKB = parseInt(memRaw.replace(/\D/g, '')) || 0;
                        return {
                            Name: parts[0].replace(/"/g, ''),
                            Id: parseInt(parts[1].replace(/"/g, '')) || 0,
                            Memory: String(memKB)
                        };
                    })
                    .filter(p => p && p.Name);
                resolve(processes);
            } catch (e) {
                log('Tasklist parse error: ' + e.message, 'error');
                resolve([]);
            }
        });
    });
}

// ── Running apps (windowed processes — like Task Manager "Apps") ──
function getRunningApps() {
    return new Promise((resolve) => {
        const psCmd = `Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object Name, Id, @{N='Memory';E={[math]::Round($_.WorkingSet64/1024)}}, MainWindowTitle | ConvertTo-Json -Compress`;
        execFile(PS_EXE, ['-NoProfile', '-NonInteractive', '-Command', psCmd],
            { timeout: 15000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
            if (err) {
                log('Get apps failed: ' + err.message, 'warn');
                resolve([]);
                return;
            }
            try {
                let data = JSON.parse(stdout.trim());
                if (!Array.isArray(data)) data = [data];
                const apps = data.map(p => ({
                    Name: p.Name || '',
                    Id: p.Id || 0,
                    Memory: String(p.Memory || 0),
                    Title: p.MainWindowTitle || '',
                }));
                resolve(apps);
            } catch (e) {
                log('Apps parse error: ' + e.message, 'error');
                resolve([]);
            }
        });
    });
}

// ── Message display — PowerShell WinForms toast notification ─────────
// Returns a promise that resolves with delivery status so caller can ACK.
function showMessage(msg, durationMs = 8000) {
    return new Promise((resolve) => {
        // Sanitize: escape single quotes for PS, remove control characters,
        // limit length. Line breaks are preserved as PowerShell `n.
        const trunc = (msg || '').substring(0, 500);
        const psMsg = trunc
            .replace(/`/g, '``')
            .replace(/'/g, "''")
            .replace(/\r?\n/g, "`n");
        const seconds = Math.max(2, Math.round(durationMs / 1000));

        // Build a TopMost WinForms toast:
        // - Positioned top-right
        // - Auto-dismisses after `seconds`
        // - Click to dismiss early
        // - No taskbar entry
        // - Steals focus briefly to guarantee visibility
        const psScript = [
            "Add-Type -AssemblyName System.Windows.Forms;",
            "Add-Type -AssemblyName System.Drawing;",
            "$scr=[System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea;",
            "$f=New-Object System.Windows.Forms.Form;",
            "$f.FormBorderStyle='None';",
            "$f.StartPosition='Manual';",
            "$f.TopMost=$true;",
            "$f.ShowInTaskbar=$false;",
            "$f.BackColor=[System.Drawing.Color]::FromArgb(24,24,27);",
            "$f.Width=480;$f.Height=180;",
            "$f.Left=$scr.Right-$f.Width-24;",
            "$f.Top=$scr.Top+24;",
            "$f.Opacity=0.96;",
            "$t=New-Object System.Windows.Forms.Label;",
            "$t.Text='\uD83D\uDCE2 선생님 메시지';",
            "$t.ForeColor=[System.Drawing.Color]::FromArgb(250,204,21);",
            "$t.Font=New-Object System.Drawing.Font('Segoe UI',12,[System.Drawing.FontStyle]::Bold);",
            "$t.Location=New-Object System.Drawing.Point(20,14);",
            "$t.Size=New-Object System.Drawing.Size(440,28);",
            "$f.Controls.Add($t);",
            "$b=New-Object System.Windows.Forms.Label;",
            `$b.Text='${psMsg}';`,
            "$b.ForeColor=[System.Drawing.Color]::White;",
            "$b.Font=New-Object System.Drawing.Font('Segoe UI',13);",
            "$b.Location=New-Object System.Drawing.Point(20,50);",
            "$b.Size=New-Object System.Drawing.Size(440,110);",
            "$f.Controls.Add($b);",
            `$timer=New-Object System.Windows.Forms.Timer; $timer.Interval=${durationMs};`,
            "$timer.Add_Tick({$f.Close();$timer.Stop()}); $timer.Start();",
            "$f.Add_Click({$f.Close()}); $b.Add_Click({$f.Close()}); $t.Add_Click({$f.Close()});",
            "$f.ShowDialog() | Out-Null;",
        ].join(' ');

        execFile(PS_EXE, [
            '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
            '-Command', psScript
        ], { timeout: durationMs + 10000 }, (psErr) => {
            if (!psErr) {
                log('Message delivered (toast)', 'success');
                return resolve({ success: true, method: 'ps-toast' });
            }
            log('PS toast failed: ' + psErr.message, 'warn');

            // Fallback 1: classic MessageBox (blocks until OK)
            const mbScript = `Add-Type -AssemblyName System.Windows.Forms;` +
                `[System.Windows.Forms.MessageBox]::Show('${psMsg}','선생님 메시지','OK','Information')`;
            execFile(PS_EXE, ['-NoProfile', '-NonInteractive', '-Command', mbScript],
                { timeout: 60000 }, (mbErr) => {
                    if (!mbErr) {
                        log('Message delivered (MessageBox)', 'success');
                        return resolve({ success: true, method: 'messagebox' });
                    }
                    log('MessageBox failed: ' + mbErr.message, 'warn');

                    // Fallback 2: mshta alert (always available on Windows)
                    const htaMsg = trunc.substring(0, 200)
                        .replace(/['"\\]/g, ' ')
                        .replace(/\r?\n/g, ' ');
                    execFile(MSHTA_EXE,
                        [`javascript:alert("[선생님 메시지] ${htaMsg}");close()`],
                        { timeout: 60000 }, (htaErr) => {
                            if (!htaErr) {
                                log('Message delivered (mshta)', 'success');
                                return resolve({ success: true, method: 'mshta' });
                            }
                            log('All message methods failed', 'error');
                            resolve({ success: false, error: htaErr.message });
                        });
                });
        });
    });
}

// ── Screenshot capture ───────────────────────────────
async function captureScreenshot() {
    try {
        const screenshot = require('screenshot-desktop');
        const imgBuffer = await screenshot({ format: 'jpg' });
        return imgBuffer.toString('base64');
    } catch (err) {
        // Fallback: PowerShell
        try {
            const tmpPath = path.join(os.tmpdir(), `screenshot_${Date.now()}.jpg`);
            const escaped = tmpPath.replace(/\\/g, '\\\\').replace(/'/g, "''");
            await runPS(
                `Add-Type -AssemblyName System.Windows.Forms;Add-Type -AssemblyName System.Drawing;` +
                `$s=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds;` +
                `$b=New-Object System.Drawing.Bitmap($s.Width,$s.Height);` +
                `$g=[System.Drawing.Graphics]::FromImage($b);` +
                `$g.CopyFromScreen($s.Location,[System.Drawing.Point]::Empty,$s.Size);` +
                `$b.Save('${escaped}',[System.Drawing.Imaging.ImageFormat]::Jpeg);` +
                `$g.Dispose();$b.Dispose()`,
                15000
            );
            const buffer = fs.readFileSync(tmpPath);
            try { fs.unlinkSync(tmpPath); } catch (e) { /* ok */ }
            return buffer.toString('base64');
        } catch (e) {
            log('Screenshot fallback failed: ' + e.message, 'error');
            return null;
        }
    }
}

// Module-scoped agent instance reference so helpers can emit back to server
let _agentInstance = null;

// ── Command execution ────────────────────────────────
function executeCommand(command, params = {}) {
    log(`Command received: ${command}`, 'cmd');

    switch (command) {
        case 'shutdown':
            log('Shutdown in 30s', 'warn');
            exec('shutdown /s /t 30 /c "관리자가 종료를 요청했습니다"', (err) => {
                if (err) log('Shutdown failed: ' + err.message, 'error');
            });
            return { success: true, message: '30초 후 종료' };

        case 'sleep':
            log('Sleep (S3) — WOL will wake this PC', 'warn');
            exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0', (err) => {
                if (err) log('Sleep failed: ' + err.message, 'error');
            });
            return { success: true, message: '절전 모드' };

        case 'restart':
            log('Restart in 30s', 'warn');
            exec('shutdown /r /t 30 /c "관리자가 재시작을 요청했습니다"', (err) => {
                if (err) log('Restart failed: ' + err.message, 'error');
            });
            return { success: true, message: '30초 후 재시작' };

        case 'logoff':
            exec('logoff', (err) => {
                if (err) log('Logoff failed: ' + err.message, 'error');
            });
            return { success: true, message: '로그오프' };

        case 'lock':
            exec('rundll32.exe user32.dll,LockWorkStation', (err) => {
                if (err) log('Lock failed: ' + err.message, 'error');
            });
            return { success: true, message: '화면 잠금' };

        case 'message': {
            const msg = params.message || '관리자 메시지';
            const dur = params.durationMs || 8000;
            log('Message: ' + msg, 'cmd');
            // Fire-and-forget; agent reports delivery via log-activity ACK
            showMessage(msg, dur).then(result => {
                const sock = _agentInstance && _agentInstance.socket;
                if (sock && sock.emit) {
                    sock.emit('log-activity', {
                        pcName: CONFIG.PC_NAME,
                        user: 'system',
                        activityType: 'message-delivery',
                        details: result.success
                            ? `delivered via ${result.method}`
                            : `FAILED: ${result.error || 'unknown'}`,
                    });
                }
            }).catch(() => {});
            return { success: true, message: '메시지 표시 중' };
        }

        case 'kill-process':
            const procName = params.processName;
            if (!procName) return { success: false, message: 'No process name' };
            log('Kill: ' + procName, 'cmd');
            execFile(path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/IM', procName, '/F'], { timeout: 5000 }, (err) => {
                if (err) log('Kill failed: ' + err.message, 'warn');
            });
            return { success: true, message: procName + ' killed' };

        case 'open-url': {
            const url = params.url;
            if (!url) return { success: false, message: 'No URL' };
            // Validate URL format
            if (!/^https?:\/\//i.test(url)) return { success: false, message: 'Invalid URL' };
            log('Open URL: ' + url, 'cmd');
            exec(`start "" "${url}"`, (err) => {
                if (err) log('URL open failed: ' + err.message, 'error');
            });
            return { success: true, message: url };
        }

        case 'run': {
            const cmd = params.cmd;
            if (!cmd) return { success: false, message: 'No command' };
            log('Run: ' + cmd, 'cmd');
            exec(cmd, { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
                if (err) log('Run error: ' + err.message, 'error');
                else if (stdout) log('Run result: ' + stdout.substring(0, 200));
            });
            return { success: true, message: 'Running: ' + cmd };
        }

        case 'screenshot':
            return { success: true, message: 'Screenshot started' };

        case 'cancel-shutdown':
            exec('shutdown /a', (err) => {
                if (err) log('Cancel shutdown failed: ' + err.message, 'warn');
            });
            return { success: true, message: '종료 취소' };

        case 'clipboard-get': {
            // Read remote PC clipboard
            try {
                const result = execSync('powershell -NoProfile -Command "Get-Clipboard"', { timeout: 3000, encoding: 'utf-8' });
                return { success: true, message: 'clipboard', clipboard: result.trim() };
            } catch (e) {
                return { success: false, message: 'Clipboard read failed' };
            }
        }

        case 'clipboard-set': {
            // Write to remote PC clipboard
            const text = params.text || '';
            try {
                execSync(`powershell -NoProfile -Command "Set-Clipboard -Value '${text.replace(/'/g, "''")}'"`  , { timeout: 3000 });
                return { success: true, message: 'Clipboard set' };
            } catch (e) {
                return { success: false, message: 'Clipboard write failed' };
            }
        }

        case 'open-url': {
            // Open URL on student PC browser
            const url = params.url || '';
            if (url && /^https?:\/\//i.test(url)) {
                exec(`start "" "${url}"`, { timeout: 5000 });
                return { success: true, message: 'URL opened: ' + url };
            }
            return { success: false, message: 'Invalid URL' };
        }

        default:
            log('Unknown command: ' + command, 'warn');
            return { success: false, message: 'Unknown: ' + command };
    }
}

// ── Site blocking (declarative reconciliation via marker block) ──
const HOSTS_PATH = 'C:\\Windows\\System32\\drivers\\etc\\hosts';
const HOSTS_MARKER_START = '# === PC-AGENT BLOCKED SITES START ===';
const HOSTS_MARKER_END = '# === PC-AGENT BLOCKED SITES END ===';

const SUBDOMAIN_PREFIXES = ['www', 'm', 'mobile', 'app', 'api', 'cdn', 'static',
    'img', 'images', 'video', 'play', 'games', 'login', 'accounts', 'mail',
    'shop', 'store', 'dl', 'download', 'media', 'content', 'assets', 'web'];

function getDomainVariants(domain) {
    const base = domain.replace(/^www\./, '').trim().toLowerCase();
    if (!base) return [];
    const variants = new Set([base]);
    SUBDOMAIN_PREFIXES.forEach(prefix => variants.add(prefix + '.' + base));
    return [...variants];
}

function flushDns() {
    execFile(path.join(SYS32, 'ipconfig.exe'), ['/flushdns'], { timeout: 5000 }, () => {});
}

/**
 * Declarative hosts reconciliation.
 * Removes the existing marker block and rewrites it with the desired domains.
 * This is idempotent — calling it with the same list produces the same file.
 * Only the marker region is touched; the rest of hosts is preserved.
 */
function syncBlockedSites(desiredDomains) {
    try {
        let content = fs.readFileSync(HOSTS_PATH, 'utf-8');

        // Strip existing marker block (if any)
        const startIdx = content.indexOf(HOSTS_MARKER_START);
        const endIdx = content.indexOf(HOSTS_MARKER_END);
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
            const before = content.substring(0, startIdx).replace(/[\r\n]+$/, '');
            const after = content.substring(endIdx + HOSTS_MARKER_END.length);
            content = before + after;
        }

        // Also strip any legacy `127.0.0.1 xxx` entries that were added before
        // marker-based sync existed, EXCEPT localhost/IPv6 originals.
        content = content.split(/\r?\n/).filter(line => {
            const t = line.trim();
            if (!t.startsWith('127.0.0.1')) return true;
            if (/^127\.0\.0\.1\s+localhost\b/i.test(t)) return true;
            return false;
        }).join('\r\n');

        // Rebuild marker block from desired state
        const list = Array.isArray(desiredDomains) ? desiredDomains : [];
        if (list.length > 0) {
            const allVariants = new Set();
            list.forEach(d => getDomainVariants(d).forEach(v => allVariants.add(v)));
            const lines = [HOSTS_MARKER_START];
            Array.from(allVariants).sort().forEach(v => lines.push('127.0.0.1 ' + v));
            lines.push(HOSTS_MARKER_END);
            content = content.replace(/[\r\n]+$/, '') + '\r\n' + lines.join('\r\n') + '\r\n';
        } else {
            content = content.replace(/[\r\n]+$/, '') + '\r\n';
        }

        fs.writeFileSync(HOSTS_PATH, content);
        flushDns();
        log('Hosts reconciled: ' + list.length + ' domains', 'success');
        return { success: true, count: list.length };
    } catch (err) {
        log('Hosts sync failed (need admin): ' + err.message, 'error');
        return { success: false, message: err.message };
    }
}

// Legacy compatibility shims — just trigger a full sync next time
function blockSite(domain) {
    // Kept for backward compat; server should use sync-blocked-sites instead
    log('blockSite() legacy call — prefer sync-blocked-sites', 'warn');
    return { success: true };
}
function unblockSite(domain) {
    log('unblockSite() legacy call — prefer sync-blocked-sites', 'warn');
    return { success: true };
}

// ══════════════════════════════════════════════════════
// Main Agent
// ══════════════════════════════════════════════════════
class PCAgent {
    constructor() {
        this.socket = null;
        this.statusInterval = null;
        this.streamInterval = null;
        this.streaming = false;
        this.streamFPS = CONFIG.STREAM_FPS;
        this.connected = false;
        this.ffmpegProcess = null;
        this.streamTimeout = null;

        _agentInstance = this; // expose for module-level helpers (showMessage ACK)

        this.printBanner();
        this.selfCheck();
        this.connect();
        initInputSystems(); // Start persistent C# input helper
    }

    printBanner() {
        console.log('');
        console.log('=========================================');
        console.log('  Enterprise PC Agent v' + CONFIG.AGENT_VERSION);
        console.log('=========================================');
        console.log('  PC Name:  ' + CONFIG.PC_NAME);
        console.log('  IP:       ' + CONFIG.IP_ADDRESS);
        console.log('  Server:   ' + CONFIG.SERVER_URL);
        console.log('=========================================');
        console.log('');
    }

    // Startup self-check
    selfCheck() {
        const issues = [];
        // Check server URL
        if (CONFIG.SERVER_URL.includes('localhost') || CONFIG.SERVER_URL.includes('127.0.0.1')) {
            issues.push('SERVER_URL is localhost — agent will not connect to remote server');
        }
        // Check if running as admin (needed for site blocking, hosts file)
        try {
            fs.accessSync('C:\\Windows\\System32\\drivers\\etc\\hosts', fs.constants.W_OK);
        } catch (e) {
            issues.push('Not running as admin — site blocking will not work');
        }
        // Check ffmpeg
        try {
            execSync('where ffmpeg', { timeout: 3000, stdio: 'pipe' });
        } catch (e) {
            const bundled = path.join(__dirname, 'ffmpeg.exe');
            if (!fs.existsSync(bundled)) {
                issues.push('ffmpeg not found — live view will use screenshot fallback (slower)');
            }
        }
        if (issues.length > 0) {
            log('Self-check warnings:', 'warn');
            issues.forEach(i => log('  - ' + i, 'warn'));
        } else {
            log('Self-check passed', 'success');
        }
    }

    connect() {
        log('Connecting to ' + CONFIG.SERVER_URL + '...');

        this.socket = io(CONFIG.SERVER_URL, {
            reconnection: true,
            reconnectionDelay: CONFIG.RECONNECT_DELAY + Math.floor(Math.random() * 3000), // jitter to prevent thundering herd
            reconnectionDelayMax: 30000,
            reconnectionAttempts: Infinity,
            timeout: 20000,
            pingTimeout: 60000,
            transports: ['websocket'],  // WebSocket only — skip polling for lower latency
        });

        // Disable Nagle for low-latency input
        this.socket.io.on('open', () => {
            try { this.socket.io.engine?.transport?.ws?.setNoDelay?.(true); } catch (e) {}
        });

        this.setupEvents();
    }

    setupEvents() {
        // ── Connect ──
        this.socket.on('connect', () => {
            this.connected = true;
            this._lastConnected = Date.now();
            _agentSocket = this.socket;
            log('Connected!', 'success');

            this.socket.emit('register-pc', {
                pcName: CONFIG.PC_NAME,
                ipAddress: CONFIG.IP_ADDRESS,
                macAddress: getMACAddress(),
                agentVersion: CONFIG.AGENT_VERSION,
            });

            this.socket.emit('log-activity', {
                pcName: CONFIG.PC_NAME,
                user: os.userInfo().username,
                activityType: 'login',
                details: 'Agent v' + CONFIG.AGENT_VERSION + ' connected (' + CONFIG.IP_ADDRESS + ')',
            });

            // Restore blocked programs from server
            this.restoreBlockedPrograms();

            // Auto-update: check server for newer agent version (immediate + periodic)
            this.checkForUpdate();
            this.startPeriodicUpdateCheck();

            this.startStatusReport();
        });

        // ── Force update: server pushes "update now" command ──
        this.socket.on(`force-update-${CONFIG.PC_NAME}`, () => {
            log('Force update requested by server', 'warn');
            this.checkForUpdate(true);
        });
        this.socket.on('force-update-all', () => {
            log('Force update broadcast received', 'warn');
            this.checkForUpdate(true);
        });

        // ── Disconnect ──
        this.socket.on('disconnect', (reason) => {
            this.connected = false;
            log('Disconnected: ' + reason, 'warn');
            this.stopStatusReport();
        });

        this.socket.on('reconnect_attempt', (attempt) => {
            if (CONFIG.VERBOSE || attempt % 5 === 0) {
                log('Reconnect #' + attempt + '...', 'warn');
            }
        });

        // Server rejected our registration (e.g., self-registration block)
        this.socket.on('registration-rejected', (data) => {
            log('REGISTRATION REJECTED: ' + (data && data.message || 'unknown reason'), 'error');
            // If server says we're the admin PC, self-uninstall (best effort)
            if (data && data.reason === 'self-registration-blocked') {
                log('Self-uninstall triggered by server', 'warn');
                // Don't actually delete — just stop trying to connect.
                // User should run cleanup script for full removal.
                try { this.socket.disconnect(); } catch (e) {}
                setTimeout(() => process.exit(0), 1000);
            }
        });

        // License limit
        this.socket.on('license-limit', (data) => {
            log('License limit: ' + (data && data.message || ''), 'error');
        });

        // ── Commands ──
        this.socket.on(`command-${CONFIG.PC_NAME}`, async (data) => {
            try {
                const { command, params } = data;
                log('Command: ' + command, 'cmd');

                const result = executeCommand(command, params || {});

                if (command === 'screenshot') {
                    const imgData = await captureScreenshot();
                    if (imgData) {
                        // Pass through requestId/reason for RPC-style flows (e.g. AI vision check)
                        this.socket.emit('screenshot', {
                            pcName: CONFIG.PC_NAME,
                            filename: CONFIG.PC_NAME + '_' + Date.now() + '.jpg',
                            fileData: imgData,
                            requestId: params && params.requestId,
                            reason: (params && params.reason) || 'manual',
                        });
                        log('Screenshot sent' + (params && params.requestId ? ' (rid=' + params.requestId + ')' : ''), 'success');
                    }
                }

                // Report command result
                this.socket.emit('log-activity', {
                    pcName: CONFIG.PC_NAME,
                    user: 'system',
                    activityType: 'command',
                    details: command + ': ' + (result.message || 'done'),
                });
            } catch (err) {
                log('Command handler error: ' + err.message, 'error');
            }
        });

        // ── Site blocking: full reconciliation (preferred) ──
        this.socket.on(`sync-blocked-sites-${CONFIG.PC_NAME}`, (data) => {
            try {
                const domains = (data && Array.isArray(data.domains)) ? data.domains : [];
                syncBlockedSites(domains);
            } catch (err) {
                log('Site sync error: ' + err.message, 'error');
            }
        });

        // ── Site blocking: legacy shim (still routed to full sync via no-op) ──
        this.socket.on(`block-site-${CONFIG.PC_NAME}`, (data) => {
            // Legacy per-domain events are ignored in favor of sync-blocked-sites.
            // Server is expected to follow every mutation with a sync event.
            log('Legacy block-site event received (ignored): ' + (data && data.domain), 'warn');
        });

        // ── Program blocking: full reconciliation ──
        this.socket.on(`sync-blocked-programs-${CONFIG.PC_NAME}`, (data) => {
            try {
                const list = (data && Array.isArray(data.programs)) ? data.programs : [];
                // Rebuild the blockedPrograms set from desired state
                blockedPrograms.clear();
                list.forEach(p => {
                    if (!p) return;
                    const name = (p.endsWith('.exe') ? p : p + '.exe').toLowerCase();
                    blockedPrograms.add(name);
                    // Kill immediately if running — BUT protect agent-internal processes.
                    // cmd.exe is used by exec() spawn, powershell by PS message/wallpaper.
                    // Killing these crashes the agent mid-operation.
                    if (name === 'cmd.exe') return;
                    if (name === 'powershell.exe' && _agentUsingPowershell) return;
                    if (name === 'wscript.exe') return; // agent autostart VBS
                    if (name === 'node.exe') return;    // agent itself
                    execFile(path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'taskkill.exe'),
                        ['/IM', name, '/F'], { timeout: 5000 }, () => {});
                });
                if (blockedPrograms.size > 0) startBlockMonitor();
                else stopBlockMonitor();
                log('Programs reconciled: ' + blockedPrograms.size + ' entries', 'success');
            } catch (err) {
                log('Program sync error: ' + err.message, 'error');
            }
        });

        // ── Program blocking: legacy shim ──
        this.socket.on(`block-program-${CONFIG.PC_NAME}`, (data) => {
            log('Legacy block-program event received (ignored): ' + (data && data.programName), 'warn');
        });

        // ── Wallpaper lock ──
        this.socket.on(`wallpaper-lock-${CONFIG.PC_NAME}`, (data) => {
            try {
                const locked = data && data.locked;
                wallpaperLocked = locked;
                if (locked) {
                    startWallpaperLock();
                } else {
                    stopWallpaperLock();
                }
            } catch (err) {
                log('Wallpaper lock error: ' + err.message, 'error');
            }
        });

        // ── Exam mode ──
        this.socket.on(`exam-mode-${CONFIG.PC_NAME}`, (data) => {
            try {
                const { enabled, whitelist = [], message } = data;
                if (enabled) {
                    // Kill user-space apps not in whitelist — preserve OS + agent procs
                    const allowed = new Set([
                        ...whitelist.map(p => p.toLowerCase()),
                        ...AGENT_PROTECTED_PROCS,
                        ...SYSTEM_PROTECTED_PROCS,
                    ]);
                    const tasklistExe = path.join(SYS32, 'tasklist.exe');
                    const taskkillExe = path.join(SYS32, 'taskkill.exe');
                    execFile(tasklistExe, ['/FO', 'CSV', '/NH'], { timeout: 5000 }, (err, stdout) => {
                        if (err) return;
                        for (const line of stdout.trim().split('\n')) {
                            const match = line.match(/"([^"]+)"/);
                            if (!match) continue;
                            const proc = match[1].toLowerCase();
                            if (allowed.has(proc)) continue;
                            if (proc.startsWith('svc') || proc.startsWith('mrt')) continue;
                            execFile(taskkillExe, ['/IM', match[1], '/F'], { timeout: 3000 }, () => {});
                        }
                    });
                }
                if (message) showMessage(message, 10000);
                log(`Exam mode ${enabled ? 'ON' : 'OFF'}, whitelist: ${whitelist.join(',')}`, 'info');
            } catch (err) {
                log('Exam mode error: ' + err.message, 'error');
            }
        });

        // ── Blocked programs list ──
        this.socket.on(`get-blocked-programs-${CONFIG.PC_NAME}`, (callback) => {
            try {
                if (typeof callback === 'function') {
                    callback({ success: true, blockedPrograms: [...blockedPrograms] });
                }
            } catch (err) {
                log('Get blocked programs error: ' + err.message, 'error');
                if (typeof callback === 'function') callback({ success: false, blockedPrograms: [] });
            }
        });

        // ── Process list ──
        this.socket.on(`get-processes-${CONFIG.PC_NAME}`, async (callback) => {
            try {
                const processes = await getProcessList();
                if (typeof callback === 'function') {
                    callback({ success: true, processes });
                }
            } catch (err) {
                log('Get processes error: ' + err.message, 'error');
                if (typeof callback === 'function') callback({ success: false, processes: [] });
            }
        });

        // ── Running apps (windowed processes only) ──
        this.socket.on(`get-apps-${CONFIG.PC_NAME}`, async (callback) => {
            try {
                const apps = await getRunningApps();
                if (typeof callback === 'function') {
                    callback({ success: true, apps });
                }
            } catch (err) {
                log('Get apps error: ' + err.message, 'error');
                if (typeof callback === 'function') callback({ success: false, apps: [] });
            }
        });

        // ── Connection errors (always log — critical for debugging) ──
        this.socket.on('connect_error', (err) => {
            log('Connection error: ' + err.message, 'error');
        });

        // ── Streaming start ──
        this.socket.on(`start-stream-${CONFIG.PC_NAME}`, (data) => {
            const fps = data?.fps || CONFIG.STREAM_FPS;
            const quality = data?.quality || CONFIG.STREAM_QUALITY;
            const mode = data?.mode;
            const monitorIdx = data?.monitor ?? 0;
            log(`Stream start (mode:${mode || 'mjpeg'}, FPS:${fps}, Q:${quality}, mon:${monitorIdx})`, 'cmd');
            this.startStreaming(fps, quality, mode, monitorIdx);
            // Auto-enable clipboard sync while being viewed
            this.startClipboardSync();
        });

        // Dashboard pushes clipboard update to this PC
        this.socket.on(`clipboard-set-${CONFIG.PC_NAME}`, (data) => {
            try {
                const text = (data?.text || '').substring(0, 32768);
                if (!text) return;
                // Use -Raw to preserve newlines, safer than inline command-line arg
                const tmpFile = path.join(os.tmpdir(), `clip-${Date.now()}.txt`);
                fs.writeFileSync(tmpFile, text, 'utf-8');
                execFile(PS_EXE, ['-NoProfile', '-Command', `Set-Clipboard -Value (Get-Content -Raw -LiteralPath '${tmpFile.replace(/'/g, "''")}')`], { timeout: 3000 }, (err) => {
                    try { fs.unlinkSync(tmpFile); } catch (e) {}
                    if (err && CONFIG.VERBOSE) log('Clipboard set error: ' + err.message, 'warn');
                    else this._lastClipboard = text;  // prevent re-echo
                });
            } catch (err) { log('clipboard-set error: ' + err.message, 'error'); }
        });

        // ── Input latency probe: echo back timestamp for RTT measurement ──
        this.socket.on(`input-ping-${CONFIG.PC_NAME}`, (data) => {
            if (!data?.clientT) return;
            this.socket.emit('input-pong', { pcName: CONFIG.PC_NAME, clientT: data.clientT, agentT: Date.now() });
        });

        // ── Adaptive bitrate: viewer reports its receive quality ──
        // Dashboard emits 'viewer-quality' with { pcName, recvFps, dropRate } every 5s.
        // Agent adjusts live bitrate/fps if dropRate persistently high.
        this.socket.on(`viewer-quality-${CONFIG.PC_NAME}`, (data) => {
            if (!this.streaming || !data) return;
            const dropRate = data.dropRate || 0;  // 0.0 ~ 1.0
            const recvFps = data.recvFps || 0;
            if (dropRate > 0.15) {
                // Viewer dropping >15% frames — throttle
                this._adaptiveDowngrades = (this._adaptiveDowngrades || 0) + 1;
                if (this._adaptiveDowngrades >= 3) {
                    log(`Adaptive: viewer dropping ${Math.round(dropRate*100)}% → reducing fps`, 'warn');
                    // Restart with half the fps, same quality
                    const params = this._streamParams;
                    if (params) {
                        const newFps = Math.max(CONFIG.STREAM_MIN_FPS, Math.floor(params.fps / 2));
                        if (newFps !== params.fps) {
                            this._adaptiveDowngrades = 0;
                            setTimeout(() => this.startStreaming(newFps, params.qv || 80, this._streamMode === 'h264' ? 'h264' : null, this._currentMonitor), 500);
                        }
                    }
                }
            } else if (dropRate < 0.02 && recvFps > 0) {
                this._adaptiveDowngrades = 0;
            }
        });

        // ── Monitor list query (for multi-display switcher) ──
        this.socket.on(`get-monitors-${CONFIG.PC_NAME}`, (ack) => {
            const monitors = this.getMonitors();
            if (typeof ack === 'function') ack({ success: true, monitors });
            else this.socket.emit('monitor-list', { pcName: CONFIG.PC_NAME, monitors });
        });

        // ── Streaming stop ──
        this.socket.on(`stop-stream-${CONFIG.PC_NAME}`, () => {
            log('Stream stop', 'cmd');
            this.stopStreaming();
        });

        // ── Remote mouse ──
        this.socket.on(`remote-mouse-${CONFIG.PC_NAME}`, (data) => {
            try {
                if (!data) return;
                const x = parseInt(data.x);
                const y = parseInt(data.y);
                const sw = parseInt(data.screenW);
                const sh = parseInt(data.screenH);
                const action = String(data.action || '');
                const button = parseInt(data.button) || 0;
                if (isNaN(x) || isNaN(y) || isNaN(sw) || isNaN(sh) || sw <= 0 || sh <= 0) return;
                if (!['click', 'dblclick', 'move', 'mousedown', 'mouseup'].includes(action)) return;

                // Fast path: persistent C# helper (handles click/dblclick/move/mousedown/mouseup/scroll)
                if (inputHelper.ready) {
                    inputHelper.sendCommand({ t: 'm', x, y, a: action, b: button, sw, sh });
                    return;
                }

                // Fallback: PowerShell (slow but reliable)
                const down = button === 2 ? '8' : '2';
                const up = button === 2 ? '16' : '4';
                const initPart = MOUSE_PS_INIT;
                const lines = [
                    initPart,
                    `$sw=[MouseCtrl]::ScreenW()`,
                    `$sh=[MouseCtrl]::ScreenH()`,
                    `$rx=[math]::Round(${x}*$sw/${sw})`,
                    `$ry=[math]::Round(${y}*$sh/${sh})`,
                    `[MouseCtrl]::SetCursorPos($rx,$ry)`,
                ];
                if (action === 'click') {
                    lines.push(`[MouseCtrl]::mouse_event(${down},0,0,0,[IntPtr]::Zero)`);
                    lines.push(`[MouseCtrl]::mouse_event(${up},0,0,0,[IntPtr]::Zero)`);
                } else if (action === 'mousedown') {
                    lines.push(`[MouseCtrl]::mouse_event(${down},0,0,0,[IntPtr]::Zero)`);
                } else if (action === 'mouseup') {
                    lines.push(`[MouseCtrl]::mouse_event(${up},0,0,0,[IntPtr]::Zero)`);
                } else if (action === 'dblclick') {
                    lines.push(`[MouseCtrl]::mouse_event(2,0,0,0,[IntPtr]::Zero);[MouseCtrl]::mouse_event(4,0,0,0,[IntPtr]::Zero)`);
                    lines.push('Start-Sleep -Milliseconds 50');
                    lines.push(`[MouseCtrl]::mouse_event(2,0,0,0,[IntPtr]::Zero);[MouseCtrl]::mouse_event(4,0,0,0,[IntPtr]::Zero)`);
                }
                execFile(PS_EXE, ['-NoProfile', '-NonInteractive', '-Command', lines.join(';')],
                    { timeout: 5000 }, (err) => {
                        if (err && CONFIG.VERBOSE) log('Mouse error: ' + err.message, 'warn');
                    });
            } catch (err) {
                log('Mouse handler error: ' + err.message, 'error');
            }
        });

        // ── Remote scroll ──
        this.socket.on(`remote-scroll-${CONFIG.PC_NAME}`, (data) => {
            try {
                if (!data) return;
                const x = parseInt(data.x) || 0;
                const y = parseInt(data.y) || 0;
                const delta = parseInt(data.delta) || -120;
                const sw = parseInt(data.screenW) || 1920;
                const sh = parseInt(data.screenH) || 1080;

                if (inputHelper.ready) {
                    inputHelper.sendCommand({ t: 'm', x, y, a: 'scroll', d: delta, sw, sh });
                    return;
                }
                // Fallback: PS mouse_event MOUSEEVENTF_WHEEL = 0x800
                const initPart = MOUSE_PS_INIT;
                execFile(PS_EXE, ['-NoProfile', '-NonInteractive', '-Command',
                    `${initPart};[MouseCtrl]::mouse_event(0x800,0,0,${delta},[IntPtr]::Zero)`
                ], { timeout: 3000 }, (err) => {
                    if (err && CONFIG.VERBOSE) log('Scroll error: ' + err.message, 'warn');
                });
            } catch (err) {
                log('Scroll handler error: ' + err.message, 'error');
            }
        });

        // ── Remote keyboard ──
        this.socket.on(`remote-keyboard-${CONFIG.PC_NAME}`, (data) => {
            try {
                if (!data || !data.key || typeof data.key !== 'string') return;
                const key = data.key;

                // Fast path: persistent C# helper (also supports Meta/Win key)
                if (inputHelper.ready) {
                    inputHelper.sendCommand({
                        t: 'k', k: key,
                        c: !!data.ctrl, a: !!data.alt, s: !!data.shift, m: !!(data.meta || data.win),
                    });
                    return;
                }

                // Fallback: PowerShell SendKeys (slow)
                const keyMap = {
                    'Enter': '{ENTER}', 'Backspace': '{BACKSPACE}', 'Tab': '{TAB}',
                    'Escape': '{ESC}', 'Delete': '{DELETE}', 'ArrowUp': '{UP}',
                    'ArrowDown': '{DOWN}', 'ArrowLeft': '{LEFT}', 'ArrowRight': '{RIGHT}',
                    'Home': '{HOME}', 'End': '{END}', 'PageUp': '{PGUP}', 'PageDown': '{PGDN}',
                    'F1': '{F1}', 'F2': '{F2}', 'F3': '{F3}', 'F4': '{F4}', 'F5': '{F5}',
                    'F6': '{F6}', 'F7': '{F7}', 'F8': '{F8}', 'F9': '{F9}', 'F10': '{F10}',
                    'F11': '{F11}', 'F12': '{F12}', ' ': ' ',
                };
                let sendKey = keyMap[key] || '';
                if (!sendKey && key.length === 1 && /^[a-zA-Z0-9!@#$%^&*()\-_=+\[\]{};:'",.<>?/\\|`~ ]$/.test(key)) {
                    const special = { '+': '{+}', '^': '{^}', '%': '{%}', '~': '{~}', '(': '{(}', ')': '{)}', '{': '{{}', '}': '{}}' };
                    sendKey = special[key] || key;
                }
                if (!sendKey) return;

                let prefix = '';
                if (data.ctrl) prefix += '^';
                if (data.alt) prefix += '%';
                if (data.shift && key.length > 1) prefix += '+';
                const fullKey = prefix + sendKey;
                const safeKey = fullKey.replace(/'/g, "''");

                execFile(PS_EXE, ['-NoProfile', '-NonInteractive', '-Command',
                    `Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait('${safeKey}')`
                ], { timeout: 3000 }, (err) => {
                    if (err && CONFIG.VERBOSE) log('Keyboard error: ' + err.message, 'warn');
                });
            } catch (err) {
                log('Keyboard handler error: ' + err.message, 'error');
            }
        });

        // ── File transfer receive ──────────────────────────
        const FILE_DEST_DIR = path.join(os.homedir(), 'Desktop');
        const activeTransfers = new Map(); // transferId → { filename, chunks, totalChunks, timer }

        this.socket.on(`file-receive-start-${CONFIG.PC_NAME}`, (data) => {
            try {
                const { transferId, filename, totalSize, totalChunks } = data;
                if (!transferId || !filename) return;

                // Ensure destination directory exists
                if (!fs.existsSync(FILE_DEST_DIR)) {
                    fs.mkdirSync(FILE_DEST_DIR, { recursive: true });
                }

                // 60-second inactivity timeout
                const timer = setTimeout(() => {
                    if (activeTransfers.has(transferId)) {
                        activeTransfers.delete(transferId);
                        log(`File transfer timeout: ${transferId} (${filename})`, 'warn');
                    }
                }, 60000);

                activeTransfers.set(transferId, { filename, chunks: [], totalChunks, timer });
                log(`File receive start: ${filename} (${totalChunks} chunks) [${transferId}]`, 'info');
            } catch (err) {
                log('file-receive-start error: ' + err.message, 'error');
            }
        });

        this.socket.on(`file-receive-chunk-${CONFIG.PC_NAME}`, (data) => {
            try {
                const { transferId, chunkIndex, data: chunkData } = data;
                if (!transferId || !activeTransfers.has(transferId)) return;

                const transfer = activeTransfers.get(transferId);

                // Reset inactivity timer
                clearTimeout(transfer.timer);
                transfer.timer = setTimeout(() => {
                    if (activeTransfers.has(transferId)) {
                        activeTransfers.delete(transferId);
                        log(`File transfer timeout: ${transferId} (${transfer.filename})`, 'warn');
                    }
                }, 60000);

                // Store chunk as Buffer
                transfer.chunks[chunkIndex] = Buffer.isBuffer(chunkData) ? chunkData : Buffer.from(chunkData);

                // Emit progress back to server
                this.socket.emit('file-transfer-progress', {
                    transferId,
                    chunkIndex: chunkIndex + 1,
                    totalChunks: transfer.totalChunks,
                });
            } catch (err) {
                log('file-receive-chunk error: ' + err.message, 'error');
            }
        });

        this.socket.on(`file-receive-end-${CONFIG.PC_NAME}`, (data) => {
            try {
                const { transferId } = data;
                if (!transferId || !activeTransfers.has(transferId)) return;

                const transfer = activeTransfers.get(transferId);
                clearTimeout(transfer.timer);
                activeTransfers.delete(transferId);

                // Resolve unique save path
                let savePath = path.join(FILE_DEST_DIR, transfer.filename);
                if (fs.existsSync(savePath)) {
                    const ext = path.extname(transfer.filename);
                    const base = path.basename(transfer.filename, ext);
                    let counter = 1;
                    while (fs.existsSync(savePath)) {
                        savePath = path.join(FILE_DEST_DIR, `${base} (${counter})${ext}`);
                        counter++;
                    }
                }

                // Assemble and write file
                const assembled = Buffer.concat(transfer.chunks);
                fs.writeFileSync(savePath, assembled);

                log(`File saved: ${savePath} (${assembled.length} bytes)`, 'success');

                // Notify server of completion
                this.socket.emit('file-transfer-complete', {
                    transferId,
                    savedPath: savePath,
                    filename: path.basename(savePath),
                    size: assembled.length,
                });
            } catch (err) {
                log('file-receive-end error: ' + err.message, 'error');
            }
        });

        // ── PC → Dashboard: file download request ─────────────────────────
        // Dashboard emits `file-download-request` with { pcName, remotePath }.
        // Server relays to `file-download-request-${pcName}` with { transferId, remotePath, requesterSocketId }.
        // Agent streams file back in 256KB chunks.
        const DOWNLOAD_MAX_SIZE = 100 * 1024 * 1024; // 100 MB hard cap
        const DOWNLOAD_CHUNK = 256 * 1024;
        this.socket.on(`file-download-request-${CONFIG.PC_NAME}`, async (data) => {
            const { transferId, remotePath, requesterSocketId } = data || {};
            const reply = (event, payload) => this.socket.emit(event, { ...payload, transferId, requesterSocketId });
            try {
                if (!transferId || !remotePath || typeof remotePath !== 'string') {
                    reply('file-download-error', { error: 'Invalid request' }); return;
                }
                // Restrict to user-accessible paths (no system dirs). Basic guard.
                const normalized = path.resolve(remotePath);
                const forbidden = [/^C:\\Windows\\/i, /^C:\\Program Files/i, /\\System32\\/i];
                if (forbidden.some(rx => rx.test(normalized))) {
                    reply('file-download-error', { error: 'System path blocked for security' }); return;
                }
                if (!fs.existsSync(normalized)) {
                    reply('file-download-error', { error: 'File not found' }); return;
                }
                const st = fs.statSync(normalized);
                if (!st.isFile()) {
                    reply('file-download-error', { error: 'Not a regular file' }); return;
                }
                if (st.size > DOWNLOAD_MAX_SIZE) {
                    reply('file-download-error', { error: `File too large (max ${DOWNLOAD_MAX_SIZE/1024/1024}MB)` }); return;
                }
                const filename = path.basename(normalized);
                const totalChunks = Math.ceil(st.size / DOWNLOAD_CHUNK) || 1;
                reply('file-download-start', { filename, totalSize: st.size, totalChunks });
                log(`File download: ${filename} (${st.size}b, ${totalChunks} chunks) → ${requesterSocketId}`, 'info');

                const fd = fs.openSync(normalized, 'r');
                try {
                    for (let i = 0; i < totalChunks; i++) {
                        const buf = Buffer.allocUnsafe(Math.min(DOWNLOAD_CHUNK, st.size - i * DOWNLOAD_CHUNK));
                        fs.readSync(fd, buf, 0, buf.length, i * DOWNLOAD_CHUNK);
                        reply('file-download-chunk', { chunkIndex: i, data: buf });
                        // Back-pressure: pause briefly if writeBuffer grows
                        const wbLen = this.socket.io?.engine?.writeBuffer?.length ?? 0;
                        if (wbLen > 32) await new Promise(r => setTimeout(r, 50));
                    }
                } finally { fs.closeSync(fd); }
                reply('file-download-end', { size: st.size });
                log(`File download complete: ${filename}`, 'success');
            } catch (err) {
                log('file-download error: ' + err.message, 'error');
                reply('file-download-error', { error: err.message });
            }
        });
    } // end setupEvents

    // Clipboard auto-sync: poll every 2s for changes, emit to server if detected.
    // Server relays to viewing dashboards which can choose to sync local clipboard.
    // Only active while someone is viewing this PC (stream-${pcName} room has members).
    startClipboardSync() {
        if (this._clipboardInterval) return;
        this._lastClipboard = '';
        this._clipboardInterval = setInterval(() => {
            // Only poll if we're actively being viewed (to save CPU/avoid privacy leak)
            if (!this.socket?.connected) return;
            try {
                const cur = execSync('powershell -NoProfile -Command "Get-Clipboard -Raw"', { timeout: 2000, encoding: 'utf-8' }).replace(/\r\n$/, '');
                if (cur && cur !== this._lastClipboard) {
                    // Limit to 32KB to avoid flooding
                    const payload = cur.length > 32768 ? cur.substring(0, 32768) : cur;
                    this.socket.volatile.emit('clipboard-changed', { pcName: CONFIG.PC_NAME, text: payload, size: cur.length, t: Date.now() });
                    this._lastClipboard = cur;
                }
            } catch (e) { /* clipboard read can fail if another app has lock */ }
        }, 2000);
    }
    stopClipboardSync() {
        if (this._clipboardInterval) { clearInterval(this._clipboardInterval); this._clipboardInterval = null; }
    }

    // Restore blocked programs from server DB on reconnect
    async restoreBlockedPrograms() {
        // Server will send block-program events for existing blocked programs
        // This is handled via the block-program event listener
        log('Blocked programs will sync from server', 'info');
    }

    // ── Status report ────────────────────────────────
    startStatusReport() {
        this.stopStatusReport();
        const report = async () => {
            try {
                const cpuUsage = await getCPUUsage();
                const memoryUsage = getMemoryUsage();
                const activeWindow = await getActiveWindow();
                this.socket.emit('update-status', {
                    pcName: CONFIG.PC_NAME,
                    ipAddress: CONFIG.IP_ADDRESS,
                    cpuUsage,
                    memoryUsage,
                    ts: Date.now(),
                    activeWindow,
                });
            } catch (err) {
                log('Status report error: ' + err.message, 'error');
            }
        };
        report();
        this.statusInterval = setInterval(report, CONFIG.REPORT_INTERVAL);
    }

    stopStatusReport() {
        if (this.statusInterval) {
            clearInterval(this.statusInterval);
            this.statusInterval = null;
        }
    }

    // ── Streaming (ffmpeg gdigrab) ───────────────────
    // ══════════════════════════════════════════
    // Streaming — MJPEG over Socket.IO
    // ══════════════════════════════════════════

    startStreaming(fps = CONFIG.STREAM_FPS, quality = CONFIG.STREAM_QUALITY, mode, monitorIdx = 0) {
        this.stopStreaming();
        this.streaming = true;
        const targetFps = Math.min(CONFIG.STREAM_MAX_FPS, Math.max(CONFIG.STREAM_MIN_FPS, fps));
        const q = Math.max(0, Math.min(100, quality));
        const qv = Math.max(2, Math.round(31 - (q * 29 / 100)));

        const ffmpegPath = this.findFFmpeg();
        if (!ffmpegPath) {
            log('ffmpeg not found, screenshot fallback', 'warn');
            this.startScreenshotStream(targetFps, quality);
            return;
        }

        this._currentMonitor = Math.max(0, parseInt(monitorIdx) || 0);
        // H.264 mode: 90% bandwidth reduction vs MJPEG, MSE-compatible fMP4.
        // Requires client-side MediaSource support. Dashboard sends mode='h264' to enable.
        if (mode === 'h264') {
            this._h264EncoderFailed = {};  // reset encoder blacklist per stream session
            this.startH264Stream(ffmpegPath, targetFps, q);
        } else {
            this.startFFmpegStream(ffmpegPath, targetFps, qv);
        }
    }

    // List connected displays (for multi-monitor switcher)
    getMonitors() {
        try {
            const out = execSync(
                `powershell -NoProfile -Command "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { '{0}|{1}x{2}|{3}|{4}' -f $_.DeviceName, $_.Bounds.Width, $_.Bounds.Height, $_.Primary, $_.Bounds.X }"`,
                { timeout: 5000, encoding: 'utf-8' }
            );
            return out.trim().split(/\r?\n/).map((line, idx) => {
                const [device, size, primary, x] = line.split('|');
                return { idx, device: (device || '').trim(), size: (size || '').trim(), primary: primary === 'True', xOffset: parseInt(x) || 0 };
            });
        } catch (e) {
            return [{ idx: 0, device: 'Primary', size: 'unknown', primary: true, xOffset: 0 }];
        }
    }

    findFFmpeg() {
        try {
            execSync('where ffmpeg', { timeout: 3000, stdio: 'pipe' });
            return 'ffmpeg';
        } catch (e) { /* not found */ }
        const bundled = path.join(__dirname, 'ffmpeg.exe');
        if (fs.existsSync(bundled)) return bundled;
        return null;
    }

    // Probe ffmpeg capabilities once per process: ddagrab (DXGI) + h264 HW encoders
    probeFFmpegCaps(ffmpegPath) {
        if (this._ffmpegCaps) return this._ffmpegCaps;
        const caps = { ddagrab: false, h264_mf: false, h264_nvenc: false, h264_qsv: false, h264_amf: false, libx264: false };
        try {
            const filters = execSync(`"${ffmpegPath}" -hide_banner -filters 2>&1`, { timeout: 3000, encoding: 'utf-8' });
            caps.ddagrab = filters.includes('ddagrab');
            const encoders = execSync(`"${ffmpegPath}" -hide_banner -encoders 2>&1`, { timeout: 3000, encoding: 'utf-8' });
            caps.h264_mf = /h264_mf\s/.test(encoders);
            caps.h264_nvenc = /h264_nvenc\s/.test(encoders);
            caps.h264_qsv = /h264_qsv\s/.test(encoders);
            caps.h264_amf = /h264_amf\s/.test(encoders);
            caps.libx264 = /libx264\s/.test(encoders);
        } catch (e) { log('ffmpeg probe failed: ' + e.message, 'warn'); }
        this._ffmpegCaps = caps;
        log(`ffmpeg caps: dxgi=${caps.ddagrab} nvenc=${caps.h264_nvenc} qsv=${caps.h264_qsv} amf=${caps.h264_amf} mf=${caps.h264_mf} x264=${caps.libx264}`, 'info');
        return caps;
    }

    // ── H.264 fragmented MP4 streaming (MSE-compatible) ──
    startH264Stream(ffmpegPath, fps, quality) {
        // Concurrency guard: prevent overlapping cascade retries from racing each other.
        if (this._h264Starting) return;
        this._h264Starting = true;
        try { if (this.socket?.connected) this.socket.emit('h264-diag', { pcName: CONFIG.PC_NAME, stage: 'entered', fps, quality, ffmpegPath }); } catch(e){}
        if (this.ffmpegProcess) {
            try { this.ffmpegProcess.kill('SIGKILL'); } catch (e) {}
            this.ffmpegProcess = null;
        }
        this._lastFrameTime = Date.now();
        this._streamDropCount = 0;
        this._streamFrameCount = 0;
        this._streamBytesOut = 0;
        this._streamMode = 'h264';

        // HW encoder cascade — try in GPU-vendor-likelihood order, skip known-failed.
        // Remembered winner (this._h264Codec) used for subsequent streams without re-probing.
        // Cascade order: qsv (most student PCs have Intel iGPU) > nvenc > amf > mf (universal) > libx264 (CPU fallback).
        const caps = this.probeFFmpegCaps(ffmpegPath);
        const useDxgi = caps.ddagrab && !this._dxgiFailed;
        const failed = this._h264EncoderFailed || {};
        const remembered = this._h264Codec;

        // libx264 first: proven to work on any Windows with ffmpeg — safest default.
        // HW encoders only attempted if explicitly requested (not in default cascade to avoid chaos).
        const encoderCandidates = [
            { name: 'libx264',    preset: ['-preset', 'ultrafast', '-tune', 'zerolatency'] },
            { name: 'h264_qsv',   preset: ['-preset', 'veryfast', '-look_ahead', '0'] },
            { name: 'h264_nvenc', preset: ['-preset', 'p1', '-tune', 'll', '-rc', 'cbr', '-zerolatency', '1'] },
            { name: 'h264_amf',   preset: ['-quality', 'speed', '-usage', 'ultralowlatency'] },
            { name: 'h264_mf',    preset: ['-hw_encoding', 'true'] },
        ];
        let codec, presetArgs;
        // Prefer remembered if still valid
        const pick = remembered && caps[remembered] && !failed[remembered]
            ? encoderCandidates.find(c => c.name === remembered)
            : encoderCandidates.find(c => caps[c.name] && !failed[c.name]);
        if (pick) { codec = pick.name; presetArgs = pick.preset; }
        else { codec = 'libx264'; presetArgs = ['-preset', 'ultrafast', '-tune', 'zerolatency']; }
        this._h264TriedCodec = codec;

        // Bitrate: quality 0-100 → 500k-3000k
        const bitrate = Math.round(500 + (quality * 25)) + 'k';
        const maxrate = Math.round(800 + (quality * 30)) + 'k';
        const isCctv = fps <= 5;
        const cctvSize = isCctv ? 'scale=640:-1' : 'scale=1280:-1';
        const monitorIdx = Math.max(0, parseInt(this._currentMonitor) || 0);

        let inputArgs, filterChain;
        if (useDxgi) {
            inputArgs = ['-f', 'lavfi', '-i', `ddagrab=output_idx=${monitorIdx}:framerate=${fps}:draw_mouse=1`];
            filterChain = `hwdownload,format=bgra,format=yuv420p,${cctvSize}`;
        } else {
            inputArgs = ['-f', 'gdigrab', '-framerate', String(fps), '-draw_mouse', '1', '-i', 'desktop'];
            filterChain = `${cctvSize},format=yuv420p`;
        }

        log(`H.264 stream: capture=${useDxgi?'DXGI':'GDI'} codec=${codec} ${fps}fps ${bitrate}`, 'success');
        this._streamParams = { ffmpegPath, fps, qv: quality, mode: 'h264', codec, useDxgi };

        // Latency tuning: 2s GOP — proven stable with libx264 ultrafast.
        // Shorter GOP (1s, 0.5s) tested unstable — encoder exited without producing frames.
        const gopFrames = fps * 2;
        // Profile: baseline works for libx264/qsv/nvenc, but amf/mf parse error on "baseline".
        // Skip profile arg for HW encoders that don't accept named profiles.
        const profileArgs = ['libx264', 'h264_qsv', 'h264_nvenc'].includes(codec)
            ? ['-profile:v', 'baseline', '-level', '3.1']
            : [];
        this.ffmpegProcess = spawn(ffmpegPath, [
            '-hide_banner', '-loglevel', 'error',
            ...inputArgs,
            '-vf', filterChain,
            '-c:v', codec,
            ...presetArgs,
            ...profileArgs,
            '-g', String(gopFrames),
            '-keyint_min', String(gopFrames),
            '-bf', '0',
            '-b:v', bitrate,
            '-maxrate', maxrate,
            '-bufsize', Math.round(parseInt(bitrate) / 2) + 'k',
            '-f', 'mp4',
            '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
            'pipe:1'
        ], { stdio: ['pipe', 'pipe', 'pipe'] });
        this._h264Starting = false;  // release lock now that spawn is done

        // Accumulate ftyp+moov as the init segment (sent once, critical for MSE).
        // Then each moof+mdat pair is a media segment (sent volatile, droppable).
        // Using Buffer.concat + scanOffset pattern like MJPEG — safer than pre-alloc copywithin.
        let buf = Buffer.alloc(0);
        let initBuf = null;   // accumulates ftyp+moov until complete
        let initSent = false;
        let bytesReceived = 0;
        const VALID_BOX_TYPES = new Set(['ftyp','moov','moof','mdat','sidx','styp','free','skip']);

        // Close stdin immediately — ffmpeg doesn't need it, leaving it open can deadlock some encoders.
        try { this.ffmpegProcess.stdin?.end(); } catch (e) {}
        // Handle stdout stream errors (SIGPIPE-like EPIPE when consumer dies)
        this.ffmpegProcess.stdout.on('error', (err) => {
            if (err.code !== 'EPIPE') log('H.264 stdout error: ' + err.message, 'warn');
        });

        this.ffmpegProcess.stdout.on('data', (chunk) => {
            if (!this.streaming) return;
            bytesReceived += chunk.length;
            buf = Buffer.concat([buf, chunk]);

            while (buf.length >= 8) {
                const boxSize = buf.readUInt32BE(0);
                if (boxSize < 8 || boxSize > 20 * 1024 * 1024) {
                    log(`H.264 invalid box size ${boxSize}, resyncing (received ${bytesReceived}b)`, 'warn');
                    buf = Buffer.alloc(0); break;
                }
                if (buf.length < boxSize) break;

                const boxType = buf.toString('ascii', 4, 8);
                const box = buf.subarray(0, boxSize);
                buf = buf.subarray(boxSize);

                if (!VALID_BOX_TYPES.has(boxType) && CONFIG.VERBOSE) log(`H.264 unknown box type '${boxType}' size=${boxSize}`, 'warn');

                this._lastFrameTime = Date.now();

                if (!initSent && (boxType === 'ftyp' || boxType === 'moov')) {
                    // Accumulate init segment (ftyp + moov together)
                    initBuf = initBuf ? Buffer.concat([initBuf, box]) : box;
                    if (boxType === 'moov') {
                        if (this.socket.connected) {
                            this.socket.emit('screen-frame', { p: CONFIG.PC_NAME, f: initBuf, t: Date.now(), h264: true, init: true });
                            this._streamBytesOut += initBuf.length;
                            this._streamFrameCount++;
                            log(`H.264 init segment sent: ${initBuf.length}b (ftyp+moov)`, 'success');
                        }
                        initSent = true;
                        initBuf = null;
                    }
                } else if (initSent && (boxType === 'moof' || boxType === 'mdat')) {
                    // Pair moof+mdat into one media segment for atomic delivery
                    if (boxType === 'moof') {
                        this._pendingMoof = box;
                    } else if (boxType === 'mdat' && this._pendingMoof) {
                        const seg = Buffer.concat([this._pendingMoof, box]);
                        this._pendingMoof = null;
                        const wbLen = this.socket.io?.engine?.writeBuffer?.length ?? 0;
                        if (this.socket.connected && wbLen < 8) {
                            this.socket.volatile.emit('screen-frame', { p: CONFIG.PC_NAME, f: seg, t: Date.now(), h264: true });
                            this._streamBytesOut += seg.length;
                            this._streamFrameCount++;
                        } else {
                            this._streamDropCount++;
                        }
                    }
                }
            }
            // Trim runaway buffer
            if (buf.length > 20 * 1024 * 1024) { log('H.264 buffer overflow, reset', 'error'); buf = Buffer.alloc(0); }
        });

        let stderrBuf = '';
        this.ffmpegProcess.stderr.on('data', (data) => {
            stderrBuf += data.toString();
            if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-2048);
        });

        this.ffmpegProcess.on('close', (code) => {
            if (!this.streaming) return;
            const producedFrames = this._streamFrameCount > 0;
            const triedCodec = this._h264TriedCodec;

            if (producedFrames) {
                // Stream ended after producing frames → remember codec as working for next time.
                this._h264Codec = triedCodec;
                const diagMsg = `H.264 OK exit code=${code} codec=${triedCodec} frames=${this._streamFrameCount} bytes=${bytesReceived}`;
                log(diagMsg, 'warn');
                try { if (this.socket?.connected) this.socket.emit('h264-diag', { pcName: CONFIG.PC_NAME, code, codec: triedCodec, frames: this._streamFrameCount, bytes: bytesReceived, stage: 'closed-ok' }); } catch(e){}
                // End of session — user stopped or connection dropped. Don't cascade.
                return;
            }

            // Zero frames → encoder probably failed. Blacklist and try next.
            this._h264EncoderFailed = this._h264EncoderFailed || {};
            this._h264EncoderFailed[triedCodec] = true;
            // Invalidate remembered codec if it was this one
            if (this._h264Codec === triedCodec) this._h264Codec = null;
            const caps2 = this._ffmpegCaps || {};
            const failed2 = this._h264EncoderFailed;
            const hasAnotherEncoder = ['h264_qsv','h264_nvenc','h264_amf','h264_mf','libx264'].some(
                e => caps2[e] && !failed2[e]
            );
            const diagMsg = `H.264 FAILED codec=${triedCodec} code=${code} bytes=${bytesReceived} stderr=${stderrBuf.slice(0, 200).replace(/\r?\n/g, ' | ')}`;
            log(diagMsg, 'error');
            try { if (this.socket?.connected) this.socket.emit('h264-diag', { pcName: CONFIG.PC_NAME, code, codec: triedCodec, frames: 0, bytes: bytesReceived, stderr: stderrBuf.slice(0, 200), stage: 'failed', hasAnotherEncoder }); } catch(e){}

            if (hasAnotherEncoder) {
                log(`Trying next H.264 encoder...`, 'warn');
                // 1200ms delay — gives next encoder enough time to initialize before we time out on it
                setTimeout(() => { if (this.streaming) this.startH264Stream(ffmpegPath, fps, quality); }, 1200);
            } else {
                log('All H.264 encoders exhausted — falling back to MJPEG', 'error');
                this._streamMode = 'mjpeg';
                this.startFFmpegStream(ffmpegPath, fps, 5);
            }
        });

        this.ffmpegProcess.on('error', (err) => {
            log('H.264 ffmpeg error: ' + err.message + ', falling back to MJPEG', 'error');
            this._streamMode = 'mjpeg';
            this.startFFmpegStream(ffmpegPath, fps, 5);
        });

        // Watchdog + stats telemetry (same cadence as MJPEG path)
        if (this._ffmpegWatchdog) clearInterval(this._ffmpegWatchdog);
        this._lastStatsEmit = Date.now();
        this._statsLastFrameCount = 0;
        this._statsLastDropCount = 0;
        this._statsLastBytesOut = 0;
        this._ffmpegWatchdog = setInterval(() => {
            if (!this.streaming || !this.ffmpegProcess) return;
            const now = Date.now();
            const sinceLastFrame = now - this._lastFrameTime;

            if (now - this._lastStatsEmit >= 5000) {
                const deltaSec = (now - this._lastStatsEmit) / 1000;
                const deltaFrames = this._streamFrameCount - this._statsLastFrameCount;
                const deltaDrops = this._streamDropCount - this._statsLastDropCount;
                const deltaBytes = this._streamBytesOut - this._statsLastBytesOut;
                const rss = process.memoryUsage().rss;
                if (this.socket?.connected) {
                    this.socket.volatile.emit('stream-stats', {
                        p: CONFIG.PC_NAME,
                        fps: +(deltaFrames / deltaSec).toFixed(1),
                        drops: deltaDrops,
                        kbps: Math.round(deltaBytes * 8 / 1024 / deltaSec),
                        totalFrames: this._streamFrameCount,
                        sinceLastFrame,
                        rssMB: Math.round(rss / 1024 / 1024),
                        mode: 'h264',
                        codec: this._h264TriedCodec,
                        t: now,
                    });
                }
                this._lastStatsEmit = now;
                this._statsLastFrameCount = this._streamFrameCount;
                this._statsLastDropCount = this._streamDropCount;
                this._statsLastBytesOut = this._streamBytesOut;
            }

            if (sinceLastFrame > 5000) {
                log('H.264 ffmpeg HUNG — force restart', 'error');
                try { this.ffmpegProcess.kill('SIGKILL'); } catch (e) {}
            }
        }, 2000);
    }

    startFFmpegStream(ffmpegPath, fps, qv) {
        // Kill existing process cleanly before respawn
        if (this.ffmpegProcess) {
            try { this.ffmpegProcess.kill('SIGKILL'); } catch (e) {}
            this.ffmpegProcess = null;
        }
        if (this._ffmpegWatchdog) {
            clearInterval(this._ffmpegWatchdog);
            this._ffmpegWatchdog = null;
        }

        // Track last frame time for hang detection
        this._lastFrameTime = Date.now();
        this._streamDropCount = 0;
        this._streamFrameCount = 0;
        this._streamParams = { ffmpegPath, fps, qv };

        // Resolution: scale to 720p for bandwidth efficiency.
        // Dashboard window is ~640-900px wide, so 1280×720 is more than enough.
        // For CCTV mode (low fps), scale even further to 640×360.
        const isCctv = fps <= 5;
        const cctvSize = isCctv ? 'scale=640:-1' : 'scale=1280:-1';

        // Capture strategy: DXGI (ddagrab) GPU-accelerated > gdigrab (CPU/GDI fallback).
        // DXGI achieves stable 30fps+ with 2-4x less CPU. Falls back to gdigrab if:
        //   - ffmpeg lacks ddagrab filter (old build)
        //   - DXGI fails at startup (driver/UAC/secure desktop context)
        const caps = this.probeFFmpegCaps(ffmpegPath);
        const useDxgi = caps.ddagrab && !this._dxgiFailed;

        const monitorIdx = Math.max(0, parseInt(this._currentMonitor) || 0);

        let ffArgs;
        if (useDxgi) {
            // DXGI Desktop Duplication API — outputs D3D11 frames, hwdownload to BGRA then MJPEG encode
            ffArgs = [
                '-hide_banner', '-loglevel', 'error',
                '-f', 'lavfi',
                '-i', `ddagrab=output_idx=${monitorIdx}:framerate=${fps}:draw_mouse=1`,
                '-vf', `hwdownload,format=bgra,format=yuvj420p,${cctvSize}`,
                '-c:v', 'mjpeg',
                '-q:v', String(qv),
                '-huffman', 'optimal',
                '-f', 'image2pipe',
                'pipe:1'
            ];
            log(`MJPEG+DXGI stream: monitor=${monitorIdx} ${fps}fps q:v=${qv} ${isCctv ? '360p CCTV' : '720p HD'} GPU`, 'success');
        } else {
            ffArgs = [
                '-hide_banner', '-loglevel', 'error',
                '-f', 'gdigrab',
                '-framerate', String(fps),
                '-draw_mouse', '1',
                '-i', 'desktop',
                '-vf', cctvSize,
                '-vcodec', 'mjpeg',
                '-pix_fmt', 'yuvj420p',
                '-q:v', String(qv),
                '-huffman', 'optimal',
                '-f', 'image2pipe',
                'pipe:1'
            ];
            log(`MJPEG+GDI stream: ${fps}fps q:v=${qv} ${isCctv ? '360p CCTV' : '720p HD'} (DXGI ${caps.ddagrab?'skipped':'unavailable'})`, 'warn');
        }

        this._streamParams.useDxgi = useDxgi;
        this.ffmpegProcess = spawn(ffmpegPath, ffArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

        // Close stdin — ffmpeg doesn't need it and some setups hang waiting.
        try { this.ffmpegProcess.stdin?.end(); } catch (e) {}
        // EPIPE-safe stdout error handling
        this.ffmpegProcess.stdout.on('error', (err) => {
            if (err.code !== 'EPIPE') log('MJPEG stdout error: ' + err.message, 'warn');
        });

        // Frame buffer: Buffer.concat + scan offset (avoids re-scanning already-checked bytes).
        // We scan for SOI starting from `scanOffset` instead of 0, reducing indexOf work to O(new bytes).
        let buf = Buffer.alloc(0);
        let scanOffset = 0;
        const SOI = Buffer.from([0xFF, 0xD8]);
        const EOI = Buffer.from([0xFF, 0xD9]);
        this._streamBytesOut = 0;

        this.ffmpegProcess.stdout.on('data', (chunk) => {
            if (!this.streaming) return;
            buf = Buffer.concat([buf, chunk]);

            while (true) {
                const start = buf.indexOf(SOI, scanOffset);
                if (start === -1) {
                    // Keep last byte in case SOI straddles chunks (0xFF at end)
                    scanOffset = Math.max(0, buf.length - 1);
                    break;
                }
                const end = buf.indexOf(EOI, start + 2);
                if (end === -1) {
                    scanOffset = start;  // resume from SOI next time
                    break;
                }

                const frame = buf.subarray(start, end + 2);
                buf = buf.subarray(end + 2);
                scanOffset = 0;  // new window starts from 0
                this._lastFrameTime = Date.now();
                this._streamFrameCount++;

                const wbLen = this.socket.io?.engine?.writeBuffer?.length ?? 0;
                if (this.socket.connected && wbLen < 8) {
                    this.socket.volatile.emit('screen-frame', {
                        p: CONFIG.PC_NAME,
                        f: frame,
                        t: Date.now(),
                    });
                    this._streamBytesOut += frame.length;
                } else {
                    this._streamDropCount++;
                }
            }
            // Trim runaway buffer (malformed stream protection)
            if (buf.length > 5 * 1024 * 1024) {
                buf = buf.subarray(buf.length - 512 * 1024);
                scanOffset = 0;
            }
        });

        // Capture early stderr for DXGI failure detection
        let stderrBuf = '';
        this.ffmpegProcess.stderr.on('data', (data) => {
            const line = data.toString();
            stderrBuf += line;
            if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-2048);
            if (CONFIG.VERBOSE && line.includes('frame=')) log(line.trim());
        });

        this.ffmpegProcess.on('close', (code) => {
            if (this._ffmpegWatchdog) {
                clearInterval(this._ffmpegWatchdog);
                this._ffmpegWatchdog = null;
            }
            if (this.streaming) {
                // If DXGI failed early (exit within 3s with no frames), blacklist DXGI and fall back to gdigrab
                const framesSent = this._streamFrameCount || 0;
                if (this._streamParams?.useDxgi && framesSent === 0 && /ddagrab|d3d11|Desktop Duplication/i.test(stderrBuf)) {
                    this._dxgiFailed = true;
                    log('DXGI capture failed → switching to gdigrab for session. stderr: ' + stderrBuf.slice(0, 200), 'warn');
                }
                log('ffmpeg exited (' + code + '), restarting in 1s...', 'warn');
                setTimeout(() => {
                    if (this.streaming) this.startFFmpegStream(ffmpegPath, fps, qv);
                }, 1000);
            }
        });

        this.ffmpegProcess.on('error', (err) => {
            log('ffmpeg error: ' + err.message, 'error');
            if (this._ffmpegWatchdog) {
                clearInterval(this._ffmpegWatchdog);
                this._ffmpegWatchdog = null;
            }
            this.ffmpegProcess = null;
            if (this.streaming) this.startScreenshotStream(fps, 80);
        });

        // Watchdog + telemetry: escalating stall detection and per-5s stats emit.
        // Levels: 3s warn → 5s restart → 15s full re-init (in case the restart loop itself is stuck).
        this._lastStatsEmit = Date.now();
        this._statsLastFrameCount = 0;
        this._statsLastDropCount = 0;
        this._statsLastBytesOut = 0;
        this._restartAttempts = 0;

        this._ffmpegWatchdog = setInterval(() => {
            if (!this.streaming || !this.ffmpegProcess) return;
            const now = Date.now();
            const sinceLastFrame = now - this._lastFrameTime;

            // Stats telemetry every 5s
            if (now - this._lastStatsEmit >= 5000) {
                const deltaSec = (now - this._lastStatsEmit) / 1000;
                const deltaFrames = this._streamFrameCount - this._statsLastFrameCount;
                const deltaDrops = this._streamDropCount - this._statsLastDropCount;
                const deltaBytes = this._streamBytesOut - this._statsLastBytesOut;
                const rss = process.memoryUsage().rss;
                if (this.socket?.connected) {
                    this.socket.volatile.emit('stream-stats', {
                        p: CONFIG.PC_NAME,
                        fps: +(deltaFrames / deltaSec).toFixed(1),
                        drops: deltaDrops,
                        kbps: Math.round(deltaBytes * 8 / 1024 / deltaSec),
                        totalFrames: this._streamFrameCount,
                        sinceLastFrame,
                        rssMB: Math.round(rss / 1024 / 1024),
                        mode: this._streamMode || 'mjpeg',
                        codec: this._h264TriedCodec,
                        t: now,
                    });
                }
                this._lastStatsEmit = now;
                this._statsLastFrameCount = this._streamFrameCount;
                this._statsLastDropCount = this._streamDropCount;
                this._statsLastBytesOut = this._streamBytesOut;
            }

            // Escalating stall recovery
            if (sinceLastFrame > 15000) {
                // Level 3: restart loop itself may be stuck — nuke and re-init
                log('ffmpeg DEAD (no frames for ' + Math.round(sinceLastFrame/1000) + 's) — full re-init', 'error');
                try { this.ffmpegProcess.kill('SIGKILL'); } catch (e) {}
                this._restartAttempts++;
                this._lastFrameTime = Date.now(); // reset counter
                if (this._restartAttempts >= 5) {
                    log('ffmpeg restart failing 5x, falling back to screenshot mode', 'error');
                    this.streaming = false;
                    clearInterval(this._ffmpegWatchdog);
                    this._ffmpegWatchdog = null;
                    setTimeout(() => this.startScreenshotStream(fps, 80), 2000);
                }
            } else if (sinceLastFrame > 5000) {
                log('ffmpeg HUNG (' + Math.round(sinceLastFrame/1000) + 's) — force restart', 'error');
                try { this.ffmpegProcess.kill('SIGKILL'); } catch (e) {}
                // close handler will restart
            } else if (sinceLastFrame > 3000) {
                // Level 1: warn, don't restart yet (may be legitimate slow frame)
                if (CONFIG.VERBOSE) log('ffmpeg slow: ' + Math.round(sinceLastFrame/1000) + 's since last frame', 'warn');
            } else if (sinceLastFrame < 1000 && this._restartAttempts > 0) {
                // Recovered
                this._restartAttempts = 0;
            }
        }, 2000);
    }

    startScreenshotStream(fps, quality) {
        log('Screenshot fallback: ' + fps + 'fps', 'warn');
        const captureAndSend = async () => {
            if (!this.streaming || !this.connected) return;
            try {
                const screenshot = require('screenshot-desktop');
                const imgBuffer = await screenshot({ format: 'jpg', quality });
                this.socket.emit('screen-frame', {
                    pcName: CONFIG.PC_NAME,
                    frame: imgBuffer.toString('base64'),
                    timestamp: Date.now(), fps, size: imgBuffer.length,
                });
            } catch (e) {
                try {
                    const base64 = await captureScreenshot();
                    if (base64) {
                        this.socket.emit('screen-frame', {
                            pcName: CONFIG.PC_NAME, frame: base64,
                            timestamp: Date.now(), fps: 1, size: base64.length,
                        });
                    }
                } catch (e2) { /* skip */ }
            }
            if (this.streaming) {
                this.streamTimeout = setTimeout(captureAndSend, 1000 / Math.min(fps, 5));
            }
        };
        captureAndSend();
    }

    stopStreaming() {
        if (this.streaming) log('Stream stopped', 'warn');
        this.streaming = false;
        if (this._ffmpegWatchdog) {
            clearInterval(this._ffmpegWatchdog);
            this._ffmpegWatchdog = null;
        }
        if (this.ffmpegProcess) {
            try { this.ffmpegProcess.kill('SIGKILL'); } catch (e) { /* ok */ }
            this.ffmpegProcess = null;
        }
        if (this.streamTimeout) {
            clearTimeout(this.streamTimeout);
            this.streamTimeout = null;
        }
        this._streamDropCount = 0;
        this._streamFrameCount = 0;
    }

    checkForUpdate(force = false) {
        const http = require('http');
        http.get(CONFIG.SERVER_URL + '/api/agent-version', (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const info = JSON.parse(data);
                    const needUpdate = force || (info.version && info.version !== CONFIG.AGENT_VERSION);
                    if (needUpdate) {
                        log('Update: v' + CONFIG.AGENT_VERSION + ' -> v' + info.version + ' (sha256=' + (info.sha256 || '').slice(0, 12) + ')', 'warn');
                        this.doUpdate(CONFIG.SERVER_URL + (info.url || '/agent-latest.js'), info.sha256 || null);
                    }
                } catch (e) { /* skip */ }
            });
        }).on('error', () => {});
    }

    doUpdate(dlUrl, expectedSha256) {
        // Concurrent update guard: prevent multiple overlapping downloads from racing file writes.
        if (this._updateInProgress) { log('Update already in progress, skip', 'info'); return; }
        this._updateInProgress = true;
        // Auto-release lock after 5 minutes to prevent permanent deadlock on hang/crash
        const lockTimeout = setTimeout(() => {
            if (this._updateInProgress) {
                log('Update lock auto-released after 5min timeout', 'warn');
                this._updateInProgress = false;
            }
        }, 5 * 60 * 1000);
        const clearFlag = () => {
            this._updateInProgress = false;
            clearTimeout(lockTimeout);
        };

        const http = require('http');
        const crypto = require('crypto');
        const tmpPath = path.join(__dirname, 'agent-new.js');
        const agentPath = path.join(__dirname, 'agent.js');
        const bakPath = path.join(__dirname, 'agent.js.bak');

        // Clean up stale tmp file from previous interrupted download
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch(e){}

        const file = fs.createWriteStream(tmpPath);
        file.on('error', (err) => {
            log('Update write error: ' + err.message, 'error');
            try { fs.unlinkSync(tmpPath); } catch(e){}
            clearFlag();
        });

        const req = http.get(dlUrl, (res) => {
            if (res.statusCode !== 200) {
                file.close();
                try { fs.unlinkSync(tmpPath); } catch(e){}
                log('Update download HTTP ' + res.statusCode, 'error');
                clearFlag();
                return;
            }
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                try {
                    const content = fs.readFileSync(tmpPath);

                    // Sanity check: must contain our marker AND be >5KB
                    if (content.length < 5000 || !content.toString('utf-8').includes('AGENT_VERSION')) {
                        throw new Error('Downloaded agent looks invalid (size=' + content.length + ')');
                    }

                    // SHA256 verification if server provided hash
                    if (expectedSha256) {
                        const actualSha = crypto.createHash('sha256').update(content).digest('hex');
                        if (actualSha !== expectedSha256) {
                            throw new Error('SHA256 mismatch: expected=' + expectedSha256.slice(0, 12) + ' actual=' + actualSha.slice(0, 12));
                        }
                        log('SHA256 verified: ' + actualSha.slice(0, 12), 'success');
                    }

                    // Backup current agent before overwrite (atomic via fsync)
                    if (fs.existsSync(agentPath)) {
                        try {
                            fs.copyFileSync(agentPath, bakPath);
                            const bfd = fs.openSync(bakPath, 'r+'); fs.fsyncSync(bfd); fs.closeSync(bfd);
                        } catch (e) { /* best effort */ }
                    }

                    // ATOMIC REPLACE: rename is atomic on same volume (both POSIX and Win32).
                    // This eliminates the partial-write race window that corrupted codingssok-42.
                    try {
                        fs.renameSync(tmpPath, agentPath);
                    } catch (renameErr) {
                        // Fallback: if rename fails (cross-device or locked), copy+verify+delete
                        log('rename failed, fallback to copy: ' + renameErr.message, 'warn');
                        fs.copyFileSync(tmpPath, agentPath);
                        const vfd = fs.openSync(agentPath, 'r+'); fs.fsyncSync(vfd); fs.closeSync(vfd);
                        fs.unlinkSync(tmpPath);
                    }

                    // Post-write integrity: re-read and re-hash to confirm disk state matches expected
                    const diskContent = fs.readFileSync(agentPath);
                    if (diskContent.length !== content.length) {
                        throw new Error('Post-write size mismatch: expected=' + content.length + ' disk=' + diskContent.length);
                    }
                    if (expectedSha256) {
                        const diskSha = crypto.createHash('sha256').update(diskContent).digest('hex');
                        if (diskSha !== expectedSha256) {
                            throw new Error('Post-write SHA mismatch: disk=' + diskSha.slice(0, 12));
                        }
                    }
                    log('Agent updated and integrity-verified. Restarting...', 'success');

                    // Relaunch via VBS if present, else via autostart.bat loop
                    const vbs = path.join(__dirname, 'start-hidden.vbs');
                    if (fs.existsSync(vbs)) {
                        execFile('wscript.exe', [vbs], { timeout: 5000 }, () => {});
                    }
                    setTimeout(() => process.exit(0), 2000);
                } catch (e) {
                    log('Update failed: ' + e.message + ' -- restoring backup if available', 'error');
                    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch(e2){}
                    // Restore from backup if current agent.js was corrupted (size < 5KB or SHA bad)
                    try {
                        const needRestore = !fs.existsSync(agentPath) || fs.statSync(agentPath).size < 5000;
                        if (fs.existsSync(bakPath) && needRestore) {
                            fs.copyFileSync(bakPath, agentPath);
                            const rfd = fs.openSync(agentPath, 'r+'); fs.fsyncSync(rfd); fs.closeSync(rfd);
                            log('Agent restored from backup', 'warn');
                        }
                    } catch(e3){ log('Backup restore failed: ' + e3.message, 'error'); }
                    clearFlag();
                }
            });
        });

        // HTTP download timeout — prevent infinite hang on dead connection
        req.setTimeout(60000, () => {
            log('Update download timeout (60s) -- aborting', 'error');
            req.destroy();
            file.close();
            try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch(e){}
            clearFlag();
        });

        req.on('error', (err) => {
            file.close();
            try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch(e){}
            log('Update connection error: ' + err.message, 'error');
            clearFlag();
        });
    }

    // Periodic update check (every 10 minutes) — allows silent rolling update
    startPeriodicUpdateCheck() {
        if (this._updateCheckInterval) clearInterval(this._updateCheckInterval);
        this._updateCheckInterval = setInterval(() => this.checkForUpdate(), 10 * 60 * 1000);
    }
}

// ── Start ────────────────────────────────────────────
const agent = new PCAgent();

process.on('SIGINT', () => {
    log('Agent shutting down...', 'warn');
    agent.stopStreaming();
    stopBlockMonitor();
    stopWallpaperLock();
    inputHelper.destroy();
    if (agent.socket) {
        agent.socket.emit('log-activity', {
            pcName: CONFIG.PC_NAME,
            user: os.userInfo().username,
            activityType: 'logout',
            details: 'Agent shutdown',
        });
        agent.socket.disconnect();
    }
    process.exit(0);
});

process.on('SIGTERM', () => process.emit('SIGINT'));

// Crash counter: if agent crashes too often, exit so watchdog.vbs reboots the process.
// Swallowing uncaught exceptions indefinitely masks bad state (memory corruption, handle leaks).
const _crashLog = [];
const CRASH_WINDOW_MS = 10 * 60 * 1000;
const CRASH_THRESHOLD = 5;
function recordCrash(kind, msg) {
    const now = Date.now();
    _crashLog.push(now);
    while (_crashLog.length && now - _crashLog[0] > CRASH_WINDOW_MS) _crashLog.shift();
    if (_crashLog.length >= CRASH_THRESHOLD) {
        log(`Crash threshold reached (${_crashLog.length} in 10min) -- exiting for watchdog reboot`, 'error');
        try { agent.stopStreaming(); } catch(e){}
        setTimeout(() => process.exit(1), 500);
    }
}
process.on('uncaughtException', (err) => {
    log('Uncaught exception: ' + err.message, 'error');
    log(err.stack || '(no stack)', 'error');
    recordCrash('uncaught', err.message);
});
process.on('unhandledRejection', (reason) => {
    const msg = reason && reason.message ? reason.message : String(reason);
    log('Unhandled rejection: ' + msg, 'error');
    recordCrash('rejection', msg);
});

// Self-watchdog: if disconnected for 2+ minutes, force reconnect
setInterval(() => {
    if (agent.socket && !agent.socket.connected) {
        const disconnectedFor = Date.now() - (agent._lastConnected || 0);
        if (disconnectedFor > 120000) {
            log('Watchdog: disconnected 2min+, forcing reconnect', 'warn');
            try {
                agent.socket.disconnect();
                agent.socket.connect();
            } catch (e) {
                log('Watchdog reconnect error: ' + e.message, 'error');
                // Last resort: recreate socket
                try { agent.connect(); } catch (e2) { /* */ }
            }
        }
    }
}, 60000);

// Memory watchdog: Node.js has known V8 heap fragmentation under long-running agents.
// If RSS exceeds 600MB sustained for 3 consecutive checks (3min), exit cleanly so
// watchdog.vbs restarts a fresh process. Cheaper than debugging leaks in the field.
const MEM_THRESHOLD_BYTES = 600 * 1024 * 1024;
let _memHighCount = 0;
setInterval(() => {
    try {
        const rss = process.memoryUsage().rss;
        if (rss > MEM_THRESHOLD_BYTES) {
            _memHighCount++;
            log(`Memory high: ${Math.round(rss/1024/1024)}MB (${_memHighCount}/3)`, 'warn');
            if (_memHighCount >= 3) {
                log('Memory watchdog: sustained high RSS -- exiting for fresh restart', 'warn');
                try { agent.stopStreaming(); } catch(e){}
                if (agent.socket) { try { agent.socket.disconnect(); } catch(e){} }
                setTimeout(() => process.exit(2), 1000);
            }
        } else {
            _memHighCount = 0;
        }
    } catch(e) { /* ignore */ }
}, 60000);
