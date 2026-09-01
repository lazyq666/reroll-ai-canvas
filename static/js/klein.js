await Promise.all([
    customElements.whenDefined('ic-button'),
    customElements.whenDefined('ic-dialog'),
    customElements.whenDefined('ic-file-input'),
    customElements.whenDefined('ic-image-frame'),
]);

const $ = selector => document.querySelector(selector);
const tr = key => window.StudioI18n ? StudioI18n.t(key) : key;
const tf = (key, values) => window.StudioI18n ? StudioI18n.format(key, values) : key;

function notify(message, tone = 'neutral') {
    const Toast = customElements.get('ic-toast');
    if (Toast?.notify) return Toast.notify(String(message), { tone });
    const toast = document.createElement('ic-toast');
    toast.setAttribute('tone', tone);
    toast.textContent = String(message);
    document.body.append(toast);
    return toast;
}

function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        try { return crypto.randomUUID(); } catch (error) { }
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
        const random = Math.random() * 16 | 0;
        const value = character === 'x' ? random : (random & 0x3 | 0x8);
        return value.toString(16);
    });
}

const CLIENT_ID_KEY = 'client_id';
const CLIENT_ID = localStorage.getItem(CLIENT_ID_KEY) || generateUUID();
localStorage.setItem(CLIENT_ID_KEY, CLIENT_ID);

const SLOT_COPY = {
    1: { label: 'studio.mainImage' },
    2: { label: 'studio.auxImageA' },
    3: { label: 'studio.auxImageB' },
};

const uploadedNames = { 1: '', 2: '', 3: '' };
const base64Images = { 1: '', 2: '', 3: '' };
const slotDimensions = { 1: null, 2: null, 3: null };
let allHistory = [];
let currentResult = null;
let currentLightboxData = null;
let currentIndex = 0;
let isLoading = false;
let engine = 'local';
let loraEnabled = false;
let hoveredSlot = null;
let historySelecting = false;
const PAGE_SIZE = 24;

const promptInput = $('#promptInput');
const engineSwitch = $('#engineSwitch');
const loraSection = $('#loraSection');
const loraSwitch = $('#loraSwitch');
const loraStrengthRow = $('#loraStrengthRow');
const loraStrengthSlider = $('#loraStrengthSlider');
const loraStrengthVal = $('#loraStrengthVal');
const cloudImgNote = $('#cloudImgNote');
const cloudStatusBar = $('#cloudStatusBar');
const cloudStatusText = $('#cloudStatusText');
const genBtn = $('#genBtn');
const btnText = $('#btnText');
const placeholder = $('#placeholder');
const loader = $('#loader');
const resultMedia = $('#resultMedia');
const outputImg = $('#outputImg');
const resultActions = $('#resultActions');
const lightbox = $('#lightbox');
const singlePreview = $('#singlePreview');
const comparePreview = $('#comparePreview');
const compareContainer = $('#compareContainer');
const compareSlider = $('#compareSlider');
const lightboxImg = $('#lightboxImg');
const lightboxPrompt = $('#lightboxPrompt');
const lightboxRes = $('#lightboxRes');
const sameStyleBtn = $('#sameStyleBtn');
const masonry = $('#masonry');
const loadMoreTrigger = $('#loadMoreTrigger');
const manageHistoryBtn = $('#manageHistoryBtn');
const historySelectionCount = $('#historySelectionCount');
const selectAllHistoryBtn = $('#selectAllHistoryBtn');
const deleteHistoryBtn = $('#deleteHistoryBtn');
const exitHistoryBtn = $('#exitHistoryBtn');
const deleteHistoryDialog = $('#deleteHistoryDialog');
const deleteHistoryCopy = $('#deleteHistoryCopy');

function slotFrame(index) { return $(`#slotFrame${index}`); }
function slotInput(index) { return $(`#file${index}`); }

function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => resolve(reader.result), { once: true });
        reader.addEventListener('error', () => reject(reader.error || new Error(tr('studio.uploadFailed'))), { once: true });
        reader.readAsDataURL(file);
    });
}

