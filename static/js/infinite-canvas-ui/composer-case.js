const root = document.documentElement;
const composer = document.getElementById('composer');
const backdrop = document.getElementById('composerFocusBackdrop');
const focusToggle = document.getElementById('composerFocusToggle');
const kindToggle = document.getElementById('apiKindToggle');
const kindLabel = document.getElementById('apiKindLabel');
const dynamicParams = document.getElementById('dynamicParams');
const thumbsRow = document.getElementById('inputThumbsRow');
const promptInput = document.getElementById('promptInput');
const promptCharacterCount = document.getElementById('promptCharacterCount');
const templateButton = document.getElementById('composerTemplateBtn');
const runButton = document.getElementById('runBtn');
const status = document.querySelector('[data-composer-library-live-status]');
const visibilityToggle = document.querySelector('[data-composer-visibility-toggle]');
const referenceToggle = document.querySelector('[data-composer-reference-toggle]');
const longPromptToggle = document.querySelector('[data-composer-long-prompt-toggle]');
const themeToggle = document.querySelector('[data-composer-theme-toggle]');

let kind = 'image';
let referencesVisible = false;
let running = false;
let focusTransitionFrame = 0;
let focusTransitionTimer = 0;
const promptCharacterSegmenter = new Intl.Segmenter(undefined, {granularity: 'grapheme'});

function syncPromptCharacterCount() {
  const text = String(promptInput.value ?? promptInput.textContent ?? '').replace(/\r/g, '');
  let count = 0;
  for (const _segment of promptCharacterSegmenter.segment(text)) count += 1;
  promptCharacterCount.dataset.characterCount = String(count);
  promptCharacterCount.textContent = `${count} 字符`;
}

const imageParams = () => `
  <ic-select class="catalog-model-select" name="image-model" aria-label="图片模型" hierarchy="quiet" placement="top" value="gpt-image-2" data-component-variant="model-picker" data-legal-combination="model-picker-vertical-manual-label">
    <option value="gpt-image-2" data-start-icon="image-generate">GPT Image 2</option>
    <option value="seedream-4" data-start-icon="sparkles">Seedream 4.0</option>
    <ic-icon name="image-generate" size="small" slot="start" aria-hidden="true"></ic-icon>
    <ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
  </ic-select>
  <ic-generation-settings-picker
    class="generation-settings-picker"
    label="尺寸选择"
    ratio="source"
    ratio-presets="source,square,portrait,landscape"
    resolution="1080p"
    resolutions="1080p,2k,4k"
    quality="auto"
    ratio-label="比例"
    resolution-label="分辨率"
    quality-label="质量"
    source-label="原图"
    quality-auto-label="自动"
    quality-low-label="低"
    quality-medium-label="中"
    quality-high-label="高"
    data-smart-generation-settings
  ></ic-generation-settings-picker>
  <ic-select class="generation-count-select" name="generation-count" aria-label="生成数量" hierarchy="quiet" size="small" placement="top" value="1" data-component-variant="generation-count">
    <option value="1">1 张</option>
    <option value="2">2 张</option>
    <option value="4">4 张</option>
    <ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
  </ic-select>
  <ic-switch class="generation-setting-switch" name="transparent-png" label="透明 PNG" size="s"></ic-switch>`;

const videoParams = () => `
  <ic-select class="catalog-model-select" name="video-model" aria-label="视频模型" hierarchy="quiet" placement="top" value="seedance-2" data-component-variant="model-picker" data-legal-combination="model-picker-vertical-manual-label">
    <option value="seedance-2" data-start-icon="video-generate">Seedance 2.0</option>
    <option value="sora-2" data-start-icon="sparkles">Sora 2</option>
    <ic-icon name="video-generate" size="small" slot="start" aria-hidden="true"></ic-icon>
    <ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
  </ic-select>
  <ic-generation-settings-picker
    class="generation-settings-picker video-generation-settings-picker"
    label="尺寸选择"
    ratio="16:9"
    ratio-presets="16:9,9:16,1:1,4:3,3:4,21:9"
    resolution="1080p"
    resolutions="480p,720p,1080p"
    ratio-label="视频比例"
    resolution-label="视频分辨率"
    duration="15"
    duration-min="1"
    duration-max="60"
    duration-step="1"
    duration-label="视频时长"
    data-smart-generation-settings
    data-smart-generation-mode="video"
    hide-quality
  ></ic-generation-settings-picker>
  <ic-switch class="generation-setting-switch" name="video-prompt-enhance" label="提示词增强" size="s"></ic-switch>
  <ic-switch class="generation-setting-switch" name="video-high-definition" label="高清" size="s"></ic-switch>
  <ic-switch class="generation-setting-switch" name="video-generate-audio" label="生成音频" size="s" checked></ic-switch>
  <ic-switch class="generation-setting-switch" name="video-camera-fixed" label="镜头固定" size="s"></ic-switch>
  <ic-switch class="generation-setting-switch" name="video-watermark" label="水印" size="s"></ic-switch>`;

