function tr(key){ return window.StudioI18n ? window.StudioI18n.t(key) : key; }
function tf(key, vars={}){
    return Object.entries(vars).reduce((text, [k,v]) => text.replaceAll(`{${k}}`, v), tr(key));
}
function refreshLanguageView(){
    document.title = tr('comfy.title');
    renderList();
    renderEditor();
    renderPreview();
    renderWorkspaceView();
}
function applyLanguage(){
    if(window.StudioI18n) window.StudioI18n.apply();
    refreshLanguageView();
}

const TYPES = [
    { v:'text', key:'comfy.typeText' },
    { v:'textarea', key:'comfy.typeTextarea' },
    { v:'number', key:'comfy.typeNumber' },
    { v:'slider', key:'comfy.typeSlider' },
    { v:'dropdown', key:'comfy.typeDropdown' },
    { v:'image', key:'comfy.typeImage' },
    { v:'video', key:'comfy.typeVideo' },
    { v:'audio', key:'comfy.typeAudio' },
    { v:'boolean', key:'comfy.typeBoolean' },
];
function currentLang(){ return window.StudioI18n?.lang?.() === 'en' ? 'en' : 'zh'; }
function typeLabel(type){
    const item = TYPES.find(t => t.v === type);
    return item ? tr(item.key) : type;
}

// ComfyUI 节点类型 → 中文 + 图标 + 颜色分类
const NODE_INFO = {
    'KSampler':              { key:'comfy.nodeSampler', icon:'⚙', cat:'sampler' },
    'KSamplerAdvanced':      { key:'comfy.nodeSamplerAdvanced', icon:'⚙', cat:'sampler' },
    'SamplerCustom':         { key:'comfy.nodeCustomSampler', icon:'⚙', cat:'sampler' },
    'CheckpointLoaderSimple':{ key:'comfy.nodeCheckpointLoader', icon:'📦', cat:'loader' },
    'UNETLoader':            { key:'comfy.nodeUnetLoader', icon:'📦', cat:'loader' },
    'VAELoader':             { key:'comfy.nodeVaeLoader', icon:'📦', cat:'loader' },
    'CLIPLoader':            { key:'comfy.nodeClipLoader', icon:'📦', cat:'loader' },
    'DualCLIPLoader':        { key:'comfy.nodeDualClipLoader', icon:'📦', cat:'loader' },
    'LoraLoader':            { key:'comfy.nodeLoraLoader', icon:'⚡', cat:'lora' },
    'LoraLoaderModelOnly':   { key:'comfy.nodeLoraModelLoader', icon:'⚡', cat:'lora' },
    'CLIPTextEncode':        { key:'comfy.nodePromptEncode', icon:'✎', cat:'prompt' },
    'CLIPTextEncodeFlux':    { key:'comfy.nodeFluxPrompt', icon:'✎', cat:'prompt' },
    'ConditioningCombine':   { key:'comfy.nodeConditionCombine', icon:'⊕', cat:'prompt' },
    'ConditioningConcat':    { key:'comfy.nodeConditionConcat', icon:'⊕', cat:'prompt' },
    'VAEDecode':             { key:'comfy.nodeVaeDecode', icon:'◐', cat:'vae' },
    'VAEEncode':             { key:'comfy.nodeVaeEncode', icon:'◑', cat:'vae' },
    'LoadImage':             { key:'comfy.nodeImageLoad', icon:'🖼', cat:'image' },
    'SaveImage':             { key:'comfy.nodeImageSave', icon:'💾', cat:'output' },
    'PreviewImage':          { key:'comfy.nodeImagePreview', icon:'👁', cat:'output' },
    'ImageScale':            { key:'comfy.nodeImageScale', icon:'⇆', cat:'image' },
    'EmptyLatentImage':      { key:'comfy.nodeEmptyLatent', icon:'▦', cat:'latent' },
    'LatentUpscaleBy':       { key:'comfy.nodeLatentUpscale', icon:'↗', cat:'latent' },
    'ControlNetApply':       { label:'ControlNet',    icon:'⇨', cat:'controlnet' },
    'ControlNetLoader':      { key:'comfy.nodeControlNetLoader', icon:'📦', cat:'loader' },
    'PrimitiveNode':         { key:'comfy.nodeConstant', icon:'•', cat:'misc' },
    'Note':                  { key:'comfy.nodeNote', icon:'≡', cat:'misc' },
};

// 常见输入字段 → 中文友好名
const INPUT_LABELS = {
    'text': 'comfy.inputText', 'prompt': 'comfy.inputPrompt', 'positive': 'comfy.inputPositive',
    'negative': 'comfy.inputNegative', 'seed': 'comfy.inputSeed', 'noise_seed': 'comfy.inputNoiseSeed',
    'steps': 'comfy.inputSteps', 'cfg': 'comfy.inputCfg', 'sampler_name': 'comfy.inputSampler',
    'scheduler': 'comfy.inputScheduler', 'denoise': 'comfy.inputDenoise', 'width': 'comfy.inputWidth',
    'height': 'comfy.inputHeight', 'batch_size': 'comfy.inputBatchSize', 'megapixels': 'comfy.inputMegapixels',
    'strength_model': 'comfy.inputModelStrength', 'strength_clip': 'comfy.inputClipStrength', 'lora_name': 'comfy.inputLora',
    'ckpt_name': 'comfy.inputCheckpoint', 'vae_name': 'comfy.inputVae', 'clip_name': 'comfy.inputClip',
    'clip_name1': 'comfy.inputClip1', 'clip_name2': 'comfy.inputClip2', 'unet_name': 'comfy.inputUnet',
    'control_net_name': 'comfy.inputControlNet', 'image': 'comfy.inputImage', 'images': 'comfy.inputImages',
    'mask': 'comfy.inputMask', 'latent': 'comfy.inputLatent', 'value': 'comfy.inputValue',
    'string': 'comfy.inputString', 'strength': 'comfy.inputStrength', 'guidance': 'comfy.inputGuidance',
    'resolution': 'comfy.inputResolution', 'filename_prefix': 'comfy.inputFilename',
    'upscale_method': 'comfy.inputUpscale', 'crop': 'comfy.inputCrop',
};

function nodeLabel(node){
    if(node._meta?.title) return node._meta.title;
    return NODE_INFO[node.class_type]?.key ? tr(NODE_INFO[node.class_type].key) : (node.class_type || tr('comfy.unnamed'));
}
function nodeSub(node){
    const info = NODE_INFO[node.class_type];
    if(info && node._meta?.title) return tr(info.key) + ' · ' + node.class_type;
    return node.class_type || '';
}
function nodeIcon(node){
    return NODE_INFO[node.class_type]?.icon || '◆';
}
function inputLabel(name){
    return INPUT_LABELS[name] ? tr(INPUT_LABELS[name]) : name;
}

let workflows = [];
let selectedName = '';
let currentWorkflow = null;     // 原始 JSON
let currentConfig = null;       // { title, fields:[...] }
let isBuiltin = false;
let previewValues = {};         // field_id -> 发给后端的值（图片：comfy 文件名）
let previewRandomActive = {};   // field_id -> 筛子运行时是否激活；未设置时默认激活
let previewImageUrls = {};      // field_id -> 浏览器可显示的本地 URL（仅图片字段）
let runResult = null;           // url 或 null
let workspaceMode = 'graph';
let miniView = { k: 1, x: 0, y: 0 };
let miniCards = {};
let miniTestNodes = [];
let miniDrag = null;

const pageMessage = document.getElementById('pageMessage');
const listEl = document.getElementById('workflowList');
const workflowTitleInput = document.getElementById('workflowTitleInput');
const subEl = document.getElementById('editorSub');
const deleteBtn = document.getElementById('deleteBtn');
const saveBtn = document.getElementById('saveBtn');
const nodeListEl = document.getElementById('nodeList');
const previewCard = document.getElementById('previewContent');
const miniCanvasHost = document.getElementById('miniCanvasHost');
const workflowUploadInput = document.getElementById('workflowUploadInput');
const workflowNameDialog = document.getElementById('workflowNameDialog');
const workflowNameInput = document.getElementById('workflowNameInput');
const mediaUploadInput = document.getElementById('mediaUploadInput');
const deleteWorkflowDialog = document.getElementById('deleteWorkflowDialog');

