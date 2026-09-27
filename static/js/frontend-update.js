/* The top-level workbench owns update prompts, including its Canvas frames. */
(function(){
    if(window.StudioFrontendUpdate) return;
    try { if(window.parent !== window && window.parent.location.origin === location.origin) return; }
    catch(_error){ /* A separately embedded page owns its own prompt. */ }

    const pollMs = 60000;
    const snoozeMs = 10 * 60000;
    let baseline = '', latest = null, checking = false, refreshing = false;
    let snoozedKey = '', snoozedUntil = 0, notice, errorKey = '', returnFocus;
    const positionObserver = new ResizeObserver(() => positionNotice());
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
        return pageWindows().some(page => page.document.querySelector('ic-dialog[open], ic-confirmation-dialog[open], dialog[open]'));
    }
    function positionNotice(){
        if(!notice || notice.hidden) return;
        let bottom = 24;
        // Keep the actual navigation map available, including inside the workbench frame.
        for(const page of pageWindows()){
            const minimap = page.document.querySelector('ic-smart-minimap');
            if(!minimap || !minimap.checkVisibility()) continue;
            let rect = minimap.getBoundingClientRect(), top = rect.top, right = rect.right;
            let owner = page;
            let visible = true;
            while(owner !== window){
                const frame = owner.frameElement;
                if(!frame?.checkVisibility()){ visible = false; break; }
                rect = frame.getBoundingClientRect();
                top = rect.top + top * rect.height / owner.innerHeight;
                right = rect.left + right * rect.width / owner.innerWidth;
                owner = owner.parent;
            }
            if(visible && top > 0 && top < innerHeight && right > innerWidth - notice.offsetWidth - 24){
                bottom = Math.max(bottom, innerHeight - top + 12);
            }
        }
        // On a short window, keep the card's actions reachable even with a tall map.
        notice.style.bottom = `${Math.min(bottom, Math.max(24, innerHeight - notice.offsetHeight - 24))}px`;
    }
    function hideNotice(){
        if(!notice) return;
        const restore = notice.contains(document.activeElement);
        notice.hidden = true;
        positionObserver.disconnect();
        if(restore && returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
    }
    function dismiss(){
        if(refreshing) return;
        snoozedKey = latest.key;
        snoozedUntil = Date.now() + snoozeMs;
        errorKey = '';
        hideNotice();
    }
    function translate(){
        if(!notice) return;
        const confirm = notice.querySelector('[data-update-action="apply"]');
        confirm.dataset.i18n = `frontendUpdate.${refreshing ? 'saving' : 'refresh'}`;
        for(const element of notice.querySelectorAll('[data-i18n]')){
            element.textContent = tr(element.dataset.i18n);
        }
        notice.querySelector('[data-update-action="close"]').setAttribute('label', tr('frontendUpdate.close'));
        for(const button of notice.querySelectorAll('ic-button, ic-icon-button')) button.disabled = refreshing;
        confirm.loading = refreshing;
        notice.setAttribute('aria-busy', String(refreshing));
        notice.querySelector('[data-i18n="frontendUpdate.description"]').hidden = Boolean(errorKey);
        const message = notice.querySelector('[role="status"]');
        message.hidden = !errorKey;
        message.textContent = errorKey ? tr(errorKey) : '';
        positionNotice();
    }
    async function refresh(){
        if(refreshing) return;
        refreshing = true;
        errorKey = '';
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
            translate();
        }
    }
    async function showPrompt(){
        if(!latest || latest.key === baseline || document.hidden || otherDialogOpen()) return;
        if(latest.key === snoozedKey && Date.now() < snoozedUntil) return;
        await Promise.all(['ic-button', 'ic-icon-button'].map(name => customElements.whenDefined(name)));
        if(document.hidden || otherDialogOpen()) return;
        if(!notice){
            notice = document.createElement('section');
            notice.id = 'frontendUpdateNotice';
            notice.className = 'frontend-update-notice';
            notice.setAttribute('aria-labelledby', 'frontendUpdateTitle');
            notice.hidden = true;
            notice.innerHTML = `
                <span class="frontend-update-icon" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 4.8A6 6 0 0 0 6 10c0 5-2 6-2 6h16s-2-1-2-6M10 20h4M12 3v1"/>
                        <circle class="frontend-update-dot" cx="18" cy="5" r="3" stroke="none"/>
                    </svg>
                </span>
                <div class="frontend-update-copy">
                    <h2 id="frontendUpdateTitle" data-i18n="frontendUpdate.title" aria-live="polite"></h2>
                    <p data-i18n="frontendUpdate.description"></p>
                    <p role="status" hidden></p>
                </div>
                <ic-icon-button data-update-action="close" type="button" size="s" hierarchy="quiet" icon="close" data-i18n-label="frontendUpdate.close"></ic-icon-button>
                <div class="frontend-update-actions">
                    <ic-button data-update-action="later" type="button" size="s" hierarchy="quiet" data-i18n="frontendUpdate.later"></ic-button>
                    <ic-button data-update-action="apply" type="button" size="s" hierarchy="primary" data-i18n="frontendUpdate.refresh"></ic-button>
                </div>`;
            translate();
            notice.addEventListener('click', event => {
                event.stopPropagation();
                const action = event.target.closest('[data-update-action]')?.dataset.updateAction;
                if(action === 'apply') refresh();
                else if(action) dismiss();
            });
            notice.addEventListener('focusin', event => {
                if(event.relatedTarget && !notice.contains(event.relatedTarget)) returnFocus = event.relatedTarget;
            });
            notice.addEventListener('keydown', event => {
                event.stopPropagation();
                if(event.key === 'Escape'){ event.preventDefault(); dismiss(); }
            });
            for(const type of ['pointerdown', 'mousedown', 'dblclick', 'wheel']){
                notice.addEventListener(type, event => event.stopPropagation());
            }
            document.body.append(notice);
        }
        if(notice.hidden){
            returnFocus = document.activeElement;
            errorKey = '';
            notice.hidden = false;
            translate();
        }
        positionObserver.disconnect();
        positionObserver.observe(notice);
        for(const page of pageWindows()){
            const minimap = page.document.querySelector('ic-smart-minimap');
            if(minimap) positionObserver.observe(minimap);
        }
        positionNotice();
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
                hideNotice();
                return;
            }
            await showPrompt();
        } finally { checking = false; }
    }
    window.StudioFrontendUpdate = Object.freeze({check});
    window.addEventListener('studio-lang-change', translate);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    window.addEventListener('resize', positionNotice);
    document.addEventListener('visibilitychange', check);
    function start(){ check(); setInterval(check, pollMs); }
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
    else start();
})();