function setStatus(message) {
  if (status) status.textContent = message;
}

function renderParams() {
  const video = kind === 'video';
  dynamicParams.classList.toggle('video-flow', video);
  dynamicParams.innerHTML = video ? videoParams() : imageParams();
  composer.dataset.generationKind = kind;
  kindToggle.value = kind;
  kindLabel.textContent = video ? '视频生成' : '图片生成';
  document.getElementById('apiKindIcon')?.setAttribute('name', video ? 'video-generate' : 'image-generate');
  kindToggle.setAttribute('aria-label', video ? '切换为图片生成' : '切换为视频生成');
  setStatus(video ? '视频生成 · 参数按一列流式换行' : '图片生成 · 默认状态');
}

function renderReferences() {
  thumbsRow.classList.toggle('has-items', referencesVisible);
  thumbsRow.innerHTML = referencesVisible ? `
    <div class="input-thumb-list" aria-label="参考素材">
      <ic-reference-thumbnail data-component-name="ic-reference-thumbnail-image" kind="image" label="参考图" src="/static/images/brand/logo.png" preview-src="/static/images/brand/logo.png" original-src="/static/images/brand/logo.png" alt="Reroll 标志参考图" removable remove-label="移除参考图"></ic-reference-thumbnail>
      <ic-reference-thumbnail class="input-text-reference" data-component-name="ic-reference-thumbnail-text" kind="text" label="输入文本" preview-text="纸艺鲸鱼的材质与光线参考" aria-label="输入文本：纸艺鲸鱼的材质与光线参考" removable remove-label="移除文本引用"></ic-reference-thumbnail>
    </div>` : '';
  referenceToggle?.setAttribute('aria-pressed', String(referencesVisible));
}

thumbsRow?.addEventListener('ic-remove', event => {
  event.preventDefault();
  event.target.remove();
  const remaining = thumbsRow.querySelectorAll('ic-reference-thumbnail').length;
  if (!remaining) {
    referencesVisible = false;
    thumbsRow.classList.remove('has-items');
    referenceToggle?.setAttribute('aria-pressed', 'false');
  }
  setStatus(remaining ? `已移除引用 · 剩余 ${remaining} 项` : '引用已清空');
});

thumbsRow?.addEventListener('ic-activate', event => {
  setStatus(`已激活参考素材 · ${event.target.getAttribute('label') || ''}`);
});

function finishFocusTransition() {
  if (focusTransitionFrame) cancelAnimationFrame(focusTransitionFrame);
  if (focusTransitionTimer) clearTimeout(focusTransitionTimer);
  focusTransitionFrame = 0;
  focusTransitionTimer = 0;
  composer.classList.remove('focus-transition-active', 'focus-transitioning');
  for (const property of [
    '--composer-focus-dx',
    '--composer-focus-dy',
    '--composer-focus-scale-x',
    '--composer-focus-scale-y',
  ]) composer.style.removeProperty(property);
}

function animateFocusTransition(fromRect) {
  const toRect = composer.getBoundingClientRect();
  if (!fromRect?.width || !fromRect?.height || !toRect.width || !toRect.height) return;
  composer.style.setProperty('--composer-focus-dx', `${fromRect.left - toRect.left}px`);
  composer.style.setProperty('--composer-focus-dy', `${fromRect.top - toRect.top}px`);
  composer.style.setProperty('--composer-focus-scale-x', String(fromRect.width / toRect.width));
  composer.style.setProperty('--composer-focus-scale-y', String(fromRect.height / toRect.height));
  composer.classList.add('focus-transitioning');
  void composer.getBoundingClientRect();
  focusTransitionFrame = requestAnimationFrame(() => {
    focusTransitionFrame = 0;
    composer.classList.add('focus-transition-active');
    focusTransitionTimer = window.setTimeout(finishFocusTransition, 240);
  });
}

