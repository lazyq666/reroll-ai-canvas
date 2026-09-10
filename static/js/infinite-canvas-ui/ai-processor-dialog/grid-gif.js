import {analyzeGridGif, gridGifErrorMessage} from '/static/js/smart-canvas/grid-gif.js?v=4';
import {SpriteAuthoring} from './sprite-authoring.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PRESETS = ['1x2','2x1','2x2','2x3','3x2','3x3','4x4'];

export class GridGifControls {
    constructor(dialog) { this.dialog = dialog; this.reset(); }
    reset() {
        this.dispose();
        this.rows = 4; this.cols = 4; this.delay = 100; this.fillColor = '#ffffff'; this.transparent = false;
        this.loaded = false; this.failed = false; this.naturalSize = null;
        this.analysis = null; this.analysisError = null; this.analysisKey = '';
        this.boundaries = null; this.anchors = null; this.editMode = 'boundaries'; this.selectedHandle = ''; this.editing = false;
    }
    dispose() { this.analysisAbort?.abort(); this.analysisAbort = null; this.authoring?.dispose(); this.authoring = null; }
    t(key) { return this.dialog.messages.gif?.[key] || ''; }
    detail() { return {rows:this.rows, cols:this.cols, delay:this.delay, fillColor:this.fillColor, transparent:this.transparent,
        boundaries:this.boundaries?JSON.parse(JSON.stringify(this.boundaries)):null,
        anchors:this.anchors?JSON.parse(JSON.stringify(this.anchors)):null}; }
    reason() {
        if (this.failed) return this.t('imageError');
        if (!this.loaded) return this.t('loading');
        const {width, height} = this.naturalSize || this.dialog.sourceSize();
        if (![this.rows,this.cols].every(n => Number.isInteger(n) && n >= 1 && n <= 12)
            || this.rows * this.cols < 2 || width < this.cols || height < this.rows
            || width * height > 64_000_000 || !/^#[0-9a-f]{6}$/i.test(this.fillColor)) return this.t('invalid');
        if (this.analysisError) return gridGifErrorMessage(this.analysisError, key => this.t(key));
        if (!this.analysis || this.editing) return this.t('recognizing');
        return '';
    }
    markup() {
        const t = key => escape(this.t(key));
        const preset = `${this.rows}x${this.cols}`;
        return `<div data-ai-processor-layout="grid-gif">
          <section data-gif-source-column><div data-gif-stage><canvas data-gif-preview role="img" tabindex="-1" aria-label="${t('preview')}"></canvas></div>
            <p data-gif-hint>${t('order')}</p><span data-gif-status role="status"></span></section>
          <section data-ai-processor-panel>
            <ic-select name="grid-gif-preset" data-gif-preset label="${t('grid')}" value="${PRESETS.includes(preset)?preset:'custom'}">
              ${[...PRESETS,'custom'].map(value=>`<option value="${value}">${value==='custom'?t('custom'):value.replace('x',' × ')}</option>`).join('')}
            </ic-select>
            <p data-gif-hint>${t('recognitionHint')}</p>
            <div data-gif-dimensions>
              <ic-number-input name="grid-gif-rows" data-gif-rows label="${t('rows')}" min="1" max="12" step="1" value="${this.rows}" size="small"></ic-number-input>
              <ic-number-input name="grid-gif-cols" data-gif-cols label="${t('cols')}" min="1" max="12" step="1" value="${this.cols}" size="small"></ic-number-input>
            </div>
            <div class="ai-processor-field">
              <span class="ai-processor-option-title">${t('editMode')}</span>
              <ic-segmented-control name="gif-edit-mode" data-gif-edit-mode label="${t('editMode')}" value="${this.editMode}" size="medium" data-legal-combination="single-label">
                <button type="button" data-value="boundaries">${t('boundaries')}</button><button type="button" data-value="anchors">${t('anchors')}</button>
              </ic-segmented-control>
            </div>
            <ic-button data-gif-reset-authoring size="small" hierarchy="quiet">${t('resetAuthoring')}</ic-button>
            <div class="ai-processor-field">
              <span class="ai-processor-option-title">${t('speed')}</span>
              <ic-segmented-control name="grid-gif-speed" data-gif-speed label="${t('speed')}" value="${this.delay}" size="medium" data-legal-combination="single-label">
                ${[500,250,100,70,50].map(delay=>`<button type="button" data-value="${delay}" title="${t(`speed${delay}`)}">${t(`speed${delay}Short`)}</button>`).join('')}
              </ic-segmented-control>
            </div>
            <div class="ai-processor-field">
              <span class="ai-processor-option-title">${t('backgroundMode')}</span>
              <ic-segmented-control name="grid-gif-background" data-gif-background label="${t('backgroundMode')}" value="${this.transparent?'transparent':'solid'}" size="medium" data-legal-combination="single-label">
                <button type="button" data-value="solid">${t('solidBackground')}</button><button type="button" data-value="transparent">${t('transparent')}</button>
              </ic-segmented-control>
            </div>
            <ic-color-field name="grid-gif-color" data-gif-color label="${t('background')}" value="${escape(this.fillColor)}" size="small" ${this.transparent?'hidden':''}></ic-color-field>
            <p data-gif-hint data-gif-background-hint>${t(this.transparent?'transparentHint':'backgroundHint')}</p>
          </section></div>`;
    }
    mount() {
        const root = this.dialog.bodyElement;
        const preview = root.querySelector('[data-gif-preview]');
        if (!preview) return;
        const image = new Image();
        this.loaded = false; this.failed = false;
        const status = () => {
            if (!preview.isConnected) return;
            root.querySelector('[data-gif-status]').textContent = this.reason() || this.t(this.analysis?.boundaryConflicts ? 'boundaryReview' : 'recognized').replace('{count}',this.analysis?.frames ?? 0);
            this.dialog.syncActions();
        };
        const draw = () => {
            if (!image.naturalWidth || !preview.isConnected) return;
            const scale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
            preview.width = Math.round(image.naturalWidth * scale); preview.height = Math.round(image.naturalHeight * scale);
            const ctx = preview.getContext('2d');
            preview.toggleAttribute('data-gif-checkerboard',this.transparent);
            if (!this.transparent) { ctx.fillStyle = this.fillColor; ctx.fillRect(0,0,preview.width,preview.height); }
            ctx.drawImage(image,0,0,preview.width,preview.height);
            this.authoring?.paint(ctx,scale);
        };
        const analysisKey = () => JSON.stringify([this.dialog.sourceImage,this.rows,this.cols,this.boundaries,this.anchors]);
        const recognize = async () => {
            const key = analysisKey();
            if (key === this.analysisKey && (this.analysis || this.analysisError)) { this.authoring?.sync(); draw(); status(); return; }
            this.analysisAbort?.abort();
            this.analysisKey = key; this.analysis = null; this.analysisError = null;
            draw(); status();
            if (!this.loaded || this.rows < 1 || this.cols < 1) return;
            const controller = new AbortController(); this.analysisAbort = controller;
            try {
                const result = await analyzeGridGif({sourceUrl:this.dialog.sourceImage,...this.detail(),signal:controller.signal});
                if (controller.signal.aborted || !preview.isConnected) return;
                this.analysis = result;
                this.boundaries=result.boundaries;this.anchors=result.anchors;this.analysisKey=analysisKey();
            } catch (error) {
                if (controller.signal.aborted || !preview.isConnected) return;
                this.analysisError = error;
            }
            this.authoring?.sync();draw(); status();
        };
        image.onload = () => {
            if (!preview.isConnected) return;
            this.loaded = true; this.naturalSize = {width:image.naturalWidth,height:image.naturalHeight};
            recognize();
        };
        image.onerror = () => { if (!preview.isConnected) return; this.failed = true; status(); };
        image.src = this.dialog.sourceImage;
        this.authoring = new SpriteAuthoring(this,image,preview,draw,recognize,status);
        const transparency = root.querySelector('[data-gif-background]');
        transparency.addEventListener('ic-change', event => {
            if (this.dialog.pending) return;
            this.transparent = event.detail.value === 'transparent';
            root.querySelector('[data-gif-color]').hidden = this.transparent;
            root.querySelector('[data-gif-background-hint]').textContent = this.t(this.transparent?'transparentHint':'backgroundHint');
            draw(); status();
        });
        root.querySelector('[data-gif-speed]').addEventListener('ic-change', event => {
            if (this.dialog.pending) return;
            this.delay = Number(event.detail.value); status();
        });
        const preset = root.querySelector('[data-gif-preset]');
        const rows = root.querySelector('[data-gif-rows]'), cols = root.querySelector('[data-gif-cols]');
        for (const control of [rows,cols]) control.addEventListener('input', () => {
            if (control.value !== '' && Number.isFinite(Number(control.value))) control.value = String(Math.max(1,Math.min(12,Math.round(Number(control.value)))));
        });
        preset.addEventListener('change', () => {
            if (this.dialog.pending) return;
            if (PRESETS.includes(preset.value)) {
                [this.rows,this.cols] = preset.value.split('x').map(Number);
                this.boundaries=null;this.anchors=null;this.selectedHandle='';
                rows.value = this.rows; cols.value = this.cols; recognize();
            } else rows.focus();
        });
        for (const [control,key] of [[rows,'rows'],[cols,'cols'],[root.querySelector('[data-gif-color]'),'fillColor']]) {
            control.addEventListener('change', () => {
                if (this.dialog.pending) return;
                this[key] = key==='fillColor'?control.value:Number(control.value);
                if (key==='rows'||key==='cols') {
                    this.boundaries=null;this.anchors=null;this.selectedHandle='';
                    const value=`${this.rows}x${this.cols}`; preset.value=PRESETS.includes(value)?value:'custom'; recognize();
                } else { draw(); status(); }
            });
        }
        status();
    }
}
