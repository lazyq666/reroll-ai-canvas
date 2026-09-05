import '/static/js/infinite-canvas-ui/core.js?v=ic-ui-a7dd55e61123';

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const viewport = params.get('viewport') === 'narrow' ? 'narrow' : 'desktop';
const locale = params.get('locale') === 'en' ? 'en' : 'zh-CN';
document.documentElement.dataset.uiTheme = theme;
document.documentElement.dataset.uiDensity = params.get('density') || 'medium';
document.documentElement.dataset.uiMotion = params.get('motion') || 'standard';
document.documentElement.classList.toggle('theme-dark', theme === 'dark');
document.documentElement.lang = locale;
document.body.dataset.viewport = viewport;

const zh = locale === 'zh-CN';
const sizes = [
  { value: 's', label: 'S', suffix: 'small' },
  { value: 'm', label: 'M', suffix: '' },
  { value: 'l', label: 'L', suffix: 'large' },
];
const sizedName = (base, size) => `${base}${size.suffix ? `-${size.suffix}` : ''}`;
const sizeArticles = render => sizes.map(size => `
  <article data-ui-library-matrix-label="${size.label}">
    <span data-ui-library-matrix-label>${size.label}</span>
    ${render(size)}
  </article>
`).join('');
const modelOptions = `
  <option value="gpt-image-2" data-start-icon-src="/static/images/providers/chatgpt.svg" data-start-icon-monochrome selected>GPT Image 2</option>
  <option value="seedream-4-5" data-start-icon-src="/static/images/providers/doubao.svg">Seedream 4.5</option>
  <option value="flux-1-1-pro" data-start-icon-src="/static/images/providers/flux.svg" data-start-icon-monochrome>FLUX 1.1 Pro</option>
  <option value="imagen-4" data-start-icon-src="/static/images/providers/gemini.svg" data-start-icon-monochrome>Imagen 4</option>
  <option value="qwen-image" data-start-icon="image">Qwen Image</option>
`;
const selectOptions = '<option value="png" selected>PNG</option><option value="webp">WebP</option><option value="avif">AVIF</option>';
const generationCountOptions = [1, 2, 3, 4].map(value => `<option value="${value}"${value === 1 ? ' selected' : ''}>${zh ? `${value} 张` : value}</option>`).join('');
const root = document.querySelector('[data-selection-adjustment-case-root]');

