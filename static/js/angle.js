await Promise.all([
    customElements.whenDefined('ic-button'),
    customElements.whenDefined('ic-confirmation-dialog'),
    customElements.whenDefined('ic-dialog'),
    customElements.whenDefined('ic-file-input'),
    customElements.whenDefined('ic-image-frame'),
    customElements.whenDefined('ic-toast'),
]);

const tr = key => window.StudioI18n ? window.StudioI18n.t(key) : key;
const tf = (key, values) => window.StudioI18n?.format?.(key, values) || tr(key);
const promptInput = document.getElementById('promptInput');
const dropzone = document.getElementById('dropzone');
const inputPreview = document.getElementById('inputPreview');
const genBtn = document.getElementById('genBtn');
const btnText = document.getElementById('btnText');
const pageAlert = document.getElementById('pageAlert');
const engineMode = document.getElementById('engineMode');
const outputImg = document.getElementById('outputImg');
const outputMedia = document.getElementById('outputMedia');
const resultActions = document.getElementById('resultActions');
const emptyState = document.getElementById('emptyState');
const loadingState = document.getElementById('loadingState');
const cloudProgress = document.getElementById('cloudProgress');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
const lightboxRes = document.getElementById('lightboxRes');
const waitDialog = document.getElementById('waitDialog');
const archiveDeleteDialog = document.getElementById('archiveDeleteDialog');

const ENGINE_MODE_KEY = 'angle_engine_mode';
const PAGE_SIZE = 30;
let currentEngine = 'local';
let uploadedPath = '';
let uploadedFile = null;
let currentResult = null;
let currentPreviewUrl = '';
let allHistory = [];
let currentIndex = 0;
let lightboxPreview = null;

function generateUUID() {
    if (globalThis.crypto?.randomUUID) {
        try { return globalThis.crypto.randomUUID(); } catch (_) {}
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
        const random = Math.random() * 16 | 0;
        const value = character === 'x' ? random : (random & 0x3 | 0x8);
        return value.toString(16);
    });
}

const clientId = localStorage.getItem('client_id') || generateUUID();
localStorage.setItem('client_id', clientId);

function notify(message, tone = 'neutral') {
    const text = String(message || '').trim();
    if (!text) return;
    customElements.get('ic-toast').notify(text, { tone, duration: tone === 'danger' ? 0 : 2600 });
}

function showAlert(message, tone = 'danger') {
    pageAlert.textContent = String(message || '');
    pageAlert.setAttribute('tone', tone);
    pageAlert.hidden = false;
}

function clearAlert() {
    pageAlert.hidden = true;
}

function setGenerating(active, failure = false) {
    genBtn.loading = active;
    genBtn.disabled = active;
    btnText.textContent = active
        ? tr('studio.processing')
        : failure
            ? tr('studio.generationFailed')
            : tr('studio.generateAngle');
}

function applyLanguage() {
    document.title = tr('studio.anglePageTitle');
    if (!genBtn.loading) btnText.textContent = tr('studio.generateAngle');
    if (archiveSelectionCount) refreshArchiveManager();
}

function switchEngine(mode) {
    currentEngine = mode === 'cloud' ? 'cloud' : 'local';
    engineMode.setAttribute('value', currentEngine);
    localStorage.setItem(ENGINE_MODE_KEY, currentEngine);
}

engineMode.addEventListener('ic-change', event => switchEngine(event.detail.value));
const savedMode = localStorage.getItem(ENGINE_MODE_KEY);
switchEngine(savedMode === 'cloud' ? 'cloud' : 'local');

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error(tr('studio.fileReadFailed')));
        reader.readAsDataURL(file);
    });
}