function setStatus(text, tone='neutral'){
    if(!pageMessage) return;
    pageMessage.textContent = text || '';
    pageMessage.setAttribute('tone', tone);
    pageMessage.toggleAttribute('hidden', !text);
}
function showError(error, fallback){
    setStatus(error?.message || fallback, 'danger');
}
function escapeHtml(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s){ return escapeHtml(s); }
function fieldKind(f){
    if(['image','video','audio'].includes(f.type)) return f.type;
    const key = `${f.input || ''} ${f.name || ''}`.toLowerCase();
    if(f.type === 'textarea' || /prompt|text|提示词|正向|负向/.test(key)) return 'prompt';
    return 'setting';
}
function isMediaField(f){ return ['image','video','audio'].includes(fieldKind(f)); }
function mediaFieldLabel(kind, count){
    const type = tr({image:'comfy.typeImage', video:'comfy.typeVideo', audio:'comfy.typeAudio'}[kind] || kind);
    return tf('comfy.mediaCount', {type, count});
}
function mediaAccept(kind){
    if(kind === 'video') return 'video/*';
    if(kind === 'audio') return 'audio/*';
    return 'image/*';
}
function mediaUploadText(kind){
    if(kind === 'video') return tr('comfy.clickUploadVideo');
    if(kind === 'audio') return tr('comfy.clickUploadAudio');
    return tr('comfy.clickUploadImage');
}
function mediaUploadFailedText(kind){
    if(kind === 'video') return tr('comfy.videoUploadFailed');
    if(kind === 'audio') return tr('comfy.audioUploadFailed');
    return tr('comfy.imageUploadFailed');
}
function mediaPreviewHtml(kind, url, name='', compact=false){
    const safeUrl = escapeAttr(url || '');
    const safeName = escapeHtml(name || typeLabel(kind));
    if(!url) return `<ic-empty-state title="${escapeAttr(mediaUploadText(kind))}" label="${escapeAttr(mediaUploadText(kind))}"></ic-empty-state>`;
    if(kind === 'video') return `<ic-media-container kind="video" label="${safeName}" aspect="landscape" fit="contain"><video src="${safeUrl}" muted preload="metadata" playsinline controls></video></ic-media-container>`;
    if(kind === 'audio') return `<ic-media-container kind="audio" label="${safeName}"><div class="audio-file-preview"><ic-icon name="audio" size="${compact ? 'small' : 'medium'}"></ic-icon><span class="media-file-name">${safeName}</span><audio src="${safeUrl}" controls preload="metadata"></audio></div></ic-media-container>`;
    return `<ic-image-frame state="normal" size="${compact ? 'small' : 'medium'}" label="${safeName}" src="${safeUrl}" alt="${safeName}"></ic-image-frame>`;
}
function defaultMiniCards(){
    return {
        prompt:{ x:24, y:30 },
        image:{ x:24, y:210 },
        custom:{ x:280, y:78 },
        output:{ x:540, y:120 }
    };
}
function defaultMiniTestNodes(){
    return [
        { id:'prompt_1', type:'prompt', x:36, y:96, text:'' },
        { id:'image_1', type:'image', x:36, y:286, url:'', value:'' },
        { id:'comfy_1', type:'comfy', x:330, y:150 },
        { id:'output_1', type:'output', x:670, y:190 }
    ];
}

// —— ComfyUI 后端地址管理 ——
let comfyInstances = [];
async function loadComfyInstances(){
    try {
        const data = await fetch('/api/comfyui/instances').then(r => r.json());
        comfyInstances = Array.isArray(data.instances) ? data.instances : [];
        renderComfyInstances();
    } catch(e){ console.error(e); }
}
function renderComfyInstances(){
    const el = document.getElementById('comfyInstancesList');
    if(!el) return;
    el.innerHTML = comfyInstances.map((addr, i) => `
        <ic-card class="backend-row" size="small" tone="subtle" label="${escapeAttr(tf('comfy.backendNumber', {number:i + 1}))}">
            <div class="backend-row-content"><ic-badge kind="count" tone="neutral">${i + 1}</ic-badge>
                <ic-input name="comfy_backend_${i}" type="text" label="${escapeAttr(tf('comfy.backendNumber', {number:i + 1}))}" value="${escapeAttr(addr)}" placeholder="host:port" oninput="updateComfyInstance(${i}, this.value)"></ic-input>
                <ic-icon-button type="button" hierarchy="quiet" tone="danger" icon="delete" label="${escapeAttr(tr('common.delete'))}" onclick="removeComfyInstance(${i})"></ic-icon-button></div>
        </ic-card>
    `).join('');
}
function addComfyInstance(){
    comfyInstances = [...comfyInstances, ''];
    renderComfyInstances();
}
function updateComfyInstance(index, value){
    comfyInstances[index] = value;
}
function removeComfyInstance(index){
    comfyInstances = comfyInstances.filter((_, i) => i !== index);
    renderComfyInstances();
}
async function saveComfyInstances(){
    const cleaned = comfyInstances.map(s => String(s||'').trim()).filter(Boolean);
    if(!cleaned.length){ setStatus(tr('comfy.backendRequired'), 'danger'); return; }
    setStatus(tr('comfy.saving'));
    try {
        const res = await fetch('/api/comfyui/instances', {
            method:'PUT',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ instances: cleaned })
        });
        if(!res.ok) throw new Error((await res.json()).detail || tr('comfy.saveFailed'));
        const data = await res.json();
        comfyInstances = data.instances || cleaned;
        renderComfyInstances();
        try { new BroadcastChannel('studio-api').postMessage({ type: 'comfy-instances-changed' }); } catch(e) {}
        try { window.parent?.postMessage({ type: 'comfy-instances-changed' }, '*'); } catch(e) {}
        setStatus(tr('comfy.backendsSaved'));
    } catch(e){
        showError(e, tr('comfy.saveFailed'));
    }
}

async function loadList(){
    try {
        const data = await fetch('/api/workflows').then(r=>r.json());
        workflows = data.workflows || [];
        renderList();
        // 自动加载：当前没选中 或 之前选中的已不存在 → 选第一个
        const stillExists = selectedName && workflows.some(w => w.name === selectedName);
        if(!stillExists && workflows.length){
            await selectWorkflow(workflows[0].name);
        }
    } catch(e){ setStatus(tr('comfy.loadFailed')); console.error(e); }
}
// iframe 在 index.html 里通过 switchUI 显示，首次显示时可能 DOMContentLoaded 已经过去；
// 添加一个 pageshow 监听确保进入页面时一定刷新
window.addEventListener('pageshow', () => {
    if(!currentWorkflow && workflows.length === 0) loadList();
});

function renderList(){
    listEl.innerHTML = workflows.map(w => `
        <ic-button class="workflow-card" type="button" hierarchy="quiet" data-value="${escapeAttr(w.name)}" ${w.name===selectedName?'pressed toggle':''} onclick="selectWorkflow('${escapeHtml(w.name)}')">
            <ic-icon slot="start" name="${w.builtin?'app':'workflow'}"></ic-icon>
            <span class="workflow-copy">
                <div class="workflow-name">${escapeHtml(w.title)}</div>
                <div class="workflow-meta">${tf('comfy.fieldCount', {count:w.field_count})}</div>
            </span>
            ${w.builtin?`<ic-badge slot="end" kind="label" tone="neutral">${tr('comfy.builtin')}</ic-badge>`:''}
        </ic-button>
    `).join('');
    listEl.setAttribute('value', selectedName || workflows[0]?.name || '');
}

async function selectWorkflow(name){
    selectedName = name;
    renderList();
    try {
        setStatus(tr('comfy.loading'));
        const data = await fetch(`/api/workflows/${encodeURIComponent(name)}`).then(r=>r.json());
        currentWorkflow = data.workflow;
        currentConfig = data.config || { title:name.replace('.json',''), fields:[] };
        if(!currentConfig.fields) currentConfig.fields = [];
        if(!currentConfig.mini_cards) currentConfig.mini_cards = {};
        isBuiltin = !!data.builtin;
        miniCards = {...defaultMiniCards(), ...currentConfig.mini_cards};
        currentConfig.mini_cards = miniCards;
        // 释放上一次的图片 blob URL
        Object.values(previewImageUrls).forEach(u => { try { URL.revokeObjectURL(u); } catch(e){} });
        previewImageUrls = {};
        previewValues = {};
        currentConfig.fields.forEach(f => {
            if(f.default !== undefined && f.default !== null) previewValues[f.id] = f.default;
        });
        previewRandomActive = {};
        runResult = null;
        graphView = { k: 1, x: 0, y: 0 };
        miniView = { k: 1, x: 0, y: 0 };
        miniTestNodes = defaultMiniTestNodes();
        renderEditor();
        renderPreview();
        // 新工作流加载后自动适配窗口
        setTimeout(() => graphFit(), 50);
        setStatus('');
    } catch(e){ setStatus(tr('comfy.openFailed')); console.error(e); }
}

function fieldFor(node, input){
    return currentConfig.fields.find(f => f.node === node && f.input === input);
}
function makeFieldId(){ return 'f_' + Math.random().toString(36).slice(2,9); }

function toggleField(node, input){
    const existing = fieldFor(node, input);
    if(existing){
        currentConfig.fields = currentConfig.fields.filter(f => f !== existing);
        delete previewValues[existing.id];
        delete previewRandomActive[existing.id];
    } else {
        const nodeData = currentWorkflow[node];
        const rawValue = nodeData?.inputs?.[input];
        const type = guessType(rawValue, input);
        const f = {
            id: makeFieldId(),
            node, input,
            name: inputLabel(input),
            type,
            default: typeof rawValue === 'object' ? null : rawValue,
            options: [],
        };
        if(type === 'slider' || type === 'number') {
            if(typeof rawValue === 'number'){
                f.min = 0;
                f.max = Math.max(rawValue * 2, 10);
                f.step = rawValue > 0 && rawValue < 5 ? 0.1 : 1;
            }
            if(type === 'number') f.random_enabled = false;
        }
        currentConfig.fields.push(f);
        if(f.default !== undefined && f.default !== null) previewValues[f.id] = f.default;
    }
    renderEditor();
    renderPreview();
    // 浮窗打开时同步刷新浮窗内容
    if(popupNodeId === node) refreshPopupBody();
}

