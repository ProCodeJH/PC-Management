// ========================================
// Enterprise PC Management - Dashboard App
// Real-time PC Monitoring & Control
// Security Enhanced + Premium Theme v4.0
// ========================================

class EnterpriseDashboard {
    constructor() {
        this.socket = null;
        this.pcs = new Map();
        this.activities = [];
        this.chart = null;
        this.selectedPC = null;
        this.liveViewPC = null;
        this.liveViewFrameCount = 0;
        this.liveViewLastFpsUpdate = 0;
        this.liveViewBytesReceived = 0;
        this.liveViewLastBwUpdate = 0;
        this.currentTheme = localStorage.getItem('theme') || 'light';
        this.authToken = localStorage.getItem('authToken') || null;

        // v4.0 New Features
        this.commandHistory = [];
        this.sparklineData = new Map(); // pcName -> {cpu: [], mem: []}
        this.serverStartTime = Date.now();
        this.commandPaletteOpen = false;
        this.selectedCommandIndex = -1;

        this.init();
    }

    init() {
        this.initTheme();
        this.initSocket();
        this.initChart();
        this.bindEvents();
        this.loadInitialData();
        this.startAutoRefresh();
    }

    // ========================================
    // Theme System
    // ========================================
    initTheme() {
        // Apply saved theme
        this.applyTheme(this.currentTheme);

        // Listen for system preference changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (!localStorage.getItem('theme')) {
                this.applyTheme(e.matches ? 'dark' : 'light');
            }
        });
    }

    applyTheme(theme) {
        this.currentTheme = theme;
        document.documentElement.setAttribute('data-theme', theme);

        // Update icon visibility
        const darkIcon = document.querySelector('.theme-icon-dark');
        const lightIcon = document.querySelector('.theme-icon-light');

        if (darkIcon && lightIcon) {
            if (theme === 'dark') {
                darkIcon.style.display = 'block';
                lightIcon.style.display = 'none';
            } else {
                darkIcon.style.display = 'none';
                lightIcon.style.display = 'block';
            }
        }

        localStorage.setItem('theme', theme);
    }

    toggleTheme() {
        const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
        this.applyTheme(newTheme);
        this.showToast('테마 변경', `${newTheme === 'dark' ? '다크' : '라이트'} 모드로 전환되었습니다`, 'info');
    }

    // ========================================
    // WebSocket Connection
    // ========================================
    initSocket() {
        const wsUrl = window.location.origin;
        this.socket = io(wsUrl);

        this.socket.on('connect', () => {
            console.log('✅ Connected to server');
            this.showToast('연결됨', '서버에 연결되었습니다', 'success');
            this.updateConnectionStatus(true);
        });

        this.socket.on('disconnect', () => {
            console.log('❌ Disconnected from server');
            this.showToast('연결 끊김', '서버 연결이 끊어졌습니다', 'error');
            this.updateConnectionStatus(false);
        });

        this.socket.on('pc-updated', (data) => {
            this.handlePCUpdate(data);
        });

        this.socket.on('new-activity', (data) => {
            this.handleNewActivity(data);
        });

        this.socket.on('screenshot-received', (data) => {
            this.showToast('📸 스크린샷', `${data.pcName}의 스크린샷이 도착했습니다`, 'success');
            this.latestScreenshots = this.latestScreenshots || [];
            this.latestScreenshots.unshift({
                pcName: data.pcName,
                filename: data.filename,
                time: new Date().toLocaleTimeString('ko-KR')
            });
            if (this.latestScreenshots.length > 20) this.latestScreenshots.pop();
        });

        this.socket.on('pcs-status-changed', () => {
            this.loadPCs();
            this.loadStats();
        });

        this.socket.on('screen-frame', (data) => {
            if (this.liveViewPC && data.pcName === this.liveViewPC) {
                this.renderFrame(data);
            }
        });
    }

    updateConnectionStatus(connected) {
        const statusDot = document.querySelector('.status-dot');
        const statusText = document.querySelector('.system-status span');

        if (connected) {
            statusDot.classList.add('online');
            statusText.textContent = '시스템 정상';
        } else {
            statusDot.classList.remove('online');
            statusText.textContent = '연결 끊김';
        }
    }

    // ========================================
    // Data Loading
    // ========================================
    async loadInitialData() {
        try {
            await Promise.all([
                this.loadPCs(),
                this.loadStats(),
                this.loadActivities()
            ]);
        } catch (error) {
            console.error('Failed to load initial data:', error);
            this.showToast('오류', '데이터 로드에 실패했습니다', 'error');
        }
    }

    async loadPCs() {
        try {
            const response = await fetch('/api/pcs');
            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }
            const pcs = await response.json();

            this.pcs.clear();
            if (Array.isArray(pcs)) {
                pcs.forEach(pc => {
                    this.pcs.set(pc.pc_name, pc);
                });
            }

            this.renderPCGrid();
        } catch (error) {
            console.error('Failed to load PCs:', error);
        }
    }

    async loadStats() {
        try {
            const response = await fetch('/api/stats');
            const stats = await response.json();

            document.getElementById('totalPCs').textContent = stats.totalPCs || 0;
            document.getElementById('onlinePCs').textContent = stats.onlinePCs || 0;
            document.getElementById('todayActivities').textContent = stats.todayActivities || 0;
        } catch (error) {
            console.error('Failed to load stats:', error);
        }
    }

    async loadActivities() {
        try {
            const response = await fetch('/api/logs?limit=20');
            this.activities = await response.json();
            this.renderActivities();
        } catch (error) {
            console.error('Failed to load activities:', error);
        }
    }

    // ========================================
    // PC Grid Rendering
    // ========================================
    renderPCGrid() {
        const grid = document.getElementById('pcGrid');

        if (this.pcs.size === 0) {
            grid.innerHTML = `
                <div class="pc-empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="2" y="3" width="20" height="14" rx="2"></rect>
                        <path d="M8 21h8M12 17v4"></path>
                    </svg>
                    <p>연결된 PC가 없습니다</p>
                    <span>PC 에이전트를 실행하면 자동으로 연결됩니다</span>
                </div>
            `;
            return;
        }

        grid.innerHTML = Array.from(this.pcs.values())
            .map(pc => this.createPCCard(pc))
            .join('');

        // Bind click events
        grid.querySelectorAll('.pc-card').forEach(card => {
            card.addEventListener('click', () => {
                const pcName = card.dataset.pcName;
                this.openPCModal(pcName);
            });
        });
    }

    createPCCard(pc) {
        const isOnline = this.isOnline(pc);
        const cpuUsage = pc.cpu_usage || 0;
        const memoryUsage = pc.memory_usage || 0;

        const cpuClass = cpuUsage > 80 ? 'critical' : cpuUsage > 60 ? 'high' : '';
        const memClass = memoryUsage > 80 ? 'critical' : memoryUsage > 60 ? 'high' : '';

        return `
            <div class="pc-card ${isOnline ? 'online' : 'offline'}" data-pc-name="${pc.pc_name}">
                <div class="pc-card-header">
                    <div class="pc-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="2" y="3" width="20" height="14" rx="2"></rect>
                            <path d="M8 21h8M12 17v4"></path>
                        </svg>
                    </div>
                    <div class="pc-status ${isOnline ? 'online' : 'offline'}"></div>
                </div>
                <div class="pc-name">${pc.pc_name}</div>
                <div class="pc-ip">${pc.ip_address || 'N/A'}</div>
                <div class="pc-stats">
                    <div class="pc-stat">
                        <div class="pc-stat-label">CPU</div>
                        <div class="pc-stat-bar">
                            <div class="pc-stat-fill ${cpuClass}" style="width: ${cpuUsage}%"></div>
                        </div>
                    </div>
                    <div class="pc-stat">
                        <div class="pc-stat-label">MEM</div>
                        <div class="pc-stat-bar">
                            <div class="pc-stat-fill memory ${memClass}" style="width: ${memoryUsage}%"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    isOnline(pc) {
        if (pc.status !== 'online') return false;

        const lastSeen = new Date(pc.last_seen);
        const now = new Date();
        const diffMinutes = (now - lastSeen) / (1000 * 60);

        return diffMinutes < 5;
    }

    // ========================================
    // Activity Rendering
    // ========================================
    renderActivities() {
        const list = document.getElementById('activityList');

        if (this.activities.length === 0) {
            list.innerHTML = `
                <div class="activity-empty">
                    <p>최근 활동이 없습니다</p>
                </div>
            `;
            return;
        }

        list.innerHTML = this.activities
            .slice(0, 10)
            .map(activity => this.createActivityItem(activity))
            .join('');
    }

    createActivityItem(activity) {
        const iconClass = this.getActivityIconClass(activity.activity_type);
        const timeAgo = this.formatTimeAgo(activity.timestamp);

        return `
            <div class="activity-item">
                <div class="activity-icon ${iconClass}">
                    ${this.getActivityIcon(activity.activity_type)}
                </div>
                <div class="activity-content">
                    <div class="activity-title">${activity.details || activity.activity_type}</div>
                    <div class="activity-meta">${activity.pc_name} • ${timeAgo}</div>
                </div>
            </div>
        `;
    }

    getActivityIconClass(type) {
        const classes = {
            'login': 'login',
            'logout': 'logout',
            'program': 'program',
            'warning': 'warning'
        };
        return classes[type] || 'program';
    }

    getActivityIcon(type) {
        const icons = {
            'login': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"></path></svg>',
            'logout': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"></path></svg>',
            'program': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9l3 3-3 3M12 15h3"></path></svg>',
            'warning': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>'
        };
        return icons[type] || icons['program'];
    }

    formatTimeAgo(timestamp) {
        const now = new Date();
        const date = new Date(timestamp);
        const diff = (now - date) / 1000;

        if (diff < 60) return '방금 전';
        if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
        return `${Math.floor(diff / 86400)}일 전`;
    }

    // ========================================
    // Chart
    // ========================================
    initChart() {
        const ctx = document.getElementById('usageChart');
        if (!ctx) return;

        const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 250);
        gradient.addColorStop(0, 'rgba(59, 130, 246, 0.3)');
        gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');

        const gradient2 = ctx.getContext('2d').createLinearGradient(0, 0, 0, 250);
        gradient2.addColorStop(0, 'rgba(6, 182, 212, 0.3)');
        gradient2.addColorStop(1, 'rgba(6, 182, 212, 0)');

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00'],
                datasets: [
                    {
                        label: 'CPU 평균',
                        data: [15, 20, 45, 65, 55, 70, 40],
                        borderColor: '#3b82f6',
                        backgroundColor: gradient,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 6,
                        pointHoverBackgroundColor: '#3b82f6',
                        pointHoverBorderColor: '#fff',
                        pointHoverBorderWidth: 2
                    },
                    {
                        label: '메모리 평균',
                        data: [30, 35, 50, 55, 60, 65, 50],
                        borderColor: '#06b6d4',
                        backgroundColor: gradient2,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 6,
                        pointHoverBackgroundColor: '#06b6d4',
                        pointHoverBorderColor: '#fff',
                        pointHoverBorderWidth: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        align: 'end',
                        labels: {
                            color: 'rgba(255, 255, 255, 0.7)',
                            usePointStyle: true,
                            pointStyle: 'circle',
                            padding: 20,
                            font: {
                                size: 12
                            }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(26, 26, 37, 0.95)',
                        titleColor: '#fff',
                        bodyColor: 'rgba(255, 255, 255, 0.7)',
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        borderWidth: 1,
                        padding: 12,
                        cornerRadius: 8,
                        displayColors: true,
                        callbacks: {
                            label: (context) => `${context.dataset.label}: ${context.parsed.y}%`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)',
                            drawBorder: false
                        },
                        ticks: {
                            color: 'rgba(255, 255, 255, 0.4)',
                            font: {
                                size: 11
                            }
                        }
                    },
                    y: {
                        min: 0,
                        max: 100,
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)',
                            drawBorder: false
                        },
                        ticks: {
                            color: 'rgba(255, 255, 255, 0.4)',
                            font: {
                                size: 11
                            },
                            callback: (value) => value + '%'
                        }
                    }
                }
            }
        });
    }

    // ========================================
    // PC Modal
    // ========================================
    openPCModal(pcName) {
        const pc = this.pcs.get(pcName);
        if (!pc) return;

        this.selectedPC = pc;

        document.getElementById('modalPcName').textContent = pc.pc_name;
        document.getElementById('modalIp').textContent = pc.ip_address || 'N/A';
        document.getElementById('modalStatus').textContent = this.isOnline(pc) ? '온라인' : '오프라인';
        document.getElementById('modalLastSeen').textContent = this.formatTimeAgo(pc.last_seen);

        const cpuUsage = pc.cpu_usage || 0;
        const memoryUsage = pc.memory_usage || 0;

        document.getElementById('modalCpu').style.width = cpuUsage + '%';
        document.getElementById('modalCpuValue').textContent = cpuUsage.toFixed(1) + '%';
        document.getElementById('modalMemory').style.width = memoryUsage + '%';
        document.getElementById('modalMemoryValue').textContent = memoryUsage.toFixed(1) + '%';

        // Render command history for this PC
        const historyEl = document.getElementById('modalCommandHistory');
        if (historyEl) {
            historyEl.innerHTML = this.renderCommandHistory(pc.pc_name);
        }

        document.getElementById('pcModalOverlay').classList.add('active');
    }

    closePCModal() {
        document.getElementById('pcModalOverlay').classList.remove('active');
        this.selectedPC = null;
    }

    async sendCommand(command) {
        if (!this.selectedPC) return;

        const pcName = this.selectedPC.pc_name;

        try {
            const response = await fetch(`/api/pcs/${pcName}/command`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ command })
            });

            const result = await response.json();

            if (result.success) {
                this.showToast('명령 전송', `${pcName}에 ${command} 명령을 전송했습니다`, 'success');
                this.trackCommand(pcName, command, 'success');
            } else {
                throw new Error(result.error || '명령 전송 실패');
            }
        } catch (error) {
            console.error('Failed to send command:', error);
            this.showToast('오류', '명령 전송에 실패했습니다', 'error');
            this.trackCommand(this.selectedPC?.pc_name || 'unknown', command, 'error');
        }
    }

    // ========================================
    // Real-time Updates
    // ========================================
    handlePCUpdate(data) {
        const pc = this.pcs.get(data.pcName);
        if (pc) {
            pc.cpu_usage = data.cpuUsage;
            pc.memory_usage = data.memoryUsage;
            pc.status = 'online';
            pc.last_seen = new Date().toISOString();
        } else {
            this.pcs.set(data.pcName, {
                pc_name: data.pcName,
                ip_address: data.ipAddress,
                cpu_usage: data.cpuUsage,
                memory_usage: data.memoryUsage,
                status: 'online',
                last_seen: new Date().toISOString()
            });
        }

        this.renderPCGrid();
        this.loadStats();
        this.updateBulkCount();
        this.updateSidebarStats();

        // Collect sparkline data
        this.updateSparklineData(data.pcName, data.cpuUsage || 0, data.memoryUsage || 0);
    }

    handleNewActivity(data) {
        this.activities.unshift(data);
        this.activities = this.activities.slice(0, 50);
        this.renderActivities();
    }

    // ========================================
    // Toast Notifications
    // ========================================
    showToast(title, message, type = 'info') {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        // Limit to 5 toasts max
        while (container.children.length >= 5) {
            container.firstChild.remove();
        }

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <div class="toast-icon">${this.getToastIcon(type)}</div>
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                <div class="toast-message">${message}</div>
            </div>
            <button class="toast-close" onclick="this.closest('.toast').remove()">&times;</button>
            <div class="toast-progress"></div>
        `;

        container.appendChild(toast);

        // Auto-remove with slide-out animation
        setTimeout(() => {
            toast.classList.add('removing');
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    getToastIcon(type) {
        const icons = {
            success: '<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><path d="M22 4L12 14.01l-3-3"></path></svg>',
            error: '<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
            warning: '<svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
            info: '<svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
        };
        return icons[type] || icons.info;
    }

    // ========================================
    // Remote PC Management Methods (NEW)
    // ========================================

    async loadProcesses() {
        if (!this.selectedPC?.ip_address) {
            this.showToast('오류', 'PC IP 주소가 없습니다', 'error');
            return;
        }

        const processList = document.getElementById('processList');
        processList.innerHTML = '<p class="loading">프로세스 조회 중...</p>';

        try {
            const response = await fetch(`/api/pcs/${this.selectedPC.ip_address}/processes`);
            const data = await response.json();

            if (data.success && data.processes?.length > 0) {
                processList.innerHTML = data.processes
                    .filter(p => p.Name)
                    .slice(0, 30)
                    .map(p => `
                        <div class="process-item">
                            <span class="process-name">${p.Name}</span>
                            <span class="process-cpu">${p.CPU ? p.CPU.toFixed(1) : 0}%</span>
                            <button class="btn-kill" data-process="${p.Name}" data-pid="${p.Id}">종료</button>
                        </div>
                    `).join('');

                // Bind kill buttons
                processList.querySelectorAll('.btn-kill').forEach(btn => {
                    btn.addEventListener('click', () => {
                        this.killProcess(btn.dataset.process, btn.dataset.pid);
                    });
                });
            } else {
                processList.innerHTML = '<p class="process-empty">프로세스를 가져올 수 없습니다</p>';
            }
        } catch (error) {
            processList.innerHTML = '<p class="process-empty">연결 오류</p>';
            this.showToast('오류', '프로세스 조회 실패', 'error');
        }
    }

    async killProcess(processName, processId) {
        if (!this.selectedPC?.ip_address) return;

        if (!confirm(`${processName} 프로세스를 종료하시겠습니까?`)) return;

        try {
            const response = await fetch(`/api/pcs/${this.selectedPC.ip_address}/kill-process`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ processName, processId })
            });

            const data = await response.json();
            if (data.success) {
                this.showToast('성공', `${processName} 종료됨`, 'success');
                this.loadProcesses(); // Refresh list
            } else {
                this.showToast('오류', data.error, 'error');
            }
        } catch (error) {
            this.showToast('오류', '프로세스 종료 실패', 'error');
        }
    }

    async blockProgram(programName) {
        if (!this.selectedPC?.ip_address) return;

        try {
            const response = await fetch(`/api/pcs/${this.selectedPC.ip_address}/block-program`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ programName, blocked: true })
            });

            const data = await response.json();
            if (data.success) {
                this.showToast('성공', `${programName} 실행 차단됨`, 'success');
                document.getElementById('blockProgramInput').value = '';
                this.loadBlockedPrograms();
            } else {
                this.showToast('오류', data.error, 'error');
            }
        } catch (error) {
            this.showToast('오류', '프로그램 차단 실패', 'error');
        }
    }

    async loadBlockedPrograms() {
        if (!this.selectedPC?.ip_address) return;

        const blockedList = document.getElementById('blockedList');

        try {
            const response = await fetch(`/api/pcs/${this.selectedPC.ip_address}/blocked-programs`);
            const data = await response.json();

            if (data.success && data.blockedPrograms?.length > 0) {
                blockedList.innerHTML = data.blockedPrograms.map(prog => `
                    <div class="blocked-item">
                        <span>🚫 ${prog}</span>
                        <button class="btn-unblock" data-program="${prog}">해제</button>
                    </div>
                `).join('');

                blockedList.querySelectorAll('.btn-unblock').forEach(btn => {
                    btn.addEventListener('click', () => this.unblockProgram(btn.dataset.program));
                });
            } else {
                blockedList.innerHTML = '<p class="blocked-empty">차단된 프로그램 없음</p>';
            }
        } catch (error) {
            blockedList.innerHTML = '<p class="blocked-empty">조회 실패</p>';
        }
    }

    async unblockProgram(programName) {
        if (!this.selectedPC?.ip_address) return;

        try {
            const response = await fetch(`/api/pcs/${this.selectedPC.ip_address}/block-program`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ programName, blocked: false })
            });

            const data = await response.json();
            if (data.success) {
                this.showToast('성공', `${programName} 차단 해제됨`, 'success');
                this.loadBlockedPrograms();
            }
        } catch (error) {
            this.showToast('오류', '차단 해제 실패', 'error');
        }
    }

    async sendFile(sourcePath, destPath) {
        if (!this.selectedPC?.ip_address) return;

        this.showToast('전송 중', '파일 전송을 시작합니다...', 'info');

        try {
            const response = await fetch('/api/pcs/send-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetIPs: [this.selectedPC.ip_address],
                    sourcePath,
                    destPath
                })
            });

            const data = await response.json();
            if (data.success) {
                const result = data.results[0];
                if (result.success) {
                    this.showToast('성공', '파일 전송 완료', 'success');
                } else {
                    this.showToast('오류', result.error, 'error');
                }
            } else {
                this.showToast('오류', data.error, 'error');
            }
        } catch (error) {
            this.showToast('오류', '파일 전송 실패', 'error');
        }
    }

    // ========================================
    // Event Bindings
    // ========================================
    bindEvents() {
        // Refresh button
        document.getElementById('refreshBtn')?.addEventListener('click', () => {
            this.loadInitialData();
            this.showToast('새로고침', '데이터를 새로 불러왔습니다', 'info');
        });

        // Search
        document.getElementById('searchInput')?.addEventListener('input', (e) => {
            this.filterPCs(e.target.value);
        });

        // Theme Toggle
        document.getElementById('themeToggle')?.addEventListener('click', () => {
            this.toggleTheme();
        });

        // Modal close
        document.getElementById('modalClose')?.addEventListener('click', () => {
            this.closePCModal();
        });

        document.getElementById('pcModalOverlay')?.addEventListener('click', (e) => {
            if (e.target.id === 'pcModalOverlay') {
                this.closePCModal();
            }
        });

        // Control buttons
        document.querySelectorAll('.btn-control').forEach(btn => {
            btn.addEventListener('click', () => {
                const command = btn.dataset.command;
                if (command) {
                    this.sendCommand(command);
                }
            });
        });

        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
            });
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closePCModal();
                this.closeDeployModal();
            }
        });

        // ========================================
        // New Management Features
        // ========================================

        // Load running processes
        document.getElementById('loadProcessesBtn')?.addEventListener('click', () => {
            this.loadProcesses();
        });

        // Block program
        document.getElementById('blockProgramBtn')?.addEventListener('click', () => {
            const programName = document.getElementById('blockProgramInput')?.value;
            if (programName) {
                this.blockProgram(programName);
            }
        });

        // Send file
        document.getElementById('sendFileBtn')?.addEventListener('click', () => {
            const sourcePath = document.getElementById('sendFilePath')?.value;
            const destPath = document.getElementById('sendFileDestPath')?.value;
            if (sourcePath && destPath) {
                this.sendFile(sourcePath, destPath);
            }
        });

        // ========================================
        // Deploy Modal Events
        // ========================================

        // Open deploy modal
        document.getElementById('addPcBtn')?.addEventListener('click', () => {
            this.openDeployModal();
        });

        // Close deploy modal
        document.getElementById('deployModalClose')?.addEventListener('click', () => {
            this.closeDeployModal();
        });

        document.getElementById('deployCancelBtn')?.addEventListener('click', () => {
            this.closeDeployModal();
        });

        document.getElementById('deployModalOverlay')?.addEventListener('click', (e) => {
            if (e.target.id === 'deployModalOverlay') {
                this.closeDeployModal();
            }
        });

        // Check connection button
        document.getElementById('checkConnectionBtn')?.addEventListener('click', () => {
            this.checkConnection();
        });

        // Start deploy button
        document.getElementById('deployStartBtn')?.addEventListener('click', () => {
            this.startDeploy();
        });

        // Listen for deploy events from socket
        this.socket?.on('deploy-started', (data) => {
            this.showToast('배포 시작', `${data.targetIP}에 배포를 시작합니다`, 'info');
        });

        this.socket?.on('deploy-completed', (data) => {
            if (data.success) {
                this.showToast('배포 완료', `${data.targetIP}에 성공적으로 배포되었습니다`, 'success');
                this.loadPCs();
                this.loadStats();
            } else {
                this.showToast('배포 실패', data.error || '알 수 없는 오류', 'error');
            }
        });

        // ========================================
        // One-Click Full Setup Events
        // ========================================
        document.getElementById('oneClickSetupBtn')?.addEventListener('click', () => {
            this.openOneClickModal();
        });

        document.getElementById('oneClickModalClose')?.addEventListener('click', () => {
            this.closeOneClickModal();
        });

        document.getElementById('oneClickCancelBtn')?.addEventListener('click', () => {
            this.closeOneClickModal();
        });

        document.getElementById('oneClickModalOverlay')?.addEventListener('click', (e) => {
            if (e.target.id === 'oneClickModalOverlay') {
                this.closeOneClickModal();
            }
        });

        document.getElementById('oneClickStartBtn')?.addEventListener('click', () => {
            this.startOneClickSetup();
        });

        // One-Click WebSocket events
        this.socket?.on('oneclick-progress', (data) => {
            this.updateOneClickProgress(data);
        });

        this.socket?.on('oneclick-complete', (data) => {
            this.showOneClickComplete(data);
        });

        this.socket?.on('oneclick-error', (data) => {
            this.showToast('오류', data.error, 'error');
        });
    }

    // ========================================
    // Deploy Modal - Ultra Enterprise v2.0
    // ========================================
    openDeployModal() {
        document.getElementById('deployModalOverlay').classList.add('active');
        document.getElementById('deployTargetIP').value = '';
        document.getElementById('deployUsername').value = '';
        document.getElementById('deployPassword').value = '';
        document.getElementById('connectionStatus').textContent = '';
        document.getElementById('deploySteps').style.display = 'none';
        document.getElementById('scannedPcsList').style.display = 'none';
        document.getElementById('scanProgress').style.display = 'none';

        // Bind new events
        this.bindUltraEnterpriseEvents();
    }

    closeDeployModal() {
        document.getElementById('deployModalOverlay')?.classList.remove('active');
    }

    bindUltraEnterpriseEvents() {
        // Network Scan button
        document.getElementById('networkScanBtn')?.removeEventListener('click', this.startNetworkScan);
        document.getElementById('networkScanBtn')?.addEventListener('click', () => this.startNetworkScan());

        // Auto Deploy button
        document.getElementById('deployAutoBtn')?.removeEventListener('click', this.startAutoDeploy);
        document.getElementById('deployAutoBtn')?.addEventListener('click', () => this.startAutoDeploy());

        // Listen for scan progress
        this.socket?.off('scan-progress');
        this.socket?.on('scan-progress', (data) => {
            document.getElementById('scanProgress').style.display = 'block';
            document.getElementById('scanProgressBar').style.width = data.percent + '%';
            document.getElementById('scanPercent').textContent = `${data.percent}% (발견: ${data.found}대)`;
        });

        // Listen for scan completion
        this.socket?.off('scan-completed');
        this.socket?.on('scan-completed', (data) => {
            this.renderScannedPCs(data.results);
        });

        // Listen for deploy progress
        this.socket?.off('deploy-progress');
        this.socket?.on('deploy-progress', (data) => {
            this.renderDeploySteps(data.steps);
        });
    }

    async startNetworkScan() {
        const scanBtn = document.getElementById('networkScanBtn');
        const scanStatus = document.getElementById('scanStatus');

        scanBtn.disabled = true;
        scanBtn.textContent = '스캔 중...';
        scanStatus.textContent = '네트워크 스캔 시작...';

        document.getElementById('scanProgress').style.display = 'block';
        document.getElementById('scanProgressBar').style.width = '0%';

        try {
            // Get server subnet
            const myIpRes = await fetch('/api/network/my-ip');
            const myIpData = await myIpRes.json();
            const subnet = myIpData.subnet || '192.168.0';

            scanStatus.textContent = `${subnet}.x 스캔 중...`;

            const response = await fetch(`/api/network/scan?subnet=${subnet}&range=1-254`);
            const data = await response.json();

            if (data.success) {
                scanStatus.textContent = `✅ ${data.results.length}대 PC 발견`;
                this.renderScannedPCs(data.results);
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            scanStatus.textContent = `❌ 스캔 실패: ${error.message}`;
        } finally {
            scanBtn.disabled = false;
            scanBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.35-4.35"></path></svg> 네트워크 스캔 시작`;
        }
    }

    renderScannedPCs(pcs) {
        const container = document.getElementById('scannedPcsList');
        container.style.display = 'block';

        if (!pcs || pcs.length === 0) {
            container.innerHTML = '<p class="scan-empty">발견된 PC가 없습니다</p>';
            return;
        }

        container.innerHTML = `
            <p class="list-header">발견된 PC 목록 (클릭하여 선택)</p>
            <div class="scanned-pc-grid">
                ${pcs.map(pc => `
                    <div class="scanned-pc-item ${pc.winrmReady ? 'ready' : 'not-ready'}" data-ip="${pc.ip}" data-ready="${pc.winrmReady}">
                        <span class="pc-ip">${pc.ip}</span>
                        <span class="pc-status">${pc.winrmReady ? '✅ 배포 가능' : '⚠️ WinRM 필요'}</span>
                        ${!pc.winrmReady ? `<button class="btn-setup-winrm" data-ip="${pc.ip}" title="원격 WinRM 설정">🔧 설정</button>` : ''}
                    </div>
                `).join('')}
            </div>
        `;

        // Bind click events for selection
        container.querySelectorAll('.scanned-pc-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // Ignore if clicking the setup button
                if (e.target.classList.contains('btn-setup-winrm')) return;

                document.getElementById('deployTargetIP').value = item.dataset.ip;
                container.querySelectorAll('.scanned-pc-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
            });
        });

        // Bind WinRM setup buttons
        container.querySelectorAll('.btn-setup-winrm').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showWinRMSetupPrompt(btn.dataset.ip);
            });
        });

        // Listen for WinRM setup progress
        this.socket?.off('winrm-setup-progress');
        this.socket?.on('winrm-setup-progress', (data) => {
            this.showToast('WinRM 설정', `${data.step.name}: ${data.step.status}`, 'info');
        });

        this.socket?.off('winrm-setup-completed');
        this.socket?.on('winrm-setup-completed', (data) => {
            if (data.success) {
                this.showToast('🎉 설정 완료', `${data.targetIP} WinRM 활성화됨!`, 'success');
                // Update the PC item to show as ready
                const pcItem = container.querySelector(`[data-ip="${data.targetIP}"]`);
                if (pcItem) {
                    pcItem.classList.remove('not-ready');
                    pcItem.classList.add('ready');
                    pcItem.querySelector('.pc-status').textContent = '✅ 배포 가능';
                    pcItem.querySelector('.btn-setup-winrm')?.remove();
                }
            } else {
                this.showToast('설정 실패', data.steps?.[data.steps.length - 1]?.message || '수동 설정 필요', 'warning');
            }
        });
    }

    showWinRMSetupPrompt(targetIP) {
        // Show practical setup instructions modal
        this.showSetupInstructions(targetIP);
    }

    showSetupInstructions(targetIP) {
        // Create and show a helpful modal with setup instructions
        const existingModal = document.getElementById('winrmHelpModal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.id = 'winrmHelpModal';
        modal.className = 'modal-overlay active';
        modal.innerHTML = `
            <div class="modal" style="max-width: 600px;">
                <div class="modal-header">
                    <h3>🔧 ${targetIP} WinRM 설정 방법</h3>
                    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="modal-body">
                    <div class="setup-instructions">
                        <div class="instruction-step">
                            <span class="step-number">1</span>
                            <div class="step-content">
                                <strong>학생 PC로 이동</strong>
                                <p>IP: <code>${targetIP}</code> PC로 직접 가세요</p>
                            </div>
                        </div>
                        <div class="instruction-step">
                            <span class="step-number">2</span>
                            <div class="step-content">
                                <strong>설정 파일 실행</strong>
                                <p>아래 중 하나를 선택:</p>
                                <ul>
                                    <li>📁 <code>D:\\Dark_Virus\\Enterprise-PC-Management\\📱 학생PC 설정.bat</code></li>
                                    <li>💾 USB에 복사하여 학생 PC에서 실행</li>
                                    <li>🌐 공유 폴더에서 실행</li>
                                </ul>
                            </div>
                        </div>
                        <div class="instruction-step">
                            <span class="step-number">3</span>
                            <div class="step-content">
                                <strong>관리자 권한으로 실행</strong>
                                <p>파일을 <strong>우클릭 → 관리자 권한으로 실행</strong></p>
                            </div>
                        </div>
                        <div class="instruction-step success">
                            <span class="step-number">✓</span>
                            <div class="step-content">
                                <strong>완료!</strong>
                                <p>설정 완료 후 이 PC가 "배포 가능"으로 변경됩니다</p>
                            </div>
                        </div>
                    </div>
                    <div class="setup-actions" style="margin-top: 20px;">
                        <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">닫기</button>
                        <button class="btn-primary" onclick="dashboard.copySetupCommand()">📋 PowerShell 명령 복사</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Add styles if not present
        if (!document.getElementById('winrmHelpStyles')) {
            const styles = document.createElement('style');
            styles.id = 'winrmHelpStyles';
            styles.textContent = `
                .setup-instructions {
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                }
                .instruction-step {
                    display: flex;
                    gap: 16px;
                    padding: 16px;
                    background: var(--bg-deep);
                    border-radius: 12px;
                    border-left: 3px solid var(--accent-primary);
                }
                .instruction-step.success {
                    border-left-color: var(--status-online);
                    background: rgba(16, 185, 129, 0.1);
                }
                .step-number {
                    width: 32px;
                    height: 32px;
                    background: var(--accent-primary);
                    color: white;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: 600;
                    flex-shrink: 0;
                }
                .instruction-step.success .step-number {
                    background: var(--status-online);
                }
                .step-content strong {
                    display: block;
                    margin-bottom: 6px;
                    color: var(--text-primary);
                }
                .step-content p, .step-content ul {
                    color: var(--text-secondary);
                    font-size: 0.9rem;
                    margin: 0;
                }
                .step-content ul {
                    margin-top: 8px;
                    padding-left: 20px;
                }
                .step-content code {
                    background: var(--bg-elevated);
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-family: 'Consolas', monospace;
                    font-size: 0.85rem;
                }
            `;
            document.head.appendChild(styles);
        }
    }

    copySetupCommand() {
        const command = 'Set-ExecutionPolicy Bypass -Scope Process -Force; Enable-PSRemoting -Force -SkipNetworkProfileCheck; Set-Item WSMan:\\localhost\\Service\\Auth\\Basic -Value $true; Set-Item WSMan:\\localhost\\Client\\TrustedHosts -Value "*" -Force; New-NetFirewallRule -Name "WINRM-HTTP-In-TCP" -DisplayName "WinRM (HTTP-In)" -Protocol TCP -LocalPort 5985 -Direction Inbound -Action Allow -Profile Any -ErrorAction SilentlyContinue; Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System" -Name "LocalAccountTokenFilterPolicy" -Value 1 -Force; Restart-Service WinRM; Write-Host "WinRM Done!" -ForegroundColor Green';

        navigator.clipboard.writeText(command).then(() => {
            this.showToast('📋 복사됨', '학생 PC의 PowerShell(관리자)에 붙여넣기 하세요', 'success');
        }).catch(() => {
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = command;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            this.showToast('📋 복사됨', '학생 PC의 PowerShell(관리자)에 붙여넣기 하세요', 'success');
        });
    }

    async startAutoDeploy() {
        const targetIP = document.getElementById('deployTargetIP').value.trim();
        const username = document.getElementById('deployUsername').value.trim();
        const password = document.getElementById('deployPassword').value;

        if (!targetIP) {
            this.showToast('입력 오류', 'IP 주소를 입력하거나 스캔 결과에서 선택하세요', 'warning');
            return;
        }
        if (!username || !password) {
            this.showToast('입력 오류', '대상 PC의 관리자 계정과 비밀번호를 입력하세요', 'warning');
            return;
        }

        // Show steps
        document.getElementById('deploySteps').style.display = 'block';
        document.getElementById('stepsList').innerHTML = '<p class="loading">🚀 원클릭 자동 배포 시작...</p>';

        try {
            const response = await fetch('/api/deploy/auto', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetIP, username, password })
            });

            const data = await response.json();

            if (data.success) {
                this.renderDeploySteps(data.steps);
                this.showToast('🎉 배포 완료!', `${targetIP}에 성공적으로 배포되었습니다`, 'success');

                setTimeout(() => {
                    this.closeDeployModal();
                    this.loadPCs();
                    this.loadStats();
                }, 2000);
            } else {
                this.renderDeploySteps(data.steps || [{ name: '오류', status: 'FAIL', message: data.error }]);
                this.showToast('배포 실패', data.error, 'error');
            }
        } catch (error) {
            document.getElementById('stepsList').innerHTML = `< p class="error" >❌ 오류: ${error.message}</p > `;
            this.showToast('배포 실패', error.message, 'error');
        }
    }

    renderDeploySteps(steps) {
        const container = document.getElementById('stepsList');

        if (!steps || steps.length === 0) return;

        const statusIcons = {
            'PROGRESS': '⏳',
            'OK': '✅',
            'FAIL': '❌',
            'WARN': '⚠️'
        };

        const statusClasses = {
            'PROGRESS': 'step-progress',
            'OK': 'step-ok',
            'FAIL': 'step-fail',
            'WARN': 'step-warn'
        };

        container.innerHTML = steps.map(step => `
                < div class="deploy-step ${statusClasses[step.status] || ''}" >
                <span class="step-icon">${statusIcons[step.status] || '•'}</span>
                <span class="step-name">${step.name}</span>
                ${step.message ? `<span class="step-message">${step.message}</span>` : ''}
            </div >
                `).join('');
    }

    async checkConnection() {
        const ip = document.getElementById('deployTargetIP').value.trim();
        const statusEl = document.getElementById('connectionStatus');

        if (!ip) {
            statusEl.textContent = 'IP 주소를 입력하세요';
            statusEl.className = 'connection-status offline';
            return;
        }

        statusEl.textContent = '연결 확인 중...';
        statusEl.className = 'connection-status checking';

        try {
            const response = await fetch(`/ api / deploy / check / ${ip} `);
            const result = await response.json();

            if (result.reachable) {
                statusEl.textContent = '✓ PC 온라인 - 연결 가능';
                statusEl.className = 'connection-status online';
            } else {
                statusEl.textContent = '✗ PC 오프라인 또는 접근 불가';
                statusEl.className = 'connection-status offline';
            }
        } catch (error) {
            statusEl.textContent = '연결 확인 실패';
            statusEl.className = 'connection-status offline';
        }
    }

    // Legacy startDeploy kept for backward compatibility
    async startDeploy() {
        this.startAutoDeploy();
    }

    updateDeployProgress(percent, status) {
        // Legacy method - kept for compatibility
    }

    filterPCs(query) {
        const cards = document.querySelectorAll('.pc-card');
        const lowerQuery = query.toLowerCase();

        cards.forEach(card => {
            const pcName = card.dataset.pcName.toLowerCase();
            card.style.display = pcName.includes(lowerQuery) ? 'block' : 'none';
        });
    }

    startAutoRefresh() {
        // Refresh stats every 30 seconds
        setInterval(() => {
            this.loadStats();
        }, 30000);

        // Refresh PC list every minute
        setInterval(() => {
            this.loadPCs();
        }, 60000);
    }

    // ========================================
    // Block Management
    // ========================================

    initBlockManagement() {
        // Open block modal
        document.getElementById('navBlocking')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.openBlockModal();
        });

        // Close block modal
        document.getElementById('blockModalClose')?.addEventListener('click', () => {
            this.closeBlockModal();
        });
        document.getElementById('blockModalCancelBtn')?.addEventListener('click', () => {
            this.closeBlockModal();
        });

        // Add blocked site
        document.getElementById('addBlockedSiteBtn')?.addEventListener('click', () => {
            this.addBlockedSite();
        });
        document.getElementById('newBlockedSite')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addBlockedSite();
        });

        // Add blocked program
        document.getElementById('addBlockedProgramBtn')?.addEventListener('click', () => {
            this.addBlockedProgram();
        });
        document.getElementById('newBlockedProgram')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addBlockedProgram();
        });

        // Apply blocking to all PCs
        document.getElementById('applyBlockingBtn')?.addEventListener('click', () => {
            this.applyBlockingToAllPCs();
        });

        // Load initial data
        this.blockedSites = [];
        this.blockedPrograms = [];
    }

    openBlockModal() {
        document.getElementById('blockModalOverlay').classList.add('active');
        this.loadBlockedSites();
        this.loadBlockedPrograms();
    }

    closeBlockModal() {
        document.getElementById('blockModalOverlay').classList.remove('active');
    }

    async loadBlockedSites() {
        try {
            const response = await fetch('/api/blocked-sites');
            this.blockedSites = await response.json();
            this.renderBlockedSites();
        } catch (error) {
            console.error('Failed to load blocked sites:', error);
        }
    }

    renderBlockedSites() {
        const container = document.getElementById('blockedSitesList');
        if (this.blockedSites.length === 0) {
            container.innerHTML = '<div class="empty-list-message">차단된 사이트가 없습니다</div>';
            return;
        }
        container.innerHTML = this.blockedSites.map(site => `
                < div class="blocked-item" data - id="${site.id}" >
                <span class="blocked-item-name">🌐 ${site.url}</span>
                <button class="blocked-item-remove" onclick="dashboard.removeBlockedSite(${site.id})">×</button>
            </div >
                `).join('');
    }

    async addBlockedSite() {
        const input = document.getElementById('newBlockedSite');
        const url = input.value.trim();
        if (!url) return;

        try {
            const response = await fetch('/api/blocked-sites', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            if (response.ok) {
                input.value = '';
                this.loadBlockedSites();
                this.showToast('사이트 추가', `${url} 차단 목록에 추가됨`, 'success');
            }
        } catch (error) {
            this.showToast('오류', '사이트 추가 실패', 'error');
        }
    }

    async removeBlockedSite(id) {
        try {
            await fetch(`/ api / blocked - sites / ${id} `, { method: 'DELETE' });
            this.loadBlockedSites();
            this.showToast('사이트 삭제', '차단 해제됨', 'info');
        } catch (error) {
            this.showToast('오류', '삭제 실패', 'error');
        }
    }

    loadBlockedPrograms() {
        // Load from localStorage for now (can be extended to backend)
        this.blockedPrograms = JSON.parse(localStorage.getItem('blockedPrograms') || '[]');
        this.renderBlockedPrograms();
    }

    renderBlockedPrograms() {
        const container = document.getElementById('blockedProgramsList');
        if (this.blockedPrograms.length === 0) {
            container.innerHTML = '<div class="empty-list-message">차단된 프로그램이 없습니다</div>';
            return;
        }
        container.innerHTML = this.blockedPrograms.map((prog, idx) => `
                < div class="blocked-item" data - idx="${idx}" >
                <span class="blocked-item-name">🎮 ${prog}</span>
                <button class="blocked-item-remove" onclick="dashboard.removeBlockedProgram(${idx})">×</button>
            </div >
                `).join('');
    }

    addBlockedProgram() {
        const input = document.getElementById('newBlockedProgram');
        const program = input.value.trim();
        if (!program) return;

        this.blockedPrograms.push(program);
        localStorage.setItem('blockedPrograms', JSON.stringify(this.blockedPrograms));
        input.value = '';
        this.renderBlockedPrograms();
        this.showToast('프로그램 추가', `${program} 차단 목록에 추가됨`, 'success');
    }

    removeBlockedProgram(idx) {
        this.blockedPrograms.splice(idx, 1);
        localStorage.setItem('blockedPrograms', JSON.stringify(this.blockedPrograms));
        this.renderBlockedPrograms();
        this.showToast('프로그램 삭제', '차단 해제됨', 'info');
    }

    async applyBlockingToAllPCs() {
        const applyTarget = document.querySelector('input[name="applyTarget"]:checked').value;

        this.showToast('적용 중', '모든 PC에 차단 정책 적용 중...', 'info');

        // Get list of online PCs
        try {
            const response = await fetch('/api/pcs');
            const pcs = await response.json();

            const onlinePCs = pcs.filter(pc => pc.status === 'online');

            // Send command to each PC
            for (const pc of onlinePCs) {
                await fetch(`/ api / pcs / ${pc.pc_name}/command`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        command: 'apply-blocking',
                        params: {
                            sites: this.blockedSites.map(s => s.url),
                            programs: this.blockedPrograms
                        }
                    })
                });
            }

            this.showToast('적용 완료', `${onlinePCs.length}대 PC에 차단 정책 적용됨`, 'success');
            this.closeBlockModal();
        } catch (error) {
            this.showToast('오류', '적용 실패: ' + error.message, 'error');
        }
    }

    // ========================================
    // One-Click Full Setup System
    // ========================================
    openOneClickModal() {
        const overlay = document.getElementById('oneClickModalOverlay');
        overlay.classList.add('active');

        // Reset state
        document.getElementById('oneClickProgressSection').style.display = 'none';
        document.getElementById('oneClickResultSection').style.display = 'none';
        document.getElementById('oneClickLog').innerHTML = '';
        document.getElementById('oneClickStartBtn').disabled = false;
        document.getElementById('oneClickStartBtn').textContent = '⚡ 원클릭 설정 시작';

        // Load saved credentials if any
        this.loadSavedCredentials();
    }

    closeOneClickModal() {
        document.getElementById('oneClickModalOverlay').classList.remove('active');
    }

    async loadSavedCredentials() {
        try {
            const response = await fetch('/api/credentials/default');
            const data = await response.json();
            if (data.hasDefault) {
                document.getElementById('oneClickUsername').value = data.username;
                document.getElementById('oneClickPassword').value = data.password;
            }
        } catch (error) {
            console.log('No saved credentials');
        }
    }

    async startOneClickSetup() {
        const username = document.getElementById('oneClickUsername').value.trim();
        const password = document.getElementById('oneClickPassword').value;

        if (!username || !password) {
            this.showToast('입력 오류', '사용자명과 비밀번호를 입력하세요', 'warning');
            return;
        }

        // Show progress section
        document.getElementById('oneClickProgressSection').style.display = 'block';
        document.getElementById('oneClickLog').innerHTML = '';
        document.getElementById('oneClickStartBtn').disabled = true;
        document.getElementById('oneClickStartBtn').textContent = '⏳ 진행 중...';

        this.addOneClickLog('🚀 원클릭 전체 설정 시작...');

        try {
            const response = await fetch('/api/oneclick/full-setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (data.success) {
                this.showOneClickComplete(data);
            } else {
                this.addOneClickLog(`❌ 오류: ${data.error}`);
                document.getElementById('oneClickStartBtn').disabled = false;
                document.getElementById('oneClickStartBtn').textContent = '⚡ 다시 시도';
                this.showToast('설정 실패', data.error, 'error');
            }
        } catch (error) {
            this.addOneClickLog(`❌ 네트워크 오류: ${error.message}`);
            document.getElementById('oneClickStartBtn').disabled = false;
            document.getElementById('oneClickStartBtn').textContent = '⚡ 다시 시도';
            this.showToast('오류', error.message, 'error');
        }
    }

    updateOneClickProgress(data) {
        const progressBar = document.getElementById('oneClickProgressBar');
        const status = document.getElementById('oneClickStatus');

        // Update progress bar
        const percent = (data.step / 4) * 100;
        progressBar.style.width = percent + '%';

        // Update status
        status.textContent = data.message || '진행 중...';

        // Add to log
        this.addOneClickLog(data.message);
    }

    addOneClickLog(message) {
        const log = document.getElementById('oneClickLog');
        const time = new Date().toLocaleTimeString('ko-KR');
        log.innerHTML += `<div style="margin-bottom: 4px;"><span style="color: var(--text-muted);">[${time}]</span> ${message}</div>`;
        log.scrollTop = log.scrollHeight;
    }

    showOneClickComplete(data) {
        document.getElementById('oneClickProgressBar').style.width = '100%';
        document.getElementById('oneClickStatus').textContent = '✅ 완료!';
        document.getElementById('oneClickResultSection').style.display = 'block';

        const summary = data.results || data.summary || {};
        document.getElementById('oneClickResultSummary').innerHTML = `
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; text-align: center;">
                <div style="background: var(--bg-deep); padding: 16px; border-radius: 12px;">
                    <div style="font-size: 2rem; font-weight: 700; color: var(--accent-primary);">${summary.scanned || summary.scanned?.length || 0}</div>
                    <div style="color: var(--text-secondary);">발견된 PC</div>
                </div>
                <div style="background: var(--bg-deep); padding: 16px; border-radius: 12px;">
                    <div style="font-size: 2rem; font-weight: 700; color: var(--status-online);">${summary.installed || summary.agentInstalled?.length || 0}</div>
                    <div style="color: var(--text-secondary);">설치 성공</div>
                </div>
                <div style="background: var(--bg-deep); padding: 16px; border-radius: 12px;">
                    <div style="font-size: 2rem; font-weight: 700; color: var(--status-offline);">${summary.failed || summary.setupFailed?.length || 0}</div>
                    <div style="color: var(--text-secondary);">실패</div>
                </div>
            </div>
        `;

        document.getElementById('oneClickStartBtn').disabled = false;
        document.getElementById('oneClickStartBtn').textContent = '✅ 완료 - 닫기';
        document.getElementById('oneClickStartBtn').onclick = () => {
            this.closeOneClickModal();
            this.loadPCs();
            this.loadStats();
        };

        this.showToast('🎉 완료!', data.message || '원클릭 설정이 완료되었습니다', 'success');
        this.addOneClickLog('🎉 모든 작업 완료!');
    }

    // ========================================
    // Bulk Control & Screenshots (v3.0)
    // ========================================

    updateBulkCount() {
        const onlineCount = Array.from(this.pcs.values()).filter(pc => this.isOnline(pc)).length;
        const el = document.getElementById('bulkCount');
        if (el) el.textContent = `${onlineCount}대 온라인`;
    }

    async sendBulkCommand(command) {
        const onlinePCs = Array.from(this.pcs.values()).filter(pc => this.isOnline(pc));
        if (onlinePCs.length === 0) {
            this.showToast('알림', '온라인 PC가 없습니다', 'info');
            return;
        }

        const confirmMsg = command === 'shutdown'
            ? `정말 ${onlinePCs.length}대 PC를 종료하시겠습니까?`
            : `${onlinePCs.length}대 PC에 ${command} 명령을 보내시겠습니까?`;

        if (!confirm(confirmMsg)) return;

        let success = 0;
        for (const pc of onlinePCs) {
            try {
                const res = await fetch(`/api/pcs/${pc.pc_name}/command`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command })
                });
                if (res.ok) success++;
            } catch (e) {
                console.error(`${pc.pc_name} command failed:`, e);
            }
        }

        this.showToast('일괄 명령', `${success}/${onlinePCs.length}대 전송 완료`, success > 0 ? 'success' : 'error');
    }

    async requestScreenshot() {
        if (!this.selectedPC) return;
        const pcName = this.selectedPC.pc_name;

        try {
            const res = await fetch(`/api/pcs/${pcName}/command`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: 'screenshot' })
            });

            if (res.ok) {
                this.showToast('📸 스크린샷', `${pcName}에 스크린샷을 요청했습니다`, 'info');
            }
        } catch (e) {
            this.showToast('오류', '스크린샷 요청 실패', 'error');
        }
    }

    async requestAllScreenshots() {
        const onlinePCs = Array.from(this.pcs.values()).filter(pc => this.isOnline(pc));
        if (onlinePCs.length === 0) {
            this.showToast('알림', '온라인 PC가 없습니다', 'info');
            return;
        }

        this.showToast('📸 전체 스크린샷', `${onlinePCs.length}대 PC에 요청 중...`, 'info');

        for (const pc of onlinePCs) {
            try {
                await fetch(`/api/pcs/${pc.pc_name}/command`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command: 'screenshot' })
                });
            } catch (e) { /* skip */ }
        }

        // Open screenshot viewer after a short delay
        setTimeout(() => this.openScreenshotViewer(), 3000);
    }

    async sendMessageToPC() {
        if (!this.selectedPC) return;
        const input = document.getElementById('modalMessageInput');
        const message = input?.value?.trim();
        if (!message) {
            this.showToast('알림', '메시지를 입력하세요', 'info');
            return;
        }

        try {
            const res = await fetch(`/api/pcs/${this.selectedPC.pc_name}/command`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: 'message', params: { message } })
            });

            if (res.ok) {
                this.showToast('📨 전송됨', `${this.selectedPC.pc_name}에 메시지 전송 완료`, 'success');
                input.value = '';
            }
        } catch (e) {
            this.showToast('오류', '메시지 전송 실패', 'error');
        }
    }

    openBulkMessageModal() {
        const overlay = document.getElementById('bulkMessageModalOverlay');
        if (overlay) overlay.classList.add('active');
    }

    closeBulkMessageModal() {
        const overlay = document.getElementById('bulkMessageModalOverlay');
        if (overlay) overlay.classList.remove('active');
    }

    async sendBulkMessage() {
        const input = document.getElementById('bulkMessageInput');
        const message = input?.value?.trim();
        if (!message) {
            this.showToast('알림', '메시지를 입력하세요', 'info');
            return;
        }

        const onlinePCs = Array.from(this.pcs.values()).filter(pc => this.isOnline(pc));
        if (onlinePCs.length === 0) {
            this.showToast('알림', '온라인 PC가 없습니다', 'info');
            return;
        }

        let success = 0;
        for (const pc of onlinePCs) {
            try {
                const res = await fetch(`/api/pcs/${pc.pc_name}/command`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command: 'message', params: { message } })
                });
                if (res.ok) success++;
            } catch (e) { /* skip */ }
        }

        this.showToast('📨 전체 전송', `${success}/${onlinePCs.length}대 전송 완료`, 'success');
        input.value = '';
        this.closeBulkMessageModal();
    }

    openScreenshotViewer() {
        const overlay = document.getElementById('screenshotModalOverlay');
        const grid = document.getElementById('screenshotGrid');
        if (!overlay || !grid) return;

        const screenshots = this.latestScreenshots || [];
        if (screenshots.length === 0) {
            grid.innerHTML = `
                <div class="screenshot-empty">
                    <p>스크린샷이 없습니다</p>
                    <span>PC를 선택하고 스크린샷 버튼을 누르세요</span>
                </div>
            `;
        } else {
            grid.innerHTML = screenshots.map(s => `
                <div class="screenshot-card" onclick="window.open('/screenshots/${s.filename}', '_blank')">
                    <img src="/screenshots/${s.filename}" alt="${s.pcName}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 200 150%22><text x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 fill=%22%23666%22>Loading...</text></svg>'">
                    <div class="screenshot-info">
                        <span class="screenshot-pc">${s.pcName}</span>
                        <span class="screenshot-time">${s.time}</span>
                    </div>
                </div>
            `).join('');
        }

        overlay.classList.add('active');
    }

    closeScreenshotModal() {
        const overlay = document.getElementById('screenshotModalOverlay');
        if (overlay) overlay.classList.remove('active');
    }

    // ========================================
    // Real-time Screen Streaming (v3.0)
    // ========================================

    startLiveView(pcName) {
        const target = pcName || this.selectedPC?.pc_name;
        if (!target) {
            this.showToast('알림', 'PC를 선택하세요', 'info');
            return;
        }

        this.liveViewPC = target;
        this.liveViewFrameCount = 0;
        this.liveViewBytesReceived = 0;
        this.liveViewLastFpsUpdate = Date.now();
        this.liveViewLastBwUpdate = Date.now();

        // Update UI
        const overlay = document.getElementById('liveViewOverlay');
        const pcNameEl = document.getElementById('liveViewPcName');
        const placeholder = document.getElementById('liveViewPlaceholder');

        if (pcNameEl) pcNameEl.textContent = target;
        if (placeholder) placeholder.classList.remove('hidden');
        if (overlay) overlay.classList.add('active');

        // Close PC modal
        this.closePCModal();

        // Request stream from server
        const fps = parseInt(document.getElementById('liveViewFpsSlider')?.value || '5');
        const quality = parseInt(document.getElementById('liveViewQualitySlider')?.value || '40');

        this.socket.emit('start-stream-request', {
            pcName: target,
            fps,
            quality
        });

        this.showToast('🎬 실시간 스트리밍', `${target} 화면 스트리밍 시작`, 'success');
    }

    stopLiveView() {
        if (this.liveViewPC) {
            this.socket.emit('stop-stream-request', {
                pcName: this.liveViewPC
            });
            this.showToast('🎬 스트림 종료', `${this.liveViewPC} 스트림 중단`, 'info');
        }

        this.liveViewPC = null;
        const overlay = document.getElementById('liveViewOverlay');
        if (overlay) overlay.classList.remove('active');
    }

    renderFrame(data) {
        const canvas = document.getElementById('liveViewCanvas');
        const placeholder = document.getElementById('liveViewPlaceholder');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const img = new Image();

        img.onload = () => {
            // Set canvas size to match image
            if (canvas.width !== img.width || canvas.height !== img.height) {
                canvas.width = img.width;
                canvas.height = img.height;
            }
            ctx.drawImage(img, 0, 0);

            // Hide loading placeholder
            if (placeholder && !placeholder.classList.contains('hidden')) {
                placeholder.classList.add('hidden');
            }
        };

        img.src = `data:image/jpeg;base64,${data.frame}`;

        // Update stats
        this.liveViewFrameCount++;
        this.liveViewBytesReceived += (data.size || 0);

        const now = Date.now();

        // FPS counter (update every second)
        if (now - this.liveViewLastFpsUpdate >= 1000) {
            const elapsed = (now - this.liveViewLastFpsUpdate) / 1000;
            const fps = Math.round(this.liveViewFrameCount / elapsed);
            const fpsEl = document.getElementById('liveViewFps');
            if (fpsEl) fpsEl.textContent = `${fps} FPS`;
            this.liveViewFrameCount = 0;
            this.liveViewLastFpsUpdate = now;
        }

        // Bandwidth (update every 2 seconds)
        if (now - this.liveViewLastBwUpdate >= 2000) {
            const elapsed = (now - this.liveViewLastBwUpdate) / 1000;
            const kbps = Math.round(this.liveViewBytesReceived / elapsed / 1024);
            const bwEl = document.getElementById('liveViewBandwidth');
            if (bwEl) bwEl.textContent = `${kbps} KB/s`;
            this.liveViewBytesReceived = 0;
            this.liveViewLastBwUpdate = now;
        }

        // Quality display
        const qualityEl = document.getElementById('liveViewQuality');
        if (qualityEl) qualityEl.textContent = `Q: ${data.quality || '?'}%`;
    }

    updateStreamSettings() {
        const fpsSlider = document.getElementById('liveViewFpsSlider');
        const qualitySlider = document.getElementById('liveViewQualitySlider');
        const fpsValue = document.getElementById('liveViewFpsValue');
        const qualityValue = document.getElementById('liveViewQualityValue');

        if (fpsSlider && fpsValue) fpsValue.textContent = fpsSlider.value;
        if (qualitySlider && qualityValue) qualityValue.textContent = qualitySlider.value;

        if (this.liveViewPC) {
            this.socket.emit('stop-stream-request', { pcName: this.liveViewPC });
            setTimeout(() => {
                this.socket.emit('start-stream-request', {
                    pcName: this.liveViewPC,
                    fps: parseInt(fpsSlider?.value || '5'),
                    quality: parseInt(qualitySlider?.value || '40')
                });
            }, 200);
        }
    }

    // ========================================
    // Command Palette (Ctrl+K)
    // ========================================
    initCommandPalette() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+K or Cmd+K — open command palette
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                this.toggleCommandPalette();
            }
            // Escape — close modals/palette
            if (e.key === 'Escape') {
                if (this.commandPaletteOpen) {
                    this.closeCommandPalette();
                }
            }
            // ? — show shortcuts (when not typing)
            if (e.key === '?' && !e.target.matches('input, textarea')) {
                this.showShortcutsHelp();
            }
            // R — refresh data
            if (e.key === 'r' && !e.target.matches('input, textarea') && !e.ctrlKey) {
                this.loadPCs();
                this.loadStats();
                this.showToast('새로고침', '데이터를 갱신했습니다', 'info');
            }
        });
    }

    toggleCommandPalette() {
        if (this.commandPaletteOpen) {
            this.closeCommandPalette();
        } else {
            this.openCommandPalette();
        }
    }

    openCommandPalette() {
        this.commandPaletteOpen = true;
        this.selectedCommandIndex = -1;
        const overlay = document.getElementById('commandPaletteOverlay');
        const input = document.getElementById('commandPaletteInput');
        if (overlay) overlay.classList.add('active');
        if (input) {
            input.value = '';
            setTimeout(() => input.focus(), 100);
        }
        this.renderCommandResults('');

        // Close on overlay click
        overlay?.addEventListener('click', (e) => {
            if (e.target === overlay) this.closeCommandPalette();
        }, { once: true });

        // Listen for input
        input?.addEventListener('input', (e) => {
            this.renderCommandResults(e.target.value);
        });

        // Arrow keys + Enter
        input?.addEventListener('keydown', (e) => {
            const results = document.querySelectorAll('.command-result-item');
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.selectedCommandIndex = Math.min(this.selectedCommandIndex + 1, results.length - 1);
                this.highlightCommandResult(results);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.selectedCommandIndex = Math.max(this.selectedCommandIndex - 1, 0);
                this.highlightCommandResult(results);
            } else if (e.key === 'Enter' && this.selectedCommandIndex >= 0) {
                results[this.selectedCommandIndex]?.click();
            }
        });
    }

    closeCommandPalette() {
        this.commandPaletteOpen = false;
        const overlay = document.getElementById('commandPaletteOverlay');
        if (overlay) overlay.classList.remove('active');
    }

    renderCommandResults(query) {
        const container = document.getElementById('commandPaletteResults');
        if (!container) return;

        const commands = [
            { icon: '📊', title: '대시보드', desc: '메인 대시보드로 이동', action: () => { document.querySelector('[data-view="dashboard"]')?.click(); } },
            { icon: '📺', title: '전체 화면 모니터링', desc: '모든 PC 화면 썸네일 보기', action: () => this.openThumbnailGrid() },
            { icon: '🔄', title: '데이터 새로고침', desc: 'PC 상태 및 통계 갱신', shortcut: 'R', action: () => { this.loadPCs(); this.loadStats(); } },
            { icon: '📸', title: '전체 스크린샷', desc: '모든 온라인 PC 스크린샷', action: () => this.requestAllScreenshots() },
            { icon: '🔒', title: '전체 잠금', desc: '모든 온라인 PC 화면 잠금', action: () => this.sendBulkCommand('lock') },
            { icon: '💬', title: '일괄 메시지', desc: '모든 PC에 메시지 전송', action: () => this.openBulkMessageModal() },
            { icon: '🌙', title: '테마 전환', desc: '다크/라이트 모드 전환', action: () => this.toggleTheme() },
            { icon: '⚡', title: '원클릭 설정', desc: '전체 PC 자동 설정', action: () => this.openOneClickModal() },
            { icon: '🚫', title: '차단 관리', desc: '사이트/프로그램 차단 설정', action: () => { document.querySelector('[data-view="blocking"]')?.click(); } },
            { icon: '⌨️', title: '단축키 도움말', desc: '키보드 단축키 보기', shortcut: '?', action: () => this.showShortcutsHelp() },
        ];

        // Add online PCs as commands
        this.pcs.forEach((pc, name) => {
            if (this.isOnline(pc)) {
                commands.push({
                    icon: '💻',
                    title: name,
                    desc: `${pc.ip_address} • CPU ${(pc.cpu_usage || 0).toFixed(0)}% • MEM ${(pc.memory_usage || 0).toFixed(0)}%`,
                    action: () => this.openPCModal(name)
                });
            }
        });

        const q = query.toLowerCase();
        const filtered = q
            ? commands.filter(c => c.title.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q))
            : commands;

        container.innerHTML = filtered.slice(0, 10).map((c, i) => `
            <div class="command-result-item" data-index="${i}">
                <div class="command-result-icon">${c.icon}</div>
                <div class="command-result-text">
                    <div class="command-result-title">${c.title}</div>
                    <div class="command-result-desc">${c.desc}</div>
                </div>
                ${c.shortcut ? `<div class="command-result-shortcut"><span class="shortcut-key">${c.shortcut}</span></div>` : ''}
            </div>
        `).join('');

        // Bind click handlers
        container.querySelectorAll('.command-result-item').forEach((el, i) => {
            el.addEventListener('click', () => {
                this.closeCommandPalette();
                filtered[i].action();
            });
        });

        this.selectedCommandIndex = filtered.length > 0 ? 0 : -1;
        this.highlightCommandResult(container.querySelectorAll('.command-result-item'));
    }

    highlightCommandResult(results) {
        results.forEach((el, i) => {
            el.classList.toggle('selected', i === this.selectedCommandIndex);
        });
    }

    // ========================================
    // Keyboard Shortcuts Help
    // ========================================
    showShortcutsHelp() {
        const shortcuts = [
            { keys: ['Ctrl', 'K'], label: '명령 팔레트 열기' },
            { keys: ['R'], label: '데이터 새로고침' },
            { keys: ['Esc'], label: '모달/팔레트 닫기' },
            { keys: ['?'], label: '단축키 도움말' },
        ];

        const content = shortcuts.map(s => `
            <div class="shortcut-row">
                <span class="shortcut-label">${s.label}</span>
                <div class="shortcut-keys">
                    ${s.keys.map(k => `<span class="shortcut-key">${k}</span>`).join('')}
                </div>
            </div>
        `).join('');

        // Use a temporary modal
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active shortcuts-modal';
        overlay.innerHTML = `
            <div class="modal" style="max-width: 400px;">
                <div class="modal-header">
                    <h3>⌨️ 키보드 단축키</h3>
                    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
                </div>
                <div class="modal-body">${content}</div>
            </div>
        `;
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
        document.body.appendChild(overlay);
    }

    // ========================================
    // Sidebar Live Stats
    // ========================================
    updateSidebarStats() {
        const onlineCount = Array.from(this.pcs.values()).filter(pc => this.isOnline(pc)).length;
        const totalCount = this.pcs.size;

        const onlineEl = document.getElementById('sidebarOnlineCount');
        const totalEl = document.getElementById('sidebarTotalCount');
        const uptimeEl = document.getElementById('sidebarUptime');

        if (onlineEl) onlineEl.textContent = `${onlineCount}대`;
        if (totalEl) totalEl.textContent = `${totalCount}대`;

        if (uptimeEl) {
            const elapsed = Date.now() - this.serverStartTime;
            const minutes = Math.floor(elapsed / 60000);
            const hours = Math.floor(minutes / 60);
            if (hours > 0) {
                uptimeEl.textContent = `${hours}시간 ${minutes % 60}분`;
            } else {
                uptimeEl.textContent = `${minutes}분`;
            }
        }
    }

    // ========================================
    // Command History Tracking
    // ========================================
    trackCommand(pcName, command, status = 'success') {
        this.commandHistory.unshift({
            pcName,
            command,
            status,
            timestamp: new Date()
        });
        // Keep last 50 commands
        if (this.commandHistory.length > 50) this.commandHistory.pop();
    }

    renderCommandHistory(pcName) {
        const history = this.commandHistory.filter(h => !pcName || h.pcName === pcName);
        if (history.length === 0) {
            return '<div style="text-align: center; padding: 16px; color: var(--text-muted); font-size: 0.8rem;">명령 기록이 없습니다</div>';
        }

        return history.slice(0, 10).map(h => {
            const icon = h.status === 'success' ? '✅' : h.status === 'error' ? '❌' : '⏳';
            const timeAgo = this.formatTimeAgo(h.timestamp);
            return `
                <div class="command-item">
                    <div class="command-icon ${h.status}">${icon}</div>
                    <div class="command-info">
                        <div class="command-name">${h.command}</div>
                        <div class="command-time">${h.pcName} • ${timeAgo}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ========================================
    // Sparkline Mini-Charts
    // ========================================
    updateSparklineData(pcName, cpuUsage, memoryUsage) {
        if (!this.sparklineData.has(pcName)) {
            this.sparklineData.set(pcName, { cpu: [], mem: [] });
        }
        const data = this.sparklineData.get(pcName);
        data.cpu.push(cpuUsage);
        data.mem.push(memoryUsage);
        // Keep last 20 data points
        if (data.cpu.length > 20) data.cpu.shift();
        if (data.mem.length > 20) data.mem.shift();
    }

    drawSparkline(canvasId, dataPoints, color = '#06b6d4') {
        const canvas = document.getElementById(canvasId);
        if (!canvas || dataPoints.length < 2) return;

        const ctx = canvas.getContext('2d');
        const w = canvas.width = canvas.offsetWidth * 2;
        const h = canvas.height = canvas.offsetHeight * 2;
        ctx.scale(2, 2);

        const displayW = canvas.offsetWidth;
        const displayH = canvas.offsetHeight;

        ctx.clearRect(0, 0, displayW, displayH);

        const max = Math.max(...dataPoints, 100);
        const step = displayW / (dataPoints.length - 1);

        // Fill gradient
        const gradient = ctx.createLinearGradient(0, 0, 0, displayH);
        gradient.addColorStop(0, color + '30');
        gradient.addColorStop(1, color + '00');

        ctx.beginPath();
        ctx.moveTo(0, displayH);
        dataPoints.forEach((val, i) => {
            const x = i * step;
            const y = displayH - (val / max) * displayH * 0.9;
            if (i === 0) ctx.lineTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.lineTo(displayW, displayH);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        // Line
        ctx.beginPath();
        dataPoints.forEach((val, i) => {
            const x = i * step;
            const y = displayH - (val / max) * displayH * 0.9;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    // ========================================
    // Multi-PC Thumbnail Grid
    // ========================================
    openThumbnailGrid() {
        const overlay = document.getElementById('thumbnailGridOverlay');
        const grid = document.getElementById('thumbnailGrid');
        if (!overlay || !grid) return;

        const onlinePCs = Array.from(this.pcs.values()).filter(pc => this.isOnline(pc));

        if (onlinePCs.length === 0) {
            this.showToast('알림', '온라인 PC가 없습니다', 'info');
            return;
        }

        grid.innerHTML = onlinePCs.map(pc => `
            <div class="thumbnail-item" onclick="dashboard.closeThumbnailGrid(); dashboard.openPCModal('${pc.pc_name}')">
                <div class="thumbnail-canvas-wrap">
                    <div style="color: var(--text-muted); font-size: 0.8rem;">📺 ${pc.pc_name}</div>
                </div>
                <div class="thumbnail-label">
                    <div class="thumbnail-pc-name">
                        <div class="thumbnail-status-dot"></div>
                        ${pc.pc_name}
                    </div>
                    <div class="thumbnail-fps">CPU ${(pc.cpu_usage || 0).toFixed(0)}%</div>
                </div>
            </div>
        `).join('');

        overlay.classList.add('active');
    }

    closeThumbnailGrid() {
        const overlay = document.getElementById('thumbnailGridOverlay');
        if (overlay) overlay.classList.remove('active');
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new EnterpriseDashboard();
    window.dashboard.initBlockManagement();
    window.dashboard.initCommandPalette();

    // Update sidebar stats every 10s
    window.dashboard.updateSidebarStats();
    setInterval(() => window.dashboard.updateSidebarStats(), 10000);
});
