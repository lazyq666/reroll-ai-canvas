/* App connection installer and account preferences. */
(() => {
    const tr = key => window.StudioI18n?.t?.(key) || key;
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const downloadErrors = {'download_failed':'agent.install.downloadFailed','download_outdated':'agent.install.serverOutdated'};
    let dialog, state, user, busy = false, error = '', downloaded = false, downloading = false;
    let pending = {}, saving = false, saveError = false, invalidNumber = false, revision = 0;
    async function api(path, method='GET', body) {
        const response = await fetch(path, {method, headers:{'Content-Type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {})});
        const result = await response.json();
        if(!response.ok) throw new Error(result.code || 'operationFailed');
        return result;
    }
    async function perform(fn, isDownload=false) {
        if(busy) return;
        busy = true; downloading = isDownload; if(isDownload) downloaded=false; error = ''; render();
        try { await fn(); } catch(e) { error = e.message; }
        finally { busy = false; downloading = false; render(); }
    }
    const selected = (id, fallback) => dialog?.querySelector(id)?.getAttribute?.('value') || dialog?.querySelector(id)?.value || fallback;
    function render() {
        if(!dialog) return;
        invalidNumber = false;
        const client = selected('#agent-install-client','codex');
        const platform = selected('#agent-install-platform', /Win/i.test(globalThis.navigator?.userAgent || '') ? 'windows' : 'macos');
        const origin = globalThis.location?.origin || '';
        dialog.label = tr('agent.title');
        dialog.innerHTML = `<div class="preferences-body">
            ${!state ? `<p role="status">${esc(tr('agent.loading'))}</p>` : `
            <section class="preferences-section">
            <div class="agent-settings-row">
                <span>${esc(tr('agent.install.client'))}</span>
                <ic-tabs id="agent-install-client" label="${esc(tr('agent.install.client'))}" value="${esc(client)}" size="small" orientation="horizontal" activation="automatic" data-legal-combination="horizontal-automatic-label">
                    <button type="button" data-value="codex" ${busy?'disabled':''}>${esc(tr('agent.install.codex'))}</button>
                    <button type="button" data-value="claude-desktop" ${busy?'disabled':''}>${esc(tr('agent.install.desktop'))}</button>
                    <button type="button" data-value="claude-code" ${busy?'disabled':''}>${esc(tr('agent.install.code'))}</button>
                </ic-tabs>
            </div>
            <div class="agent-settings-row">
                <span>${esc(tr('agent.install.platform'))}</span>
                <ic-tabs id="agent-install-platform" label="${esc(tr('agent.install.platform'))}" value="${esc(platform)}" size="small" orientation="horizontal" activation="automatic" data-legal-combination="horizontal-automatic-label">
                    <button type="button" data-value="macos" ${busy?'disabled':''}>${esc(tr('agent.install.macos'))}</button>
                    <button type="button" data-value="windows" ${busy?'disabled':''}>${esc(tr('agent.install.windows'))}</button>
                </ic-tabs>
            </div>
            <div class="agent-settings-row"><span>${esc(tr('agent.install.address'))}</span><span class="agent-address">${esc(origin)}</span></div>
            <ic-button hierarchy="primary" data-action="download-installer" ${busy?'disabled':''}>${esc(tr(downloading?'agent.install.downloading':'agent.install.download'))}</ic-button>
            ${downloaded ? `<p role="status">${esc(tr('agent.install.downloaded'))}</p>` : ''}
            <ol>
                <li>${esc(tr('agent.install.steps'))}</li>
                <li id="agent-install-launch">${esc(tr(platform==='windows'?'agent.install.launchWindows':'agent.install.launchMac'))}</li>
                <li>${esc(tr('agent.install.restart'))}</li>
                <li>${esc(tr('agent.install.approve'))}</li>
            </ol>
            ${downloadErrors[error] ? `<ic-alert tone="danger">${esc(tr(downloadErrors[error]))}</ic-alert>` : ''}
            </section>
            <section class="preferences-section">
            <h3>${esc(tr('agent.settings'))}</h3>
            ${user?.role==='admin' ? `<div class="agent-settings-row"><div class="agent-settings-copy"><span id="agent-enabled-label">${esc(tr('agent.enabled'))}</span><p class="preferences-note">${esc(tr('agent.enabledHint'))}</p></div><ic-switch id="agent-enabled" label="${esc(tr('agent.enabled'))}" aria-labelledby="agent-enabled-label" ${state.enabled?'checked':''}></ic-switch></div>` : `<p>${esc(tr(state.enabled?'agent.available':'agent.disabled'))}</p>`}
            <div class="agent-settings-row"><span id="agent-concurrency-label">${esc(tr('agent.concurrency'))}</span><ic-number-input id="agent-concurrency" name="agent-concurrency" label="${esc(tr('agent.concurrency'))}" label-hidden aria-labelledby="agent-concurrency-label" min="1" max="8" value="${state.concurrency}"></ic-number-input></div>
            <div class="agent-settings-row"><span id="agent-confirmation-label">${esc(tr('agent.confirmation'))}</span><ic-switch id="agent-confirmation" label="${esc(tr('agent.confirmation'))}" aria-labelledby="agent-confirmation-label" ${state.confirmation?'checked':''}></ic-switch></div>
            <div id="agent-save-status" aria-live="polite"></div>
            </section>
            `}
            ${error && !downloadErrors[error] ? `<ic-alert tone="danger">${esc(tr('agent.error'))}</ic-alert><ic-button data-action="retry">${esc(tr('agent.retry'))}</ic-button>` : ''}
        </div>`;
        renderSaveStatus();
    }
    function renderSaveStatus() {
        const status = dialog?.querySelector('#agent-save-status');
        if(!status) return;
        status.innerHTML = invalidNumber ? `<ic-alert tone="danger">${esc(tr('agent.numberInvalid'))}</ic-alert>` : '';
        if(saveError) status.innerHTML += `<ic-alert tone="danger">${esc(tr('agent.saveFailed'))}</ic-alert><ic-button data-action="retry-save">${esc(tr('agent.retry'))}</ic-button>`;
        else if(saving) status.innerHTML += `<span role="status">${esc(tr('agent.saving'))}</span>`;
    }
    async function flushSettings() {
        if(saving || !Object.keys(pending).length) return;
        saving = true; saveError = false; renderSaveStatus();
        while(Object.keys(pending).length) {
            const values = pending; pending = {};
            try { await api('/api/account/agent-access','PATCH',values); }
            catch(_) {
                pending = {...values,...pending}; saveError = true; break;
            }
        }
        saving = false; renderSaveStatus();
    }
    function changeSetting(event) {
        const fields = {'agent-enabled':'enabled','agent-concurrency':'concurrency','agent-confirmation':'confirmation'};
        const target = (event.composedPath?.() || [event.target]).find(el=>fields[el.id]);
        const key = fields[target?.id];
        if(!state || !key || (key==='enabled' && user?.role!=='admin')) return;
        if(event.type==='input' && key!=='concurrency') return;
        const value = key==='concurrency' ? Number(target.value) : target.checked;
        if(key==='concurrency') {
            invalidNumber = !Number.isInteger(value) || value<1 || value>8;
            renderSaveStatus();
            if(invalidNumber) { target.value = String(state.concurrency); return; }
        }
        if(state[key]===value) return;
        state[key] = value; pending[key] = value; revision++;
        return flushSettings();
    }
    async function reload() {
        const startedAt = revision;
        const result = await api('/api/account/agent-access');
        if(startedAt===revision && !saving && !Object.keys(pending).length) state = result;
    }
    window.openAgentAccess = async () => {
        if(!dialog) {
            dialog=document.createElement('ic-dialog'); dialog.id='agent-access-dialog'; dialog.className='preferences-dialog'; dialog.setAttribute('size','medium');
            dialog.addEventListener('click',async event=>{
                const action=event.target.closest('[data-action]')?.dataset.action;
                if(action==='download-installer') {
                    const client=selected('#agent-install-client','codex');
                    const platform=selected('#agent-install-platform','macos');
                    return perform(async()=>{
                        downloaded=false;
                        try {
                            const response=await fetch('/api/account/agent-installer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client,platform,language:window.StudioI18n?.lang?.()==='en'?'en':'zh',url:location.origin})});
                            if(response.status===404 || response.status===405) throw new Error('download_outdated');
                            if(!response.ok) throw new Error('download_failed');
                            const url=URL.createObjectURL(await response.blob());
                            const link=document.createElement('a');link.href=url;link.download=`Reroll-MCP-${client}-${platform}.zip`;
                            document.body.appendChild(link);link.click();link.remove();
                            setTimeout(()=>URL.revokeObjectURL(url),60000);
                            downloaded=true;
                        } catch(e) { throw new Error(e.message==='download_outdated'?'download_outdated':'download_failed'); }
                    },true);
                }
                if(action==='retry') return perform(reload);
                if(action==='retry-save') return flushSettings();
            });
            dialog.addEventListener('input', changeSetting);
            dialog.addEventListener('change', changeSetting);
            dialog.addEventListener('ic-change', event=>{
                if(event.target.id==='agent-install-platform') dialog.querySelector('#agent-install-launch').textContent=tr(event.detail.value==='windows'?'agent.install.launchWindows':'agent.install.launchMac');
            });
            document.body.appendChild(dialog);
        }
        render(); await customElements.whenDefined('ic-dialog'); await dialog.show();
        await perform(async()=>{user=(await api('/api/auth/me')).user; await reload();});
    };
    window.addEventListener('studio-lang-change',()=>{if(dialog?.open) render();});
})();