function setFocused(active) {
  const nextActive = Boolean(active && composer.classList.contains('open'));
  const changed = nextActive !== composer.classList.contains('focused');
  finishFocusTransition();
  const fromRect = changed && !matchMedia('(prefers-reduced-motion: reduce)').matches
    ? composer.getBoundingClientRect()
    : null;
  composer.classList.toggle('focused', nextActive);
  backdrop.classList.toggle('open', nextActive);
  backdrop.setAttribute('aria-hidden', String(!nextActive));
  focusToggle.setAttribute('aria-expanded', String(nextActive));
  focusToggle.setAttribute('icon', nextActive ? 'collapse-editor' : 'focus-editor');
  focusToggle.setAttribute('label', nextActive ? '收起' : '展开');
  if (fromRect) animateFocusTransition(fromRect);
  setStatus(nextActive ? '展开编辑状态' : `${kind === 'video' ? '视频' : '图片'}生成 · 默认状态`);
}

function setComposerVisible(active) {
  if (!active) setFocused(false);
  composer.classList.toggle('open', active);
  visibilityToggle?.setAttribute('aria-pressed', String(active));
  if (visibilityToggle) visibilityToggle.textContent = active ? '隐藏 Composer' : '显示 Composer';
  setStatus(active ? `${kind === 'video' ? '视频' : '图片'}生成 · Composer 已显示` : 'Composer 已隐藏');
}

kindToggle.addEventListener('click', () => {
  kind = kind === 'image' ? 'video' : 'image';
  renderParams();
});

referenceToggle?.addEventListener('click', () => {
  referencesVisible = !referencesVisible;
  renderReferences();
});

visibilityToggle?.addEventListener('click', () => {
  setComposerVisible(!composer.classList.contains('open'));
});

longPromptToggle?.addEventListener('click', () => {
  const active = longPromptToggle.getAttribute('aria-pressed') !== 'true';
  longPromptToggle.setAttribute('aria-pressed', String(active));
  promptInput.value = active
    ? '一只纸艺鲸鱼穿过云层，镜头从低角度缓慢推近。柔和晨光穿过半透明纸张，在鲸鱼表面形成细腻的纤维纹理；远处云海随风移动，整体保持克制的蓝白色调。画面具有电影感景深，主体动作自然，避免文字、标识和突兀的镜头抖动。'
    : '一只纸艺鲸鱼穿过云层，柔和晨光，细腻的材质细节';
  syncPromptCharacterCount();
});

promptInput.addEventListener('input', syncPromptCharacterCount);

themeToggle?.addEventListener('click', () => {
  const active = themeToggle.getAttribute('aria-pressed') !== 'true';
  themeToggle.setAttribute('aria-pressed', String(active));
  root.classList.toggle('theme-dark', active);
  document.body.classList.toggle('theme-dark', active);
  themeToggle.textContent = active ? '浅色主题' : '深色主题';
});

focusToggle.addEventListener('click', () => setFocused(!composer.classList.contains('focused')));
backdrop.addEventListener('click', () => setFocused(false));

templateButton.addEventListener('click', () => {
  const active = !templateButton.classList.contains('active');
  templateButton.classList.toggle('active', active);
  templateButton.setAttribute('aria-expanded', String(active));
  setStatus(active ? '提示词模板入口 · 已选中' : '提示词模板入口 · 未选中');
});

runButton.addEventListener('click', () => {
  if (running) return;
  running = true;
  runButton.setAttribute('disabled', '');
  setStatus(`模拟提交 · ${kind === 'video' ? '视频生成' : '图片生成'}`);
  window.setTimeout(() => {
    running = false;
    runButton.removeAttribute('disabled');
    setStatus('提交交互已完成（组件库不发起生成请求）');
  }, 700);
});

renderParams();
renderReferences();
syncPromptCharacterCount();
root.dataset.composerLibraryStatus = 'ready';