root.innerHTML = `
  <section class="action-case-section selection-family-section" data-component-family="aspect-ratio-picker">
    <header><div><span class="actions-live-kicker">ic-aspect-ratio-picker</span><h1>${zh ? '画幅选择器' : 'Aspect ratio picker'}</h1></div></header>
    <div class="selection-family-stack">
      <article class="selection-variant-group" data-component-group>
        <h2>${zh ? '单选画幅' : 'Single selection'}</h2>
        <div class="selection-size-grid">
          ${sizeArticles(size => size.value === 'm' ? `
            <form class="aspect-ratio-picker-demo">
              <ic-aspect-ratio-picker name="aspect-ratio-${size.value}" label="${zh ? '画幅' : 'Aspect ratio'}" presets="square,portrait,landscape,wide" value="square" size="${size.value}" data-component-name="${sizedName('ic-aspect-ratio-picker', size)}"></ic-aspect-ratio-picker>
              <p>${zh ? '当前参数' : 'Current parameter'}：<output data-aspect-ratio-value>square</output></p>
            </form>
          ` : `
            <ic-aspect-ratio-picker name="aspect-ratio-${size.value}" label="${zh ? '画幅' : 'Aspect ratio'}" presets="square,portrait,landscape,wide" value="square" size="${size.value}" data-component-name="${sizedName('ic-aspect-ratio-picker', size)}"></ic-aspect-ratio-picker>
          `)}
        </div>
      </article>
      <article class="selection-variant-group" data-component-group>
        <h2>${zh ? '多选画幅' : 'Multiple selection'}</h2>
        <div class="selection-size-grid">
          ${sizeArticles(size => `
            <ic-aspect-ratio-picker name="aspect-ratio-multiple-${size.value}" label="${zh ? '宽高比' : 'Aspect ratios'}" presets="square,portrait,landscape,wide" value="square,portrait" size="${size.value}" multiple hide-label data-component-variant="multiple" data-component-name="${sizedName('ic-aspect-ratio-picker-multiple', size)}" data-copy-kind="组件别名"></ic-aspect-ratio-picker>
          `)}
        </div>
      </article>
    </div>
  </section>

  <section class="action-case-section selection-family-section" data-component-family="model-picker">
    <header><div><span class="actions-live-kicker">ic-select-model</span><h1>${zh ? '模型选择器' : 'Model picker'}</h1></div></header>
    <div class="selection-size-grid">
      ${sizeArticles(size => `
        <ic-select aria-label="${zh ? '图片模型' : 'Image model'}" name="model-picker-${size.value}" hierarchy="quiet" size="${size.value}" placement="bottom" data-component-variant="model-picker" data-legal-combination="model-picker-vertical-manual-label" data-component-name="${sizedName('ic-select-model', size)}" data-copy-kind="组件别名">
          ${modelOptions}<ic-icon name="image" slot="start" aria-hidden="true"></ic-icon><ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
        </ic-select>
      `)}
    </div>
  </section>

  <section class="action-case-section selection-family-section" data-component-family="checkbox">
    <header><div><span class="actions-live-kicker">ic-checkbox</span><h1>Checkbox</h1></div></header>
    <div class="selection-family-stack">
      <article class="selection-variant-group" data-component-group>
        <h2>${zh ? '标准 Checkbox' : 'Standard checkbox'}</h2>
        <div class="selection-size-grid">
          ${sizeArticles(size => `<ic-checkbox label="${zh ? '显示网格' : 'Show grid'}" name="checkbox-${size.value}" size="${size.value}" checked data-component-name="${sizedName('ic-checkbox', size)}"></ic-checkbox>`)}
        </div>
      </article>
      <article class="selection-variant-group" data-component-group>
        <h2>${zh ? '列表 Checkbox' : 'List checkbox'}</h2>
        <div class="selection-size-grid">
          ${sizeArticles(size => `<ic-checkbox label="GPT Image 2" name="model-option-${size.value}" size="${size.value}" appearance="checkmark-end" icon="image" tag="${zh ? '推荐' : 'Recommended'}" checked data-legal-combination="checkmark-end-label" data-component-variant="list" data-component-name="${sizedName('ic-checkbox-list', size)}" data-copy-kind="组件别名"></ic-checkbox>`)}
        </div>
      </article>
    </div>
  </section>

  <section class="action-case-section selection-family-section" data-component-family="radio">
    <header><div><span class="actions-live-kicker">ic-radio-group · ic-radio</span><h1>Radio</h1></div></header>
    <div class="selection-family-stack">
      <article class="selection-variant-group" data-component-group>
        <h2>${zh ? '标准 Radio Group' : 'Standard radio group'}</h2>
        <div class="selection-size-grid">
          ${sizeArticles(size => `
            <ic-radio-group label="${zh ? '画布适配方式' : 'Canvas fit mode'}" name="radio-${size.value}" value="contain" size="${size.value}" data-component-name="${sizedName('ic-radio-group', size)}">
              <ic-radio label="Contain" value="contain"></ic-radio><ic-radio label="Cover" value="cover"></ic-radio>
            </ic-radio-group>
          `)}
        </div>
      </article>
      <article class="selection-variant-group" data-component-group>
        <h2>${zh ? '标签式 Radio Group' : 'Tab radio group'}</h2>
        <div class="selection-size-grid">
          ${sizeArticles(size => `
            <ic-radio-group label="${zh ? '画布适配方式' : 'Canvas fit mode'}" name="radio-tabs-${size.value}" value="contain" size="${size.value}" appearance="tabs" orientation="horizontal" data-legal-combination="horizontal-tab-label" data-component-name="${sizedName('ic-radio-group-tabs', size)}">
              <ic-radio label="Contain" value="contain"></ic-radio><ic-radio label="Cover" value="cover"></ic-radio>
            </ic-radio-group>
          `)}
        </div>
      </article>
    </div>
  </section>

  <section class="action-case-section selection-family-section" data-component-family="number-input">
    <header><div><span class="actions-live-kicker">ic-number-input</span><h1>Number Input</h1></div></header>
    <div class="selection-size-grid">
      ${sizeArticles(size => `<ic-number-input label="${zh ? '网格列数' : 'Grid columns'}" name="number-${size.value}" size="${size.value}" min="1" max="12" step="1" value="4" data-component-name="${sizedName('ic-number-input', size)}"></ic-number-input>`)}
    </div>
  </section>

  <section class="action-case-section selection-family-section" data-component-family="switch">
    <header><div><span class="actions-live-kicker">ic-switch</span><h1>Switch</h1></div></header>
    <div class="selection-size-grid">
      ${sizeArticles(size => `<ic-switch label="${zh ? '自动保存' : 'Autosave'}" name="switch-${size.value}" size="${size.value}" checked data-component-name="${sizedName('ic-switch', size)}"></ic-switch>`)}
    </div>
  </section>

  <section class="action-case-section selection-family-section" data-component-family="select">
    <header><div><span class="actions-live-kicker">ic-select</span><h1>${zh ? '通用选择器' : 'Select'}</h1></div></header>
    <div class="selection-family-stack">
      <article class="selection-variant-group" data-component-group>
        <h2>${zh ? '标准 Select' : 'Standard Select'}</h2>
        <div class="selection-size-grid">
          ${sizeArticles(size => `<ic-select label="${zh ? '导出格式' : 'Export format'}" name="select-${size.value}" size="${size.value}" data-component-name="${sizedName('ic-select', size)}">${selectOptions}</ic-select>`)}
        </div>
      </article>
      <article class="selection-variant-group" data-component-group>
        <h2>${zh ? '次级 Select' : 'Secondary Select'}</h2>
        <div class="selection-size-grid">
          ${sizeArticles(size => `<ic-select label="${zh ? '导出格式' : 'Export format'}" name="select-secondary-${size.value}" size="${size.value}" data-component-variant="secondary" data-component-name="${sizedName('ic-select-secondary', size)}" data-copy-kind="组件别名">${selectOptions}</ic-select>`)}
        </div>
      </article>
    </div>
  </section>

  <section class="action-case-section selection-family-section" data-component-family="slider">
    <header><div><span class="actions-live-kicker">ic-slider</span><h1>${zh ? '滑块' : 'Slider'}</h1></div></header>
    <div class="selection-size-grid">
      ${sizeArticles(size => `<ic-slider label="${zh ? '图层不透明度' : 'Layer opacity'}" name="slider-${size.value}" size="${size.value}" min="0" max="100" step="1" value="64" value-text="64 percent" data-component-name="${sizedName('ic-slider', size)}"></ic-slider>`)}
    </div>
  </section>

  <section class="action-case-section selection-family-section" data-component-family="color-field">
    <header><div><span class="actions-live-kicker">ic-color-field</span><h1>${zh ? '颜色选择器' : 'Color field'}</h1></div></header>
    <div class="selection-size-grid">
      ${sizeArticles(size => `<ic-color-field label="${zh ? '辅助线颜色' : 'Guide color'}" name="color-${size.value}" size="${size.value}" value="#2563eb" data-component-name="${sizedName('ic-color-field', size)}"></ic-color-field>`)}
    </div>
  </section>

  <section class="action-case-section selection-family-section" data-component-family="composite-picker">
    <header><div><span class="actions-live-kicker">Composite picker</span><h1>${zh ? '复合选择器' : 'Composite pickers'}</h1></div></header>
    <div class="selection-family-stack">
      <article class="selection-variant-group" data-component-group>
        <h2>${zh ? '画质与画幅' : 'Quality and aspect'}</h2>
        <ic-generation-settings-picker label="${zh ? '画质画幅' : 'Quality and aspect'}" ratio="source" ratio-presets="source,square,portrait,landscape" resolution="4k" resolutions="1k,2k,4k" quality="auto" source-ratio="1:1" data-component-name="ic-generation-settings-picker" data-copy-kind="组件别名"></ic-generation-settings-picker>
      </article>
      <article class="selection-variant-group" data-component-group>
        <h2>${zh ? '生成数量' : 'Generation count'}</h2>
        <div class="selection-size-grid">
          ${sizeArticles(size => `<ic-select aria-label="${zh ? '生成数量' : 'Generation count'}" name="generation-count-${size.value}" hierarchy="quiet" size="${size.value}" placement="bottom" data-component-variant="generation-count" data-component-name="${sizedName('ic-select-count', size)}" data-copy-kind="组件别名">${generationCountOptions}</ic-select>`)}
        </div>
      </article>
    </div>
  </section>
`;