function refreshPopupBody(){
    if(!popupNodeId) return;
    const node = currentWorkflow[popupNodeId];
    if(!node) return;
    const popup = document.getElementById('nodePopup');
    const body = popup.querySelector('.popup-body');
    if(!body) return;
    const inputs = Object.entries(node.inputs || {}).filter(([k,v]) => {
        return !(Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number');
    });
    body.innerHTML = inputs.length === 0
        ? `<div class="popup-empty">${tr('comfy.noConfigFields')}</div>`
        : inputs.map(([key, value]) => renderInputRow(popupNodeId, key, value)).join('');
}

function guessType(value, inputName){
    const lc = (inputName||'').toLowerCase();
    if(typeof value === 'boolean') return 'boolean';
    if(typeof value === 'number'){
        if(/strength|cfg|denoise/.test(lc)) return 'slider';
        return 'number';
    }
    if(typeof value === 'string'){
        if(/prompt|text|description/.test(lc) || (value && value.length > 60)) return 'textarea';
        if(/video|movie|mp4|webm|mov|m4v|vhs/.test(lc) || /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/i.test(value)) return 'video';
        if(/audio|sound|music|voice|wav|mp3/.test(lc) || /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/i.test(value)) return 'audio';
        if(/image|img|mask|filename|file/.test(lc) || /\.(png|jpe?g|webp|gif|bmp|tiff?)(\?|$)/i.test(value)) return 'image';
        return 'text';
    }
    return 'text';
}

function updateField(fieldId, key, value){
    const f = currentConfig.fields.find(x => x.id === fieldId);
    if(!f) return;
    f[key] = value;
    if(key === 'type'){
        previewValues[fieldId] = (value === 'boolean') ? false : (value === 'number' || value === 'slider' ? 0 : '');
        f.random_enabled = value === 'number' ? !!f.random_enabled : false;
        delete previewRandomActive[fieldId];
    }
    if(key === 'random_enabled'){
        delete previewRandomActive[fieldId];
    }
    // 文本/数字输入过程中不能重建浮窗，否则输入框会失焦，表现成每次只能输入 1 个字。
    // 这些字段只影响预览或运行参数，直接同步数据即可；切换 type 才需要重建表单结构。
    if(key === 'name' || key === 'min' || key === 'max' || key === 'step' || key === 'default' || key === 'options' || key === 'random_enabled'){
        renderPreview();
        if(workspaceMode === 'canvas') renderMiniCanvasPreview(miniCanvasHost, true);
        return;
    }
    renderEditor();
    renderPreview();
    if(popupNodeId === f.node) refreshPopupBody();
}

function updateWorkflowTitle(value){
    if(!currentConfig) return;
    currentConfig.title = value;
    const item = workflows.find(w => w.name === selectedName);
    if(item) item.title = value || selectedName.replace('.json','');
    renderList();
}

function setWorkspaceMode(mode){
    workspaceMode = mode === 'canvas' ? 'canvas' : 'graph';
    document.getElementById('workspaceModeTabs')?.setAttribute('value', workspaceMode);
    renderWorkspaceView();
}

function renderEditor(){
    if(!currentWorkflow){
        deleteBtn.hidden = true;
        saveBtn.hidden = true;
        nodeListEl.innerHTML = '';
        document.getElementById('graphCard').hidden = true;
        document.getElementById('nodesToggle').hidden = true;
        if(miniCanvasHost) miniCanvasHost.hidden = true;
        return;
    }
    document.getElementById('nodesToggle').hidden = workspaceMode !== 'graph';
    workflowTitleInput.value = currentConfig.title || selectedName.replace('.json','');
    subEl.textContent = tf('comfy.nodeStats', {nodes:Object.keys(currentWorkflow).length, fields:currentConfig.fields.length}) + (isBuiltin ? ` · ${tr('comfy.builtin')}` : '');
    deleteBtn.hidden = isBuiltin;
    saveBtn.hidden = false;

    renderGraph();
    renderWorkspaceView();

    const nodes = Object.entries(currentWorkflow).sort((a,b)=>{
        const aNum = parseInt(a[0],10), bNum = parseInt(b[0],10);
        if(!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
        return a[0].localeCompare(b[0]);
    });

    nodeListEl.innerHTML = nodes.map(([nodeId, node])=>{
        const inputs = Object.entries(node.inputs || {}).filter(([k,v])=>{
            return !(Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number');
        });
        const exposedCount = inputs.filter(([k])=>fieldFor(nodeId,k)).length;
        const expanded = exposedCount > 0;
        const icon = nodeIcon(node);
        return `
            <ic-card class="node-card ${expanded?'expanded':''}" id="node-card-${escapeAttr(nodeId)}" data-node-id="${escapeAttr(nodeId)}" label="${escapeAttr(nodeLabel(node))}" size="small">
                <ic-button class="node-card-head" type="button" hierarchy="quiet" onclick="this.closest('.node-card').classList.toggle('expanded')">
                    <span class="node-summary">
                        <span class="node-business-icon" aria-hidden="true">${icon}</span>
                        <span class="node-copy">
                            <div class="node-class">${escapeHtml(nodeLabel(node))}</div>
                            <div class="node-id">${escapeHtml(nodeSub(node))} · #${escapeHtml(nodeId)} · ${tf('comfy.configurableCount', {count:inputs.length})}</div>
                        </span>
                    </span>
                    <span slot="end" class="node-summary-end">${exposedCount > 0 ? `<ic-badge kind="count" tone="neutral">${exposedCount}</ic-badge>` : ''}<ic-icon name="expand"></ic-icon></span>
                </ic-button>
                <div class="node-inputs">
                    ${inputs.map(([key, value])=>renderInputRow(nodeId, key, value)).join('') || `<ic-empty-state title="${escapeAttr(tr('comfy.noConfigInputs'))}" label="${escapeAttr(tr('comfy.noConfigInputs'))}"></ic-empty-state>`}
                </div>
            </ic-card>
        `;
    }).join('');
}

// 计算节点拓扑层级（按从入度 0 的源节点向下游传播）
function computeLayers(){
    const ids = Object.keys(currentWorkflow);
    const incoming = {};   // nodeId -> Set of upstream nodeIds
    const outgoing = {};
    ids.forEach(id => { incoming[id] = new Set(); outgoing[id] = new Set(); });
    ids.forEach(id => {
        const inputs = currentWorkflow[id].inputs || {};
        Object.values(inputs).forEach(v => {
            if(Array.isArray(v) && v.length === 2 && typeof v[0] === 'string'){
                if(currentWorkflow[v[0]]){
                    incoming[id].add(v[0]);
                    outgoing[v[0]].add(id);
                }
            }
        });
    });
    const layer = {};
    const visited = new Set();
    function dfs(id, lv){
        if(visited.has(id)) return;
        if((layer[id] || 0) < lv) layer[id] = lv;
        else layer[id] = layer[id] || lv;
        visited.add(id);
        outgoing[id].forEach(child => dfs(child, lv + 1));
    }
    // 从无上游的节点开始
    ids.forEach(id => { if(incoming[id].size === 0) dfs(id, 0); });
    // 处理可能漏掉的环 / 孤立节点
    ids.forEach(id => { if(!(id in layer)) layer[id] = 0; });
    // 按层级分桶
    const buckets = {};
    ids.forEach(id => {
        const lv = layer[id];
        (buckets[lv] = buckets[lv] || []).push(id);
    });
    return { layer, buckets, incoming };
}

function graphSvgElement(){
    const host = document.getElementById('graphSvgHost');
    let svg = host?.firstElementChild;
    if(!svg && host){
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('graph-svg');
        host.append(svg);
    }
    return svg;
}

function renderGraph(){
    const svg = graphSvgElement();
    if(!svg) return;
    if(!currentWorkflow || !Object.keys(currentWorkflow).length){
        document.getElementById('graphCard').hidden = true;
        return;
    }
    document.getElementById('graphCard').hidden = false;
    const { layer, buckets, incoming } = computeLayers();
    const NODE_W = 130, NODE_H = 50, X_GAP = 36, Y_GAP = 14;
    const positions = {};
    const sortedLevels = Object.keys(buckets).map(Number).sort((a,b)=>a-b);
    let maxRows = 0;
    sortedLevels.forEach(lv => {
        const ids = buckets[lv].sort((a,b)=>parseInt(a,10)-parseInt(b,10));
        ids.forEach((id, idx) => {
            positions[id] = { x: lv * (NODE_W + X_GAP) + 16, y: idx * (NODE_H + Y_GAP) + 16 };
        });
        maxRows = Math.max(maxRows, ids.length);
    });
    const totalW = (sortedLevels.length) * (NODE_W + X_GAP) + 16;
    const totalH = maxRows * (NODE_H + Y_GAP) + 16;

    // 连线
    const edgesHtml = [];
    Object.keys(currentWorkflow).forEach(toId => {
        const inputs = currentWorkflow[toId].inputs || {};
        const seen = new Set();
        Object.values(inputs).forEach(v => {
            if(Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && positions[v[0]]){
                if(seen.has(v[0])) return;
                seen.add(v[0]);
                const from = positions[v[0]];
                const to = positions[toId];
                const x1 = from.x + NODE_W, y1 = from.y + NODE_H/2;
                const x2 = to.x, y2 = to.y + NODE_H/2;
                const cx = (x1 + x2) / 2;
                edgesHtml.push(`<path class="gedge" d="M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}"></path>`);
            }
        });
    });

    // 节点
    const nodesHtml = Object.entries(currentWorkflow).map(([id, node]) => {
        const pos = positions[id];
        const label = nodeLabel(node);
        const sub = node.class_type || '';
        const exposedCount = currentConfig.fields.filter(f => f.node === id).length;
        const exposedClass = exposedCount > 0 ? 'has-exposed' : '';
        const cat = NODE_INFO[node.class_type]?.cat || 'misc';
        const icon = nodeIcon(node);
        const truncLabel = label.length > 12 ? label.slice(0,12) + '…' : label;
        const truncSub = sub.length > 16 ? sub.slice(0,16) + '…' : sub;
        return `
            <g class="gnode cat-${cat} ${exposedClass}" data-node-id="${escapeAttr(id)}" transform="translate(${pos.x},${pos.y})" onclick="openNodePopup('${escapeAttr(id)}', this)">
                <rect width="${NODE_W}" height="${NODE_H}" rx="8"></rect>
                <text class="gn-icon" x="10" y="20" font-size="14">${icon}</text>
                <text class="gn-title" x="28" y="20">${escapeHtml(truncLabel)}</text>
                <text class="gn-sub" x="28" y="35">${escapeHtml(truncSub)}</text>
                <text class="gn-sub" x="${NODE_W - 8}" y="20" text-anchor="end">#${escapeHtml(id)}</text>
                ${exposedCount > 0 ? `<text class="gbadge" x="${NODE_W - 8}" y="42" text-anchor="end">${tf('comfy.usedCount', {count:exposedCount})}</text>` : ''}
            </g>
        `;
    }).join('');

    graphContentSize = { w: totalW, h: totalH };
    svg.innerHTML = `<g id="graphViewport" transform="translate(${graphView.x},${graphView.y}) scale(${graphView.k})">${edgesHtml.join('')}${nodesHtml}</g>`;
    // 设置 SVG 自身尺寸（占满容器）
    const wrap = svg.closest('.graph-svg-wrap');
    svg.setAttribute('viewBox', `0 0 ${wrap.clientWidth} ${wrap.clientHeight}`);
    attachPanZoom(svg, wrap);
    updateZoomPill();
}

// 缩放/平移状态
let graphView = { k: 1, x: 0, y: 0 };
let graphContentSize = { w: 0, h: 0 };
let panState = null;

function updateZoomPill(){
    const pill = document.getElementById('zoomPill');
    if(pill) pill.textContent = Math.round(graphView.k * 100) + '%';
}
function applyGraphTransform(){
    const vp = document.getElementById('graphViewport');
    if(vp) vp.setAttribute('transform', `translate(${graphView.x},${graphView.y}) scale(${graphView.k})`);
    updateZoomPill();
}
function graphZoom(dir){
    const factor = dir > 0 ? 1.2 : 1/1.2;
    const newK = Math.max(0.2, Math.min(3, graphView.k * factor));
    // 围绕容器中心缩放
    const wrap = document.querySelector('.graph-svg-wrap');
    const cx = wrap.clientWidth / 2;
    const cy = wrap.clientHeight / 2;
    graphView.x = cx - (cx - graphView.x) * (newK / graphView.k);
    graphView.y = cy - (cy - graphView.y) * (newK / graphView.k);
    graphView.k = newK;
    applyGraphTransform();
}
function graphFit(){
    const wrap = document.querySelector('.graph-svg-wrap');
    if(!graphContentSize.w || !wrap) return;
    const svg = graphSvgElement();
    if(svg && wrap.clientWidth && wrap.clientHeight){
        svg.setAttribute('viewBox', `0 0 ${wrap.clientWidth} ${wrap.clientHeight}`);
    }
    const pad = 20;
    const kx = (wrap.clientWidth - pad*2) / graphContentSize.w;
    const ky = (wrap.clientHeight - pad*2) / graphContentSize.h;
    const k = Math.max(0.2, Math.min(2, Math.min(kx, ky)));
    graphView.k = k;
    graphView.x = (wrap.clientWidth - graphContentSize.w * k) / 2;
    graphView.y = (wrap.clientHeight - graphContentSize.h * k) / 2;
    applyGraphTransform();
}
function attachPanZoom(svg, wrap){
    if(svg.dataset.panZoomBound) return;
    svg.dataset.panZoomBound = '1';
    // 滚轮缩放（围绕鼠标位置）
    wrap.addEventListener('wheel', e => {
        if(e.target.closest('.popup-panel')) return;
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.15 : 1/1.15;
        const newK = Math.max(0.2, Math.min(3, graphView.k * factor));
        const rect = wrap.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        graphView.x = mx - (mx - graphView.x) * (newK / graphView.k);
        graphView.y = my - (my - graphView.y) * (newK / graphView.k);
        graphView.k = newK;
        applyGraphTransform();
    }, { passive: false });
    // 鼠标拖动（空白区域）
    svg.addEventListener('mousedown', e => {
        // 只在点击空白处（不是节点 g）才平移
        if(e.target.closest('.gnode')) return;
        e.preventDefault();
        panState = { sx: e.clientX, sy: e.clientY, ox: graphView.x, oy: graphView.y };
        wrap.classList.add('is-panning');
    });
    window.addEventListener('mousemove', e => {
        if(!panState) return;
        graphView.x = panState.ox + (e.clientX - panState.sx);
        graphView.y = panState.oy + (e.clientY - panState.sy);
        applyGraphTransform();
    });
    window.addEventListener('mouseup', () => {
        if(panState){ panState = null; wrap.classList.remove('is-panning'); }
    });
}
let popupNodeId = null;

function openNodePopup(nodeId, gEl){
    popupNodeId = nodeId;
    document.querySelectorAll('.gnode').forEach(g => g.classList.toggle('is-active', g.dataset.nodeId === nodeId));
    const node = currentWorkflow[nodeId];
    if(!node) return;
    const popup = document.getElementById('nodePopup');
    const inputs = Object.entries(node.inputs || {}).filter(([k,v]) => {
        return !(Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number');
    });
    const icon = nodeIcon(node);
    const label = nodeLabel(node);
    const sub = nodeSub(node);
    popup.setAttribute('label', label);
    popup.innerHTML = `
        <div class="popup-head">
            <span class="popup-icon">${icon}</span>
            <div class="popup-copy">
                <div class="popup-title">${escapeHtml(label)}</div>
                <div class="popup-sub">${escapeHtml(sub)} · #${escapeHtml(nodeId)}</div>
            </div>
            <ic-icon-button type="button" hierarchy="quiet" icon="close" label="${escapeAttr(tr('common.close'))}" onclick="closeNodePopup()"></ic-icon-button>
        </div>
        <div class="popup-body">
            ${inputs.length === 0
                ? `<ic-empty-state title="${escapeAttr(tr('comfy.noConfigFields'))}" label="${escapeAttr(tr('comfy.noConfigFields'))}"></ic-empty-state>`
                : inputs.map(([key, value]) => renderInputRow(nodeId, key, value)).join('')}
        </div>
    `;
    popup.onwheel = e => e.stopPropagation();
    popup.querySelector('.popup-body')?.addEventListener('wheel', e => e.stopPropagation(), { passive:true });
    popup.show(gEl);
    requestAnimationFrame(() => {
        const surface = popup.shadowRoot?.querySelector('[part="surface"]');
        const anchor = gEl?.getBoundingClientRect?.();
        if(!surface || !anchor) return;
        const bounds = surface.getBoundingClientRect();
        const gap = 12;
        const inset = 16;
        let left = anchor.right + gap;
        if(left + bounds.width > window.innerWidth - inset) left = anchor.left - bounds.width - gap;
        left = Math.max(inset, Math.min(left, window.innerWidth - bounds.width - inset));
        const top = Math.max(inset, Math.min(anchor.top, window.innerHeight - bounds.height - inset));
        popup.style.setProperty('--node-popup-left', `${left}px`);
        popup.style.setProperty('--node-popup-top', `${top}px`);
    });
}

function closeNodePopup(){
    popupNodeId = null;
    document.querySelectorAll('.gnode').forEach(g => g.classList.remove('is-active'));
    document.getElementById('nodePopup')?.hide();
}

function toggleNodeList(){
    const list = document.getElementById('nodeList');
    const txt = document.getElementById('nodesToggleText');
    list.hidden = !list.hidden;
    const hidden = list.hidden;
    txt.textContent = hidden ? tr('comfy.showNodeList') : tr('comfy.hideNodeList');
}

// Esc 关闭浮窗
document.addEventListener('keydown', e => {
    if(e.key === 'Escape' && popupNodeId) closeNodePopup();
    if(e.key === 'Escape') closeImagePreview();
});

function renderInputRow(nodeId, inputKey, rawValue){
    const f = fieldFor(nodeId, inputKey);
    const active = !!f;
    const showExtras = active && (f.type === 'slider' || f.type === 'number' || f.type === 'dropdown');
    // 原始值类型徽章
    let valueBadge = '';
    const typeOf = typeof rawValue;
    if(typeOf === 'string'){
        const preview = rawValue.length > 50 ? rawValue.slice(0,50) + '…' : rawValue;
        valueBadge = `<span class="value-quote">"</span><span class="value-text">${escapeHtml(preview)}</span><span class="value-quote">"</span>`;
    } else if(typeOf === 'number'){
        valueBadge = `<span class="value-number">${rawValue}</span>`;
    } else if(typeOf === 'boolean'){
        valueBadge = `<ic-badge kind="status" tone="${rawValue?'success':'warning'}">${rawValue?'true':'false'}</ic-badge>`;
    } else {
        valueBadge = `<span class="value-empty">${escapeHtml(String(rawValue))}</span>`;
    }
    const friendlyName = inputLabel(inputKey);
    const showOriginal = friendlyName !== inputKey;
    return `
        <div class="input-row ${active?'is-active':''} ${showExtras?'has-extras':''}">
            <ic-switch class="field-enabled" name="expose_${escapeAttr(nodeId)}_${escapeAttr(inputKey)}" label="${escapeAttr(active ? tr('comfy.disableField') : tr('comfy.enableField'))}" ${active?'checked':''} onchange="toggleField('${escapeAttr(nodeId)}','${escapeAttr(inputKey)}')"></ic-switch>
            <div class="input-info">
                <div class="input-key">${escapeHtml(friendlyName)}${showOriginal ? ` <span class="input-source-name">${escapeHtml(inputKey)}</span>` : ''}</div>
                <div class="input-orig">${tr('comfy.defaultValue')}${valueBadge}</div>
            </div>
            <ic-input name="field_${escapeAttr(nodeId)}_${escapeAttr(inputKey)}_name" type="text" label="${escapeAttr(tr('comfy.displayName'))}" value="${active?escapeAttr(f.name):escapeAttr(friendlyName)}" ${active?'':'disabled'} oninput="updateField('${active?f.id:''}','name',this.value)"></ic-input>
            <ic-select name="field_${escapeAttr(nodeId)}_${escapeAttr(inputKey)}_type" label="${escapeAttr(tr('comfy.modelType'))}" ${active?'':'disabled'} onchange="updateField('${active?f.id:''}','type',this.value)">
                ${TYPES.map(t=>`<option value="${t.v}" ${active && f.type===t.v?'selected':''}>${typeLabel(t.v)}</option>`).join('')}
            </ic-select>
            ${active ? renderExtras(f) : ''}
        </div>
    `;
}

function renderExtras(f){
    if(f.type === 'slider' || f.type === 'number'){
        const randomToggle = f.type === 'number'
            ? `<ic-switch class="random-toggle" name="field_${escapeAttr(f.id)}_random" label="${escapeAttr(tr('comfy.random'))}" ${f.random_enabled === true ? 'checked' : ''} onchange="updateField('${f.id}','random_enabled',this.checked)"></ic-switch>`
            : '';
        return `<div class="extras-row">
            <ic-number-input name="field_${escapeAttr(f.id)}_min" label="min" value="${f.min ?? ''}" oninput="updateField('${f.id}','min',this.value===''?null:parseFloat(this.value))"></ic-number-input>
            <ic-number-input name="field_${escapeAttr(f.id)}_max" label="max" value="${f.max ?? ''}" oninput="updateField('${f.id}','max',this.value===''?null:parseFloat(this.value))"></ic-number-input>
            <ic-number-input name="field_${escapeAttr(f.id)}_step" label="step" value="${f.step ?? ''}" oninput="updateField('${f.id}','step',this.value===''?null:parseFloat(this.value))"></ic-number-input>
            <ic-number-input name="field_${escapeAttr(f.id)}_default" label="${escapeAttr(tr('comfy.defaultValue'))}" value="${f.default ?? ''}" oninput="updateField('${f.id}','default',this.value===''?null:parseFloat(this.value))"></ic-number-input>
            ${randomToggle}
        </div>`;
    }
    if(f.type === 'dropdown'){
        const opts = f.options || [];
        const fid = escapeAttr(f.id);
        const rows = opts.map((o, i) => {
            const looksNumber = String(o).trim() !== '' && !isNaN(Number(o));
            const tag = looksNumber
                ? `<span class="opt-type-tag is-num">${tr('comfy.numeric')}</span>`
                : `<span class="opt-type-tag">${tr('comfy.textual')}</span>`;
            return `
                <div class="dropdown-opt-row">
                    <ic-badge kind="count" tone="neutral">${i + 1}</ic-badge>
                    <ic-input name="field_${fid}_option_${i}" type="text" label="${escapeAttr(tf('comfy.optionNumber', {number:i + 1}))}" value="${escapeAttr(o)}" oninput="updateDropdownOption('${fid}', ${i}, this.value, this)"></ic-input>
                    ${tag.replace('<span ', '<ic-badge kind="label" tone="neutral" ').replace('</span>', '</ic-badge>')}
                    <ic-icon-button type="button" hierarchy="quiet" tone="danger" icon="delete" label="${escapeAttr(tr('common.delete'))}" onclick="event.stopPropagation();removeDropdownOption('${fid}', ${i})"></ic-icon-button>
                </div>
            `;
        }).join('');
        return `<div class="extras-row field-choice-values">
            <div class="field-choice-help">
                ${tr('comfy.dropdownOptionsHint')}
            </div>
            ${rows}
            <ic-button type="button" hierarchy="secondary" onclick="event.stopPropagation();addDropdownOption('${fid}')"><ic-icon slot="start" name="add"></ic-icon><span>${tr('comfy.addOption')}</span></ic-button>
        </div>`;
    }
    return '';
}
function updateDropdownOption(fieldId, index, value, inputEl){
    const f = currentConfig.fields.find(x => x.id === fieldId); if(!f) return;
    f.options = f.options || [];
    f.options[index] = value;
    // 不重渲浮窗，只更新当前行右侧「数字/文本」标签
    if(inputEl){
        const tag = inputEl.parentElement?.querySelector('.opt-type-tag');
        if(tag){
            const looksNumber = String(value).trim() !== '' && !isNaN(Number(value));
            tag.classList.toggle('is-num', looksNumber);
            tag.textContent = tr(looksNumber ? 'comfy.numeric' : 'comfy.textual');
        }
    }
    renderPreview();  // 右侧预览的下拉选项实时同步
}
function addDropdownOption(fieldId){
    const f = currentConfig.fields.find(x => x.id === fieldId); if(!f) return;
    f.options = [...(f.options || []), ''];
    renderPreview();
    if(popupNodeId === f.node) refreshPopupBody();
}
function removeDropdownOption(fieldId, index){
    const f = currentConfig.fields.find(x => x.id === fieldId); if(!f) return;
    f.options = (f.options || []).filter((_, i) => i !== index);
    renderPreview();
    if(popupNodeId === f.node) refreshPopupBody();
}

// --- 右侧实时预览 ---
function setPreviewValue(fieldId, value){
    previewValues[fieldId] = value;
    // 更新滑块旁边的数值显示
    const valSpan = document.querySelector(`[data-slider-val="${fieldId}"]`);
    if(valSpan) valSpan.textContent = value;
}
function randomValueForField(f){
    const isFloat = Number(f.step) > 0 && Number(f.step) < 1;
    let min = Number.isFinite(Number(f.min)) ? Number(f.min) : null;
    let max = Number.isFinite(Number(f.max)) ? Number(f.max) : null;
    const name = `${f.input || ''} ${f.name || ''}`.toLowerCase();
    const looksSeed = name.includes('seed') || name.includes('noise') || name.includes('随机') || name.includes('噪');
    if(min === null) min = looksSeed ? 1 : 0;
    if(max === null || max <= min) max = looksSeed ? 1000000000000000 : 999999;
    let value = min + Math.random() * (max - min);
    if(isFloat){
        const precision = Math.min(8, Math.max(1, String(f.step).split('.')[1]?.length || 2));
        value = Number(value.toFixed(precision));
    } else {
        value = Math.floor(value);
    }
    return value;
}

function fieldSupportsRandom(f){
    return !!f && f.type === 'number' && f.random_enabled === true;
}

function isPreviewRandomActive(fieldId){
    return previewRandomActive[fieldId] !== false;
}

function randomButtonHtml(f){
    if(!fieldSupportsRandom(f)) return '';
    const active = isPreviewRandomActive(f.id);
    const title = tr(active ? 'comfy.randomOn' : 'comfy.randomOff');
    return `<ic-icon-button class="random-btn" type="button" hierarchy="quiet" icon="random" label="${escapeAttr(title)}" toggle ${active ? 'pressed' : ''} onclick="togglePreviewRandom('${f.id}')"></ic-icon-button>`;
}

function togglePreviewRandom(fieldId){
    const f = currentConfig?.fields?.find(x => x.id === fieldId);
    if(!fieldSupportsRandom(f)) return;
    previewRandomActive[fieldId] = !isPreviewRandomActive(fieldId);
    renderPreview();
    if(workspaceMode === 'canvas') renderMiniCanvasPreview(miniCanvasHost, true);
}

function applyActiveRandomValues(fields){
    const out = {...fields};
    currentConfig?.fields?.forEach(f => {
        if(fieldSupportsRandom(f) && isPreviewRandomActive(f.id)){
            const value = randomValueForField(f);
            out[f.id] = value;
            previewValues[f.id] = value;
        }
    });
    return out;
}

function openImagePreview(url){
    const box = document.getElementById('imageLightbox');
    const img = document.getElementById('imageLightboxImg');
    if(!box || !img || !url) return;
    img.src = url;
    box.show();
}

function closeImagePreview(){
    const box = document.getElementById('imageLightbox');
    const img = document.getElementById('imageLightboxImg');
    if(box?.open) box.hide('close');
    if(img) img.src = '';
}

function renderPreview(){
    const fields = currentConfig?.fields || [];
    if(!fields.length){
        previewCard.innerHTML = `<ic-empty-state title="${escapeAttr(tr('comfy.previewEmpty').replace('<br>', ' '))}" label="${escapeAttr(tr('comfy.previewEmpty').replace('<br>', ' '))}"></ic-empty-state>`;
        return;
    }
    const fieldsHtml = fields.map(f => renderPreviewField(f)).join('');
    const resultHtml = runResult
        ? `<div class="run-result" onclick="openImagePreview('${escapeAttr(runResult)}')"><ic-media-container kind="image" label="${escapeAttr(tr('comfy.runSuccess'))}" aspect="landscape" fit="contain"><img src="${escapeAttr(runResult)}" alt=""></ic-media-container><ic-alert tone="success">${tr('comfy.runSuccess')}</ic-alert></div>`
        : '';
    const runButton = `<ic-button id="runBtn" class="run-btn" type="button" hierarchy="primary" onclick="onRun()"><ic-icon slot="start" name="play"></ic-icon><span>${tr('comfy.runTest')}</span></ic-button>`;
    previewCard.innerHTML = `
        ${fieldsHtml}
        ${runButton}
        ${resultHtml}
    `;
}

function renderPreviewField(f){
    const label = escapeAttr(f.name || f.input);
    const v = previewValues[f.id] ?? f.default ?? (f.type==='boolean'?false:(f.type==='number'||f.type==='slider'?0:''));
    if(f.type === 'textarea'){
        return `<div class="pfield"><ic-textarea name="preview_${escapeAttr(f.id)}" label="${label}" value="${escapeAttr(v)}" oninput="setPreviewValue('${f.id}',this.value)"></ic-textarea></div>`;
    }
    if(f.type === 'number'){
        const randomBtn = randomButtonHtml(f);
        return `<div class="pfield"><div class="pfield-random-row ${randomBtn ? 'has-random' : ''}"><ic-number-input name="preview_${escapeAttr(f.id)}" label="${label}" value="${escapeAttr(v)}" oninput="setPreviewValue('${f.id}',parseFloat(this.value)||0)"></ic-number-input>${randomBtn}</div></div>`;
    }
    if(f.type === 'slider'){
        const min = f.min ?? 0, max = f.max ?? 10, step = f.step ?? 1;
        return `<div class="pfield"><ic-slider name="preview_${escapeAttr(f.id)}" label="${label}" min="${min}" max="${max}" step="${step}" value="${escapeAttr(v)}" value-text="${escapeAttr(v)}" oninput="setPreviewValue('${f.id}',parseFloat(this.value));this.setAttribute('value-text',this.value)"></ic-slider></div>`;
    }
    if(f.type === 'dropdown'){
        const opts = (f.options || []).map(o => `<option value="${escapeAttr(o)}" ${String(v)===String(o)?'selected':''}>${escapeHtml(o)}</option>`).join('');
        return `<div class="pfield"><ic-select name="preview_${escapeAttr(f.id)}" label="${label}" onchange="setPreviewValue('${f.id}',this.value)">${opts || `<option value="">${tr('comfy.noOptions')}</option>`}</ic-select></div>`;
    }
    if(isMediaField(f)){
        // 浏览器显示用本地 blob URL；如果没有就尝试用 /assets/ 等可访问 URL；都没有则显示占位文字
        const displayUrl = previewImageUrls[f.id] || (typeof v === 'string' && /^(\/|https?:|blob:|data:)/.test(v) ? v : '');
        return `<div class="pfield"><div class="pfield-label">${escapeHtml(f.name || f.input)}</div><div class="pfield-image-drop ${displayUrl?'has-image':''}" onclick="pickImage('${f.id}')">
            ${mediaPreviewHtml(fieldKind(f), displayUrl, v)}
        </div></div>`;
    }
    if(f.type === 'boolean'){
        return `<div class="pfield"><ic-switch name="preview_${escapeAttr(f.id)}" label="${label}" ${v?'checked':''} onchange="setPreviewValue('${f.id}',this.checked)"></ic-switch></div>`;
    }
    return `<div class="pfield"><ic-input name="preview_${escapeAttr(f.id)}" type="text" label="${label}" value="${escapeAttr(v)}" oninput="setPreviewValue('${f.id}',this.value)"></ic-input></div>`;
}

function miniCardStyle(key){
    const p = miniCards[key] || defaultMiniCards()[key] || {x:0,y:0};
    return `left:${p.x}px;top:${p.y}px`;
}

function miniLine(aKey, bKey){
    const a = miniCards[aKey] || defaultMiniCards()[aKey];
    const b = miniCards[bKey] || defaultMiniCards()[bKey];
    const x1 = a.x + 210, y1 = a.y + 70, x2 = b.x, y2 = b.y + 70;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx*dx + dy*dy);
    const deg = Math.atan2(dy, dx) * 180 / Math.PI;
    return `<div class="mini-line" style="left:${x1}px;top:${y1}px;width:${len}px;transform:rotate(${deg}deg)"></div>`;
}

function renderWorkspaceView(){
    const graphWrap = document.querySelector('.graph-svg-wrap');
    const nodesToggle = document.getElementById('nodesToggle');
    document.getElementById('workspaceModeTabs')?.setAttribute('value', workspaceMode);
    if(!currentWorkflow){
        if(graphWrap) graphWrap.hidden = true;
        if(miniCanvasHost) miniCanvasHost.hidden = true;
        return;
    }
    if(workspaceMode === 'canvas'){
        if(graphWrap) graphWrap.hidden = true;
        if(nodesToggle) nodesToggle.hidden = true;
        renderMiniCanvasPreview(miniCanvasHost, true);
    } else {
        if(graphWrap) graphWrap.hidden = false;
        if(miniCanvasHost) miniCanvasHost.hidden = true;
        if(nodesToggle) nodesToggle.hidden = false;
    }
}

function renderMiniCanvasPreview(target = previewCard, large = false){
    if(!target) return;
    const promptFields = currentConfig.fields.filter(f => fieldKind(f) === 'prompt');
    const imageFields = currentConfig.fields.filter(f => fieldKind(f) === 'image');
    const videoFields = currentConfig.fields.filter(f => fieldKind(f) === 'video');
    const audioFields = currentConfig.fields.filter(f => fieldKind(f) === 'audio');
    const settingFields = currentConfig.fields.filter(f => fieldKind(f) === 'setting');
    const prompts = miniTestNodes.filter(n => n.type === 'prompt');
    const mediaNodes = miniTestNodes.filter(n => ['image','video','audio'].includes(n.type));
    const comfy = miniTestNodes.find(n => n.type === 'comfy') || defaultMiniTestNodes().find(n => n.type === 'comfy');
    const output = miniTestNodes.find(n => n.type === 'output') || defaultMiniTestNodes().find(n => n.type === 'output');
    const resultHtml = runResult
        ? `<div class="mini-result" onclick="openImagePreview('${escapeAttr(runResult)}')"><ic-media-container kind="image" label="${escapeAttr(tr('comfy.runSuccess'))}" aspect="landscape" fit="contain"><img src="${escapeAttr(runResult)}" alt=""></ic-media-container><ic-alert tone="success">${tr('comfy.runSuccess')}</ic-alert></div>`
        : `<ic-empty-state title="${escapeAttr(tr('comfy.resultHere'))}" label="${escapeAttr(tr('comfy.resultHere'))}"></ic-empty-state>`;
    target.hidden = false;
    target.innerHTML = `
        <div id="miniCanvas" class="mini-canvas ${large ? 'large' : ''}">
            <ic-toolbar class="mini-toolbar" label="测试画布节点" appearance="framed">
                <ic-button type="button" hierarchy="quiet" onclick="addMiniNode('prompt')"><ic-icon slot="start" name="add"></ic-icon>${tr('comfy.addPrompt')}</ic-button>
                <ic-button type="button" hierarchy="quiet" onclick="addMiniNode('image')"><ic-icon slot="start" name="image"></ic-icon>${tr('comfy.addImage')}</ic-button>
                <ic-button type="button" hierarchy="quiet" onclick="addMiniNode('video')"><ic-icon slot="start" name="video"></ic-icon>${typeLabel('video')}</ic-button>
                <ic-button type="button" hierarchy="quiet" onclick="addMiniNode('audio')"><ic-icon slot="start" name="audio"></ic-icon>${typeLabel('audio')}</ic-button>
            </ic-toolbar>
            <div id="miniWorld" class="mini-world" style="transform:translate(${miniView.x}px,${miniView.y}px) scale(${miniView.k})">
                ${[...prompts, ...mediaNodes].map(n => miniLineBetween(n, comfy)).join('')}
                ${miniLineBetween(comfy, output)}
                ${prompts.map((n,i) => `
                    <ic-card class="mini-card" data-node="${n.id}" label="${escapeAttr(tr('comfy.promptNode'))} ${i+1}" size="small" style="left:${n.x}px;top:${n.y}px">
                        <span class="mini-port out"></span>
                        <div class="mini-card-head"><ic-icon name="workflow"></ic-icon><span class="mini-node-title">${tr('comfy.promptNode')} ${i+1}</span>${miniDeleteButton(n)}</div>
                        <div class="mini-card-body"><ic-textarea name="mini_${escapeAttr(n.id)}_text" label="${escapeAttr(tr('comfy.promptNode'))} ${i+1}" value="${escapeAttr(n.text || '')}" placeholder="${escapeAttr(tr('comfy.promptPlaceholder'))}" oninput="updateMiniNode('${n.id}','text',this.value)"></ic-textarea></div>
                    </ic-card>`).join('')}
                ${mediaNodes.map((n,i) => `
                    <ic-card class="mini-card" data-node="${n.id}" label="${escapeAttr(typeLabel(n.type))} ${i+1}" size="small" style="left:${n.x}px;top:${n.y}px">
                        <span class="mini-port out"></span>
                        <div class="mini-card-head"><ic-icon name="${n.type === 'video' ? 'video' : n.type === 'audio' ? 'audio' : 'image'}"></ic-icon><span class="mini-node-title">${typeLabel(n.type)} ${i+1}</span>${miniDeleteButton(n)}</div>
                        <div class="mini-card-body"><div class="mini-image-drop" onclick="pickMiniImage('${n.id}')">${mediaPreviewHtml(n.type, n.url, n.name || n.value, true)}</div></div>
                    </ic-card>`).join('')}
                <ic-card class="mini-card comfy-card" data-node="${comfy.id}" label="${escapeAttr(currentConfig.title || selectedName.replace('.json',''))}" size="small" style="left:${comfy.x}px;top:${comfy.y}px">
                    <span class="mini-port in"></span><span class="mini-port out"></span>
                    <div class="mini-card-head"><ic-icon name="workflow"></ic-icon><span class="mini-node-title">${escapeHtml(currentConfig.title || selectedName.replace('.json',''))} · ${tr('canvas.comfyCustom')}</span></div>
                    <div class="mini-card-body">
                        <div class="mini-section-label">${tr('comfy.inputs')}</div>
                        <ic-alert tone="neutral">
                            ${mediaFieldLabel('image', imageFields.length)} · ${mediaFieldLabel('video', videoFields.length)} · ${mediaFieldLabel('audio', audioFields.length)} · ${promptFields.length ? tr('comfy.acceptsPrompt') : tr('comfy.noPromptField')}
                        </ic-alert>
                        <div class="mini-settings-list">
                            ${settingFields.length ? settingFields.map(f => renderMiniField(f)).join('') : `<ic-empty-state title="${escapeAttr(tr('comfy.otherParamsHere'))}" label="${escapeAttr(tr('comfy.otherParamsHere'))}"></ic-empty-state>`}
                        </div>
                        <ic-button id="runBtn" class="run-btn mini-run" type="button" hierarchy="primary" onclick="onRun()"><ic-icon slot="start" name="play"></ic-icon><span>${tr('comfy.runTest')}</span></ic-button>
                    </div>
                </ic-card>
                <ic-card class="mini-card" data-node="${output.id}" label="${escapeAttr(tr('comfy.output'))}" size="small" style="left:${output.x}px;top:${output.y}px">
                    <span class="mini-port in"></span>
                    <div class="mini-card-head"><ic-icon name="success"></ic-icon><span>${tr('comfy.output')}</span></div>
                    <div class="mini-card-body">${resultHtml}</div>
                </ic-card>
            </div>
        </div>
    `;
    bindMiniCanvas();
}

function renderMiniField(f){
    const label = escapeAttr(f.name || f.input);
    const v = previewValues[f.id] ?? f.default ?? (f.type==='boolean'?false:(f.type==='number'||f.type==='slider'?0:''));
    if(isMediaField(f)){
        const displayUrl = previewImageUrls[f.id] || (typeof v === 'string' && /^(\/|https?:|blob:|data:)/.test(v) ? v : '');
        return `<div class="pfield"><div class="pfield-label">${escapeHtml(f.name || f.input)}</div><div class="mini-image-drop" onclick="pickImage('${f.id}')">${mediaPreviewHtml(fieldKind(f), displayUrl, v, true)}</div></div>`;
    }
    if(f.type === 'textarea'){
        return `<div class="pfield"><ic-textarea name="mini_field_${escapeAttr(f.id)}" label="${label}" value="${escapeAttr(v)}" oninput="setPreviewValue('${f.id}',this.value)"></ic-textarea></div>`;
    }
    if(f.type === 'number'){
        const randomBtn = randomButtonHtml(f);
        return `<div class="pfield"><div class="pfield-random-row ${randomBtn ? 'has-random' : ''}"><ic-number-input name="mini_field_${escapeAttr(f.id)}" label="${label}" value="${escapeAttr(v)}" oninput="setPreviewValue('${f.id}',parseFloat(this.value)||0)"></ic-number-input>${randomBtn}</div></div>`;
    }
    if(f.type === 'slider'){
        const min = f.min ?? 0, max = f.max ?? 10, step = f.step ?? 1;
        return `<div class="pfield"><ic-slider name="mini_field_${escapeAttr(f.id)}" label="${label}" min="${min}" max="${max}" step="${step}" value="${escapeAttr(v)}" value-text="${escapeAttr(v)}" oninput="setPreviewValue('${f.id}',parseFloat(this.value));this.setAttribute('value-text',this.value)"></ic-slider></div>`;
    }
    if(f.type === 'dropdown'){
        const opts = (f.options || []).map(o => `<option value="${escapeAttr(o)}" ${String(v)===String(o)?'selected':''}>${escapeHtml(o)}</option>`).join('');
        return `<div class="pfield"><ic-select name="mini_field_${escapeAttr(f.id)}" label="${label}" onchange="setPreviewValue('${f.id}',this.value)">${opts || `<option value="">${tr('comfy.noOptions')}</option>`}</ic-select></div>`;
    }
    if(f.type === 'boolean'){
        return `<div class="pfield"><ic-switch name="mini_field_${escapeAttr(f.id)}" label="${label}" ${v?'checked':''} onchange="setPreviewValue('${f.id}',this.checked)"></ic-switch></div>`;
    }
    return `<div class="pfield"><ic-input name="mini_field_${escapeAttr(f.id)}" type="text" label="${label}" value="${escapeAttr(v)}" oninput="setPreviewValue('${f.id}',this.value)"></ic-input></div>`;
}

function miniDeleteButton(node){
    return ['prompt','image'].includes(node.type) ? `<ic-icon-button class="mini-delete" type="button" hierarchy="quiet" tone="danger" icon="delete" label="${escapeAttr(tr('common.delete'))}" onclick="removeMiniNode('${node.id}')"></ic-icon-button>` : '';
}

function miniLineBetween(a, b){
    if(!a || !b) return '';
    const x1 = a.x + 230, y1 = a.y + 72, x2 = b.x, y2 = b.y + 72;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx*dx + dy*dy);
    const deg = Math.atan2(dy, dx) * 180 / Math.PI;
    return `<div class="mini-line" style="left:${x1}px;top:${y1}px;width:${len}px;transform:rotate(${deg}deg)"></div>`;
}

function addMiniNode(type){
    const count = miniTestNodes.filter(n => n.type === type).length;
    miniTestNodes.push({
        id:`${type}_${Date.now()}_${Math.random().toString(36).slice(2,5)}`,
        type,
        x:42 + count * 26,
        y:type === 'prompt' ? 86 + count * 170 : 286 + count * 170,
        text:'',
        url:'',
        value:''
    });
    renderWorkspaceView();
}

function removeMiniNode(id){
    miniTestNodes = miniTestNodes.filter(n => n.id !== id);
    renderWorkspaceView();
}

function updateMiniNode(id, key, value){
    const node = miniTestNodes.find(n => n.id === id);
    if(node) node[key] = value;
}

function pickMiniImage(nodeId){
    const node = miniTestNodes.find(n => n.id === nodeId);
    if(node) openMediaUpload({kind:node.type || 'image', nodeId});
}

function bindMiniCanvas(){
    const canvas = document.getElementById('miniCanvas');
    const world = document.getElementById('miniWorld');
    if(!canvas || !world) return;
    const sync = () => { world.style.transform = `translate(${miniView.x}px,${miniView.y}px) scale(${miniView.k})`; };
    canvas.onwheel = e => {
        e.preventDefault();
        const old = miniView.k;
        const next = Math.max(0.45, Math.min(1.8, old * (e.deltaY > 0 ? 0.9 : 1.1)));
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        miniView.x = mx - (mx - miniView.x) * (next / old);
        miniView.y = my - (my - miniView.y) * (next / old);
        miniView.k = next;
        sync();
    };
    canvas.onmousedown = e => {
        if(e.target.closest('ic-input,ic-number-input,ic-select,ic-slider,ic-switch,ic-textarea,ic-button,ic-icon-button,.mini-image-drop')) return;
        const card = e.target.closest('.mini-card');
        if(card && e.target.closest('.mini-card-head')){
            const id = card.dataset.node || card.dataset.card;
            const node = miniTestNodes.find(n => n.id === id);
            const pos = node || miniCards[id] || defaultMiniCards()[id];
            miniDrag = { type:'card', id, sx:e.clientX, sy:e.clientY, ox:pos.x, oy:pos.y };
        } else {
            miniDrag = { type:'pan', sx:e.clientX, sy:e.clientY, ox:miniView.x, oy:miniView.y };
            canvas.classList.add('is-panning');
        }
    };
    window.onmousemove = e => {
        if(!miniDrag) return;
        if(miniDrag.type === 'pan'){
            miniView.x = miniDrag.ox + e.clientX - miniDrag.sx;
            miniView.y = miniDrag.oy + e.clientY - miniDrag.sy;
            sync();
        } else {
            const dx = (e.clientX - miniDrag.sx) / miniView.k;
            const dy = (e.clientY - miniDrag.sy) / miniView.k;
            const node = miniTestNodes.find(n => n.id === miniDrag.id);
            if(node){
                node.x = miniDrag.ox + dx;
                node.y = miniDrag.oy + dy;
            } else {
                miniCards[miniDrag.id] = { x: miniDrag.ox + dx, y: miniDrag.oy + dy };
                currentConfig.mini_cards = miniCards;
            }
            const card = world.querySelector(`[data-node="${miniDrag.id}"],[data-card="${miniDrag.id}"]`);
            if(card){
                const p = node || miniCards[miniDrag.id];
                card.style.left = `${p.x}px`;
                card.style.top = `${p.y}px`;
            }
        }
    };
    window.onmouseup = () => {
        if(miniDrag?.type === 'pan') canvas.classList.remove('is-panning');
        const shouldRefresh = miniDrag?.type === 'card';
        miniDrag = null;
        if(shouldRefresh) renderWorkspaceView();
    };
}

let pendingMediaUpload = null;
function openMediaUpload(request){
    if(!mediaUploadInput) return;
    pendingMediaUpload = request;
    mediaUploadInput.setAttribute('accept', mediaAccept(request.kind || 'image'));
    mediaUploadInput.clear({silent:true});
    mediaUploadInput.open();
}

function pickImage(fieldId){
    const field = currentConfig.fields.find(f => f.id === fieldId);
    const kind = fieldKind(field || {type:'image'});
    openMediaUpload({kind, fieldId});
}

async function uploadSelectedMedia(file, request){
    const kind = request.kind || 'image';
    if(request.fieldId){
        const fieldId = request.fieldId;
        if(previewImageUrls[fieldId]) URL.revokeObjectURL(previewImageUrls[fieldId]);
        previewImageUrls[fieldId] = URL.createObjectURL(file);
        renderPreview();
    } else if(request.nodeId){
        const node = miniTestNodes.find(item => item.id === request.nodeId);
        if(!node) return;
        if(node.url?.startsWith('blob:')) URL.revokeObjectURL(node.url);
        node.url = URL.createObjectURL(file);
        node.name = file.name;
        renderWorkspaceView();
    }
    try {
        const form = new FormData();
        form.append('files', file);
        const data = await fetch('/api/upload', { method:'POST', body:form }).then(r=>r.json());
        const filename = data.files?.[0]?.comfy_name || data.files?.[0]?.filename || file.name;
        if(request.fieldId) previewValues[request.fieldId] = filename;
        if(request.nodeId){
            const node = miniTestNodes.find(item => item.id === request.nodeId);
            if(node) node.value = filename;
        }
    } catch(e){ showError(e, mediaUploadFailedText(kind)); }
}

async function onRun(){
    if(!selectedName || !currentConfig) return;
    const btn = document.getElementById('runBtn');
    if(btn){ btn.loading = true; btn.querySelector('span').textContent = tr('comfy.runningTest'); }
    setStatus(tr('comfy.runningTest'));
    try {
        const baseFields = workspaceMode === 'canvas' ? fieldsFromMiniCanvas() : {...previewValues};
        const runFields = applyActiveRandomValues(baseFields);
        const res = await fetch(`/api/workflows/${encodeURIComponent(selectedName)}/run`, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ fields:runFields, config:currentConfig, client_id:'workflow-test' })
        });
        if(!res.ok) throw new Error((await res.json()).detail || tr('comfy.runFailed'));
        const data = await res.json();
        runResult = data.images?.[0] || null;
        renderPreview();
        renderWorkspaceView();
        setStatus(tr('comfy.runSuccess'));
    } catch(e){
        showError(e, tr('comfy.runFailed'));
    } finally {
        if(btn){ btn.loading = false; btn.querySelector('span').textContent = tr('comfy.runTest'); }
    }
}