function readImageDimensions(dataUrl) {
    return new Promise(resolve => {
        const image = new Image();
        image.addEventListener('load', () => resolve({ width: image.naturalWidth, height: image.naturalHeight }), { once: true });
        image.addEventListener('error', () => resolve(null), { once: true });
        image.src = dataUrl;
    });
}

async function uploadForLocal(file) {
    const formData = new FormData();
    formData.append('files', file);
    try {
        const response = await fetch('/api/upload', { method: 'POST', body: formData });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return data.files?.[0]?.comfy_name || file.name;
    } catch (error) {
        return file.name;
    }
}

async function handleFile(file, index) {
    if (!file || !String(file.type || '').startsWith('image/')) {
        notify(tr('studio.uploadImageFirst'), 'warning');
        return;
    }
    const frame = slotFrame(index);
    const label = tr(SLOT_COPY[index].label);
    try {
        const dataUrl = await readAsDataURL(file);
        base64Images[index] = dataUrl;
        slotDimensions[index] = await readImageDimensions(dataUrl);
        frame.setAttribute('src', dataUrl);
        frame.setAttribute('alt', `${label} · ${file.name}`);
        frame.setAttribute('state', 'uploading');
        frame.setAttribute('progress', '35');
        uploadedNames[index] = await uploadForLocal(file);
        frame.setAttribute('progress', '100');
        frame.setAttribute('state', 'normal');
    } catch (error) {
        clearSlot(index);
        notify(`${tr('studio.uploadFailed')}: ${error.message}`, 'danger');
    }
}

function clearSlot(index) {
    uploadedNames[index] = '';
    base64Images[index] = '';
    slotDimensions[index] = null;
    slotInput(index).clear({ silent: true });
    const frame = slotFrame(index);
    frame.removeAttribute('src');
    frame.removeAttribute('alt');
    frame.removeAttribute('progress');
    frame.setAttribute('state', 'upload');
}

for (const index of [1, 2, 3]) {
    const frame = slotFrame(index);
    const input = slotInput(index);
    frame.addEventListener('ic-upload-request', () => input.open());
    frame.addEventListener('ic-remove', () => {
        uploadedNames[index] = '';
        base64Images[index] = '';
        slotDimensions[index] = null;
        input.clear({ silent: true });
    });
    frame.addEventListener('ic-preview', event => openLightbox(event.detail.src));
    input.addEventListener('ic-change', event => {
        const file = event.detail.acceptedFiles?.[0];
        if (file) handleFile(file, index);
    });
    frame.addEventListener('pointerenter', () => { hoveredSlot = index; });
    frame.addEventListener('pointerleave', () => { if (hoveredSlot === index) hoveredSlot = null; });
}

window.addEventListener('paste', event => {
    if (!hoveredSlot) return;
    const item = [...(event.clipboardData?.items || [])].find(candidate => (
        candidate.kind === 'file' && candidate.type.startsWith('image/')
    ));
    if (!item) return;
    event.preventDefault();
    handleFile(item.getAsFile(), hoveredSlot);
});

function setEngine(mode) {
    engine = mode === 'cloud' ? 'cloud' : 'local';
    engineSwitch.setAttribute('value', engine);
    const cloud = engine === 'cloud';
    cloudImgNote.hidden = !cloud;
    loraSection.hidden = !cloud;
    if (!cloud) setCloudStatus('', false);
}

engineSwitch.addEventListener('ic-change', event => setEngine(event.detail.value));

loraSwitch.addEventListener('change', () => {
    loraEnabled = Boolean(loraSwitch.checked);
    loraStrengthRow.hidden = !loraEnabled;
});

function syncLoraStrength() {
    const formatted = Number(loraStrengthSlider.value).toFixed(2);
    loraStrengthSlider.setAttribute('value-text', formatted);
    loraStrengthVal.textContent = formatted;
}

