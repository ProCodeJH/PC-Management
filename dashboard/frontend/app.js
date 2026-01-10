// ========================================
// Enterprise PC Management - Dashboard App
// Real-time PC Monitoring & Control
// ========================================

class EnterpriseDashboard {
    constructor() {
        this.socket = null;
        this.pcs = new Map();
        this.activities = [];
        this.chart = null;
        this.selectedPC = null;

        this.init();
    }

    init() {
        this.initSocket();
        this.initChart();
        this.bindEvents();
        this.loadInitialData();
        this.startAutoRefresh();
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
            const pcs = await response.json();

            this.pcs.clear();
            pcs.forEach(pc => {
                this.pcs.set(pc.pc_name, pc);
            });

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
        gradient2.addColorStop(0, 'rgba(139, 92, 246, 0.3)');
        gradient2.addColorStop(1, 'rgba(139, 92, 246, 0)');

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
                        borderColor: '#8b5cf6',
                        backgroundColor: gradient2,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 6,
                        pointHoverBackgroundColor: '#8b5cf6',
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
            } else {
                throw new Error(result.error || '명령 전송 실패');
            }
        } catch (error) {
            console.error('Failed to send command:', error);
            this.showToast('오류', '명령 전송에 실패했습니다', 'error');
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

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <div class="toast-icon">${this.getToastIcon(type)}</div>
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                <div class="toast-message">${message}</div>
            </div>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideIn 0.3s ease reverse';
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
    }

    // ========================================
    // Deploy Modal
    // ========================================
    openDeployModal() {
        document.getElementById('deployModalOverlay').classList.add('active');
        document.getElementById('deployTargetIP').value = '';
        document.getElementById('deployUsername').value = 'Administrator';
        document.getElementById('deployPassword').value = '';
        document.getElementById('connectionStatus').textContent = '';
        document.getElementById('deployProgress').style.display = 'none';
        document.getElementById('deployActions').style.display = 'flex';
    }

    closeDeployModal() {
        document.getElementById('deployModalOverlay')?.classList.remove('active');
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
            const response = await fetch(`/api/deploy/check/${ip}`);
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

    async startDeploy() {
        const targetIP = document.getElementById('deployTargetIP').value.trim();
        const username = document.getElementById('deployUsername').value.trim();
        const password = document.getElementById('deployPassword').value;

        if (!targetIP || !username || !password) {
            this.showToast('입력 오류', '모든 필드를 입력하세요', 'warning');
            return;
        }

        // Show progress
        document.getElementById('deployProgress').style.display = 'block';
        document.getElementById('deployActions').style.display = 'none';

        this.updateDeployProgress(10, '연결 중...');

        try {
            this.updateDeployProgress(30, '시스템 파일 복사 중...');

            const response = await fetch('/api/deploy', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ targetIP, username, password })
            });

            this.updateDeployProgress(70, '설정 적용 중...');

            const result = await response.json();

            if (result.success) {
                this.updateDeployProgress(100, '완료!');

                setTimeout(() => {
                    this.closeDeployModal();
                    this.showToast('배포 완료', `${targetIP}에 성공적으로 배포되었습니다`, 'success');
                    this.loadPCs();
                    this.loadStats();
                }, 1000);
            } else {
                throw new Error(result.error || '배포 실패');
            }
        } catch (error) {
            document.getElementById('deployProgress').style.display = 'none';
            document.getElementById('deployActions').style.display = 'flex';
            this.showToast('배포 실패', error.message, 'error');
        }
    }

    updateDeployProgress(percent, status) {
        document.getElementById('deployPercent').textContent = percent + '%';
        document.getElementById('deployProgressBar').style.width = percent + '%';
        document.getElementById('deployStatusText').textContent = status;
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
            <div class="blocked-item" data-id="${site.id}">
                <span class="blocked-item-name">🌐 ${site.url}</span>
                <button class="blocked-item-remove" onclick="dashboard.removeBlockedSite(${site.id})">×</button>
            </div>
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
            await fetch(`/api/blocked-sites/${id}`, { method: 'DELETE' });
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
            <div class="blocked-item" data-idx="${idx}">
                <span class="blocked-item-name">🎮 ${prog}</span>
                <button class="blocked-item-remove" onclick="dashboard.removeBlockedProgram(${idx})">×</button>
            </div>
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
                await fetch(`/api/pcs/${pc.pc_name}/command`, {
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
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new EnterpriseDashboard();
    window.dashboard.initBlockManagement();
});
