(function () {
    const tr = key => window.StudioI18n?.t?.(key) || key;
    const trf = (key, values) => window.StudioI18n?.format?.(key, values) || tr(key);
    const get = id => document.getElementById('handoff-' + id);
    let state = {};
    let message = 'handoff.checking';
    let busy = false;
    let conflicts = null;
    let conflictError = '';
    let selectedCopies = new Set();
    let cleanupBackup = '';
    function cleanupControls() {
        get('cleanup-selection').textContent = trf('handoff.cleanupSelection', {count: selectedCopies.size});
        get('cleanup-confirm').disabled = busy;
        get('cleanup-action').disabled = busy || !selectedCopies.size || !get('cleanup-confirm').checked;
    }
    function fileDetails(item) {
        const box = document.createElement('div');
        box.style.overflowWrap = 'anywhere';
        const path = document.createElement('code');
        path.textContent = item.path;
        if (item.retained) {
            const heading = document.createElement('strong');
            heading.textContent = tr('handoff.copyFile');
            heading.style.display = 'block';
            box.append(heading);
        }
        box.append(path);
        const detail = document.createElement('p');
        detail.className = 'runtime-detail';
        detail.textContent = item.readable
            ? `${tr('handoff.fileSize')}: ${item.size} · ${tr('handoff.fileModified')}: ${new Date(item.modified_ns / 1000000).toLocaleString(window.StudioI18n?.lang?.() === 'en' ? 'en-US' : 'zh-CN')}`
            : tr('handoff.fileUnreadable');
        if (item.readable) {
            const disclosure = document.createElement('details');
            const summary = document.createElement('summary');
            summary.textContent = tr('handoff.fileDigest');
            const digest = document.createElement('code');
            digest.textContent = item.sha256;
            disclosure.append(summary, detail, digest);
            box.append(disclosure);
        } else box.append(detail);
        if (item.retained?.readable) {
            const heading = document.createElement('strong');
            heading.textContent = tr('handoff.keepDatabase');
            box.prepend(heading, fileDetails(item.retained));
            const comparison = item.comparison;
            if (comparison?.valid && !item.same_as_current) {
                const counts = document.createElement('p');
                counts.dataset.handoffComparison = '';
                counts.textContent = comparison.current_nodes === undefined
                    ? trf('handoff.recordComparison', {current: comparison.current_records, copy: comparison.copy_records})
                    : trf('handoff.canvasComparison', {currentCanvases: comparison.current_canvases, copyCanvases: comparison.copy_canvases, currentNodes: comparison.current_nodes, copyNodes: comparison.copy_nodes});
                box.append(counts);
                if (comparison.current_nodes !== undefined) {
                    const difference = document.createElement('p');
                    difference.textContent = trf('handoff.nodeDifference', {currentOnly: comparison.current_only, copyOnly: comparison.copy_only, changed: comparison.changed});
                    box.append(difference);
                    if (comparison.affected_canvases.length) {
                        const names = document.createElement('p');
                        names.textContent = trf('handoff.affectedCanvases', {titles: comparison.affected_canvases.join(window.StudioI18n?.lang?.() === 'en' ? ', ' : '、')});
                        box.append(names);
                    }
                }
                const limit = document.createElement('p');
                limit.className = 'runtime-detail';
                limit.textContent = tr('handoff.comparisonLimit');
                box.append(limit);
            }
        }
        if (conflicts?.can_cleanup && item.kind) {
            const advice = document.createElement('p');
            advice.textContent = tr(!item.can_remove ? 'handoff.cannotRemove' : item.recommended_remove ? 'handoff.recommendSame' : 'handoff.reviewDifferent');
            box.insertBefore(advice, box.querySelector('[data-handoff-comparison]'));
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.setAttribute('aria-label', trf('handoff.removeCopy', {path: item.path}));
            checkbox.checked = selectedCopies.has(item.path);
            checkbox.disabled = busy || !item.can_remove;
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) selectedCopies.add(item.path); else selectedCopies.delete(item.path);
                get('cleanup-confirm').checked = false;
                cleanupControls();
            });
            label.append(checkbox, document.createTextNode(tr('handoff.selectCopy')));
            box.append(label);
        } else if (item.kind && item.readable && (item.kind === 'database' || conflicts?.current?.readable)) {
            const comparison = document.createElement('p');
            comparison.textContent = tr(item.kind === 'database' ? 'handoff.databaseCopy' : item.same_as_current ? 'handoff.sameContent' : 'handoff.differentContent');
            box.append(comparison);
        }
        return box;
    }
    function render() {
        get('message').textContent = tr(message);
        get('preparation').hidden = state.state !== 'ready';
        get('result').hidden = state.state !== 'sealed';
        get('recovery').hidden = state.state !== 'recovery';
        get('close').hidden = !['ready', 'failed'].includes(state.state);
        get('back').hidden = ['sealed', 'failed'].includes(state.state);
        get('code').textContent = state.id || '';
        for (const id of ['close', 'accept', 'copy', 'rescan']) get(id).disabled = busy;
        get('conflicts').hidden = !['ready', 'failed', 'recovery'].includes(state.state) || (!conflicts?.files?.length && !conflictError && state.code !== 'handoff.conflict' && message !== 'handoff.conflict');
        const recovering = state.state === 'recovery';
        get('recovery-conflicts-note').hidden = !recovering;
        get('close-conflicts-note').hidden = recovering;
        get('confirm-conflicts-label').hidden = !recovering;
        get('archive').hidden = !recovering;
        get('conflicts-error').textContent = conflictError ? tr(conflictError)
            : conflicts && !conflicts.files.length ? tr(recovering ? 'handoff.noConflicts' : 'handoff.closeNoConflicts') : '';
        get('current-heading').hidden = !conflicts?.current?.readable;
        get('current-file').hidden = !conflicts?.current?.readable;
        get('cleanup').hidden = !conflicts?.can_cleanup || !conflicts?.files?.length;
        get('cleanup-saved').hidden = !cleanupBackup;
        get('cleanup-saved').textContent = cleanupBackup ? trf('handoff.cleanupSaved', {path: cleanupBackup}) : '';
        cleanupControls();
        get('current-file').replaceChildren(...(conflicts ? [fileDetails(conflicts.current)] : []));
        get('conflict-files').replaceChildren(...(conflicts?.files || []).map(item => {
            const row = document.createElement('li');
            row.style.marginBlockEnd = 'var(--ui-space-6)';
            row.append(fileDetails(item));
            return row;
        }));
        get('backup-path').textContent = conflicts?.backup_directory || '';
        get('conflicts-manual').hidden = !recovering || !conflicts?.files?.length || conflicts.can_archive;
        get('confirm-conflicts').disabled = busy || !conflicts?.can_archive;
        get('archive').disabled = busy || !conflicts?.can_archive || !get('confirm-conflicts').checked || !String(get('expected').value || '').trim();
    }
    async function request(url, body) {
        const response = await fetch(url, body === undefined ? {cache: 'no-store'} : {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
        });
        const result = await response.json();
        if (!response.ok) {
            const code = result.code;
            throw new Error(typeof code === 'string' && code.startsWith('handoff.') && tr(code) !== code ? code : 'handoff.failed');
        }
        return result;
    }
    async function loadConflicts() {
        get('confirm-conflicts').checked = false;
        get('cleanup-confirm').checked = false;
        selectedCopies = new Set();
        try {
            conflicts = await request(state.state === 'recovery' ? '/api/runtime/recovery/handoff/conflicts' : '/api/runtime/handoff/conflicts', {});
            conflictError = '';
            selectedCopies = new Set(conflicts.can_cleanup ? conflicts.files.filter(item => item.recommended_remove).map(item => item.path) : []);
            if (!conflicts.files.length && message === 'handoff.conflict') {
                message = state.state === 'recovery' ? 'handoff.noConflicts' : 'handoff.closeNoConflicts';
            }
        } catch (_) { conflicts = null; conflictError = 'handoff.conflictsLoadFailed'; }
        render();
    }
    get('cleanup-confirm').addEventListener('change', cleanupControls);
    get('cleanup-action').addEventListener('click', async () => {
        if (get('cleanup-action').disabled) return;
        const payload = {conflict_snapshot: conflicts.snapshot, selected: [...selectedCopies], confirmed: true};
        busy = true; message = 'handoff.checking'; render();
        try {
            const result = await request('/api/runtime/handoff/conflicts/cleanup', payload);
            cleanupBackup = result.backup_directory;
            state = await request('/api/runtime/handoff', {});
            message = 'handoff.sealed';
        } catch (error) {
            try { await refresh(); } catch (_) { /* Retain the last visible evidence. */ }
            message = error.message;
            get('message').focus();
        } finally { busy = false; render(); }
    });
    get('confirm-conflicts').addEventListener('change', render);
    get('language').addEventListener('click', () => window.StudioI18n?.toggle?.());
    get('theme').addEventListener('click', () => window.StudioTheme?.set?.(document.documentElement.dataset.uiTheme === 'dark' ? 'light' : 'dark'));
    get('expected').addEventListener('input', render);
    get('rescan').addEventListener('click', async () => {
        if (busy) return;
        busy = true; render();
        try { await loadConflicts(); } finally { busy = false; render(); }
    });
    async function refresh() {
        state = await request('/api/runtime/handoff');
        message = state.state === 'sealed' ? 'handoff.sealed'
            : state.state === 'recovery' ? (state.code?.startsWith('handoff.') ? state.code : 'handoff.required')
            : state.state === 'checking' ? 'handoff.checking' : state.state === 'failed' ? (state.code || 'handoff.failed') : 'handoff.ready';
        if (['recovery', 'failed'].includes(state.state)) await loadConflicts();
        render();
        if (state.state === 'checking') setTimeout(() => refresh().catch(() => {}), 1000);
    }
    get('close').addEventListener('click', async () => {
        if (busy) return;
        busy = true; message = 'handoff.checking'; render();
        try {
            state = await request('/api/runtime/handoff', {});
            message = 'handoff.sealed';
        } catch (error) {
            try { await refresh(); } catch (_) { /* Keep the retry surface. */ }
            message = error.message;
            if (state.state === 'ready' && message === 'handoff.conflict') await loadConflicts();
            get('message').focus();
        } finally { busy = false; render(); }
    });
    async function accept(archive) {
        if (busy) return;
        busy = true; message = 'handoff.checking'; render();
        try {
            const result = await request('/api/runtime/recovery/handoff', {handoff_id: String(get('expected').value || '').trim(), ...(archive ? {conflict_snapshot: conflicts.snapshot} : {})});
            if (result.stage !== 'stopping') throw new Error('handoff.failed');
            window.location.assign('/startup');
        } catch (error) {
            message = error.message;
            await loadConflicts();
            get('message').focus();
        }
        finally { busy = false; render(); }
    }
    get('accept').addEventListener('click', () => accept(false));
    get('archive').addEventListener('click', () => {
        if (!get('archive').disabled) accept(true);
    });
    get('copy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(state.id); message = 'handoff.copied'; }
        catch (_) { message = 'handoff.copyManually'; }
        render();
    });
    window.addEventListener('studio-lang-change', render);
    render();
    refresh().catch(error => { message = error.message.startsWith('handoff.') ? error.message : 'handoff.failed'; render(); });
})();