const aspectRatioPicker = root.querySelector('.aspect-ratio-picker-demo ic-aspect-ratio-picker');
const aspectRatioOutput = root.querySelector('[data-aspect-ratio-value]');
aspectRatioPicker?.addEventListener('input', () => {
  aspectRatioOutput.value = aspectRatioPicker.value;
});

const contractTags = [
  'ic-checkbox', 'ic-radio-group', 'ic-radio', 'ic-switch', 'ic-select',
  'ic-slider', 'ic-number-input', 'ic-color-field', 'ic-aspect-ratio-picker',
  'ic-generation-settings-picker',
];
await Promise.all(contractTags.map(tag => customElements.whenDefined(tag)));
await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

const contractControls = [...root.querySelectorAll(
  'ic-checkbox, ic-radio-group, ic-radio, ic-switch, ic-select, ic-slider, ic-number-input, ic-color-field',
)];
const ready = contractControls.every(control => control.dataset.icContractStatus === 'ready');
root.dataset.legalCombinationCount = String(root.querySelectorAll('.selection-size-grid > article').length);
root.dataset.componentFamilyCount = String(root.querySelectorAll('[data-component-family]').length);
document.querySelector('[data-case-status]').textContent = ready
  ? (zh ? '选择与调节分类及尺寸已就绪' : 'Selection categories and sizes are ready')
  : (zh ? '选择与调节合同失败' : 'Selection contract failed');
document.documentElement.dataset.selectionAdjustmentCaseStatus = ready ? 'ready' : 'failed';
await import('./component-name-tag.js');
