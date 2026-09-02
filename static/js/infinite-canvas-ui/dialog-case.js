import './core.js';
await Promise.all([
  import('../smart-canvas/generation-failure-feedback.js?v=2026.08.27.2'),
  import('../smart-canvas/generation-log-modal.js?v=2026.08.27.1'),
]);

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'en' ? 'en' : 'zh-CN';
const long = params.get('content') === 'long';
document.documentElement.dataset.uiTheme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.uiMotion = params.get('motion') === 'reduced' ? 'reduced' : 'standard';
document.documentElement.lang = locale;
if (params.get('viewport') === 'narrow') document.body.dataset.viewport = 'narrow';

const copy = locale === 'en' ? {
  heading: 'Legal Dialog combinations', intro: 'Open any item; focus must return to its launcher after closing.', smallLayout: 'Fixed 28rem width · Content-driven height', smallTask: 'A short task with Cancel and one primary action.', smallInspect: 'Short read-only, lossless inspection.', mediumLayout: 'Fixed 45rem width · Content-driven height', mediumTask: 'Default form and settings task.', mediumInspect: 'Read-only detail inspection.', largeLayout: 'Fixed 72rem width · Height limited to 48rem', largeTask: 'Spacious media or split-pane editing task.', largeInspect: 'Spacious media or log inspection.', xLargeLayout: 'Fills the available viewport · 24px inset', xLargeTask: 'A viewport-sized, high-density editing workspace.', xLargeInspect: 'Viewport-sized media or library inspection.', neutralConfirm: 'Commit a reversible action that still needs confirmation.', dangerConfirm: 'Commit an irreversible deletion.', compactInspect: 'A 512px compact content region with Close, Escape and backdrop dismissal.', compactTask: 'A title/subtitle and standard two-action footer; the action pattern never changes shell width.', generationLogPreview: 'Large · Date-grouped task index with selected task details.', taskBody: long ? 'Saving these settings applies a deliberately long English description to this local workspace while the footer remains visible and the body wraps naturally.' : 'Saving applies these settings to the local workspace.', lightBody: 'This is read-only information. Escape or backdrop activation may close it.', longBody: long ? 'This unusually long content verifies wrapping, scrolling and stable header and footer placement without introducing another independent task.' : 'This content remains one bounded task.', logBody: 'The read-only log keeps an accessible title even when its visual heading is hidden.', cancel: 'Cancel', save: 'Save', apply: 'Apply',
} : {
  heading: 'Dialog 合法组合', intro: '打开任意项目；关闭后焦点应返回对应按钮。', smallLayout: '固定宽度 28rem · 高度随内容', smallTask: '短任务，包含取消和主要操作。', smallInspect: '只读、无损的简短检查。', mediumLayout: '固定宽度 45rem · 高度随内容', mediumTask: '默认表单和设置任务。', mediumInspect: '只读详情检查。', largeLayout: '固定宽度 72rem · 高度限制为 48rem', largeTask: '宽裕的媒体或分栏编辑任务。', largeInspect: '宽裕的媒体或日志检查。', xLargeLayout: '宽度 90vw · 高度 92vh', xLargeTask: '视口型、高信息密度的编辑工作区。', xLargeInspect: '视口型媒体或资产库检查。', neutralConfirm: '提交可逆但需要确认的操作。', dangerConfirm: '不可恢复的删除操作。', compactInspect: '512px 紧凑内容区；可用关闭按钮、Escape 或遮罩退出。', compactTask: '标题副标题与标准双按钮 Footer；宽度不随按钮组合改变。', generationLogPreview: 'Large · 按日期分组的任务索引与所选任务详情。', taskBody: long ? '保存当前设置后，这段刻意加长的中文说明会应用到本机工作区，并验证正文自然换行、Footer 保持可见。' : '保存当前设置后，这些更改会应用到本机工作区。', lightBody: '这是只读信息，可以按 Escape 或点击遮罩关闭。', longBody: long ? '这段异常长的内容用于验证换行、滚动以及 Header 和 Footer 稳定可见，同时仍然只表达一个完整任务。' : '当前内容保持为一个完整任务。', logBody: '只读日志保留可访问标题；视觉标题可以隐藏。', cancel: '取消', save: '保存', apply: '应用',
};
for (const node of document.querySelectorAll('[data-copy]')) {
  const key = node.dataset.copy.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  if (copy[key]) node.textContent = copy[key];
}
if (locale === 'en') {
  const dialogLabels = {
    'small-task': 'Save settings',
    'small-light': 'Keyboard shortcuts',
    'medium-task': 'Edit generation settings',
    'medium-light': 'Generation details',
    'large-task': 'Edit workflow',
    'large-light': 'Generation log',
    'x-large-task': 'Edit immersive workspace',
    'x-large-light': 'Asset library preview',
    'compact-shortcuts': 'Keyboard shortcuts',
    'compact-import': 'Import Node Package',
  };
  for (const [id, label] of Object.entries(dialogLabels)) document.querySelector(`#${id}`).setAttribute('label', label);
  document.querySelector('#small-task ic-input').setAttribute('label', 'Workspace name');
  document.querySelector('#medium-task ic-input').setAttribute('label', 'Name');
  document.querySelector('#medium-task ic-textarea').setAttribute('label', 'Description');
  document.querySelector('#large-task ic-textarea').setAttribute('label', 'Workflow description');
  document.querySelector('#x-large-task ic-textarea').setAttribute('label', 'Immersive workspace description');
  const confirmations = document.querySelectorAll('ic-confirmation-dialog');
  confirmations[0].setAttribute('label', 'Apply these settings?'); confirmations[0].setAttribute('description', 'You can change them again later.'); confirmations[0].setAttribute('confirm-label', 'Apply'); confirmations[0].setAttribute('cancel-label', 'Cancel');
  confirmations[1].setAttribute('label', 'Permanently delete this canvas?'); confirmations[1].setAttribute('description', 'This cannot be undone.'); confirmations[1].setAttribute('confirm-label', 'Delete permanently'); confirmations[1].setAttribute('cancel-label', 'Cancel');
}

