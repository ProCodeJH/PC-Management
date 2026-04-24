// PC Manager — Minimal Dashboard
// Only: login, PC list, real-time status

// ── Icon system: Lucide-style stroke SVGs (no emoji) ──
// Centralized so all UI uses consistent icon weight and rendering.
const ICONS = {
    trash:    '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    mail:     '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
    list:     '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    ban:      '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    upload:   '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    zap:      '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    clock:    '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    xCircle:  '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    alert:    '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    refresh:  '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    x:        '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    eye:      '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    sparkle:  '<path d="M12 3l1.9 5.5L19 10l-5.1 1.5L12 17l-1.9-5.5L5 10l5.1-1.5L12 3z"/>',
};

function svgIcon(name, size = 14) {
    const body = ICONS[name] || '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

// ── Audio notification system ──
// Uses Web Audio API (no external files needed).
// Generates tones programmatically — works offline, no latency.
const _audioCtx = typeof AudioContext !== 'undefined' ? new AudioContext() : null;
function playTone(freq = 440, duration = 0.15, volume = 0.3) {
    if (!_audioCtx || localStorage.getItem('mute-sounds') === '1') return;
    try {
        if (_audioCtx.state === 'suspended') _audioCtx.resume();
        const osc = _audioCtx.createOscillator();
        const gain = _audioCtx.createGain();
        osc.connect(gain);
        gain.connect(_audioCtx.destination);
        osc.frequency.value = freq;
        gain.gain.value = volume;
        gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + duration);
        osc.start();
        osc.stop(_audioCtx.currentTime + duration);
    } catch (e) { /* audio not supported */ }
}
// Notification sound presets
const SOUNDS = {
    violation: () => { playTone(880, 0.1); setTimeout(() => playTone(660, 0.15), 120); },  // descending beep
    disconnect: () => playTone(330, 0.3, 0.2),  // low tone
    connect: () => playTone(523, 0.1, 0.15),     // short high
    alert: () => { playTone(740, 0.1); setTimeout(() => playTone(740, 0.1), 150); },  // double beep
};

