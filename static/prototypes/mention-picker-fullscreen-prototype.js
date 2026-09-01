const editor = document.querySelector('#promptInput');
const picker = document.querySelector('#mentionPicker');
const variantLabel = document.querySelector('#variantLabel');
const variantNote = document.querySelector('#variantNote');

const variants = {
  A:{name:'顶部内嵌浮层', note:'从 Composer 顶部向下展开'},
  B:{name:'底部内嵌浮层', note:'从操作栏上方向上展开'},
  C:{name:'居中命令面板', note:'覆盖编辑区中央，聚焦选择'},
};
const mentionItems = [
  {name:'香水瓶正面', detail:'画布输入 · PNG', meta:'1024 × 1024', media:'', className:'media-a'},
  {name:'岩石材质参考', detail:'当前节点 · JPG', meta:'1536 × 1024', media:'', className:'media-b'},
  {name:'暖色轮廓光', detail:'资产库 / 光影', meta:'1920 × 1080', media:'', className:'media-c'},
  {name:'品牌视觉规范', detail:'文本引用 · MD', meta:'2.4 KB', media:'T', className:''},
];
const promptItems = [
  {name:'电影感产品特写', detail:'近距离特写，浅景深，精确轮廓', meta:'产品', media:'/', className:''},
  {name:'冷暖双色轮廓光', detail:'冷色主光与暖色边缘光形成层次', meta:'光影', media:'/', className:''},
  {name:'低机位英雄镜头', detail:'低视角，稳定构图，强化主体体量', meta:'视角', media:'/', className:''},
  {name:'暗调岩石展台', detail:'深色矿物材质，克制反光与留白', meta:'场景', media:'/', className:''},
];

let activeVariant = new URL(location.href).searchParams.get('variant');
if (!variants[activeVariant]) activeVariant = 'A';
let activeIndex = 0;

function escapeHtml(value) {
  const span = document.createElement('span');
  span.textContent = value;
  return span.innerHTML;
}

function triggerAtCaret() {
  const selection = window.getSelection();
  if (!selection.rangeCount || !editor.contains(selection.anchorNode)) return null;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(editor);
  range.setEnd(selection.anchorNode, selection.anchorOffset);
  const match = range.toString().match(/(?:^|\s)([@/])([^\s@/]*)$/);
  return match ? {trigger:match[1], query:match[2].toLocaleLowerCase()} : null;
}

function renderPicker(session) {
  const source = session.trigger === '@' ? mentionItems : promptItems;
  const items = source.filter(item => `${item.name}${item.detail}`.toLocaleLowerCase().includes(session.query));
  activeIndex = Math.min(activeIndex, Math.max(0,items.length - 1));
  const head = session.trigger === '@'
    ? '<div class="mention-source-tabs"><button class="active">画布输入</button><button>资产库</button></div><div class="mention-library-row"><span>资产库</span><select><option>当前画布素材</option></select></div><div class="mention-folder-chips"><button class="active">全部</button><button>图片</button><button>视频</button><button>文本</button></div>'
    : '<div class="mention-source-tabs"><button class="active">通用</button><button>当前画布</button></div><div class="mention-folder-chips"><button class="active">全部</button><button>视角</button><button>光影</button><button>产品</button></div>';
  picker.innerHTML = `<div class="mention-picker-shell"><div class="mention-picker-head">${head}</div><div class="mention-content"><div class="mention-option-list" role="listbox">${items.map((item,index) => `<div class="mention-option ${index === activeIndex ? 'active' : ''}" role="option" aria-selected="${index === activeIndex}"><span class="mention-option-media ${item.className}">${escapeHtml(item.media)}</span><span class="mention-option-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.detail)}</small></span><span class="mention-option-meta">${escapeHtml(item.meta)}</span></div>`).join('')}</div></div></div>`;
  picker.classList.toggle('open', items.length > 0);
}

function syncPicker() {
  const session = triggerAtCaret();
  if (!session) {
    picker.classList.remove('open');
    return;
  }
  activeIndex = 0;
  renderPicker(session);
}

function setVariant(next) {
  if (!variants[next]) return;
  activeVariant = next;
  document.body.dataset.variant = next;
  variantLabel.textContent = `${next} · ${variants[next].name}`;
  variantNote.textContent = variants[next].note;
  const url = new URL(location.href);
  url.searchParams.set('variant', next);
  history.replaceState({},'',url);
}

function cycleVariant(offset) {
  const keys = Object.keys(variants);
  setVariant(keys[(keys.indexOf(activeVariant) + offset + keys.length) % keys.length]);
}

editor.addEventListener('input', syncPicker);
editor.addEventListener('keydown', event => {
  if (!picker.classList.contains('open')) return;
  if (event.key === 'Escape') picker.classList.remove('open');
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const count = picker.querySelectorAll('.mention-option').length;
    if (!count) return;
    activeIndex = (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
    renderPicker(triggerAtCaret());
  }
});
document.querySelector('[data-previous]').addEventListener('click', () => cycleVariant(-1));
document.querySelector('[data-next]').addEventListener('click', () => cycleVariant(1));
window.addEventListener('keydown', event => {
  if (!['ArrowLeft','ArrowRight'].includes(event.key) || event.target === editor) return;
  cycleVariant(event.key === 'ArrowRight' ? 1 : -1);
});

setVariant(activeVariant);
requestAnimationFrame(() => editor.focus());
document.documentElement.dataset.ready = 'true';
