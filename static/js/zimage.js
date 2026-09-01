(function () {
    'use strict';

    const PAGE_SIZE = 15;
    const MS_TOKEN_KEY = 'modelscope_api_token';
    const ENGINE_MODE_KEY = 'zimage_engine_mode';

    let allHistory = [];
    let currentIndex = 0;
    let currentEngine = 'local';
    let historyLoading = false;
    let lightboxPreview = null;
    let queueTimer = 0;

    function tr(key) {
        return window.StudioI18n ? StudioI18n.t(key) : key;
    }

    function generateUUID() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            try { return crypto.randomUUID(); } catch (error) {}
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (character) {
            const random = Math.random() * 16 | 0;
            const value = character === 'x' ? random : (random & 0x3 | 0x8);
            return value.toString(16);
        });
    }

    const CLIENT_ID = localStorage.getItem('client_id') || generateUUID();
    localStorage.setItem('client_id', CLIENT_ID);

    function notify(message, tone = 'danger') {
        const text = String(message || '').trim();
        if (!text) return;
        const Toast = customElements.get('ic-toast');
        if (Toast?.notify) Toast.notify(text, { tone, duration: tone === 'danger' ? 0 : 2400 });
    }

    function buttonLabel(button, text) {
        const label = button?.querySelector('span');
        if (label) label.textContent = text;
    }

    function applyLanguage(language) {
        if (language && window.StudioI18n) StudioI18n.set(language);
        document.title = tr('nav.textToImage');
        const trigger = document.getElementById('loadMoreTrigger');
        if (trigger && !historyLoading) buttonLabel(trigger, tr('studio.loadMore'));
        switchEngine(currentEngine || localStorage.getItem(ENGINE_MODE_KEY) || 'local');
    }

    window.addEventListener('message', event => {
        if (event.origin && event.origin !== window.location.origin) return;
        if (event.data?.type === 'studio-lang') applyLanguage(event.data.lang);
    });
    window.addEventListener('studio-lang-change', () => {
        document.title = tr('nav.textToImage');
        switchEngine(currentEngine);
    });

    function switchEngine(mode) {
        currentEngine = mode === 'cloud' ? 'cloud' : 'local';
        localStorage.setItem(ENGINE_MODE_KEY, currentEngine);
        const selector = document.getElementById('engineSelector');
        const generateLabel = document.getElementById('btnText');
        selector?.setAttribute('value', currentEngine);
        if (generateLabel) generateLabel.textContent = tr(currentEngine === 'local' ? 'studio.renderLocal' : 'studio.renderCloud');
    }

    function setGenerating(generating) {
        const button = document.getElementById('mainGenBtn');
        if (!button) return;
        button.loading = generating;
        button.disabled = generating;
        button.setAttribute('aria-busy', String(generating));
        buttonLabel(button, generating ? tr('studio.processing') : tr(currentEngine === 'local' ? 'studio.renderLocal' : 'studio.renderCloud'));
    }

    function createPlaceholder(label) {
        const card = document.createElement('ic-card');
        card.className = 'result-placeholder';
        card.setAttribute('label', label);
        card.setAttribute('size', 'small');

        const media = document.createElement('ic-media-container');
        media.setAttribute('label', label);
        media.setAttribute('kind', 'image');
        media.setAttribute('fit', 'contain');
        media.setAttribute('aspect', 'square');
        media.setAttribute('state', 'loading');

        const loading = document.createElement('ic-loading');
        loading.slot = 'fallback';
        loading.setAttribute('presentation', 'region');
        loading.setAttribute('label', label);
        media.append(loading);
        card.append(media);
        return card;
    }

    function makeResultAction(data) {
        const button = document.createElement('ic-button');
        button.slot = 'footer';
        button.type = 'button';
        button.setAttribute('hierarchy', 'quiet');
        const icon = document.createElement('ic-icon');
        icon.slot = 'start';
        icon.setAttribute('name', 'preview');
        const label = document.createElement('span');
        label.dataset.i18n = 'studio.resultPreview';
        label.textContent = tr('studio.resultPreview');
        button.append(icon, label);
        button.addEventListener('click', event => {
            event.stopPropagation();
            openLightbox(data.images[0], data.prompt);
        });
        return button;
    }

    function renderImageCard(data, isNew = false) {
        if (!data?.images?.[0]) return null;
        const timestamp = String(data.timestamp ?? Date.now());
        if (document.getElementById(`history-${timestamp}`)) return null;

        const card = document.createElement('ic-card');
        card.id = `history-${timestamp}`;
        card.dataset.historyTs = timestamp;
        card.className = 'result-card';
        card.setAttribute('label', data.prompt || tr('studio.resultPreview'));
        card.setAttribute('size', 'small');

        const media = document.createElement('ic-media-container');
        media.setAttribute('label', data.prompt || tr('studio.previewImage'));
        media.setAttribute('kind', 'image');
        media.setAttribute('fit', 'cover');
        media.setAttribute('aspect', 'square');
        media.setAttribute('state', 'ready');
        media.tabIndex = 0;
        media.setAttribute('aria-label', tr('studio.resultPreview'));

        const image = document.createElement('img');
        image.src = data.images[0];
        image.alt = data.prompt || tr('studio.previewImage');
        image.loading = 'lazy';
        media.append(image);

        const open = () => {
            if (document.body.classList.contains('history-bulk-selecting')) return;
            openLightbox(data.images[0], data.prompt);
        };
        media.addEventListener('click', open);
        media.addEventListener('keydown', event => {
            if (!['Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            open();
        });

        card.append(media);
        if (data.type === 'cloud') {
            const badge = document.createElement('ic-badge');
            badge.className = 'result-cloud-badge';
            badge.setAttribute('kind', 'label');
            badge.setAttribute('tone', 'info');
            badge.textContent = 'ModelScope';
            card.append(badge);
        }
        card.append(makeResultAction(data));

        const masonry = document.getElementById('masonry');
        if (isNew) masonry.prepend(card);
        else masonry.append(card);
        return card;
    }

    async function runCloudTask(prompt) {
        let apiKey = '';
        let hasServerToken = false;
        try {
            const response = await fetch('/api/config');
            const data = await response.json();
            hasServerToken = Boolean(data.has_ms_key);
        } catch (error) {}
        if (hasServerToken) {
            try { localStorage.removeItem(MS_TOKEN_KEY); } catch (error) {}
        } else {
            apiKey = localStorage.getItem(MS_TOKEN_KEY) || '';
        }
        if (!hasServerToken && !apiKey) {
            notify(tr('studio.modelscopeTokenRequired'));
            return;
        }

        setGenerating(true);
        const placeholder = createPlaceholder(tr('studio.cloudProcessing'));
        document.getElementById('masonry').prepend(placeholder);
        try {
            const response = await fetch('/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt,
                    api_key: hasServerToken ? '' : apiKey,
                    resolution: `${document.getElementById('width').value}x${document.getElementById('height').value}`,
                }),
            });
            const data = await response.json();
            if (!response.ok || !data.url) throw new Error(data.detail?.errors?.message || data.detail || tr('studio.generationFailed'));
            renderImageCard({ timestamp: Date.now(), prompt, images: [data.url], type: 'cloud' }, true);
        } catch (error) {
            notify(error.message || tr('studio.generationFailed'));
        } finally {
            placeholder.remove();
            setGenerating(false);
        }
    }

    async function runLocalTask(prompt) {
        setGenerating(true);
        const placeholder = createPlaceholder(tr('studio.processing'));
        document.getElementById('masonry').prepend(placeholder);
        try {
            const response = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt,
                    width: Number.parseInt(document.getElementById('width').value, 10),
                    height: Number.parseInt(document.getElementById('height').value, 10),
                    type: 'zimage',
                    client_id: CLIENT_ID,
                }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || tr('studio.generationFailed'));
            if (data.images?.length > 0) renderImageCard(data, true);
        } catch (error) {
            notify(error.message || tr('studio.generationFailed'));
        } finally {
            placeholder.remove();
            setGenerating(false);
        }
    }

    async function handleRender() {
        const prompt = document.getElementById('prompt').value.trim();
        if (!prompt) {
            notify(tr('studio.enterPrompt'), 'warning');
            document.getElementById('prompt').focus();
            return;
        }
        if (currentEngine === 'local') await runLocalTask(prompt);
        else await runCloudTask(prompt);
    }

    async function loadHistory(page = 0) {
        if (historyLoading) return;
        const trigger = document.getElementById('loadMoreTrigger');
        try {
            historyLoading = true;
            if (page === 0) {
                allHistory = [];
                document.getElementById('masonry').replaceChildren();
                currentIndex = 0;
                trigger.hidden = false;
                buttonLabel(trigger, tr('studio.loadingArchives'));
                trigger.loading = true;
                const response = await fetch('/api/history?type=zimage');
                if (!response.ok) throw new Error(tr('studio.errorHistory'));
                allHistory = await response.json();
            }

            const nextData = allHistory.slice(currentIndex, currentIndex + PAGE_SIZE);
            nextData.forEach(item => renderImageCard(item));
            currentIndex += nextData.length;
            trigger.hidden = currentIndex >= allHistory.length;
            buttonLabel(trigger, tr('studio.loadMore'));
        } catch (error) {
            trigger.hidden = false;
            buttonLabel(trigger, tr('studio.errorHistory'));
            notify(error.message || tr('studio.errorHistory'));
        } finally {
            historyLoading = false;
            trigger.loading = false;
        }
    }

    function ensureLightboxPreview() {
        if (!lightboxPreview && window.StudioImagePreview) lightboxPreview = StudioImagePreview.attach(document.getElementById('lightboxFrame'));
        return lightboxPreview;
    }

    async function openLightbox(url, prompt) {
        const image = document.getElementById('lightboxImg');
        const media = document.getElementById('lightboxMedia');
        const resolution = document.getElementById('lightboxRes');
        const download = document.getElementById('downloadImageBtn');
        resolution.textContent = '…';
        media.setAttribute('state', 'loading');
        download.disabled = true;
        image.onload = () => {
            resolution.textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
            media.setAttribute('state', 'ready');
            download.disabled = false;
        };
        image.onerror = () => {
            media.setAttribute('state', 'unavailable');
            notify(tr('studio.generationFailed'));
        };
        image.src = url;
        document.getElementById('lightboxPrompt').textContent = prompt || '';
        ensureLightboxPreview()?.reset();
        await document.getElementById('lightbox').show();
    }

    function downloadImage() {
        const source = document.getElementById('lightboxImg').src;
        if (!source) return;
        const link = document.createElement('a');
        link.href = source;
        link.download = `Art-${Date.now()}.png`;
        link.click();
    }

    async function applySameStyle() {
        document.getElementById('prompt').value = document.getElementById('lightboxPrompt').textContent;
        await document.getElementById('lightbox').hide('replicate');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        document.getElementById('prompt').focus();
    }

    function confirmBulkDelete(count, message) {
        const dialog = document.getElementById('bulkDeleteDialog');
        dialog.label = tr('bulk.deleteSelected');
        dialog.description = message;
        dialog.confirmLabel = tr('common.delete');
        dialog.cancelLabel = tr('common.cancel');
        return new Promise(resolve => {
            let settled = false;
            const finish = value => {
                if (settled) return;
                settled = true;
                dialog.removeEventListener('ic-confirm', onConfirm);
                dialog.removeEventListener('ic-cancel', onCancel);
                dialog.removeEventListener('ic-after-hide', onHide);
                resolve(value);
            };
            const onConfirm = async () => {
                finish(true);
                await dialog.hide('confirm');
            };
            const onCancel = () => finish(false);
            const onHide = () => finish(false);
            dialog.addEventListener('ic-confirm', onConfirm);
            dialog.addEventListener('ic-cancel', onCancel);
            dialog.addEventListener('ic-after-hide', onHide);
            dialog.show();
        });
    }

    function connectUpdates() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new WebSocket(`${protocol}//${window.location.host}/ws/stats?client_id=${encodeURIComponent(CLIENT_ID)}`);
        socket.addEventListener('message', event => {
            try {
                const message = JSON.parse(event.data);
                if (message.type !== 'new_image' || message.data?.type !== 'zimage') return;
                if (document.getElementById(`history-${message.data.timestamp}`)) return;
                allHistory.unshift(message.data);
                renderImageCard(message.data, true);
                currentIndex += 1;
            } catch (error) {}
        });
        return socket;
    }

    async function updateQueueStatus() {
        try {
            const response = await fetch(`/api/queue_status?client_id=${encodeURIComponent(CLIENT_ID)}`);
            const data = await response.json();
            const badge = document.getElementById('statusBadge');
            if (data.total > 0) {
                badge.textContent = `Queueing ${data.position}/${data.total}`;
                badge.setAttribute('tone', 'warning');
                badge.setAttribute('loading', '');
            } else {
                badge.textContent = tr('studio.ready');
                badge.setAttribute('tone', 'success');
                badge.removeAttribute('loading');
            }
        } catch (error) {}
    }

    async function boot() {
        await customElements.whenDefined('ic-button');
        const savedEngine = localStorage.getItem(ENGINE_MODE_KEY);
        switchEngine(savedEngine === 'cloud' ? 'cloud' : 'local');
        document.getElementById('engineSelector').addEventListener('ic-change', event => switchEngine(event.detail.value));
        document.getElementById('mainGenBtn').addEventListener('click', handleRender);
        document.getElementById('loadMoreTrigger').addEventListener('click', () => loadHistory(1));
        document.getElementById('downloadImageBtn').addEventListener('click', downloadImage);
        document.getElementById('applySameStyleBtn').addEventListener('click', applySameStyle);
        document.getElementById('lightbox').addEventListener('ic-after-hide', () => lightboxPreview?.reset());

        await loadHistory(0);
        window.HistoryBulkManager?.attach({
            masonry: '#masonry',
            confirmDelete: confirmBulkDelete,
            notify,
        });
        connectUpdates();
        updateQueueStatus();
        queueTimer = window.setInterval(updateQueueStatus, 3000);
    }

    window.addEventListener('pagehide', () => window.clearInterval(queueTimer));
    boot();
})();