class PCManager {
    constructor() {
        this.token = localStorage.getItem('token');
        this.socket = null;
        this.pcs = new Map();
        this.livePC = null;
        this.frameCount = 0;
        this.lastFpsTime = 0;
        this.dragSrc = null;  // drag-and-drop source card
        this._keyHandler = null;
        this._wheelHandler = null;

        // Global ESC to close modals (lower priority than control mode / CCTV)
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            // If control mode is active, turn it off instead of closing live view
            if (this.livePC && this.controlMode) {
                this.controlMode = false;
                const controlBtn = document.getElementById('live-control');
                controlBtn.textContent = '원격 조작';
                controlBtn.className = 'text-xs px-3 py-1 bg-gray-100 rounded-lg hover:bg-blue-100 transition';
                document.getElementById('live-control-status').textContent = '';
                return;
            }
            // Skip if CCTV or _keyHandler is handling (they have their own ESC)
            if (this._cctvEscHandler) return;
            if (this.livePC) { this.closeLiveView(); return; }
            const modals = ['block-sites-modal', 'block-prog-modal', 'msg-modal', 'proc-modal', 'block-settings-modal', 'schedule-modal', 'shortcut-modal', 'integrations-modal', 'gallery-modal', 'gallery-preview'];
            for (const id of modals) {
                const el = document.getElementById(id);
                if (el && !el.classList.contains('hidden')) { el.classList.add('hidden'); return; }
            }
        });

        // Always get fresh token via auto-login (prevents jwt expired issues)
        this.autoLogin();
    }

    // ── Util ─────────────────────────────────
    esc(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    async autoLogin() {
        try {
            const res = await fetch('/api/auth/auto-token');
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.token) {
                    this.token = data.token;
                    localStorage.setItem('token', data.token);
                    this.showDashboard();
                    return;
                }
            }
        } catch (e) { /* auto-token failed, fall back to login */ }
        this.showLogin();
    }

    // ── Login ─────────────────────────────────
    showLogin() {
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('dashboard').classList.add('hidden');
        const userInput = document.getElementById('login-user');
        const passInput = document.getElementById('login-pass');
        const loginBtn = document.getElementById('login-btn');
        const errorEl = document.getElementById('login-error');

        userInput.focus();

        const doLogin = async () => {
            const username = userInput.value.trim();
            const password = passInput.value;
            if (!username || !password) return;

            errorEl.classList.add('hidden');
            loginBtn.textContent = '로그인 중...';
            loginBtn.disabled = true;

            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();
                if (data.success && data.token) {
                    this.token = data.token;
                    localStorage.setItem('token', data.token);
                    this.showDashboard();
                } else {
                    errorEl.textContent = data.error || '로그인 실패';
                    errorEl.classList.remove('hidden');
                }
            } catch (e) {
                errorEl.textContent = '서버 연결 실패';
                errorEl.classList.remove('hidden');
            }
            loginBtn.textContent = '로그인';
            loginBtn.disabled = false;
        };

        loginBtn.onclick = doLogin;
        passInput.onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };
        userInput.onkeydown = (e) => { if (e.key === 'Enter') passInput.focus(); };

        // Password visibility toggle
        const passToggle = document.getElementById('login-pass-toggle');
        if (passToggle) {
            passToggle.onclick = () => {
                passInput.type = passInput.type === 'password' ? 'text' : 'password';
            };
        }
    }

    showDashboard() {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('dashboard').classList.remove('hidden');
        document.getElementById('block-sites-btn').onclick = () => this.openBlockSitesModal();
        document.getElementById('cctv-btn').onclick = () => this.openCCTV();
        document.getElementById('block-settings-btn').onclick = () => this.toggleBlockSettings();
        document.getElementById('block-install-btn').onclick = () => this.toggleBlockInstall();
        document.getElementById('wallpaper-lock-btn').onclick = () => this.toggleWallpaperLock();
        document.getElementById('agent-update-btn').onclick = () => this.pushAgentUpdate();
        document.getElementById('boot-all-btn').onclick = () => this.bootAllPCs();
        document.getElementById('ping-sweep-btn').onclick = () => this.pingSweep();
        document.getElementById('share-screen-btn').onclick = () => this.toggleScreenShare();
        document.getElementById('logout-btn').onclick = () => {
            localStorage.removeItem('token');
            this.token = null;
            location.reload();
        };
        document.getElementById('change-pw-btn').onclick = () => this.openChangePassword();
        document.getElementById('attention-btn').onclick = () => this.toggleAttention();
        document.getElementById('broadcast-btn').onclick = () => this.broadcastMessage();
        document.getElementById('exam-mode-btn').onclick = () => this.toggleExamMode();
        const schedBtn = document.getElementById('schedule-btn');
        if (schedBtn) schedBtn.onclick = () => this.openScheduleModal();
        const reportBtn = document.getElementById('report-btn');
        if (reportBtn) reportBtn.onclick = () => this.openReport();
        const intBtn = document.getElementById('integrations-btn');
        if (intBtn) intBtn.onclick = () => this.openIntegrations();
        const galleryBtn = document.getElementById('gallery-btn');
        if (galleryBtn) galleryBtn.onclick = () => this.openGallery();
        this.initSidebar();
        this.initAllPCsMenu();
        this.initKeyboardShortcuts();
        this.initSelectionBar();
        this.initDragSelectBox();
        this.initPcSearch();
        this.initTheme();
        this.initMuteToggle();

        this.connectSocket();
        this.loadPCs();
        this.loadSitesBadge();
        this.loadWallpaperState();
        this.loadExamModeState();
        this.checkLicense();
    }

    initSidebar() {
        const sidebar = document.getElementById('sidebar');
        const toggle = document.getElementById('sidebar-toggle');
        const resize = document.getElementById('sidebar-resize');
        const mobileBtn = document.getElementById('mobile-menu-btn');

        // Mobile drawer toggle
        if (mobileBtn) {
            mobileBtn.onclick = () => sidebar.classList.toggle('mobile-open');
            // Close drawer when clicking on a nav item
            sidebar.querySelectorAll('button[id$="-btn"]').forEach(b => {
                b.addEventListener('click', () => {
                    if (window.innerWidth <= 768) sidebar.classList.remove('mobile-open');
                });
            });
        }

        // Toggle collapse — persisted to localStorage
        const savedCollapsed = localStorage.getItem('sidebar-collapsed') === '1';
        if (savedCollapsed) sidebar.classList.add('collapsed');
        toggle.onclick = () => {
            sidebar.classList.toggle('collapsed');
            localStorage.setItem('sidebar-collapsed',
                sidebar.classList.contains('collapsed') ? '1' : '0');
        };

        // Drag resize — only when not collapsed
        const savedWidth = parseInt(localStorage.getItem('sidebar-width') || '224', 10);
        if (savedWidth && !sidebar.classList.contains('collapsed')) {
            sidebar.style.width = Math.max(160, Math.min(480, savedWidth)) + 'px';
        }
        let dragging = false;
        resize.addEventListener('mousedown', (e) => {
            if (sidebar.classList.contains('collapsed')) return;
            dragging = true;
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const w = Math.max(160, Math.min(480, e.clientX));
            sidebar.style.width = w + 'px';
        });
        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            localStorage.setItem('sidebar-width', parseInt(sidebar.style.width, 10));
        });
    }

    // ── Theme (dark/light) ──
    initTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        this._applyTheme(savedTheme);
        const btn = document.getElementById('theme-toggle');
        if (!btn) return;
        btn.onclick = () => {
            const now = document.body.classList.contains('dark') ? 'light' : 'dark';
            this._applyTheme(now);
            localStorage.setItem('theme', now);
        };
    }
    _applyTheme(theme) {
        const isDark = theme === 'dark';
        document.body.classList.toggle('dark', isDark);
        const moon = document.getElementById('theme-moon');
        const sun = document.getElementById('theme-sun');
        if (moon && sun) {
            moon.classList.toggle('hidden', isDark);
            sun.classList.toggle('hidden', !isDark);
        }
        // Update PWA theme-color meta for mobile status bar
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', isDark ? '#0f0f10' : '#ffffff');
    }
    initMuteToggle() {
        const btn = document.getElementById('mute-toggle');
        if (!btn) return;
        const apply = () => {
            const muted = localStorage.getItem('mute-sounds') === '1';
            document.getElementById('mute-off')?.classList.toggle('hidden', muted);
            document.getElementById('mute-on')?.classList.toggle('hidden', !muted);
        };
        apply();
        btn.onclick = () => {
            const now = localStorage.getItem('mute-sounds') === '1' ? '0' : '1';
            localStorage.setItem('mute-sounds', now);
            apply();
        };
    }

    async toggleExamMode() {
        const enabling = !this._examMode;
        const btn = document.getElementById('exam-mode-btn');

        // When enabling: ask for whitelist. Cancel aborts entirely.
        let programs = [];
        if (enabling) {
            const whitelist = prompt('허용할 프로그램 (쉼표 구분, 비워두면 기본값):\n예: chrome.exe, code.exe', '');
            if (whitelist === null) return; // user cancelled
            programs = whitelist.split(',').map(s => s.trim()).filter(Boolean);
        }
        this._examMode = enabling;
        try {
            const resp = await this.apiFetch('/api/exam-mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: this._examMode, whitelist: programs }),
            });
            if (resp.ok) {
                btn.className = this._examMode
                    ? 'text-sm px-3 py-1.5 border border-red-500 rounded-lg bg-red-600 text-white flex items-center gap-1.5'
                    : 'text-sm px-3 py-1.5 border border-red-300 rounded-lg hover:bg-red-50 transition text-red-700 flex items-center gap-1.5';
                btn.querySelector('span').textContent = this._examMode ? '시험 중' : '시험';
                this.showToast(this._examMode ? '시험 모드 시작' : '시험 모드 종료', this._examMode ? 'red' : 'green');
                SOUNDS.alert();
            } else {
                this._examMode = !this._examMode;
                this.showToast('시험 모드 전환 실패', 'red');
            }
        } catch (e) {
            this._examMode = !this._examMode;
            this.showToast('시험 모드 오류', 'red');
        }
    }
    async loadExamModeState() {
        try {
            const resp = await this.apiFetch('/api/exam-mode');
            if (!resp) return;
            const enabled = resp.data?.enabled || resp.enabled;
            this._examMode = !!enabled;
            if (this._examMode) {
                const btn = document.getElementById('exam-mode-btn');
                if (btn) {
                    btn.className = 'text-sm px-3 py-1.5 border border-red-500 rounded-lg bg-red-600 text-white flex items-center gap-1.5';
                    btn.querySelector('span').textContent = '시험 중';
                }
            }
        } catch (e) { /* ignore */ }
    }

    // ── PC search/filter ──
    initPcSearch() {
        const input = document.getElementById('pc-search');
        if (!input) return;
        this._searchQuery = '';
        input.addEventListener('input', (e) => {
            this._searchQuery = (e.target.value || '').trim().toLowerCase();
            this._applyPcFilter();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                input.value = '';
                this._searchQuery = '';
                this._applyPcFilter();
                input.blur();
            }
        });
    }

    _applyPcFilter() {
        const q = this._searchQuery || '';
        document.querySelectorAll('.pc-card').forEach(card => {
            const pcName = card.getAttribute('data-pc') || '';
            const pc = this.pcs.get(pcName);
            if (!pc) { card.style.display = ''; return; }
            if (!q) {
                card.style.display = '';
                card.style.opacity = '';
                return;
            }
            const haystack = [
                pc.pc_name,
                pc.display_name,
                pc.ip_address,
                pc.mac_address,
            ].filter(Boolean).join(' ').toLowerCase();
            const match = haystack.includes(q);
            // Dim instead of hide — user keeps spatial map of PCs
            card.style.opacity = match ? '' : '0.15';
            card.style.pointerEvents = match ? '' : 'none';
        });
    }

    // ── Drag-select box (draw rectangle on empty canvas area) ──
    initDragSelectBox() {
        const canvas = document.getElementById('pc-canvas');
        if (!canvas) return;
        let box = null;
        let startX = 0, startY = 0;

        canvas.addEventListener('mousedown', (e) => {
            // Only on empty canvas area (not on a card or control)
            if (e.target !== canvas && !e.target.classList.contains('zone-label') && e.target.id !== 'pc-grid') return;
            if (e.button !== 0) return;
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            startX = e.clientX - rect.left + canvas.scrollLeft;
            startY = e.clientY - rect.top + canvas.scrollTop;

            box = document.createElement('div');
            box.style.cssText = 'position:absolute;border:2px solid #3b82f6;background:rgba(59,130,246,0.1);pointer-events:none;z-index:999;';
            box.style.left = startX + 'px';
            box.style.top = startY + 'px';
            canvas.appendChild(box);

            const onMove = (ev) => {
                const curX = ev.clientX - rect.left + canvas.scrollLeft;
                const curY = ev.clientY - rect.top + canvas.scrollTop;
                const x = Math.min(startX, curX);
                const y = Math.min(startY, curY);
                const w = Math.abs(curX - startX);
                const h = Math.abs(curY - startY);
                box.style.left = x + 'px';
                box.style.top = y + 'px';
                box.style.width = w + 'px';
                box.style.height = h + 'px';
            };

            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (!box) return;
                const bx = parseFloat(box.style.left);
                const by = parseFloat(box.style.top);
                const bw = parseFloat(box.style.width) || 0;
                const bh = parseFloat(box.style.height) || 0;
                box.remove();
                box = null;
                // Ignore tiny drags (accidental click)
                if (bw < 20 || bh < 20) return;

                // Find cards whose center falls inside the box
                if (!e.ctrlKey && !e.metaKey && !e.shiftKey) this._selectedPcs.clear();
                document.querySelectorAll('.pc-card').forEach(card => {
                    const cx = card.offsetLeft + card.offsetWidth / 2;
                    const cy = card.offsetTop + card.offsetHeight / 2;
                    if (cx >= bx && cx <= bx + bw && cy >= by && cy <= by + bh) {
                        const pcName = card.getAttribute('data-pc');
                        if (pcName) this._selectedPcs.add(pcName);
                    }
                });
                this.refreshSelectionUI();
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // ── Multi-select PC cards (Ctrl/Shift+click) ──
    initSelectionBar() {
        this._selectedPcs = new Set();
        const bar = document.getElementById('selection-bar');
        if (!bar) return;

        bar.querySelectorAll('[data-sel-cmd]').forEach(btn => {
            btn.onclick = () => this.runSelectedCommand(btn.dataset.selCmd);
        });
        const clearBtn = document.getElementById('selection-clear');
        if (clearBtn) clearBtn.onclick = () => this.clearSelection();
    }

    togglePcSelection(pcName) {
        if (this._selectedPcs.has(pcName)) this._selectedPcs.delete(pcName);
        else this._selectedPcs.add(pcName);
        this.refreshSelectionUI();
    }

    clearSelection() {
        this._selectedPcs.clear();
        this.refreshSelectionUI();
    }

    refreshSelectionUI() {
        const bar = document.getElementById('selection-bar');
        const count = document.getElementById('selection-count');
        if (!bar || !count) return;
        const n = this._selectedPcs.size;
        count.textContent = n;
        bar.classList.toggle('hidden', n === 0);

        document.querySelectorAll('.pc-card').forEach(card => {
            const pc = card.getAttribute('data-pc');
            card.classList.toggle('selected', this._selectedPcs.has(pc));
        });
    }

    async runSelectedCommand(cmd) {
        const targets = Array.from(this._selectedPcs)
            .map(name => this.pcs.get(name))
            .filter(p => p && p.status === 'online');
        if (targets.length === 0) {
            this.showToast('선택된 온라인 PC 없음', 'red');
            return;
        }

        let params = {};
        if (cmd === 'open-url') {
            const url = prompt(`${targets.length}대에서 열 URL:`, 'https://');
            if (!url || url === 'https://') return;
            params = { url };
        } else if (cmd === 'message') {
            const msg = prompt(`${targets.length}대에 보낼 메시지:`);
            if (!msg) return;
            params = { message: msg };
        } else if (cmd === 'restart' || cmd === 'shutdown') {
            if (!confirm(`선택된 ${targets.length}대를 ${cmd === 'shutdown' ? '종료' : '재시작'}할까요?`)) return;
        }

        await Promise.allSettled(targets.map(pc =>
            this.apiFetch('/api/pcs/' + encodeURIComponent(pc.pc_name) + '/command', {
                method: 'POST',
                body: JSON.stringify({ command: cmd, params })
            })
        ));
        this.showToast(targets.length + '대에 ' + cmd + ' 전송', 'green');
    }

    // ── Emergency Attention Mode (lock all online PCs) ──
    async toggleAttention() {
        const btn = document.getElementById('attention-btn');
        const label = document.getElementById('attention-label');
        if (!btn) return;
        const isOn = btn.getAttribute('data-attention') === 'on';
        const online = Array.from(this.pcs.values()).filter(p => p.status === 'online');
        if (online.length === 0) {
            this.showToast('온라인 PC 없음', 'gray');
            return;
        }

        if (!isOn) {
            // Lock all
            for (const pc of online) {
                this.apiFetch('/api/pcs/' + encodeURIComponent(pc.pc_name) + '/command', {
                    method: 'POST',
                    body: JSON.stringify({ command: 'lock', params: {} })
                });
            }
            btn.setAttribute('data-attention', 'on');
            btn.className = 'text-sm px-3 py-1.5 border border-red-500 bg-red-500 rounded-lg hover:bg-red-600 transition text-white flex items-center gap-1.5 font-semibold';
            if (label) label.textContent = '주목 해제 (Ctrl+L)';
            this.showToast(online.length + '대 잠금 — 학생 주목', 'green');
        } else {
            // Unlock: send a benign command that wakes without unlocking (Windows requires password)
            // Best we can do: show an info message instead. Flip state back for UX consistency.
            btn.setAttribute('data-attention', 'off');
            btn.className = 'text-sm px-3 py-1.5 border border-amber-300 rounded-lg hover:bg-amber-50 transition text-amber-700 flex items-center gap-1.5 font-semibold';
            if (label) label.textContent = '주목 (Ctrl+L)';
            this.showToast('주목 모드 해제 (학생 본인이 비밀번호 입력 필요)', 'gray');
        }
    }

    // ── Violation screenshot gallery ──
    async openGallery() {
        const modal = document.getElementById('gallery-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        document.getElementById('gallery-close').onclick = () => {
            modal.classList.add('hidden');
            this._revokeGalleryUrls();
        };
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
                this._revokeGalleryUrls();
            }
        };
        const filter = document.getElementById('gallery-filter');
        filter.onchange = () => this._loadGallery(filter.value);
        await this._loadGallery(filter.value);
    }

    _revokeGalleryUrls() {
        (this._galleryBlobUrls || []).forEach(u => URL.revokeObjectURL(u));
        this._galleryBlobUrls = [];
    }

    async _loadGallery(reason) {
        const grid = document.getElementById('gallery-grid');
        if (!grid) return;
        this._revokeGalleryUrls();
        grid.replaceChildren();
        grid.innerHTML = '<p class="col-span-full text-center text-gray-300 py-8">로딩 중...</p>';

        const qs = reason ? '?reason=' + encodeURIComponent(reason) + '&limit=60' : '?limit=60';
        const res = await this.apiFetch('/api/screenshots' + qs);
        const list = Array.isArray(res) ? res : (res && res.data) || [];

        grid.replaceChildren();
        if (list.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'col-span-full text-center text-gray-300 py-16';
            empty.textContent = '스크린샷 없음';
            grid.appendChild(empty);
            return;
        }

        // Fetch thumbnails in parallel (blob URLs)
        this._galleryBlobUrls = [];
        for (const shot of list) {
            const cell = document.createElement('div');
            cell.className = 'bg-gray-100 rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-400 transition';

            const imgWrap = document.createElement('div');
            imgWrap.className = 'aspect-video bg-gray-200 flex items-center justify-center text-gray-400 text-xs';
            imgWrap.textContent = '로딩...';

            const meta = document.createElement('div');
            meta.className = 'px-2 py-1 text-[10px]';
            const reasonColor = shot.reason === 'block-violation' ? 'text-red-600' : 'text-gray-500';
            const timeStr = new Date(shot.captured_at + 'Z').toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
            meta.innerHTML = `<p class="font-semibold text-gray-700 truncate">${this._esc(shot.pc_name)}</p>
                              <p class="${reasonColor} truncate">${this._esc(shot.program || shot.reason || '')}</p>
                              <p class="text-gray-400">${timeStr}</p>`;

            cell.appendChild(imgWrap);
            cell.appendChild(meta);
            grid.appendChild(cell);

            // Lazy-load the image
            this._loadGalleryThumb(shot.id, imgWrap, cell);
        }
    }

    async _loadGalleryThumb(id, wrap, cell) {
        try {
            const res = await fetch('/api/screenshots/image/' + id, {
                headers: this.token ? { Authorization: 'Bearer ' + this.token } : {}
            });
            if (!res.ok) { wrap.textContent = '로드 실패'; return; }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            this._galleryBlobUrls.push(url);
            const img = document.createElement('img');
            img.src = url;
            img.className = 'w-full h-full object-cover';
            img.alt = '';
            wrap.replaceChildren(img);
            cell.onclick = () => this._openGalleryPreview(url);
        } catch (e) {
            wrap.textContent = '에러';
        }
    }

    _openGalleryPreview(url) {
        const preview = document.getElementById('gallery-preview');
        const img = document.getElementById('gallery-preview-img');
        if (!preview || !img) return;
        img.src = url;
        preview.classList.remove('hidden');
        preview.onclick = () => preview.classList.add('hidden');
    }

    _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // "2025-04-08 14:30:00" → "3분 전" / "5시간 전" / "2일 전" / raw date if old
    _relativeTime(ts) {
        if (!ts) return '-';
        // Parse as UTC (SQLite datetime('now') returns UTC without Z)
        const date = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
        if (isNaN(date.getTime())) return ts;
        const diffMs = Date.now() - date.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 1) return '방금';
        if (diffMin < 60) return diffMin + '분 전';
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return diffHr + '시간 전';
        const diffDay = Math.floor(diffHr / 24);
        if (diffDay < 7) return diffDay + '일 전';
        return date.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
    }

    // ── Integrations (Telegram / Anthropic) ──
    async openIntegrations() {
        const modal = document.getElementById('integrations-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        document.getElementById('integrations-close').onclick = () => modal.classList.add('hidden');
        modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };

        const res = await this.apiFetch('/api/integrations');
        const data = (res && (res.data || res)) || {};
        const tg = data.telegram || {};
        const ai = data.anthropic || {};

        const tgStatus = document.getElementById('tg-status');
        const aiStatus = document.getElementById('ai-status');
        tgStatus.textContent = tg.configured ? '연결됨' : '미설정';
        tgStatus.className = 'text-xs px-2 py-0.5 rounded ' + (tg.configured ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500');
        aiStatus.textContent = ai.configured ? '연결됨' : '미설정';
        aiStatus.className = 'text-xs px-2 py-0.5 rounded ' + (ai.configured ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500');

        document.getElementById('tg-token').placeholder = tg.botTokenMasked || 'Bot Token';
        document.getElementById('tg-chat').placeholder = tg.chatIdMasked || 'Chat ID';
        document.getElementById('ai-key').placeholder = ai.keyMasked || 'sk-ant-api03-...';

        document.getElementById('tg-save').onclick = async () => {
            const token = document.getElementById('tg-token').value.trim();
            const chat = document.getElementById('tg-chat').value.trim();
            if (!token && !chat) { this.showToast('값 입력 필요', 'red'); return; }
            const body = {};
            if (token) body.telegramBotToken = token;
            if (chat) body.telegramChatId = chat;
            const r = await this.apiFetch('/api/integrations', { method: 'POST', body: JSON.stringify(body) });
            if (r && (r.updated || (r.data && r.data.updated))) {
                this.showToast('저장됨', 'green');
                document.getElementById('tg-token').value = '';
                document.getElementById('tg-chat').value = '';
                this.openIntegrations();
            } else {
                this.showToast('저장 실패', 'red');
            }
        };
        document.getElementById('tg-test').onclick = async () => {
            const r = await this.apiFetch('/api/telegram/test', { method: 'POST', body: '{}' });
            if (r && (r.sent || (r.data && r.data.sent))) this.showToast('텔레그램 테스트 메시지 전송됨', 'green');
            else this.showToast('전송 실패: ' + (r && r.error || '미설정'), 'red');
        };
        document.getElementById('ai-save').onclick = async () => {
            const key = document.getElementById('ai-key').value.trim();
            if (!key) { this.showToast('API 키 입력 필요', 'red'); return; }
            const r = await this.apiFetch('/api/integrations', {
                method: 'POST', body: JSON.stringify({ anthropicApiKey: key })
            });
            if (r && (r.updated || (r.data && r.data.updated))) {
                this.showToast('Claude API 키 저장됨', 'green');
                document.getElementById('ai-key').value = '';
                this.openIntegrations();
            } else {
                this.showToast('저장 실패', 'red');
            }
        };
    }

    // ── Activity report ──
    async openReport() {
        const days = prompt('보고서 기간 (일):', '7');
        if (!days) return;
        const n = Math.max(1, Math.min(30, parseInt(days) || 7));
        try {
            // Fetch with auth header → blob URL (window.open can't set headers)
            const res = await fetch('/api/report.html?days=' + n, {
                headers: this.token ? { Authorization: 'Bearer ' + this.token } : {}
            });
            if (!res.ok) {
                this.showToast('보고서 로드 실패: ' + res.status, 'red');
                return;
            }
            const html = await res.text();
            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const win = window.open(url, '_blank', 'noopener');
            // Revoke after short delay so the new window has time to load
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
            if (!win) this.showToast('팝업이 차단됨 — 팝업 허용 후 다시 시도', 'red');
        } catch (e) {
            this.showToast('보고서 오류: ' + e.message, 'red');
        }
    }

    // ── Schedule rules (time-based auto block) ──
    async openScheduleModal() {
        const modal = document.getElementById('schedule-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        document.getElementById('schedule-close').onclick = () => modal.classList.add('hidden');
        modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };

        const list = document.getElementById('schedule-list');
        const rules = await this.apiFetch('/api/schedule-rules');
        list.replaceChildren();
        if (!rules || rules.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'text-gray-300 text-center py-8';
            empty.textContent = '등록된 규칙 없음';
            list.appendChild(empty);
        } else {
            const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
            rules.forEach(rule => {
                const row = document.createElement('div');
                row.className = 'flex items-center justify-between p-3 border rounded-lg ' + (rule.enabled ? 'bg-white' : 'bg-gray-50 opacity-60');
                const days = [];
                for (let i = 0; i < 7; i++) if ((rule.weekdays & (1 << i)) !== 0) days.push(dayLabels[i]);
                const left = document.createElement('div');
                left.className = 'flex-1';
                const title = document.createElement('p');
                title.className = 'font-semibold text-sm text-gray-800';
                title.textContent = rule.name;
                const meta = document.createElement('p');
                meta.className = 'text-xs text-gray-400';
                const actionLabel = rule.action === 'block-program' ? '차단' : '해제';
                meta.textContent = `${rule.start_time}~${rule.end_time} | ${days.join(',')} | ${actionLabel}: ${rule.target}`;
                left.appendChild(title);
                left.appendChild(meta);

                const right = document.createElement('div');
                right.className = 'flex items-center gap-2';
                const toggleBtn = document.createElement('button');
                toggleBtn.className = 'text-xs px-2 py-1 rounded ' + (rule.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500');
                toggleBtn.textContent = rule.enabled ? 'ON' : 'OFF';
                toggleBtn.onclick = async () => {
                    await this.apiFetch('/api/schedule-rules/' + rule.id + '/toggle', { method: 'PATCH' });
                    this.openScheduleModal(); // refresh
                };
                const delBtn = document.createElement('button');
                delBtn.className = 'text-xs text-red-400 hover:text-red-600';
                delBtn.innerHTML = svgIcon('trash');
                delBtn.onclick = async () => {
                    if (!confirm(`"${rule.name}" 삭제?`)) return;
                    await this.apiFetch('/api/schedule-rules/' + rule.id, { method: 'DELETE' });
                    this.openScheduleModal();
                };
                right.appendChild(toggleBtn);
                right.appendChild(delBtn);
                row.appendChild(left);
                row.appendChild(right);
                list.appendChild(row);
            });
        }

        // Template download
        const tmplBtn = document.getElementById('sched-template');
        if (tmplBtn) {
            tmplBtn.onclick = (e) => {
                e.preventDefault();
                const sample = {
                    rules: [
                        { name: '오전 수업 게임 차단', startTime: '09:00', endTime: '10:00', weekdays: 62, action: 'block-program', target: 'LeagueClient.exe' },
                        { name: '오전 수업 유튜브 차단', startTime: '09:00', endTime: '10:00', weekdays: 62, action: 'block-program', target: 'Steam.exe' },
                        { name: '점심시간 허용', startTime: '12:00', endTime: '13:00', weekdays: 62, action: 'unblock-program', target: 'LeagueClient.exe' },
                    ],
                    _comments: {
                        weekdays: 'Sun=1, Mon=2, Tue=4, Wed=8, Thu=16, Fri=32, Sat=64. Sum to combine. Mon-Fri = 62',
                        action: '"block-program" or "unblock-program"',
                        time: 'HH:MM 24-hour format',
                    },
                };
                const blob = new Blob([JSON.stringify(sample, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'schedule-rules-template.json';
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 5000);
            };
        }

        // Import from JSON file
        const importBtn = document.getElementById('sched-import');
        const importFile = document.getElementById('sched-import-file');
        if (importBtn && importFile) {
            importBtn.onclick = () => importFile.click();
            importFile.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                try {
                    const text = await file.text();
                    const json = JSON.parse(text);
                    if (!json.rules || !Array.isArray(json.rules)) {
                        this.showToast('유효하지 않은 JSON: rules 배열 필요', 'red');
                        return;
                    }
                    const replace = document.getElementById('sched-import-replace').checked;
                    if (replace && !confirm('기존 규칙을 전부 삭제하고 import할까요?')) return;
                    const res = await this.apiFetch('/api/schedule-rules/import', {
                        method: 'POST',
                        body: JSON.stringify({ rules: json.rules, replace })
                    });
                    const d = (res && (res.data || res)) || {};
                    if (d.imported != null) {
                        this.showToast(`${d.imported}개 import 완료 (에러 ${(d.errors || []).length}개)`, d.imported > 0 ? 'green' : 'red');
                        this.openScheduleModal();
                    } else {
                        this.showToast('Import 실패: ' + (res && res.error || '알 수 없음'), 'red');
                    }
                } catch (err) {
                    this.showToast('파일 읽기 실패: ' + err.message, 'red');
                }
                importFile.value = '';
            };
        }

        document.getElementById('sched-add').onclick = async () => {
            const name = document.getElementById('sched-name').value.trim();
            const startTime = document.getElementById('sched-start').value;
            const endTime = document.getElementById('sched-end').value;
            const action = document.getElementById('sched-action').value;
            const target = document.getElementById('sched-target').value.trim();
            if (!name || !target) {
                this.showToast('이름과 대상을 입력하세요', 'red');
                return;
            }
            let weekdays = 0;
            document.querySelectorAll('.sched-day:checked').forEach(cb => {
                weekdays |= parseInt(cb.dataset.day);
            });
            if (weekdays === 0) {
                this.showToast('최소 한 요일은 선택', 'red');
                return;
            }
            const res = await this.apiFetch('/api/schedule-rules', {
                method: 'POST',
                body: JSON.stringify({ name, startTime, endTime, weekdays, action, target })
            });
            if (res && (res.id || (res.data && res.data.id))) {
                this.showToast('규칙 추가됨', 'green');
                document.getElementById('sched-name').value = '';
                document.getElementById('sched-target').value = '';
                this.openScheduleModal(); // refresh
            } else {
                this.showToast('추가 실패: ' + (res && res.error || '알 수 없음'), 'red');
            }
        };
    }

    // ── Broadcast message to all online PCs (uses message modal) ──
    broadcastMessage() {
        const online = Array.from(this.pcs.values()).filter(p => p.status === 'online');
        if (online.length === 0) {
            this.showToast('온라인 PC 없음', 'gray');
            return;
        }
        // Reuse message modal with __all__ target
        this.openMessageModal('__all__', `전체 방송 (${online.length}대)`);
    }

    // ── Keyboard shortcuts ──
    initKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            const tag = (e.target.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;

            // Slash: focus PC search (no modifier)
            if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                const searchInput = document.getElementById('pc-search');
                if (searchInput) {
                    e.preventDefault();
                    searchInput.focus();
                    searchInput.select();
                    return;
                }
            }

            // Shortcut help: ? (no modifier required)
            if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                const modal = document.getElementById('shortcut-modal');
                if (modal) {
                    modal.classList.remove('hidden');
                    document.getElementById('shortcut-close').onclick = () => modal.classList.add('hidden');
                    modal.onclick = (ev) => { if (ev.target === modal) modal.classList.add('hidden'); };
                }
                return;
            }

            if (!e.ctrlKey && !e.metaKey) return;
            const key = e.key.toLowerCase();
            if (key === 'l') {
                e.preventDefault();
                this.toggleAttention();
            } else if (key === 'm') {
                e.preventDefault();
                this.broadcastMessage();
            } else if (key === 'f') {
                // Ctrl+F also focuses search (overrides browser find)
                const searchInput = document.getElementById('pc-search');
                if (searchInput) {
                    e.preventDefault();
                    searchInput.focus();
                    searchInput.select();
                }
            }
        });
    }

    async checkLicense() {
        const res = await this.apiFetch('/api/license-info');
        const data = res && (res.data || res);
        if (!data || !data.expiry) return;
        const daysLeft = Math.ceil((new Date(data.expiry) - Date.now()) / 86400000);

        // Persistent banner for expiry warning (not just toast)
        const banner = document.getElementById('license-banner');
        const bannerText = document.getElementById('license-banner-text');
        const closeBtn = document.getElementById('license-banner-close');
        const dismissedKey = 'license-banner-dismissed-' + data.expiry;
        if (banner && bannerText && !sessionStorage.getItem(dismissedKey)) {
            if (daysLeft <= 0) {
                banner.className = 'bg-red-50 border-b border-red-200 px-4 py-2 text-sm text-red-800 flex items-center justify-between';
                bannerText.textContent = `라이선스 만료됨 (${data.expiry}) — 즉시 갱신 필요`;
                banner.classList.remove('hidden');
            } else if (daysLeft <= 30) {
                bannerText.textContent = `라이선스 만료 ${daysLeft}일 전 (${data.expiry}) — ${data.academy || '학원'}`;
                banner.classList.remove('hidden');
            }
            if (closeBtn) {
                closeBtn.onclick = () => {
                    banner.classList.add('hidden');
                    sessionStorage.setItem(dismissedKey, '1');
                };
            }
        }

        if (daysLeft <= 30 && daysLeft > 0) {
            this.showToast('라이선스 ' + daysLeft + '일 남음 (' + data.expiry + ')', 'red');
        } else if (daysLeft <= 0) {
            this.showToast('라이선스 만료됨! 갱신이 필요합니다.', 'red');
        }
    }

    // loadGroups removed — groups feature deprecated
    async loadGroups() { /* removed */ }

    async apiFetch(url, options = {}) {
        const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
        if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
        let res;
        try {
            res = await fetch(url, { ...options, headers });
        } catch (netErr) {
            // Network failure (server down, offline, DNS) — surface once per minute
            if (!this._netErrorShown || Date.now() - this._netErrorShown > 60_000) {
                this._netErrorShown = Date.now();
                this.showToast('네트워크 오류 — 서버 연결 확인', 'red');
            }
            return null;
        }
        // Token expired/invalid → wipe and force re-login
        if (res.status === 401 && this.token) {
            this.token = null;
            localStorage.removeItem('token');
            this.showToast('로그인 세션 만료 — 다시 로그인하세요', 'red');
            setTimeout(() => location.reload(), 1500);
            return null;
        }
        if (!res.ok) return null;
        // Parse JSON, tolerate empty body
        const text = await res.text();
        if (!text) return null;
        try { return JSON.parse(text); }
        catch (e) { return null; }
    }

    async loadPCs() {
        const data = await this.apiFetch('/api/pcs');
        if (!data) return;

        const list = Array.isArray(data) ? data : (data.data || []);
        list.forEach(pc => this.pcs.set(pc.pc_name, pc));
        this.render();
    }

    async loadPCsIncremental() {
        const data = await this.apiFetch('/api/pcs');
        if (!data) return;

        const list = Array.isArray(data) ? data : (data.data || []);
        const newNames = new Set(list.map(pc => pc.pc_name));
        const grid = document.getElementById('pc-grid');

        // Update existing + add new
        list.forEach(pc => {
            const old = this.pcs.get(pc.pc_name);
            this.pcs.set(pc.pc_name, { ...old, ...pc });
            const existing = grid.querySelector(`[data-pc="${CSS.escape(pc.pc_name)}"]`);
            if (existing) {
                this.updateCard(pc.pc_name);
            } else {
                this.updateCard(pc.pc_name); // will create new card
            }
        });

        // Remove deleted PCs
        this.pcs.forEach((_, name) => {
            if (!newNames.has(name)) {
                this.pcs.delete(name);
                const card = grid.querySelector(`[data-pc="${CSS.escape(name)}"]`);
                if (card) card.remove();
            }
        });

        this.updateStats();
    }

    // ── Socket.IO ────────────────────────────
    connectSocket() {
        this.socket = io({ auth: { token: this.token }, transports: ['websocket'] });
        this._activityLog = [];
        this._unreadActivity = 0;

        this.socket.on('connect', () => {
            document.getElementById('header-status').textContent = '연결됨';
            document.getElementById('header-status').className = 'text-sm text-green-500';
            // Auto-rejoin stream room if we were viewing a PC live
            if (this.livePC) {
                const qualSel = document.getElementById('live-quality');
                const codecSel = document.getElementById('live-codec');
                const [fps, quality] = (qualSel?.value || '15-80').split('-').map(Number);
                const mode = codecSel?.value === 'h264' ? 'h264' : undefined;
                this.socket.emit('start-stream-request', { pcName: this.livePC, fps, quality, mode });
            }
            // Auto-rejoin CCTV room if active
            if (this._cctvActive) {
                this.socket.emit('start-cctv-request', { fps: 3, quality: 30 });
            }
        });

        this.socket.on('disconnect', () => {
            document.getElementById('header-status').textContent = '연결 끊김';
            document.getElementById('header-status').className = 'text-sm text-gray-500';
        });

        // Server-pushed stream stall notification (informational — agent already gets nudged)
        this.socket.on('stream-stall', (data) => {
            if (this.livePC === data.pcName) {
                const loadingEl = document.getElementById('live-loading');
                if (loadingEl) {
                    loadingEl.innerHTML = svgIcon('refresh', 16) + ' <span class="ml-1">서버가 에이전트 재시작 요청 중...</span>';
                    loadingEl.classList.remove('hidden');
                }
            }
        });

        // Live telemetry from agent (every 5s): update HUD with real fps/drops/kbps
        this.socket.on('stream-stats', (data) => {
            if (this.livePC === data.pcName) {
                const sizeEl = document.getElementById('live-size');
                if (sizeEl) {
                    const drops = data.drops > 0 ? ` · drops ${data.drops}` : '';
                    sizeEl.textContent = `${data.kbps}kbps @ ${data.fps}fps${drops}`;
                }
            }
        });

        // ── Live activity feed ──
        this.socket.on('new-activity', (entry) => {
            this.pushActivity(entry);
            // Sound for escalation/lock activities
            if (entry.type === 'auto-lock' || entry.type === 'escalation') SOUNDS.alert();
        });
        this.initActivityFeed();
        this.startHealthPoll();

        // Throttle pc-updated to max 2 updates/sec per PC (reduce DOM thrashing)
        this._updateTimers = this._updateTimers || {};
        this.socket.on('pc-updated', (data) => {
            const existing = this.pcs.get(data.pcName) || {};
            this.pcs.set(data.pcName, { ...existing, ...data, pc_name: data.pcName });
            // Status changes (online/offline) update immediately
            if (data.status && data.status !== existing.status) {
                if (data.status === 'online' && existing.status === 'offline') SOUNDS.connect();
                if (data.status === 'offline' && existing.status === 'online') SOUNDS.disconnect();
                this.updateCard(data.pcName);
                return;
            }
            // CPU/mem updates throttled
            if (this._updateTimers[data.pcName]) return;
            this._updateTimers[data.pcName] = setTimeout(() => {
                delete this._updateTimers[data.pcName];
                this.updateCard(data.pcName);
            }, 300);
        });

        this.socket.on('pcs-status-changed', () => this.loadPCsIncremental());

        this.socket.on('pc-deleted', (data) => {
            if (data && data.pcName) {
                this.pcs.delete(data.pcName);
                const card = document.querySelector(`[data-pc="${CSS.escape(data.pcName)}"]`);
                if (card) card.remove();
                this.updateStats();
            }
        });

        // Block violation alerts
        this.socket.on('block-violation', (data) => {
            const pcName = data.pcName || 'Unknown';
            const prog = data.program || '';
            const pc = this.pcs.get(pcName);
            const label = pc?.display_name || pcName;
            this.showToast(label + ' 차단 프로그램 실행: ' + prog, 'red');
            SOUNDS.violation();
        });

        // Live stream frames — H.264 (MSE) or MJPEG (legacy)
        this.socket.on('screen-frame', (data) => {
            const pcName = data.p || data.pcName;
            if (!this.livePC || pcName !== this.livePC) return;
            const frameData = data.f || data.frame;
            if (data.h264) {
                this.handleH264Frame(frameData, data.init);
            } else {
                this.drawFrame(frameData);
            }
        });
    }

    updateCard(pcName) {
        const pc = this.pcs.get(pcName);
        if (!pc) return;
        const grid = document.getElementById('pc-grid');
        const existing = grid.querySelector(`[data-pc="${CSS.escape(pcName)}"]`);

        if (existing) {
            // In-place update — no DOM replacement, no flicker
            const cpu = Math.round(pc.cpuUsage || pc.cpu_usage || 0);
            const mem = Math.round(pc.memoryUsage || pc.memory_usage || 0);
            const isOnline = pc.status === 'online';

            // Update status dot
            const dot = existing.querySelector('.status-dot');
            if (dot) dot.className = 'status-dot ' + (isOnline ? 'status-online' : 'status-offline');

            // Update badge
            const badge = existing.querySelector('.rounded-full');
            if (badge) {
                badge.textContent = isOnline ? '접속' : '오프라인';
                badge.className = 'text-xs px-2 py-1 rounded-full ' +
                    (isOnline ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400');
            }

            // Update bars (find by label text)
            const bars = existing.querySelectorAll('.bar-fill');
            if (bars.length >= 1) {
                const cpuColor = cpu > 80 ? '#ef4444' : cpu > 50 ? '#f59e0b' : '#3b82f6';
                bars[0].style.width = cpu + '%';
                bars[0].style.background = cpuColor;
                const cpuLabel = bars[0].closest('.mb-2');
                if (cpuLabel) {
                    const valSpan = cpuLabel.querySelector('.justify-between span:last-child');
                    if (valSpan) { valSpan.textContent = cpu + '%'; valSpan.style.color = cpuColor; }
                }
            }
            if (bars.length >= 2) {
                const memColor = mem > 80 ? '#ef4444' : mem > 50 ? '#f59e0b' : '#22c55e';
                bars[1].style.width = mem + '%';
                bars[1].style.background = memColor;
                const memLabel = bars[1].closest('.mb-2');
                if (memLabel) {
                    const valSpan = memLabel.querySelector('.justify-between span:last-child');
                    if (valSpan) { valSpan.textContent = mem + '%'; valSpan.style.color = memColor; }
                }
            }

            // Update latency indicator
            let latEl = existing.querySelector('.latency-indicator');
            if (pc.latencyMs != null && isOnline) {
                const ms = Math.round(pc.latencyMs);
                const color = ms < 50 ? 'text-green-500' : ms < 150 ? 'text-yellow-500' : 'text-red-500';
                if (!latEl) {
                    latEl = document.createElement('div');
                    latEl.className = 'latency-indicator text-[10px] text-right mt-1';
                    const barArea = existing.querySelector('.mb-2')?.parentElement;
                    if (barArea) barArea.appendChild(latEl);
                }
                latEl.className = 'latency-indicator text-[10px] text-right mt-1 ' + color;
                latEl.textContent = ms + 'ms';
            } else if (latEl) {
                latEl.textContent = '';
            }

            // Update active window display
            let awEl = existing.querySelector('.active-window');
            if (pc.activeWindow && isOnline) {
                const title = pc.activeWindow.title || '';
                const proc = pc.activeWindow.process || '';
                const display = title.length > 30 ? title.slice(0, 30) + '…' : title;
                if (!awEl) {
                    awEl = document.createElement('div');
                    awEl.className = 'active-window text-[10px] text-gray-400 truncate mt-1';
                    awEl.title = '';
                    const barArea = existing.querySelector('.mb-2')?.parentElement;
                    if (barArea) barArea.appendChild(awEl);
                }
                awEl.textContent = proc ? `${proc}: ${display}` : display;
                awEl.title = title;
            } else if (awEl) {
                awEl.textContent = '';
            }

            // Update border color
            existing.className = existing.className.replace(/border-\w+-200/g, '') +
                (isOnline ? ' border-green-200' : ' border-gray-200');
        } else {
            const newCard = this.createCard(pc);
            newCard.style.position = 'absolute';
            newCard.style.width = '260px';
            // Place new cards at a default spot
            if (pc.pos_x != null && pc.pos_y != null) {
                newCard.style.left = pc.pos_x + 'px';
                newCard.style.top = pc.pos_y + 'px';
            } else {
                const existing2 = grid.querySelectorAll('.pc-card');
                newCard.style.left = '16px';
                newCard.style.top = (40 + existing2.length * 196) + 'px';
            }
            this.enableFreeDrag(newCard, pc);
            grid.appendChild(newCard);
            document.getElementById('empty-state').classList.add('hidden');
            const canvas = document.getElementById('pc-canvas');
            if (canvas) canvas.classList.remove('hidden');
        }
        this.updateStats();
    }

    updateStats() {
        const pcs = Array.from(this.pcs.values());
        const online = pcs.filter(p => p.status === 'online');
        document.getElementById('stat-total').textContent = pcs.length + '대';
        document.getElementById('stat-online').textContent = online.length;
        document.getElementById('stat-offline').textContent = (pcs.length - online.length) + ' 오프라인';
        // Re-apply filter after any PC list update
        if (this._searchQuery) this._applyPcFilter();
    }

    // ── Render (free-form layout) ──
    render() {
        const grid = document.getElementById('pc-grid');
        const canvas = document.getElementById('pc-canvas');
        const empty = document.getElementById('empty-state');
        const pcs = Array.from(this.pcs.values());

        // Stats
        const online = pcs.filter(p => p.status === 'online');
        const offline = pcs.filter(p => p.status !== 'online');
        document.getElementById('stat-total').textContent = pcs.length + '대';
        document.getElementById('stat-online').textContent = online.length;
        document.getElementById('stat-offline').textContent = offline.length;

        if (pcs.length === 0) {
            canvas.classList.add('hidden');
            empty.classList.remove('hidden');
            return;
        }

        canvas.classList.remove('hidden');
        empty.classList.add('hidden');

        // Build cards with free-form positions
        grid.replaceChildren();
        const cardW = 260, cardH = 180, padding = 16;
        const canvasW = canvas.offsetWidth || 1200;
        const halfW = canvasW / 2;
        let autoIdx = { left: 0, right: 0 };

        pcs.forEach(pc => {
            const card = this.createCard(pc);
            card.style.position = 'absolute';
            card.style.width = cardW + 'px';

            // Use saved position or auto-layout
            if (pc.pos_x != null && pc.pos_y != null) {
                card.style.left = pc.pos_x + 'px';
                card.style.top = pc.pos_y + 'px';
            } else {
                // Auto-layout: online=left(red), offline=right(blue)
                const isOnline = pc.status === 'online';
                const cols = Math.max(1, Math.floor(halfW / (cardW + padding)));
                const idx = isOnline ? autoIdx.left++ : autoIdx.right++;
                const col = idx % cols;
                const row = Math.floor(idx / cols);
                const baseX = isOnline ? padding : halfW + padding;
                card.style.left = (baseX + col * (cardW + padding)) + 'px';
                card.style.top = (40 + row * (cardH + padding)) + 'px';
            }

            // Free drag
            this.enableFreeDrag(card, pc);
            grid.appendChild(card);
        });

        // Expand canvas to fit all cards
        this.expandCanvas();
    }

    expandCanvas() {
        const canvas = document.getElementById('pc-canvas');
        const cards = canvas.querySelectorAll('.pc-card');
        let maxX = 1200, maxY = 900;
        cards.forEach(c => {
            const r = c.offsetLeft + c.offsetWidth + 20;
            const b = c.offsetTop + c.offsetHeight + 20;
            if (r > maxX) maxX = r;
            if (b > maxY) maxY = b;
        });
        canvas.style.minWidth = maxX + 'px';
        canvas.style.minHeight = maxY + 'px';
    }

    enableFreeDrag(card, pc) {
        let startX, startY, origX, origY, dragging = false;

        const onMouseDown = (e) => {
            // Ignore if clicking buttons/inputs inside card
            if (e.target.closest('button, input, select, a')) return;
            e.preventDefault();
            dragging = false;
            startX = e.clientX;
            startY = e.clientY;
            const mainEl = card.closest('main');
            origX = card.offsetLeft;
            origY = card.offsetTop;
            card.classList.add('dragging');
            card.style.zIndex = '50';

            // Snap-to-grid: cards align to 20px grid unless Shift held
            // Card dimensions roughly 240×180, so 260×200 grid is clean 1-card spacing
            const GRID = 20;
            const snap = (n) => Math.round(n / GRID) * GRID;

            const onMouseMove = (e2) => {
                const dx = e2.clientX - startX;
                const dy = e2.clientY - startY;
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragging = true;
                const rawX = Math.max(0, origX + dx);
                const rawY = Math.max(0, origY + dy);
                // Shift = free positioning (escape hatch for pixel-perfect placement)
                const useSnap = !e2.shiftKey;
                card.style.left = (useSnap ? snap(rawX) : rawX) + 'px';
                card.style.top = (useSnap ? snap(rawY) : rawY) + 'px';
            };

            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                card.classList.remove('dragging');
                card.style.zIndex = '';

                if (dragging) {
                    // Save snapped position
                    const x = Math.round(parseFloat(card.style.left));
                    const y = Math.round(parseFloat(card.style.top));
                    const pcKey = pc.pc_name || pc.pcName;
                    pc.pos_x = x;
                    pc.pos_y = y;
                    this.apiFetch('/api/pcs/' + encodeURIComponent(pcKey) + '/position', {
                        method: 'PATCH',
                        body: JSON.stringify({ x, y })
                    });
                    this.expandCanvas();
                }
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        card.addEventListener('mousedown', onMouseDown);

        // Click behavior:
        //   Ctrl/Cmd/Shift + click → toggle selection
        //   Plain click → open live view (online) or nothing (offline)
        const pcKey = pc.pc_name || pc.pcName;
        const isOnline = pc.status === 'online';
        const displayName = pc.display_name || pc.displayName || pc.pcName || pc.pc_name;
        card.addEventListener('click', (e) => {
            if (dragging) return;
            if (e.target.closest('button, input, select, a')) return;
            if (e.ctrlKey || e.metaKey || e.shiftKey) {
                e.preventDefault();
                this.togglePcSelection(pcKey);
                return;
            }
            // If selection already active, plain click also toggles
            if (this._selectedPcs && this._selectedPcs.size > 0) {
                this.togglePcSelection(pcKey);
                return;
            }
            if (isOnline) this.openLiveView(pcKey, displayName);
        });
    }

    createCard(pc) {
        const isOnline = pc.status === 'online';
        const cpu = Math.round(pc.cpuUsage || pc.cpu_usage || 0);
        const mem = Math.round(pc.memoryUsage || pc.memory_usage || 0);
        const ip = pc.ipAddress || pc.ip_address || '-';
        const name = pc.pcName || pc.pc_name || 'Unknown';
        const displayName = pc.display_name || pc.displayName || null;

        const card = document.createElement('div');
        const pcKey = pc.pc_name || pc.pcName;
        card.setAttribute('data-pc', pcKey);
        card.className = 'pc-card bg-white rounded-xl p-4 border shadow-sm ' +
            (isOnline ? 'border-green-200' : 'border-gray-200');

        // File drop support
        card.ondragover = (e) => {
            if (e.dataTransfer.types.includes('Files') && isOnline) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                card.classList.add('ring-2', 'ring-blue-400');
            }
        };
        card.ondragleave = () => card.classList.remove('ring-2', 'ring-blue-400');
        card.ondrop = (e) => {
            e.preventDefault();
            card.classList.remove('ring-2', 'ring-blue-400');
            if (e.dataTransfer.types.includes('Files') && e.dataTransfer.files.length > 0 && isOnline) {
                this.sendFile(pcKey, displayName || name, e.dataTransfer.files[0]);
            }
        };

        // Header row
        const header = document.createElement('div');
        header.className = 'flex items-center justify-between mb-4';

        const left = document.createElement('div');
        left.className = 'flex items-center gap-3';

        const dot = document.createElement('div');
        dot.className = 'status-dot ' + (isOnline ? 'status-online' : 'status-offline');

        const info = document.createElement('div');
        const nameEl = document.createElement('p');
        nameEl.className = 'font-semibold text-sm text-gray-800 cursor-pointer hover:text-blue-600';
        nameEl.textContent = displayName || name;
        nameEl.title = '클릭해서 이름 변경';
        nameEl.onclick = (e) => {
            e.stopPropagation();
            this.renamePC(pc.pc_name || pc.pcName, displayName || name, nameEl);
        };
        const ipEl = document.createElement('p');
        ipEl.className = 'text-xs text-gray-400';
        ipEl.textContent = displayName ? name + ' / ' + ip : ip;
        info.appendChild(nameEl);
        info.appendChild(ipEl);

        left.appendChild(dot);
        left.appendChild(info);

        const badge = document.createElement('span');
        badge.className = 'text-xs px-2 py-1 rounded-full ' +
            (isOnline ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400');
        badge.textContent = isOnline ? '접속' : '오프라인';

        const rightGroup = document.createElement('div');
        rightGroup.className = 'flex items-center gap-2';

        // Delete button (all PCs — removes from dashboard)
        const delBtn = document.createElement('button');
        delBtn.className = 'text-gray-300 hover:text-red-500 p-1';
        delBtn.title = '대시보드에서 제거';
        delBtn.innerHTML = svgIcon('trash');
        delBtn.onclick = async (e) => {
            e.stopPropagation();
            if (!confirm((displayName || name) + '을(를) 대시보드에서 제거할까요?')) return;
            await this.apiFetch('/api/pcs/' + encodeURIComponent(pcKey), { method: 'DELETE' });
            card.remove();
            this.pcs.delete(pcKey);
            this.updateStats();
        };
        rightGroup.appendChild(delBtn);

        // Message + Block buttons (online only)
        if (isOnline) {
            const msgBtn = document.createElement('button');
            msgBtn.className = 'text-gray-400 hover:text-blue-500 p-1';
            msgBtn.title = '메시지 보내기';
            msgBtn.innerHTML = svgIcon('mail');
            msgBtn.onclick = (e) => {
                e.stopPropagation();
                this.openMessageModal(pcKey, displayName || name);
            };
            rightGroup.appendChild(msgBtn);

            const procBtn = document.createElement('button');
            procBtn.className = 'text-gray-400 hover:text-purple-500 p-1';
            procBtn.title = '프로세스 보기';
            procBtn.innerHTML = svgIcon('list');
            procBtn.onclick = (e) => {
                e.stopPropagation();
                this.openProcessModal(pcKey, displayName || name);
            };
            rightGroup.appendChild(procBtn);

            const blockBtn = document.createElement('button');
            blockBtn.className = 'text-gray-400 hover:text-red-500 p-1';
            blockBtn.title = '프로그램 차단';
            blockBtn.innerHTML = svgIcon('ban');
            blockBtn.onclick = (e) => {
                e.stopPropagation();
                this.openBlockProgramModal(pcKey, displayName || name);
            };
            rightGroup.appendChild(blockBtn);

            const aiBtn = document.createElement('button');
            aiBtn.className = 'text-gray-400 hover:text-purple-500 p-1';
            aiBtn.title = 'AI 화면 분석 (Claude)';
            aiBtn.innerHTML = svgIcon('sparkle');
            aiBtn.onclick = async (e) => {
                e.stopPropagation();
                aiBtn.disabled = true;
                aiBtn.innerHTML = svgIcon('clock');
                this.showToast('화면 분석 중...', 'gray');
                const res = await this.apiFetch('/api/vision/check/' + encodeURIComponent(pcKey), { method: 'POST', body: '{}' });
                aiBtn.disabled = false;
                aiBtn.innerHTML = svgIcon('sparkle');
                if (!res || res.error) {
                    this.showToast('AI 분석 실패: ' + (res && res.error || '서버 오류'), 'red');
                    return;
                }
                const data = res.data || res;
                const cat = data.category || '?';
                const conf = data.confidence != null ? `${data.confidence}%` : '';
                const detail = data.detail || '';
                const color = cat === '비학습' ? 'red' : cat === '학습' ? 'green' : 'gray';
                this.showToast(`[${cat} ${conf}] ${detail}`.substring(0, 100), color);
            };
            rightGroup.appendChild(aiBtn);

            const fileBtn = document.createElement('button');
            fileBtn.className = 'text-gray-400 hover:text-green-500 p-1';
            fileBtn.title = '파일 보내기';
            fileBtn.innerHTML = svgIcon('upload');
            fileBtn.onclick = (e) => {
                e.stopPropagation();
                this.pickAndSendFile(pcKey, displayName || name);
            };
            rightGroup.appendChild(fileBtn);
        }
        rightGroup.appendChild(badge);

        header.appendChild(left);
        header.appendChild(rightGroup);
        card.appendChild(header);

        if (isOnline) {
            card.appendChild(this.createBar('CPU', cpu, cpu > 80 ? '#ef4444' : cpu > 50 ? '#f59e0b' : '#3b82f6'));
            card.appendChild(this.createBar('Memory', mem, mem > 80 ? '#ef4444' : mem > 50 ? '#f59e0b' : '#22c55e'));

            // Action buttons
            const actions = document.createElement('div');
            actions.className = 'flex gap-1 mt-3 pt-3 border-t border-gray-100';
            const svgIcons = {
                lock: 'M3,11 h18 v11 H3z M7,11 V7 a5,5 0 0 1 10,0 v4',
                url: 'M12,2 a10,10 0 1 0 0,20 a10,10 0 1 0 0,-20 M2,12 h20 M12,2 c2.5,3 4,6.5 4,10 s-1.5,7-4,10 c-2.5-3-4-6.5-4-10 s1.5-7 4-10',
                restart: 'M23,4 v6 h-6 M20.49,15 a9,9 0 1 1-2.12-9.36 L23,10',
                shutdown: 'M18.36,6.64 a9,9 0 1 1-12.73,0 M12,2 v10',
            };
            const cmds = [
                { label: 'Lock', cmd: 'lock', color: 'text-yellow-600 hover:bg-yellow-50', icon: 'lock' },
                { label: 'URL', cmd: 'open-url', color: 'text-blue-500 hover:bg-blue-50', icon: 'url' },
                { label: 'Restart', cmd: 'restart', color: 'text-orange-500 hover:bg-orange-50', icon: 'restart' },
                { label: 'Shutdown', cmd: 'shutdown', color: 'text-red-500 hover:bg-red-50', icon: 'shutdown' },
            ];
            cmds.forEach(({ label, cmd, color, icon }) => {
                const btn = document.createElement('button');
                btn.className = `flex-1 flex items-center justify-center py-1.5 rounded-lg ${color} transition`;
                btn.title = label;
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('width', '14');
                svg.setAttribute('height', '14');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('fill', 'none');
                svg.setAttribute('stroke', 'currentColor');
                svg.setAttribute('stroke-width', '2');
                svg.setAttribute('stroke-linecap', 'round');
                svg.setAttribute('stroke-linejoin', 'round');
                const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                p.setAttribute('d', svgIcons[icon]);
                svg.appendChild(p);
                btn.appendChild(svg);
                btn.onclick = (e) => {
                    e.stopPropagation();
                    this.sendCommand(pcKey, cmd, displayName || name);
                };
                actions.appendChild(btn);
            });
            card.appendChild(actions);
        } else {
            const lastSeen = document.createElement('p');
            lastSeen.className = 'text-xs text-gray-300 mt-2';
            lastSeen.textContent = '마지막 접속: ' + this._relativeTime(pc.last_seen);
            card.appendChild(lastSeen);

            // Individual power-on button (WOL) for offline PCs
            const powerRow = document.createElement('div');
            powerRow.className = 'flex gap-1 mt-3 pt-3 border-t border-gray-100';
            const powerBtn = document.createElement('button');
            powerBtn.className = 'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-green-600 hover:bg-green-50 border border-green-200 transition text-xs font-semibold';
            powerBtn.innerHTML = svgIcon('zap') + ' <span>전원 켜기</span>';
            powerBtn.title = pc.mac_address ? ('WOL: ' + pc.mac_address) : 'MAC 주소 없음 (먼저 한 번 접속 필요)';
            if (!pc.mac_address) {
                powerBtn.classList.add('opacity-50', 'cursor-not-allowed');
            }
            powerBtn.onclick = async (e) => {
                e.stopPropagation();
                if (!pc.mac_address) {
                    this.showToast('MAC 주소 없음 — 에이전트가 최소 한 번 접속해야 WOL 가능', 'red');
                    return;
                }
                powerBtn.disabled = true;
                powerBtn.innerHTML = svgIcon('clock') + ' <span>전송 중...</span>';
                const res = await this.apiFetch('/api/wol/' + encodeURIComponent(pcKey), { method: 'POST', body: '{}' });
                powerBtn.disabled = false;
                powerBtn.innerHTML = svgIcon('zap') + ' <span>전원 켜기</span>';
                if (res && (res.success || res.data)) {
                    this.showToast((displayName || name) + ' 전원 신호 전송됨', 'green');
                } else {
                    this.showToast('WOL 실패: ' + (res && res.error || '알 수 없음'), 'red');
                }
            };
            powerRow.appendChild(powerBtn);
            card.appendChild(powerRow);
        }

        return card;
    }

    createBar(label, value, color) {
        const wrap = document.createElement('div');
        wrap.className = 'mb-2';

        const labelRow = document.createElement('div');
        labelRow.className = 'flex justify-between text-xs text-gray-500 mb-1';
        const labelEl = document.createElement('span');
        labelEl.textContent = label;
        const valEl = document.createElement('span');
        valEl.textContent = value + '%';
        valEl.style.color = color;
        labelRow.appendChild(labelEl);
        labelRow.appendChild(valEl);

        const bar = document.createElement('div');
        bar.className = 'bar';
        const fill = document.createElement('div');
        fill.className = 'bar-fill';
        fill.style.width = value + '%';
        fill.style.background = color;
        bar.appendChild(fill);

        wrap.appendChild(labelRow);
        wrap.appendChild(bar);
        return wrap;
    }

    // ── Live View ─────────────────────────────
    openLiveView(pcName, label) {
        // Unified remote viewer: open dedicated fullscreen page (/remote.html).
        // The old in-dashboard modal is kept in DOM for backward compatibility
        // but no longer invoked — all PC card clicks route here.
        const w = window.open(
            '/remote.html?pc=' + encodeURIComponent(pcName),
            'jhs-remote-' + pcName,
            'noopener,width=1280,height=800'
        );
        if (w) { try { w.focus(); } catch (e) {} }
        return;

        // Legacy modal path (unreachable — retained for rollback only):
        this.livePC = pcName;
        this.frameCount = 0;
        this.lastFpsTime = Date.now();
        this.controlMode = false;

        document.getElementById('live-modal').classList.remove('hidden');
        document.getElementById('live-pc-name').textContent = label;
        document.getElementById('live-fps').textContent = '';
        const sizeEl = document.getElementById('live-size');
        if (sizeEl) sizeEl.textContent = '';
        document.getElementById('live-loading').classList.remove('hidden');

        // No-signal detection with auto-recovery:
        // 5s → warn, 8s → auto-request stream restart, 15s → give up with message
        if (this._noSignalTimer) clearInterval(this._noSignalTimer);
        this._lastFrameAt = Date.now();
        this._streamRestartAttempts = 0;
        this._noSignalTimer = setInterval(() => {
            if (!this.livePC) return;
            const elapsed = Date.now() - this._lastFrameAt;
            const loadingEl = document.getElementById('live-loading');
            if (elapsed > 15000 && this._streamRestartAttempts >= 2) {
                loadingEl.innerHTML = svgIcon('xCircle', 16) + ' <span class="ml-1">스트림 복구 실패 — 학생 PC 상태 확인</span>';
                loadingEl.classList.remove('hidden');
                document.getElementById('live-fps').textContent = '0 fps';
            } else if (elapsed > 8000 && this._streamRestartAttempts < 2) {
                // Auto-restart the stream by re-requesting
                this._streamRestartAttempts++;
                loadingEl.innerHTML = svgIcon('refresh', 16) + ' <span class="ml-1">자동 재연결 중 (' + this._streamRestartAttempts + '/2)...</span>';
                loadingEl.classList.remove('hidden');
                const qualSel = document.getElementById('live-quality');
                const [fps, quality] = qualSel.value.split('-').map(Number);
                this.socket.emit('stop-stream-request', { pcName });
                setTimeout(() => {
                    if (this.livePC === pcName) {
                        this.socket.emit('start-stream-request', { pcName, fps, quality });
                        this._lastFrameAt = Date.now();
                    }
                }, 500);
            } else if (elapsed > 5000) {
                loadingEl.innerHTML = svgIcon('alert', 16) + ' <span class="ml-1">신호 없음 (' + Math.round(elapsed/1000) + 's)</span>';
                loadingEl.classList.remove('hidden');
                document.getElementById('live-fps').textContent = '0 fps';
            }
        }, 2000);

        const controlBtn = document.getElementById('live-control');
        const controlStatus = document.getElementById('live-control-status');
        controlBtn.textContent = '원격 조작';
        controlBtn.className = 'text-xs px-3 py-1 bg-gray-100 rounded-lg hover:bg-blue-100 transition';
        controlStatus.textContent = '';

        // Quality + codec selectors — remember last choice
        const qualSel = document.getElementById('live-quality');
        const codecSel = document.getElementById('live-codec');
        const savedQual = localStorage.getItem('live-quality');
        const savedCodec = localStorage.getItem('live-codec');
        if (savedQual && [...qualSel.options].some(o => o.value === savedQual)) qualSel.value = savedQual;
        if (codecSel && savedCodec && [...codecSel.options].some(o => o.value === savedCodec)) codecSel.value = savedCodec;
        const startStream = () => {
            const [fps, quality] = qualSel.value.split('-').map(Number);
            const mode = codecSel?.value === 'h264' ? 'h264' : undefined;
            localStorage.setItem('live-quality', qualSel.value);
            if (codecSel) localStorage.setItem('live-codec', codecSel.value);
            this.socket.emit('stop-stream-request', { pcName });
            // Reset decoders to avoid stale frames during mode switch
            if (this._frameImg) { this._frameImg.src = ''; this._frameImg = null; }
            this._cleanupMSE?.();
            this._totalBytes = 0;
            this.frameCount = 0;
            setTimeout(() => {
                this.socket.emit('start-stream-request', { pcName, fps, quality, mode });
            }, 200);
        };
        qualSel.onchange = startStream;
        if (codecSel) codecSel.onchange = startStream;

        // Fullscreen
        document.getElementById('live-fullscreen').onclick = () => {
            const container = document.getElementById('live-container');
            if (document.fullscreenElement) document.exitFullscreen();
            else container.requestFullscreen().catch(() => {});
        };

        // Session recording removed per user request.

        // Screenshot save
        document.getElementById('live-screenshot').onclick = () => {
            const canvas = document.getElementById('live-canvas');
            if (!canvas.width || !canvas.height) return;
            const link = document.createElement('a');
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            link.download = (label || pcName) + '_' + ts + '.png';
            link.href = canvas.toDataURL('image/png');
            link.click();
        };

        // Start stream with current quality + codec
        const [initFps, initQuality] = qualSel.value.split('-').map(Number);
        const initMode = codecSel?.value === 'h264' ? 'h264' : undefined;
        this.socket.emit('start-stream-request', { pcName, fps: initFps, quality: initQuality, mode: initMode });

        // Adaptive bitrate reporter: every 5s, tell agent our receive performance.
        // Agent throttles if dropRate > 15% for 3 consecutive reports.
        if (this._viewerReportTimer) clearInterval(this._viewerReportTimer);
        this._viewerFrameBase = this.frameCount || 0;
        this._viewerTimeBase = Date.now();
        this._viewerReportTimer = setInterval(() => {
            if (!this.livePC || this.livePC !== pcName) { clearInterval(this._viewerReportTimer); this._viewerReportTimer = null; return; }
            // Skip adaptive entirely for H.264: MSE manages its own buffering, and fragment-rate
            // metrics are misleading (different semantics than MJPEG frame-rate).
            if (codecSel?.value === 'h264') return;
            const now = Date.now();
            const deltaSec = (now - this._viewerTimeBase) / 1000;
            if (deltaSec < 1) return;
            const frames = (this.frameCount || 0) - this._viewerFrameBase;
            const recvFps = frames / deltaSec;
            const expFps = parseInt(qualSel.value.split('-')[0]) || 15;
            const dropRate = Math.max(0, 1 - recvFps / expFps);
            this.socket.emit('viewer-quality', { pcName: this.livePC, recvFps: +recvFps.toFixed(1), expFps, dropRate: +dropRate.toFixed(2) });
            this._viewerFrameBase = this.frameCount || 0;
            this._viewerTimeBase = now;
        }, 5000);

        // Control toggle
        controlBtn.onclick = () => {
            this.controlMode = !this.controlMode;
            const cvs = document.getElementById('live-canvas');
            if (this.controlMode) {
                controlBtn.textContent = '조작 중';
                controlBtn.className = 'text-xs px-3 py-1 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition';
                controlStatus.textContent = '클릭/키보드로 조작 · ESC 해제';
                cvs.style.cursor = 'crosshair';
            } else {
                controlBtn.textContent = '원격 조작';
                controlBtn.className = 'text-xs px-3 py-1 bg-gray-100 rounded-lg hover:bg-blue-100 transition';
                controlStatus.textContent = '';
                cvs.style.cursor = 'default';
            }
        };

        // Mouse events on canvas
        const canvas = document.getElementById('live-canvas');

        // Local cursor overlay (Parsec-style: instant visual response)
        // Real cursor is hidden, local dot renders immediately, remote follows async
        if (this.controlMode) {
            canvas.style.cursor = 'none';
            if (!this._cursorOverlay) {
                this._cursorOverlay = document.createElement('div');
                this._cursorOverlay.style.cssText = 'position:absolute;width:8px;height:8px;background:rgba(59,130,246,0.8);border-radius:50%;pointer-events:none;z-index:99;transform:translate(-50%,-50%);box-shadow:0 0 4px rgba(59,130,246,0.5);display:none;';
                canvas.parentElement.style.position = 'relative';
                canvas.parentElement.appendChild(this._cursorOverlay);
            }
        }

        // Mousemove: throttled to 30Hz + local cursor rendering
        let _lastMove = 0;
        canvas.onmousemove = (e) => {
            if (!this.controlMode || !this.livePC) return;
            // Local cursor: instant (no network delay)
            if (this._cursorOverlay) {
                this._cursorOverlay.style.display = 'block';
                this._cursorOverlay.style.left = (e.clientX - canvas.getBoundingClientRect().left) + 'px';
                this._cursorOverlay.style.top = (e.clientY - canvas.getBoundingClientRect().top) + 'px';
            }
            // Remote cursor: throttled 30Hz
            const now = Date.now();
            if (now - _lastMove < 33) return;
            _lastMove = now;
            const rect = canvas.getBoundingClientRect();
            const x = Math.round((e.clientX - rect.left) / rect.width * canvas.width);
            const y = Math.round((e.clientY - rect.top) / rect.height * canvas.height);
            this.socket.volatile.emit('remote-mouse', {
                pcName: this.livePC, x, y, button: 0,
                action: 'move', screenW: canvas.width, screenH: canvas.height
            });
        };

        // Drag support: mousedown → move → mouseup (instead of just click)
        canvas.onmousedown = (e) => {
            if (!this.controlMode || !this.livePC) return;
            if (e.button === 2) return; // right-click handled by contextmenu
            const rect = canvas.getBoundingClientRect();
            const x = Math.round((e.clientX - rect.left) / rect.width * canvas.width);
            const y = Math.round((e.clientY - rect.top) / rect.height * canvas.height);
            this.socket.volatile.emit('remote-mouse', {
                pcName: this.livePC, x, y, button: e.button,
                action: 'mousedown', screenW: canvas.width, screenH: canvas.height
            });
        };
        canvas.onmouseup = (e) => {
            if (!this.controlMode || !this.livePC) return;
            if (e.button === 2) return;
            const rect = canvas.getBoundingClientRect();
            const x = Math.round((e.clientX - rect.left) / rect.width * canvas.width);
            const y = Math.round((e.clientY - rect.top) / rect.height * canvas.height);
            this.socket.volatile.emit('remote-mouse', {
                pcName: this.livePC, x, y, button: e.button,
                action: 'mouseup', screenW: canvas.width, screenH: canvas.height
            });
        };
        canvas.ondblclick = (e) => {
            if (!this.controlMode || !this.livePC) return;
            const rect = canvas.getBoundingClientRect();
            const x = Math.round((e.clientX - rect.left) / rect.width * canvas.width);
            const y = Math.round((e.clientY - rect.top) / rect.height * canvas.height);
            this.socket.volatile.emit('remote-mouse', {
                pcName: this.livePC, x, y, button: 0,
                action: 'dblclick', screenW: canvas.width, screenH: canvas.height
            });
        };
        canvas.oncontextmenu = (e) => {
            if (this.controlMode) {
                e.preventDefault();
                const rect = canvas.getBoundingClientRect();
                const x = Math.round((e.clientX - rect.left) / rect.width * canvas.width);
                const y = Math.round((e.clientY - rect.top) / rect.height * canvas.height);
                this.socket.volatile.emit('remote-mouse', {
                    pcName: this.livePC, x, y, button: 2,
                    action: 'click', screenW: canvas.width, screenH: canvas.height
                });
            }
        };

        // Scroll (wheel)
        this._wheelHandler = (e) => {
            if (!this.controlMode || !this.livePC) return;
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const x = Math.round((e.clientX - rect.left) / rect.width * canvas.width);
            const y = Math.round((e.clientY - rect.top) / rect.height * canvas.height);
            // Normalize delta: browser deltaY>0 = scroll down, Win32 positive = scroll up
            const delta = -Math.sign(e.deltaY) * 120;
            this.socket.emit('remote-scroll', {
                pcName: this.livePC, x, y, delta,
                screenW: canvas.width, screenH: canvas.height
            });
        };
        canvas.addEventListener('wheel', this._wheelHandler, { passive: false });

        // Keyboard events (ESC handled by global handler to exit control mode)
        this._keyHandler = (e) => {
            if (!this.controlMode || !this.livePC) return;
            if (e.key === 'Escape') return; // let global handler turn off control mode
            e.preventDefault();
            this.socket.volatile.emit('remote-keyboard', {
                pcName: this.livePC, key: e.key,
                ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey
            });
        };
        document.addEventListener('keydown', this._keyHandler);

        // Close handlers
        document.getElementById('live-close').onclick = () => this.closeLiveView();
        document.getElementById('live-modal').onclick = (e) => {
            if (e.target.id === 'live-modal') this.closeLiveView();
        };
    }

    closeLiveView() {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        if (this._noSignalTimer) { clearInterval(this._noSignalTimer); this._noSignalTimer = null; }
        if (this.livePC) {
            this.socket.emit('stop-stream-request', { pcName: this.livePC });
        }
        this.livePC = null;
        this.controlMode = false;
        this._totalBytes = 0;
        // Clean up local cursor overlay
        if (this._cursorOverlay) { this._cursorOverlay.remove(); this._cursorOverlay = null; }
        // Clean up H.264 MSE
        this._cleanupMSE();
        if (this._mseVideo) {
            this._mseVideo.src = '';
            this._mseVideo.remove();
            this._mseVideo = null;
            const canvas = document.getElementById('live-canvas');
            if (canvas) canvas.style.display = '';
        }
        this._h264Unsupported = false;
        // Clean up MJPEG frame image
        if (this._frameImg) {
            this._frameImg.src = '';
            this._frameImg = null;
        }
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler);
            this._keyHandler = null;
        }
        if (this._wheelHandler) {
            const canvas = document.getElementById('live-canvas');
            canvas.removeEventListener('wheel', this._wheelHandler);
            this._wheelHandler = null;
        }
        document.getElementById('live-modal').classList.add('hidden');
    }

    // ── H.264 MSE player ──
    handleH264Frame(frameData, isInit) {
        this._lastFrameAt = Date.now();
        document.getElementById('live-loading').classList.add('hidden');
        // Increment frameCount for adaptive bitrate reporter (same as drawFrame path).
        // Without this, H.264 mode reports 100% drop rate → agent auto-throttles fps.
        if (!isInit) this.frameCount++;

        const bytes = frameData instanceof ArrayBuffer ? new Uint8Array(frameData) : new Uint8Array(frameData);

        // Initialize MSE on first init segment
        if (isInit || !this._mseSource) {
            this._cleanupMSE();
            const video = document.getElementById('live-canvas');
            // Need a <video> element for MSE — create one overlaying the canvas
            if (!this._mseVideo) {
                this._mseVideo = document.createElement('video');
                this._mseVideo.autoplay = true;
                this._mseVideo.muted = true;
                this._mseVideo.playsInline = true;
                // Match canvas's responsive sizing: fill container, preserve aspect ratio.
                // Use class-based Tailwind utilities rather than fragile offsetWidth snapshot
                // (which is 0 before first frame paints, causing tiny-video bug).
                this._mseVideo.className = 'max-w-full max-h-full';
                this._mseVideo.style.cssText = '';
                this._mseVideo.style.position = 'absolute';
                this._mseVideo.style.top = '0';
                this._mseVideo.style.left = '0';
                this._mseVideo.style.right = '0';
                this._mseVideo.style.bottom = '0';
                this._mseVideo.style.margin = 'auto';
                this._mseVideo.style.width = '100%';
                this._mseVideo.style.height = '100%';
                this._mseVideo.style.zIndex = '5';
                this._mseVideo.style.objectFit = 'contain';
                this._mseVideo.style.background = 'black';
                const container = video.parentElement;
                container.style.position = 'relative';
                container.appendChild(this._mseVideo);
                video.style.display = 'none';
            }

            if (!MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01F"')) {
                // Browser doesn't support H.264 MSE — fall back to MJPEG
                this._h264Unsupported = true;
                return;
            }

            this._mseSource = new MediaSource();
            this._mseVideo.src = URL.createObjectURL(this._mseSource);
            this._mseQueue = [];
            this._mseSource.addEventListener('sourceopen', () => {
                try {
                    this._mseSB = this._mseSource.addSourceBuffer('video/mp4; codecs="avc1.42E01F"');
                    this._mseSB.mode = 'sequence';
                    this._mseSB.addEventListener('updateend', () => {
                        // Append queued segments
                        if (this._mseQueue.length > 0 && !this._mseSB.updating) {
                            this._mseSB.appendBuffer(this._mseQueue.shift());
                        }
                        // Aggressive buffer trim (max 1.5s) — low-latency mode for interactive remote control.
                        try {
                            if (this._mseSB.buffered.length > 0) {
                                const end = this._mseSB.buffered.end(0);
                                const start = this._mseSB.buffered.start(0);
                                if (end - start > 1.5) {
                                    this._mseSB.remove(0, end - 1.0);
                                }
                            }
                        } catch (e) {}
                    });
                    // Append init segment immediately
                    this._mseSB.appendBuffer(bytes);
                } catch (e) {
                    console.error('MSE setup error:', e);
                }
            });
            return;
        }

        // Append media segment
        if (this._mseSB && !this._h264Unsupported) {
            if (this._mseSB.updating || this._mseQueue.length > 0) {
                // Queue up to 3 segments, drop older ones
                if (this._mseQueue.length >= 3) this._mseQueue.shift();
                this._mseQueue.push(bytes);
            } else {
                try { this._mseSB.appendBuffer(bytes); } catch (e) { /* buffer full */ }
            }
            // Keep video playing at live edge — aggressive seek to edge if lagging >0.5s.
            if (this._mseVideo && this._mseVideo.buffered.length > 0) {
                const liveEdge = this._mseVideo.buffered.end(0);
                if (liveEdge - this._mseVideo.currentTime > 0.7) {
                    this._mseVideo.currentTime = liveEdge - 0.2;
                }
            }
        }
    }

    _cleanupMSE() {
        if (this._mseSB) { try { this._mseSource.removeSourceBuffer(this._mseSB); } catch (e) {} }
        if (this._mseSource) { try { this._mseSource.endOfStream(); } catch (e) {} }
        this._mseSB = null;
        this._mseSource = null;
        this._mseQueue = [];
        // If switching away from H.264 (e.g., user chose MJPEG), remove video overlay + show canvas
        if (this._mseVideo) {
            try { this._mseVideo.src = ''; this._mseVideo.remove(); } catch(e){}
            this._mseVideo = null;
            const canvas = document.getElementById('live-canvas');
            if (canvas) canvas.style.display = '';
        }
    }

    drawFrame(frameData) {
        this._lastFrameAt = Date.now();
        document.getElementById('live-loading').classList.add('hidden');
        const canvas = document.getElementById('live-canvas');
        const ctx = canvas.getContext('2d');

        // Reuse a single Image object — set onload once, never chain
        if (!this._frameImg) {
            this._frameImg = new Image();
            this._frameImg._busy = false;
            this._frameImg.onload = () => {
                const img = this._frameImg;
                if (!img || !this.livePC) return;
                img._busy = false;
                // Revoke previous blob URL to prevent memory leak
                if (img._blobUrl) { URL.revokeObjectURL(img._blobUrl); img._blobUrl = null; }
                if (canvas.width !== img.width) canvas.width = img.width;
                if (canvas.height !== img.height) canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
            };
            this._frameImg.onerror = () => {
                if (this._frameImg) {
                    this._frameImg._busy = false;
                    if (this._frameImg._blobUrl) { URL.revokeObjectURL(this._frameImg._blobUrl); this._frameImg._blobUrl = null; }
                }
            };
        }

        // Drop frame if previous is still decoding
        if (this._frameImg._busy) return;
        this._frameImg._busy = true;

        let frameSize = 0;
        if (frameData instanceof ArrayBuffer || (frameData && frameData.buffer instanceof ArrayBuffer)) {
            const bytes = frameData instanceof ArrayBuffer ? new Uint8Array(frameData) : new Uint8Array(frameData);
            frameSize = bytes.length;
            const blob = new Blob([bytes], { type: 'image/jpeg' });
            const url = URL.createObjectURL(blob);
            this._frameImg._blobUrl = url;
            this._frameImg.src = url;
        } else if (typeof frameData === 'string') {
            // Legacy base64 string (backward compat)
            frameSize = Math.ceil(frameData.length * 0.75);
            this._frameImg.src = 'data:image/jpeg;base64,' + frameData;
        } else {
            this._frameImg._busy = false;
            return;
        }

        // FPS counter + bandwidth
        this.frameCount++;
        this._totalBytes = (this._totalBytes || 0) + frameSize;
        const now = Date.now();
        if (now - this.lastFpsTime >= 1000) {
            const kbps = Math.round(this._totalBytes * 8 / 1024);
            document.getElementById('live-fps').textContent = this.frameCount + ' fps';
            const sizeEl = document.getElementById('live-size');
            if (sizeEl) sizeEl.textContent = kbps + ' kbps';
            this.frameCount = 0;
            this._totalBytes = 0;
            this.lastFpsTime = now;
        }
    }

    // ── Drag Order Save ──────────────────────
    async saveCardOrder() {
        const grid = document.getElementById('pc-grid');
        const order = [...grid.children].map((card, i) => {
            const pcName = card.getAttribute('data-pc');
            // Update local state too
            const pc = this.pcs.get(pcName);
            if (pc) pc.sort_order = i;
            return { pcName, sortOrder: i };
        });
        await this.apiFetch('/api/pcs/reorder', {
            method: 'PATCH',
            body: JSON.stringify({ order })
        });
    }

    // ── Remote Commands ─────────────────────────
    async sendCommand(pcName, cmd, label) {
        // URL needs a prompt
        if (cmd === 'open-url') {
            const url = prompt(`${label}에서 열 URL:`, 'https://');
            if (!url || url === 'https://') return;
            await this.apiFetch('/api/pcs/' + encodeURIComponent(pcName) + '/command', {
                method: 'POST',
                body: JSON.stringify({ command: cmd, params: { url } })
            });
            return;
        }

        // Dangerous commands need confirmation
        if (cmd === 'shutdown' || cmd === 'restart') {
            if (!confirm(`${label}을(를) ${cmd === 'shutdown' ? '종료' : '재시작'}할까요?`)) return;
        }

        await this.apiFetch('/api/pcs/' + encodeURIComponent(pcName) + '/command', {
            method: 'POST',
            body: JSON.stringify({ command: cmd, params: {} })
        });
    }

    // ── Message ───────────────────────────────
    openMessageModal(pcName, label) {
        const modal = document.getElementById('msg-modal');
        const target = document.getElementById('msg-target');
        const input = document.getElementById('msg-input');
        const sendBtn = document.getElementById('msg-send');
        const closeBtn = document.getElementById('msg-close');
        const status = document.getElementById('msg-status');

        target.textContent = label || pcName;
        modal.setAttribute('data-pc', pcName || '__all__');
        input.value = '';
        status.textContent = '';
        modal.classList.remove('hidden');
        input.focus();

        sendBtn.onclick = () => this.sendMessage();
        closeBtn.onclick = () => modal.classList.add('hidden');
        modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
        input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); } };
    }

    async sendMessage() {
        const modal = document.getElementById('msg-modal');
        const input = document.getElementById('msg-input');
        const status = document.getElementById('msg-status');
        const msg = input.value.trim();
        if (!msg) return;

        const pcName = modal.getAttribute('data-pc');
        if (!pcName) return;
        status.textContent = '전송 중...';
        status.className = 'text-xs text-gray-400 mt-2';

        if (pcName === '__all__') {
            // Broadcast to all online PCs
            const online = Array.from(this.pcs.values()).filter(p => p.status === 'online');
            if (online.length === 0) {
                status.textContent = '온라인 PC 없음';
                status.className = 'text-xs text-red-500 mt-2';
                return;
            }
            await Promise.allSettled(online.map(pc =>
                this.apiFetch('/api/pcs/' + encodeURIComponent(pc.pc_name) + '/command', {
                    method: 'POST',
                    body: JSON.stringify({ command: 'message', params: { message: msg } })
                })
            ));
            status.textContent = `${online.length}대 전송 완료`;
            status.className = 'text-xs text-green-500 mt-2';
        } else {
            const res = await this.apiFetch('/api/pcs/' + encodeURIComponent(pcName) + '/command', {
                method: 'POST',
                body: JSON.stringify({ command: 'message', params: { message: msg } })
            });
            if (res) {
                status.textContent = '전송 완료';
                status.className = 'text-xs text-green-500 mt-2';
            } else {
                status.textContent = '전송 실패';
                status.className = 'text-xs text-red-500 mt-2';
            }
        }
        input.value = '';
        setTimeout(() => modal.classList.add('hidden'), 1500);
    }

    // ── Block Windows Settings (all PCs) ──────
    // Helper: update sidebar button label span (preserves icon)
    _setSidebarLabel(btnId, text) {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        const label = btn.querySelector('.sidebar-label');
        if (label) label.textContent = text;
    }

    // Helper: bulk-toggle programs via global '*' endpoint
    async _bulkToggleProgs(progs, block) {
        for (const prog of progs) {
            await this.apiFetch('/api/block-program-all', {
                method: 'POST',
                body: JSON.stringify({ programName: prog, blocked: block })
            });
        }
    }

    async toggleBlockSettings() {
        const btn = document.getElementById('block-settings-btn');
        const isBlocked = btn.getAttribute('data-blocked') === 'true';
        const settingsProgs = [
            'SystemSettings.exe', 'control.exe', 'mmc.exe',
            'regedit.exe', 'taskmgr.exe', 'gpedit.msc', 'services.msc',
        ];
        btn.disabled = true;
        this._setSidebarLabel('block-settings-btn', '적용 중...');
        await this._bulkToggleProgs(settingsProgs, !isBlocked);
        btn.disabled = false;
        if (!isBlocked) {
            btn.setAttribute('data-blocked', 'true');
            this._setSidebarLabel('block-settings-btn', '설정 허용');
            this.showToast('설정/작업관리자/레지스트리 차단 — 전체 PC', 'green');
        } else {
            btn.setAttribute('data-blocked', 'false');
            this._setSidebarLabel('block-settings-btn', '설정 차단');
            this.showToast('설정 차단 해제', 'gray');
        }
    }

    async toggleBlockInstall() {
        const btn = document.getElementById('block-install-btn');
        const isBlocked = btn.getAttribute('data-blocked') === 'true';
        const installProgs = [
            // 설치 프로그램
            'setup.exe', 'install.exe', 'installer.exe', 'msiexec.exe', 'unins000.exe',
            // 메신저
            'KakaoTalk_Setup.exe', 'KakaoTalk.exe',
            'Discord.exe', 'DiscordSetup.exe',
            'LineInst.exe', 'LINE.exe',
            'TelegramSetup.exe', 'Telegram.exe',
            'Zoom.exe', 'ZoomInstaller.exe',
            // 게임 — 롤/롤토체스
            'LeagueClient.exe', 'League of Legends.exe', 'LeagueClientUx.exe',
            'RiotClientServices.exe', 'RiotClientUx.exe', 'RiotClientCrashHandler.exe',
            // 스팀/에픽
            'Steam.exe', 'SteamSetup.exe', 'steamwebhelper.exe',
            'EpicGamesLauncher.exe', 'EpicInstaller.exe',
            // 마인크래프트 (로블록스는 제외)
            'Minecraft.exe', 'MinecraftLauncher.exe', 'javaw.exe',
            // 기타 게임
            'FortniteClient-Win64-Shipping.exe',
            'VALORANT.exe', 'VALORANT-Win64-Shipping.exe',
            'overwatch.exe', 'Battle.net.exe', 'Battle.net Launcher.exe',
            'GenshinImpact.exe', 'maplestory.exe', 'MapleStory.exe',
            'dnf.exe', 'suddenattack.exe', 'SA.exe',
            'KartRider.exe', 'CrazyArcade.exe', 'BubbleFighter.exe',
            'fifaonline4.exe', 'fc_online.exe',
        ];
        btn.disabled = true;
        this._setSidebarLabel('block-install-btn', '적용 중...');
        await this._bulkToggleProgs(installProgs, !isBlocked);
        btn.disabled = false;
        if (!isBlocked) {
            btn.setAttribute('data-blocked', 'true');
            this._setSidebarLabel('block-install-btn', '설치 허용');
            this.showToast('설치/게임 차단 ON — ' + installProgs.length + '개 프로그램 (전체 PC)', 'green');
        } else {
            btn.setAttribute('data-blocked', 'false');
            this._setSidebarLabel('block-install-btn', '설치/게임 차단');
            this.showToast('설치 차단 해제', 'gray');
        }
    }

    // ── Wallpaper Change ──────────────────────────
    // Sidebar button has structure: <icon><label> — update label span only.
    _wallpaperLabel() {
        const btn = document.getElementById('wallpaper-lock-btn');
        return btn ? btn.querySelector('.sidebar-label') : null;
    }
    _setWallpaperLabel(text) {
        const el = this._wallpaperLabel();
        if (el) el.textContent = text;
    }

    async loadWallpaperState() {
        const data = await this.apiFetch('/api/wallpaper-lock');
        const btn = document.getElementById('wallpaper-lock-btn');
        if (!btn) return;
        if (data && data.locked) {
            btn.setAttribute('data-locked', 'true');
            this._setWallpaperLabel('배경화면 복원');
        } else {
            btn.setAttribute('data-locked', 'false');
            this._setWallpaperLabel('배경화면 변경');
        }
    }

    async toggleWallpaperLock() {
        const btn = document.getElementById('wallpaper-lock-btn');
        const isLocked = btn.getAttribute('data-locked') === 'true';

        if (!isLocked) {
            this._setWallpaperLabel('적용 중...');
            btn.disabled = true;
            const res = await this.apiFetch('/api/wallpaper-apply', { method: 'POST', body: '{}' });
            btn.disabled = false;
            if (res && (res.output || (res.data && res.data.output) || res.success)) {
                btn.setAttribute('data-locked', 'true');
                this._setWallpaperLabel('배경화면 복원');
                this.showToast('배경화면 변경 완료 (모든 학생 PC)', 'green');
            } else {
                this._setWallpaperLabel('배경화면 변경');
                this.showToast('배경화면 변경 실패', 'red');
            }
        } else {
            await this.apiFetch('/api/wallpaper-lock', { method: 'POST', body: JSON.stringify({ locked: false }) });
            btn.setAttribute('data-locked', 'false');
            this._setWallpaperLabel('배경화면 변경');
            this.showToast('배경화면 잠금 해제', 'gray');
        }
    }

    // ── Agent Remote Update ─────────────────────
    async pushAgentUpdate() {
        const online = Array.from(this.pcs.values()).filter(p => p.status === 'online');
        if (online.length === 0) { this.showToast('접속된 PC 없음', 'gray'); return; }
        if (!confirm('접속된 ' + online.length + '대에 에이전트 업데이트를 전송할까요?')) return;

        const res = await this.apiFetch('/api/agent-update', { method: 'POST', body: '{}' });
        const sent = res && (res.sent || (res.data && res.data.sent));
        if (sent) {
            this.showToast(sent + '대에 업데이트 전송 완료 — 20초 후 자동 재시작', 'green');
        } else {
            this.showToast('업데이트 전송 실패', 'red');
        }
    }

    // ── Boot All PCs (WOL sequence) ─────────────────
    async bootAllPCs() {
        const offline = Array.from(this.pcs.values()).filter(p => p.status !== 'online');
        if (offline.length === 0) { this.showToast('모든 PC가 이미 켜져있음', 'green'); return; }
        if (!confirm(offline.length + '대 오프라인 PC를 켤까요?\nWOL 전송 → 45초 대기 → 확인 → 재시도')) return;

        this.showToast('전체 부팅 시작... (약 2분 소요)', 'blue');
        SOUNDS.alert();
        const res = await this.apiFetch('/api/boot-sequence', { method: 'POST', body: '{}' });
        if (res && res.success !== false) {
            this.showToast('WOL 전송 완료 — 백그라운드에서 확인 중', 'green');
        } else {
            this.showToast('부팅 시퀀스 실패', 'red');
        }
    }

    // ── Ping Sweep (network diagnostic) ─────────────
    async pingSweep() {
        this.showToast('네트워크 진단 중...', 'blue');
        const res = await this.apiFetch('/api/ping-sweep');
        if (!res) { this.showToast('진단 실패', 'red'); return; }
        const data = res.data || res;
        if (!Array.isArray(data)) { this.showToast('데이터 없음', 'gray'); return; }

        const online = data.filter(d => d.state === 'online').length;
        const agentDead = data.filter(d => d.state === 'pc-on-agent-dead');
        const off = data.filter(d => d.state === 'pc-off').length;

        let msg = `진단 완료: 정상 ${online} / 꺼짐 ${off}`;
        if (agentDead.length > 0) {
            msg += ` / 에이전트 죽음 ${agentDead.length} (${agentDead.map(d => d.pcName).join(', ')})`;
            SOUNDS.alert();
        }
        this.showToast(msg, agentDead.length > 0 ? 'red' : 'green');
    }

    // ── Teacher Screen Share (LanSchool "Show My Screen") ──
    async toggleScreenShare() {
        const btn = document.getElementById('share-screen-btn');
        if (this._screenShareStream) {
            // Stop sharing
            this._screenShareStream.getTracks().forEach(t => t.stop());
            this._screenShareStream = null;
            if (this._screenShareRecorder) {
                this._screenShareRecorder.stop();
                this._screenShareRecorder = null;
            }
            this.socket.emit('teacher-screen-stop');
            btn.querySelector('.sidebar-label').textContent = '화면 공유';
            this.showToast('화면 공유 종료', 'gray');
            return;
        }

        try {
            this._screenShareStream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: 10, width: { max: 1280 }, height: { max: 720 } },
                audio: false,
            });

            // Track when user stops via browser UI
            this._screenShareStream.getVideoTracks()[0].onended = () => {
                this._screenShareStream = null;
                if (this._screenShareRecorder) { this._screenShareRecorder.stop(); this._screenShareRecorder = null; }
                this.socket.emit('teacher-screen-stop');
                btn.querySelector('.sidebar-label').textContent = '화면 공유';
                this.showToast('화면 공유 종료', 'gray');
            };

            // Encode via MediaRecorder + send chunks to server
            const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
                ? 'video/webm;codecs=vp8' : 'video/webm';
            this._screenShareRecorder = new MediaRecorder(this._screenShareStream, {
                mimeType,
                videoBitsPerSecond: 1_500_000, // 1.5Mbps
            });
            this._screenShareRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    e.data.arrayBuffer().then(buf => {
                        this.socket.volatile.emit('teacher-screen-frame', {
                            f: new Uint8Array(buf),
                            t: Date.now(),
                        });
                    });
                }
            };
            this._screenShareRecorder.start(200); // 200ms chunks (5fps effective)

            // Open viewer on all student PCs
            this.socket.emit('teacher-screen-start');

            btn.querySelector('.sidebar-label').textContent = '공유 중지';
            this.showToast('화면 공유 시작 — 학생 PC에 표시됩니다', 'green');
            SOUNDS.alert();
        } catch (e) {
            this.showToast('화면 공유 취소', 'gray');
        }
    }

    // ── All PCs Batch Command (inline accordion) ──────────────────
    initAllPCsMenu() {
        const btn = document.getElementById('all-cmd-btn');
        const menu = document.getElementById('all-cmd-menu');
        const chevron = document.getElementById('all-cmd-chevron');
        btn.onclick = (e) => {
            e.stopPropagation();
            const hidden = menu.classList.toggle('hidden');
            if (chevron) chevron.innerHTML = hidden ? '&#9662;' : '&#9652;';
        };
        menu.querySelectorAll('[data-cmd]').forEach(item => {
            item.onclick = (e) => {
                e.stopPropagation();
                this.batchCommand(item.getAttribute('data-cmd'));
            };
        });
        // Auto-arrange cards in grid
        const arrangeBtn = document.getElementById('auto-arrange-btn');
        if (arrangeBtn) {
            arrangeBtn.onclick = (e) => {
                e.stopPropagation();
                this.autoArrangeCards();
            };
        }
    }

    // Auto-arrange all PC cards in a clean grid, sorted by last-seen
    async autoArrangeCards() {
        const pcs = Array.from(this.pcs.values()).sort((a, b) => {
            // Online first, then by IP suffix
            if ((a.status === 'online') !== (b.status === 'online'))
                return a.status === 'online' ? -1 : 1;
            const aIp = parseInt((a.ip_address || '').split('.').pop()) || 999;
            const bIp = parseInt((b.ip_address || '').split('.').pop()) || 999;
            return aIp - bIp;
        });

        const CARD_W = 260;   // card width + gap
        const CARD_H = 220;   // card height + gap
        const MARGIN = 20;
        const canvas = document.getElementById('pc-canvas');
        const canvasWidth = canvas ? canvas.clientWidth : 1200;
        const perRow = Math.max(1, Math.floor((canvasWidth - MARGIN * 2) / CARD_W));

        const updates = [];
        pcs.forEach((pc, i) => {
            const row = Math.floor(i / perRow);
            const col = i % perRow;
            const x = MARGIN + col * CARD_W;
            const y = MARGIN + row * CARD_H;
            pc.pos_x = x;
            pc.pos_y = y;
            updates.push({ pcName: pc.pc_name || pc.pcName, x, y });
            // Update DOM immediately
            const card = document.querySelector(`[data-pc="${CSS.escape(pc.pc_name || pc.pcName)}"]`);
            if (card) {
                card.style.left = x + 'px';
                card.style.top = y + 'px';
            }
        });

        // Persist in parallel
        await Promise.allSettled(updates.map(u =>
            this.apiFetch('/api/pcs/' + encodeURIComponent(u.pcName) + '/position', {
                method: 'PATCH',
                body: JSON.stringify({ x: u.x, y: u.y })
            })
        ));
        this.expandCanvas();
        this.showToast(pcs.length + '대 자동 정렬 완료', 'green');
    }

    async batchCommand(cmd) {
        const online = Array.from(this.pcs.values()).filter(p => p.status === 'online');
        if (online.length === 0) {
            this.showToast('온라인 PC 없음', 'gray');
            return;
        }
        let params = {};
        if (cmd === 'open-url') {
            const url = prompt('전체 PC에서 열 URL:', 'https://');
            if (!url || url === 'https://') return;
            params = { url };
        } else if (cmd === 'message') {
            const msg = prompt('전체 PC에 보낼 메시지:');
            if (!msg) return;
            params = { message: msg };
        } else if (cmd === 'restart' || cmd === 'shutdown') {
            if (!confirm('전체 ' + online.length + '대를 ' + (cmd === 'shutdown' ? '종료' : '재시작') + '할까요?')) return;
        }
        for (const pc of online) {
            this.apiFetch('/api/pcs/' + encodeURIComponent(pc.pc_name) + '/command', {
                method: 'POST', body: JSON.stringify({ command: cmd, params })
            });
        }
    }

    // ── Attendance removed ──

    // ── Site Blocking (global) ─────────────────
    async loadSitesBadge() {
        const data = await this.apiFetch('/api/blocked-sites');
        const sites = Array.isArray(data) ? data : (data && data.data ? data.data : []);
        this.updateSitesBadge(sites.length);
    }

    updateSitesBadge(count) {
        const badge = document.getElementById('block-sites-header-badge');
        if (!badge) return;
        if (count > 0) {
            badge.textContent = count;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    async openBlockSitesModal() {
        const modal = document.getElementById('block-sites-modal');
        const list = document.getElementById('block-sites-list');
        const input = document.getElementById('block-site-input');
        const addBtn = document.getElementById('block-site-add');
        const closeBtn = document.getElementById('block-sites-close');

        modal.classList.remove('hidden');
        input.value = '';
        input.focus();

        // Load current blocked sites
        list.replaceChildren();
        const data = await this.apiFetch('/api/blocked-sites');
        const sites = Array.isArray(data) ? data : (data && data.data ? data.data : []);
        sites.forEach(s => list.appendChild(this.createSiteRow(s)));
        const countEl = document.getElementById('block-sites-count');
        if (countEl) countEl.textContent = sites.length;
        this.updateSitesBadge(sites.length);

        addBtn.onclick = () => this.addBlockedSite();
        input.onkeydown = (e) => { if (e.key === 'Enter') this.addBlockedSite(); };
        closeBtn.onclick = () => modal.classList.add('hidden');
        modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };

        // Emergency clear-all
        const clearBtn = document.getElementById('block-sites-clear-all');
        if (clearBtn) {
            clearBtn.onclick = async () => {
                if (!confirm('정말로 모든 차단 사이트를 해제할까요?\n\n모든 학생 PC의 hosts 파일이 즉시 정리됩니다.')) return;
                const res = await this.apiFetch('/api/blocked-sites', { method: 'DELETE' });
                if (res && res.success) {
                    list.replaceChildren();
                    countEl.textContent = '0';
                    this.updateSitesBadge(0);
                    this.showToast('모든 차단 해제됨 — 전체 PC 동기화 중', 'green');
                } else {
                    this.showToast('해제 실패', 'red');
                }
            };
        }
    }

    createSiteRow(site) {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg';
        const label = document.createElement('span');
        label.className = 'text-sm text-gray-700';
        label.textContent = site.url;
        const del = document.createElement('button');
        del.className = 'text-xs text-red-400 hover:text-red-600';
        del.textContent = '해제';
        del.onclick = async () => {
            await this.apiFetch('/api/blocked-sites/' + site.id, { method: 'DELETE' });
            row.remove();
            const n = document.getElementById('block-sites-list').children.length;
            const countEl = document.getElementById('block-sites-count');
            if (countEl) countEl.textContent = n;
            this.updateSitesBadge(n);
        };
        row.appendChild(label);
        row.appendChild(del);
        return row;
    }

    async addBlockedSite() {
        const input = document.getElementById('block-site-input');
        const list = document.getElementById('block-sites-list');
        const raw = input.value.trim().toLowerCase();
        if (!raw) return;

        // Support comma-separated bulk input
        const urls = raw.split(/[,\s]+/).map(u => u.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()).filter(Boolean);

        // Check existing sites in list
        const existing = new Set();
        list.querySelectorAll('span').forEach(el => existing.add(el.textContent.toLowerCase()));

        const dupes = [];
        for (const url of urls) {
            if (existing.has(url)) {
                dupes.push(url);
                continue;
            }
            const res = await this.apiFetch('/api/blocked-sites', {
                method: 'POST', body: JSON.stringify({ url })
            });
            if (res && res.data) {
                list.appendChild(this.createSiteRow(res.data));
                existing.add(url);
            }
        }
        const countEl = document.getElementById('block-sites-count');
        if (countEl) countEl.textContent = list.children.length;
        this.updateSitesBadge(list.children.length);
        input.value = '';
        if (dupes.length > 0) {
            input.value = '';
            input.placeholder = dupes.join(', ') + ' — 이미 차단됨';
            input.className = input.className.replace('focus:ring-red-500', 'focus:ring-orange-500');
            setTimeout(() => {
                input.placeholder = 'youtube.com 또는 여러 개 붙여넣기';
                input.className = input.className.replace('focus:ring-orange-500', 'focus:ring-red-500');
            }, 2000);
        }
        input.focus();
    }

    // ── Process Viewer (Task Manager style — running apps only) ───
    async openProcessModal(pcName, label) {
        const modal = document.getElementById('proc-modal');
        const target = document.getElementById('proc-target');
        const countEl = document.getElementById('proc-count');
        const procList = document.getElementById('proc-list');
        const refreshBtn = document.getElementById('proc-refresh');
        const closeBtn = document.getElementById('proc-close');
        const filterInput = document.getElementById('proc-filter');

        modal.setAttribute('data-pc', pcName);
        target.textContent = label || pcName;
        modal.classList.remove('hidden');
        filterInput.value = '';

        closeBtn.onclick = () => modal.classList.add('hidden');
        modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };

        const loadApps = async () => {
            procList.replaceChildren();
            const loading = document.createElement('p');
            loading.className = 'text-xs text-gray-400 py-4 text-center';
            loading.textContent = '불러오는 중...';
            procList.appendChild(loading);

            // Use processes API (fast, works on all agents) and filter out system/background
            const pData = await this.apiFetch('/api/pcs/' + encodeURIComponent(pcName) + '/processes');
            procList.replaceChildren();

            if (!pData) {
                countEl.textContent = '0';
                const err = document.createElement('p');
                err.className = 'text-xs text-red-400 py-4 text-center';
                err.textContent = '불러오기 실패 — PC가 오프라인이거나 응답 없음';
                procList.appendChild(err);
                return;
            }

            const sysProcs = new Set(['system idle process','system','secure system','registry',
                'smss.exe','csrss.exe','wininit.exe','services.exe','lsass.exe','svchost.exe',
                'dwm.exe','fontdrvhost.exe','winlogon.exe','sihost.exe','taskhostw.exe',
                'ctfmon.exe','conhost.exe','runtimebroker.exe','dllhost.exe','smartscreen.exe',
                'securityhealthservice.exe','sgrmbroker.exe','spoolsv.exe','dashost.exe',
                'msdtc.exe','wlanext.exe','node.exe','wmiprvse.exe','audiodg.exe',
                'searchindexer.exe','searchprotocolhost.exe','searchfilterhost.exe',
                'microsoftedgeupdate.exe','googlecrashhandler.exe','googlecrashhandler64.exe',
                'unsecapp.exe','wudfhost.exe','igfxcuiservice.exe','igfxem.exe',
                'memory compression','csrss','lsaiso.exe','lsm.exe','wininit',
                'searchhost.exe','startmenuexperiencehost.exe','textinputhost.exe',
                'shellexperiencehost.exe','phoneexperiencehost.exe','gameinputsvc.exe',
                'securityhealthsystray.exe','systemsettingsbroker.exe','msedgewebview2.exe',
                'widgetservice.exe','widgets.exe','lockapp.exe','rundll32.exe',
                'compattelrunner.exe','mpcmdrun.exe','nissrv.exe','msmpeng.exe',
                'backgroundtaskhost.exe','tasklist.exe','wmic.exe']);
            let apps = [];
            if (pData?.processes) {
                const grouped = new Map();
                pData.processes.forEach(p => {
                    const name = (p.Name || '').toLowerCase();
                    if (!name || sysProcs.has(name)) return;
                    if (!grouped.has(name)) grouped.set(name, { Name: p.Name, Memory: '0', Title: p.Name, Id: p.Id, count: 0 });
                    const g = grouped.get(name);
                    g.Memory = String((parseInt(g.Memory) || 0) + (parseInt(p.Memory) || 0));
                    g.count++;
                });
                apps = [...grouped.values()];
            }

            if (!apps || apps.length === 0) {
                countEl.textContent = '0';
                const empty = document.createElement('p');
                empty.className = 'text-xs text-gray-400 py-4 text-center';
                empty.textContent = '실행 중인 앱 없음';
                procList.appendChild(empty);
                return;
            }

            const sorted = apps.sort((a, b) => (parseInt(b.Memory) || 0) - (parseInt(a.Memory) || 0));
            countEl.textContent = sorted.length;
            this._procViewRows = [];

            sorted.forEach(app => {
                const row = document.createElement('div');
                row.className = 'flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50';

                const left = document.createElement('div');
                left.className = 'flex flex-col min-w-0 flex-1 mr-3';
                const titleEl = document.createElement('span');
                titleEl.className = 'text-sm text-gray-800 truncate font-medium';
                titleEl.textContent = app.Title || app.Name;
                titleEl.title = app.Title || app.Name;
                const nameEl = document.createElement('span');
                nameEl.className = 'text-xs text-gray-400 truncate';
                nameEl.textContent = app.Name + (app.count > 1 ? ' (' + app.count + ')' : '');
                left.appendChild(titleEl);
                left.appendChild(nameEl);

                const right = document.createElement('div');
                right.className = 'flex items-center gap-3 shrink-0';
                const memEl = document.createElement('span');
                const memMB = Math.round((parseInt(app.Memory) || 0) / 1024);
                memEl.className = 'text-xs ' + (memMB > 500 ? 'text-orange-500 font-semibold' : 'text-gray-400');
                memEl.textContent = memMB > 1024 ? (memMB / 1024).toFixed(1) + ' GB' : memMB + ' MB';

                const killBtn = document.createElement('button');
                killBtn.className = 'text-gray-300 hover:text-red-500 transition p-1';
                killBtn.title = app.Name + ' 종료';
                killBtn.innerHTML = svgIcon('x', 14);
                killBtn.onclick = async () => {
                    await this.apiFetch('/api/pcs/' + encodeURIComponent(pcName) + '/command', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ command: 'kill-process', params: { processName: app.Name.endsWith('.exe') ? app.Name : app.Name + '.exe' } }),
                    });
                    row.style.opacity = '0.3';
                    row.style.transition = 'opacity 0.3s';
                };

                right.appendChild(memEl);
                right.appendChild(killBtn);
                row.appendChild(left);
                row.appendChild(right);
                procList.appendChild(row);
                this._procViewRows.push({ el: row, name: (app.Title + ' ' + app.Name).toLowerCase() });
            });
        };

        refreshBtn.onclick = () => loadApps();
        filterInput.oninput = () => {
            const q = filterInput.value.toLowerCase();
            if (this._procViewRows) {
                this._procViewRows.forEach(({ el, name }) => {
                    el.style.display = name.includes(q) ? '' : 'none';
                });
            }
        };

        await loadApps();
    }

    // ── Program Blocking (per-PC, from live process list) ───
    async openBlockProgramModal(pcName, label) {
        const modal = document.getElementById('block-prog-modal');
        const target = document.getElementById('block-prog-target');
        const procList = document.getElementById('block-prog-procs');
        const blockedList = document.getElementById('block-prog-blocked');
        const refreshBtn = document.getElementById('block-prog-refresh');
        const closeBtn = document.getElementById('block-prog-close');
        const filterInput = document.getElementById('block-prog-filter');
        const manualInput = document.getElementById('block-prog-manual');
        const manualAdd = document.getElementById('block-prog-manual-add');

        modal.setAttribute('data-pc', pcName);
        target.textContent = label || pcName;
        modal.classList.remove('hidden');
        filterInput.value = '';
        if (manualInput) manualInput.value = '';

        closeBtn.onclick = () => modal.classList.add('hidden');
        modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
        refreshBtn.onclick = () => this.loadProcesses(pcName);
        filterInput.oninput = () => this.filterProcesses();

        // Manual block: type program names directly (comma-separated)
        const doManualBlock = async () => {
            if (!manualInput) return;
            const raw = manualInput.value.trim();
            if (!raw) return;
            const names = raw.split(/[,\s]+/).filter(Boolean);
            for (const name of names) {
                await this.apiFetch('/api/pcs/' + encodeURIComponent(pcName) + '/block-program', {
                    method: 'POST',
                    body: JSON.stringify({ programName: name, blocked: true })
                });
                this._blockedSet.add(name.toLowerCase());
            }
            manualInput.value = '';
            await this.loadBlockedAndProcesses(pcName);
        };
        if (manualAdd) manualAdd.onclick = doManualBlock;
        if (manualInput) manualInput.onkeydown = (e) => { if (e.key === 'Enter') doManualBlock(); };

        await this.loadBlockedAndProcesses(pcName);
    }

    updateBlockedCount() {
        const countEl = document.getElementById('block-prog-count');
        if (!countEl) return;
        const n = this._blockedSet ? this._blockedSet.size : 0;
        if (n > 0) {
            countEl.textContent = n + '개 차단';
            countEl.classList.remove('hidden');
        } else {
            countEl.classList.add('hidden');
        }
    }

    async loadBlockedAndProcesses(pcName) {
        // Load blocked list first
        const blockedList = document.getElementById('block-prog-blocked');
        blockedList.replaceChildren();
        const blockedData = await this.apiFetch('/api/pcs/' + encodeURIComponent(pcName) + '/blocked-programs');
        this._blockedSet = new Set();
        if (blockedData && blockedData.blockedPrograms) {
            blockedData.blockedPrograms.forEach(prog => {
                this._blockedSet.add(prog.toLowerCase());
                blockedList.appendChild(this.createBlockedRow(pcName, prog));
            });
        }
        this.updateBlockedCount();
        // Then load processes
        await this.loadProcesses(pcName);
    }

    async loadProcesses(pcName) {
        const procList = document.getElementById('block-prog-procs');
        procList.replaceChildren();
        const loading = document.createElement('p');
        loading.className = 'text-xs text-gray-400 py-2 text-center';
        loading.textContent = '프로세스 불러오는 중...';
        procList.appendChild(loading);

        const data = await this.apiFetch('/api/pcs/' + encodeURIComponent(pcName) + '/processes');
        procList.replaceChildren();

        if (!data || !data.processes || data.processes.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'text-xs text-gray-400 py-2 text-center';
            empty.textContent = '프로세스 없음 또는 시간 초과';
            procList.appendChild(empty);
            return;
        }

        // Deduplicate by name, sum memory, skip system
        const systemProcs = new Set(['system', 'idle', 'registry', 'smss.exe', 'csrss.exe',
            'wininit.exe', 'services.exe', 'lsass.exe', 'svchost.exe', 'dwm.exe',
            'fontdrvhost.exe', 'winlogon.exe', 'sihost.exe', 'taskhostw.exe',
            'ctfmon.exe', 'conhost.exe', 'runtimebroker.exe', 'searchhost.exe',
            'startmenuexperiencehost.exe', 'textinputhost.exe', 'shellexperiencehost.exe',
            'dllhost.exe', 'smartscreen.exe', 'securityhealthservice.exe',
            'sgrmbroker.exe', 'spoolsv.exe', 'dashost.exe', 'msdtc.exe',
            'wlanext.exe', 'node.exe', 'pcagent']);
        const grouped = new Map();
        data.processes.forEach(p => {
            const name = (p.Name || '').toLowerCase();
            if (systemProcs.has(name) || name.startsWith('system')) return;
            if (!grouped.has(name)) grouped.set(name, { name: p.Name, count: 0, mem: 0 });
            const g = grouped.get(name);
            g.count++;
            g.mem += parseInt(p.Memory) || 0;
        });

        // Sort by memory desc
        const sorted = [...grouped.values()].sort((a, b) => b.mem - a.mem);
        this._processRows = [];
        sorted.forEach(proc => {
            const row = this.createProcessRow(pcName, proc);
            this._processRows.push({ el: row, name: proc.name.toLowerCase() });
            procList.appendChild(row);
        });
    }

    createProcessRow(pcName, proc) {
        const isBlocked = this._blockedSet && this._blockedSet.has(proc.name.toLowerCase());
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between py-1.5 px-3 rounded-lg hover:bg-gray-50';
        row.setAttribute('data-proc', proc.name.toLowerCase());

        const left = document.createElement('div');
        left.className = 'flex-1 min-w-0';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'text-sm text-gray-700 block truncate';
        nameSpan.textContent = proc.name;
        const meta = document.createElement('span');
        meta.className = 'text-xs text-gray-400';
        const memMB = (proc.mem / 1024).toFixed(1);
        meta.textContent = (proc.count > 1 ? proc.count + 'x / ' : '') + memMB + ' MB';
        left.appendChild(nameSpan);
        left.appendChild(meta);

        const btn = document.createElement('button');
        const setBlockState = (blocked) => {
            if (blocked) {
                btn.className = 'text-xs px-3 py-1 rounded-full bg-red-100 text-red-600';
                btn.textContent = '차단됨';
            } else {
                btn.className = 'text-xs px-3 py-1 rounded-full bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600';
                btn.textContent = '차단';
            }
        };
        setBlockState(isBlocked);
        btn.onclick = async (e) => {
            e.stopPropagation();
            const currentlyBlocked = this._blockedSet && this._blockedSet.has(proc.name.toLowerCase());
            await this.apiFetch('/api/pcs/' + encodeURIComponent(pcName) + '/block-program', {
                method: 'POST',
                body: JSON.stringify({ programName: proc.name, blocked: !currentlyBlocked })
            });
            if (currentlyBlocked) {
                this._blockedSet.delete(proc.name.toLowerCase());
            } else {
                this._blockedSet.add(proc.name.toLowerCase());
            }
            setBlockState(!currentlyBlocked);
            this.refreshBlockedList(pcName);
        };

        row.appendChild(left);
        row.appendChild(btn);
        return row;
    }

    createBlockedRow(pcName, prog) {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between py-1.5 px-3 bg-red-50 rounded-lg';
        row.setAttribute('data-blocked', prog.toLowerCase());
        const label = document.createElement('span');
        label.className = 'text-sm text-red-700';
        label.textContent = prog;
        const del = document.createElement('button');
        del.className = 'text-xs text-red-400 hover:text-red-600';
        del.textContent = '해제';
        del.onclick = async () => {
            await this.apiFetch('/api/pcs/' + encodeURIComponent(pcName) + '/block-program', {
                method: 'POST',
                body: JSON.stringify({ programName: prog, blocked: false })
            });
            this._blockedSet.delete(prog.toLowerCase());
            row.remove();
            this.updateBlockedCount();
        };
        row.appendChild(label);
        row.appendChild(del);
        return row;
    }

    refreshBlockedList(pcName) {
        const blockedList = document.getElementById('block-prog-blocked');
        blockedList.replaceChildren();
        if (this._blockedSet) {
            this._blockedSet.forEach(prog => {
                blockedList.appendChild(this.createBlockedRow(pcName, prog));
            });
        }
        this.updateBlockedCount();
    }

    filterProcesses() {
        const q = (document.getElementById('block-prog-filter').value || '').toLowerCase();
        if (!this._processRows) return;
        this._processRows.forEach(({ el, name }) => {
            el.style.display = name.includes(q) ? '' : 'none';
        });
    }

    renamePC(pcName, currentName, nameEl) {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentName;
        input.className = 'text-sm font-semibold border rounded px-2 py-1 w-full focus:outline-none focus:ring-2 focus:ring-blue-500';
        input.maxLength = 50;

        const save = async () => {
            const newName = input.value.trim();
            input.replaceWith(nameEl);
            if (newName === currentName) return;

            const res = await this.apiFetch('/api/pcs/' + encodeURIComponent(pcName) + '/rename', {
                method: 'PATCH',
                body: JSON.stringify({ displayName: newName })
            });
            if (res && res.success) {
                const pc = this.pcs.get(pcName);
                if (pc) pc.display_name = newName || null;
                this.render();
            }
        };

        input.onblur = save;
        input.onkeydown = (e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') input.replaceWith(nameEl);
        };

        nameEl.replaceWith(input);
        input.focus();
        input.select();
    }

    pickAndSendFile(pcName, label) {
        const input = document.createElement('input');
        input.type = 'file';
        input.onchange = () => {
            if (input.files && input.files[0]) {
                this.sendFile(pcName, label, input.files[0]);
            }
        };
        input.click();
    }

    async sendFile(pcName, label, file) {
        const modal = document.getElementById('file-modal');
        const targetEl = document.getElementById('file-target');
        const nameEl = document.getElementById('file-name');
        const progressEl = document.getElementById('file-progress');
        const statusEl = document.getElementById('file-status');

        targetEl.textContent = '받는 PC: ' + label;
        nameEl.textContent = file.name + ' (' + (file.size / 1024 / 1024).toFixed(1) + 'MB)';
        progressEl.style.width = '0%';
        statusEl.textContent = '업로드 중...';
        modal.classList.remove('hidden');

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('/api/pcs/' + encodeURIComponent(pcName) + '/send-file', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + this.token },
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                const transferId = data.transferId;
                const onProgress = (d) => {
                    if (d.transferId !== transferId) return;
                    const pct = Math.round((d.chunkIndex / d.totalChunks) * 100);
                    progressEl.style.width = pct + '%';
                    statusEl.textContent = '전송 중... ' + pct + '%';
                };
                const onComplete = (d) => {
                    if (d.transferId !== transferId) return;
                    progressEl.style.width = '100%';
                    statusEl.textContent = '완료! 저장 위치: ' + d.savedPath;
                    this.socket.off('file-transfer-progress', onProgress);
                    this.socket.off('file-transfer-complete', onComplete);
                    setTimeout(() => modal.classList.add('hidden'), 2000);
                };
                this.socket.on('file-transfer-progress', onProgress);
                this.socket.on('file-transfer-complete', onComplete);
            } else {
                statusEl.textContent = '실패: ' + (data.error || '알 수 없는 오류');
                setTimeout(() => modal.classList.add('hidden'), 3000);
            }
        } catch (err) {
            statusEl.textContent = '업로드 실패: ' + err.message;
            setTimeout(() => modal.classList.add('hidden'), 3000);
        }
    }

    // ── CCTV Mode (multi-PC live view) ───
    openCCTV() {
        const modal = document.getElementById('cctv-modal');
        const grid = document.getElementById('cctv-grid');
        const countEl = document.getElementById('cctv-count');
        const closeBtn = document.getElementById('cctv-close');

        const onlinePCs = Array.from(this.pcs.values()).filter(p => p.status === 'online');
        const count = onlinePCs.length;
        if (count === 0) return;

        const cols = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : count <= 16 ? 4 : 5;
        grid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
        grid.replaceChildren();
        countEl.textContent = count + '대';

        this._cctvCanvases = new Map();

        onlinePCs.forEach(pc => {
            const name = pc.pc_name;
            const label = pc.display_name || name;

            const cell = document.createElement('div');
            cell.className = 'relative bg-black rounded overflow-hidden cursor-pointer';

            const canvas = document.createElement('canvas');
            canvas.className = 'w-full h-full';
            canvas.style.objectFit = 'contain';
            canvas.width = 320;
            canvas.height = 180;

            const labelEl = document.createElement('div');
            labelEl.className = 'absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs px-2 py-1 flex justify-between';
            const nameSpan = document.createElement('span');
            nameSpan.textContent = label;
            const ipSpan = document.createElement('span');
            ipSpan.className = 'text-gray-400';
            ipSpan.textContent = pc.ip_address || '';
            labelEl.appendChild(nameSpan);
            labelEl.appendChild(ipSpan);

            cell.onclick = () => { this.closeCCTV(); this.openLiveView(name, label); };

            cell.appendChild(canvas);
            cell.appendChild(labelEl);
            grid.appendChild(cell);
            this._cctvCanvases.set(name, canvas);
        });

        // Reuse Image objects per PC to avoid GC pressure
        this._cctvImages = new Map();
        this._cctvFrameHandler = (data) => {
            const pcName = data.p || data.pcName;
            const canvas = this._cctvCanvases ? this._cctvCanvases.get(pcName) : null;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            let img = this._cctvImages.get(pcName);
            if (!img) {
                img = new Image();
                img._busy = false;
                img.onload = () => {
                    img._busy = false;
                    if (img._blobUrl) { URL.revokeObjectURL(img._blobUrl); img._blobUrl = null; }
                    if (canvas.width !== img.width || canvas.height !== img.height) {
                        canvas.width = img.width;
                        canvas.height = img.height;
                    }
                    ctx.drawImage(img, 0, 0);
                };
                img.onerror = () => {
                    img._busy = false;
                    if (img._blobUrl) { URL.revokeObjectURL(img._blobUrl); img._blobUrl = null; }
                };
                this._cctvImages.set(pcName, img);
            }
            if (img._busy) return;
            img._busy = true;
            // Binary or base64
            const frameData = data.f || data.frame;
            if (frameData instanceof ArrayBuffer || (frameData && frameData.buffer instanceof ArrayBuffer)) {
                const blob = new Blob([new Uint8Array(frameData)], { type: 'image/jpeg' });
                img._blobUrl = URL.createObjectURL(blob);
                img.src = img._blobUrl;
            } else if (typeof frameData === 'string') {
                img.src = 'data:image/jpeg;base64,' + frameData;
            } else {
                img._busy = false;
            }
        };
        this.socket.on('cctv-frame', this._cctvFrameHandler);
        // CCTV mode — low quality for many simultaneous streams
        this.socket.emit('start-cctv-request', { fps: 3, quality: 50 });

        closeBtn.onclick = () => this.closeCCTV();
        this._cctvEscHandler = (e) => { if (e.key === 'Escape') this.closeCCTV(); };
        document.addEventListener('keydown', this._cctvEscHandler);

        modal.classList.remove('hidden');
    }

    closeCCTV() {
        const modal = document.getElementById('cctv-modal');
        modal.classList.add('hidden');
        if (this._cctvFrameHandler) {
            this.socket.off('cctv-frame', this._cctvFrameHandler);
            this._cctvFrameHandler = null;
        }
        if (this._cctvEscHandler) {
            document.removeEventListener('keydown', this._cctvEscHandler);
            this._cctvEscHandler = null;
        }
        this.socket.emit('stop-cctv-request');
        this._cctvCanvases = null;
        if (this._cctvImages) {
            this._cctvImages.forEach(img => { img.src = ''; });
            this._cctvImages = null;
        }
    }

    // Change password modal
    openChangePassword() {
        const modal = document.getElementById('pw-modal');
        const curInput = document.getElementById('pw-current');
        const newInput = document.getElementById('pw-new');
        const confirmInput = document.getElementById('pw-confirm');
        const errorEl = document.getElementById('pw-error');
        modal.classList.remove('hidden');
        curInput.value = ''; newInput.value = ''; confirmInput.value = '';
        errorEl.classList.add('hidden');
        curInput.focus();
        document.getElementById('pw-cancel').onclick = () => modal.classList.add('hidden');
        modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
        document.getElementById('pw-save').onclick = async () => {
            errorEl.classList.add('hidden');
            if (newInput.value !== confirmInput.value) {
                errorEl.textContent = '새 비밀번호가 일치하지 않습니다'; errorEl.classList.remove('hidden'); return;
            }
            if (newInput.value.length < 4) {
                errorEl.textContent = '4자 이상 입력하세요'; errorEl.classList.remove('hidden'); return;
            }
            const res = await this.apiFetch('/api/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({ currentPassword: curInput.value, newPassword: newInput.value })
            });
            if (res && (res.success || (res.data && res.data.message))) {
                modal.classList.add('hidden');
                this.showToast('비밀번호 변경 완료', 'green');
            } else {
                errorEl.textContent = (res && res.error) || '변경 실패'; errorEl.classList.remove('hidden');
            }
        };
    }

    showToast(message, color = 'gray') {
        const toast = document.createElement('div');
        toast.className = 'fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm text-white transition-all';
        toast.style.background = color === 'red' ? '#ef4444' : color === 'green' ? '#22c55e' : '#6b7280';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
    }

    // ── Real-time activity feed ──────────────────
    initActivityFeed() {
        const btn = document.getElementById('activity-feed-btn');
        const panel = document.getElementById('activity-feed-panel');
        const closeBtn = document.getElementById('activity-close-btn');
        const clearBtn = document.getElementById('activity-clear-btn');
        if (!btn || !panel) return;

        btn.onclick = () => {
            panel.classList.toggle('hidden');
            if (!panel.classList.contains('hidden')) {
                this._unreadActivity = 0;
                this._updateActivityBadge();
            }
        };
        if (closeBtn) closeBtn.onclick = () => panel.classList.add('hidden');
        if (clearBtn) {
            clearBtn.onclick = () => {
                this._activityLog = [];
                this._unreadActivity = 0;
                this._renderActivityFeed();
                this._updateActivityBadge();
            };
        }
    }

    pushActivity(entry) {
        const pc = this.pcs.get(entry.pc_name);
        const label = (pc && (pc.display_name || pc.pc_name)) || entry.pc_name || '?';
        const item = {
            pc: label,
            type: entry.activity_type || 'event',
            details: entry.details || '',
            ts: entry.timestamp || new Date().toISOString(),
        };
        this._activityLog = [item, ...(this._activityLog || [])].slice(0, 200);
        const panel = document.getElementById('activity-feed-panel');
        if (panel && panel.classList.contains('hidden')) {
            this._unreadActivity = (this._unreadActivity || 0) + 1;
            this._updateActivityBadge();
        }
        this._renderActivityFeed();
    }

    _updateActivityBadge() {
        const badge = document.getElementById('activity-badge');
        if (!badge) return;
        if (this._unreadActivity > 0) {
            badge.textContent = this._unreadActivity > 99 ? '99+' : String(this._unreadActivity);
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    _renderActivityFeed() {
        const list = document.getElementById('activity-feed-list');
        if (!list) return;
        if (!this._activityLog || this._activityLog.length === 0) {
            list.innerHTML = '<p class="text-gray-300 text-center py-8">활동 로그 없음</p>';
            return;
        }
        const colors = {
            login: 'text-green-600',
            logout: 'text-gray-500',
            command: 'text-blue-600',
            'message-delivery': 'text-purple-600',
            'block-violation': 'text-red-600',
            app_open: 'text-teal-600',
            web_visit: 'text-orange-600',
        };
        list.replaceChildren();
        this._activityLog.forEach(item => {
            const row = document.createElement('div');
            row.className = 'flex items-start gap-2 py-1.5 px-2 rounded hover:bg-gray-50';
            const time = document.createElement('span');
            time.className = 'text-[10px] text-gray-400 font-mono shrink-0 w-12';
            const t = new Date(item.ts);
            time.textContent = t.toTimeString().slice(0, 8).slice(0, 5);
            const body = document.createElement('div');
            body.className = 'flex-1 min-w-0';
            const top = document.createElement('div');
            top.className = 'flex items-center gap-1 text-[11px]';
            const pc = document.createElement('span');
            pc.className = 'font-semibold text-gray-700 truncate';
            pc.textContent = item.pc;
            const type = document.createElement('span');
            type.className = 'text-[9px] px-1.5 py-0.5 rounded ' + (colors[item.type] || 'text-gray-500') + ' bg-gray-100';
            type.textContent = item.type;
            top.appendChild(pc);
            top.appendChild(type);
            const det = document.createElement('div');
            det.className = 'text-[10px] text-gray-500 truncate';
            det.textContent = item.details || '';
            body.appendChild(top);
            if (item.details) body.appendChild(det);
            row.appendChild(time);
            row.appendChild(body);
            list.appendChild(row);
        });
    }

    // ── Health poll (basic + detailed smoke test) ──────────
    startHealthPoll() {
        const poll = async () => {
            try {
                const res = await fetch('/api/health', { headers: this.token ? { Authorization: 'Bearer ' + this.token } : {} });
                if (!res.ok) return;
                const data = await res.json();
                const uptimeEl = document.getElementById('system-uptime');
                const agentsEl = document.getElementById('system-agents');
                if (uptimeEl && data.uptime) uptimeEl.textContent = 'v' + (data.version || '?') + ' · ' + data.uptime;
                if (agentsEl) {
                    const online = Array.from(this.pcs.values()).filter(p => p.status === 'online').length;
                    agentsEl.textContent = '에이전트 ' + online + '대 접속';
                }
            } catch (e) { /* ignore */ }

            // Detailed subsystem check (every 2nd poll = 30s)
            this._detailedPollCounter = (this._detailedPollCounter || 0) + 1;
            if (this._detailedPollCounter % 2 === 0) {
                try {
                    const res = await this.apiFetch('/api/health/detailed');
                    if (res && (res.data || res.subsystems)) {
                        const d = res.data || res;
                        this._renderHealthDot(d.subsystems || {});
                    }
                } catch (e) { /* ignore */ }
            }
        };
        poll();
        if (this._healthInterval) clearInterval(this._healthInterval);
        this._healthInterval = setInterval(poll, 15000);
    }

    _renderHealthDot(subsystems) {
        let dot = document.getElementById('health-dot');
        if (!dot) {
            const uptimeEl = document.getElementById('system-uptime');
            if (!uptimeEl) return;
            dot = document.createElement('span');
            dot.id = 'health-dot';
            dot.className = 'inline-block w-2 h-2 rounded-full ml-2';
            dot.style.cursor = 'help';
            uptimeEl.parentNode.insertBefore(dot, uptimeEl);
        }
        const failures = Object.entries(subsystems).filter(([, v]) => !v.ok);
        if (failures.length === 0) {
            dot.style.background = '#22c55e';
            dot.title = '모든 서브시스템 정상';
        } else {
            dot.style.background = '#ef4444';
            dot.title = '장애: ' + failures.map(([k, v]) => `${k}: ${v.error || '?'}`).join(' | ');
        }
    }
}

const app = new PCManager();

// PWA: register service worker for offline shell + add-to-home-screen
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js').catch(err => {
            console.warn('SW registration failed:', err.message);
        });
    });
}