function fieldsFromMiniCanvas(){
    const fields = {...previewValues};
    const mediaKinds = ['image','video','audio'];
    const promptFields = currentConfig.fields.filter(f => fieldKind(f) === 'prompt');
    const prompt = miniTestNodes.filter(n => n.type === 'prompt').map(n => n.text || '').filter(Boolean).join('\n\n');
    mediaKinds.forEach(kind => {
        const mediaFields = currentConfig.fields.filter(f => fieldKind(f) === kind);
        const mediaNodes = miniTestNodes.filter(n => n.type === kind && n.value);
        mediaFields.forEach((f, i) => {
            fields[f.id] = mediaNodes[i]?.value || fields[f.id] || '';
        });
    });
    promptFields.forEach(f => {
        fields[f.id] = prompt || fields[f.id] || '';
    });
    return fields;
}

let pendingWorkflowUpload = null;

function openWorkflowUpload(){
    workflowUploadInput.clear({silent:true});
    workflowUploadInput.open();
}

async function onUpload(file){
    try {
        const text = await file.text();
        let workflow;
        try { workflow = JSON.parse(text); }
        catch { setStatus(tr('comfy.invalidJson'), 'danger'); return; }
        const baseName = file.name.replace(/\.json$/i, '');
        pendingWorkflowUpload = {workflow, baseName};
        workflowNameInput.value = baseName;
        workflowNameDialog.show();
    } catch(e){ showError(e, tr('comfy.uploadFailed')); }
}