async function handleFile(file) {
    if (!file) return;
    clearAlert();
    uploadedFile = file;
    uploadedPath = '';
    genBtn.disabled = true;
    btnText.textContent = tr('studio.uploading');
    try {
        currentPreviewUrl = await readFileAsDataUrl(file);
        inputPreview.setAttribute('src', currentPreviewUrl);
        inputPreview.setAttribute('alt', file.name || tr('studio.previewImage'));
        inputPreview.setAttribute('state', 'uploading');
        inputPreview.setAttribute('progress', '50');
        window.update3DTexture?.(currentPreviewUrl);

        const formData = new FormData();
        formData.append('files', file);
        const response = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await response.json();
        if (!response.ok || !data.files?.[0]?.comfy_name) throw new Error(data.detail || tr('studio.uploadFailed'));
        uploadedPath = data.files[0].comfy_name;
        inputPreview.setAttribute('state', 'normal');
        inputPreview.removeAttribute('progress');
        btnText.textContent = tr('studio.generateAngle');
    } catch (error) {
        inputPreview.setAttribute('state', currentPreviewUrl ? 'normal' : 'fail');
        showAlert(error.message || tr('studio.uploadFailed'));
        btnText.textContent = tr('studio.uploadFailed');
    } finally {
        genBtn.disabled = false;
    }
}

dropzone.addEventListener('ic-change', event => handleFile(event.detail.acceptedFiles[0]));
inputPreview.addEventListener('ic-preview', event => openLightbox(event.detail.src));
inputPreview.addEventListener('ic-remove', () => {
    uploadedFile = null;
    uploadedPath = '';
    currentPreviewUrl = '';
    dropzone.clear();
});
inputPreview.addEventListener('ic-upload-request', () => dropzone.open());

inputPreview.addEventListener('dragenter', event => {
    event.preventDefault();
    inputPreview.dataset.dragActive = '';
});
inputPreview.addEventListener('dragover', event => event.preventDefault());
inputPreview.addEventListener('dragleave', event => {
    if (!inputPreview.contains(event.relatedTarget)) inputPreview.removeAttribute('data-drag-active');
});
inputPreview.addEventListener('drop', event => {
    event.preventDefault();
    inputPreview.removeAttribute('data-drag-active');
    const image = [...(event.dataTransfer?.files || [])].find(file => file.type.startsWith('image/'));
    if (image) handleFile(image);
    else showAlert(tr('studio.imageFileRequired'));
});

let uploadRegionActive = false;
document.querySelector('.input-panel').addEventListener('pointerenter', () => { uploadRegionActive = true; });
document.querySelector('.input-panel').addEventListener('pointerleave', () => { uploadRegionActive = false; });
window.addEventListener('paste', event => {
    if (!uploadRegionActive) return;
    const image = [...(event.clipboardData?.items || [])]
        .find(item => item.kind === 'file' && item.type.startsWith('image/'))
        ?.getAsFile();
    if (image) handleFile(image);
});

function updateCloudProgress(data) {
    cloudProgress.hidden = false;
    let status = String(data.status || tr('studio.pending'));
    if (status.includes('PENDING')) status = tr('studio.queueing');
    if (status.includes('RUNNING')) status = tr('studio.generating');
    const total = Number(data.total);
    const progress = Number(data.progress);
    const percent = Number.isFinite(total) && total > 0 && Number.isFinite(progress)
        ? Math.min(100, Math.max(0, Math.round(progress / total * 100)))
        : 0;
    cloudProgress.setAttribute('label', status);
    cloudProgress.setAttribute('value', String(percent));
    cloudProgress.setAttribute('value-text', `${percent}%`);
}

window.addEventListener('message', event => {
    if (event.origin && event.origin !== window.location.origin) return;
    if (event.data?.type === 'cloud_status') updateCloudProgress(event.data);
});

function requestContinueWaiting() {
    return new Promise(resolve => {
        const confirm = async () => {
            cleanup();
            await waitDialog.hide('confirm');
            resolve(true);
        };
        const cancel = () => {
            cleanup();
            resolve(false);
        };
        const cleanup = () => {
            waitDialog.removeEventListener('ic-confirm', confirm);
            waitDialog.removeEventListener('ic-cancel', cancel);
        };
        waitDialog.addEventListener('ic-confirm', confirm);
        waitDialog.addEventListener('ic-cancel', cancel);
        waitDialog.show();
    });
}

