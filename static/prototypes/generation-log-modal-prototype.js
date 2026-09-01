const REFERENCES = {
  cabin:'/static/prototypes/reverse-prompt-fixture.svg',
  shoe:'/static/images/test/fixture.svg',
  workflow:'/static/runninghub/thumbnails/workflow-2058541134623891458.jpg',
};

const LOGS = [
  {
    id:'log-size-2048',group:'today',groupLabel:'今天 · 8月27日',status:'failed',time:'14:32',date:'今天 14:32:18',duration:'18.7 秒',
    task:'图片生成 · 香氛主视觉',node:'图像节点 · …7BF2',kind:'image',resolution:'请求 2048 × 2048',platform:'APIMART',model:'GPT Image 2',
    prompt:'透明玻璃香水瓶置于暖色岩石台面，日落侧逆光，材质细节清晰，背景保持克制。',
    refs:[REFERENCES.cabin,REFERENCES.workflow],
    failure:{title:'当前模型不支持 2K 输出',reason:'请求的 2048 × 2048 超出这个模型当前可用的输出范围。',action:'把分辨率改为 1K 后重新生成。'},
    category:'unsupported_size',runId:'generation-run-7bf2-91a4',taskId:'task_apimart_841739',http:'400',errorCode:'invalid_resolution',technical:'HTTP 400 · Unsupported size: 2048x2048. The selected model accepts 1024x1024 for this request.',
  },
  {
    id:'log-busy-portrait',group:'today',groupLabel:'今天 · 8月27日',status:'failed',time:'14:21',date:'今天 14:21:03',duration:'2 分 06 秒',
    task:'图片生成 · 运动鞋换景',node:'图像节点 · …19A0',kind:'image',resolution:'1024 × 1536',platform:'即梦',model:'Seedream 4.0',
    prompt:'保持鞋款造型和材质不变，替换成湿润的城市夜跑场景，低机位，路面有克制反光。',
    refs:[REFERENCES.shoe],
    failure:{title:'生成服务暂时拥堵',reason:'任务已到达生成服务，但在等待窗口内没有获得可用结果。',action:'无需修改内容，稍后再次提交即可。'},
    category:'provider_busy',runId:'generation-run-19a0-5d03',taskId:'jimeng_20260827_142103',http:'503',errorCode:'service_busy',technical:'Provider busy · all channels failed after 3 attempts · retry_after=60',
  },
  {
    id:'log-key-missing',group:'today',groupLabel:'今天 · 8月27日',status:'failed',time:'13:54',date:'今天 13:54:46',duration:'0.4 秒',
    task:'视频生成 · 镜头缓慢推进',node:'图像节点 · …C810',kind:'video',resolution:'1920 × 1080 · 5 秒',platform:'火山引擎',model:'Seedance 1.5 Pro',
    prompt:'镜头从窗外缓慢推进室内，玻璃反射自然变化，室内灯光逐渐亮起，保持建筑形态一致。',
    refs:[],
    failure:{title:'火山引擎尚未配置',reason:'工作区没有可用于提交视频任务的 API Key。',action:'请管理员在 API 设置中完成配置。'},
    category:'credential_missing',runId:'generation-run-c810-224c',taskId:'—',http:'—',errorCode:'credential_missing',technical:'API key is not configured for provider volcengine.',
  },
  {id:'log-ok-one',group:'today',groupLabel:'今天 · 8月27日',status:'success',time:'13:42',date:'今天 13:42:11',duration:'36.2 秒',task:'图片生成 · 暮色玻璃屋',node:'图像节点 · …8F31',kind:'image',resolution:'1536 × 1024',platform:'Gemini',model:'Nano Banana Pro',prompt:'暮色山谷中的现代玻璃屋，室内暖光，远处山体保留空气透视。',refs:[REFERENCES.cabin],runId:'generation-run-8f31-71d2',taskId:'gemini_8f31_1422',http:'200',errorCode:'—',technical:''},
  {id:'log-ok-two',group:'today',groupLabel:'今天 · 8月27日',status:'success',time:'12:18',date:'今天 12:18:39',duration:'22.9 秒',task:'图片生成 · 产品纯色底',node:'图像节点 · …2D74',kind:'image',resolution:'1024 × 1024',platform:'OpenAI',model:'GPT Image 2',prompt:'保持主体轮廓，替换为干净的暖灰色纯色背景。',refs:[],runId:'generation-run-2d74-48a0',taskId:'openai_2d74_9031',http:'200',errorCode:'—',technical:''},
  {
    id:'log-yesterday-timeout',group:'yesterday',groupLabel:'昨天 · 8月26日',status:'failed',time:'22:08',date:'昨天 22:08:43',duration:'15 分 00 秒',
    task:'图片生成 · 材质细节增强',node:'图像节点 · …4E12',kind:'image',resolution:'1024 × 1024',platform:'RunningHub',model:'FLUX.1 Dev',
    prompt:'不改变产品结构，增强金属拉丝与半透明树脂的材质细节，保持原有构图。',refs:[REFERENCES.workflow],
    failure:{title:'任务处理超时',reason:'远端任务超过最长等待时间，尚未返回最终结果。',action:'稍后可以重新提交。'},
    category:'processing_timeout',runId:'generation-run-4e12-11c9',taskId:'rh_2058541134623891458',http:'—',errorCode:'processing_timeout',technical:'Maximum processing time exceeded 15 minutes.',
  },
  {id:'log-yesterday-success',group:'yesterday',groupLabel:'昨天 · 8月26日',status:'success',time:'18:36',date:'昨天 18:36:09',duration:'54.8 秒',task:'图片生成 · 建筑夜景',node:'图像节点 · …6A93',kind:'image',resolution:'1920 × 1080',platform:'即梦',model:'Seedream 4.0',prompt:'蓝调时刻的现代建筑夜景，室内灯光形成层次，保持透视和主体边界。',refs:[REFERENCES.cabin],runId:'generation-run-6a93-7c21',taskId:'jimeng_6a93_183609',http:'200',errorCode:'—',technical:''},
  {id:'log-july-success',group:'lastMonth',groupLabel:'上个月 · 7月',status:'success',time:'7月18日 10:24',date:'7月18日 10:24:51',duration:'31.6 秒',task:'图片生成 · 白底商品图',node:'图像节点 · …31C8',kind:'image',resolution:'1024 × 1024',platform:'APIMART',model:'GPT Image 1.5',prompt:'保留鞋款的完整结构与材质，生成均匀柔和的纯白背景商品图。',refs:[REFERENCES.shoe],runId:'generation-run-31c8-884a',taskId:'apimart_31c8_7720',http:'200',errorCode:'—',technical:''},
  {
    id:'log-july-policy',group:'lastMonth',groupLabel:'上个月 · 7月',status:'failed',time:'7月03日 16:40',date:'7月3日 16:40:12',duration:'1.8 秒',
    task:'图片生成 · 海报人物',node:'图像节点 · …A711',kind:'image',resolution:'1024 × 1536',platform:'OpenAI',model:'GPT Image 1',prompt:'电影海报式人物肖像，正面构图，红黑高反差光影。',refs:[],
    failure:{title:'内容未通过安全检查',reason:'供应商拒绝了本次提示词或参考内容。',action:'修改相关内容后重新提交。'},
    category:'safety_blocked',runId:'generation-run-a711-4b61',taskId:'openai_a711_6088',http:'400',errorCode:'content_policy_violation',technical:'Request blocked by provider content safety policy.',
  },
];

