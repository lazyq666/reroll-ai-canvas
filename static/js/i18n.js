(function(){
    const scripts = [
        '/static/js/i18n-core.js?v=asset-976eaa307e53',
        '/static/js/i18n/common.js?v=asset-7ab45e9a34a3',
        '/static/js/i18n/auth.js?v=asset-2ba9c7942691',
        '/static/js/i18n/onboarding.js?v=asset-9a22ee5eeebb',
        '/static/js/i18n/workspace.js?v=asset-e7df5eb37a5a',
        '/static/js/i18n/model-management.js?v=asset-1bf67142968a',
        '/static/js/i18n/preferences.js?v=asset-cd5d16f96ff2',
        '/static/js/i18n/cloud-storage.js?v=asset-fc781e53df50',
        '/static/js/cloud-records.js?v=asset-672387e62ee0',
        '/static/js/i18n/batch-generation.js?v=asset-aa8ad2ab65ec',
        '/static/js/i18n/runtime.js?v=asset-e09efc015212',
        '/static/js/i18n/studio.js?v=asset-34fb7359684e',
        '/static/js/i18n/api-settings.js?v=asset-f28dcf5d22d3',
        '/static/js/i18n/canvas.js?v=asset-c67be66a8f33',
        '/static/js/i18n/smart-canvas.js?v=asset-6711cdcc656d',
        '/static/js/i18n/comfyui-settings.js?v=asset-e76b21e14c6a',
    ];
    const tags = scripts.map(src => '<script src="' + src + '"></script>').join('');
    if(document.readyState === 'loading' && document.currentScript){
        document.write(tags);
        return;
    }
    scripts.reduce((promise, src) => promise.then(() => new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    })), Promise.resolve()).then(() => window.StudioI18n?.apply?.()).catch(err => console.error('Failed to load i18n modules', err));
})();
