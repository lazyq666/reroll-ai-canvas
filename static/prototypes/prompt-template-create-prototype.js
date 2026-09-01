const variants = {
  A: { name: '紧凑工作台', description: '元信息收进左侧窄栏，把主要空间完整留给提示词。' },
  B: { name: '沉浸文稿', description: '像写文档一样专注内容，封面降级为一条可选附件。' },
  C: { name: '视觉画布', description: '' },
};

const draft = { name: '电影感产品特写', category: '产品', prompt: '近距离产品特写，电影感侧光，材质细节清晰，背景保持克制的空间层次。', hasCover: false };
const host = document.querySelector('#variantHost');
const label = document.querySelector('[data-variant-label]');
const description = document.querySelector('[data-variant-description]');
const stateSummary = document.querySelector('[data-state-summary]');
const status = document.querySelector('[data-draft-status]');
const toast = document.querySelector('.prototype-toast');

function fieldName(showRequired = true) {
  return `<label class="field"><span class="field-label">模板名称 ${showRequired ? '<small>必填</small>' : ''}</span><input class="text-input" data-field="name" value="${draft.name}" autocomplete="off"></label>`;
}

function fieldCategory() {
  return `<label class="field"><span class="field-label">所属分组</span><select class="select-input" data-field="category"><option>视角</option><option>光影</option><option selected>产品</option></select></label>`;
}

function fieldPrompt(extraClass = '', showRequired = true) {
  return `<label class="field ${extraClass}"><span class="field-label">提示词内容 <small>${showRequired ? '必填 · ' : ''}<span data-count>${draft.prompt.length}</span> / 4000</small></span><textarea class="prompt-area" data-field="prompt">${draft.prompt}</textarea></label>`;
}

function coverPreview(className = '') {
  return `<div class="cover-preview ${className} ${draft.hasCover ? 'has-cover' : ''}" data-cover-surface><div class="cover-empty"><ic-icon name="image"></ic-icon><small>未设置封面时使用默认模板样式</small></div></div>`;
}

function coverTools() {
  return `<div class="cover-tools"><button type="button" data-cover-add>${draft.hasCover ? '更换图片' : '选择图片'}</button><button type="button" data-cover-remove ${draft.hasCover ? '' : 'hidden'}>移除</button></div>`;
}

function renderA() {
  return `<div class="variant-a">
    <aside class="meta-rail">
      <div class="section-kicker">模板信息</div>
      ${fieldName()}${fieldCategory()}
      <div class="cover-block field"><span class="field-label">封面图 <small>可选</small></span>${coverPreview()}${coverTools()}<span class="cover-caption">封面只影响模板卡片外观，不影响生成内容。</span></div>
    </aside>
    <section class="writing-pane"><header class="writing-header"><div><h2>写下可复用的提示词</h2><p>保持聚焦；名称、分组和封面都留在辅助区域。</p></div><span class="char-count"><span data-count>${draft.prompt.length}</span> / 4000</span></header>${fieldPrompt()}</section>
  </div>`;
}

function renderB() {
  return `<div class="variant-b"><div class="document-sheet">
    <div class="section-kicker">新提示词</div>
    <div class="document-meta"><label class="field"><span class="field-label">模板名称 <small>必填</small></span><input class="text-input" data-field="name" value="${draft.name}" autocomplete="off"></label>${fieldCategory()}</div>
    <div class="prompt-shell">${fieldPrompt()}<div class="prompt-foot"><span>支持粘贴长提示词</span><span><span data-count>${draft.prompt.length}</span> / 4000</span></div></div>
    <div class="accessory-row"><div class="cover-mini ${draft.hasCover ? 'has-cover' : ''}"><ic-icon name="image"></ic-icon></div><div class="accessory-copy"><strong>${draft.hasCover ? '已添加封面图' : '添加封面图'}</strong><span>可选；用于在模板库中快速识别</span></div>${coverTools()}</div>
  </div></div>`;
}

