(async function () {
    'use strict';
    // Preserve the explicit, read-only prototype; normal Lab routes use the paid service.
    if (['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname) && new URLSearchParams(location.search).get('prototype') === 'music') {
        const { mountMusicPrototype } = await import('/static/js/music-lab-prototype.js?v=asset-599dfa358df6');
        await mountMusicPrototype();
        return;
    }
    await Promise.all(['ic-button', 'ic-select', 'ic-radio-group', 'ic-checkbox', 'ic-textarea', 'ic-input', 'ic-slider', 'ic-number-input', 'ic-dialog', 'ic-icon-button', 'ic-alert', 'ic-toast', 'ic-segmented-control', 'ic-icon', 'ic-generation-pending', 'ic-menu', 'ic-menu-item'].map(name => customElements.whenDefined(name)));
    const { createStackedFeedbackQueue } = await import('/static/js/infinite-canvas-ui/feedback-progress/stacked-feedback-queue.js?v=asset-b6a51c897f96');
    const $ = id => document.getElementById(id);
    const tr = key => window.StudioI18n.t(key);
    const trf = (key, values) => window.StudioI18n.format(key, values);
    const active = new Set(['queued', 'running', 'pending', 'in_progress', 'processing']);
    const state = { records: new Map(), selected: '', selectedIndex: null, downloadTrack: null, example: 0, exporting: new Set(), cursor: '', busy: false, loading: false,
        references: [], config: null, configLoading: false, historyError: '', notices: new Map(), toasts: new Map(),
        detailSignature: '', view: 'create', search: '', filter: 'all', sessionRuns: new Set(), playing: null, playerSignature: '', failedArtwork: new Set(), librarySignatures: new Map(), receipts: new Map(), formats: new Map(),
        deletedRecords: new Set(), deleteTarget: null, deleting: false, menuRecord: '', menuAnchor: null };
    const feedbackStacks = new Map(['musicFeedback', 'detailFeedback'].map(id => [id, createStackedFeedbackQueue({
        edge: 'start', visibleCount: 3, stackStepPx: 19, scaleStep: .045, exitDuration: 200,
        setPresented: (alert, visible) => alert.toggleAttribute('data-ic-stack-hidden', !visible),
    })]));
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
    function clearNotice(scope) {
        const notice = state.notices.get(scope);
        if (!notice) return;
        state.notices.delete(scope);
        notice.element.removeAttribute('id');
        feedbackStacks.get(notice.container).dismiss(notice.element);
    }
    function renderNotice(notice) {
        const { element, key, tone, retry } = notice;
        element.textContent = tr(key);
        element.setAttribute('data-i18n', key);
        element.setAttribute('tone', tone);
        element.setAttribute('heading', tr(tone === 'danger' ? 'music.errorTitle' : 'music.warningTitle'));
        if (retry) element.setAttribute('action-label', tr('music.retry'));
    }
    function notify(key, tone = 'neutral', scope = $('recordDialog').open ? 'detailMessage' : 'musicMessage', retry = null) {
        if (!key) { clearNotice(scope); return; }
        if (tone === 'success' || tone === 'neutral') {
            clearNotice(scope);
            const element = customElements.get('ic-toast').notify(tr(key), { tone });
            for (const toast of state.toasts.keys()) if (!toast.isConnected) state.toasts.delete(toast);
            state.toasts.set(element, key);
            return;
        }
        // One missing service can fail both startup reads. Present it once.
        if (scope === 'historyMessage' && state.notices.get('configMessage')?.key === key) return;
        if (scope === 'configMessage' && state.notices.get('historyMessage')?.key === key) clearNotice('historyMessage');
        const current = state.notices.get(scope);
        if (current?.key === key && current.tone === tone) return;
        clearNotice(scope);
        const container = scope === 'detailMessage' ? 'detailFeedback' : 'musicFeedback';
        const element = document.createElement('ic-alert'); element.id = scope;
        const notice = { element, key, tone, retry, container };
        element.setAttribute('dismissible', ''); renderNotice(notice);
        element.addEventListener('ic-dismiss', () => { element.hidden = false; clearNotice(scope); });
        if (retry) element.addEventListener('ic-action', retry);
        state.notices.set(scope, notice);
        $(container).prepend(element); feedbackStacks.get(container).enqueue(element);
    }
    async function api(path, options = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 75000);
        try {
            const response = await fetch('/api/music' + path, { ...options, signal: controller.signal,
                headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers } });
            const data = await response.json().catch(() => null);
            const fallback = options.method === 'DELETE' ? 'music.deleteFailed' : options.method === 'POST' ? 'music.networkError' : 'music.loadFailed';
            if (response.status === 401 && !data?.detail?.code) throw new Error('music.sessionExpired');
            if (response.status === 403 && !data?.detail?.code) throw new Error('music.accessDenied');
            if (response.status === 404 && !data?.detail?.code) throw new Error('music.serviceUnavailable');
            if (!response.ok) {
                const validation = Array.isArray(data?.detail) ? data.detail : [];
                const code = data?.detail?.code || validation.map(entry => {
                    const field = entry.loc?.at(-1);
                    if (entry.type === 'string_too_long') return { title: 'music.titleTooLong', style: 'music.styleTooLong', tags: 'music.styleTooLong',
                        prompt: 'music.lyricsTooLong' }[field];
                    if (field === 'duration') return 'music.invalidDuration';
                    return String(entry.msg).match(/music\.[A-Za-z]+/)?.[0];
                }).find(Boolean);
                throw new Error(code === 'music.invalidLyrics' && ($('lyricsMode').value === 'automatic') ? 'music.invalidTheme'
                    : code || (response.status === 422 ? 'music.invalidSettings' : fallback));
            }
            if (!data) throw new Error(fallback);
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
    function operation() { return state.references.length ? $('referenceMode').getAttribute('value') : 'generate'; }
    function coverTags() { return ($('musicType').checked ? [$('prompt').value, $('style').value] : [$('style').value]).map(value => String(value || '').trim()).filter(Boolean).join(', '); }
    function coverError() {
        if (operation() === 'inspo' && $('musicType').checked) return 'music.inspireInstrumental';
        if (operation() !== 'cover') return '';
        if (state.references.length !== 1) return 'music.coverOneReference';
        if (state.references.some(ref => ref.duration >= 480)) return 'music.coverReferenceTooLong';
        return '';
    }
    function showView(view) {
        state.view = view; $('musicView').value = view;
        $('sunoWorkbench').dataset.view = view;
    }
    function updateForm() {
        const reference = state.references.length > 0, inspiration = operation() === 'inspo', cover = operation() === 'cover', instrumental = $('musicType').checked;
        $('musicType').hidden = false;
        $('referenceFields').hidden = !reference;
        $('openPersona').disabled = inspiration || state.busy;
        $('persona').disabled = inspiration || state.busy; $('inlinePersona').disabled = inspiration || state.busy; $('inlinePersona').value = $('persona').value;
        $('version').disabled = state.busy;
        $('composerMode').toggleAttribute('disabled', state.busy);
        $('referenceMode').hidden = !reference;
        $('referenceMode').toggleAttribute('disabled', state.busy);
        $('lyricsMode').hidden = false; $('lyricsMode').disabled = instrumental;
        $('referenceVoiceHint').hidden = !inspiration;
        $('coverHint').hidden = !cover;
        $('referenceCount').textContent = trf(cover ? 'music.coverReferenceCount' : 'music.referenceCount', { count: state.references.length });
        $('coverWarning').hidden = !coverError();
        $('coverWarning').setAttribute('data-i18n', coverError() || 'music.coverOneReference');
        $('coverWarning').textContent = tr(coverError() || 'music.coverOneReference');
        $('unsupportedReference').hidden = !inspiration;
        $('setDuration').disabled = inspiration;
        $('duration').disabled = inspiration || !$('setDuration').checked;
        $('setAudioWeight').disabled = !reference;
        $('audioWeight').disabled = !reference || !$('setAudioWeight').checked;
        $('chooseReferences').disabled = state.references.length >= 4;
        $('chooseMoreReferences').disabled = state.references.length >= 4;
        $('referenceDrop').dataset.full = String(state.references.length >= 4);
        for (const id of ['styleWeight', 'weirdness']) $(id).disabled = !$('overrideWeights').checked;
        $('vocalGender').disabled = instrumental;
        const key = promptKey({ operation: operation(), custom: true, instrumental, auto_lyrics: $('lyricsMode').value === 'automatic' });
        $('promptHeading').setAttribute('data-i18n', key); $('promptHeading').textContent = tr(key);
        $('prompt').setAttribute('data-i18n-aria-label', key); $('prompt').setAttribute('aria-label', tr(key));
        const placeholder = cover && instrumental ? 'music.coverPlaceholder' : reference ? ($('lyricsMode').value === 'automatic' ? 'music.referenceThemePlaceholder' : 'music.referenceLyricsPlaceholder')
            : instrumental ? 'music.ideaPlaceholder' : $('lyricsMode').value === 'automatic' ? 'music.themePlaceholder' : 'music.lyricsPlaceholder';
        $('prompt').setAttribute('data-i18n-placeholder', placeholder); $('prompt').setAttribute('placeholder', tr(placeholder));
        $('promptCount').textContent = cover && instrumental ? trf('music.coverCount', { count: [...coverTags()].length }) : `${[...$('prompt').value].length} / 5000`;
        $('submitMusic').disabled = state.busy || !state.config?.providers.length || !!coverError();
        $('styleCount').textContent = `${[...$('style').value].length} / 1000`;
        for (const id of ['weirdness', 'styleWeight', 'audioWeight']) {
            $(id + 'Value').textContent = `${$(id).value}%`;
            $(id).setAttribute('value-text', `${$(id).value}%`);
        }
        for (const [id, selected] of [['chooseReferences', reference], ['openPersona', !!$('persona').value], ['inspireReference', inspiration]]) $(id).toggleAttribute('data-active', selected);
        $('resetDraft').disabled = state.busy;
        $('submitMusic').loading = state.busy; $('musicForm').inert = state.busy;
    }
    function revealField(id) {
        showView('create');
        if (['style', 'negativeTags', 'duration'].includes(id)) setComposerMode('detailed');
        if ($('advancedOptions').contains($(id))) $('advancedOptions').open = true;
        if (id === 'persona') $('personaDialog').show();
        if (id === 'referenceMode') $('referenceMode').querySelector('[aria-checked="true"]')?.focus();
        else $(id).focus();
    }
    function setComposerMode(mode) {
        $('composerMode').setAttribute('value', mode);
        $('styleSection').hidden = mode === 'simple';
        $('advancedOptions').hidden = mode === 'simple';
    }
    function settings() {
        const reference = state.references.length > 0, inspiration = operation() === 'inspo', cover = operation() === 'cover';
        if (coverError()) throw invalidField(coverError(), operation() === 'inspo' ? 'referenceMode' : 'chooseReferences');
        if (cover && [...coverTags()].length > 1000) throw invalidField($('musicType').checked ? 'music.coverDescriptionTooLong' : 'music.styleTooLong', $('musicType').checked ? 'prompt' : 'style');
        const custom = true;
        const body = { version: $('version').value, custom, instrumental: ($('musicType').checked), prompt: $('prompt').value || '' };
        if (!reference && body.instrumental && !body.prompt.trim()) throw invalidField('music.invalidPrompt', 'prompt');
        if ((!reference || cover) && custom && !body.instrumental && !body.prompt.trim()) throw invalidField(($('lyricsMode').value === 'automatic') ? 'music.invalidTheme' : 'music.invalidLyrics', 'prompt');
        if ([...body.prompt].length > (custom ? 5000 : 3000)) throw invalidField(custom ? 'music.lyricsTooLong' : 'music.promptTooLong', 'prompt');
        if (custom) {
            Object.assign(body, { title: $('songTitle').value || '', style: $('style').value || '', negative_tags: $('negativeTags').value || '',
                persona_id: $('persona').value || '', auto_lyrics: !($('musicType').checked) && ($('lyricsMode').value === 'automatic'), max_mode: $('maxMode').checked });
            if ([...body.title].length > 80) throw invalidField('music.titleTooLong', 'songTitle');
            if ([...body.style].length > 1000) throw invalidField('music.styleTooLong', 'style');
            if (!inspiration && $('setDuration').checked) {
                body.duration = Number($('duration').value);
                if (!Number.isInteger(body.duration) || body.duration < 10 || body.duration > 360) throw invalidField('music.invalidDuration', 'duration');
            }
        }
        if ($('vocalGender').value !== 'auto' && !($('musicType').checked)) body.vocal_gender = $('vocalGender').value;
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
        if (state.playing?.reference) clearPlayer();
        for (const ref of state.references) if (ref.file) URL.revokeObjectURL(ref.url);
        state.references = [];
    }
    function renderReferences() {
        const audios = new Map([...$('referenceList').querySelectorAll('audio')].map(audio => [audio.getAttribute('src'), audio]));
        $('referenceList').replaceChildren(...state.references.map((ref, index) => {
            const card = text('div', '', 'reference-card');
            const heading = text('div', '', 'reference-heading');
            const preview = document.createElement('ic-icon-button'); preview.setAttribute('shape', 'pill');
            preview.setAttribute('size', 'xs'); preview.setAttribute('background', 'ghost'); preview.dataset.referencePlay = index;
            preview.addEventListener('click', () => playReference(ref));
            const name = text('span', ref.name, 'reference-name'); name.title = ref.name;
            const duration = text('span', ref.duration ? durationText(ref.duration) : '', 'reference-duration');
            const remove = document.createElement('ic-icon-button'); remove.setAttribute('shape', 'pill'); remove.dataset.referenceRemove = '';
            remove.setAttribute('icon', 'close'); remove.setAttribute('size', 'xs'); remove.setAttribute('background', 'ghost');
            remove.setAttribute('label', trf('music.removeReferenceName', { name: ref.name }));
            remove.addEventListener('click', async () => {
                if (state.playing?.reference === ref) clearPlayer();
                if (ref.file) URL.revokeObjectURL(ref.url);
                state.references.splice(index, 1); renderReferences(); updateForm();
                const nextControl = $('referenceList').querySelector('[data-reference-play]') || $('chooseReferences');
                await nextControl.updateComplete;
                if (nextControl.isConnected) nextControl.focus();
            });
            heading.append(preview, name, duration, remove);
            const audio = audios.get(ref.url) || document.createElement('audio'); audio.preload = 'metadata';
            if (!audio.getAttribute('src')) audio.src = ref.url;
            audio.onerror = () => notify('music.referencePlaybackFailed', 'warning');
            audio.onloadedmetadata = () => { if (Number.isFinite(audio.duration)) ref.duration = audio.duration; duration.textContent = durationText(ref.duration); updateForm(); };
            audio.hidden = true;
            card.append(heading, audio); return card;
        }));
        updatePlayer();
    }
    function addReferences(files) {
        const added = [...files];
        if (!added.length || state.busy) return;
        const invalid = key => {
            if ($('referenceDialog').open) { $('referenceStatus').setAttribute('data-i18n', key); $('referenceStatus').textContent = tr(key); $('referenceStatus').hidden = false; }
            else notify(key, 'danger');
        };
        if (added.length + state.references.length > 4) { invalid('music.referenceTooMany'); return; }
        if (added.some(file => !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name) || !file.size)) { invalid('music.referenceType'); return; }
        if (added.some(file => file.size > (state.config?.reference_max_bytes || 50 * 1024 * 1024))) { invalid('music.referenceSize'); return; }
        state.references.push(...added.map(file => ({ file, name: file.name, url: URL.createObjectURL(file), identity: crypto.randomUUID() })));
        notify(''); renderReferences(); updateForm(); $('referenceDialog').hide();
    }
    function showReferenceDialog() { $('referenceStatus').hidden = true; $('referenceDialog').show(); }
    $('chooseReferences').addEventListener('click', showReferenceDialog);
    $('browseReferences').addEventListener('click', () => $('referenceFiles').click());
    $('referenceFiles').addEventListener('change', event => { addReferences(event.target.files); event.target.value = ''; });
    for (const type of ['dragenter', 'dragover']) $('referenceDrop').addEventListener(type, event => {
        event.preventDefault(); if (!state.busy) $('referenceDrop').classList.add('drag-over');
    });
    $('referenceDrop').addEventListener('dragleave', () => $('referenceDrop').classList.remove('drag-over'));
    $('referenceDrop').addEventListener('drop', event => {
        event.preventDefault(); $('referenceDrop').classList.remove('drag-over'); if (!state.busy) addReferences(event.dataTransfer.files);
    });
    for (const id of ['musicForm', 'referenceDialog']) {
        $(id).addEventListener('dragover', event => { if ([...(event.dataTransfer?.types || [])].includes('Files')) event.preventDefault(); });
        $(id).addEventListener('drop', event => {
            if (event.target.closest('#referenceDrop')) return;
            event.preventDefault(); if (!state.busy) addReferences(event.dataTransfer.files);
        });
    }
    // Prevent dropping outside the target from navigating the frame away from a draft.
    for (const type of ['dragover', 'drop']) document.addEventListener(type, event => { if ([...(event.dataTransfer?.types || [])].includes('Files')) event.preventDefault(); });
    function timestamp(value) {
        const language = window.StudioI18n.lang?.() || document.documentElement.lang;
        return new Date(value * 1000).toLocaleString(language.startsWith('en') ? 'en-US' : 'zh-CN',
            { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    function statusKey(record) { return 'music.status.' + (active.has(record.status) ? (record.status === 'queued' ? 'queued' : 'running') : record.status); }
    function recordTitle(record) { return record.params?.title || record.params?.prompt || tr('music.operation.' + record.operation); }
    function durationText(seconds) {
        const total = Math.max(0, Math.floor(Number(seconds) || 0));
        return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    }
    function artwork(item, title, large = false) {
        const box = text('div', '', 'track-artwork'); box.setAttribute('role', 'img');
        box.setAttribute('aria-label', trf('music.noArtwork', { title }));
        const icon = document.createElement('ic-icon'); icon.setAttribute('name', 'audio-lines'); icon.setAttribute('aria-hidden', 'true'); box.append(icon);
        const fields = large ? ['image_large_url', 'image_url'] : ['image_url', 'image_large_url'];
        const candidates = [...new Set(fields.map(field => item?.[field]).filter(url => {
            if (typeof url !== 'string' || state.failedArtwork.has(url)) return false;
            if (url.startsWith('/assets/')) return true;
            try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password; }
            catch { return false; }
        }))];
        if (candidates.length) {
            const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
            img.onload = () => box.setAttribute('aria-label', trf('music.artwork', { title }));
            let current = '';
            const next = () => {
                if (!candidates.length) { img.remove(); box.setAttribute('aria-label', trf('music.noArtwork', { title })); return; }
                current = candidates.shift(); img.src = current;
            };
            img.onerror = () => { state.failedArtwork.add(current); next(); };
            box.append(img); next();
        }
        if (item?.duration) box.append(text('span', durationText(item.duration), 'artwork-duration'));
        return box;
    }
    function currentTrack() {
        if (!state.playing) return null;
        const record = state.records.get(state.playing.id), item = record?.result?.items?.[state.playing.index];
        return item ? { record, item, index: state.playing.index } : null;
    }
    function clearPlayer() {
        const audio = $('playerAudio');
        state.playing = null; audio.pause(); audio.removeAttribute('src'); audio.load(); updatePlayer();
    }
    async function playReference(reference) {
        const audio = $('playerAudio');
        if (state.playing?.reference === reference) {
            if (!audio.paused) { audio.pause(); return; }
        } else {
            state.playing = { reference }; audio.src = reference.url;
        }
        updatePlayer();
        try { await audio.play(); }
        catch (error) { if (error.name !== 'AbortError') notify('music.referencePlaybackFailed', 'warning'); }
        updatePlayer();
    }
    function matchesTrack(record, item, query) {
        return !query || [item.title || record.params?.title, item.display_tags, item.tags, record.params?.prompt, record.params?.style, record.params?.tags].join(' ').toLocaleLowerCase().includes(query);
    }
    function playlist() {
        const query = state.search.trim().toLocaleLowerCase();
        return [...state.records.values()].sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))
            .filter(r => r.operation !== 'download' && r.status === 'succeeded' && (state.filter !== 'session' || state.sessionRuns.has(r.id)))
            .flatMap(record => (record.result?.items || []).flatMap((item, index) => item.url && matchesTrack(record, item, query) ? [{ id: record.id, index }] : []));
    }
    async function playTrack(id, index) {
        const item = state.records.get(id)?.result?.items?.[index]; if (!item?.url) return;
        const audio = $('playerAudio');
        if (state.playing?.id === id && state.playing.index === index) {
            if (!audio.paused) { audio.pause(); return; }
        } else {
            state.playing = { id, index };
            audio.src = `/api/music/runs/${encodeURIComponent(id)}/audio/${index}`;
        }
        updatePlayer();
        try { await audio.play(); }
        catch (error) { if (error.name !== 'AbortError') notify('music.playbackFailed', 'warning'); }
        updatePlayer();
    }
    function moveTrack(direction, automatic = false) {
        if (state.playing?.reference) {
            const next = state.references.indexOf(state.playing.reference) + direction;
            if (next >= 0 && next < state.references.length) playReference(state.references[next]);
            else updatePlayer();
            return;
        }
        const queue = playlist(), current = queue.findIndex(t => t.id === state.playing?.id && t.index === state.playing?.index);
        const next = current < 0 ? 0 : automatic ? current + direction : (current + direction + queue.length) % queue.length;
        if (next >= 0 && next < queue.length) playTrack(queue[next].id, queue[next].index);
        else if (!automatic) updatePlayer();
    }
    function refreshPlayButtons() {
        const key = state.playing ? state.playing.id + ':' + state.playing.index : '', audio = $('playerAudio');
        for (const control of document.querySelectorAll('[data-play-key]')) {
            const playing = control.dataset.playKey === key && !audio.paused;
            const [id, index] = control.dataset.playKey.split(':');
            const item = state.records.get(id)?.result?.items?.[Number(index)];
            control.setAttribute('icon', playing ? 'pause-filled' : 'play-filled');
            control.setAttribute('label', playing ? tr('music.pauseAction') : trf('music.play', { title: item?.title || trf('music.track', { number: Number(index) + 1 }) }));
            control.setAttribute('aria-pressed', String(playing));
        }
        for (const row of document.querySelectorAll('[data-track-key]')) row.dataset.playing = String(row.dataset.trackKey === key && !audio.paused);
        for (const control of document.querySelectorAll('[data-reference-play]')) {
            const reference = state.references[Number(control.dataset.referencePlay)];
            const playing = state.playing?.reference === reference && !audio.paused;
            control.setAttribute('icon', playing ? 'pause-filled' : 'play-filled');
            control.setAttribute('label', playing ? tr('music.pauseAction') : trf('music.play', { title: reference.name }));
            control.setAttribute('aria-pressed', String(playing));
        }
    }
    function updatePlayer() {
        const track = currentTrack(), reference = state.playing?.reference, audio = $('playerAudio');
        const signature = JSON.stringify([state.playing, track?.item, window.StudioI18n.lang?.()]);
        if (signature !== state.playerSignature) {
            state.playerSignature = signature;
            const title = reference?.name || track?.item.title || (track ? trf('music.track', { number: track.index + 1 }) : tr('music.playerEmpty'));
            const copy = text('div', '', 'track-copy'); copy.append(text('strong', title));
            copy.append(text('p', reference ? tr('music.referencePreview') : track ? track.item.display_tags || track.item.tags || track.record.params?.style || tr('music.operation.' + track.record.operation) : tr('music.playerHint'), 'hint'));
            $('nowPlaying').replaceChildren(artwork(track?.item, title), copy);
        }
        const queue = reference ? state.references : playlist(), position = reference ? queue.indexOf(reference) : queue.findIndex(t => t.id === state.playing?.id && t.index === state.playing?.index);
        $('togglePlayback').disabled = !track && !reference && !queue.length;
        $('togglePlayback').setAttribute('icon', audio.paused ? 'play-filled' : 'pause-filled');
        bindLabel($('togglePlayback'), audio.paused ? 'music.playAction' : 'music.pauseAction');
        $('previousTrack').disabled = !queue.length || (reference && position === 0);
        $('nextTrack').disabled = !queue.length || (reference && position === queue.length - 1);
        $('repeatTrack').setAttribute('aria-pressed', String(audio.loop));
        $('repeatTrack').toggleAttribute('pressed', audio.loop);
        const muted = audio.muted || audio.volume === 0;
        $('mutePlayback').setAttribute('icon', muted ? 'volume-muted' : 'volume');
        $('mutePlayback').setAttribute('aria-pressed', String(muted));
        bindLabel($('mutePlayback'), muted ? 'music.unmute' : 'music.mute');
        $('playerVolume').value = Math.round(audio.volume * 100);
        $('playerVolume').setAttribute('value-text', `${Math.round(audio.volume * 100)}%`);
        updateProgress(); refreshPlayButtons();
    }
    function updateProgress() {
        const audio = $('playerAudio'), duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        $('playerCurrentTime').textContent = durationText(audio.currentTime);
        $('playerDuration').textContent = durationText(duration);
        $('playerProgress').disabled = !duration;
        $('playerProgress').value = duration ? Math.round(Math.min(1, audio.currentTime / duration) * 1000) : 0;
        $('playerProgress').setAttribute('value-text', `${durationText(audio.currentTime)} / ${durationText(duration)}`);
    }
    function renderHistory() {
        const all = [...state.records.values()].sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id));
        const records = all.filter(record => record.operation !== 'download' || !state.records.has(record.source_run_id));
        const query = state.search.trim().toLocaleLowerCase();
        const visible = records.filter(record => (state.filter !== 'session' || state.sessionRuns.has(record.id)) && (!query ||
            (record.result?.items?.length ? record.result.items.some(item => matchesTrack(record, item, query)) : recordTitle(record).toLocaleLowerCase().includes(query))));
        const current = new Map([...$('historyList').children].map(el => [el.dataset.runId, el]));
        const present = new Set();
        for (const [position, record] of visible.entries()) {
            const exports = all.filter(item => item.operation === 'download' && item.source_run_id === record.id);
            const signature = JSON.stringify([record, exports, query, window.StudioI18n.lang?.()]);
            let row = current.get(record.id); present.add(record.id);
            if (!row || state.librarySignatures.get(record.id) !== signature) {
                const old = row;
                row = text('article', '', 'music-record'); row.dataset.runId = record.id;
                const items = record.result?.items || [];
                const completed = record.status === 'succeeded' && items.length > 0;
                row.dataset.state = completed ? 'completed' : record.status;
                if (completed) {
                    const tracks = text('div', '', 'library-tracks');
                    for (const [index, item] of items.entries()) if (matchesTrack(record, item, query)) tracks.append(libraryTrackCard(record, item, index, exports));
                    row.append(tracks);
                } else {
                    row.append(libraryTrackCard(record, null, null, []));
                }
                state.librarySignatures.set(record.id, signature);
                if (old) old.replaceWith(row);
            }
            const next = $('historyList').children[position];
            if (next !== row) $('historyList').insertBefore(row, next || null);
        }
        for (const [id, row] of current) if (!present.has(id)) row.remove();
        if (state.menuAnchor && !state.menuAnchor.isConnected) $('musicRecordMenu').hide('programmatic');
        $('historyStatus').hidden = !state.historyError && visible.length > 0;
        $('clearMusicFilters').hidden = state.loading || !!state.historyError || visible.length > 0 || (!query && state.filter === 'all');
        if (state.historyError || (!visible.length && !state.loading)) {
            const key = state.historyError || (query || state.filter === 'session' ? 'music.noResults' : 'music.emptyHistory');
            $('historyStatus').setAttribute('data-i18n', key); $('historyStatus').textContent = tr(key);
        }
        $('moreHistory').hidden = !state.cursor;
        updatePlayer(); renderDownload();
    }
    function select(id, index = null) { state.selected = id; state.selectedIndex = index; renderHistory(); renderDetail(); $('recordDialog').show(); }
    function openRecordMenu(record, anchor) {
        const menu = $('musicRecordMenu');
        if (menu.hasAttribute('open') && state.menuAnchor === anchor) { menu.hide('trigger'); return; }
        state.menuRecord = record.id; state.menuAnchor = anchor; menu.show(anchor);
    }
    function showDeleteRecord(record) {
        if (!record || record.status !== 'failed' || state.deleting) return;
        state.deleteTarget = record;
        $('deleteRecordName').textContent = recordTitle(record); $('deleteRecordName').title = recordTitle(record);
        $('deleteRecordError').hidden = true; $('deleteRecordError').removeAttribute('data-i18n');
        $('deleteRecordDialog').show();
    }
    async function deleteRecord() {
        if (!state.deleteTarget || state.deleting) return;
        const id = state.deleteTarget.id;
        state.deleting = true; $('confirmDeleteRecord').loading = true; $('cancelDeleteRecord').disabled = true;
        $('deleteRecordError').hidden = true;
        try {
            const result = await api('/runs/' + encodeURIComponent(id), { method: 'DELETE' });
            state.deletedRecords.add(id); state.records.delete(id); state.sessionRuns.delete(id); state.librarySignatures.delete(id);
            const removedReferences = state.references.filter(ref => ref.run_id === id);
            if (removedReferences.includes(state.playing?.reference)) clearPlayer();
            state.references = state.references.filter(ref => ref.run_id !== id);
            if (state.selected === id) { state.selected = ''; state.selectedIndex = null; await $('recordDialog').hide(); }
            renderReferences(); updateForm(); renderHistory(); renderDetail(true);
            state.deleting = false;
            await $('deleteRecordDialog').hide();
            $('refreshMusic').focus();
            notify(result.retained_count ? 'music.recordDeletedRetained' : 'music.recordDeleted', 'success');
        } catch (error) {
            const key = errorKey(error, 'music.deleteFailed');
            $('deleteRecordError').setAttribute('data-i18n', key); $('deleteRecordError').textContent = tr(key); $('deleteRecordError').hidden = false;
        } finally {
            state.deleting = false; $('confirmDeleteRecord').loading = false; $('cancelDeleteRecord').disabled = false;
        }
    }
    function clearFilters() {
        state.search = ''; state.filter = 'all'; $('searchMusic').value = '';
        for (const item of $('libraryFilter').querySelectorAll('[data-value]')) {
            item.pressed = item.dataset.value === 'all'; item.hierarchy = item.pressed ? 'secondary' : 'quiet';
        }
        renderHistory();
    }
    function openDownload(id, index) {
        state.downloadTrack = { id, index }; state.downloadSignature = ''; $('downloadStatus').hidden = true;
        renderDownload(); $('downloadDialog').show();
    }
    function renderDownload() {
        if (!state.downloadTrack) return;
        const { id, index } = state.downloadTrack, record = state.records.get(id), item = record?.result?.items?.[index];
        if (!item) return;
        const outputs = [...state.records.values()].filter(output => output.source_run_id === id && output.params?.audio_index === item.audio_index).sort((a, b) => b.created_at - a.created_at);
        const signature = JSON.stringify([record, outputs, [...state.exporting], window.StudioI18n.lang?.()]);
        if (signature === state.downloadSignature) return;
        state.downloadSignature = signature;
        const body = document.createDocumentFragment();
        body.append(text('h2', item.title || trf('music.track', { number: index + 1 })), text('p', tr('music.exportHint'), 'hint'));
        for (const format of ['mp3', 'wav', 'm4a']) {
            const row = text('div', '', 'download-row'), copy = text('div', ''); row.dataset.format = format;
            copy.append(text('strong', format.toUpperCase()));
            const completed = outputs.find(output => output.status === 'succeeded' && output.result?.items?.some(result => result.format === format && result.url));
            const source = item.format === format && item.url ? record : completed;
            const sourceIndex = source === record ? index : source?.result?.items?.findIndex(result => result.format === format && result.url);
            const previous = outputs.find(output => output.params?.formats?.includes(format));
            const pending = state.exporting.has(id + ':' + index + ':' + format) || (previous && active.has(previous.status));
            copy.append(text('small', tr(source ? 'music.formatReady' : pending ? 'music.formatPreparing' : previous?.error_code || 'music.formatNeedsPreparation')));
            const action = button(source ? 'music.downloadAction' : pending ? 'music.formatPreparing' : 'music.prepareFormat', async () => {
                if (source) { await download(source, source.result.items[sourceIndex], sourceIndex, action); return; }
                const key = id + ':' + index + ':' + format;
                if (state.exporting.has(key)) return;
                state.exporting.add(key); $('downloadStatus').hidden = true; renderDownload();
                try {
                    const result = previous?.recoverable
                        ? await api(`/runs/${encodeURIComponent(previous.id)}/resume`, { method: 'POST' })
                        : await api(`/runs/${encodeURIComponent(id)}/downloads`, { method: 'POST', body: JSON.stringify({ audio_index: item.audio_index, formats: [format] }) });
                    state.records.set(result.id, result); renderHistory();
                } catch (error) {
                    const status = $('downloadStatus'); status.setAttribute('data-i18n', errorKey(error)); status.textContent = tr(errorKey(error)); status.hidden = false;
                } finally { state.exporting.delete(key); renderDownload(); }
            });
            action.setAttribute('shape', 'pill'); action.setAttribute('size', 'small'); action.disabled = !!pending || (!source && !item.audio_id);
            row.append(copy, action); body.append(row);
        }
        $('downloadDetail').replaceChildren(body);
    }
    function songDetail(record, index) {
        const item = record.result.items[index], title = item.title || trf('music.track', { number: index + 1 });
        const body = text('section', '', 'song-detail'); body.dataset.trackKey = record.id + ':' + index;
        body.append(artwork(item, title, true), text('h2', title), text('p', item.display_tags || item.tags || record.params?.style || '', 'hint'));
        if (item.url) {
            const overlay = text('div', '', 'artwork-controls');
            const play = document.createElement('ic-icon-button'); play.setAttribute('shape', 'pill'); play.dataset.playKey = record.id + ':' + index;
            play.setAttribute('icon', 'play-filled'); play.setAttribute('size', 'small'); play.setAttribute('hierarchy', 'primary');
            play.setAttribute('label', trf('music.play', { title })); play.addEventListener('click', () => playTrack(record.id, index));
            overlay.append(play); body.querySelector('.track-artwork').append(overlay);
        }
        body.append(text('h3', tr('music.idea')), text('p', record.params?.prompt || record.params?.tags || '', 'lyrics'));
        if (item.lyrics) body.append(text('h3', tr('music.lyricsResult')), text('pre', item.lyrics, 'lyrics'));
        body.append(text('h3', tr('music.settingsSnapshot')));
        const snapshot = text('div', '', 'snapshot');
        for (const [key, value] of [['music.version', record.params?.version || 'Suno'], ['music.referenceMode', tr('music.operation.' + record.operation)], ['music.sound', tr(record.params?.instrumental ? 'music.instrumental' : 'music.song')], ['music.outputFormat', (item.format || 'mp3').toUpperCase()]]) {
            const entry = text('div', ''); entry.append(text('small', tr(key)), text('span', value)); snapshot.append(entry);
        }
        body.append(snapshot);
        const actions = text('div', '', 'track-actions');
        const reuseButton = actionIcon(button('music.reuse', () => reuse(record), 'primary'), 'restore'); reuseButton.setAttribute('shape', 'pill'); actions.append(reuseButton);
        const save = button('music.downloadAction', async () => { await $('recordDialog').hide(); openDownload(record.id, index); }); save.setAttribute('shape', 'pill'); actions.append(save); body.append(actions);
        const technical = text('details', '', 'settings-details'); technical.append(text('summary', tr('music.taskDetails')));
        technical.append(text('p', `${timestamp(record.created_at)} · ${tr(statusKey(record))}`, 'hint'));
        const list = text('dl', '', 'settings-list');
        for (const [key, value] of Object.entries(record.params || {})) if (labels[key] && value != null && value !== '') list.append(text('dt', tr(labels[key])), text('dd', parameterValue(key, value)));
        if (record.remote_task_id) list.append(text('dt', tr('music.taskId')), text('dd', record.remote_task_id));
        if (item.audio_id) list.append(text('dt', tr('music.audioId')), text('dd', item.audio_id));
        technical.append(list);
        if (typeof record.result?.credits_cost === 'number') technical.append(text('p', trf('music.cost', { credits: record.result.credits_cost }), 'hint'));
        if (record.references?.length) {
            const references = text('details', '', 'record-references'); references.append(text('summary', tr('music.references')));
            for (const ref of record.references) {
                const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'none'; audio.src = ref.url;
                audio.setAttribute('aria-label', trf('music.play', { title: ref.name }));
                references.append(text('p', ref.name, 'reference-name'), audio);
            }
            technical.append(references);
        }
        body.append(technical);
        return body;
    }
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
        } catch (error) {
            const key = errorKey(error, 'music.downloadError');
            if ($('downloadDialog').open) { $('downloadStatus').setAttribute('data-i18n', key); $('downloadStatus').textContent = tr(key); $('downloadStatus').hidden = false; }
            else notify(key, 'danger');
        }
        finally { control.disabled = false; }
    }
    function actionIcon(control, name) {
        const icon = document.createElement('ic-icon'); icon.setAttribute('name', name);
        icon.setAttribute('slot', 'start'); icon.setAttribute('size', 'x-small'); icon.setAttribute('aria-hidden', 'true');
        control.prepend(icon); return control;
    }
    function runArtwork(record) {
        const box = text('div', '', 'track-artwork track-status-artwork');
        if (active.has(record.status)) {
            const pending = document.createElement('ic-generation-pending');
            pending.setAttribute('kind', 'image');
            pending.setAttribute('state', record.status === 'queued' ? 'queued' : 'generating');
            pending.setAttribute('count', '1');
            pending.setAttribute('label', tr(statusKey(record)));
            box.append(pending);
        } else {
            const icon = document.createElement('ic-icon');
            icon.setAttribute('name', record.status === 'failed' ? 'error' : 'audio-lines');
            icon.setAttribute('size', 'medium'); icon.setAttribute('aria-hidden', 'true');
            box.append(icon, text('span', tr(statusKey(record)), 'track-artwork-status'));
            box.setAttribute('role', 'img'); box.setAttribute('aria-label', tr(statusKey(record)));
        }
        return box;
    }
    function libraryTrackCard(record, item, index, exports) {
        const card = text('article', '', 'library-track'); card.dataset.state = record.status;
        if (item) card.dataset.trackKey = record.id + ':' + index;
        const title = item ? item.title || trf('music.track', { number: item.audio_index || index + 1 }) : recordTitle(record);
        const art = item ? artwork(item, title) : runArtwork(record); card.append(art);
        if (item?.url) {
            art.setAttribute('role', 'group');
            const overlay = text('div', '', 'artwork-controls');
            const play = document.createElement('ic-icon-button'); play.setAttribute('shape', 'pill'); play.dataset.playKey = record.id + ':' + index;
            play.setAttribute('icon', 'play-filled'); play.setAttribute('size', 'small'); play.setAttribute('hierarchy', 'primary');
            play.setAttribute('label', trf('music.play', { title }));
            play.addEventListener('click', () => playTrack(record.id, index)); overlay.append(play); art.append(overlay);
        }
        const copy = text('div', '', 'track-copy'), heading = text('div', '', 'track-heading');
        const open = button('music.recordDetails', () => select(record.id, index), 'quiet');
        open.className = 'history-item track-title'; open.setAttribute('size', 'xs'); open.title = title; open.replaceChildren(text('strong', title));
        const version = record.params?.version || 'Suno';
        heading.append(open, text('span', `${version.toUpperCase()} · ${tr('music.operation.' + record.operation)}`, 'track-version'));
        if (!item && active.has(record.status)) heading.append(text('span', tr(statusKey(record)), 'track-version'));
        const description = !item && record.error_code ? tr(record.error_code)
            : item?.display_tags || item?.tags || record.params?.style || record.params?.tags || record.params?.prompt || '';
        const detail = text('p', description, 'track-description'); detail.title = description;
        copy.append(heading, detail);
        const actions = text('div', '', 'track-actions');
        const favorite = document.createElement('ic-icon-button'); favorite.setAttribute('shape', 'pill'); favorite.setAttribute('icon', 'heart');
        favorite.setAttribute('size', 'xs'); favorite.setAttribute('background', 'ghost'); favorite.disabled = true;
        favorite.setAttribute('label', tr('music.favoritesUnavailable')); actions.append(favorite);
        if (['generate', 'inspo', 'cover'].includes(record.operation)) {
            const reuseButton = actionIcon(button('music.reuse', () => reuse(record), 'quiet'), 'restore');
            reuseButton.setAttribute('size', 'xs'); reuseButton.setAttribute('shape', 'pill'); actions.append(reuseButton);
        }
        if (item?.url) {
            const save = button('music.download', () => openDownload(record.id, index), 'quiet');
            save.textContent = tr('music.downloadAction');
            save.setAttribute('size', 'xs'); save.setAttribute('shape', 'pill'); actions.append(actionIcon(save, 'download'));
        } else if (item) copy.append(text('p', tr('music.noPlayback'), 'hint'));
        for (const [name, key, handler] of [
            ['restore', 'music.reuse', () => reuse(record)], ['download', 'music.downloadAction', () => openDownload(record.id, index)],
        ]) {
            if (name === 'download' && !item?.url) continue;
            if (name === 'restore' && !['generate', 'inspo', 'cover'].includes(record.operation)) continue;
            const compact = document.createElement('ic-icon-button'); compact.className = 'mobile-track-action';
            compact.setAttribute('icon', name); compact.setAttribute('label', tr(key)); compact.setAttribute('size', 'xs'); compact.setAttribute('shape', 'pill'); compact.setAttribute('background', 'ghost');
            compact.addEventListener('click', handler); actions.append(compact);
        }
        copy.append(actions);
        for (const output of exports.filter(output => item && output.params?.audio_index === item.audio_index)) {
            const openExport = button('music.exportFormats', () => select(output.id), 'quiet'); openExport.setAttribute('size', 'xs');
            openExport.textContent = `${tr('music.exportFormats')} · ${tr(statusKey(output))}`; copy.append(openExport);
        }
        const details = document.createElement('ic-icon-button'); details.setAttribute('shape', 'pill'); details.className = 'track-more';
        details.setAttribute('icon', 'more'); details.setAttribute('size', 'small'); details.setAttribute('background', 'ghost');
        details.setAttribute('label', tr(record.status === 'failed' ? 'music.recordActions' : 'music.recordDetails'));
        if (record.status === 'failed') details.setAttribute('aria-haspopup', 'menu');
        details.addEventListener('click', () => record.status === 'failed' ? openRecordMenu(record, details) : select(record.id, index));
        card.append(copy, details); return card;
    }
    function trackCard(record, item, index) {
        const card = text('ic-card', '', 'track-card');
        card.dataset.trackKey = record.id + ':' + index;
        const title = item.title || trf('music.track', { number: item.audio_index || index + 1 });
        const heading = text('div', '', 'track-heading');
        heading.append(artwork(item, title, true));
        const copy = text('div', '', 'track-copy'); copy.append(text('h3', title));
        if (item.duration) copy.append(text('p', trf('music.durationValue', { seconds: Math.round(item.duration * 10) / 10 }), 'hint'));
        if (item.display_tags || item.tags) copy.append(text('p', item.display_tags || item.tags, 'hint'));
        heading.append(copy); card.append(heading);
        if (item.url) {
            const controls = text('div', '', 'track-actions');
            const play = document.createElement('ic-icon-button'); play.setAttribute('shape', 'pill'); play.dataset.playKey = record.id + ':' + index;
            play.setAttribute('icon', 'play-filled'); play.setAttribute('size', 'small'); play.setAttribute('background', 'ghost');
            play.setAttribute('label', trf('music.play', { title }));
            play.addEventListener('click', () => playTrack(record.id, index)); controls.append(play);
            const save = button('music.download', () => download(record, item, index, save), 'quiet');
            save.setAttribute('size', 'small');
            save.textContent = trf('music.download', { format: (item.format || 'mp3').toUpperCase() }); controls.append(save);
            card.append(controls);
        } else card.append(text('p', tr('music.noPlayback'), 'hint'));
        if (item.lyrics) {
            const details = document.createElement('details'); details.append(text('summary', tr('music.lyricsResult')), text('pre', item.lyrics, 'lyrics')); card.append(details);
        }
        if (record.operation !== 'download' && item.audio_id) {
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
        const signature = JSON.stringify([record?.id, state.selectedIndex, record?.status, record?.result, record?.error_code]);
        if (!force && signature === state.detailSignature) return;
        state.detailSignature = signature;
        if (!record) { $('recordDetail').replaceChildren(detailEmpty()); return; }
        if (record.status === 'succeeded' && Number.isInteger(state.selectedIndex) && record.result?.items?.[state.selectedIndex]) {
            $('recordDetail').replaceChildren(songDetail(record, state.selectedIndex)); refreshPlayButtons(); return;
        }
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
            for (const [index, item] of (record.result?.items || []).entries()) fragment.append(trackCard(record, item, index));
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
        $('recordDetail').replaceChildren(fragment); refreshPlayButtons();
    }
    function reuse(record) {
        const p = record.params;
        clearReferences(); state.references = (record.references || []).map((ref, index) => ({ ...ref, run_id: record.id, index })); renderReferences();
        if (state.config?.providers.some(provider => provider.id === record.provider_id)) $('provider').value = record.provider_id;
        $('version').value = p.version;
        for (const [id, key] of Object.entries({ prompt: 'prompt', songTitle: 'title', style: 'style', negativeTags: 'negative_tags', persona: 'persona_id', vocalGender: 'vocal_gender', variety: 'variety', audioFormat: 'audio_format' })) $(id).value = p[key] ?? (['vocalGender', 'variety', 'audioFormat'].includes(id) ? 'auto' : '');
        $('musicType').checked = !!p.instrumental;
        $('referenceMode').setAttribute('value', record.operation === 'inspo' ? 'inspo' : 'cover');
        $('lyricsMode').value = p.auto_lyrics || (record.operation === 'generate' && !p.custom) ? 'automatic' : 'manual';
        $('maxMode').checked = !!p.max_mode;
        if (record.operation === 'inspo') $('style').value = p.tags || '';
        $('setAudioWeight').checked = p.audio_weight != null; $('audioWeight').value = Math.round((p.audio_weight ?? .5) * 100);
        $('setDuration').checked = p.duration != null; $('duration').value = p.duration ?? 60;
        $('overrideWeights').checked = ['style_weight', 'weirdness_constraint', 'weirdness'].some(key => p[key] != null);
        for (const [id, key] of Object.entries({ styleWeight: 'style_weight', weirdness: 'weirdness_constraint' })) $(id).value = Math.round((p[key] ?? (key === 'weirdness_constraint' ? p.weirdness : null) ?? .5) * 100);
        $('recordDialog').hide(); setComposerMode('detailed'); showView('create'); updateForm(); $('musicForm').scrollTop = 0; $('prompt').focus(); notify('music.settingsReused', 'success');
    }
    async function loadHistory(more = false, quiet = false) {
        if (state.loading) return;
        state.loading = true;
        if (!quiet) $('refreshMusic').loading = true;
        try {
            const page = await api('/history' + (more && state.cursor ? '?cursor=' + encodeURIComponent(state.cursor) : ''));
            for (const record of page.items) if (!state.deletedRecords.has(record.id)) state.records.set(record.id, record);
            if (more || !state.cursor || !quiet) state.cursor = page.next_cursor;
            const visibleIds = new Set(page.items.map(item => item.id));
            await Promise.all([...state.records.values()].filter(record => active.has(record.status) && !visibleIds.has(record.id)).map(async record => {
                const updated = await api('/runs/' + encodeURIComponent(record.id));
                if (!state.deletedRecords.has(updated.id)) state.records.set(updated.id, updated);
            }));
            if (!state.selected) state.selected = page.items.find(item => !state.deletedRecords.has(item.id))?.id || '';
            state.historyError = ''; clearNotice('historyMessage');
            state.loading = false; renderHistory(); renderDetail();
        } catch (error) {
            state.historyError = 'music.loadFailed'; renderHistory();
            if (!quiet) notify(errorKey(error, 'music.loadFailed'), 'danger', 'historyMessage', reloadMusic);
        } finally { state.loading = false; $('refreshMusic').loading = false; }
    }
    async function loadConfig() {
        if (state.configLoading) return;
        state.configLoading = true;
        try {
            state.config = await api('/config');
            const selected = $('provider').value;
            $('provider').replaceChildren(...state.config.providers.map(provider => new Option(provider.name, provider.id)));
            $('provider').syncOptions(); $('provider').value = state.config.providers.some(p => p.id === selected) ? selected : state.config.providers[0]?.id || '';
            if (!state.config.providers.length) notify('music.noProvider', 'warning', 'configMessage', reloadMusic);
            else clearNotice('configMessage');
        } catch (error) { state.config = null; notify(errorKey(error, 'music.loadFailed'), 'danger', 'configMessage', reloadMusic); }
        finally { state.configLoading = false; }
        updateForm();
    }
    function reloadMusic() { return Promise.all([loadConfig(), loadHistory()]); }
    $('submitMusic').addEventListener('click', async () => {
        if (state.busy || !state.config?.providers.length) return;
        let payload, endpoint;
        try {
            payload = { provider_id: $('provider').value, settings: settings() };
            endpoint = { inspo: '/inspirations', cover: '/covers', generate: '/generations' }[operation()];
            if (endpoint !== '/generations') payload.references = state.references.map(ref => ref.file
                ? { identity: ref.identity } : { run_id: ref.run_id, index: ref.index });
        } catch (error) { notify(errorKey(error, 'music.invalidSettings'), 'danger'); if (error.fieldId) revealField(error.fieldId); return; }
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
            state.records.set(record.id, record); state.sessionRuns.add(record.id); clearFilters(); showView('library'); $('libraryScroll').scrollTop = 0; state.selected = record.id; state.selectedIndex = null; renderHistory(); renderDetail(); state.receipts.delete(fingerprint); notify('music.accepted', 'success');
        } catch (error) { notify(errorKey(error), 'danger'); await loadHistory(false, true); }
        finally { state.busy = false; updateForm(); }
    });
    $('resetDraft').addEventListener('click', () => {
        if (state.busy) return;
        $('referenceList').querySelectorAll('audio').forEach(audio => audio.pause());
        clearReferences(); renderReferences();
        for (const id of ['prompt', 'style', 'songTitle', 'negativeTags', 'persona']) $(id).value = '';
        for (const id of ['musicType', 'overrideWeights', 'setAudioWeight', 'setDuration', 'maxMode']) $(id).checked = false;
        for (const id of ['vocalGender', 'variety', 'audioFormat']) $(id).value = 'auto';
        for (const id of ['styleWeight', 'weirdness', 'audioWeight']) $(id).value = 50;
        $('version').value = 'v6'; $('lyricsMode').value = 'automatic'; $('referenceMode').setAttribute('value', 'cover'); $('duration').value = 60;
        $('advancedOptions').open = false; setComposerMode('detailed'); updateForm();
        $('musicForm').scrollTop = 0; clearNotice('musicMessage'); notify('music.draftCleared', 'success');
    });
    $('composerMode').addEventListener('ic-change', event => setComposerMode(event.detail.value));
    $('referenceMode').addEventListener('ic-change', updateForm);
    $('libraryLayout').addEventListener('click', event => {
        const control = event.target.closest('[data-value]'); if (!control) return;
        $('historyList').dataset.layout = control.dataset.value;
        for (const item of $('libraryLayout').querySelectorAll('[data-value]')) item.pressed = item === control;
    });
    $('libraryFilter').addEventListener('click', event => {
        const control = event.target.closest('[data-value]'); if (!control || control.disabled) return;
        state.filter = control.dataset.value;
        for (const item of $('libraryFilter').querySelectorAll('[data-value]')) { item.pressed = item === control; item.hierarchy = item === control ? 'secondary' : 'quiet'; }
        renderHistory();
    });
    $('librarySort').addEventListener('change', () => { $('librarySort').value = 'newest'; });
    $('chooseMoreReferences').addEventListener('click', () => $('referenceFiles').click());
    $('inspireReference').addEventListener('click', () => {
        $('referenceMode').setAttribute('value', 'inspo'); updateForm(); if (!state.references.length) showReferenceDialog();
    });
    $('openPersona').addEventListener('click', () => $('personaDialog').show());
    $('closePersona').addEventListener('click', () => $('personaDialog').hide());
    $('expandPrompt').addEventListener('click', () => {
        $('expandedPrompt').value = $('prompt').value; bindLabel($('expandedPrompt'), $('prompt').getAttribute('data-i18n-aria-label')); $('promptDialog').show();
    });
    $('applyPrompt').addEventListener('click', () => { $('prompt').value = $('expandedPrompt').value; updateForm(); $('promptDialog').hide(); });
    for (let i = 1; i <= 6; i++) $('styleSuggestion' + i).addEventListener('click', () => {
        const suggestion = tr('music.styleSuggestion' + i), values = $('style').value.split(/[,，]/).map(value => value.trim()).filter(Boolean);
        if (!values.some(value => value.toLocaleLowerCase() === suggestion.toLocaleLowerCase())) values.push(suggestion);
        $('style').value = [...values.join(', ')].slice(0, 1000).join(''); updateForm();
    });
    $('togglePlayback').addEventListener('click', () => { if (state.playing?.reference) playReference(state.playing.reference); else if (state.playing) playTrack(state.playing.id, state.playing.index); else { const first = playlist()[0]; if (first) playTrack(first.id, first.index); } });
    $('previousTrack').addEventListener('click', () => moveTrack(-1));
    $('nextTrack').addEventListener('click', () => moveTrack(1));
    $('repeatTrack').addEventListener('click', () => { $('playerAudio').loop = !$('playerAudio').loop; updatePlayer(); });
    $('playerProgress').addEventListener('input', () => {
        const audio = $('playerAudio'); if (Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = Number($('playerProgress').value) / 1000 * audio.duration;
    });
    $('mutePlayback').addEventListener('click', () => {
        const audio = $('playerAudio');
        if (audio.muted || audio.volume === 0) { audio.muted = false; if (audio.volume === 0) audio.volume = .65; }
        else audio.muted = true;
    });
    $('playerVolume').addEventListener('input', () => { $('playerAudio').volume = Number($('playerVolume').value) / 100; $('playerAudio').muted = false; });
    $('playerAudio').volume = .65;
    for (const event of ['play', 'pause', 'loadedmetadata', 'durationchange', 'volumechange', 'emptied']) $('playerAudio').addEventListener(event, updatePlayer);
    $('playerAudio').addEventListener('timeupdate', updateProgress);
    $('playerAudio').addEventListener('ended', () => moveTrack(1, true));
    $('playerAudio').addEventListener('error', () => { notify('music.playbackFailed', 'warning'); updatePlayer(); });
    $('musicView').addEventListener('change', () => showView($('musicView').value));
    $('searchMusic').addEventListener('input', () => { state.search = $('searchMusic').value; renderHistory(); });
    $('searchMusic').addEventListener('ic-clear', () => { state.search = ''; renderHistory(); });
    $('clearMusicFilters').addEventListener('click', clearFilters);
    for (const id of ['weirdness', 'styleWeight', 'audioWeight']) $(id).addEventListener('input', updateForm);
    $('persona').addEventListener('input', updateForm);
    $('inlinePersona').addEventListener('input', () => { $('persona').value = $('inlinePersona').value; updateForm(); });
    $('recordDialog').addEventListener('ic-after-hide', () => { $('recordDetail').querySelectorAll('audio').forEach(audio => audio.pause()); clearNotice('detailMessage'); });
    $('musicRecordMenu').addEventListener('ic-select', event => {
        const record = state.records.get(state.menuRecord);
        $('musicRecordMenu').hide('selection');
        if (event.detail.value === 'delete') showDeleteRecord(record);
        else if (record) select(record.id);
    });
    $('confirmDeleteRecord').addEventListener('click', deleteRecord);
    $('cancelDeleteRecord').addEventListener('click', () => $('deleteRecordDialog').hide());
    $('deleteRecordDialog').addEventListener('ic-hide', event => { if (state.deleting) event.preventDefault(); });
    $('deleteRecordDialog').addEventListener('ic-after-hide', () => { state.deleteTarget = null; if (state.menuAnchor?.isConnected) state.menuAnchor.focus(); });
    $('refreshMusic').addEventListener('click', reloadMusic);
    $('moreHistory').addEventListener('click', () => loadHistory(true));
    for (const id of ['musicType', 'lyricsMode', 'overrideWeights', 'setDuration', 'setAudioWeight']) $(id).addEventListener('change', updateForm);
    for (const id of ['prompt', 'style']) $(id).addEventListener('input', updateForm);
    $('examplePrompt').addEventListener('click', () => {
        $('prompt').value = tr('music.example' + (state.example++ % 3 + 1));
        updateForm();
    });
    document.addEventListener('play', event => {
        if (event.target.localName === 'audio') document.querySelectorAll('audio').forEach(audio => { if (audio !== event.target) audio.pause(); });
    }, true);
    function route() {
        const suno = location.hash === '#suno'; $('labLanding').hidden = suno; $('sunoWorkbench').hidden = !suno;
        document.title = tr(suno ? 'music.title' : 'nav.lab');
        document.body.classList.toggle('music-open', suno);
        if (!suno) $('playerAudio').pause();
        $('musicFeedback').hidden = !suno;
        if (suno && !state.config) reloadMusic();
    }
    addEventListener('hashchange', route);
    addEventListener('studio-lang-change', () => {
        updateForm(); renderReferences(); renderHistory(); renderDetail(true);
        if (state.deleteTarget) { $('deleteRecordName').textContent = recordTitle(state.deleteTarget); $('deleteRecordName').title = recordTitle(state.deleteTarget); }
        state.notices.forEach(renderNotice);
        for (const [toast, key] of state.toasts) {
            if (toast.isConnected) toast.textContent = tr(key); else state.toasts.delete(toast);
        }
        document.querySelectorAll('ic-select').forEach(select => { select.syncOptions(); select.selectionChanged(); });
        document.title = tr(location.hash === '#suno' ? 'music.title' : 'nav.lab');
    });
    addEventListener('message', event => {
        if (event.origin !== location.origin) return;
        if (event.data?.type === 'studio-lang') window.StudioI18n.set(event.data.lang);
        if (event.data?.type === 'providers-changed') loadConfig();
    });
    setInterval(() => { if (!document.hidden && location.hash === '#suno') loadHistory(false, true); }, 5000);
    showView('create'); renderDetail(); updatePlayer(); route();
})();