async function cloudCredentials() {
    let hasServerToken = false;
    try {
        const response = await fetch('/api/config');
        if (response.ok) hasServerToken = Boolean((await response.json()).has_ms_key);
    } catch (error) {
        console.warn('Failed to fetch API capability status', error);
    }
    if (hasServerToken) {
        try { localStorage.removeItem('modelscope_api_token'); } catch (_) {}
        return { token: '', hasServerToken: true };
    }
    const token = localStorage.getItem('modelscope_api_token') || '';
    if (!token) {
        if (window.parent && typeof window.parent.openTokenModal === 'function') window.parent.openTokenModal();
        throw new Error(tr('studio.modelscopeTokenRequired'));
    }
    return { token, hasServerToken: false };
}

async function fetchJsonOrError(response) {
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) {}
    if (!response.ok) throw new Error(data.detail || text || `HTTP ${response.status}`);
    return data;
}

async function runCloudTask() {
    if (!uploadedFile) throw new Error(tr('studio.uploadImageFirst'));
    const { token, hasServerToken } = await cloudCredentials();
    const dataUri = await readFileAsDataUrl(uploadedFile);
    let parentClientId = null;
    try { parentClientId = window.parent?.CID || null; } catch (_) {}
    const payload = {
        prompt: promptInput.value,
        api_key: hasServerToken ? '' : token,
        type: 'angle',
        model: 'Qwen/Qwen-Image-Edit-2511',
        image_urls: [dataUri],
        client_id: parentClientId,
    };
    cloudProgress.hidden = true;
    cloudProgress.setAttribute('value', '0');
    cloudProgress.setAttribute('value-text', '0%');

    let response = await fetch('/api/angle/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    while (true) {
        const data = await fetchJsonOrError(response);
        if (data.url) return { images: [data.url] };
        if (data.status !== 'timeout') throw new Error(tr('studio.unknownResponse'));
        if (!await requestContinueWaiting()) throw new Error(tr('studio.waitingCancelled'));
        updateCloudProgress({ status: tr('studio.resuming'), progress: 0, total: 150 });
        response = await fetch('/api/angle/poll_status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                task_id: data.task_id,
                api_key: hasServerToken ? '' : token,
                client_id: parentClientId,
            }),
        });
    }
}

async function runLocalTask() {
    const seed = Math.floor(Math.random() * 1000000000000000);
    const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            workflow_json: '2511.json',
            params: {
                '31': { image: uploadedPath },
                '11': { prompt: promptInput.value },
                '14': { seed },
            },
            type: 'angle',
            client_id: clientId,
        }),
    });
    const data = await fetchJsonOrError(response);
    if (data.error) throw new Error(data.error);
    if (!data.images?.length) throw new Error(tr('studio.noImagesReturned'));
    return data;
}

async function handleGenerate() {
    clearAlert();
    if (currentEngine === 'local' && !uploadedPath) {
        showAlert(tr('studio.uploadImageFirst'), 'warning');
        dropzone.focus();
        return;
    }
    if (currentEngine === 'cloud' && !uploadedFile) {
        showAlert(tr('studio.uploadImageFirst'), 'warning');
        dropzone.focus();
        return;
    }
    if (!String(promptInput.value || '').trim()) {
        showAlert(tr('studio.enterPrompt'), 'warning');
        promptInput.focus();
        return;
    }

    setGenerating(true);
    emptyState.hidden = true;
    outputMedia.hidden = true;
    resultActions.hidden = true;
    document.getElementById('textResult').hidden = true;
    loadingState.hidden = false;
    try {
        const data = currentEngine === 'cloud' ? await runCloudTask() : await runLocalTask();
        currentResult = data;
        outputImg.src = data.images[0];
        outputMedia.hidden = false;
        resultActions.hidden = false;
        loadingState.hidden = true;
        setGenerating(false);
        renderImageCard({
            images: data.images,
            prompt: promptInput.value,
            timestamp: Date.now(),
            is_cloud: currentEngine === 'cloud',
        }, true);
        notify(tr('studio.angleGenerationComplete'), 'success');
    } catch (error) {
        console.error(error);
        loadingState.hidden = true;
        emptyState.hidden = false;
        setGenerating(false, true);
        showAlert(error.message || tr('studio.generationFailed'));
    }
}

genBtn.addEventListener('click', handleGenerate);

function downloadUrl(url, filename) {
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
}

