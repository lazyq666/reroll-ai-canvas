(function(){
    const scripts = [
        '/static/js/i18n-core.js?v=asset-976eaa307e53',
        '/static/js/i18n/common.js?v=asset-8ec8ff88d043',
        '/static/js/i18n/auth.js?v=asset-e53e0e071b46',
        '/static/js/i18n/onboarding.js?v=asset-c0905b266684',
        '/static/js/i18n/workspace.js?v=asset-7215af28bacf',
        '/static/js/i18n/model-management.js?v=asset-cdfb2e799470',
        '/static/js/i18n/preferences.js?v=asset-b70f79d26565',
        '/static/js/i18n/cloud-storage.js?v=asset-d576e6096d48',
        '/static/js/cloud-records.js?v=asset-672387e62ee0',
        '/static/js/i18n/batch-generation.js?v=asset-6fc9182239cf',
        '/static/js/i18n/runtime.js?v=asset-79ccf6645e07',
        '/static/js/i18n/music.js?v=asset-0a39d18bfaa5',
        '/static/js/i18n/studio.js?v=asset-1b9c7049dc10',
        '/static/js/i18n/api-settings.js?v=asset-d4e27ef9dfd8',
        '/static/js/i18n/canvas.js?v=asset-28dcb54266bc',
        '/static/js/i18n/smart-canvas.js?v=asset-62dada93b1bf',
        '/static/js/i18n/comfyui-settings.js?v=asset-6700cf6d6c3f',
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
