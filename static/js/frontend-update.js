/* The top-level workbench owns update prompts, including its Canvas frames. */
(function(){
    if(window.StudioFrontendUpdate) return;
    try { if(window.parent !== window && window.parent.location.origin === location.origin) return; }
    catch(_error){ /* A separately embedded page owns its own prompt. */ }

    const pollMs = 60000;
    const snoozeMs = 10 * 60000;
    let baseline = '', latest = null, checking = false, refreshing = false;
    let snoozedKey = '', snoozedUntil = 0, dialog, errorKey = '';
    const tr = key => window.StudioI18n?.t(key) || key;

    async function readVersion(){
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
            const response = await fetch('/api/app-info', {
                cache:'no-store', credentials:'same-origin', signal:controller.signal,
            });
            if(!response.ok) return null;
            const info = await response.json();
            if(typeof info.version !== 'string' || !info.version.trim()) return null;
            const revision = /^[a-f0-9]{64}$/.test(info.frontend_revision || '') ? info.frontend_revision : '';
            return {key:`${info.version}|${revision}`};
        } catch(_error){ return null; }
        finally { clearTimeout(timer); }
    }
    function pageWindows(root=window){
        const result = [root];
        for(const frame of root.document.querySelectorAll('iframe')){
            try {
                if(frame.contentWindow?.location.origin === location.origin) result.push(...pageWindows(frame.contentWindow));
            } catch(_error){ /* Cross-origin pages cannot belong to this workspace. */ }
        }
        return result;
    }
    function otherDialogOpen(){
        return pageWindows().some(page => [...page.document.querySelectorAll('ic-dialog[open], ic-confirmation-dialog[open]')]
            .some(element => element !== dialog));
    }
    function translate(){
        if(!dialog) return;
        for(const [attribute, key] of Object.entries({label:'title',
            'confirm-label':refreshing ? 'saving' : 'refresh', 'cancel-label':'later'})){
            dialog.setAttribute(`data-i18n-${attribute}`, `frontendUpdate.${key}`);
            dialog.setAttribute(attribute, tr(`frontendUpdate.${key}`));
        }
        dialog.querySelector('[data-i18n="frontendUpdate.description"]').textContent = tr('frontendUpdate.description');
        const message = dialog.querySelector('[role="alert"]');
        message.hidden = !errorKey;
        message.textContent = errorKey ? tr(errorKey) : '';
    }
    async function refresh(){
        if(refreshing) return;
        refreshing = true;
        errorKey = '';
        dialog.confirmLoading = true;
        translate();
        try {
            if(otherDialogOpen()) throw new Error('frontendUpdate.busy');
            const pages = pageWindows();
            const documents = pages.map(page => page.document);
            for(const page of pages){
                if(page.location.pathname !== '/static/smart-canvas.html') continue;
                const prepare = page.SmartCanvasModules?.preparePageRefresh;
                if(!prepare) throw new Error('frontendUpdate.busy');
                await prepare();
            }
            if(!await readVersion()) throw new Error('frontendUpdate.unavailable');
            // Saving can yield to edits, frame navigation, generation or a disconnect.
            const currentPages = pageWindows();
            if(currentPages.length !== pages.length || currentPages.some((page, index) => page !== pages[index] || page.document !== documents[index])
                || otherDialogOpen()) throw new Error('frontendUpdate.busy');
            for(const page of currentPages){
                if(page.location.pathname !== '/static/smart-canvas.html') continue;
                if(!page.SmartCanvasModules?.pageRefreshBlocked) throw new Error('frontendUpdate.busy');
                const blocked = page.SmartCanvasModules.pageRefreshBlocked();
                if(blocked) throw new Error(blocked);
                if(page.SmartCanvasModules.canvasPersistence.status().pending) throw new Error('frontendUpdate.unsynced');
            }
            location.reload();
        } catch(error){
            errorKey = ['frontendUpdate.busy','frontendUpdate.unavailable'].includes(error.message)
                ? error.message : 'frontendUpdate.unsynced';
            refreshing = false;
            dialog.confirmLoading = false;
            translate();
        }
    }
    async function showPrompt(){
        if(!latest || latest.key === baseline || document.hidden || otherDialogOpen()) return;
        if(latest.key === snoozedKey && Date.now() < snoozedUntil) return;
        await customElements.whenDefined('ic-confirmation-dialog');
        if(!dialog){
            dialog = document.createElement('ic-confirmation-dialog');
            dialog.id = 'frontendUpdateDialog';
            const description = document.createElement('p');
            description.setAttribute('data-i18n', 'frontendUpdate.description');
            dialog.append(description);
            const message = document.createElement('p');
            message.setAttribute('role', 'alert');
            message.hidden = true;
            dialog.append(message);
            translate();
            dialog.addEventListener('ic-confirm', refresh);
            dialog.addEventListener('ic-hide', event => {
                if(event.target !== dialog || refreshing || latest.key === baseline) return;
                snoozedKey = latest.key;
                snoozedUntil = Date.now() + snoozeMs;
                errorKey = '';
            });
            document.body.append(dialog);
        }
        if(!dialog.open){
            errorKey = '';
            translate();
            dialog.open = true;
        }
    }
    async function check(){
        if(checking || refreshing || document.hidden) return;
        checking = true;
        try {
            const value = await readVersion();
            if(!value) return;
            if(!baseline) baseline = value.key;
            latest = value;
            if(value.key === baseline){
                if(dialog) dialog.open = false;
                return;
            }
            await showPrompt();
        } finally { checking = false; }
    }
    window.StudioFrontendUpdate = Object.freeze({check});
    window.addEventListener('studio-lang-change', translate);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    function start(){ check(); setInterval(check, pollMs); }
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
    else start();
})();