function cancelWorkflowUpload(){
    pendingWorkflowUpload = null;
    workflowNameDialog.hide('cancel');
}

async function confirmWorkflowUploadName(){
    const inputName = String(workflowNameInput.value || '').trim();
    if(!pendingWorkflowUpload || !inputName){
        workflowNameInput.setAttribute('aria-invalid', 'true');
        return;
    }
    workflowNameInput.removeAttribute('aria-invalid');
    const workflow = pendingWorkflowUpload.workflow;
    const confirmButton = document.getElementById('confirmWorkflowUpload');
    confirmButton.loading = true;
    try {
        const data = await fetch('/api/workflows', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ name:inputName, workflow })
        });
        const result = await data.json();
        if(!data.ok) throw new Error(result.detail || tr('comfy.uploadFailed'));
        await loadList();
        await selectWorkflow(result.name);
        setStatus(tr('comfy.uploaded') + result.name);
        new BroadcastChannel('studio-api').postMessage({ type: 'workflows-changed' });
        pendingWorkflowUpload = null;
        workflowNameDialog.hide('confirm');
    } catch(e){ showError(e, tr('comfy.uploadFailed')); }
    finally { confirmButton.loading = false; }
}

async function onSave(){
    if(!selectedName || !currentConfig) return;
    // 校验
    for(const f of currentConfig.fields){
        if(!f.name || !f.name.trim()){
            setStatus(tf('comfy.saveMissingName', {field:f.input}), 'danger'); return;
        }
    }
    setStatus(tr('comfy.saving'));
    try {
        const res = await fetch(`/api/workflows/${encodeURIComponent(selectedName)}/config`, {
            method:'PUT',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(currentConfig)
        });
        if(!res.ok) throw new Error((await res.json()).detail || tr('comfy.saveFailed'));
        setStatus(tr('comfy.saved'));
        await loadList();
        new BroadcastChannel('studio-api').postMessage({ type: 'workflows-changed' });
    } catch(e){ showError(e, tr('comfy.saveFailed')); }
}