await Promise.all(['ic-dialog', 'ic-confirmation-dialog', 'ic-ai-processor-dialog'].map(tag => customElements.whenDefined(tag)));
const aiProcessorDialog = document.querySelector('#reverse-prompt-dialog');
aiProcessorDialog.groups = [{ id:'image-reverse', name:locale === 'en' ? 'Reverse prompt' : '图片反推', templates:locale === 'en' ? [
  { id:'general', name:'General image', subtitle:'Recover the complete visual description', prompt:'Describe the image' },
  { id:'photo', name:'Photography recreation', subtitle:'Lens, camera position, lighting and grade', prompt:'Recover the photography prompt' },
] : [
  { id:'general', name:'通用生图', subtitle:'完整还原画面信息', prompt:'请反推该图片' },
  { id:'photo', name:'摄影复刻', subtitle:'镜头、机位、光线与后期', prompt:'请还原摄影提示词' },
]}];
aiProcessorDialog.models = [
  { id:'gemini-2.5-pro', name:'Gemini 2.5 Pro', iconSrc:'/static/images/providers/gemini.svg', iconMonochrome:true },
  { id:'gpt-5.5', name:'GPT-5.5', iconSrc:'/static/images/providers/chatgpt.svg', iconMonochrome:true },
  { id:'qwen3-vl-plus', name:'Qwen3 VL Plus', icon:'sparkles' },
];
if (locale === 'en') aiProcessorDialog.sourceAlt = 'Modern glass cabin in a sunset valley';
await aiProcessorDialog.updateComplete;

