(async function () {
    'use strict';
    // Preserve the explicit, read-only prototype; normal Lab routes use the paid service.
    if (['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname) && new URLSearchParams(location.search).get('prototype') === 'music') {
        const { mountMusicPrototype } = await import('/static/js/music-lab-prototype.js?v=asset-599dfa358df6');
        await mountMusicPrototype();
        return;
    }
    await Promise.all(['ic-button', 'ic-select', 'ic-radio-group', 'ic-checkbox', 'ic-textarea', 'ic-input', 'ic-slider', 'ic-number-input', 'ic-dialog', 'ic-icon-button'].map(name => customElements.whenDefined(name)));
    const $ = id => document.getElementById(id);
    const tr = key => window.StudioI18n.t(key);
    const trf = (key, values) => window.StudioI18n.format(key, values);
    const active = new Set(['queued', 'running', 'pending', 'in_progress', 'processing']);
    const state = { records: new Map(), selected: '', cursor: '', busy: false, loading: false,
        references: [], config: null, message: '', tone: 'neutral', detailSignature: '', view: 'create', search: '', librarySignatures: new Map(), receipts: new Map(), formats: new Map() };
    const labels = { model: 'music.version', version: 'music.version', custom: 'music.mode', instrumental: 'music.instrumental',
        prompt: 'music.idea', title: 'music.trackTitle', style: 'music.style', negative_tags: 'music.negativeTags',
        auto_lyrics: 'music.autoLyrics', persona_id: 'music.persona', vocal_gender: 'music.vocalGender',
        style_weight: 'music.styleWeight', weirdness_constraint: 'music.weirdness', audio_weight: 'music.audioWeight',
        variety: 'music.variety', audio_format: 'music.outputFormat', duration: 'music.duration', max_mode: 'music.maxMode',
        tags: 'music.style', weirdness: 'music.weirdness', audioFilePath: 'music.url', audio_index: 'music.track', formats: 'music.exportFormats', task_id: 'music.taskId' };
    function text(tag, value, className) {
        const element = document.createElement(tag); element.textContent = value;
        if (className) element.className = className;
        return element;
    }
    function button(key, fn, hierarchy = 'secondary') {
        const element = text('ic-button', tr(key)); element.setAttribute('hierarchy', hierarchy);
        element.addEventListener('click', fn); return element;
    }
    function notify(key, tone = 'neutral', scope = $('recordDialog').open ? 'detailMessage' : 'musicMessage') {
        state.message = key; state.tone = tone; state.messageScope = scope;
        for (const id of ['musicMessage', 'detailMessage']) {
            $(id).setAttribute('data-i18n', key || 'music.ready');
            $(id).textContent = tr(key || 'music.ready');
            $(id).setAttribute('tone', tone); $(id).hidden = !key || id !== scope;
        }
    }
    async function api(path, options = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 75000);
        try {
            const response = await fetch('/api/music' + path, { ...options, signal: controller.signal,
                headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers } });
            const data = await response.json();
            if (!response.ok) {
                const validation = Array.isArray(data.detail) ? data.detail : [];
                const code = data.detail?.code || validation.map(entry => {
                    const field = entry.loc?.at(-1);
                    if (entry.type === 'string_too_long') return { title: 'music.titleTooLong', style: 'music.styleTooLong', tags: 'music.styleTooLong',
                        prompt: true ? 'music.lyricsTooLong' : 'music.promptTooLong' }[field];
                    if (field === 'duration') return 'music.invalidDuration';
                    return String(entry.msg).match(/music\.[A-Za-z]+/)?.[0];
                }).find(Boolean);
                throw new Error(code === 'music.invalidLyrics' && ($('lyricsMode').value === 'automatic') ? 'music.invalidTheme'
                    : code || (response.status === 422 ? 'music.invalidSettings' : 'music.networkError'));
            }
            return data;
        } finally { clearTimeout(timer); }
    }
    function errorKey(error, fallback = 'music.networkError') {
        const key = String(error?.message || '');
        return key.startsWith('music.') && tr(key) !== key ? key : fallback;
    }
    function bindLabel(element, key) {
        element.setAttribute('data-i18n-label', key); element.setAttribute('label', tr(key));
    }
    function promptKey(params) {
        return params.operation === 'inspo' ? (params.auto_lyrics ? 'music.theme' : 'music.lyrics') : !params.custom || params.instrumental ? 'music.idea' : params.auto_lyrics ? 'music.theme' : 'music.lyrics';
    }
    function invalidField(key, id) {
        const error = new Error(key); error.fieldId = id; return error;
    }
    function operation() { return state.references.length ? $('referenceMode').value : 'generate'; }
    function coverTags() { return ($('musicType').value === 'instrumental' ? [$('prompt').value, $('style').value] : [$('style').value]).map(value => value.trim()).filter(Boolean).join(', '); }
    function coverError() {
        if (operation() === 'inspo' && $('musicType').value === 'instrumental') return 'music.inspireInstrumental';
        if (operation() !== 'cover') return '';
        if (state.references.length !== 1) return 'music.coverOneReference';
        if (state.references.some(ref => ref.duration >= 480)) return 'music.coverReferenceTooLong';
        return '';
    }
    function showView(view) {
        state.view = view; $('musicView').value = view;
        $('createView').hidden = view !== 'create'; $('libraryView').hidden = view !== 'library';
    }
    function updateForm() {
        const reference = state.references.length > 0, inspiration = operation() === 'inspo', cover = operation() === 'cover', instrumental = $('musicType').value === 'instrumental';
        $('musicType').hidden = false;
        $('referenceMode').hidden = !reference;
        $('lyricsMode').hidden = instrumental;
        $('referenceVoiceHint').hidden = !inspiration;
        $('coverHint').hidden = !cover;
        const dropKey = cover ? 'music.coverDropReference' : 'music.dropReferences';
        $('referenceDropLabel').setAttribute('data-i18n', dropKey); $('referenceDropLabel').textContent = tr(dropKey);
        const refCount = $('referenceList').querySelector('[data-reference-count]');
        if (refCount) refCount.textContent = trf(cover ? 'music.coverReferenceCount' : 'music.referenceCount', { count: state.references.length });
        $('coverWarning').hidden = !coverError();
        $('coverWarning').setAttribute('data-i18n', coverError() || 'music.coverOneReference');
        $('coverWarning').textContent = tr(coverError() || 'music.coverOneReference');
        $('unsupportedReference').hidden = !inspiration;
        $('setDuration').disabled = inspiration; $('persona').disabled = inspiration;
        $('duration').disabled = inspiration || !$('setDuration').checked;
        $('setAudioWeight').disabled = !reference;
        $('audioWeight').disabled = !reference || !$('setAudioWeight').checked;
        $('chooseReferences').disabled = state.references.length >= 4;
        $('referenceDrop').dataset.full = String(state.references.length >= 4);
        for (const id of ['styleWeight', 'weirdness']) $(id).disabled = !$('overrideWeights').checked;
        $('vocalGender').disabled = instrumental;
        const key = promptKey({ operation: operation(), custom: true, instrumental, auto_lyrics: $('lyricsMode').value === 'automatic' });
        bindLabel($('prompt'), key);
        const placeholder = cover && instrumental ? 'music.coverPlaceholder' : reference ? ($('lyricsMode').value === 'automatic' ? 'music.referenceThemePlaceholder' : 'music.referenceLyricsPlaceholder')
            : instrumental ? 'music.ideaPlaceholder' : $('lyricsMode').value === 'automatic' ? 'music.themePlaceholder' : 'music.lyricsPlaceholder';
        $('prompt').setAttribute('data-i18n-placeholder', placeholder); $('prompt').setAttribute('placeholder', tr(placeholder));
        $('promptCount').textContent = cover && instrumental ? trf('music.coverCount', { count: [...coverTags()].length }) : `${[...$('prompt').value].length} / 5000`;
        $('submitMusic').disabled = state.busy || !state.config?.providers.length || !!coverError();
        $('submitMusic').loading = state.busy; $('musicForm').inert = state.busy;
    }
    function settings() {
        const reference = state.references.length > 0, inspiration = operation() === 'inspo', cover = operation() === 'cover';
        if (coverError()) throw invalidField(coverError(), operation() === 'inspo' ? 'referenceMode' : 'chooseReferences');
        if (cover && [...coverTags()].length > 1000) throw invalidField($('musicType').value === 'instrumental' ? 'music.coverDescriptionTooLong' : 'music.styleTooLong', $('musicType').value === 'instrumental' ? 'prompt' : 'style');
        const custom = true;
        const body = { version: $('version').value, custom, instrumental: ($('musicType').value === 'instrumental'), prompt: $('prompt').value };
        if (!reference && body.instrumental && !body.prompt.trim()) throw invalidField('music.invalidPrompt', 'prompt');
        if ((!reference || cover) && custom && !body.instrumental && !body.prompt.trim()) throw invalidField(($('lyricsMode').value === 'automatic') ? 'music.invalidTheme' : 'music.invalidLyrics', 'prompt');
        if ([...body.prompt].length > (custom ? 5000 : 3000)) throw invalidField(custom ? 'music.lyricsTooLong' : 'music.promptTooLong', 'prompt');
        if (custom) {
            Object.assign(body, { title: $('songTitle').value, style: $('style').value, negative_tags: $('negativeTags').value,
                persona_id: $('persona').value, auto_lyrics: !($('musicType').value === 'instrumental') && ($('lyricsMode').value === 'automatic'), max_mode: $('maxMode').checked });
            if ([...body.title].length > 80) throw invalidField('music.titleTooLong', 'songTitle');
            if ([...body.style].length > 1000) throw invalidField('music.styleTooLong', 'style');
            if (!inspiration && $('setDuration').checked) {
                body.duration = Number($('duration').value);
                if (!Number.isInteger(body.duration) || body.duration < 10 || body.duration > 360) throw invalidField('music.invalidDuration', 'duration');
            }
        }
        if ($('vocalGender').value !== 'auto' && !($('musicType').value === 'instrumental')) body.vocal_gender = $('vocalGender').value;
        if ($('variety').value !== 'auto') body.variety = $('variety').value;
        if ($('audioFormat').value !== 'auto') body.audio_format = $('audioFormat').value;
        if ($('overrideWeights').checked) {
            body.style_weight = Number($('styleWeight').value) / 100;
            body.weirdness_constraint = Number($('weirdness').value) / 100;
        }
        if (inspiration) {
            if (!state.references.length) throw invalidField('music.referenceRequired', 'chooseReferences');
            delete body.custom; delete body.instrumental; delete body.persona_id;
            body.tags = body.style; delete body.style;
            if (body.weirdness_constraint != null) { body.weirdness = body.weirdness_constraint; delete body.weirdness_constraint; }
        }
        if (reference && $('setAudioWeight').checked) body.audio_weight = Number($('audioWeight').value) / 100;
        return body;
    }
    function clearReferences() {
        for (const ref of state.references) if (ref.file) URL.revokeObjectURL(ref.url);
        state.references = [];
    }
    function renderReferences() {
        const audios = new Map([...$('referenceList').querySelectorAll('audio')].map(audio => [audio.getAttribute('src'), audio]));
        $('referenceList').replaceChildren(...state.references.map((ref, index) => {
            const card = text('div', '', 'reference-card');
            const heading = text('div', '', 'reference-heading'); heading.append(text('span', ref.name, 'reference-name'));
            const remove = button('music.removeReference', () => {
                card.querySelector('audio')?.pause();
                if (ref.file) URL.revokeObjectURL(ref.url);
                state.references.splice(index, 1); renderReferences(); updateForm();
            }, 'quiet');
            remove.setAttribute('size', 'small'); remove.setAttribute('aria-label', trf('music.removeReferenceName', { name: ref.name })); heading.append(remove);
            const audio = audios.get(ref.url) || document.createElement('audio'); audio.controls = true; audio.preload = 'metadata';
            if (!audio.getAttribute('src')) audio.src = ref.url;
            audio.setAttribute('aria-label', trf('music.play', { title: ref.name }));
            audio.onerror = () => notify('music.referencePlaybackFailed', 'warning');
            audio.onloadedmetadata = () => { if (Number.isFinite(audio.duration)) ref.duration = audio.duration; updateForm(); };
            audio.hidden = true;
            const preview = button('music.preview', () => { audio.hidden = !audio.hidden; if (audio.hidden) audio.pause(); else audio.play().catch(() => notify('music.referencePlaybackFailed', 'warning')); }, 'quiet');
            preview.setAttribute('size', 'small'); preview.setAttribute('aria-label', trf('music.play', { title: ref.name }));
            heading.insertBefore(preview, remove); card.append(heading, audio); return card;
        }));
        if (state.references.length) {
            const count = text('p', trf(operation() === 'cover' ? 'music.coverReferenceCount' : 'music.referenceCount', { count: state.references.length }), 'hint');
            count.dataset.referenceCount = ''; $('referenceList').prepend(count);
        }
    }
    function addReferences(files) {
        const added = [...files];
        if (added.length + state.references.length > 4) { notify('music.referenceTooMany', 'danger'); return; }
        if (added.some(file => !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name) || !file.size)) { notify('music.referenceType', 'danger'); return; }
        if (added.some(file => file.size > (state.config?.reference_max_bytes || 50 * 1024 * 1024))) { notify('music.referenceSize', 'danger'); return; }
        state.references.push(...added.map(file => ({ file, name: file.name, url: URL.createObjectURL(file), identity: crypto.randomUUID() })));
        notify(''); renderReferences(); updateForm();
    }
    $('chooseReferences').addEventListener('click', () => $('referenceFiles').click());
    $('referenceFiles').addEventListener('change', event => { addReferences(event.target.files); event.target.value = ''; });
    for (const type of ['dragenter', 'dragover']) $('referenceDrop').addEventListener(type, event => {
        event.preventDefault(); if (!state.busy) $('referenceDrop').classList.add('drag-over');
    });
    $('referenceDrop').addEventListener('dragleave', () => $('referenceDrop').classList.remove('drag-over'));
    $('referenceDrop').addEventListener('drop', event => {
        event.preventDefault(); $('referenceDrop').classList.remove('drag-over'); if (!state.busy) addReferences(event.dataTransfer.files);
    });
    // Prevent dropping outside the target from navigating the frame away from a draft.
    for (const type of ['dragover', 'drop']) document.addEventListener(type, event => { if ([...(event.dataTransfer?.types || [])].includes('Files')) event.preventDefault(); });
    function timestamp(value) {
        const language = window.StudioI18n.lang?.() || document.documentElement.lang;
        return new Date(value * 1000).toLocaleString(language.startsWith('en') ? 'en-US' : 'zh-CN',
            { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    function statusKey(record) { return 'music.status.' + (active.has(record.status) ? (record.status === 'queued' ? 'queued' : 'running') : record.status); }
    function recordTitle(record) { return record.params?.title || record.params?.prompt || tr('music.operation.' + record.operation); }
    function renderHistory() {
        const all = [...state.records.values()].sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id));
        const records = all.filter(record => record.operation !== 'download' || !state.records.has(record.source_run_id));
        const query = state.search.trim().toLocaleLowerCase();
        const visible = records.filter(record => !query || [recordTitle(record), record.params?.style, record.params?.tags,
            ...(record.result?.items || []).map(item => item.title)].join(' ').toLocaleLowerCase().includes(query));
        const current = new Map([...$('historyList').children].map(el => [el.dataset.runId, el]));
        const present = new Set();
        for (const [position, record] of visible.entries()) {
            const exports = all.filter(item => item.operation === 'download' && item.source_run_id === record.id);
            const signature = JSON.stringify([record, exports, window.StudioI18n.lang?.()]);
            let row = current.get(record.id); present.add(record.id);
            if (!row || state.librarySignatures.get(record.id) !== signature) {
                const old = row, audios = new Map([...(old?.querySelectorAll('audio') || [])].map(audio => [audio.getAttribute('src'), audio]));
                row = text('article', '', 'music-record'); row.dataset.runId = record.id;
                const heading = text('div', '', 'history-heading');
                const open = button('music.recordDetails', () => select(record.id), 'quiet');
                open.className = 'history-item'; open.replaceChildren(text('span', recordTitle(record), 'history-title')); heading.append(open, badge(record)); row.append(heading);
                row.append(text('p', `${timestamp(record.created_at)} · ${record.params?.version || 'APIMart'} · ${tr('music.operation.' + record.operation)}`, 'hint'));
                if (active.has(record.status)) row.append(text('p', tr('music.pendingHint'), 'hint'));
                if (record.error_code) row.append(text('p', tr(record.error_code), 'history-error'));
                if (record.status === 'succeeded') {
                    const tracks = text('div', '', 'library-tracks');
                    for (const [index, item] of (record.result?.items || []).entries()) tracks.append(trackCard(record, item, index, audios, true));
                    row.append(tracks);
                }
                const actions = text('div', '', 'track-actions');
                if (['generate', 'inspo', 'cover'].includes(record.operation)) actions.append(button('music.reuse', () => reuse(record), 'quiet'));
                actions.append(button('music.recordDetails', () => select(record.id), 'quiet'));
                for (const output of exports) {
                    const openExport = button('music.exportFormats', () => select(output.id), 'quiet');
                    openExport.textContent = `${tr('music.exportFormats')} · ${tr(statusKey(output))}`; actions.append(openExport);
                }
                row.append(actions); state.librarySignatures.set(record.id, signature);
                if (old) old.replaceWith(row);
            }
            const next = $('historyList').children[position];
            if (next !== row) $('historyList').insertBefore(row, next || null);
        }
        for (const [id, row] of current) if (!present.has(id)) row.remove();
        $('historyStatus').hidden = visible.length > 0;
        if (!visible.length && !state.loading) {
            $('historyStatus').removeAttribute('data-i18n'); $('historyStatus').textContent = tr(query ? 'music.noResults' : 'music.emptyHistory');
        }
        $('moreHistory').hidden = !state.cursor;
    }
    function select(id) { state.selected = id; renderHistory(); renderDetail(); $('recordDialog').show(); }
    function detailEmpty() {
        const box = text('div', '', 'detail-empty'); box.append(text('h2', tr('music.chooseRecord')), text('p', tr('music.chooseHint'))); return box;
    }
    function badge(record) {
        const element = text('ic-badge', tr(statusKey(record))); element.setAttribute('kind', 'label');
        element.setAttribute('tone', record.status === 'succeeded' ? 'success' : record.status === 'failed' ? 'danger' : 'neutral'); return element;
    }
    async function download(record, item, index, control) {
        control.disabled = true;
        try {
            const response = await fetch(`/api/music/runs/${encodeURIComponent(record.id)}/audio/${index}?download=true`);
            if (!response.ok) throw new Error('music.downloadError');
            const url = URL.createObjectURL(await response.blob());
            const anchor = document.createElement('a'); anchor.href = url;
            anchor.download = (item.title || 'Suno').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_') + '.' + (item.format || 'mp3');
            document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
        } catch (error) { notify(errorKey(error, 'music.downloadError'), 'danger'); }
        finally { control.disabled = false; }
    }
    function trackCard(record, item, index, audioNodes, compact = false) {
        const card = document.createElement('ic-card'); card.className = 'track-card';
        const title = item.title || trf('music.track', { number: item.audio_index || index + 1 });
        const heading = text('div', '', 'track-heading'); heading.append(text('span', String(index + 1).padStart(2, '0'), 'track-number'));
        const copy = text('div', '', 'track-copy'); copy.append(text('h3', title));
        if (item.duration) copy.append(text('p', trf('music.durationValue', { seconds: Math.round(item.duration * 10) / 10 }), 'hint'));
        if (item.display_tags || item.tags) copy.append(text('p', item.display_tags || item.tags, 'hint'));
        heading.append(copy); card.append(heading);
        if (item.url) {
            const src = `/api/music/runs/${encodeURIComponent(record.id)}/audio/${index}`;
            const audio = audioNodes.get(src) || document.createElement('audio');
            audio.controls = true; audio.preload = 'none'; if (!audio.getAttribute('src')) audio.src = src;
            audio.setAttribute('aria-label', trf('music.play', { title }));
            card.append(audio);
            const controls = text('div', '', 'track-actions');
            const save = button('music.download', () => download(record, item, index, save));
            save.textContent = trf('music.download', { format: (item.format || 'mp3').toUpperCase() }); controls.append(save); card.append(controls);
        } else card.append(text('p', tr('music.noPlayback'), 'hint'));
        if (item.lyrics && !compact) {
            const details = document.createElement('details'); details.append(text('summary', tr('music.lyricsResult')), text('pre', item.lyrics, 'lyrics')); card.append(details);
        }
        if (!compact && record.operation !== 'download' && item.audio_id) {
            const details = document.createElement('details'); details.className = 'export-options'; details.append(text('summary', tr('music.exportFormats')));
            const options = text('div', '', 'format-options'), key = record.id + ':' + item.audio_index;
            if (!state.formats.has(key)) state.formats.set(key, new Set(['wav']));
            for (const format of ['mp3', 'm4a', 'wav']) {
                const checkbox = document.createElement('ic-checkbox'); checkbox.setAttribute('label', format.toUpperCase());
                checkbox.dataset.format = format; checkbox.checked = state.formats.get(key).has(format);
                checkbox.addEventListener('change', () => checkbox.checked ? state.formats.get(key).add(format) : state.formats.get(key).delete(format)); options.append(checkbox);
            }
            details.append(options, text('p', tr('music.exportHint'), 'hint'));
            const exportButton = button('music.export', async () => {
                const formats = [...state.formats.get(key)];
                if (!formats.length) { notify('music.noFormats', 'danger'); return; }
                exportButton.disabled = true; exportButton.loading = true;
                try {
                    const result = await api(`/runs/${encodeURIComponent(record.id)}/downloads`, { method: 'POST', body: JSON.stringify({ audio_index: item.audio_index, formats }) });
                    state.records.set(result.id, result); select(result.id); notify('music.accepted', 'success');
                } catch (error) { notify(errorKey(error), 'danger'); }
                finally { exportButton.disabled = false; exportButton.loading = false; }
            }); details.append(exportButton); card.append(details);
        }
        return card;
    }
    function parameterValue(key, value) {
        if (key === 'custom') return tr(value ? 'music.custom' : 'music.simple');
        if (typeof value === 'boolean') return tr(value ? 'music.yes' : 'music.no');
        if (key === 'variety') return tr('music.variety.' + value);
        if (key === 'vocal_gender') return tr(value === 'Male' ? 'music.male' : 'music.female');
        if (['style_weight', 'weirdness_constraint', 'weirdness', 'audio_weight'].includes(key)) return `${Math.round(value * 100)}%`;
        return Array.isArray(value) ? value.join(', ').toUpperCase() : String(value);
    }
    function renderDetail(force = false) {
        const record = state.records.get(state.selected);
        const signature = JSON.stringify([record?.id, record?.status, record?.result, record?.error_code]);
        if (!force && signature === state.detailSignature) return;
        state.detailSignature = signature;
        if (!record) { $('recordDetail').replaceChildren(detailEmpty()); return; }
        const audios = new Map([...$('recordDetail').querySelectorAll('audio')].map(audio => [audio.getAttribute('src'), audio]));
        const fragment = document.createDocumentFragment(), header = text('div', '', 'detail-header');
        header.append(text('h2', tr('music.operation.' + record.operation)), badge(record)); fragment.append(header);
        fragment.append(text('p', `${timestamp(record.created_at)} · ${record.params.version ? 'Suno ' + record.params.version : 'APIMart'}`, 'hint record-meta'));
        if (active.has(record.status)) {
            const pending = text('ic-alert', tr('music.pendingHint')); pending.setAttribute('tone', 'neutral'); pending.setAttribute('role', 'status'); fragment.append(pending);
        }
        if (record.error_code) {
            const alert = text('ic-alert', tr(record.error_code)); alert.setAttribute('tone', 'danger'); alert.setAttribute('role', 'alert'); fragment.append(alert);
            if (record.recoverable) fragment.append(button('music.resume', async event => {
                const control = event.currentTarget; control.disabled = true;
                try { const result = await api(`/runs/${encodeURIComponent(record.id)}/resume`, { method: 'POST' }); state.records.set(result.id, result); renderHistory(); renderDetail(); }
                catch (error) { notify(errorKey(error), 'danger'); }
                finally { control.disabled = false; }
            }));
        }
        if (record.status === 'succeeded') {
            for (const [index, item] of (record.result?.items || []).entries()) fragment.append(trackCard(record, item, index, audios));
            if (typeof record.result?.credits_cost === 'number') fragment.append(text('p', trf('music.cost', { credits: record.result.credits_cost }), 'hint'));
        }
        if (['generate', 'inspo', 'cover'].includes(record.operation)) fragment.append(button('music.reuse', () => reuse(record)));
        if (record.source_run_id) fragment.append(button('music.sourceRecord', async () => {
            try { if (!state.records.has(record.source_run_id)) { const source = await api('/runs/' + encodeURIComponent(record.source_run_id)); state.records.set(source.id, source); } select(record.source_run_id); }
            catch (error) { notify(errorKey(error), 'danger'); }
        }));
        if (record.references?.length) {
            const references = text('details', '', 'record-references'); references.append(text('summary', tr('music.references')));
            for (const ref of record.references) {
                const card = text('div', '', 'reference-card'); card.append(text('p', ref.name, 'reference-name'));
                const audio = audios.get(ref.url) || document.createElement('audio'); audio.controls = true; audio.preload = 'none';
                if (!audio.getAttribute('src')) audio.src = ref.url;
                audio.setAttribute('aria-label', trf('music.play', { title: ref.name })); card.append(audio); references.append(card);
            }
            fragment.append(references);
        }
        const details = document.createElement('details'); details.className = 'settings-details'; details.append(text('summary', tr('music.params')));
        const list = text('dl', '', 'settings-list');
        for (const [key, value] of Object.entries(record.params || {})) {
            if (key === 'model' || value === '' || value === null || !labels[key]) continue;
            const label = key === 'prompt' ? promptKey({ ...record.params, operation: record.operation })
                : key === 'audio_weight' && ['inspo', 'cover'].includes(record.operation) ? 'music.referenceWeight' : labels[key];
            list.append(text('dt', key === 'audio_index' ? trf(label, { number: value }) : tr(label)), text('dd', parameterValue(key, value)));
        }
        if (record.remote_task_id) list.append(text('dt', tr('music.taskId')), text('dd', record.remote_task_id));
        for (const [index, item] of (record.result?.items || []).entries()) {
            if (item.audio_id) list.append(text('dt', `${tr('music.audioId')} · ${trf('music.track', { number: item.audio_index || index + 1 })}`), text('dd', item.audio_id));
        }
        details.append(list); fragment.append(details);
        $('recordDetail').replaceChildren(fragment);
    }
    function reuse(record) {
        const p = record.params;
        clearReferences(); state.references = (record.references || []).map((ref, index) => ({ ...ref, run_id: record.id, index })); renderReferences();
        if (state.config?.providers.some(provider => provider.id === record.provider_id)) $('provider').value = record.provider_id;
        $('version').value = p.version;
        for (const [id, key] of Object.entries({ prompt: 'prompt', songTitle: 'title', style: 'style', negativeTags: 'negative_tags', persona: 'persona_id', vocalGender: 'vocal_gender', variety: 'variety', audioFormat: 'audio_format' })) $(id).value = p[key] ?? (['vocalGender', 'variety', 'audioFormat'].includes(id) ? 'auto' : '');
        $('musicType').value = p.instrumental ? 'instrumental' : 'song';
        $('referenceMode').value = record.operation === 'inspo' ? 'inspo' : 'cover';
        $('lyricsMode').value = p.auto_lyrics || (record.operation === 'generate' && !p.custom) ? 'automatic' : 'manual';
        $('maxMode').checked = !!p.max_mode;
        if (record.operation === 'inspo') $('style').value = p.tags || '';
        $('setAudioWeight').checked = p.audio_weight != null; $('audioWeight').value = Math.round((p.audio_weight ?? .5) * 100);
        $('setDuration').checked = p.duration != null; $('duration').value = p.duration ?? 60;
        $('overrideWeights').checked = ['style_weight', 'weirdness_constraint', 'weirdness'].some(key => p[key] != null);
        for (const [id, key] of Object.entries({ styleWeight: 'style_weight', weirdness: 'weirdness_constraint' })) $(id).value = Math.round((p[key] ?? (key === 'weirdness_constraint' ? p.weirdness : null) ?? .5) * 100);
        $('recordDialog').hide(); showView('create'); updateForm(); $('prompt').focus(); notify('music.settingsReused', 'success');
    }
    async function loadHistory(more = false, quiet = false) {
        if (state.loading) return;
        state.loading = true;
        if (!quiet) $('refreshMusic').loading = true;
        try {
            const page = await api('/history' + (more && state.cursor ? '?cursor=' + encodeURIComponent(state.cursor) : ''));
            for (const record of page.items) state.records.set(record.id, record);
            if (more || !state.cursor || !quiet) state.cursor = page.next_cursor;
            const visibleIds = new Set(page.items.map(item => item.id));
            await Promise.all([...state.records.values()].filter(record => active.has(record.status) && !visibleIds.has(record.id)).map(async record => {
                const updated = await api('/runs/' + encodeURIComponent(record.id)); state.records.set(updated.id, updated);
            }));
            if (!state.selected && page.items.length) state.selected = page.items[0].id;
            state.loading = false; renderHistory(); renderDetail();
        } catch (error) {
            $('historyStatus').removeAttribute('data-i18n'); $('historyStatus').hidden = false; $('historyStatus').textContent = tr('music.loadFailed');
            if (!quiet) notify(errorKey(error, 'music.loadFailed'), 'danger');
        } finally { state.loading = false; $('refreshMusic').loading = false; }
    }
    async function loadConfig() {
        try {
            state.config = await api('/config');
            const selected = $('provider').value;
            $('provider').replaceChildren(...state.config.providers.map(provider => new Option(provider.name, provider.id)));
            $('provider').syncOptions(); $('provider').value = state.config.providers.some(p => p.id === selected) ? selected : state.config.providers[0]?.id || '';
            if (!state.config.providers.length) notify('music.noProvider', 'warning');
            else if (state.message === 'music.noProvider') notify('');
        } catch (error) { notify(errorKey(error, 'music.loadFailed'), 'danger'); }
        updateForm();
    }
    $('submitMusic').addEventListener('click', async () => {
        if (state.busy || !state.config?.providers.length) return;
        let payload, endpoint;
        try {
            payload = { provider_id: $('provider').value, settings: settings() };
            endpoint = { inspo: '/inspirations', cover: '/covers', generate: '/generations' }[operation()];
            if (endpoint !== '/generations') payload.references = state.references.map(ref => ref.file
                ? { identity: ref.identity } : { run_id: ref.run_id, index: ref.index });
        } catch (error) { notify(errorKey(error, 'music.invalidSettings'), 'danger'); if (error.fieldId) $(error.fieldId).focus(); return; }
        const fingerprint = endpoint + JSON.stringify(payload);
        if (!state.receipts.has(fingerprint)) state.receipts.set(fingerprint, crypto.randomUUID());
        payload.operation_id = state.receipts.get(fingerprint);
        state.busy = true; updateForm(); notify('');
        try {
            let body = JSON.stringify(payload);
            if (endpoint !== '/generations') {
                const form = new FormData(); let fileIndex = 0;
                payload.references = state.references.map(ref => {
                    if (!ref.file) return { run_id: ref.run_id, index: ref.index };
                    form.append('files', ref.file); return { file_index: fileIndex++ };
                });
                form.append('payload', JSON.stringify(payload)); body = form;
            }
            const record = await api(endpoint, { method: 'POST', body });
            state.records.set(record.id, record); showView('library'); state.selected = record.id; renderHistory(); renderDetail(); state.receipts.delete(fingerprint); notify('music.accepted', 'success');
        } catch (error) { notify(errorKey(error), 'danger'); await loadHistory(false, true); }
        finally { state.busy = false; updateForm(); }
    });
    $('musicView').addEventListener('change', () => showView($('musicView').value));
    $('searchMusic').addEventListener('input', () => { state.search = $('searchMusic').value; renderHistory(); });
    $('recordDialog').addEventListener('ic-after-hide', () => $('recordDetail').querySelectorAll('audio').forEach(audio => audio.pause()));
    $('refreshMusic').addEventListener('click', () => { loadConfig(); loadHistory(); });
    $('moreHistory').addEventListener('click', () => loadHistory(true));
    for (const id of ['musicType', 'referenceMode', 'lyricsMode', 'overrideWeights', 'setDuration', 'setAudioWeight']) $(id).addEventListener('change', updateForm);
    for (const id of ['prompt', 'style']) $(id).addEventListener('input', updateForm);
    $('examplePrompt').addEventListener('click', () => {
        const reference = operation() === 'inspo';
        $('prompt').value = tr(reference ? 'music.referenceExample' : 'music.examplePrompt');
        if (reference) $('lyricsMode').value = 'automatic'; else $('musicType').value = 'instrumental';
        updateForm();
    });
    document.addEventListener('play', event => {
        if (event.target.localName === 'audio') document.querySelectorAll('audio').forEach(audio => { if (audio !== event.target) audio.pause(); });
    }, true);
    function route() {
        const suno = location.hash === '#suno'; $('labLanding').hidden = suno; $('sunoWorkbench').hidden = !suno;
        document.title = tr(suno ? 'music.title' : 'nav.lab');
        if (suno && !state.config) { loadConfig(); loadHistory(); }
    }
    addEventListener('hashchange', route);
    addEventListener('studio-lang-change', () => {
        updateForm(); renderReferences(); renderHistory(); renderDetail(true); notify(state.message, state.tone, state.messageScope);
        document.querySelectorAll('ic-select').forEach(select => { select.syncOptions(); select.selectionChanged(); });
        document.title = tr(location.hash === '#suno' ? 'music.title' : 'nav.lab');
    });
    addEventListener('message', event => {
        if (event.origin !== location.origin) return;
        if (event.data?.type === 'studio-lang') window.StudioI18n.set(event.data.lang);
        if (event.data?.type === 'providers-changed') loadConfig();
    });
    setInterval(() => { if (!document.hidden && location.hash === '#suno') loadHistory(false, true); }, 5000);
    renderDetail(); route();
})();