function onDelete(){
    if(!selectedName || isBuiltin) return;
    deleteWorkflowDialog.description = tf('comfy.deleteConfirm', {name: currentConfig.title || selectedName});
    deleteWorkflowDialog.show();
}

async function deleteSelectedWorkflow(){
    if(!selectedName || isBuiltin) return;
    try {
        const res = await fetch(`/api/workflows/${encodeURIComponent(selectedName)}`, { method:'DELETE' });
        if(!res.ok) throw new Error((await res.json()).detail || tr('comfy.deleteFailed'));
        selectedName = '';
        currentWorkflow = null;
        currentConfig = null;
        renderEditor();
        renderPreview();
        renderWorkspaceView();
        await loadList();
        new BroadcastChannel('studio-api').postMessage({ type: 'workflows-changed' });
    } catch(e){ showError(e, tr('comfy.deleteFailed')); }
}

window.addEventListener('message', event => {
    if(event.data?.type === 'studio-theme' && window.StudioTheme) window.StudioTheme.set(event.data.theme);
    if(event.data?.type === 'studio-lang' && window.StudioI18n) window.StudioI18n.set(event.data.lang);
});
window.addEventListener('studio-lang-change', refreshLanguageView);

document.addEventListener('ic-change', event => {
    if(event.target === workflowUploadInput){
        const file = event.detail?.acceptedFiles?.[0];
        if(file) onUpload(file);
        return;
    }
    if(event.target === mediaUploadInput){
        const file = event.detail?.acceptedFiles?.[0];
        const request = pendingMediaUpload;
        pendingMediaUpload = null;
        if(file && request) uploadSelectedMedia(file, request);
    }
});

deleteWorkflowDialog.addEventListener('ic-confirm', async () => {
    deleteWorkflowDialog.confirmLoading = true;
    try {
        await deleteSelectedWorkflow();
    } finally {
        deleteWorkflowDialog.confirmLoading = false;
    }
    await deleteWorkflowDialog.hide('confirm');
});
document.getElementById('workspaceModeTabs')?.addEventListener('ic-change', event => setWorkspaceMode(event.detail?.value));

document.addEventListener('DOMContentLoaded', () => {
    if(window.StudioI18n) StudioI18n.apply();
    loadList();
    loadComfyInstances();
});