loraStrengthSlider.addEventListener('input', syncLoraStrength);
loraStrengthSlider.addEventListener('change', syncLoraStrength);

function setCloudStatus(text, visible = true) {
    cloudStatusText.textContent = text;
    cloudStatusBar.hidden = !visible;
    cloudStatusBar.toggleAttribute('loading', visible);
}

function setGenerating(busy, cloud = false) {
    genBtn.loading = busy;
    genBtn.disabled = busy;
    btnText.textContent = busy
        ? tr(cloud ? 'studio.cloudProcessing' : 'studio.synthesizing')
        : tr('studio.executeSynthesis');
    placeholder.hidden = busy || Boolean(currentResult);
    loader.hidden = !busy;
    if (busy) {
        resultMedia.hidden = true;
        resultActions.hidden = true;
    }
}

function showResult(data) {
    currentResult = data;
    outputImg.src = data.images[0];
    resultMedia.hidden = false;
    resultActions.hidden = false;
    placeholder.hidden = true;
    loader.hidden = true;
    renderImageCard(data, true);
}

async function submitWorkflow() {
    if (engine === 'cloud') await submitCloud();
    else await submitLocal();
}

async function submitLocal() {
    if (!uploadedNames[1]) {
        notify(tr('studio.uploadMainImage'), 'warning');
        return;
    }
    setGenerating(true, false);
    const prompt = promptInput.value;
    const payload = {
        prompt,
        workflow_json: 'Flux2-Klein.json',
        type: 'klein',
        params: {
            '168': { text: prompt },
            '158': { noise_seed: Math.floor(Math.random() * 1000000) },
            '278': { image: uploadedNames[1] },
            '270': { image: uploadedNames[2] || '' },
            '292': { image: uploadedNames[3] || '' },
            '313': { value: uploadedNames[2] !== '' },
            '314': { value: uploadedNames[3] !== '' },
        },
    };
    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payload, client_id: CLIENT_ID }),
        });
        const result = await response.json();
        if (!response.ok || result.error) throw new Error(result.error || `HTTP ${response.status}`);
        if (!result.images?.[0]) throw new Error(tr('studio.generationFailed'));
        showResult(result);
    } catch (error) {
        notify(`${tr('studio.generationFailed')}: ${error.message}`, 'danger');
    } finally {
        setGenerating(false, false);
    }
}

function computeMsSize(width, height) {
    let nextWidth = Math.round(width) || 0;
    let nextHeight = Math.round(height) || 0;
    if (!nextWidth || !nextHeight) return { width: 1024, height: 1024 };
    const minimum = 512;
    const maximum = 2048;
    const longest = Math.max(nextWidth, nextHeight);
    if (longest > maximum) {
        const scale = maximum / longest;
        nextWidth = Math.round(nextWidth * scale);
        nextHeight = Math.round(nextHeight * scale);
    }
    const align = value => Math.min(maximum, Math.max(minimum, Math.round(value / 64) * 64));
    return { width: align(nextWidth), height: align(nextHeight) };
}

