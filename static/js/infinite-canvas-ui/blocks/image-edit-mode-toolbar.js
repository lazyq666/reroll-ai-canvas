import { IcFloatingToolbar } from '../navigation-command/floating-toolbar.js';

const MODES = Object.freeze([
  ['preview', 'preview', 'smart.modePreview', '预览'],
  ['crop', 'frame', 'canvas.modeCrop', '裁剪'],
  ['mask', 'brush', 'canvas.modeMask', '遮罩'],
  ['brush', 'color', 'canvas.modeBrush', '画笔'],
  ['resize', 'collapse-editor', 'canvas.modeResize', '缩放'],
  ['grid', 'layout-grid', 'smart.modeGridStudio', '宫格'],
]);

function modeMarkup() {
  return MODES.map(([value, icon, i18n, label]) => `
    <button type="button" data-value="${value}" data-image-edit-mode="${value}">
      <ic-icon name="${icon}" size="small" aria-hidden="true"></ic-icon><span data-i18n="${i18n}">${label}</span>
    </button>`).join('');
}

export class IcImageEditModeToolbar extends IcFloatingToolbar {
  connectedCallback() {
    this.classList.add('image-edit-mode-toolbar');
    if (!this.hasAttribute('label')) this.setAttribute('label', '图片编辑模式栏');
    if (!this.hasAttribute('overflow')) this.setAttribute('overflow', 'scroll');
    if (!this.querySelector('#imageEditModeTabs')) {
      this.innerHTML = `
        <ic-tabs id="imageEditModeTabs" class="image-edit-mode" label="图片编辑模式" value="preview" orientation="horizontal" activation="automatic" data-legal-combination="horizontal-automatic-label">
          ${modeMarkup()}
        </ic-tabs>
        <ic-button id="depthMapActionBtn" type="button" hierarchy="quiet" title="生成深度图">
          <ic-icon name="depth-map" size="small" slot="start" aria-hidden="true"></ic-icon><span>深度图</span>
        </ic-button>
        <ic-button id="panoramaToggleBtn" type="button" size="small" hierarchy="quiet" toggle style="display:none">
          <ic-icon name="canvas" size="small" slot="start" aria-hidden="true"></ic-icon><span data-i18n="smart.panorama360">360全景</span>
        </ic-button>`;
    }
    const depthMapAction = this.querySelector('#depthMapActionBtn');
    if (depthMapAction && !depthMapAction.dataset.icDepthMapRequestBound) {
      depthMapAction.dataset.icDepthMapRequestBound = '1';
      depthMapAction.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('ic-depth-map-request', {
          bubbles: true,
          composed: true,
        }));
      });
    }
    const panoramaToggle = this.querySelector('#panoramaToggleBtn');
    if (panoramaToggle && !panoramaToggle.dataset.icPanoramaRequestBound) {
      panoramaToggle.dataset.icPanoramaRequestBound = '1';
      panoramaToggle.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('ic-panorama-toggle-request', {
          bubbles: true,
          composed: true,
        }));
      });
    }
    super.connectedCallback();
  }
}
