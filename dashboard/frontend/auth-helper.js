// auth-helper.js — shared JWT auth for all pages
// Usage: const res = await authFetch('/api/endpoint', { method: 'POST', body: ... })

window.getAuthToken = function () {
    return localStorage.getItem('authToken') || null;
};

window.authFetch = async function (url, options = {}) {
    const token = window.getAuthToken();
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch(url, Object.assign({}, options, { headers }));

    if (res.status === 401 || res.status === 403) {
        // Prompt login
        const creds = window.promptLogin();
        if (creds) {
            const loginRes = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(creds)
            });
            if (loginRes.ok) {
                const data = await loginRes.json();
                const tok = data.token || (data.data && data.data.token);
                if (tok) {
                    localStorage.setItem('authToken', tok);
                    headers['Authorization'] = 'Bearer ' + tok;
                    return fetch(url, Object.assign({}, options, { headers }));
                }
            }
        }
    }
    return res;
};

window.promptLogin = function () {
    const u = prompt('관리자 아이디 (기본: admin):', 'admin');
    if (!u) return null;
    const p = prompt('비밀번호:');
    if (!p) return null;
    return { username: u, password: p };
};