async function submitCloud() {
    const prompt = promptInput.value.trim();
    if (!prompt) {
        notify(tr('studio.enterPrompt'), 'warning');
        return;
    }
    if (!base64Images[1]) {
        notify(tr('studio.uploadMainImage'), 'warning');
        return;
    }
    setGenerating(true, true);
    setCloudStatus(tr('studio.submittingModelscope'));
    try {
        setCloudStatus(tr('studio.processingKlein'));
        const size = computeMsSize(slotDimensions[1]?.width, slotDimensions[1]?.height);
        const payload = {
            prompt,
            model: 'black-forest-labs/FLUX.2-klein-9B',
            image_urls: [base64Images[1], base64Images[2], base64Images[3]].filter(Boolean),
            width: size.width,
            height: size.height,
            client_id: CLIENT_ID,
        };
        if (loraEnabled) {
            payload.loras = { 'Daniel8152/Klein-enhance': Number(loraStrengthSlider.value) };
        }
        const response = await fetch('/api/ms/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || tr('studio.cloudGenerationFailed'));
        if (!result.url) throw new Error(tr('studio.cloudGenerationFailed'));
        const resultData = {
            prompt,
            images: [result.url],
            timestamp: Date.now() / 1000,
            type: 'klein',
            model: 'black-forest-labs/FLUX.2-klein-9B',
        };
        showResult(resultData);
        setCloudStatus(tr('studio.generationComplete'), false);
    } catch (error) {
        setCloudStatus(error.message, false);
        notify(`${tr('studio.cloudGenerationFailed')}: ${error.message}`, 'danger');
    } finally {
        setGenerating(false, true);
    }
}

genBtn.addEventListener('click', submitWorkflow);

function setResolution(target) {
    if (!target?.naturalWidth) {
        lightboxRes.hidden = true;
        return;
    }
    lightboxRes.textContent = `${target.naturalWidth} × ${target.naturalHeight}`;
    lightboxRes.hidden = false;
}

async function openLightbox(dataOrUrl) {
    const data = typeof dataOrUrl === 'string' ? { images: [dataOrUrl] } : dataOrUrl;
    if (!data?.images?.[0]) return;
    currentLightboxData = data;
    lightboxPrompt.textContent = data.prompt || tr('studio.noPromptMetadata');
    lightboxRes.hidden = true;
    const originalName = data.params?.['278']?.image;
    if (originalName) {
        singlePreview.hidden = true;
        comparePreview.hidden = false;
        const generated = $('#compareGenerated');
        generated.src = data.images[0];
        $('#compareOriginal').src = `/api/view?filename=${encodeURIComponent(originalName)}&type=input`;
        compareSlider.value = 50;
        compareSlider.setAttribute('value', '50');
        compareSlider.setAttribute('value-text', '50%');
        compareContainer.style.setProperty('--compare-position', '50%');
        generated.addEventListener('load', () => setResolution(generated), { once: true });
        if (generated.complete) setResolution(generated);
    } else {
        comparePreview.hidden = true;
        singlePreview.hidden = false;
        lightboxImg.src = data.images[0];
        lightboxImg.addEventListener('load', () => setResolution(lightboxImg), { once: true });
        if (lightboxImg.complete) setResolution(lightboxImg);
    }
    sameStyleBtn.hidden = !data.params;
    await lightbox.show();
}

function updateCompare() {
    const value = Number(compareSlider.value);
    compareSlider.setAttribute('value-text', `${value}%`);
    compareContainer.style.setProperty('--compare-position', `${value}%`);
}

compareSlider.addEventListener('input', updateCompare);
compareSlider.addEventListener('change', updateCompare);

function downloadUrl(url) {
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = `Klein-${Date.now()}.png`;
    link.click();
}

$('#previewResultBtn').addEventListener('click', () => openLightbox(currentResult));
$('#downloadBtn').addEventListener('click', () => downloadUrl(currentResult?.images?.[0]));
$('#downloadLightboxBtn').addEventListener('click', () => downloadUrl(currentLightboxData?.images?.[0]));

async function applySameStyle() {
    if (!currentLightboxData?.params) return;
    promptInput.value = currentLightboxData.prompt || '';
    const params = currentLightboxData.params;
    for (const [slotId, nodeId] of [[1, '278'], [2, '270'], [3, '292']]) {
        const filename = params[nodeId]?.image || '';
        if (!filename) {
            clearSlot(slotId);
            continue;
        }
        uploadedNames[slotId] = filename;
        base64Images[slotId] = '';
        slotDimensions[slotId] = null;
        const frame = slotFrame(slotId);
        frame.setAttribute('src', `/api/view?filename=${encodeURIComponent(filename)}&type=input`);
        frame.setAttribute('alt', `${tr(SLOT_COPY[slotId].label)} · ${filename}`);
        frame.setAttribute('state', 'normal');
    }
    await lightbox.hide('replicate');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

sameStyleBtn.addEventListener('click', applySameStyle);

function historyCards() { return [...masonry.querySelectorAll('.history-item')]; }
function selectedHistoryCards() { return historyCards().filter(card => card.classList.contains('is-selected')); }

function setHistoryCardSelected(card, selected) {
    card.classList.toggle('is-selected', selected);
    const checkbox = card.querySelector('ic-checkbox');
    if (checkbox) checkbox.checked = selected;
}

function refreshHistoryManagement() {
    const cards = historyCards();
    const selected = selectedHistoryCards();
    manageHistoryBtn.hidden = historySelecting;
    historySelectionCount.hidden = !historySelecting;
    selectAllHistoryBtn.hidden = !historySelecting;
    deleteHistoryBtn.hidden = !historySelecting;
    exitHistoryBtn.hidden = !historySelecting;
    historySelectionCount.textContent = tf('bulk.selectedCount', { n: selected.length });
    deleteHistoryBtn.disabled = selected.length === 0;
    const allSelected = cards.length > 0 && selected.length === cards.length;
    selectAllHistoryBtn.querySelector('span').textContent = tr(allSelected ? 'bulk.deselectAll' : 'bulk.selectAll');
    cards.forEach(card => { card.querySelector('ic-checkbox').hidden = !historySelecting; });
}

function enterHistoryManagement() {
    historySelecting = true;
    refreshHistoryManagement();
}

function exitHistoryManagement() {
    historySelecting = false;
    historyCards().forEach(card => setHistoryCardSelected(card, false));
    refreshHistoryManagement();
}

manageHistoryBtn.addEventListener('click', enterHistoryManagement);
exitHistoryBtn.addEventListener('click', exitHistoryManagement);
selectAllHistoryBtn.addEventListener('click', () => {
    const cards = historyCards();
    const shouldSelect = selectedHistoryCards().length !== cards.length;
    cards.forEach(card => setHistoryCardSelected(card, shouldSelect));
    refreshHistoryManagement();
});

deleteHistoryBtn.addEventListener('click', async () => {
    const count = selectedHistoryCards().length;
    if (!count) {
        notify(tr('bulk.noSelection'), 'warning');
        return;
    }
    const message = tf('bulk.deleteConfirm', { n: count });
    deleteHistoryDialog.setAttribute('description', message);
    deleteHistoryCopy.textContent = message;
    await deleteHistoryDialog.show();
});

deleteHistoryDialog.addEventListener('ic-confirm', async () => {
    const selected = selectedHistoryCards();
    if (!selected.length) return;
    deleteHistoryDialog.confirmLoading = true;
    const results = await Promise.allSettled(selected.map(async card => {
        const response = await fetch('/api/history/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timestamp: card.dataset.historyTs }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error('delete failed');
        card.remove();
    }));
    deleteHistoryDialog.confirmLoading = false;
    await deleteHistoryDialog.hide('confirm');
    const failed = results.filter(result => result.status === 'rejected').length;
    if (failed) notify(tf('studio.deleteArchivesFailed', { failed, total: selected.length }), 'danger');
    refreshHistoryManagement();
    if (!historyCards().length) exitHistoryManagement();
});

function renderImageCard(data, isNew = false) {
    if (!data?.images?.[0] || $(`#history-${CSS.escape(String(data.timestamp))}`)) return;
    const article = document.createElement('article');
    article.id = `history-${data.timestamp}`;
    article.className = 'history-item';
    article.dataset.historyTs = data.timestamp;

    const card = document.createElement('ic-card');
    card.setAttribute('size', 'small');
    card.setAttribute('label', data.prompt || tr('studio.kleinArchive'));

    const checkbox = document.createElement('ic-checkbox');
    checkbox.className = 'history-select';
    checkbox.setAttribute('label', tr('studio.selectArchive'));
    checkbox.hidden = !historySelecting;
    checkbox.addEventListener('change', () => {
        setHistoryCardSelected(article, Boolean(checkbox.checked));
        refreshHistoryManagement();
    });

    const media = document.createElement('ic-media-container');
    media.className = 'history-media';
    media.setAttribute('kind', 'image');
    media.setAttribute('fit', 'cover');
    media.setAttribute('aspect', 'square');
    media.setAttribute('state', 'ready');
    media.setAttribute('label', data.prompt || tr('studio.kleinArchive'));
    const image = document.createElement('img');
    image.src = data.images[0];
    image.alt = data.prompt || tr('studio.kleinArchive');
    image.loading = 'lazy';
    media.append(image);

    const meta = document.createElement('div');
    meta.className = 'history-meta';
    const prompt = document.createElement('p');
    prompt.className = 'history-prompt';
    prompt.textContent = data.prompt || tr('studio.kleinArchive');
    const footer = document.createElement('div');
    footer.className = 'history-footer';
    if (data.model) {
        const model = document.createElement('ic-badge');
        model.setAttribute('kind', 'label');
        model.setAttribute('tone', 'neutral');
        model.setAttribute('size', 'small');
        model.textContent = data.model.split('/').pop();
        footer.append(model);
    }
    const openButton = document.createElement('ic-button');
    openButton.setAttribute('type', 'button');
    openButton.setAttribute('hierarchy', 'quiet');
    openButton.dataset.i18n = 'studio.previewImage';
    openButton.textContent = tr('studio.previewImage');
    openButton.addEventListener('click', () => {
        if (!historySelecting) openLightbox(data);
    });
    footer.append(openButton);
    meta.append(prompt, footer);
    card.append(checkbox, media, meta);
    article.append(card);
    if (isNew) masonry.prepend(article);
    else masonry.append(article);
    refreshHistoryManagement();
}

async function loadHistory(page = 0) {
    if (isLoading) return;
    try {
        isLoading = true;
        loadMoreTrigger.loading = true;
        loadMoreTrigger.disabled = true;
        loadMoreTrigger.textContent = tr(page === 0 ? 'studio.loadingArchives' : 'common.loading');
        if (page === 0) {
            const response = await fetch('/api/history?type=klein');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            allHistory = await response.json();
            masonry.replaceChildren();
            currentIndex = 0;
        }
        const nextData = allHistory.slice(currentIndex, currentIndex + PAGE_SIZE);
        nextData.forEach(item => renderImageCard(item));
        currentIndex += nextData.length;
        loadMoreTrigger.hidden = currentIndex >= allHistory.length;
    } catch (error) {
        loadMoreTrigger.hidden = false;
        loadMoreTrigger.textContent = tr('studio.errorHistory');
        notify(`${tr('studio.errorHistory')}: ${error.message}`, 'danger');
    } finally {
        isLoading = false;
        loadMoreTrigger.loading = false;
        loadMoreTrigger.disabled = false;
        if (currentIndex < allHistory.length) loadMoreTrigger.textContent = tr('studio.loadMore');
    }
}

loadMoreTrigger.addEventListener('click', () => loadHistory(1));

const historyObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && !isLoading && currentIndex < allHistory.length) loadHistory(1);
}, { threshold: 0.1 });
historyObserver.observe(loadMoreTrigger);

function applyLanguage() {
    document.title = tr('studio.kleinPageTitle');
    syncLoraStrength();
    refreshHistoryManagement();
    historyCards().forEach(card => {
        card.querySelector('ic-checkbox')?.setAttribute('label', tr('studio.selectArchive'));
        const openButton = card.querySelector('ic-button[data-i18n="studio.previewImage"]');
        if (openButton) openButton.textContent = tr('studio.previewImage');
    });
    if (!isLoading && currentIndex < allHistory.length) loadMoreTrigger.textContent = tr('studio.loadMore');
}

window.addEventListener('studio-lang-change', applyLanguage);
window.addEventListener('message', event => {
    if (event.origin && event.origin !== window.location.origin) return;
    if (event.data?.type === 'studio-lang') applyLanguage();
});

window.addEventListener('load', () => {
    window.StudioI18n?.apply?.();
    applyLanguage();
    loadHistory(0);
});
