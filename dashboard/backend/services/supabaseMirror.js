// services/supabaseMirror.js
// Best-effort Supabase mirroring for PC sessions & activity logs
// All operations are fire-and-forget — failures never block main logic

const config = require('../config');
const supabase = require('./supabase');

// In-memory session ID cache: pcName -> supabase UUID
const sessionCache = new Map();

// Activity log batch queue
let activityQueue = [];
let batchTimer = null;

// ============================================================
// PC Session Mirroring
// ============================================================

/**
 * Called when an Agent connects via Socket.IO ('register-pc')
 * UPSERT into pc_sessions: status = 'online'
 */
async function onPcConnect(pcName, ipAddress) {
    if (!supabase) return;
    try {
        // Check if session already exists for this pc_name
        const { data: existing } = await supabase
            .from('pc_sessions')
            .select('id')
            .eq('pc_name', pcName)
            .maybeSingle();

        let sessionId;

        if (existing) {
            // UPDATE existing session
            const { data, error } = await supabase
                .from('pc_sessions')
                .update({
                    ip_address: ipAddress,
                    status: 'online',
                    created_at: new Date().toISOString(),
                })
                .eq('pc_name', pcName)
                .select('id')
                .single();

            if (error) throw error;
            sessionId = data.id;
        } else {
            // INSERT new session
            const { data, error } = await supabase
                .from('pc_sessions')
                .insert({
                    pc_name: pcName,
                    ip_address: ipAddress,
                    status: 'online',
                })
                .select('id')
                .single();

            if (error) throw error;
            sessionId = data.id;
        }

        sessionCache.set(pcName, sessionId);
        console.log(`[Supabase] PC 세션 등록: ${pcName} (${sessionId})`);
    } catch (err) {
        console.log(`[Supabase] 미러링 실패 (onPcConnect): ${err.message}`);
    }
}

/**
 * Called when an Agent disconnects ('disconnect')
 * UPDATE pc_sessions: status = 'offline'
 */
async function onPcDisconnect(pcName) {
    if (!supabase || !pcName) return;
    try {
        const { error } = await supabase
            .from('pc_sessions')
            .update({ status: 'offline' })
            .eq('pc_name', pcName);

        if (error) throw error;
        console.log(`[Supabase] PC 오프라인: ${pcName}`);
    } catch (err) {
        console.log(`[Supabase] 미러링 실패 (onPcDisconnect): ${err.message}`);
    }
}

/**
 * Called when a PC is locked
 * UPDATE pc_sessions: status = 'locked'
 */
async function onPcLock(pcName) {
    if (!supabase || !pcName) return;
    try {
        const { error } = await supabase
            .from('pc_sessions')
            .update({ status: 'locked' })
            .eq('pc_name', pcName);

        if (error) throw error;
        console.log(`[Supabase] PC 잠금: ${pcName}`);
    } catch (err) {
        console.log(`[Supabase] 미러링 실패 (onPcLock): ${err.message}`);
    }
}

/**
 * Called when a PC is unlocked
 * UPDATE pc_sessions: status = 'online'
 */
async function onPcUnlock(pcName) {
    if (!supabase || !pcName) return;
    try {
        const { error } = await supabase
            .from('pc_sessions')
            .update({ status: 'online' })
            .eq('pc_name', pcName);

        if (error) throw error;
        console.log(`[Supabase] PC 잠금 해제: ${pcName}`);
    } catch (err) {
        console.log(`[Supabase] 미러링 실패 (onPcUnlock): ${err.message}`);
    }
}

/**
 * Called when a screenshot is captured
 * UPDATE pc_sessions: last_screenshot_at = now()
 */
async function onScreenshot(pcName) {
    if (!supabase || !pcName) return;
    try {
        const { error } = await supabase
            .from('pc_sessions')
            .update({ last_screenshot_at: new Date().toISOString() })
            .eq('pc_name', pcName);

        if (error) throw error;
    } catch (err) {
        console.log(`[Supabase] 미러링 실패 (onScreenshot): ${err.message}`);
    }
}

// ============================================================
// Activity Log Mirroring (Batch INSERT)
// ============================================================

/**
 * Queue an activity event for batch INSERT
 * @param {string} pcName - PC name to resolve session ID
 * @param {string} eventType - 'app_open' | 'app_close' | 'web_visit' | 'lock' | 'unlock'
 * @param {object} details - { appName?, url? }
 */
function queueActivity(pcName, eventType, details = {}) {
    if (!supabase) return;

    const sessionId = sessionCache.get(pcName);
    if (!sessionId) {
        // No session ID cached — skip (PC might not have registered yet)
        return;
    }

    activityQueue.push({
        pc_session_id: sessionId,
        event_type: eventType,
        app_name: details.appName || null,
        url: details.url || null,
        created_at: new Date().toISOString(),
    });

    // Start batch timer if not already running
    if (!batchTimer) {
        batchTimer = setInterval(flushActivityQueue, config.SUPABASE_BATCH_INTERVAL_MS);
    }
}

/**
 * Flush the activity queue — batch INSERT into Supabase
 */
async function flushActivityQueue() {
    if (!supabase || activityQueue.length === 0) return;

    const batch = [...activityQueue];
    activityQueue = [];

    try {
        const { error } = await supabase
            .from('pc_activity_logs')
            .insert(batch);

        if (error) throw error;
        console.log(`[Supabase] 활동 로그 배치 전송: ${batch.length}건`);
    } catch (err) {
        console.log(`[Supabase] 미러링 실패 (flushActivityQueue): ${err.message}`);
        // Put failed items back to retry next cycle
        activityQueue.unshift(...batch);
        // Cap queue size to prevent memory leak
        if (activityQueue.length > 10000) {
            const dropped = activityQueue.length - 10000;
            activityQueue = activityQueue.slice(-10000);
            console.log(`[Supabase] 큐 오버플로우: ${dropped}건 삭제`);
        }
    }
}

/**
 * Flush remaining queue on shutdown (graceful)
 */
async function flush() {
    if (batchTimer) {
        clearInterval(batchTimer);
        batchTimer = null;
    }
    await flushActivityQueue();
}

// ============================================================
// Exports
// ============================================================

module.exports = {
    onPcConnect,
    onPcDisconnect,
    onPcLock,
    onPcUnlock,
    onScreenshot,
    queueActivity,
    flush,
    // Exposed for health check
    get isEnabled() { return !!supabase; },
    get queueSize() { return activityQueue.length; },
    get sessionCount() { return sessionCache.size; },
};
