const VARIANTS = {
  A:{label:'克制基线',title:'A · 克制基线',description:'方案 A 原布局；依靠细描边、灰色选中和白色主操作建立基础层级。',height:'48 px',strategy:'细描边 + 单一高亮'},
  B:{label:'双层控制台',title:'B · 双层控制台',description:'保持方案 A 原布局；用深色外壳承托独立参数层，选中项再抬高一级。',height:'48 px',strategy:'深色外壳 + 内层参数面'},
  C:{label:'双区反差',title:'C · 双区反差',description:'保持方案 A 原布局；参数保持暗面，提交区整体反白，让浏览与确认形成清晰分区。',height:'48 px',strategy:'暗色参数区 + 亮色提交区'},
};

const MODES = {
  preview:{label:'预览',icon:'image',hint:'滚轮缩放，拖动画面查看细节'},
  crop:{label:'裁剪',icon:'crop',hint:'拖动裁剪框，调整保留区域'},
  outpaint:{label:'扩图',icon:'maximize',hint:'拖动画布边缘，决定画面扩展范围'},
  mask:{label:'遮罩',icon:'scan-face',hint:'涂抹需要重新生成或替换的区域'},
  brush:{label:'画笔',icon:'paintbrush',hint:'用标注帮助模型理解修改意图'},
  resize:{label:'缩放',icon:'scaling',hint:'缩放内容并实时检查输出尺寸'},
  grid:{label:'宫格',icon:'grid-3x3',hint:'选择切分或拼接方式，拖动分割线微调'},
};

const PRIMARY_CONTROLS = {
  preview:() => `${tool('下载','download')}${tool('对比原图','columns-2')}${separator()}${label('组内图片')}${tool('上一张','chevron-left')}${pill('1 / 2')}${tool('下一张','chevron-right')}${separator()}${tool('缩小','zoom-out')}${pill('100%')}${tool('放大','zoom-in')}${tool('适应','scan')}`,
  crop:() => `${label('比例')}${tool('自由','',true,'data-control="ratio"')}${tool('原图')}${tool('1:1')}${tool('4:3')}${tool('3:4')}${tool('16:9')}${tool('9:16')}`,
  outpaint:() => `${label('输出')}${pill('2048 × 1365')}${tool('全方向','maximize',true)}${tool('左','arrow-left')}${tool('右','arrow-right')}`,
  mask:() => `${label('笔刷')}${range(42,4,160)}${pill('42 px')}${tool('撤销','undo-2')}${tool('恢复','redo-2')}`,
  brush:() => `${tool('自由','paintbrush',true)}${tool('矩形','square')}${tool('椭圆','circle')}${tool('标记','hash')}${swatch()}${range(14,2,80)}${pill('14 px')}`,
  resize:() => `${label('缩放')}${range(50,5,100)}${pill('0.50 ×')}${label('输出')}${pill('1024 × 683')}`,
  grid:() => `${tool('切分','scissors',true)}${tool('拼接','layout-grid')}${label('预设')}${tool('2×2')}${tool('3×3','',true)}${tool('自定义','sliders-horizontal')}`,
};

const ADVANCED_CONTROLS = {
  preview:() => `${tool('下载全部','archive')}${tool('重置视图','rotate-ccw')}${pill('原始尺寸 2048 × 1365')}`,
  crop:() => `${label('常用比例')}${tool('3:2')}${tool('2:3')}${tool('21:9')}${tool('自定义','sliders-horizontal')}`,
  outpaint:() => `${label('扩展方向')}${tool('上','arrow-up')}${tool('下','arrow-down')}${tool('左','arrow-left')}${tool('右','arrow-right')}${label('填充')}${tool('智能延展','sparkles',true)}`,
  mask:() => `${label('边缘')}${range(18,0,100)}${pill('18%')}${tool('清空','trash-2',false,'data-tone="danger"')}${pill('白色区域将被编辑')}`,
  brush:() => `${label('标注工具')}${tool('文字','type')}${tool('数字','hash')}${tool('箭头','move-up-right')}${label('历史')}${tool('撤销','undo-2')}${tool('恢复','redo-2')}${tool('清空','trash-2')}`,
  resize:() => `${label('插值方式')}${tool('高质量','sparkles',true)}${tool('锐利')}${tool('柔和')}${label('锁定比例')}${tool('已锁定','lock',true)}`,
  grid:() => `${label('布局')}${tool('1×2')}${tool('2×1')}${tool('2×3')}${tool('3×2')}${label('输出')}${tool('1K')}${tool('2K','',true)}${tool('4K')}`,
};

let state = {
  variant:normalizeVariant(new URLSearchParams(location.search).get('variant')),
  mode:normalizeMode(new URLSearchParams(location.search).get('mode')),
  parametersOpen:false,
};
let toastTimer = 0;

const dockHost = document.querySelector('#dockHost');
const editModeToolbar = document.querySelector('#editModeToolbar');
const imageWrap = document.querySelector('.image-wrap');
const modeHint = document.querySelector('#modeHint');