let selectedId = LOGS.find(log => log.status === 'failed').id;
let toastTimer = 0;
const host = document.querySelector('#variantHost');
const toast = document.querySelector('.prototype-toast');
const lightbox = document.querySelector('.image-lightbox');

function icon(name){ return `<i data-lucide="${name}"></i>`; }
function escapeHtml(value){ return String(value ?? '').replace(/[&<>"]/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char])); }
function statusIcon(log){ return `<span class="status-icon ${log.status}">${icon(log.status === 'failed' ? 'circle-x' : 'check')}</span>`; }
function diagnosticButton(log){ return `<ic-button class="log-copy-button" data-component-name="ic-button-primary" type="button" size="s" hierarchy="primary" data-copy="${log.id}"><ic-icon slot="start" name="duplicate"></ic-icon><span>复制诊断信息</span></ic-button>`; }
function indexThumbnail(log){ return `<span class="index-visual">${log.refs[0] ? `<img class="index-thumb" src="${escapeHtml(log.refs[0])}" alt="">` : ''}<span class="index-state ${log.status}">${icon(log.status === 'failed' ? 'circle-x' : 'check')}</span></span>`; }
function indexItem(log){
  const selected = log.id === selectedId;
  return `<div class="index-item ${log.status}${selected ? ' selected' : ''}">${indexThumbnail(log)}<button class="index-select" type="button" data-select="${log.id}" aria-current="${selected ? 'true' : 'false'}"><span class="index-line"><strong>${escapeHtml(log.task)}</strong><time>${escapeHtml(log.time)}</time></span><span class="index-meta">${escapeHtml(log.model)} · ${escapeHtml(log.resolution)}</span>${log.failure ? `<span class="index-reason">${escapeHtml(log.failure.title)}</span>` : ''}</button></div>`;
}
function indexGroups(){
  return ['today','yesterday','lastMonth'].map(group => {
    const logs = LOGS.filter(log => log.group === group);
    return `<section class="index-group"><div class="index-date">${escapeHtml(logs[0]?.groupLabel || '')}</div>${logs.map(indexItem).join('')}</section>`;
  }).join('');
}
function factLine(log){ return `<div class="detail-facts"><span>${escapeHtml(log.resolution)}</span><span>${escapeHtml(log.model)}</span><span>${escapeHtml(log.platform)}</span><span>${escapeHtml(log.duration)}</span></div>`; }
function referenceDetail(log){
  if(!log.refs.length) return '';
  return `<section class="detail-section"><h2>引用图</h2><div class="detail-references">${log.refs.map((src,index) => `<button class="reference-thumb" type="button" data-preview="${escapeHtml(src)}" aria-label="查看引用图 ${index + 1}"><img src="${escapeHtml(src)}" alt="引用图 ${index + 1}"></button>`).join('')}</div></section>`;
}
function technicalDetail(log){
  return `<details class="technical-details"><summary>技术详情</summary><dl><div><dt>Generation Run ID</dt><dd>${escapeHtml(log.runId)}</dd></div><div><dt>上游任务 ID</dt><dd>${escapeHtml(log.taskId)}</dd></div><div><dt>HTTP / 错误码</dt><dd>${escapeHtml(log.http)} · ${escapeHtml(log.errorCode)}</dd></div></dl>${log.technical ? `<pre>${escapeHtml(log.technical)}</pre>` : ''}</details>`;
}
function detailView(log){
  return `<section class="detail-panel"><article class="detail-view"><header class="detail-heading">${statusIcon(log)}<div><h2>${escapeHtml(log.task)}</h2><p>${escapeHtml(log.node)} · ${escapeHtml(log.date)}</p></div></header>${factLine(log)}${log.failure ? `<section class="failure-summary"><strong>${escapeHtml(log.failure.title)}</strong><span>${escapeHtml(log.failure.reason)}</span></section>` : ''}${referenceDetail(log)}<section class="detail-section"><h2>提示词</h2><p>${escapeHtml(log.prompt || '—')}</p></section>${technicalDetail(log)}</article><footer class="detail-actions">${diagnosticButton(log)}</footer></section>`;
}
function render(){
  const selected = LOGS.find(log => log.id === selectedId) || LOGS[0];
  host.innerHTML = `<div class="master-detail"><aside class="task-index"><div class="task-index-list">${indexGroups()}</div></aside>${detailView(selected)}</div>`;
  requestAnimationFrame(() => globalThis.lucide?.createIcons({attrs:{'stroke-width':1.8}}));
}

function diagnosticText(log){
  return `Reroll 生成诊断报告\n生成时间: ${log.date}\n状态: ${log.status}\n耗时: ${log.duration}\n任务: ${log.task}\n节点: ${log.node}\n平台: ${log.platform}\n模型: ${log.model}\n输出设置: ${log.resolution}\nGeneration Run ID: ${log.runId}\n上游任务 ID: ${log.taskId || '-'}\n错误分类: ${log.category || '-'}\n用户说明: ${log.failure?.title || '-'} — ${log.failure?.reason || ''} ${log.failure?.action || ''}\nHTTP / 错误码: ${log.http || '-'} / ${log.errorCode || '-'}\n技术原文: ${log.technical || '-'}\n引用图数量: ${log.refs.length}`;
}
function showToast(message){ clearTimeout(toastTimer); toast.textContent = message; toast.hidden = false; toastTimer = setTimeout(() => { toast.hidden = true; },1400); }
async function copyDiagnostics(id){
  const log = LOGS.find(item => item.id === id); if(!log) return;
  try { await navigator.clipboard.writeText(diagnosticText(log)); showToast('已复制安全诊断信息'); }
  catch(error){ showToast('浏览器未授权剪贴板，Demo 未复制'); }
}
document.addEventListener('click',event => {
  const copy = event.target.closest('[data-copy]'); if(copy){ copyDiagnostics(copy.dataset.copy); return; }
  const select = event.target.closest('[data-select]'); if(select){ selectedId = select.dataset.select; render(); return; }
  const preview = event.target.closest('[data-preview]'); if(preview){ lightbox.querySelector('img').src = preview.dataset.preview; lightbox.hidden = false; return; }
  if(event.target.closest('[data-close]')){ showToast('关闭按钮（Demo）'); return; }
  if(event.target === lightbox || event.target.closest('.image-lightbox .icon-button')) lightbox.hidden = true;
});
document.addEventListener('keydown',event => {
  if(!lightbox.hidden && event.key === 'Escape'){ lightbox.hidden = true; return; }
});
render();
