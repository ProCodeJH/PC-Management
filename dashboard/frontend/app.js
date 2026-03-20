// PC Manager — Minimal Dashboard
// Only: login, PC list, real-time status

class PCManager {
    constructor() {
        this.token = localStorage.getItem('token');
        this.socket = null;
        this.pcs = new Map();

        if (this.token) {
            this.showDashboard();
        } else {
            this.showLogin();
        }
    }

    // ── Util ─────────────────────────────────
    esc(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    // ── Auth ──────────────────────────────────
    showLogin() {
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('dashboard').classList.add('hidden');

        document.getElementById('login-btn').onclick = () => this.login();
        document.getElementById('login-pass').onkeydown = (e) => {
            if (e.key === 'Enter') this.login();
        };
    }

    async login() {
        const user = document.getElementById('login-user').value;
        const pass = document.getElementById('login-pass').value;
        const errEl = document.getElementById('login-error');
        errEl.classList.add('hidden');

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: user, password: pass })
            });
            const data = await res.json();

            if (data.success && data.token) {
                this.token = data.token;
                localStorage.setItem('token', data.token);
                this.showDashboard();
            } else {
                errEl.textContent = data.error || 'Login failed';
                errEl.classList.remove('hidden');
            }
        } catch (e) {
            errEl.textContent = 'Server unreachable';
            errEl.classList.remove('hidden');
        }
    }

    logout() {
        localStorage.removeItem('token');
        this.token = null;
        if (this.socket) this.socket.disconnect();
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('dashboard').classList.add('hidden');
    }

    // ── Dashboard ────────────────────────────
    showDashboard() {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('dashboard').classList.remove('hidden');
        document.getElementById('logout-btn').onclick = () => this.logout();

        this.connectSocket();
        this.loadPCs();
    }

    async apiFetch(url) {
        const res = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + this.token }
        });
        if (res.status === 401 || res.status === 403) {
            this.logout();
            return null;
        }
        return res.json();
    }

    async loadPCs() {
        const data = await this.apiFetch('/api/pcs');
        if (!data) return;

        const list = Array.isArray(data) ? data : (data.data || []);
        list.forEach(pc => this.pcs.set(pc.pc_name, pc));
        this.render();
    }

    // ── Socket.IO ────────────────────────────
    connectSocket() {
        this.socket = io({ auth: { token: this.token } });

        this.socket.on('connect', () => {
            document.getElementById('header-status').textContent = 'Connected';
            document.getElementById('header-status').className = 'text-sm text-green-500';
        });

        this.socket.on('disconnect', () => {
            document.getElementById('header-status').textContent = 'Disconnected';
            document.getElementById('header-status').className = 'text-sm text-gray-500';
        });

        this.socket.on('pc-updated', (data) => {
            const existing = this.pcs.get(data.pcName) || {};
            this.pcs.set(data.pcName, { ...existing, ...data, pc_name: data.pcName });
            this.render();
        });

        this.socket.on('pcs-status-changed', () => this.loadPCs());
    }

    // ── Render ────────────────────────────────
    render() {
        const grid = document.getElementById('pc-grid');
        const empty = document.getElementById('empty-state');
        const pcs = Array.from(this.pcs.values());

        // Stats
        const online = pcs.filter(p => p.status === 'online');
        const offline = pcs.filter(p => p.status !== 'online');
        document.getElementById('stat-total').textContent = pcs.length + ' PCs';
        document.getElementById('stat-online').textContent = online.length + ' online';
        document.getElementById('stat-offline').textContent = offline.length + ' offline';

        if (pcs.length === 0) {
            grid.classList.add('hidden');
            empty.classList.remove('hidden');
            return;
        }

        grid.classList.remove('hidden');
        empty.classList.add('hidden');

        // Sort: online first, then by name
        pcs.sort((a, b) => {
            if (a.status === 'online' && b.status !== 'online') return -1;
            if (a.status !== 'online' && b.status === 'online') return 1;
            return (a.pc_name || '').localeCompare(b.pc_name || '');
        });

        // Build DOM safely (no innerHTML with user data)
        grid.replaceChildren();
        pcs.forEach(pc => grid.appendChild(this.createCard(pc)));
    }

    createCard(pc) {
        const isOnline = pc.status === 'online';
        const cpu = Math.round(pc.cpuUsage || pc.cpu_usage || 0);
        const mem = Math.round(pc.memoryUsage || pc.memory_usage || 0);
        const ip = pc.ipAddress || pc.ip_address || '-';
        const name = pc.pcName || pc.pc_name || 'Unknown';

        const card = document.createElement('div');
        card.className = 'pc-card bg-white rounded-xl p-5 border fade-in ' +
            (isOnline ? 'border-green-200' : 'border-gray-200');

        // Header row
        const header = document.createElement('div');
        header.className = 'flex items-center justify-between mb-4';

        const left = document.createElement('div');
        left.className = 'flex items-center gap-3';

        const dot = document.createElement('div');
        dot.className = 'status-dot ' + (isOnline ? 'status-online' : 'status-offline');

        const info = document.createElement('div');
        const nameEl = document.createElement('p');
        nameEl.className = 'font-semibold text-sm text-gray-800';
        nameEl.textContent = name;
        const ipEl = document.createElement('p');
        ipEl.className = 'text-xs text-gray-400';
        ipEl.textContent = ip;
        info.appendChild(nameEl);
        info.appendChild(ipEl);

        left.appendChild(dot);
        left.appendChild(info);

        const badge = document.createElement('span');
        badge.className = 'text-xs px-2 py-1 rounded-full ' +
            (isOnline ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400');
        badge.textContent = isOnline ? 'Online' : 'Offline';

        header.appendChild(left);
        header.appendChild(badge);
        card.appendChild(header);

        if (isOnline) {
            card.appendChild(this.createBar('CPU', cpu, cpu > 80 ? '#ef4444' : cpu > 50 ? '#f59e0b' : '#3b82f6'));
            card.appendChild(this.createBar('Memory', mem, mem > 80 ? '#ef4444' : mem > 50 ? '#f59e0b' : '#22c55e'));
        } else {
            const lastSeen = document.createElement('p');
            lastSeen.className = 'text-xs text-gray-300 mt-2';
            lastSeen.textContent = 'Last seen: ' + (pc.last_seen || '-');
            card.appendChild(lastSeen);
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
}

const app = new PCManager();
