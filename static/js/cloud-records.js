(function () {
    if (window.__cloudRecordsFetchInstalled) return;
    window.__cloudRecordsFetchInstalled = true;
    const originalFetch = window.fetch.bind(window);
    function message(code) {
        const key = 'cloudStorage.' + code;
        const translated = window.StudioI18n?.t?.(key);
        return translated && translated !== key ? translated : window.StudioI18n?.t?.('cloudStorage.unavailable');
    }
    // Existing request callers retain their error handling and pending Operation
    // IDs. Translate only this storage service's protocol errors at the boundary.
    window.fetch = async function (...args) {
        const response = await originalFetch(...args);
        if (response.ok || !response.headers.get('content-type')?.includes('json')) return response;
        let payload;
        try { payload = await response.clone().json(); } catch (_) { return response; }
        const code = payload?.code || payload?.detail?.code;
        if (typeof code !== 'string' || !code.startsWith('cloud_storage_')) return response;
        const headers = new Headers(response.headers);
        headers.delete('content-length');
        headers.delete('content-encoding');
        return new Response(JSON.stringify({ ...payload, detail: message(code) }), {
            status: response.status, statusText: response.statusText, headers,
        });
    };
})();
