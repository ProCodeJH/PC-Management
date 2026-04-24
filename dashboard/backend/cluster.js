// cluster.js
// Phase 14: Cluster mode for multi-core utilization
// Run with: node cluster.js (instead of node server.js)

const cluster = require('cluster');
const os = require('os');

if (cluster.isPrimary) {
    const numCPUs = Math.min(os.cpus().length, 4); // Cap at 4 workers
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║  ENTERPRISE PC MANAGEMENT — CLUSTER MODE ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  Primary PID: ${process.pid.toString().padEnd(27)}║`);
    console.log(`║  Workers:     ${numCPUs.toString().padEnd(27)}║`);
    console.log(`║  CPUs:        ${os.cpus().length.toString().padEnd(27)}║`);
    console.log('╚══════════════════════════════════════════╝');
    console.log('');

    // Fork workers
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    // Restart crashed workers
    cluster.on('exit', (worker, code, signal) => {
        console.error(`Worker ${worker.process.pid} died (code: ${code}, signal: ${signal}). Restarting...`);
        setTimeout(() => cluster.fork(), 1000);
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\nGraceful shutdown — stopping all workers...');
        for (const id in cluster.workers) {
            cluster.workers[id].process.kill('SIGTERM');
        }
        setTimeout(() => process.exit(0), 3000);
    });

} else {
    // Workers run the server
    require('./server');
}
