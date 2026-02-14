// services/supabase.js
// Supabase client initialization for mirroring
// Uses service_role key (server-side only, bypasses RLS)

const config = require('../config');

let supabase = null;

if (config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY) {
    try {
        const { createClient } = require('@supabase/supabase-js');
        supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
            auth: { persistSession: false },
        });
        console.log('[Supabase] 클라이언트 초기화 완료');
    } catch (err) {
        console.log(`[Supabase] 클라이언트 초기화 실패: ${err.message}`);
        supabase = null;
    }
} else {
    console.log('[Supabase] 환경변수 미설정 — 미러링 비활성화');
}

module.exports = supabase;