function renderC() {
  return `<div class="variant-c">
    <section class="visual-panel ${draft.hasCover ? 'has-cover' : ''}" data-cover-surface>
      <div class="visual-grid"></div>
      <div class="visual-prompt-preview" ${draft.hasCover ? 'hidden' : ''}>
        <span class="visual-quote" aria-hidden="true">“</span>
        <p data-live-prompt>${draft.prompt || '在右侧输入提示词'}</p>
      </div>
      <div class="visual-footer"><strong data-live-name>${draft.name || '未命名提示词'}</strong>${coverTools()}</div>
    </section>
    <section class="form-card"><div class="inline-fields">${fieldName(false)}${fieldCategory()}</div>${fieldPrompt('', false)}</section>
  </div>`;
}

function currentKey() {
  const key = new URL(location.href).searchParams.get('variant')?.toUpperCase();
  return variants[key] ? key : 'A';
}

function saveDraftFromDom() {
  const name = host.querySelector('[data-field="name"]');
  const category = host.querySelector('[data-field="category"]');
  const prompt = host.querySelector('[data-field="prompt"]');
  if (name) draft.name = name.value;
  if (category) draft.category = category.value;
  if (prompt) draft.prompt = prompt.value;
}

function updateState() {
  host.querySelectorAll('[data-count]').forEach(node => { node.textContent = draft.prompt.length; });
  host.querySelectorAll('[data-live-prompt]').forEach(node => { node.textContent = draft.prompt || '在右侧输入提示词'; });
  host.querySelectorAll('[data-live-name]').forEach(node => { node.textContent = draft.name || '未命名提示词'; });
  stateSummary.textContent = `${draft.name || '未命名'} · ${draft.prompt.length} 字 · ${draft.hasCover ? '有封面' : '无封面'}`;
  status.textContent = draft.name || draft.prompt ? '草稿已在当前页面更新' : '草稿仅保存在当前页面';
}

function render() {
  const key = currentKey();
  document.body.dataset.variant = key.toLowerCase();
  label.textContent = `${key} · ${variants[key].name}`;
  description.textContent = variants[key].description;
  host.innerHTML = key === 'A' ? renderA() : key === 'B' ? renderB() : renderC();
  updateState();
}

function switchVariant(direction) {
  saveDraftFromDom();
  const keys = Object.keys(variants);
  const next = (keys.indexOf(currentKey()) + direction + keys.length) % keys.length;
  const url = new URL(location.href);
  url.searchParams.set('variant', keys[next]);
  history.replaceState({}, '', url);
  render();
}

host.addEventListener('input', event => {
  if (event.target.dataset.field === 'name') draft.name = event.target.value;
  if (event.target.dataset.field === 'prompt') draft.prompt = event.target.value;
  updateState();
});
host.addEventListener('change', event => { if (event.target.dataset.field === 'category') draft.category = event.target.value; updateState(); });
host.addEventListener('click', event => {
  const add = event.target.closest('[data-cover-add]');
  const remove = event.target.closest('[data-cover-remove]');
  if (!add && !remove) return;
  saveDraftFromDom();
  draft.hasCover = Boolean(add);
  render();
});

document.querySelector('[data-previous]').addEventListener('click', () => switchVariant(-1));
document.querySelector('[data-next]').addEventListener('click', () => switchVariant(1));
document.querySelector('[data-theme]').addEventListener('click', () => document.documentElement.classList.toggle('theme-dark'));
document.querySelectorAll('[data-cancel],.icon-close').forEach(button => button.addEventListener('click', () => showToast('原型：已模拟关闭，不会丢失当前比较状态')));
document.querySelector('#prototypeForm').addEventListener('submit', event => { event.preventDefault(); saveDraftFromDom(); showToast(draft.name.trim() && draft.prompt.trim() ? '原型：提示词已创建（未写入真实数据）' : '请填写模板名称和提示词内容'); });
window.addEventListener('keydown', event => {
  if (event.target.matches('input,textarea,select,[contenteditable]')) return;
  if (event.key === 'ArrowLeft') switchVariant(-1);
  if (event.key === 'ArrowRight') switchVariant(1);
});
window.addEventListener('popstate', render);

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
}

render();
