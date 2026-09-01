/* Keep browser-level page zoom disabled while preserving app-owned canvas zoom. */
(function(){
    if(window.__studioPageZoomGuardInstalled) return;
    window.__studioPageZoomGuardInstalled = true;

    const listenerOptions = {capture:true, passive:false};
    const shortcutKeys = new Set(['+', '=', '-', '_', 'Add', 'Subtract']);
    const shortcutCodes = new Set(['NumpadAdd', 'NumpadSubtract']);

    function preventPageZoom(event){
        event.preventDefault();
    }

    function onZoomWheel(event){
        if(event.ctrlKey || event.metaKey) preventPageZoom(event);
    }

    function onZoomShortcut(event){
        if(!(event.ctrlKey || event.metaKey) || event.altKey) return;
        if(shortcutKeys.has(event.key) || shortcutCodes.has(event.code)) preventPageZoom(event);
    }

    function lockViewportScale(){
        const viewport = document.querySelector('meta[name="viewport"]');
        if(!viewport) return;
        const content = String(viewport.getAttribute('content') || '')
            .split(',')
            .map(part => part.trim())
            .filter(Boolean)
            .filter(part => !/^(?:minimum-scale|maximum-scale|user-scalable)\s*=/i.test(part));
        content.push('minimum-scale=1.0', 'maximum-scale=1.0', 'user-scalable=no');
        viewport.setAttribute('content', content.join(', '));
    }

    lockViewportScale();
    window.addEventListener('wheel', onZoomWheel, listenerOptions);
    document.addEventListener('keydown', onZoomShortcut, listenerOptions);
    document.addEventListener('gesturestart', preventPageZoom, listenerOptions);
    document.addEventListener('gesturechange', preventPageZoom, listenerOptions);
    document.addEventListener('gestureend', preventPageZoom, listenerOptions);
})();