function normalizeVariant(value){ return VARIANTS[value] ? value : 'A'; }
function normalizeMode(value){ return MODES[value] ? value : 'preview'; }
function icon(name){ return name ? `<i data-lucide="${name}"></i>` : ''; }
function label(text){ return `<span class="control-label">${text}</span>`; }
function pill(text){ return `<span class="value-pill">${text}</span>`; }
function separator(){ return '<span class="context-separator" aria-hidden="true"></span>'; }
function swatch(){ return `<button class="tool-button" type="button" aria-label="画笔颜色"><i class="color-swatch"></i></button>`; }
function range(value,min,max){ return `<input class="compact-range" type="range" min="${min}" max="${max}" value="${value}" aria-label="数值调节">`; }
function tool(text,iconName='',selected=false,extra=''){
  return `<button class="tool-button${selected ? ' selected' : ''}" type="button" ${extra}>${icon(iconName)}<span>${text}</span></button>`;
}
function actionButtonItems(){
  if(state.mode === 'preview') return '';
  return '<button class="action-button" type="button" data-command="cancel">取消</button><button class="action-button primary" type="button" data-command="apply">应用</button>';
}
function actionButtons(){
  const items = actionButtonItems();
  return items ? `<div class="action-group">${items}</div>` : '';
}
function modeButtons(){
  return Object.entries(MODES).map(([key,mode]) => `<button class="mode-button${state.mode === key ? ' active' : ''}" type="button" data-mode="${key}" title="${mode.label}" aria-pressed="${state.mode === key}">${icon(mode.icon)}<span>${mode.label}</span></button>`).join('');
}
function contextTools(kind='primary'){
  const source = kind === 'advanced' ? ADVANCED_CONTROLS : PRIMARY_CONTROLS;
  return `<div class="context-tools" data-context="${kind}">${source[state.mode]()}</div>`;
}
function renderVariantA(){
  return `<div class="dock dock-a dock-surface${state.mode === 'preview' ? ' preview-dock' : ''}" data-variant="A">${contextTools()}${state.mode === 'preview' ? '' : `<span class="divider"></span>${actionButtons()}`}</div>`;
}
function renderVariantB(){
  return `<div class="dock dock-a dock-surface hierarchy-b${state.mode === 'preview' ? ' preview-dock' : ''}" data-variant="B">${contextTools()}${state.mode === 'preview' ? '' : `<span class="divider"></span>${actionButtons()}`}</div>`;
}
function renderVariantC(){
  return `<div class="dock dock-a dock-surface hierarchy-c${state.mode === 'preview' ? ' preview-dock' : ''}" data-variant="C">${contextTools()}${state.mode === 'preview' ? '' : `<span class="divider"></span>${actionButtons()}`}</div>`;
}
function render(){
  document.querySelector('.studio-shell').dataset.hierarchy = state.variant;
  editModeToolbar.innerHTML = `<div class="mode-strip">${modeButtons()}</div>`;
  dockHost.innerHTML = state.variant === 'A' ? renderVariantA() : state.variant === 'B' ? renderVariantB() : renderVariantC();
  imageWrap.dataset.mode = state.mode;
  modeHint.textContent = MODES[state.mode].hint;
  document.querySelector('#variantTitle').textContent = VARIANTS[state.variant].title;
  document.querySelector('#variantDescription').textContent = VARIANTS[state.variant].description;
  document.querySelector('#heightMetric').textContent = VARIANTS[state.variant].height;
  document.querySelector('#modeMetric').textContent = MODES[state.mode].label;
  document.querySelector('#strategyMetric').textContent = VARIANTS[state.variant].strategy;
  document.querySelector('#switcherVariant').textContent = state.variant;
  document.querySelector('#switcherLabel').textContent = VARIANTS[state.variant].label;
  requestAnimationFrame(() => globalThis.lucide?.createIcons({attrs:{'stroke-width':1.8}}));
}
function updateUrl(){
  const url = new URL(location.href);
  url.searchParams.set('variant',state.variant);
  url.searchParams.set('mode',state.mode);
  history.replaceState(null,'',url);
}
function setMode(mode){
  if(!MODES[mode]) return;
  state.mode = mode;
  state.parametersOpen = false;
  updateUrl();
  render();
}
function stepVariant(direction){
  const keys = Object.keys(VARIANTS);
  const index = keys.indexOf(state.variant);
  state.variant = keys[(index + direction + keys.length) % keys.length];
  state.parametersOpen = false;
  updateUrl();
  render();
}
function showToast(message){
  clearTimeout(toastTimer);
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.append(toast);
  toastTimer = setTimeout(() => toast.remove(),1500);
}

document.addEventListener('click',event => {
  const modeButton = event.target.closest('[data-mode]');
  if(modeButton){ setMode(modeButton.dataset.mode); return; }
  const variantStep = event.target.closest('[data-variant-step]');
  if(variantStep){ stepVariant(Number(variantStep.dataset.variantStep)); return; }
  const command = event.target.closest('[data-command]')?.dataset.command;
  if(command === 'toggle-parameters'){
    state.parametersOpen = !state.parametersOpen;
    render();
    return;
  }
  if(command === 'apply'){ showToast(`${MODES[state.mode].label}设置已应用（Demo）`); return; }
  if(command === 'cancel'){ showToast('已取消本次调整（Demo）'); return; }
  if(command === 'compare'){ imageWrap.classList.toggle('compare'); showToast('按住可对比原图（Demo）'); return; }
  if(command === 'fit'){ showToast('画面已适应窗口（Demo）'); return; }
  if(state.parametersOpen){
    if(!event.target.closest('.dock-b-wrap')){
      state.parametersOpen = false;
      render();
    }
  }
});

document.addEventListener('keydown',event => {
  const tag = event.target?.tagName?.toLowerCase();
  if(tag === 'input' || tag === 'textarea' || event.target?.isContentEditable) return;
  if(event.key === 'ArrowLeft'){ event.preventDefault(); stepVariant(-1); }
  if(event.key === 'ArrowRight'){ event.preventDefault(); stepVariant(1); }
});

if(!location.pathname.includes('/prototypes/')) document.querySelector('#prototypeSwitcher').hidden = true;
render();