const generationLogRoot = document.querySelector('#generation-log-preview');
const generationLogLauncher = document.querySelector('[data-open-generation-log]');
if (locale === 'en') {
  generationLogRoot.setAttribute('label', 'Generation log');
  generationLogRoot.querySelector('.generation-log-index').setAttribute('aria-label', 'Generation tasks');
  generationLogRoot.querySelector('[data-generation-log-lightbox]').setAttribute('aria-label', 'Reference preview');
  generationLogRoot.querySelector('[data-generation-log-lightbox-close]').setAttribute('label', 'Close reference preview');
}
const generationLogMessages = locale === 'en' ? {
  'canvas.noLogs':'No generation logs', 'canvas.copyFailed':'Copy failed',
  'smart.kindImageGeneration':'Image generation', 'smart.kindVideoGeneration':'Video generation', 'smart.kindTextGeneration':'Text generation',
  'smart.generationLog.imageNode':'Image Node', 'smart.generationLog.promptNode':'Prompt Node', 'smart.generationLog.promptGenerationNode':'Prompt Generation Node',
  'smart.generationLog.smartGroupNode':'Smart Group Node', 'smart.generationLog.batchRunNode':'Batch Run Node', 'smart.generationLog.unknownNode':'Unknown Node',
  'smart.generationLog.unnamedTask':'Untitled task', 'smart.generationLog.today':'Today', 'smart.generationLog.yesterday':'Yesterday',
  'smart.generationLog.taskSucceeded':'Task succeeded', 'smart.generationLog.taskPartial':'Task partially completed', 'smart.generationLog.taskFailed':'Task failed',
  'smart.generationLog.thisMonth':'This month', 'smart.generationLog.lastMonth':'Last month', 'smart.generationLog.noOutputSettings':'No output settings',
  'smart.generationLog.seconds':'{value} s', 'smart.generationLog.minutesSeconds':'{minutes}m {seconds}s', 'smart.generationLog.referenceNumber':'Reference {number}',
  'smart.generationLog.viewReference':'View reference {number}', 'smart.generationLog.references':'References', 'smart.generationLog.prompt':'Full prompt',
  'smart.generationLog.runId':'Run ID', 'smart.generationLog.httpErrorCode':'HTTP / Error code', 'smart.diagnosticUpstreamTaskId':'Upstream task ID',
  'smart.runStatus.success':'Success', 'smart.runStatus.failed':'Failed', 'smart.runStatus.partial':'Partial', 'smart.technicalDetails':'Technical details',
  'smart.copyDiagnostics':'Copy diagnostics', 'smart.diagnosticsCopied':'Safe diagnostics copied',
  'smart.error.unsupported_size.title':'Output size unavailable',
  'smart.error.unsupported_size.description':'The selected output size is not supported by this model.',
  'smart.error.unsupported_size.action':'Choose a supported size and retry.',
} : {
  'canvas.noLogs':'暂无生成日志', 'canvas.copyFailed':'复制失败',
  'smart.kindImageGeneration':'图片生成', 'smart.kindVideoGeneration':'视频生成', 'smart.kindTextGeneration':'文本生成',
  'smart.generationLog.imageNode':'图片节点', 'smart.generationLog.promptNode':'提示词节点', 'smart.generationLog.promptGenerationNode':'提示词生成节点',
  'smart.generationLog.smartGroupNode':'智能分组节点', 'smart.generationLog.batchRunNode':'批量运行节点', 'smart.generationLog.unknownNode':'未知节点',
  'smart.generationLog.unnamedTask':'未命名任务', 'smart.generationLog.today':'今天', 'smart.generationLog.yesterday':'昨天',
  'smart.generationLog.taskSucceeded':'任务成功', 'smart.generationLog.taskPartial':'任务部分完成', 'smart.generationLog.taskFailed':'任务失败',
  'smart.generationLog.thisMonth':'本月', 'smart.generationLog.lastMonth':'上个月', 'smart.generationLog.noOutputSettings':'无输出设置',
  'smart.generationLog.seconds':'{value} 秒', 'smart.generationLog.minutesSeconds':'{minutes} 分 {seconds} 秒', 'smart.generationLog.referenceNumber':'引用图 {number}',
  'smart.generationLog.viewReference':'查看引用图 {number}', 'smart.generationLog.references':'引用图', 'smart.generationLog.prompt':'完整提示词',
  'smart.generationLog.runId':'运行 ID', 'smart.generationLog.httpErrorCode':'HTTP / 错误码', 'smart.diagnosticUpstreamTaskId':'上游任务 ID',
  'smart.runStatus.success':'成功', 'smart.runStatus.failed':'失败', 'smart.runStatus.partial':'部分成功', 'smart.technicalDetails':'技术详情',
  'smart.copyDiagnostics':'复制诊断信息', 'smart.diagnosticsCopied':'已复制安全诊断信息',
  'smart.error.unsupported_size.title':'输出尺寸不可用',
  'smart.error.unsupported_size.description':'当前模型不支持所选输出尺寸。',
  'smart.error.unsupported_size.action':'请改用支持的尺寸后重试。',
};
const generationLogText = (key, values = {}) => String(generationLogMessages[key] || key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? `{${name}}`);
const generationNow = new Date();
const generationYesterday = new Date(generationNow);
generationYesterday.setDate(generationNow.getDate() - 1);
const generationLastMonth = new Date(generationNow.getFullYear(), generationNow.getMonth() - 1, 15, 10, 24, 51);
const generationLogNodes = [
  {id:'preview-custom-7bf2', type:'smart-image', title:locale === 'en' ? 'Fragrance key visual' : '香氛主视觉'},
  {id:'preview-generic-8f31', type:'smart-image', title:'Image'},
  {id:'preview-old-31c8', type:'smart-image', title:'Image'},
];
const generationLogFixture = [
  {
    id:'preview-failed', runId:'generation-run-7bf2-91a4', nodeId:'preview-custom-7bf2', nodeType:'smart-image', status:'failed',
    createdAt:generationNow.getTime(), durationMs:18700, platform:'APIMART', model:'GPT Image 2',
    prompt:locale === 'en' ? 'A transparent fragrance bottle on a warm stone plinth. Sunset rim light with crisp material detail.' : '透明玻璃香水瓶置于暖色岩石台面。日落侧逆光，材质细节清晰。',
    request:{size:'2048x2048', provider_id:'apimart', model:'gpt-image-2'},
    refs:[{url:'/static/design-system/infinite-canvas-ui/reverse-prompt-dialog-fixture.svg', name:'fragrance-reference.svg'}],
    outputs:[], tasks:[{status:'failed', upstreamTaskId:'task_apimart_841739', runMs:18700, httpStatus:400, errorCode:'invalid_resolution', technicalError:'HTTP 400 · Unsupported size: 2048x2048.'}],
    error:'HTTP 400 · Unsupported size: 2048x2048.',
  },
  {
    id:'preview-success', runId:'generation-run-8f31-71d2', nodeId:'preview-generic-8f31', nodeType:'smart-image', status:'success',
    createdAt:generationYesterday.getTime(), durationMs:36200, platform:'Gemini', model:'Nano Banana Pro',
    prompt:locale === 'en' ? 'A modern glass cabin in a twilight valley. Warm interior light and atmospheric mountain depth.' : '暮色山谷中的现代玻璃屋。室内暖光，远处山体保留空气透视。',
    request:{size:'1536x1024'}, refs:[{url:'/static/design-system/infinite-canvas-ui/reverse-prompt-dialog-fixture.svg', name:'cabin-reference.svg'}],
    outputs:[{url:'/static/design-system/infinite-canvas-ui/reverse-prompt-dialog-fixture.svg', kind:'image', width:1536, height:1024}], tasks:[{status:'succeeded', runMs:36200}],
  },
  {
    id:'preview-old-success', runId:'generation-run-31c8-884a', nodeId:'preview-old-31c8', nodeType:'smart-image', status:'success',
    createdAt:generationLastMonth.getTime(), durationMs:31600, platform:'APIMART', model:'GPT Image 1.5',
    prompt:locale === 'en' ? 'Preserve the complete shoe structure and material. Create an evenly lit white-background product image.' : '保留鞋款的完整结构与材质。生成均匀柔和的纯白背景商品图。',
    request:{size:'1024x1024'}, refs:[], outputs:[], tasks:[{status:'succeeded', runMs:31600}],
  },
];
async function copyGenerationLogPreview(text) {
  try {
    await navigator.clipboard.writeText(String(text || ''));
    return true;
  } catch (_) {
    const textarea = document.createElement('textarea');
    textarea.value = String(text || '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  }
}
let generationLogController = null;
function closeGenerationLogPreview() {
  if (generationLogRoot.hasAttribute('open')) void generationLogRoot.hide('programmatic');
}
generationLogController = window.SmartCanvasModules.generationLogModal.create({
  root:generationLogRoot,
  getLogs:() => generationLogFixture,
  getNodes:() => generationLogNodes,
  translate:key => generationLogText(key),
  format:(key, values) => generationLogText(key, values),
  language:() => locale,
  failureFeedback:window.SmartCanvasModules.generationFailureFeedback,
  displayMediaUrl:reference => reference.url,
  copyText:copyGenerationLogPreview,
  toast:(message, options = {}) => customElements.get('ic-toast')?.notify(message, {tone:options.tone || 'neutral'}),
  onClose:closeGenerationLogPreview,
});
generationLogRoot.addEventListener('ic-after-hide', () => generationLogController.onClosed());
generationLogLauncher.addEventListener('click', async () => {
  generationLogController.select();
  generationLogController.beforeOpen();
  await generationLogRoot.show();
  if (generationLogRoot.hasAttribute('open')) generationLogController.afterOpen();
});

for (const launcher of document.querySelectorAll('[data-open]')) launcher.addEventListener('click', () => document.querySelector(`#${launcher.dataset.open}`).show());
for (const action of document.querySelectorAll('[data-close]')) action.addEventListener('click', () => action.closest('ic-dialog').hide('cancel'));
for (const action of document.querySelectorAll('[data-complete]')) action.addEventListener('click', () => action.closest('ic-dialog').hide('confirm'));
const compactSearch = document.querySelector('[data-compact-search]');
const compactClear = document.querySelector('[data-compact-clear]');
const filterCompactRows = () => {
  const query = String(compactSearch?.value || '').trim().toLowerCase();
  let visible = 0;
  for (const row of document.querySelectorAll('[data-compact-search-row]')) {
    row.hidden = Boolean(query) && !row.textContent.toLowerCase().includes(query);
    if (!row.hidden) visible += 1;
  }
  compactClear.hidden = !query;
  document.querySelector('[data-compact-empty]').hidden = visible > 0;
};
compactSearch?.addEventListener('input', filterCompactRows);
compactClear?.addEventListener('click', () => {
  compactSearch.value = '';
  filterCompactRows();
  compactSearch.focus();
  compactSearch.input?.focus?.();
});
for (const dialog of document.querySelectorAll('ic-confirmation-dialog')) dialog.addEventListener('ic-confirm', () => { dialog.confirmLoading = true; setTimeout(() => { dialog.confirmLoading = false; dialog.hide('confirm'); }, 500); });
await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const ready = [...document.querySelectorAll('ic-dialog,ic-confirmation-dialog,ic-ai-processor-dialog')].every(dialog => dialog.dataset.icContractStatus === 'ready');
document.documentElement.dataset.dialogCaseStatus = ready ? 'ready' : 'failed';
await import('./component-name-tag.js');
