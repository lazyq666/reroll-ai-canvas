/* Pairing is approved only by this signed-in browser; never receives the secret. */
(() => {
    if (window.top !== window) return;
    const tr = key => window.StudioI18n?.t?.(key) || key;
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    let dialog, current, snapshot, busy = false, polling = false, error = '';
    function render() {
        if (!dialog || !current) return;
        dialog.label = tr('agent.pair.title');
        const allowed = snapshot.enabled || snapshot.can_enable;
        dialog.innerHTML = `<div class="preferences-body">
            <p>${esc(tr('agent.pair.description'))}</p>
            <strong>${esc(current.name)}</strong>
            <p>${esc(tr('agent.pair.source'))}: ${esc(current.ip)}</p>
            <p>${esc(tr('agent.pair.code'))}: <strong>${esc(current.code)}</strong></p>
            <p>${esc(tr('agent.pair.account'))}: <strong>${esc(snapshot.account)}</strong></p>
            <p>${esc(tr('agent.pair.permissions'))}</p>
            ${!snapshot.enabled ? `<ic-alert tone="warning">${esc(tr(snapshot.can_enable?'agent.pair.enable':'agent.disabled'))}</ic-alert>` : ''}
            ${error ? `<ic-alert tone="danger">${esc(tr(error==='token_limit'?'agent.tokenLimit':'agent.error'))}</ic-alert>` : ''}
        </div>
        <ic-button slot="footer" data-decision="no" ${busy?'disabled':''}>${esc(tr('agent.pair.no'))}</ic-button>
        <ic-button slot="footer" hierarchy="primary" data-decision="yes" ${busy || !allowed?'disabled':''}>${esc(tr('agent.pair.yes'))}</ic-button>`;
    }
    async function close() {
        const old = dialog; dialog = null; current = null;
        if (old) { await old.hide(); old.remove(); }
    }
    async function decide(approve) {
        if (busy || !current) return;
        busy = true; error = ''; render();
        try {
            const response = await fetch('/api/account/agent-pairings/' + encodeURIComponent(current.id), {
                method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({approve})
            });
            const result = await response.json();
            if (!response.ok && result.code !== 'pairing_closed') throw new Error(result.code);
            await close();
        } catch (e) { error = e.message; }
        finally { busy = false; render(); }
    }
    async function poll() {
        if (polling || busy || document.visibilityState !== 'visible') return;
        polling = true;
        try {
            const response = await fetch('/api/account/agent-pairings');
            if (!response.ok) { await close(); return; }
            snapshot = await response.json();
            if (current) {
                if (!snapshot.requests.some(item=>item.id===current.id)) await close();
                return;
            }
            if (document.querySelector('ic-dialog[open], ic-confirmation-dialog[open]')) return;
            current = snapshot.requests[0];
            if (!current) return;
            await customElements.whenDefined('ic-dialog');
            dialog = document.createElement('ic-dialog');
            dialog.id = 'agent-pairing-dialog'; dialog.className = 'preferences-dialog'; dialog.setAttribute('size','small');
            dialog.addEventListener('click', event=>{
                const decision = event.target.closest('[data-decision]')?.dataset.decision;
                if (decision) decide(decision==='yes');
            });
            dialog.addEventListener('ic-hide', event=>{
                if (event.detail?.reason === 'programmatic') return;
                event.preventDefault();
                if (!busy) decide(false);
            });
            error = ''; render(); document.body.appendChild(dialog);
            await dialog.updateComplete;
            await dialog.show();
        } catch (_) { /* Retry transient/offline states without interrupting work. */ }
        finally { polling = false; }
    }
    window.addEventListener('studio-lang-change',render);
    document.addEventListener('visibilitychange',poll);
    setInterval(poll, 3000);
    poll();
})();
