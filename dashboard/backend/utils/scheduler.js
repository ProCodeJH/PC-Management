// utils/scheduler.js
// Phase 16: Background job scheduler
// Runs periodic tasks: PC health check, log cleanup, cache warming

const logger = require('./logger');

class Scheduler {
    constructor() {
        this.jobs = new Map();
        this.running = false;
    }

    // Register a job: { name, fn, intervalMs, runOnStart }
    register(name, fn, intervalMs, runOnStart = false) {
        this.jobs.set(name, {
            name,
            fn,
            intervalMs,
            runOnStart,
            lastRun: null,
            runCount: 0,
            errors: 0,
            timer: null,
        });
        return this;
    }

    // Start all jobs
    start() {
        this.running = true;
        for (const [name, job] of this.jobs) {
            if (job.runOnStart) {
                this._executeJob(job);
            }
            job.timer = setInterval(() => this._executeJob(job), job.intervalMs);
            logger.info(`Scheduler: registered "${name}" (every ${job.intervalMs / 1000}s)`);
        }
    }

    async _executeJob(job) {
        if (!this.running) return;
        try {
            await job.fn();
            job.lastRun = new Date().toISOString();
            job.runCount++;
        } catch (err) {
            job.errors++;
            logger.error(`Scheduler job "${job.name}" failed: ${err.message}`);
        }
    }

    // Stop all jobs
    stop() {
        this.running = false;
        for (const [, job] of this.jobs) {
            if (job.timer) clearInterval(job.timer);
        }
    }

    // Status snapshot
    status() {
        const result = {};
        for (const [name, job] of this.jobs) {
            result[name] = {
                intervalMs: job.intervalMs,
                lastRun: job.lastRun,
                runCount: job.runCount,
                errors: job.errors,
            };
        }
        return result;
    }
}

module.exports = new Scheduler();
