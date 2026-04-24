// utils/metrics.js
// Phase 19: Prometheus-style metrics collector
// Tracks requests, latency, errors, DB queries, cache hits

class MetricsCollector {
    constructor() {
        this.startTime = Date.now();
        this.counters = {
            requests_total: 0,
            requests_success: 0,
            requests_error: 0,
            ws_connections: 0,
            ws_messages: 0,
            db_queries: 0,
            cache_hits: 0,
            cache_misses: 0,
        };
        this.histograms = {
            request_duration_ms: [],
            db_query_duration_ms: [],
        };
        this.gauges = {
            active_connections: 0,
            memory_rss_mb: 0,
            memory_heap_mb: 0,
            cpu_usage_percent: 0,
        };

        // Update system metrics every 10s
        this._cpuPrev = process.cpuUsage();
        this._cpuPrevTime = Date.now();
        this._updateInterval = setInterval(() => this._updateSystemMetrics(), 10000);
        this._updateSystemMetrics();
    }

    // Increment counter
    inc(name, value = 1) {
        if (this.counters[name] !== undefined) {
            this.counters[name] += value;
        }
    }

    // Set gauge
    set(name, value) {
        if (this.gauges[name] !== undefined) {
            this.gauges[name] = value;
        }
    }

    // Record histogram value
    observe(name, value) {
        if (!this.histograms[name]) this.histograms[name] = [];
        this.histograms[name].push(value);
        // Keep only last 1000 observations
        if (this.histograms[name].length > 1000) {
            this.histograms[name] = this.histograms[name].slice(-1000);
        }
    }

    // Request middleware
    middleware() {
        return (req, res, next) => {
            const start = process.hrtime.bigint();
            this.counters.requests_total++;

            res.on('finish', () => {
                const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
                this.observe('request_duration_ms', durationMs);

                if (res.statusCode >= 400) {
                    this.counters.requests_error++;
                } else {
                    this.counters.requests_success++;
                }
            });

            next();
        };
    }

    // Get percentile from histogram
    _percentile(arr, p) {
        if (!arr.length) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const index = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
    }

    // Histogram summary
    _histogramSummary(name) {
        const arr = this.histograms[name] || [];
        if (!arr.length) return { count: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
        const sum = arr.reduce((a, b) => a + b, 0);
        return {
            count: arr.length,
            avg: +(sum / arr.length).toFixed(2),
            p50: +this._percentile(arr, 50).toFixed(2),
            p95: +this._percentile(arr, 95).toFixed(2),
            p99: +this._percentile(arr, 99).toFixed(2),
        };
    }

    _updateSystemMetrics() {
        const mem = process.memoryUsage();
        this.gauges.memory_rss_mb = +(mem.rss / 1024 / 1024).toFixed(1);
        this.gauges.memory_heap_mb = +(mem.heapUsed / 1024 / 1024).toFixed(1);

        const cpuNow = process.cpuUsage(this._cpuPrev);
        const elapsedMs = Date.now() - this._cpuPrevTime;
        if (elapsedMs > 0) {
            const totalCpuMs = (cpuNow.user + cpuNow.system) / 1000;
            this.gauges.cpu_usage_percent = +((totalCpuMs / elapsedMs) * 100).toFixed(1);
        }
        this._cpuPrev = process.cpuUsage();
        this._cpuPrevTime = Date.now();
    }

    // Full snapshot
    snapshot() {
        const uptimeSec = Math.floor((Date.now() - this.startTime) / 1000);
        return {
            uptime_seconds: uptimeSec,
            counters: { ...this.counters },
            gauges: { ...this.gauges },
            histograms: {
                request_duration_ms: this._histogramSummary('request_duration_ms'),
                db_query_duration_ms: this._histogramSummary('db_query_duration_ms'),
            },
            rates: {
                requests_per_second: uptimeSec > 0
                    ? +(this.counters.requests_total / uptimeSec).toFixed(2) : 0,
                error_rate_percent: this.counters.requests_total > 0
                    ? +((this.counters.requests_error / this.counters.requests_total) * 100).toFixed(2) : 0,
                cache_hit_rate_percent: (this.counters.cache_hits + this.counters.cache_misses) > 0
                    ? +((this.counters.cache_hits / (this.counters.cache_hits + this.counters.cache_misses)) * 100).toFixed(2) : 0,
            },
        };
    }

    // Prometheus text format
    prometheusText() {
        const snap = this.snapshot();
        const lines = [];

        lines.push('# HELP requests_total Total HTTP requests');
        lines.push('# TYPE requests_total counter');
        lines.push(`requests_total ${snap.counters.requests_total}`);
        lines.push(`requests_success ${snap.counters.requests_success}`);
        lines.push(`requests_error ${snap.counters.requests_error}`);

        lines.push('# HELP request_duration_ms Request latency');
        lines.push('# TYPE request_duration_ms summary');
        const rd = snap.histograms.request_duration_ms;
        lines.push(`request_duration_ms{quantile="0.5"} ${rd.p50}`);
        lines.push(`request_duration_ms{quantile="0.95"} ${rd.p95}`);
        lines.push(`request_duration_ms{quantile="0.99"} ${rd.p99}`);

        lines.push(`memory_rss_mb ${snap.gauges.memory_rss_mb}`);
        lines.push(`memory_heap_mb ${snap.gauges.memory_heap_mb}`);
        lines.push(`cpu_usage_percent ${snap.gauges.cpu_usage_percent}`);
        lines.push(`uptime_seconds ${snap.uptime_seconds}`);

        return lines.join('\n');
    }

    destroy() {
        if (this._updateInterval) clearInterval(this._updateInterval);
    }
}

// Singleton
module.exports = new MetricsCollector();