document.getElementById('previewResultBtn').addEventListener('click', () => {
    if (currentResult?.images?.[0]) openLightbox(currentResult.images[0]);
});
outputImg.addEventListener('click', () => {
    if (currentResult?.images?.[0]) openLightbox(currentResult.images[0]);
});
document.getElementById('downloadBtn').addEventListener('click', () => {
    downloadUrl(currentResult?.images?.[0], `Angle-${Date.now()}.png`);
});
document.getElementById('downloadLightboxBtn').addEventListener('click', () => {
    downloadUrl(lightboxImg.src, `Angle-Master-${Date.now()}.png`);
});

function ensureLightboxPreview() {
    if (!lightboxPreview && window.StudioImagePreview) {
        lightboxPreview = window.StudioImagePreview.attach(document.getElementById('lightboxFrame'));
    }
    return lightboxPreview;
}

function openLightbox(url) {
    if (!url) return;
    lightboxRes.textContent = '';
    lightboxRes.hidden = true;
    ensureLightboxPreview()?.reset();
    lightboxImg.src = url;
    lightboxImg.onload = () => {
        lightboxRes.textContent = `${lightboxImg.naturalWidth} × ${lightboxImg.naturalHeight}`;
        lightboxRes.hidden = false;
    };
    lightbox.show();
}

lightbox.addEventListener('ic-after-hide', () => lightboxPreview?.reset());

document.getElementById('copyTextBtn').addEventListener('click', async () => {
    const text = document.getElementById('generatedText').textContent || '';
    await navigator.clipboard.writeText(text);
    notify(tr('studio.copied'), 'success');
});

