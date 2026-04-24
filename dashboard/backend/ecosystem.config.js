// ecosystem.config.js
// Phase 14: PM2 production configuration
module.exports = {
    apps: [{
        name: 'enterprise-pc-management',
        script: 'cluster.js',
        instances: 'max',
        exec_mode: 'fork', // cluster.js handles its own clustering
        max_memory_restart: '512M',
        env: {
            NODE_ENV: 'development',
            PORT: 3001,
        },
        env_production: {
            NODE_ENV: 'production',
            PORT: 3001,
        },
        log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
        error_file: './logs/pm2-error.log',
        out_file: './logs/pm2-out.log',
        merge_logs: true,
        watch: false,
        autorestart: true,
        restart_delay: 1000,
        max_restarts: 10,
    }],
};
