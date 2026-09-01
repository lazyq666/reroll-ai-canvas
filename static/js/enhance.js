(function () {
    'use strict';

    const WORKFLOW = 'Z-Image-Enhance.json';
    const UPSCALE_WORKFLOW = 'upscale.json';

    function tr(key) {
        return window.StudioI18n ? StudioI18n.t(key) : key;
    }

    function generateUUID() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            try { return crypto.randomUUID(); } catch (_) {}
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
            const random = Math.random() * 16 | 0;
            const value = character === 'x' ? random : (random & 0x3 | 0x8);
            return value.toString(16);
        });
    }

    function getClientId() {
        const stored = localStorage.getItem('client_id');
        const clientId = stored || generateUUID();
        if (!stored) localStorage.setItem('client_id', clientId);
        return clientId;
    }

    const state = {
        uploadedPath: '',
        currentResult: null,
        activePreviewResult: null,
        currentUpscaleFactor: 2048,
        previewUrl: '',
        clientId: getClientId(),
    };

    const elements = {};

    function cacheElements() {
        [
            'fileInput', 'sourcePreview', 'sourceLightbox', 'sourceLightboxImg',
            'strengthSlider', 'upscaleToggle', 'upscaleOptions', 'btn2x', 'btn4x',
            'genBtn', 'btnText', 'emptyState', 'loadingState', 'generationAlert',
            'generationAlertText', 'outputMedia', 'outputImg', 'resultActions',
            'previewBtn', 'downloadBtn', 'masonry', 'lightbox', 'compareContainer',
            'compareGenerated', 'compareOriginalWrapper', 'compareOriginal', 'compareSlider',
            'lightboxFrame', 'lightboxImg', 'lightboxRes', 'saveMasterBtn', 'historyDeleteDialog',
        ].forEach(id => { elements[id] = document.getElementById(id); });
    }

    function applyLanguage(lang) {
        if (lang && window.StudioI18n) StudioI18n.set(lang);
        document.title = tr('nav.enhance');
        if (!elements.genBtn?.loading) elements.btnText.textContent = tr('studio.beginRemaster');
    }

    function setGenerationAlert(message = '') {
        elements.generationAlert.hidden = !message;
        elements.generationAlertText.textContent = message;
    }

    function setGenerateAvailability() {
        elements.genBtn.disabled = !state.uploadedPath || elements.sourcePreview.getAttribute('state') === 'uploading';
    }

    function releasePreviewUrl() {
        if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
        state.previewUrl = '';
    }

    function resetSource() {
        releasePreviewUrl();
        state.uploadedPath = '';
        elements.fileInput.clear({ silent: true });
        elements.fileInput.hidden = true;
        elements.fileInput.removeAttribute('disabled');
        elements.sourcePreview.hidden = false;
        elements.sourcePreview.removeAttribute('src');
        elements.sourcePreview.removeAttribute('alt');
        elements.sourcePreview.setAttribute('state', 'upload');
        setGenerateAvailability();
    }

    function showSourcePreview(file) {
        releasePreviewUrl();
        state.previewUrl = URL.createObjectURL(file);
        elements.sourcePreview.setAttribute('src', state.previewUrl);
        elements.sourcePreview.setAttribute('alt', file.name || tr('studio.inputSource'));
        elements.sourcePreview.setAttribute('state', 'uploading');
        elements.sourcePreview.setAttribute('progress', '0');
        elements.sourcePreview.setAttribute('upload-label', tr('studio.uploading'));
        elements.sourcePreview.hidden = false;
    }

    async function uploadFile(file) {
        if (!file) return;
        state.uploadedPath = '';
        showSourcePreview(file);
        setGenerateAvailability();

        const formData = new FormData();
        formData.append('files', file);
        try {
            const response = await fetch('/api/upload', { method: 'POST', body: formData });
            if (!response.ok) throw new Error(`Upload failed with status ${response.status}`);
            const data = await response.json();
            const uploadedFile = data.files?.[0];
            if (!uploadedFile?.comfy_name) throw new Error('Upload response did not include a file');
            state.uploadedPath = uploadedFile.comfy_name;
            elements.sourcePreview.setAttribute('state', 'normal');
            elements.sourcePreview.removeAttribute('progress');
        } catch (error) {
            console.warn('Upload error', error);
            elements.sourcePreview.setAttribute('state', 'normal');
            elements.sourcePreview.removeAttribute('progress');
            notify(tr('studio.uploadFailed'), 'danger');
        } finally {
            setGenerateAvailability();
        }
    }

    function handleFileChange(event) {
        const file = event.detail?.acceptedFiles?.[0] || elements.fileInput.files[0];
        if (file) uploadFile(file);
    }

    function openSourcePreview(event) {
        const src = event.detail?.src || elements.sourcePreview.getAttribute('src');
        if (!src) return;
        elements.sourceLightboxImg.src = src;
        elements.sourceLightboxImg.alt = event.detail?.alt || tr('studio.inputSource');
        elements.sourceLightbox.show();
    }

    function setUpscaleFactor(factor) {
        state.currentUpscaleFactor = factor;
        const twoX = factor === 2048;
        elements.btn2x.pressed = twoX;
        elements.btn2x.hierarchy = twoX ? 'secondary' : 'quiet';
        elements.btn4x.pressed = !twoX;
        elements.btn4x.hierarchy = twoX ? 'quiet' : 'secondary';
    }

    function toggleUpscaleOptions() {
        elements.upscaleOptions.hidden = !elements.upscaleToggle.checked;
    }

    function setBusy(labelKey) {
        const label = tr(labelKey);
        elements.genBtn.loading = true;
        elements.genBtn.disabled = true;
        elements.btnText.textContent = label;
        elements.loadingState.setAttribute('label', label);
        elements.loadingState.hidden = false;
        elements.emptyState.hidden = true;
        elements.outputMedia.hidden = true;
        elements.resultActions.hidden = true;
        setGenerationAlert('');
    }

    function clearBusy() {
        elements.genBtn.loading = false;
        elements.btnText.textContent = tr('studio.beginRemaster');
        elements.loadingState.hidden = true;
        setGenerateAvailability();
    }

    async function requestGeneration(workflow, params) {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                workflow_json: workflow,
                params,
                type: 'enhance',
                client_id: state.clientId,
            }),
        });
        if (!response.ok) throw new Error(`Generate request failed with status ${response.status}`);
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        if (!data.images?.length) throw new Error('No images returned');
        return data;
    }

    async function uploadIntermediateImage(url) {
        const imageResponse = await fetch(url);
        if (!imageResponse.ok) throw new Error(`Intermediate image fetch failed with status ${imageResponse.status}`);
        const imageBlob = await imageResponse.blob();
        const formData = new FormData();
        formData.append('files', imageBlob, 'temp_upscale_input.png');
        const uploadResponse = await fetch('/api/upload', { method: 'POST', body: formData });
        if (!uploadResponse.ok) throw new Error(`Intermediate upload failed with status ${uploadResponse.status}`);
        const uploadData = await uploadResponse.json();
        const uploadedInput = uploadData.files?.[0]?.comfy_name;
        if (!uploadedInput) throw new Error('Intermediate upload response did not include a file');
        return uploadedInput;
    }

    function showResult(data) {
        state.currentResult = data;
        elements.outputImg.src = data.images[0];
        elements.outputMedia.hidden = false;
        elements.resultActions.hidden = false;
        elements.emptyState.hidden = true;
        renderImageCard(data, true);
    }

    async function handleGenerate() {
        if (!state.uploadedPath) {
            elements.fileInput.reportValidity();
            elements.fileInput.focus();
            return;
        }

        let debugStep = 'enhance';
        try {
            const shouldUpscale = elements.upscaleToggle.checked;
            setBusy(shouldUpscale ? 'studio.phaseEnhancing' : 'studio.processing');
            const strength = Number.parseFloat(elements.strengthSlider.value);
            let finalData = await requestGeneration(WORKFLOW, {
                '15': { image: state.uploadedPath },
                '204': { value: strength },
            });

            if (shouldUpscale) {
                debugStep = 'intermediate upload';
                setBusy('studio.phaseUploading');
                const uploadedInput = await uploadIntermediateImage(finalData.images[0]);
                debugStep = 'upscale';
                setBusy('studio.phaseUpscaling');
                finalData = await requestGeneration(UPSCALE_WORKFLOW, {
                    '15': { image: uploadedInput },
                    '172': {
                        seed: Math.floor(Math.random() * 4294967295),
                        resolution: state.currentUpscaleFactor,
                    },
                });
            }

            showResult(finalData);
        } catch (error) {
            console.error(`Generation error during ${debugStep}`, error);
            elements.emptyState.hidden = false;
            elements.outputMedia.hidden = true;
            elements.resultActions.hidden = true;
            setGenerationAlert(error.message || String(error));
        } finally {
            clearBusy();
        }
    }

    function downloadUrl(url) {
        if (!url) return;
        const link = document.createElement('a');
        link.href = url;
        link.download = '';
        link.hidden = true;
        document.body.append(link);
        link.click();
        link.remove();
    }

    function updateResolution(image) {
        if (!image.naturalWidth) return;
        elements.lightboxRes.textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
        elements.lightboxRes.hidden = false;
    }

    function updateComparePosition(value) {
        const percent = Math.max(0, Math.min(100, Number(value) || 0));
        elements.compareSlider.valueText = `${Math.round(percent)}%`;
        elements.compareContainer.style.setProperty('--enhance-compare-position', `${percent}%`);
    }

    function openLightbox(data) {
        if (!data?.images?.[0]) return;
        state.activePreviewResult = data;
        const originalName = data.params?.['15']?.image || state.uploadedPath;
        elements.lightboxRes.hidden = true;

        if (originalName) {
            elements.compareContainer.hidden = false;
            elements.lightboxFrame.hidden = true;
            elements.compareGenerated.src = data.images[0];
            elements.compareOriginal.src = `/api/view?filename=${encodeURIComponent(originalName)}&type=input`;
            elements.compareSlider.value = 50;
            elements.compareSlider.setAttribute('value', '50');
            updateComparePosition(50);
            elements.compareGenerated.onload = () => updateResolution(elements.compareGenerated);
            if (elements.compareGenerated.complete) updateResolution(elements.compareGenerated);
        } else {
            elements.compareContainer.hidden = true;
            elements.lightboxFrame.hidden = false;
            elements.lightboxImg.src = data.images[0];
            elements.lightboxImg.onload = () => updateResolution(elements.lightboxImg);
            if (elements.lightboxImg.complete) updateResolution(elements.lightboxImg);
        }
        elements.lightbox.show();
    }

    function renderImageCard(data, isNew = false) {
        if (!data?.images?.[0]) return;
        const timestamp = String(data.timestamp || data.images[0]);
        const cardId = `history-${timestamp.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
        if (document.getElementById(cardId)) return;

        const card = document.createElement('ic-card');
        card.id = cardId;
        card.dataset.historyTs = timestamp;
        card.className = 'archive-item';
        card.setAttribute('label', tr('studio.remasterArchive'));
        card.setAttribute('size', 'small');

        const media = document.createElement('ic-media-container');
        media.setAttribute('label', tr('studio.remasterArchive'));
        media.setAttribute('kind', 'image');
        media.setAttribute('fit', 'cover');
        media.setAttribute('aspect', 'landscape');
        media.setAttribute('state', 'ready');

        const action = document.createElement('ic-button');
        action.type = 'button';
        action.hierarchy = 'quiet';
        action.setAttribute('aria-label', tr('studio.remasterArchive'));

        const image = document.createElement('img');
        image.src = data.images[0];
        image.alt = tr('studio.remasterArchive');
        image.loading = 'lazy';

        const icon = document.createElement('ic-icon');
        icon.slot = 'start';
        icon.name = 'preview';
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.textContent = tr('studio.remasterArchive');
        media.append(image);
        action.append(icon, label);
        action.addEventListener('click', () => {
            if (!document.body.classList.contains('history-bulk-selecting')) openLightbox(data);
        });
        card.append(media, action);
        if (isNew) elements.masonry.prepend(card);
        else elements.masonry.append(card);
    }

    async function loadHistory() {
        try {
            const response = await fetch('/api/history?type=enhance');
            if (!response.ok) throw new Error(`History request failed with status ${response.status}`);
            const history = await response.json();
            history.forEach(item => renderImageCard(item));
        } catch (error) {
            console.error('Unable to load enhance history', error);
        }
    }

    function confirmHistoryDelete(count, message) {
        const dialog = elements.historyDeleteDialog;
        dialog.label = tr('bulk.deleteSelected');
        dialog.description = message;
        dialog.confirmLabel = tr('bulk.deleteSelected');
        dialog.cancelLabel = tr('common.cancel');
        return new Promise(resolve => {
            let settled = false;
            const finish = async accepted => {
                if (settled) return;
                settled = true;
                await dialog.hide(accepted ? 'confirm' : 'cancel');
                resolve(accepted);
            };
            dialog.addEventListener('ic-confirm', () => finish(true), { once: true });
            dialog.addEventListener('ic-cancel', () => finish(false), { once: true });
            dialog.addEventListener('ic-hide', event => {
                if (event.detail?.reason !== 'confirm') finish(false);
            }, { once: true });
            dialog.show();
        });
    }

    function notify(message, tone) {
        customElements.get('ic-toast')?.notify(message, { tone });
    }

    function bindEvents() {
        elements.fileInput.addEventListener('ic-change', handleFileChange);
        elements.sourcePreview.addEventListener('ic-preview', openSourcePreview);
        elements.sourcePreview.addEventListener('ic-remove', resetSource);
        elements.sourcePreview.addEventListener('ic-upload-request', () => elements.fileInput.open());
        elements.strengthSlider.addEventListener('input', () => {
            const value = Number.parseFloat(elements.strengthSlider.value).toFixed(2);
            elements.strengthSlider.valueText = value;
            elements.strengthSlider.setAttribute('value-text', value);
        });
        elements.upscaleToggle.addEventListener('change', toggleUpscaleOptions);
        elements.btn2x.addEventListener('click', () => setUpscaleFactor(2048));
        elements.btn4x.addEventListener('click', () => setUpscaleFactor(4096));
        elements.genBtn.addEventListener('click', handleGenerate);
        elements.outputImg.addEventListener('click', () => openLightbox(state.currentResult));
        elements.previewBtn.addEventListener('click', () => openLightbox(state.currentResult));
        elements.downloadBtn.addEventListener('click', () => downloadUrl(state.currentResult?.images?.[0]));
        elements.saveMasterBtn.addEventListener('click', () => downloadUrl(state.activePreviewResult?.images?.[0]));
        elements.compareSlider.addEventListener('input', () => updateComparePosition(elements.compareSlider.value));
        window.addEventListener('message', event => {
            if (event.data?.type === 'studio-lang') applyLanguage(event.data.lang);
        });
        window.addEventListener('studio-lang-change', () => applyLanguage());
        window.addEventListener('beforeunload', releasePreviewUrl);
    }

    async function init() {
        await customElements.whenDefined('ic-file-input');
        cacheElements();
        bindEvents();
        setUpscaleFactor(2048);
        applyLanguage();
        await loadHistory();
        window.HistoryBulkManager?.attach({
            masonry: '#masonry',
            confirmDelete: confirmHistoryDelete,
            notify,
        });
    }

    window.addEventListener('DOMContentLoaded', init, { once: true });
})();