function renderImageCard(data, isNew = false) {
    const imageUrl = data.images?.[0] || '';
    if (!imageUrl) return;
    const masonry = document.getElementById('masonry');
    const card = document.createElement('ic-card');
    card.className = 'archive-card';
    card.setAttribute('size', 'small');
    card.setAttribute('label', data.prompt || 'Angle Control');
    card.setAttribute('tabindex', '0');
    card.dataset.historyTs = String(data.timestamp);
    card.id = `history-${data.timestamp}`;

    const media = document.createElement('ic-media-container');
    media.className = 'archive-media';
    media.setAttribute('kind', 'image');
    media.setAttribute('fit', 'cover');
    media.setAttribute('aspect', 'square');
    media.setAttribute('label', data.prompt || 'Angle Control');
    const image = document.createElement('img');
    image.src = imageUrl;
    image.alt = data.prompt || 'Angle Control';
    media.appendChild(image);

    const caption = document.createElement('div');
    caption.className = 'archive-caption';
    const prompt = document.createElement('span');
    prompt.className = 'archive-prompt';
    prompt.textContent = data.prompt || 'Angle Control';
    caption.appendChild(prompt);
    if (data.is_cloud || imageUrl.includes('cloud_angle')) {
        const badge = document.createElement('ic-badge');
        badge.setAttribute('kind', 'label');
        badge.setAttribute('size', 'small');
        badge.textContent = 'ModelScope';
        caption.appendChild(badge);
    }
    card.append(media, caption);
    card.addEventListener('click', () => archiveSelecting ? toggleArchiveCard(card) : openLightbox(imageUrl));
    card.addEventListener('keydown', event => {
        if (!['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        archiveSelecting ? toggleArchiveCard(card) : openLightbox(imageUrl);
    });
    if (isNew) masonry.prepend(card); else masonry.appendChild(card);
    document.getElementById('archiveEmpty').hidden = true;
}

function loadNextPage() {
    const batch = allHistory.slice(currentIndex, currentIndex + PAGE_SIZE);
    batch.forEach(item => renderImageCard(item));
    currentIndex += batch.length;
    document.getElementById('loadMoreTrigger').hidden = currentIndex < allHistory.length;
}

async function loadHistory() {
    const archiveLoading = document.getElementById('archiveLoading');
    archiveLoading.hidden = false;
    try {
        const response = await fetch('/api/history?type=angle');
        const history = await fetchJsonOrError(response);
        allHistory = Array.isArray(history) ? history : [];
        document.getElementById('masonry').replaceChildren();
        currentIndex = 0;
        loadNextPage();
        document.getElementById('archiveEmpty').hidden = allHistory.length > 0;
    } catch (error) {
        showAlert(error.message || tr('studio.errorHistory'));
    } finally {
        archiveLoading.hidden = true;
    }
}

const archiveSelection = new Set();
let archiveSelecting = false;
const archiveManageBtn = document.getElementById('archiveManageBtn');
const archiveSelectionCount = document.getElementById('archiveSelectionCount');
const archiveSelectAllBtn = document.getElementById('archiveSelectAllBtn');
const archiveDeleteBtn = document.getElementById('archiveDeleteBtn');
const archiveExitBtn = document.getElementById('archiveExitBtn');

function archiveCards() {
    return [...document.querySelectorAll('#masonry [data-history-ts]')];
}

function refreshArchiveManager() {
    archiveManageBtn.hidden = archiveSelecting;
    [archiveSelectionCount, archiveSelectAllBtn, archiveDeleteBtn, archiveExitBtn].forEach(control => { control.hidden = !archiveSelecting; });
    archiveSelectionCount.textContent = tf('studio.selectedArchives', { count: archiveSelection.size });
    archiveDeleteBtn.disabled = archiveSelection.size === 0;
    const cards = archiveCards();
    archiveSelectAllBtn.textContent = tr(
        cards.length > 0 && archiveSelection.size === cards.length
            ? 'bulk.deselectAll'
            : 'bulk.selectAll',
    );
    cards.forEach(card => {
        const selected = archiveSelection.has(card.dataset.historyTs);
        card.toggleAttribute('data-selected', selected);
        card.setAttribute('aria-selected', String(selected));
    });
}

function toggleArchiveCard(card) {
    const timestamp = card.dataset.historyTs;
    if (archiveSelection.has(timestamp)) archiveSelection.delete(timestamp);
    else archiveSelection.add(timestamp);
    refreshArchiveManager();
}

function exitArchiveManager() {
    archiveSelecting = false;
    archiveSelection.clear();
    refreshArchiveManager();
}

archiveManageBtn.addEventListener('click', () => {
    archiveSelecting = true;
    refreshArchiveManager();
});
archiveExitBtn.addEventListener('click', exitArchiveManager);
archiveSelectAllBtn.addEventListener('click', () => {
    const cards = archiveCards();
    if (archiveSelection.size === cards.length) archiveSelection.clear();
    else cards.forEach(card => archiveSelection.add(card.dataset.historyTs));
    refreshArchiveManager();
});
archiveDeleteBtn.addEventListener('click', () => archiveDeleteDialog.show());
archiveDeleteDialog.addEventListener('ic-confirm', async () => {
    archiveDeleteDialog.confirmLoading = true;
    const timestamps = [...archiveSelection];
    const results = await Promise.allSettled(timestamps.map(timestamp => fetch('/api/history/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp }),
    }).then(fetchJsonOrError)));
    const failed = results.filter(result => result.status === 'rejected').length;
    timestamps.forEach((timestamp, index) => {
        if (results[index].status === 'fulfilled') document.getElementById(`history-${timestamp}`)?.remove();
    });
    archiveDeleteDialog.confirmLoading = false;
    await archiveDeleteDialog.hide('confirm');
    if (failed) {
        showAlert(tf('studio.archiveDeleteFailed', { failed, total: timestamps.length }));
    } else {
        notify(tr('studio.archivesDeleted'), 'success');
    }
    exitArchiveManager();
    document.getElementById('archiveEmpty').hidden = archiveCards().length > 0;
});

const loadObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && currentIndex < allHistory.length) loadNextPage();
}, { threshold: 0.1 });
loadObserver.observe(document.getElementById('loadMoreTrigger'));

window.addEventListener('studio-lang-change', applyLanguage);
window.addEventListener('message', event => {
    if (event.origin && event.origin !== window.location.origin) return;
    if (event.data?.type === 'studio-lang') applyLanguage();
});
applyLanguage();
loadHistory();
refreshArchiveManager();

try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/stats?client_id=${clientId}`);
    socket.addEventListener('open', () => {
        window.setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) socket.send('ping');
        }, 30000);
    });
} catch (error) {
    console.warn('Angle status channel unavailable', error);
}
