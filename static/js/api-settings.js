let providers = [];
let selectedId = '';
const providerList = document.getElementById('providerList');
const editorTitle = document.getElementById('editorTitle');
const nameInput = document.getElementById('nameInput');
const idInput = document.getElementById('idInput');
const baseInput = document.getElementById('baseInput');
const protocolInput = document.getElementById('protocolInput');
const imageRequestModeInput = document.getElementById('imageRequestModeInput');
const imageEditRouteInput = document.getElementById('imageEditRouteInput');
const nameFormField = document.getElementById('nameFormField');
const baseUrlFormField = document.getElementById('baseUrlFormField');
const keyFormField = document.getElementById('keyFormField');
const keyInput = document.getElementById('keyInput');
const clearSavedKeyBtn = document.getElementById('clearSavedKeyBtn');
const rhFreeKeyInput = document.getElementById('rhFreeKeyInput');
const rhWalletKeyInput = document.getElementById('rhWalletKeyInput');
const rhFreeKeyHint = document.getElementById('rhFreeKeyHint');
const rhWalletKeyHint = document.getElementById('rhWalletKeyHint');
const volcArkKeyHint = document.getElementById('volcArkKeyHint');
const volcAkInput = document.getElementById('volcAkInput');
const volcSkInput = document.getElementById('volcSkInput');
const volcAssetKeyHint = document.getElementById('volcAssetKeyHint');
const volcProjectInput = document.getElementById('volcProjectInput');
const volcRegionInput = document.getElementById('volcRegionInput');
const jimengCliPanel = document.getElementById('jimengCliPanel');
const jimengCliStatus = document.getElementById('jimengCliStatus');
const jimengCredit = document.getElementById('jimengCredit');
const jimengLoginBox = document.getElementById('jimengLoginBox');
const jimengHelpOverlay = document.getElementById('jimengHelpOverlay');
const jimengHelpCommand = document.getElementById('jimengHelpCommand');
const jimengHelpOutput = document.getElementById('jimengHelpOutput');
const codexCliPanel = document.getElementById('codexCliPanel');
const codexCliStatus = document.getElementById('codexCliStatus');
const codexCliInfo = document.getElementById('codexCliInfo');
const codexHelpOverlay = document.getElementById('codexHelpOverlay');
const codexHelpCommand = document.getElementById('codexHelpCommand');
const codexHelpOutput = document.getElementById('codexHelpOutput');
const geminiCliPanel = document.getElementById('geminiCliPanel');
const geminiCliStatus = document.getElementById('geminiCliStatus');
const geminiCliInfo = document.getElementById('geminiCliInfo');
const geminiCliHelpOverlay = document.getElementById('geminiCliHelpOverlay');
const geminiCliHelpCommand = document.getElementById('geminiCliHelpCommand');
const geminiCliHelpOutput = document.getElementById('geminiCliHelpOutput');
const runninghubConfigBlock = document.getElementById('runninghubConfigBlock');
const rhPasteInput = document.getElementById('rhPasteInput');
const rhAppsList = document.getElementById('rhAppsList');
const rhWorkflowsList = document.getElementById('rhWorkflowsList');
const rhAppsCount = document.getElementById('rhAppsCount');
const rhWorkflowsCount = document.getElementById('rhWorkflowsCount');
const settingsContent = document.getElementById('settingsContent');
const providerOnboardingCard = document.getElementById('providerOnboardingHost');
const rhWorkflowEditorOverlay = document.getElementById('rhWorkflowEditorOverlay');
const rhWorkflowEditorSub = document.getElementById('rhWorkflowEditorSub');
const rhWorkflowSaveBtn = document.getElementById('rhWorkflowSaveBtn');
const rhWorkflowEditName = document.getElementById('rhWorkflowEditName');
const rhWorkflowEditNote = document.getElementById('rhWorkflowEditNote');
const rhWorkflowEditorSummary = document.getElementById('rhWorkflowEditorSummary');
const rhWorkflowEditorNodeList = document.getElementById('rhWorkflowEditorNodeList');
const rhWorkflowEditorGraphWrap = document.getElementById('rhWorkflowEditorGraphWrap');
const rhAssetFileInput = document.getElementById('rhAssetFileInput');
let rhWorkflowEditorGraphSvg = document.getElementById('rhWorkflowEditorGraphSvg');
let rhWorkflowEditorZoom = document.getElementById('rhWorkflowEditorZoom');
const imageModelList = document.getElementById('imageModelList');
const chatModelList = document.getElementById('chatModelList');
const videoModelList = document.getElementById('videoModelList');
const modelCategoryTabs = document.getElementById('modelCategoryTabs');
const modelExtensions = document.getElementById('modelExtensions');
const msLoraBlock = document.getElementById('msLoraBlock');
const msLoraList = document.getElementById('msLoraList');
const VOLCENGINE_DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const VOLCENGINE_DEFAULT_PROJECT_NAME = 'default';
const VOLCENGINE_DEFAULT_REGION = 'cn-beijing';
const MS_BUILTIN_IMAGE_MODELS = [
    'Tongyi-MAI/Z-Image-Turbo',
    'Qwen/Qwen-Image-2512',
    'Qwen/Qwen-Image-Edit-2511',
    'black-forest-labs/FLUX.2-klein-9B'
];
const MS_DEFAULT_BASE_URL = 'https://api-inference.modelscope.cn/v1';
const RH_DEFAULT_BASE_URL = 'https://www.runninghub.cn';
const LINGJING_DEFAULT_BASE_URL = 'https://apistudio.vip';
const LINGJING_REGISTER_URL = 'https://apistudio.vip/register?aff=g1CT';
const VIP_GPT_DEFAULT_BASE_URL = 'https://www.vip-gpt.net';
const VIP_GPT_REGISTER_URL = 'https://www.vip-gpt.net/vip-gpt/register?aff=YGMS7BDKNY5Y';
const EXAMPLE_BASE_URL = 'https://api.example.com/v1';
const JIMENG_DEFAULT_IMAGE_MODELS = ['5.0', '5.0Pro', '4.7', '4.6', '4.5', '4.1', '4.0', '3.1', '3.0'];
const JIMENG_DEFAULT_IMAGE_MODEL_NAMES = {'5.0':'5.0 Lite', '5.0Pro':'5.0 Pro'};
const JIMENG_DEFAULT_VIDEO_MODELS = ['seedance2.0fast_vip', 'seedance2.0_vip'];
const JIMENG_LEGACY_IMAGE_MODELS = new Set(['jimeng-image-2k', 'jimeng-image-4k']);
const JIMENG_LEGACY_VIDEO_MODELS = new Set(['jimeng-video-720p', 'jimeng-video-1080p']);
const CODEX_DEFAULT_IMAGE_MODELS = ['gpt-image-2'];
const CODEX_DEFAULT_CHAT_MODELS = ['gpt-5.5'];
const GEMINI_CLI_DEFAULT_IMAGE_MODELS = ['auto'];
const GEMINI_CLI_DEFAULT_CHAT_MODELS = ['auto'];
const CLI_PROTOCOLS = new Set(['jimeng', 'codex', 'gemini-cli']);
const API_PROTOCOLS = ['openai', 'apimart', 'gemini', 'volcengine', 'runninghub', 'jimeng', 'codex', 'gemini-cli'];
const CLI_PROVIDER_PRESETS = {
    jimeng:{id:'jimeng', name:'即梦 CLI', protocol:'jimeng'},
    codex:{id:'codex', name:'GPT CLI', protocol:'codex'},
    'gemini-cli':{id:'gemini-cli', name:'Antigravity CLI', protocol:'gemini-cli'}
};
const ONBOARDING_GUIDES = {
    modelscope:{
        titleKey:'api.msOnboardingTitle',
        descKey:'api.msOnboardingDesc',
        primaryLabelKey:'api.msGetTokenCn',
        secondaryLabelKey:'api.msGetTokenGlobal',
        primaryUrl:'https://www.modelscope.cn/my/access/token',
        secondaryUrl:'https://www.modelscope.ai/my/access/token'
    },
    runninghub:{
        titleKey:'api.rhOnboardingTitle',
        descKey:'api.rhOnboardingDesc',
        primaryLabelKey:'api.rhGetKeyCn',
        secondaryLabelKey:'api.rhGetKeyGlobal',
        primaryUrl:'https://www.runninghub.cn/enterprise-api/consumerApi?inviteCode=rh-v1331',
        secondaryUrl:'https://www.runninghub.ai/enterprise-api/consumerApi?inviteCode=rh-v1331',
        walletPrimaryLabelKey:'api.rhGetWalletKeyCn',
        walletSecondaryLabelKey:'api.rhGetWalletKeyGlobal',
        walletPrimaryUrl:'https://www.runninghub.cn/enterprise-api/sharedApi?inviteCode=rh-v1331',
        walletSecondaryUrl:'https://www.runninghub.ai/enterprise-api/sharedApi?inviteCode=rh-v1331'
    },
    lingjing:{
        titleKey:'api.lingjingOnboardingTitle',
        descKey:'api.lingjingOnboardingDesc',
        primaryLabelKey:'api.lingjingGetApi',
        primaryUrl:LINGJING_REGISTER_URL
    }
};
function applyJimengModelDefaults(item){
    item.image_models = unique([...(item.image_models || []).filter(model => !JIMENG_LEGACY_IMAGE_MODELS.has(String(model || '').trim())), ...JIMENG_DEFAULT_IMAGE_MODELS]);
    item.video_models = unique([...(item.video_models || []).filter(model => !JIMENG_LEGACY_VIDEO_MODELS.has(String(model || '').trim())), ...JIMENG_DEFAULT_VIDEO_MODELS]);
    item.model_names = {...JIMENG_DEFAULT_IMAGE_MODEL_NAMES, ...((item.model_names && typeof item.model_names === 'object') ? item.model_names : {})};
}
function applyCliProtocolDefaults(item, protocol){
    if(!item) return;
    const value = String(protocol || item.protocol || '').toLowerCase();
    if(!CLI_PROTOCOLS.has(value)) return;
    item.base_url = '';
    item.protocol = value;
    if(value === 'jimeng'){
        applyJimengModelDefaults(item);
        item.chat_models = unique(item.chat_models || []);
    } else if(value === 'codex'){
        item.image_models = unique([...(item.image_models || []).filter(model => String(model || '').trim().toLowerCase() !== '$imagegen'), ...CODEX_DEFAULT_IMAGE_MODELS]);
        item.chat_models = unique([...(item.chat_models || []), ...CODEX_DEFAULT_CHAT_MODELS]);
        item.video_models = [];
    } else if(value === 'gemini-cli'){
        item.image_models = unique([...(item.image_models || []), ...GEMINI_CLI_DEFAULT_IMAGE_MODELS]);
        item.chat_models = unique([...(item.chat_models || []), ...GEMINI_CLI_DEFAULT_CHAT_MODELS]);
        item.video_models = [];
    }
}
let rhWorkflowEditorState = { open:false, index:-1, entry:null, config:null, activeNodeId:'', graph:{ k:1, x:0, y:0, w:0, h:0 }, pan:null, bound:false, previewParams:{}, previewRunning:false, previewStatus:'', previewOutputs:[] };
let rhEditorMode = 'workflow';
let rhPendingAssetRequest = null;
let providerDragId = '';
// category: 'allround'（全能）| 'value'（性价比）| 'free'（免费），推荐面板按分组分节展示
const LOCKED_PROTOCOL_APIS = Object.freeze([
    Object.freeze({id:'exellome', name:'EXELLOME', base_url:'https://new.exellome.online', protocol:'apimart', image_request_mode:'openai-video-proxy'}),
    Object.freeze({id:'fhl', name:'FHL', base_url:'https://www.fhl.mom', protocol:'openai', image_request_mode:'openai-responses'}),
]);
function lockedRecommendedApi(itemOrId){
    const id = typeof itemOrId === 'string' ? itemOrId : itemOrId?.id;
    const name = typeof itemOrId === 'string' ? '' : itemOrId?.name;
    const baseUrl = typeof itemOrId === 'string' ? '' : itemOrId?.base_url;
    const normalizedId = String(id || '').trim().toLowerCase();
    const normalizedName = String(name || '').trim().toLowerCase();
    const normalizedBase = String(baseUrl || '').trim().replace(/\/+$/, '').toLowerCase();
    const normalizedHost = (() => {
        try { return new URL(normalizedBase).host.toLowerCase(); } catch(e) { return ''; }
    })();
    return LOCKED_PROTOCOL_APIS.find(api => {
        const apiBase = String(api.base_url || '').trim().replace(/\/+$/, '').toLowerCase();
        const apiHost = (() => {
            try { return new URL(apiBase).host.toLowerCase(); } catch(e) { return ''; }
        })();
        return normalizedId === api.id
            || normalizedName === String(api.name || '').trim().toLowerCase()
            || (apiBase && normalizedBase === apiBase)
            || (apiHost && normalizedHost === apiHost);
    }) || null;
}
function hasLockedRecommendedProtocol(itemOrId){
    return Boolean(lockedRecommendedApi(itemOrId));
}
function applyLockedRecommendedProtocol(item){
    const api = lockedRecommendedApi(item);
    if(!item || !api) return false;
    item.protocol = String(api.protocol || 'openai').toLowerCase();
    item.image_request_mode = normalizeImageRequestMode(api.image_request_mode);
    return true;
}

function tr(key){ return window.StudioI18n ? window.StudioI18n.t(key) : key; }
function trf(key, vars={}){
    let text = tr(key);
    Object.entries(vars).forEach(([name, value]) => {
        text = text.replaceAll(`{${name}}`, String(value ?? ''));
    });
    return text;
}
function setStatus(text, tone='neutral'){
    const message = String(text || '').trim();
    customElements.whenDefined('ic-toast').then(() => {
        if(!message){
            document.querySelector('ic-toast[data-ic-overlay]')?.dismiss();
            return;
        }
        customElements.get('ic-toast')?.notify(message, {tone});
    });
}
function showError(text){ setStatus(text, 'danger'); }
const autoSaveState = {
    phase:'loading',
    dirty:false,
    revision:0,
    queued:false,
    inFlight:null,
    lastError:''
};
const providerVerificationStates = new Map();
function setAutoSavePhase(phase=autoSaveState.phase){
    autoSaveState.phase = phase;
}
function markProviderUnverified(){
    if(selectedId) providerVerificationStates.set(selectedId, 'unverified');
}
function markCurrentProviderVerified(){
    if(selectedId) providerVerificationStates.set(selectedId, 'verified');
    if(!autoSaveState.dirty && autoSaveState.phase !== 'saving') setAutoSavePhase('saved');
}
function markAutoSaveDirty(affectsVerification=false){
    autoSaveState.dirty = true;
    autoSaveState.revision += 1;
    autoSaveState.lastError = '';
    if(affectsVerification){
        markProviderUnverified();
    }
    if(autoSaveState.phase !== 'saving') setAutoSavePhase('unsaved');
}
function validAutoSaveInputs(){
    const item = provider();
    const protocol = String(protocolInput?.value || item?.protocol || '').toLowerCase();
    const value = String(baseInput?.value || '').trim();
    let valid = true;
    if(value && !CLI_PROTOCOLS.has(protocol)){
        try {
            const url = new URL(value);
            valid = url.protocol === 'http:' || url.protocol === 'https:';
        } catch(_) {
            valid = false;
        }
    }
    if(baseInput?.setCustomValidity) baseInput.setCustomValidity(valid ? '' : tr('api.autoSaveInvalidUrl'));
    if(!valid){
        setAutoSavePhase('invalid');
        baseInput?.reportValidity?.();
    }
    return valid;
}
async function commitAutoSave(force=false){
    if(!force && !autoSaveState.dirty) return true;
    if(!validAutoSaveInputs()) return false;
    autoSaveState.queued = true;
    if(autoSaveState.inFlight) return autoSaveState.inFlight;
    autoSaveState.inFlight = (async () => {
        let result = true;
        while(autoSaveState.queued){
            autoSaveState.queued = false;
            const savedRevision = autoSaveState.revision;
            setAutoSavePhase('saving');
            result = await saveProviders({silent:true, expectedRevision:savedRevision});
            if(!result){
                autoSaveState.lastError = autoSaveState.lastError || tr('api.saveFailed');
                setAutoSavePhase('error');
                setStatus(autoSaveState.lastError, 'danger');
                break;
            }
            if(autoSaveState.revision === savedRevision) autoSaveState.dirty = false;
        }
        if(result) setAutoSavePhase(autoSaveState.dirty ? 'unsaved' : 'saved');
        return result;
    })().finally(() => { autoSaveState.inFlight = null; });
    return autoSaveState.inFlight;
}
function requestAutoSave({affectsVerification=false, force=false}={}){
    if(!force) markAutoSaveDirty(affectsVerification);
    return commitAutoSave(force);
}
function autoSaveControl(event){
    return event.target?.closest?.('[data-auto-save]') || null;
}
function handleAutoSaveInput(event){
    const control = autoSaveControl(event);
    if(!control) return;
    if(control === baseInput && baseInput?.setCustomValidity) baseInput.setCustomValidity('');
    markAutoSaveDirty(control.dataset.autoSave === 'connection');
}
function handleAutoSaveFocusOut(event){
    if(!autoSaveControl(event)) return;
    commitAutoSave();
}
function handleAutoSaveKeyDown(event){
    if(event.key !== 'Enter' || !autoSaveControl(event)) return;
    commitAutoSave();
}
function broadcastStudioApiChange(type='providers-changed'){
    const message = { type, updated_at:Date.now() };
    try { new BroadcastChannel('studio-api').postMessage(message); } catch(e) {}
    try { window.parent?.postMessage(message, '*'); } catch(e) {}
    try { window.top?.postMessage(message, '*'); } catch(e) {}
}
function rhEditorSideScrollEl(){
    return rhWorkflowEditorNodeList?.closest?.('.rh-workflow-editor-side') || rhWorkflowEditorNodeList;
}
function captureRhEditorScrollState(){
    const pop = document.getElementById('rhNodePopover');
    const popBody = pop?.querySelector?.('.rh-popover-body');
    const side = rhEditorSideScrollEl();
    return {
        sideTop:side?.scrollTop || 0,
        nodeListTop:rhWorkflowEditorNodeList?.scrollTop || 0,
        graphTop:rhWorkflowEditorGraphWrap?.scrollTop || 0,
        popNodeId:pop?.dataset?.nodeId || '',
        popFieldKey:pop?.dataset?.fieldKey || '',
        popBodyTop:popBody?.scrollTop || 0
    };
}
function restoreRhEditorScrollState(state){
    if(!state) return;
    const restore = () => {
        const side = rhEditorSideScrollEl();
        if(side) side.scrollTop = state.sideTop || 0;
        if(rhWorkflowEditorNodeList) rhWorkflowEditorNodeList.scrollTop = state.nodeListTop || 0;
        if(rhWorkflowEditorGraphWrap) rhWorkflowEditorGraphWrap.scrollTop = state.graphTop || 0;
        const pop = document.getElementById('rhNodePopover');
        const samePopover = pop && (
            (state.popNodeId && pop.dataset.nodeId === state.popNodeId) ||
            (state.popFieldKey && pop.dataset.fieldKey === state.popFieldKey)
        );
        if(samePopover){
            const popBody = pop.querySelector('.rh-popover-body');
            if(popBody) popBody.scrollTop = state.popBodyTop || 0;
        }
    };
    requestAnimationFrame(() => {
        restore();
        requestAnimationFrame(restore);
    });
}
function withRhEditorScrollPreserved(callback){
    const scrollState = captureRhEditorScrollState();
    const result = callback();
    restoreRhEditorScrollState(scrollState);
    return result;
}
function findRhAppFieldRow(key){
    return Array.from(document.querySelectorAll('.rh-app-field-row')).find(el => el.dataset.fieldKey === String(key || ''));
}
function normalizeId(value){
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-').slice(0, 40);
}
// 平台 Key 按 ID 写入设备状态目录中的 api.env；ID 一旦创建就保持稳定，避免改名或中文名称导致 Key 看起来丢失。
function deriveIdFromName(name, existingId){
    if(existingId) return existingId;
    let id = normalizeId(name);
    if(!id){
        id = 'api-' + Math.random().toString(36).slice(2, 8);
    }
    let candidate = id, i = 2;
    while(providers.some(p => p.id === candidate)){
        candidate = `${id}-${i++}`;
    }
    return candidate;
}
function eventControlValue(event, control){
    const nativeControl = event?.composedPath?.().find(node => node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement);
    return nativeControl ? (nativeControl.value || '') : (control?.value || '');
}
function updateIdPreview(event){
    const item = provider();
    if(!item) return;
    const isBuiltin = item.id === 'comfly' || item.id === 'modelscope' || item.id === 'runninghub' || item.id === 'volcengine' || item.id === 'jimeng';
    const id = isBuiltin ? item.id : deriveIdFromName(eventControlValue(event, nameInput), item.id);
    if(nameFormField) nameFormField.setAttribute('hint', trf('api.platformIdHint', {id}));
}
function provider(){
    return visibleProviders().find(item => item.id === selectedId) || visibleProviders()[0] || providers[0];
}
function isProviderTemporarilyHidden(item){
    return false;
}
function visibleProviders(){
    return (providers || []).filter(item => !isProviderTemporarilyHidden(item));
}
function isFixedProvider(itemOrId){
    const id = typeof itemOrId === 'string' ? itemOrId : itemOrId?.id;
    // 即梦 CLI 不再是固定平台：可删除、可排序，未添加则不存在。
    return id === 'modelscope' || id === 'runninghub' || id === 'volcengine';
}
function unique(values){
    const seen = new Set();
    return values.map(v => String(v || '').trim()).filter(v => v && !seen.has(v) && seen.add(v));
}
function normalizeRhEntries(values, kind){
    const seen = new Set();
    return (Array.isArray(values) ? values : []).map(raw => {
        const parsed = parseRunningHubRunRef(raw?.appId || raw?.workflowId || raw?.id || '');
        const id = String(parsed?.id || raw?.id || raw?.appId || raw?.workflowId || '').trim();
        if(!id || seen.has(id)) return null;
        seen.add(id);
        const fallback = trf(kind === 'app' ? 'api.appFallback' : 'api.workflowFallback', {id:id.slice(-6)});
        const entry = {
            id,
            title:String(raw?.title || raw?.name || fallback).trim(),
            note:String(raw?.note || raw?.description || '').trim(),
            thumbnail:String(raw?.thumbnail || '').trim(),
            thumbnailRemoved:raw?.thumbnailRemoved === true,
            enabled:raw?.enabled !== false
        };
        if(raw?.hidden === true) entry.hidden = true;
        if(Array.isArray(raw?.fields)) entry.fields = raw.fields.map(normalizeRhWorkflowField);
        if(raw?.workflowJson && typeof raw.workflowJson === 'object') entry.workflowJson = raw.workflowJson;
        if(raw?.raw && typeof raw.raw === 'object') entry.raw = raw.raw;
        const updatedAt = Number(raw?.updatedAt || 0);
        if(updatedAt > 0) entry.updatedAt = updatedAt;
        if(kind === 'app') entry.appId = id;
        else {
            entry.workflowId = id;
            entry.optionalImageMode = String(raw?.optionalImageMode || 'prune-workflow');
        }
        return entry;
    }).filter(Boolean);
}
function parseRunningHubRunRef(value){
    const text = String(value || '').trim();
    const match = text.match(/\/run\/(ai-app|workflow)\/([0-9A-Za-z_-]+)/i);
    if(match) return { type:match[1].toLowerCase() === 'ai-app' ? 'app' : 'workflow', id:match[2] };
    const numeric = text.match(/^[0-9]{8,}$/);
    if(numeric) return { type:'workflow', id:text };
    return null;
}
function workflowNodeTitle(node){
    return (node?._meta?.title || node?.class_type || node?._class || node?.type || 'Node').toString();
}
function workflowNodeClass(node){
    return (node?.class_type || node?._class || node?.type || '').toString();
}
function workflowNodeCategory(node){
    const text = `${workflowNodeTitle(node)} ${workflowNodeClass(node)}`.toLowerCase();
    if(/text|prompt|clip/.test(text)) return 'prompt';
    if(/lora/.test(text)) return 'lora';
    if(/ksampler|k sampler|sampler|scheduler|guid|cfg/.test(text)) return 'sampler';
    if(/video|movie|mp4|webm|frame/.test(text)) return 'video';
    if(/audio|sound|voice|music|wav|mp3/.test(text)) return 'audio';
    if(/image|mask|resize|scale|crop|photo|picture|preview|save/.test(text)) return 'image';
    return 'misc';
}
function rhWorkflowFieldKey(field){
    return `${field?.nodeId || ''}::${field?.fieldName || ''}`;
}
function rhWorkflowFieldKind(field){
    const type = String(field?.fieldType || '').toUpperCase();
    if(['IMAGE','VIDEO','AUDIO','BOOLEAN','NUMBER','FLOAT','INT','INTEGER','TEXT','SLIDER'].includes(type)){
        if(type === 'FLOAT' || type === 'INT' || type === 'INTEGER') return 'NUMBER';
        return type;
    }
    const key = `${field?.fieldName || ''} ${field?.fieldValue || ''}`.toLowerCase();
    if(/image|img|mask|png|jpg|jpeg|webp/.test(key)) return 'IMAGE';
    if(/video|mp4|webm|mov/.test(key)) return 'VIDEO';
    if(/audio|wav|mp3|voice|sound/.test(key)) return 'AUDIO';
    if(/true|false/.test(key)) return 'BOOLEAN';
    if(/^-?\d+(\.\d+)?$/.test(String(field?.fieldValue || '').trim())) return 'NUMBER';
    return 'TEXT';
}
function rhWorkflowFieldTypeLabel(type){
    const key = ({
        TEXT:'api.fieldText',
        NUMBER:'api.fieldNumber',
        SLIDER:'api.fieldSlider',
        BOOLEAN:'api.fieldBoolean',
        SELECT:'api.fieldSelect',
        IMAGE:'api.fieldImage',
        VIDEO:'api.fieldVideo',
        AUDIO:'api.fieldAudio'
    })[String(type || '').toUpperCase()];
    return key ? tr(key) : type;
}
const RH_EDITOR_KNOWN_FIELD_OPTIONS = {
    sampler_name:['euler','euler_ancestral','heun','dpm_2','dpm_2_ancestral','lms','dpmpp_2m','dpmpp_sde','ddim','uni_pc'],
    sampler:['euler','euler_ancestral','heun','dpm_2','dpm_2_ancestral','lms','dpmpp_2m','dpmpp_sde','ddim','uni_pc'],
    scheduler:['normal','karras','exponential','sgm_uniform','simple','ddim_uniform','beta'],
    ratio:['1:1','16:9','9:16','21:9','9:21','4:3','3:4','4:5','5:4','3:2','2:3'],
    aspectRatio:['1:1','16:9','9:16','4:3','3:4','4:5','5:4','3:2','2:3'],
    resolution:['512','768','1024','1280','1536','2048','1k','2k','4k'],
    size:['512','768','1024','1280','1536','2048'],
    ckpt_name:[],
    unet_name:[],
    lora_name:[]
};
function rhKnownOptionsForField(field){
    const name = String(field?.fieldName || '').trim();
    if(!name) return [];
    if(RH_EDITOR_KNOWN_FIELD_OPTIONS[name]) return RH_EDITOR_KNOWN_FIELD_OPTIONS[name].map(String);
    const hit = Object.keys(RH_EDITOR_KNOWN_FIELD_OPTIONS).find(key => key.toLowerCase() === name.toLowerCase());
    return hit ? RH_EDITOR_KNOWN_FIELD_OPTIONS[hit].map(String) : [];
}
function normalizeRhWorkflowField(field){
    const options = Array.isArray(field?.options)
        ? field.options.map(option => String(option ?? '').trim()).filter(Boolean)
        : String(field?.options || '').split(/\r?\n|,/).map(option => option.trim()).filter(Boolean);
    const knownOptions = options.length ? options : rhKnownOptionsForField(field);
    const fieldType = String(field?.fieldType || rhWorkflowFieldKind(field));
    const normalizedType = fieldType.toUpperCase();
    const savedSource = field?.sourceFromUpstream;
    return {
        id:String(field?.id || rhWorkflowFieldKey(field)),
        nodeId:String(field?.nodeId || ''),
        fieldName:String(field?.fieldName || ''),
        fieldValue:field?.fieldValue == null ? '' : String(field.fieldValue),
        fieldType:knownOptions.length && !['IMAGE','VIDEO','AUDIO','SLIDER'].includes(normalizedType) ? 'SELECT' : fieldType,
        label:String(field?.label || field?.fieldName || ''),
        enabled:field?.enabled === true,
        sourceFromUpstream:savedSource === undefined ? false : savedSource !== false,
        group:String(field?.group || ''),
        note:String(field?.note || ''),
        options:knownOptions,
        random_enabled:field?.random_enabled === true,
        min:field?.min ?? '',
        max:field?.max ?? '',
        step:field?.step ?? '',
        imageOrder:Number(field?.imageOrder || field?.image_order || 0) || 0,
        required:field?.required === true
    };
}
function normalizeFetchedRhWorkflowField(field){
    return {...normalizeRhWorkflowField(field), enabled:true};
}
function rhEditorSortedFields(fields){
    return [...(fields || [])].sort((a, b) => {
        const ak = rhWorkflowFieldKind(a);
        const bk = rhWorkflowFieldKind(b);
        if(ak === 'IMAGE' && bk === 'IMAGE'){
            const ao = Number(a.imageOrder) || 9999;
            const bo = Number(b.imageOrder) || 9999;
            if(ao !== bo) return ao - bo;
        }
        if(ak === 'IMAGE' && bk !== 'IMAGE') return -1;
        if(ak !== 'IMAGE' && bk === 'IMAGE') return 1;
        return String(a.nodeId || '').localeCompare(String(b.nodeId || ''), undefined, {numeric:true}) || String(a.fieldName || '').localeCompare(String(b.fieldName || ''));
    });
}
function rhFiniteNumberValue(value){
    const raw = String(value ?? '').trim();
    return raw && Number.isFinite(Number(raw)) ? raw : '';
}
function rhFreeKeyHintText(item){
    return item?.has_key ? `${tr('api.rhCoinKeySaved')}${item.key_env || tr('api.deviceStatePath')} ${item.key_preview || ''}` : tr('api.rhNoCoinKey');
}
function rhWalletKeyHintText(item){
    return item?.has_wallet_key ? `${tr('api.rhWalletKeySaved')}${item.wallet_key_env || tr('api.deviceStatePath')} ${item.wallet_key_preview || ''}` : tr('api.rhNoWalletKey');
}
function volcengineArkKeyHintText(item){
    return item?.has_key
        ? trf('api.arkKeySaved', {path:item.key_env || 'api.env', preview:item.key_preview || ''})
        : tr('api.noArkKey');
}
function volcengineAssetKeyHintText(item){
    const ak = item?.has_volcengine_access_key ? trf('api.akSaved', {path:item.volcengine_access_key_env || 'api.env', preview:item.volcengine_access_key_preview || ''}) : tr('api.akMissing');
    const sk = item?.has_volcengine_secret_key ? trf('api.skSaved', {path:item.volcengine_secret_key_env || 'api.env', preview:item.volcengine_secret_key_preview || ''}) : tr('api.skMissing');
    return `${ak} · ${sk}`;
}
function isNewUserProvider(item){
    if(!item) return false;
    if(item.id === 'modelscope') return !item.has_key;
    if(item.id === 'runninghub') return !item.has_key && !item.has_wallet_key;
    return false;
}
function isApimartProviderContext(item){
    const baseUrl = String(baseInput?.value || item?.base_url || '').trim().toLowerCase();
    return baseUrl.includes('apimart.ai');
}
function updateApimartDomesticHint(item=provider()){
    const hasKey = Boolean(item?.has_key || (keyInput?.value || '').trim());
    if(baseUrlFormField) baseUrlFormField.setAttribute('hint', providerBaseUrlHintText(item, hasKey));
}
function providerBaseUrlHintText(item, hasKey=false){
    if(item?.id === 'modelscope'){
        return `${tr('api.msChinaEndpoint')}https://api-inference.modelscope.cn/v1 · ${tr('api.msGlobalEndpoint')}https://api-inference.modelscope.ai/v1`;
    }
    if(item?.id === 'runninghub') return `${tr('api.runningHubGlobalEndpoint')}https://www.runninghub.ai`;
    if(item?.id === 'volcengine'){
        return `${tr('api.arkEndpoint')}https://ark.cn-beijing.volces.com/api/v3 · ${tr('api.arkValidationNote')}`;
    }
    if(isApimartProviderContext(item) && hasKey) return `${tr('api.apimartChinaEndpoint')}https://apib.ai`;
    return '';
}
function renderProviderOnboarding(item){
    if(!providerOnboardingCard) return;
    const guide = ONBOARDING_GUIDES[item?.id];
    const visible = Boolean(guide && isNewUserProvider(item));
    providerOnboardingCard.hidden = !visible;
    document.body.classList.toggle('show-provider-onboarding', visible);
    if(!visible){
        providerOnboardingCard.innerHTML = '';
        return;
    }
    if(item.id === 'modelscope'){
        providerOnboardingCard.innerHTML = `
            <ic-card class="provider-onboarding-surface" label="${escapeAttr(tr(guide.titleKey))}" data-provider-onboarding-content>
            <div slot="header" class="provider-onboarding-header">
                <ic-heading class="card-heading" level="3" subtitle="${escapeAttr(tr(guide.descKey))}" data-legal-combination="h3-with-subtitle">${escapeHtml(tr(guide.titleKey))}</ic-heading>
            </div>
            <div class="provider-onboarding-body">
                <div class="provider-onboarding-row">
                    <div class="provider-onboarding-source">
                        <div class="provider-onboarding-source-label">${escapeHtml(tr('api.msTokenLabel'))}</div>
                        <ic-button-group class="provider-onboarding-links" label="${escapeAttr(tr('api.msTokenLabel'))}">
                            <ic-button class="provider-guide-link" hierarchy="secondary" href="${escapeAttr(guide.primaryUrl)}" target="_blank"><ic-icon slot="start" name="link"></ic-icon><span>${escapeHtml(tr(guide.primaryLabelKey))}</span></ic-button>
                            <ic-button class="provider-guide-link" hierarchy="secondary" href="${escapeAttr(guide.secondaryUrl)}" target="_blank"><ic-icon slot="start" name="link"></ic-icon><span>${escapeHtml(tr(guide.secondaryLabelKey))}</span></ic-button>
                        </ic-button-group>
                    </div>
                    <ic-icon class="provider-onboarding-arrow" name="forward" aria-hidden="true"></ic-icon>
                    <ic-input class="provider-onboarding-key-input" name="modelscope_onboarding_key" type="password" label="API Key" value="${escapeAttr(keyInput?.value || '')}" placeholder="${escapeAttr(tr('api.msTokenPlaceholder'))}" data-auto-save="connection" oninput="syncOnboardingKeyInput('standard', eventControlValue(event, this))"></ic-input>
                </div>
            </div>
            </ic-card>
        `;
        return;
    }
    if(item.id === 'runninghub'){
        providerOnboardingCard.innerHTML = `
            <ic-card class="provider-onboarding-surface" label="${escapeAttr(tr(guide.titleKey))}" data-provider-onboarding-content>
            <div slot="header" class="provider-onboarding-header">
                <ic-heading class="card-heading" level="3" subtitle="${escapeAttr(tr(guide.descKey))}" data-legal-combination="h3-with-subtitle">${escapeHtml(tr(guide.titleKey))}</ic-heading>
            </div>
            <div class="provider-onboarding-body">
                <div class="provider-onboarding-section-heading">
                    <div class="onboarding-step-title">${escapeHtml(tr('api.rhOnboardingStep'))}</div>
                    <ic-icon name="info" size="small"></ic-icon>
                </div>
                <div class="provider-onboarding-row">
                    <div class="provider-onboarding-source">
                        <div class="provider-onboarding-source-label">${escapeHtml(tr('api.rhCoinKey'))}</div>
                        <ic-button-group class="provider-onboarding-links" label="${escapeAttr(tr('api.rhCoinKey'))}">
                            <ic-button hierarchy="secondary" href="${escapeAttr(guide.primaryUrl)}" target="_blank"><ic-icon slot="start" name="link"></ic-icon><span>${escapeHtml(tr(guide.primaryLabelKey))}</span></ic-button>
                            <ic-button hierarchy="secondary" href="${escapeAttr(guide.secondaryUrl)}" target="_blank"><ic-icon slot="start" name="link"></ic-icon><span>${escapeHtml(tr(guide.secondaryLabelKey))}</span></ic-button>
                        </ic-button-group>
                    </div>
                    <ic-icon class="provider-onboarding-arrow" name="forward" aria-hidden="true"></ic-icon>
                    <ic-input class="provider-onboarding-key-input" name="runninghub_coin_key" type="password" label="${escapeAttr(tr('api.rhCoinApiKeyRequired'))}" value="${escapeAttr(rhFreeKeyInput?.value || '')}" placeholder="${escapeAttr(tr('api.rhCoinPlaceholder'))}" data-auto-save="connection" oninput="syncOnboardingKeyInput('free', eventControlValue(event, this))"></ic-input>
                </div>
                <ic-divider></ic-divider>
                <div class="provider-onboarding-row">
                    <div class="provider-onboarding-source">
                        <div class="provider-onboarding-source-label">${escapeHtml(tr('api.rhWalletKey'))}</div>
                        <ic-button-group class="provider-onboarding-links" label="${escapeAttr(tr('api.rhWalletKey'))}">
                            <ic-button hierarchy="secondary" href="${escapeAttr(guide.walletPrimaryUrl)}" target="_blank"><ic-icon slot="start" name="link"></ic-icon><span>${escapeHtml(tr(guide.walletPrimaryLabelKey))}</span></ic-button>
                            <ic-button hierarchy="secondary" href="${escapeAttr(guide.walletSecondaryUrl)}" target="_blank"><ic-icon slot="start" name="link"></ic-icon><span>${escapeHtml(tr(guide.walletSecondaryLabelKey))}</span></ic-button>
                        </ic-button-group>
                    </div>
                    <ic-icon class="provider-onboarding-arrow" name="forward" aria-hidden="true"></ic-icon>
                    <ic-input class="provider-onboarding-key-input" name="runninghub_wallet_key" type="password" label="${escapeAttr(tr('api.rhWalletApiKeyOptional'))}" value="${escapeAttr(rhWalletKeyInput?.value || '')}" placeholder="${escapeAttr(tr('api.rhWalletPlaceholder'))}" data-auto-save="connection" oninput="syncOnboardingKeyInput('wallet', eventControlValue(event, this))"></ic-input>
                </div>
            </div>
            </ic-card>
        `;
        return;
    }
}
function syncOnboardingKeyInput(kind, value){
    if(kind === 'free' && rhFreeKeyInput) rhFreeKeyInput.value = value || '';
    else if(kind === 'wallet' && rhWalletKeyInput) rhWalletKeyInput.value = value || '';
    else if(keyInput) keyInput.value = value || '';
}
async function saveOnboardingRunningHubKey(){
    const freeKey = rhFreeKeyInput?.value.trim() || '';
    if(!freeKey){ showError(tr('api.rhEnterCoinAlert')); return; }
    const item = provider();
    if(!item || item.id !== 'runninghub') return;
    syncEditor();
    const ok = await saveProviders();
    if(ok){
        if(rhFreeKeyInput) rhFreeKeyInput.value = '';
        if(rhWalletKeyInput) rhWalletKeyInput.value = '';
    }
}
function applyProviderOnboardingDefaults(id){
    const item = providers.find(provider => provider.id === id);
    if(!item) return;
    if(id === 'modelscope'){
        item.base_url = MS_DEFAULT_BASE_URL;
        item.protocol = 'openai';
        item.image_models = unique([...MS_BUILTIN_IMAGE_MODELS, ...(item.image_models || [])]);
        item.chat_models = unique([...(item.chat_models || [])]);
        item.ms_defaults_version = Math.max(3, Number(item.ms_defaults_version || 0));
    } else if(id === 'runninghub'){
        item.base_url = RH_DEFAULT_BASE_URL;
        item.protocol = 'runninghub';
        item.image_models = unique(item.image_models || []);
        item.chat_models = unique(item.chat_models || []);
        item.video_models = unique(item.video_models || []);
        ensureRunningHubLists(item);
    } else if(id === 'volcengine'){
        item.base_url = VOLCENGINE_DEFAULT_BASE_URL;
        item.protocol = 'volcengine';
        item.video_models = unique(item.video_models || []);
        item.volcengine_project_name = item.volcengine_project_name || VOLCENGINE_DEFAULT_PROJECT_NAME;
        item.volcengine_region = item.volcengine_region || VOLCENGINE_DEFAULT_REGION;
    } else if(id === 'lingjing'){
        item.base_url = item.base_url || LINGJING_DEFAULT_BASE_URL;
        item.protocol = item.protocol || 'openai';
        item.image_request_mode = normalizeImageRequestMode(item.image_request_mode);
    } else if(id === 'jimeng'){
        item.base_url = '';
        item.protocol = 'jimeng';
        applyJimengModelDefaults(item);
    } else if(id === 'codex'){
        applyCliProtocolDefaults(item, 'codex');
    } else if(id === 'gemini-cli'){
        applyCliProtocolDefaults(item, 'gemini-cli');
    }
    selectedId = item.id;
    renderEditor();
    setStatus(tr('api.defaultShown'));
}
function refreshProviderOnboarding(){
    renderProviderOnboarding(provider());
}
function syncEditor(){
    const item = provider();
    if(!item) return;
    const oldId = item.id;
    const isBuiltin = item.id === 'comfly' || item.id === 'modelscope' || item.id === 'runninghub' || item.id === 'volcengine' || item.id === 'jimeng';
    // 内置和自定义平台的 ID 都保持稳定；新建时若没有 ID 才生成一次。
    const nextId = isBuiltin ? item.id : deriveIdFromName(nameInput.value, item.id);
    item.id = nextId;
    if(oldId !== item.id) selectedId = item.id;
    item.name = nameInput.value.trim() || item.id;
    const lockedApi = lockedRecommendedApi(item);
    const selectedProtocol = lockedApi
        ? lockedApi.protocol
        : item.id === 'modelscope'
        ? 'openai'
        : item.id === 'runninghub'
        ? 'runninghub'
        : item.id === 'volcengine'
        ? 'volcengine'
        : (protocolInput?.value || 'openai');
    item.base_url = CLI_PROTOCOLS.has(selectedProtocol) ? '' : baseInput.value.trim();
    // 固定平台不从协议下拉读取
    item.protocol = selectedProtocol;
    item.image_request_mode = normalizeImageRequestMode(
        item.id === 'modelscope' || item.id === 'runninghub' || item.id === 'volcengine' || CLI_PROTOCOLS.has(selectedProtocol)
            ? 'openai'
            : lockedApi
            ? lockedApi.image_request_mode
            : (imageRequestModeInput?.value || item.image_request_mode)
    );
    item.image_edit_route = normalizeImageEditRoute(
        item.id === 'modelscope' || item.id === 'runninghub' || item.id === 'volcengine' || CLI_PROTOCOLS.has(selectedProtocol)
            ? 'general'
            : (imageEditRouteInput?.value || item.image_edit_route)
    );
    item.image_generation_endpoint = '';
    item.image_edit_endpoint = '';
    item.rh_apps = normalizeRhEntries(item.rh_apps || [], 'app');
    item.rh_workflows = normalizeRhEntries(item.rh_workflows || [], 'workflow');
    const key = keyInput.value.trim();
    if(key) item.api_key = key;
    if(item.id === 'runninghub'){
        const freeKey = rhFreeKeyInput?.value.trim() || '';
        const walletKey = rhWalletKeyInput?.value.trim() || '';
        if(freeKey) item.api_key = freeKey;
        if(walletKey) item.wallet_api_key = walletKey;
    }
    if(item.id === 'volcengine'){
        const ak = volcAkInput?.value.trim() || '';
        const sk = volcSkInput?.value.trim() || '';
        if(ak) item.volcengine_access_key_id = ak;
        if(sk) item.volcengine_secret_access_key = sk;
        item.volcengine_project_name = (volcProjectInput?.value.trim() || VOLCENGINE_DEFAULT_PROJECT_NAME);
        item.volcengine_region = (volcRegionInput?.value.trim() || VOLCENGINE_DEFAULT_REGION);
    }
}
function ensureRunningHubLists(item){
    if(!item) return;
    item.rh_apps = normalizeRhEntries(item.rh_apps || [], 'app');
    item.rh_workflows = normalizeRhEntries(item.rh_workflows || [], 'workflow');
}
function updateProtocolFromInput(){
    const item = provider();
    if(!item || !protocolInput || item.id === 'modelscope' || item.id === 'runninghub' || item.id === 'volcengine') return;
    if(applyLockedRecommendedProtocol(item)){
        protocolInput.value = item.protocol;
        if(imageRequestModeInput) imageRequestModeInput.value = item.image_request_mode;
        return;
    }
    const value = String(protocolInput.value || 'openai').toLowerCase();
    item.protocol = API_PROTOCOLS.includes(value) ? value : 'openai';
    if(CLI_PROTOCOLS.has(item.protocol)) item.base_url = '';
    applyCliProtocolDefaults(item, item.protocol);
    document.body.classList.toggle('show-jimeng', item.protocol === 'jimeng');
    document.body.classList.toggle('show-codex', item.protocol === 'codex');
    document.body.classList.toggle('show-gemini-cli', item.protocol === 'gemini-cli');
    // 协议会改变整个表单（如即梦 CLI 账户面板、默认模型、Key 占位）。renderEditor 是唯一切换这些的入口，
    // 这里复跑一次让面板立即出现；保存并恢复 Key 输入框，避免推荐流程里先填的 Key 被 renderEditor 清空。
    const savedKey = keyInput ? keyInput.value : '';
    renderEditor();
    if(keyInput) keyInput.value = savedKey;
    updateApimartDomesticHint(item);
}
function isVolcengineProvider(item){
    return String(item?.protocol || '').toLowerCase() === 'volcengine';
}
function handleRhPasteInput(value){
    const parsed = parseRunningHubRunRef(value);
    if(parsed) setStatus(tr('api.rhPathRecognized'));
}
async function createRhEntryFromPaste(){
    const item = provider();
    if(!item || item.id !== 'runninghub') return;
    const parsed = parseRunningHubRunRef(rhPasteInput?.value || '');
    if(!parsed){ setStatus(tr('api.rhPastePath')); return; }
    ensureRunningHubLists(item);
    const listKey = parsed.type === 'app' ? 'rh_apps' : 'rh_workflows';
    const existingIndex = item[listKey].findIndex(entry => entry.id === parsed.id);
    const exists = existingIndex >= 0 && item[listKey][existingIndex]?.hidden !== true;
    if(existingIndex >= 0 && item[listKey][existingIndex]?.hidden === true){
        item[listKey][existingIndex] = {
            ...item[listKey][existingIndex],
            enabled:true,
            hidden:false
        };
    } else if(!exists){
        item[listKey].unshift({
            id:parsed.id,
            appId:parsed.type === 'app' ? parsed.id : undefined,
            workflowId:parsed.type === 'workflow' ? parsed.id : undefined,
            title:trf(parsed.type === 'app' ? 'api.appFallback' : 'api.workflowFallback', {id:parsed.id.slice(-6)}),
            note:'',
            thumbnail:'',
            enabled:true
        });
    }
    if(rhPasteInput) rhPasteInput.value = '';
    renderRunningHubCards();
    setStatus(tr(exists ? 'api.rhAlreadyExists' : 'api.rhCreating'));
    if(!exists){
        const ok = await saveProviders();
        setStatus(tr(ok ? 'api.rhCreatedSaved' : 'api.rhCreatedSaveFailed'));
    }
}
function updateRhEntry(kind, index, prop, value){
    const item = provider();
    if(!item || item.id !== 'runninghub') return;
    const listKey = kind === 'app' ? 'rh_apps' : 'rh_workflows';
    ensureRunningHubLists(item);
    if(!item[listKey][index]) return;
    item[listKey][index][prop] = value;
    if(prop === 'title') setStatus(tr('api.nameChanged'));
    if(prop === 'note') setStatus(tr('api.noteChanged'));
}
function isStaticRunningHubEntry(kind, entry){
    const id = String((kind === 'app' ? (entry?.appId || entry?.id) : (entry?.workflowId || entry?.id)) || '').trim();
    const thumb = String(entry?.thumbnail || '');
    if(thumb.includes('/static/runninghub/')) return true;
    if(id && thumb.includes(`${kind === 'app' ? 'app' : 'workflow'}-${id}`)) return true;
    // 静态模板会随 /api/providers 合并返回完整字段；手动粘贴的新卡片通常没有这些配置。
    return Array.isArray(entry?.fields) || (entry?.workflowJson && typeof entry.workflowJson === 'object') || (entry?.raw && typeof entry.raw === 'object');
}
async function removeRhEntry(kind, index){
    const item = provider();
    if(!item || item.id !== 'runninghub') return;
    const listKey = kind === 'app' ? 'rh_apps' : 'rh_workflows';
    ensureRunningHubLists(item);
    const entry = item[listKey][index];
    if(!entry) return;
    const entryId = String((kind === 'workflow' ? (entry.workflowId || entry.id) : (entry.appId || entry.id)) || '').trim();
    if(isStaticRunningHubEntry(kind, entry)){
        item[listKey][index] = {
            ...entry,
            enabled:false,
            hidden:true
        };
    } else {
        item[listKey].splice(index, 1);
    }
    renderRunningHubCards();
    setStatus(tr('api.deletedSaving'));
    if(kind === 'workflow' && entryId){
        try {
            await fetch(`/api/runninghub/workflows/${encodeURIComponent(entryId)}`, {method:'DELETE'});
        } catch(_) {}
    }
    const ok = await saveProviders();
    setStatus(tr(ok ? 'api.deletedSaved' : 'api.deletedSaveFailed'));
}
function readFileAsDataUrl(file){
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error(tr('api.readImageFailed')));
        reader.readAsDataURL(file);
    });
}
function loadImageForThumbnail(src){
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(tr('api.parseImageFailed')));
        img.src = src;
    });
}
async function createRhThumbnailDataUrl(file){
    const original = await readFileAsDataUrl(file);
    try {
        const img = await loadImageForThumbnail(original);
        const maxSide = 360;
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width || 1, img.naturalHeight || img.height || 1));
        const width = Math.max(1, Math.round((img.naturalWidth || img.width || 1) * scale));
        const height = Math.max(1, Math.round((img.naturalHeight || img.height || 1) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        return canvas.toDataURL('image/jpeg', 0.78);
    } catch(e) {
        return original;
    }
}
function pickRhThumbnail(kind, index){
    if(!rhAssetFileInput) return;
    const item = provider();
    const listKey = kind === 'app' ? 'rh_apps' : 'rh_workflows';
    const entry = item?.id === 'runninghub' ? item[listKey]?.[index] : null;
    if(!entry) return;
    rhPendingAssetRequest = {mode:'thumbnail', kind, index};
    rhAssetFileInput.setAttribute('accept', 'image/*');
    rhAssetFileInput.setAttribute('label', tr('api.uploadThumbnail'));
    rhAssetFileInput.setAttribute('button-label', tr('api.uploadThumbnail'));
    rhAssetFileInput.clear({silent:true});
    rhAssetFileInput.open();
}
async function removeRhEntryThumbnail(kind, index){
    const item = provider();
    if(!item || item.id !== 'runninghub') return;
    const listKey = kind === 'app' ? 'rh_apps' : 'rh_workflows';
    ensureRunningHubLists(item);
    const entry = item[listKey][index];
    if(!entry) return;
    entry.thumbnail = '';
    entry.thumbnailRemoved = true;
    renderRunningHubCards();
    const ok = await saveProviders({silent:true});
    setStatus(tr(ok ? 'api.deletedSaved' : 'api.deletedSaveFailed'), ok ? 'success' : 'danger');
}
async function openRhWorkflowEditor(index){
    const item = provider();
    if(!item || item.id !== 'runninghub') return;
    ensureRunningHubLists(item);
    const entry = item.rh_workflows[index];
    if(!entry) return;
    rhEditorMode = 'workflow';
    rhWorkflowEditorState = { open:true, index, entry, config:null, activeNodeId:'', graph:{ k:1, x:0, y:0, w:0, h:0 }, pan:null, bound:false, previewParams:{}, previewRunning:false, previewStatus:'', previewOutputs:[] };
    if(rhWorkflowEditorOverlay) await rhWorkflowEditorOverlay.show();
    renderRhWorkflowEditorLoading(tr('api.loadingWorkflow'));
    try {
        await loadRhWorkflowEditorConfig(entry);
    } catch(e) {
        renderRhWorkflowEditorLoading(e.message || tr('api.workflowLoadFailed'));
    }
}
async function openRhAppEditor(index){
    const item = provider();
    if(!item || item.id !== 'runninghub') return;
    ensureRunningHubLists(item);
    const entry = item.rh_apps[index];
    if(!entry) return;
    rhEditorMode = 'app';
    rhWorkflowEditorState = { open:true, index, entry, config:null, activeNodeId:'app', graph:{ k:1, x:0, y:0, w:0, h:0 }, pan:null, bound:false, previewParams:{}, previewRunning:false, previewStatus:'', previewOutputs:[] };
    if(rhWorkflowEditorOverlay) await rhWorkflowEditorOverlay.show();
    renderRhWorkflowEditorLoading(tr('api.loadingAppParams'));
    try {
        await loadRhAppEditorConfig(entry);
    } catch(e) {
        renderRhWorkflowEditorLoading(e.message || tr('api.appParamsLoadFailed'));
    }
}
function closeRhWorkflowEditor(){
    if(rhWorkflowEditorOverlay?.open) void rhWorkflowEditorOverlay.hide('cancel');
    rhWorkflowEditorState.open = false;
}
function renderRhWorkflowEditorLoading(text){
    const title = rhWorkflowEditorState.entry?.title || tr(rhEditorMode === 'app' ? 'api.runningHubApp' : 'api.runningHubWorkflow');
    if(rhWorkflowEditorOverlay) rhWorkflowEditorOverlay.label = title;
    if(rhWorkflowEditName) rhWorkflowEditName.value = rhWorkflowEditorState.entry?.title || '';
    if(rhWorkflowEditNote) rhWorkflowEditNote.value = rhWorkflowEditorState.entry?.note || '';
    if(rhWorkflowEditorSub) rhWorkflowEditorSub.textContent = rhEditorMode === 'app'
        ? `/run/ai-app/${rhWorkflowEditorState.entry?.appId || rhWorkflowEditorState.entry?.id || ''}`
        : `/run/workflow/${rhWorkflowEditorState.entry?.workflowId || rhWorkflowEditorState.entry?.id || ''}`;
    if(rhWorkflowEditorSummary) rhWorkflowEditorSummary.innerHTML = `<ic-loading label="${escapeAttr(text)}"></ic-loading>`;
    if(rhWorkflowEditorNodeList) rhWorkflowEditorNodeList.innerHTML = '';
    if(rhEditorMode === 'workflow') {
        restoreRhGraphWrap();
        if(rhWorkflowEditorGraphSvg) rhWorkflowEditorGraphSvg.innerHTML = '';
    } else if(rhWorkflowEditorGraphWrap) {
        rhWorkflowEditorGraphWrap.classList.remove('rh-editor-graph-wrap');
        rhWorkflowEditorGraphWrap.classList.add('rh-app-field-wrap');
        rhWorkflowEditorGraphWrap.innerHTML = `<ic-loading label="${escapeAttr(text)}"></ic-loading>`;
    }
}
async function loadRhWorkflowEditorConfig(entry){
    let config = null;
    const workflowId = String(entry.workflowId || entry.id || '').trim();
    if(!workflowId) throw new Error(tr('api.workflowIdEmpty'));
    const existing = await fetch(`/api/runninghub/workflows/${encodeURIComponent(workflowId)}`).then(async r => {
        if(r.status === 404) return null;
        const data = await r.json();
        if(!r.ok) throw new Error(data.detail || tr('api.readWorkflowFailed'));
        return data.workflow || null;
    });
    if(existing) {
        config = existing;
    } else {
        config = await fetchRhWorkflowEditor(false);
        return config;
    }
    rhWorkflowEditorState.config = normalizeRhWorkflowConfig(config, entry);
    renderRhWorkflowEditor();
    setTimeout(() => rhEditorGraphFit(), 50);
    return rhWorkflowEditorState.config;
}
function normalizeRhWorkflowConfig(config, entry){
    const workflowId = String(config?.workflowId || entry?.workflowId || entry?.id || '').trim();
    const normalized = {
        workflowId,
        title:String(config?.title || entry?.title || workflowId),
        description:String(config?.description || entry?.note || ''),
        fields:(Array.isArray(config?.fields) ? config.fields : []).map(normalizeRhWorkflowField),
        workflowJson:config?.workflowJson || {},
        optionalImageMode:String(config?.optionalImageMode || entry?.optionalImageMode || 'prune-workflow'),
        raw:config?.raw || {}
    };
    return applyRhImageSlotDefaults(normalized);
}
function normalizeRhAppConfig(entry){
    const appId = String(entry?.appId || entry?.id || '').trim();
    return {
        appId,
        title:String(entry?.title || trf('api.appFallback', {id:appId.slice(-6)}) || appId),
        description:String(entry?.note || ''),
        fields:(Array.isArray(entry?.fields) ? entry.fields : []).map(normalizeRhWorkflowField),
        raw:entry?.raw || {}
    };
}
function applyRhImageSlotDefaults(config){
    const imageFields = (config.fields || []).filter(field => rhWorkflowFieldKind(field) === 'IMAGE');
    imageFields.forEach((field, index) => {
        if(!Number(field.imageOrder)) field.imageOrder = index + 1;
        if(field.required !== true && field.required !== false) field.required = index === 0;
        if(index === 0 && field.required !== false) field.required = true;
    });
    config.optionalImageMode = config.optionalImageMode || 'prune-workflow';
    return config;
}
function setRhWorkflowOptionalImageMode(value){
    const config = rhWorkflowEditorState.config;
    if(!config || rhEditorMode !== 'workflow') return;
    config.optionalImageMode = value || 'prune-workflow';
    withRhEditorScrollPreserved(() => renderRhMappedPreview());
}
function rhAppFieldSourceList(raw){
    const data = raw?.data && typeof raw.data === 'object' ? raw.data : raw;
    const candidates = [
        data?.nodeInfoList,
        data?.fields,
        data?.inputs,
        data?.inputList,
        data?.formItems,
        data?.forms,
        data?.params,
        data?.parameters,
        data?.apiParams,
        data?.config?.fields,
        data?.webapp?.fields,
        data?.webapp?.inputs
    ];
    for(const candidate of candidates){
        if(Array.isArray(candidate) && candidate.length) return candidate;
        if(candidate && typeof candidate === 'object' && Object.keys(candidate).length){
            return Object.entries(candidate).map(([key, value]) => ({fieldName:key, fieldValue:value}));
        }
    }
    return [];
}
function normalizeFetchedRhAppField(field, index=0){
    const name = field?.fieldName || field?.inputName || field?.name || field?.key || field?.paramName || field?.id || `field_${index + 1}`;
    const nodeId = field?.nodeId || field?.node_id || field?.groupId || 'app';
    let value = field?.fieldValue;
    if(value === undefined) value = field?.defaultValue;
    if(value === undefined) value = field?.value;
    if(value === undefined) value = field?.default;
    if(value === undefined || value === null) value = '';
    if(typeof value === 'object') value = JSON.stringify(value);
    const options = extractRhEditorFieldOptions(field);
    return normalizeRhWorkflowField({
        id:field?.id || `${nodeId}::${name}`,
        nodeId,
        fieldName:name,
        fieldValue:value,
        fieldType:field?.fieldType || field?.type || field?.valueType || (options.length ? 'SELECT' : ''),
        label:field?.label || field?.title || field?.name || name,
        enabled:true,
        group:field?.group || field?.category || field?.title || tr('api.appParamGroup'),
        note:field?.note || field?.description || '',
        options,
        min:field?.min ?? '',
        max:field?.max ?? '',
        step:field?.step ?? ''
    });
}
function extractRhEditorFieldOptions(field){
    const candidates = [field?.options, field?.optionList, field?.values, field?.enum, field?.choices, field?.items, field?.list, field?.selectOptions, field?.fieldData];
    for(const candidate of candidates){
        if(!Array.isArray(candidate) || !candidate.length) continue;
        return candidate.map(item => {
            if(item && typeof item === 'object') return item.value ?? item.label ?? item.name ?? item.title;
            return item;
        }).filter(item => item !== undefined && item !== null).map(String);
    }
    const known = rhKnownOptionsForField(field);
    if(known.length) return known;
    return [];
}
async function loadRhAppEditorConfig(entry){
    const config = normalizeRhAppConfig(entry);
    rhWorkflowEditorState.config = config;
    if(!config.fields.length) await fetchRhAppEditor(false);
    else {
        renderRhWorkflowEditor();
        setTimeout(() => rhEditorGraphFit(), 50);
    }
    return rhWorkflowEditorState.config;
}
async function fetchRhAppEditor(force=false){
    const state = rhWorkflowEditorState;
    const entry = state.entry;
    const appId = String(entry?.appId || entry?.id || '').trim();
    if(!appId) throw new Error(tr('api.appIdEmpty'));
    if(force) renderRhWorkflowEditorLoading(tr('api.refetching'));
    const res = await fetch(`/api/runninghub/app-info?webappId=${encodeURIComponent(appId)}`);
    const data = await res.json();
    if(!res.ok || data.success === false) throw new Error(data.detail || tr('api.fetchAppParamsFailed'));
    const fields = rhAppFieldSourceList(data).map(normalizeFetchedRhAppField);
    state.config = {
        appId,
        title:rhWorkflowEditName?.value.trim() || entry.title || trf('api.appFallback', {id:appId.slice(-6)}),
        description:rhWorkflowEditNote?.value.trim() || entry.note || '',
        fields,
        raw:data.data || data
    };
    state.graph = { k:1, x:0, y:0, w:0, h:0 };
    renderRhWorkflowEditor();
    setTimeout(() => rhEditorGraphFit(), 50);
    return state.config;
}
async function fetchRhWorkflowEditor(force=false){
    const state = rhWorkflowEditorState;
    const entry = state.entry;
    if(rhEditorMode === 'app') return fetchRhAppEditor(force);
    if(!entry) return null;
    const workflowId = String(entry.workflowId || entry.id || '').trim();
    if(!workflowId) throw new Error(tr('api.workflowIdEmpty'));
    if(force) renderRhWorkflowEditorLoading(tr('api.refetching'));
    const res = await fetch('/api/runninghub/workflows/fetch', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
            workflowId,
            title:rhWorkflowEditName?.value.trim() || entry.title || workflowId,
            description:rhWorkflowEditNote?.value.trim() || entry.note || ''
        })
    });
    const data = await res.json();
    if(!res.ok || data.success === false) throw new Error(data.detail || tr('api.fetchWorkflowFailed'));
    state.config = normalizeRhWorkflowConfig({
        workflowId:data.data.workflowId,
        title:data.data.title,
        description:data.data.description,
        fields:(data.data.fields || []).map(normalizeFetchedRhWorkflowField),
        workflowJson:data.data.workflowJson || {},
        optionalImageMode:entry.optionalImageMode || 'prune-workflow',
        raw:data.data.raw || {}
    }, entry);
    state.graph = { k:1, x:0, y:0, w:0, h:0 };
    renderRhWorkflowEditor();
    setTimeout(() => rhEditorGraphFit(), 50);
    return state.config;
}
function updateRhWorkflowEditorMeta(prop, value){
    const config = rhWorkflowEditorState.config;
    if(!config) return;
    if(prop === 'title') config.title = value;
    if(prop === 'description') config.description = value;
    withRhEditorScrollPreserved(() => renderRhMappedPreview());
}
function openRhWorkflowNodePopover(nodeId, anchorEl){
    const state = rhWorkflowEditorState;
    state.activeNodeId = String(nodeId || '');
    renderRhWorkflowEditorGraph();
    const freshAnchor = Array.from(document.querySelectorAll('.rh-editor-gnode')).find(el => el.dataset.nodeId === state.activeNodeId) || anchorEl;
    renderRhNodePopover(state.activeNodeId, freshAnchor);
}
function closeRhNodePopover(){
    const popover = document.getElementById('rhNodePopover');
    if(!popover) return;
    popover.hide?.('close');
    popover.remove();
}
function rhEditorDialogRect(){
    const surface = rhWorkflowEditorOverlay?.shadowRoot?.querySelector('[part~="dialog"]');
    const rect = surface?.getBoundingClientRect?.();
    if(rect?.width && rect?.height) return rect;
    return {left:0, top:0, right:window.innerWidth, bottom:window.innerHeight, width:window.innerWidth, height:window.innerHeight};
}
function rhEditorTokenPixels(name){
    const value = getComputedStyle(document.documentElement).getPropertyValue(name);
    return Number.parseFloat(value) || 0;
}
function positionRhEditorPopover(pop, anchorEl){
    const surface = pop?.shadowRoot?.querySelector('[part~="surface"]');
    const anchorRect = anchorEl?.getBoundingClientRect?.();
    if(!surface || !anchorRect) return;
    const modalRect = rhEditorDialogRect();
    const gap = rhEditorTokenPixels('--ui-space-3');
    const inset = rhEditorTokenPixels('--ui-space-4');
    const availableWidth = Math.max(0, modalRect.width - (inset * 2));
    const availableHeight = Math.max(0, modalRect.height - (inset * 2));
    pop.style.setProperty('--rh-popover-max-width', `${availableWidth}px`);
    pop.style.setProperty('--rh-popover-max-height', `${availableHeight}px`);
    const surfaceRect = surface.getBoundingClientRect();
    let left = anchorRect.right + gap;
    if(left + surfaceRect.width > modalRect.right - inset) left = anchorRect.left - surfaceRect.width - gap;
    left = Math.max(modalRect.left + inset, Math.min(left, modalRect.right - surfaceRect.width - inset));
    const visibleHeight = Math.min(surfaceRect.height, availableHeight);
    const top = Math.max(modalRect.top + inset, Math.min(anchorRect.top, modalRect.bottom - visibleHeight - inset));
    pop.style.setProperty('--rh-popover-left', `${left}px`);
    pop.style.setProperty('--rh-popover-top', `${top}px`);
    pop.dataset.positioned = '';
}
function showRhEditorPopover(pop, anchorEl){
    pop.show(anchorEl);
    requestAnimationFrame(() => positionRhEditorPopover(pop, anchorEl));
}
function renderRhNodePopover(nodeId, anchorEl){
    closeRhNodePopover();
    const config = rhWorkflowEditorState.config;
    if(!config) return;
    const fields = (config.fields || []).filter(field => String(field.nodeId) === String(nodeId));
    if(!fields.length) return;
    const pop = document.createElement('ic-popover');
    pop.id = 'rhNodePopover';
    pop.className = 'rh-node-popover';
    pop.dataset.nodeId = String(nodeId || '');
    const workflowNode = config.workflowJson?.[nodeId] || {};
    const title = (workflowNode?._meta?.title || workflowNode?.class_type || fields[0]?.group || `Node #${nodeId}`).toString();
    pop.setAttribute('label', title);
    pop.setAttribute('content', 'interactive');
    pop.setAttribute('dismiss-policy', 'light');
    pop.setAttribute('focus-policy', 'move-into');
    pop.innerHTML = `
        <div class="rh-popover-head">
            <div>
                <strong>${escapeHtml(title)}</strong>
                <span>#${escapeHtml(nodeId)} · ${fields.length}</span>
            </div>
            <ic-icon-button type="button" hierarchy="quiet" icon="close" label="${escapeAttr(tr('common.close'))}" onclick="closeRhNodePopover()"></ic-icon-button>
        </div>
        <div class="rh-popover-body">${fields.map(field => renderRhWorkflowEditorField(field)).join('<ic-divider></ic-divider>')}</div>
    `;
    (rhWorkflowEditorOverlay || document.body).appendChild(pop);
    showRhEditorPopover(pop, anchorEl);
}
function toggleRhWorkflowEditorField(key){
    const config = rhWorkflowEditorState.config;
    if(!config) return;
    withRhEditorScrollPreserved(() => {
        config.fields = (config.fields || []).map(field => {
            if(rhWorkflowFieldKey(field) !== key) return field;
            return {...field, enabled: field.enabled !== true};
        });
        renderRhWorkflowEditor();
        if(rhEditorMode === 'workflow' && rhWorkflowEditorState.activeNodeId) {
            const active = document.querySelector(`.rh-editor-gnode[data-node-id="${rhWorkflowEditorState.activeNodeId}"]`);
            if(active) renderRhNodePopover(rhWorkflowEditorState.activeNodeId, active);
        } else if(rhEditorMode === 'app') {
            const active = findRhAppFieldRow(key);
            if(active) openRhAppFieldPopover(key, active);
        }
    });
}
function updateRhWorkflowEditorField(key, prop, value){
    const config = rhWorkflowEditorState.config;
    if(!config) return;
    config.fields = (config.fields || []).map(field => {
        if(rhWorkflowFieldKey(field) !== key) return field;
        const nextValue = prop === 'imageOrder' ? Math.max(1, Number(value) || 1) : prop === 'required' ? Boolean(value) : value;
        return {...field, [prop]: nextValue};
    });
    if(prop === 'random_enabled' || prop === 'fieldType' || prop === 'required' || prop === 'sourceFromUpstream'){
        withRhEditorScrollPreserved(() => {
            renderRhWorkflowEditor();
            if(rhEditorMode === 'workflow' && rhWorkflowEditorState.activeNodeId) {
                const active = document.querySelector(`.rh-editor-gnode[data-node-id="${rhWorkflowEditorState.activeNodeId}"]`);
                if(active) renderRhNodePopover(rhWorkflowEditorState.activeNodeId, active);
            } else if(rhEditorMode === 'app') {
                const active = findRhAppFieldRow(key);
                if(active) openRhAppFieldPopover(key, active);
            }
        });
    }
}
function setRhWorkflowSaveButtonState(state, text){
    if(!rhWorkflowSaveBtn) return;
    const label = rhWorkflowSaveBtn.querySelector('span');
    rhWorkflowSaveBtn.classList.toggle('is-saved', state === 'saved');
    rhWorkflowSaveBtn.toggleAttribute('loading', state === 'saving');
    rhWorkflowSaveBtn.toggleAttribute('disabled', state === 'saving');
    if(label) label.textContent = text || tr(state === 'saved' ? 'api.savedShort' : state === 'saving' ? 'api.saving' : 'api.save');
    const icon = rhWorkflowSaveBtn.querySelector('ic-icon');
    if(icon) icon.setAttribute('name', state === 'saved' ? 'success' : 'save');
}
async function saveRhWorkflowEditor(){
    const state = rhWorkflowEditorState;
    const config = state.config;
    if(!config){ showError(tr(rhEditorMode === 'app' ? 'api.loadAppFirst' : 'api.loadWorkflowFirst')); return; }
    setRhWorkflowSaveButtonState('saving', tr('api.saving'));
    config.title = rhWorkflowEditName?.value.trim() || config.title || config.workflowId;
    config.description = rhWorkflowEditNote?.value.trim() || config.description || '';
    try {
        if(rhEditorMode === 'app'){
            const item = provider();
            if(item?.id === 'runninghub' && item.rh_apps?.[state.index]){
                const entry = item.rh_apps[state.index];
                entry.title = config.title || entry.title;
                entry.note = config.description || '';
                entry.fields = (config.fields || []).map(normalizeRhWorkflowField);
                entry.raw = config.raw || {};
                renderRunningHubCards();
                await saveProviders();
            }
            setStatus(tr('api.appParamsSaved'), 'success');
            setRhWorkflowSaveButtonState('saved', tr('api.savedShort'));
            setTimeout(() => setRhWorkflowSaveButtonState('idle', tr('api.save')), 1600);
            broadcastStudioApiChange('providers-changed');
            renderRhWorkflowEditor();
            return;
        }
        const res = await fetch(`/api/runninghub/workflows/${encodeURIComponent(config.workflowId)}`, {
            method:'PUT',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                workflowId:config.workflowId,
                title:config.title,
                description:config.description,
                fields:(config.fields || []).map(normalizeRhWorkflowField),
                workflowJson:config.workflowJson || {},
                optionalImageMode:config.optionalImageMode || 'prune-workflow',
                raw:config.raw || {}
            })
        });
        const data = await res.json();
        if(!res.ok || data.success === false) throw new Error(data.detail || tr('api.saveFailed'));
        state.config = normalizeRhWorkflowConfig(data.workflow || config, state.entry);
        const item = provider();
        if(item?.id === 'runninghub' && item.rh_workflows?.[state.index]){
            const entry = item.rh_workflows[state.index];
            entry.title = state.config.title;
            entry.note = state.config.description;
            entry.fields = (state.config.fields || []).map(normalizeRhWorkflowField);
            entry.workflowJson = state.config.workflowJson || {};
            entry.optionalImageMode = state.config.optionalImageMode || 'prune-workflow';
            entry.raw = state.config.raw || {};
            entry.updatedAt = Number(data.workflow?.updatedAt || Date.now());
            renderRunningHubCards();
            await saveProviders();
        }
        setStatus(tr('api.workflowSaved'), 'success');
        setRhWorkflowSaveButtonState('saved', tr('api.savedShort'));
        setTimeout(() => setRhWorkflowSaveButtonState('idle', tr('api.save')), 1600);
        broadcastStudioApiChange('workflows-changed');
        renderRhWorkflowEditor();
    } catch(err) {
        setRhWorkflowSaveButtonState('idle', tr('api.save'));
        showError(err.message || tr('api.saveFailed'));
    }
}
function renderRhWorkflowEditor(){
    const config = rhWorkflowEditorState.config;
    if(!config){ renderRhWorkflowEditorLoading(tr(rhEditorMode === 'app' ? 'api.appParamsNotLoaded' : 'api.workflowNotLoaded')); return; }
    const title = config.title || tr(rhEditorMode === 'app' ? 'api.runningHubApp' : 'api.runningHubWorkflow');
    if(rhWorkflowEditorOverlay) rhWorkflowEditorOverlay.label = title;
    if(rhWorkflowEditorSub) rhWorkflowEditorSub.textContent = rhEditorMode === 'app' ? `/run/ai-app/${config.appId}` : `/run/workflow/${config.workflowId}`;
    if(rhWorkflowEditName) rhWorkflowEditName.value = config.title || '';
    if(rhWorkflowEditNote) rhWorkflowEditNote.value = config.description || '';
    applyRhImageSlotDefaults(config);
    renderRhMappedPreview();
    renderRhEditorSourcePane();
}
function renderRhMappedPreview(){
    const config = rhWorkflowEditorState.config;
    if(!config || !rhWorkflowEditorSummary || !rhWorkflowEditorNodeList) return;
    renderRhWorkflowEditorSummary();
    rhWorkflowEditorNodeList.innerHTML = renderRhMappedPreviewHtml(config);
}
function renderRhMappedPreviewHtml(config){
    const enabledFields = rhEditorSortedFields((config.fields || []).filter(field => field.enabled === true));
    const title = config.title || tr(rhEditorMode === 'app' ? 'api.runningHubApp' : 'api.runningHubWorkflow');
    const mediaCounts = enabledFields.reduce((acc, field) => {
        const kind = rhWorkflowFieldKind(field);
        if(kind === 'IMAGE') acc.image += 1;
        else if(kind === 'VIDEO') acc.video += 1;
        else if(kind === 'AUDIO') acc.audio += 1;
        else acc.setting += 1;
        return acc;
    }, {image:0, video:0, audio:0, setting:0});
    const fieldsHtml = enabledFields.length
        ? enabledFields.map(field => renderRhPreviewControl(field)).join('')
        : `<ic-empty-state title="${escapeAttr(tr('api.previewEmpty'))}" label="${escapeAttr(tr('api.previewEmpty'))}"></ic-empty-state>`;
    const statusHtml = rhWorkflowEditorState.previewStatus
        ? `<ic-alert class="rh-preview-status" tone="${(rhWorkflowEditorState.previewOutputs || []).length ? 'success' : 'neutral'}">${escapeHtml(rhWorkflowEditorState.previewStatus)}</ic-alert>`
        : '';
    const outputsHtml = (rhWorkflowEditorState.previewOutputs || []).length
        ? `<div class="rh-preview-output-list">${rhWorkflowEditorState.previewOutputs.map(url => renderRhPreviewOutput(url)).join('')}</div>`
        : '';
    const workflowOptionsHtml = rhEditorMode === 'workflow' ? `
        <div class="rh-workflow-run-mode">
                <ic-select name="runninghub_optional_image_mode" label="${escapeAttr(tr('api.optionalImageEmpty'))}" onchange="setRhWorkflowOptionalImageMode(this.value)">
                    <option value="prune-workflow" ${String(config.optionalImageMode || 'prune-workflow') === 'prune-workflow' ? 'selected' : ''}>${escapeHtml(tr('api.pruneWorkflow'))}</option>
                    <option value="skip" ${String(config.optionalImageMode || '') === 'skip' ? 'selected' : ''}>${escapeHtml(tr('api.skipField'))}</option>
                </ic-select>
            <small>${escapeHtml(tr('api.optionalImageNote'))}</small>
        </div>
    ` : '';
    return `
        <section class="rh-mapped-preview" aria-label="${escapeAttr(title)}">
            <p class="rh-mapped-stats">${escapeHtml(trf('api.mediaCounts', mediaCounts))}</p>
            <div class="rh-preview-fields">${fieldsHtml}</div>
            ${workflowOptionsHtml}
            <ic-button class="rh-preview-run" type="button" hierarchy="primary" onclick="testRhMappedPreview()" ${rhWorkflowEditorState.previewRunning ? 'loading disabled' : ''}><ic-icon slot="start" name="play"></ic-icon><span>${escapeHtml(tr(rhWorkflowEditorState.previewRunning ? 'api.testing' : 'api.test'))}</span></ic-button>
            ${statusHtml}
            ${outputsHtml}
        </section>
    `;
}
function renderRhPreviewOutput(url){
    const safe = escapeAttr(url || '');
    if(/\.(mp4|webm|mov|m4v)(\?|$)/i.test(safe)) return `<ic-media-container kind="video" label="${escapeAttr(tr('api.fieldVideo'))}" aspect="landscape" fit="contain"><video src="${safe}" controls muted playsinline preload="metadata"></video></ic-media-container>`;
    if(/\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)/i.test(safe)) return `<ic-media-container kind="audio" label="${escapeAttr(tr('api.fieldAudio'))}"><audio src="${safe}" controls preload="metadata"></audio></ic-media-container>`;
    return `<ic-media-container kind="image" label="${escapeAttr(tr('api.fieldImage'))}" aspect="landscape" fit="contain"><img src="${safe}" alt=""></ic-media-container>`;
}
function renderRhPreviewControl(field){
    const key = rhWorkflowFieldKey(field);
    const label = escapeHtml(field.label || field.fieldName);
    const kind = rhWorkflowFieldKind(field);
    const previewState = rhWorkflowEditorState.previewParams[key] || {};
    if(field.sourceFromUpstream === false && !['IMAGE','VIDEO','AUDIO'].includes(kind)){
        return `<div class="rh-preview-field keep-original"><div class="rh-preview-label">${label}</div><p class="rh-preview-keep"><ic-icon name="lock" size="small"></ic-icon><span>${escapeHtml(tr('api.keepWorkflowSetting'))}</span></p></div>`;
    }
    const randomActive = field.random_enabled === true && previewState.randomActive !== false;
    const value = previewState.value ?? field.fieldValue ?? '';
    const options = Array.isArray(field.options) ? field.options : [];
    if(['IMAGE','VIDEO','AUDIO'].includes(kind)){
        const slot = rhEditorMode === 'workflow' && kind === 'IMAGE'
            ? `<span class="rh-preview-slot">${escapeHtml(trf('api.imageSlot', {number:Number(field.imageOrder) || 1, requirement:tr(field.required === true ? 'api.required' : 'api.optional')}))}</span>`
            : '';
        if(kind === 'IMAGE'){
            const frameState = previewState.uploading ? 'uploading' : previewState.url ? 'normal' : 'upload';
            const imageAttributes = previewState.url
                ? ` src="${escapeAttr(previewState.url)}" alt="${escapeAttr(previewState.name || label)}"`
                : '';
            const progressAttribute = previewState.uploading ? ' progress="0"' : '';
            return `<div class="rh-preview-field"><div class="rh-preview-label">${label}${slot}</div><ic-image-frame class="rh-preview-image-frame" data-rh-preview-key="${escapeAttr(key)}" data-rh-preview-kind="IMAGE" label="${escapeAttr(label)}" state="${frameState}" size="medium" upload-button-label="${escapeAttr(tr('api.clickUpload'))}"${imageAttributes}${progressAttribute}></ic-image-frame></div>`;
        }
        const mediaState = previewState.uploading ? 'uploading' : previewState.url ? 'ready' : 'empty';
        const mediaKind = kind.toLowerCase();
        const mediaAttributes = previewState.url ? ` src="${escapeAttr(previewState.url)}" name="${escapeAttr(previewState.name || value || label)}"` : '';
        const progressAttribute = previewState.uploading ? ' progress="0"' : '';
        return `<div class="rh-preview-field"><div class="rh-preview-label">${label}${slot}</div><ic-media-slot class="rh-preview-media-input" kind="${mediaKind}" state="${mediaState}" label="${escapeAttr(label)}" data-rh-preview-key="${escapeAttr(key)}" data-rh-preview-kind="${kind}"${mediaAttributes}${progressAttribute}></ic-media-slot></div>`;
    }
    if(kind === 'BOOLEAN'){
        const on = String(value).toLowerCase() === 'true';
        return `<div class="rh-preview-field"><ic-switch name="runninghub_preview_${escapeAttr(key)}" label="${escapeAttr(label)}" ${on ? 'checked' : ''} onchange="updateRhPreviewValue('${escapeAttr(key)}', String(this.checked))"></ic-switch></div>`;
    }
    if(kind === 'SLIDER'){
        const min = Number.isFinite(Number(field.min)) ? Number(field.min) : 0;
        const max = Number.isFinite(Number(field.max)) && Number(field.max) > min ? Number(field.max) : 1;
        const step = Number.isFinite(Number(field.step)) && Number(field.step) > 0 ? Number(field.step) : 0.01;
        const rawValue = Number.isFinite(Number(value)) ? Number(value) : min;
        const clampedValue = Math.max(min, Math.min(max, rawValue));
        const numericValue = Math.min(max, min + (Math.round((clampedValue - min) / step) * step));
        return `<div class="rh-preview-field"><ic-slider name="runninghub_preview_${escapeAttr(key)}" label="${escapeAttr(label)}" min="${escapeAttr(min)}" max="${escapeAttr(max)}" step="${escapeAttr(step)}" value="${escapeAttr(numericValue)}" value-text="${escapeAttr(numericValue)}" oninput="updateRhPreviewValue('${escapeAttr(key)}', this.value); this.setAttribute('value-text', this.value)"></ic-slider></div>`;
    }
    if(options.length || kind === 'SELECT'){
        const choices = options.length ? options : [value || tr('api.option')];
        return `<div class="rh-preview-field"><ic-select name="runninghub_preview_${escapeAttr(key)}" label="${escapeAttr(label)}" disabled>${choices.map((option, index) => `<option value="${escapeAttr(String(option || `option-${index + 1}`))}" ${String(option) === String(value) ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</ic-select></div>`;
    }
    const randomControl = kind === 'NUMBER' && field.random_enabled
        ? `<ic-switch class="rh-preview-random-control" name="runninghub_preview_${escapeAttr(key)}_random" label="${escapeAttr(tr('api.random'))}" ${randomActive ? 'checked' : ''} onchange="setRhPreviewRandom('${escapeAttr(key)}', this.checked)"></ic-switch>`
        : '';
    const disabled = randomActive ? 'disabled' : '';
    const control = kind === 'NUMBER'
        ? `<ic-number-input class="${randomControl ? 'rh-preview-random-input' : ''}" name="runninghub_preview_${escapeAttr(key)}" label="${escapeAttr(label)}" value="${escapeAttr(rhFiniteNumberValue(value))}" ${disabled} oninput="updateRhPreviewValue('${escapeAttr(key)}', this.value)"></ic-number-input>`
        : `<ic-input name="runninghub_preview_${escapeAttr(key)}" label="${escapeAttr(label)}" type="text" value="${escapeAttr(value)}" ${disabled} oninput="updateRhPreviewValue('${escapeAttr(key)}', this.value)"></ic-input>`;
    const sharedLabel = randomControl ? `<div class="rh-preview-label">${label}</div>` : '';
    return `<div class="rh-preview-field">${sharedLabel}<div class="rh-preview-random-row ${randomControl ? 'has-random' : ''}">${control}${randomControl}</div></div>`;
}
function renderRhPreviewMedia(url, kind, name=''){
    const safe = escapeAttr(url || '');
    const mediaLabel = name || tr(kind === 'VIDEO' ? 'api.fieldVideo' : kind === 'AUDIO' ? 'api.fieldAudio' : 'api.fieldImage');
    if(kind === 'VIDEO') return `<ic-media-container class="rh-preview-media" kind="video" label="${escapeAttr(mediaLabel)}" aspect="landscape" fit="contain"><video src="${safe}" muted preload="metadata" playsinline controls></video></ic-media-container>`;
    if(kind === 'AUDIO') return `<ic-media-container class="rh-preview-media" kind="audio" label="${escapeAttr(mediaLabel)}"><audio src="${safe}" controls preload="metadata"></audio><span slot="caption">${escapeHtml(mediaLabel)}</span></ic-media-container>`;
    return `<ic-media-container class="rh-preview-media" kind="image" label="${escapeAttr(mediaLabel)}" aspect="landscape" fit="contain"><img src="${safe}" alt=""></ic-media-container>`;
}
function mediaAcceptForRhKind(kind){
    if(kind === 'VIDEO') return 'video/*';
    if(kind === 'AUDIO') return 'audio/*';
    return 'image/*';
}
async function pickRhPreviewMedia(key, kind){
    if(!rhAssetFileInput) return;
    rhPendingAssetRequest = {mode:'preview', key, kind};
    rhAssetFileInput.setAttribute('accept', mediaAcceptForRhKind(kind));
    rhAssetFileInput.setAttribute('label', tr('api.clickUpload'));
    rhAssetFileInput.setAttribute('button-label', tr('api.clickUpload'));
    rhAssetFileInput.clear({silent:true});
    rhAssetFileInput.open();
}
async function handleRhPreviewMediaFile(key, kind, file){
    if(!file) return;
    const localUrl = URL.createObjectURL(file);
    rhWorkflowEditorState.previewParams[key] = {...(rhWorkflowEditorState.previewParams[key] || {}), url:localUrl, name:file.name, uploading:true};
    renderRhMappedPreview();
    const form = new FormData();
    form.append('files', file);
    try {
        const data = await fetch('/api/ai/upload', {method:'POST', body:form}).then(async r => {
            const json = await r.json();
            if(!r.ok) throw new Error(json.detail || tr('api.uploadFailed'));
            return json;
        });
        const uploaded = data.files?.[0];
        rhWorkflowEditorState.previewParams[key] = {
            ...(rhWorkflowEditorState.previewParams[key] || {}),
            url:uploaded?.url || localUrl,
            name:uploaded?.name || file.name,
            kind:uploaded?.kind || kind.toLowerCase(),
            uploading:false
        };
        withRhEditorScrollPreserved(() => renderRhMappedPreview());
    } catch(err) {
        rhWorkflowEditorState.previewParams[key] = {...(rhWorkflowEditorState.previewParams[key] || {}), uploading:false};
        withRhEditorScrollPreserved(() => renderRhMappedPreview());
        showError(err.message || tr('api.uploadFailed'));
    }
}
function removeRhPreviewImage(key){
    const state = rhWorkflowEditorState.previewParams[key] || {};
    if(String(state.url || '').startsWith('blob:')) URL.revokeObjectURL(state.url);
    rhWorkflowEditorState.previewParams[key] = {...state, url:'', name:'', uploading:false};
    withRhEditorScrollPreserved(() => renderRhMappedPreview());
}
async function handleRhAssetFile(file){
    const request = rhPendingAssetRequest;
    rhPendingAssetRequest = null;
    if(!file || !request) return;
    if(request.mode === 'preview'){
        await handleRhPreviewMediaFile(request.key, request.kind, file);
        return;
    }
    if(request.mode !== 'thumbnail') return;
    try {
        const thumbnail = await createRhThumbnailDataUrl(file);
        const item = provider();
        const listKey = request.kind === 'app' ? 'rh_apps' : 'rh_workflows';
        const entry = item?.id === 'runninghub' ? item[listKey]?.[request.index] : null;
        if(!entry) return;
        entry.thumbnail = thumbnail;
        entry.thumbnailRemoved = false;
        renderRunningHubCards();
        const ok = await saveProviders({silent:true});
        setStatus(tr(ok ? 'api.thumbnailUpdated' : 'api.saveFailed'), ok ? 'success' : 'danger');
    } catch(e) {
        showError(e.message || tr('api.thumbnailUploadFailed'));
    }
}
function setRhPreviewRandom(key, active){
    const state = rhWorkflowEditorState.previewParams[key] || {};
    const field = (rhWorkflowEditorState.config?.fields || []).find(item => rhWorkflowFieldKey(item) === key);
    rhWorkflowEditorState.previewParams[key] = {
        ...state,
        value:state.value ?? field?.fieldValue ?? '',
        randomActive:Boolean(active)
    };
    withRhEditorScrollPreserved(() => renderRhMappedPreview());
}
function updateRhPreviewValue(key, value){
    const state = rhWorkflowEditorState.previewParams[key] || {};
    rhWorkflowEditorState.previewParams[key] = {...state, value, randomActive:false};
}
function rhPreviewRandomValue(field){
    const isFloat = Number(field.step) > 0 && Number(field.step) < 1;
    let min = Number.isFinite(Number(field.min)) ? Number(field.min) : null;
    let max = Number.isFinite(Number(field.max)) ? Number(field.max) : null;
    const name = `${field.fieldName || ''} ${field.label || ''}`.toLowerCase();
    const looksSeed = name.includes('seed') || name.includes('noise') || name.includes('随机') || name.includes('种子');
    if(min === null) min = looksSeed ? 1 : 0;
    if(max === null || max <= min) max = looksSeed ? 4294967295 : 999999;
    if(looksSeed) max = Math.min(max, 4294967295);
    const value = min + Math.random() * (max - min);
    if(isFloat){
        const precision = Math.min(8, Math.max(1, String(field.step).split('.')[1]?.length || 2));
        return Number(value.toFixed(precision));
    }
    return Math.floor(value);
}
async function rhPreviewUploadValueIfNeeded(value){
    const text = String(value || '').trim();
    if(!text) return '';
    if(!/^https?:\/\//i.test(text) && !text.startsWith('/assets/')) return text;
    const res = await fetch('/api/runninghub/upload-asset', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({url:text})
    });
    const data = await res.json();
    if(!res.ok || data.success === false) throw new Error(data.detail || data.error || tr('api.rhAssetUploadFailed'));
    return data.data?.fileName || text;
}
async function buildRhPreviewNodeInfoList(){
    const config = rhWorkflowEditorState.config;
    const fields = rhEditorSortedFields((config?.fields || []).filter(field => field.enabled === true));
    const imageFields = fields.filter(field => rhWorkflowFieldKind(field) === 'IMAGE');
    const imageSlotPreview = {};
    const imageIndexPreview = {};
    imageFields.forEach((field, index) => {
        const key = rhWorkflowFieldKey(field);
        const slot = Number(field.imageOrder) || 1;
        const preview = rhWorkflowEditorState.previewParams[key] || {};
        if((preview.url || preview.value) && !imageSlotPreview[slot]) imageSlotPreview[slot] = preview;
        if((preview.url || preview.value) && !imageIndexPreview[index]) imageIndexPreview[index] = preview;
    });
    const result = [];
    for(const field of fields){
        const key = rhWorkflowFieldKey(field);
        const kind = rhWorkflowFieldKind(field);
        if(field.sourceFromUpstream === false && !['IMAGE','VIDEO','AUDIO'].includes(kind)) continue;
        const ownPreview = rhWorkflowEditorState.previewParams[key] || {};
        const imageIndex = kind === 'IMAGE' ? imageFields.findIndex(item => rhWorkflowFieldKey(item) === key) : -1;
        const preview = kind === 'IMAGE'
            ? (ownPreview.url || ownPreview.value ? ownPreview : (imageSlotPreview[Number(field.imageOrder) || 1] || imageIndexPreview[imageIndex] || ownPreview))
            : ownPreview;
        let value = preview.value ?? field.fieldValue ?? '';
        if(['IMAGE','VIDEO','AUDIO'].includes(kind)){
            if(rhEditorMode === 'workflow' && kind === 'IMAGE' && field.required !== true && !preview.url) continue;
            if(rhEditorMode === 'workflow' && kind === 'IMAGE' && field.required === true && !preview.url && !value) throw new Error(trf('api.requiredImageMissing', {name:field.label || field.fieldName}));
            value = await rhPreviewUploadValueIfNeeded(preview.url || value);
        } else if(kind === 'NUMBER' && field.random_enabled === true && preview.randomActive !== false) {
            value = rhPreviewRandomValue(field);
        } else if(['NUMBER','SLIDER'].includes(kind) && String(value ?? '').trim() !== '' && !Number.isNaN(Number(value))) {
            value = Number(value);
        }
        // TEXT 自由文本要保留换行（多行提示词不能被截断成第一行）；其它单值字段才去换行。
        if(typeof value === 'string' && kind !== 'TEXT' && /[\r\n]/.test(value)) value = value.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0] || '';
        result.push({nodeId:field.nodeId, fieldName:field.fieldName, fieldValue:value});
    }
    return result;
}
function rhPreviewPruneWorkflow(nodeInfoList){
    const config = rhWorkflowEditorState.config;
    if(rhEditorMode !== 'workflow' || (config?.optionalImageMode || 'prune-workflow') !== 'prune-workflow') return null;
    const submitted = new Set((nodeInfoList || []).map(item => rhWorkflowFieldKey(item)));
    const missing = rhEditorSortedFields(config.fields || []).filter(field => field.enabled === true && rhWorkflowFieldKind(field) === 'IMAGE' && field.required !== true && !submitted.has(rhWorkflowFieldKey(field)));
    if(!missing.length || !config.workflowJson) return null;
    const workflow = JSON.parse(JSON.stringify(config.workflowJson));
    const removeIds = new Set();
    missing.forEach(field => {
        const node = workflow[String(field.nodeId)];
        if(node?.inputs && Object.prototype.hasOwnProperty.call(node.inputs, field.fieldName)) delete node.inputs[field.fieldName];
        if(node?.inputs && !Object.keys(node.inputs).length) removeIds.add(String(field.nodeId));
    });
    removeIds.forEach(id => delete workflow[id]);
    Object.values(workflow).forEach(node => {
        Object.entries(node?.inputs || {}).forEach(([name, value]) => {
            if(Array.isArray(value) && removeIds.has(String(value[0]))) delete node.inputs[name];
        });
    });
    return workflow;
}
async function testRhMappedPreview(){
    const config = rhWorkflowEditorState.config;
    if(!config || rhWorkflowEditorState.previewRunning) return;
    rhWorkflowEditorState.previewRunning = true;
    rhWorkflowEditorState.previewStatus = tr('api.submittingRh');
    rhWorkflowEditorState.previewOutputs = [];
    renderRhMappedPreview();
    try {
        const nodeInfoList = await buildRhPreviewNodeInfoList();
        const endpoint = rhEditorMode === 'workflow' ? '/api/runninghub/workflow-submit' : '/api/runninghub/submit';
        const workflow = rhPreviewPruneWorkflow(nodeInfoList);
        const body = rhEditorMode === 'workflow'
            ? {workflowId:String(config.workflowId || '').trim(), nodeInfoList, ...(workflow ? {workflow} : {})}
            : {webappId:String(config.appId || '').trim(), nodeInfoList};
        if(rhEditorMode === 'workflow' && !body.workflowId) throw new Error(tr('api.workflowIdEmpty'));
        if(rhEditorMode === 'app' && !body.webappId) throw new Error(tr('api.webappIdEmpty'));
        const submit = await fetch(endpoint, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(body)
        }).then(async r => {
            const data = await r.json();
            if(!r.ok || data.success === false) throw new Error(data.detail || data.error || tr('api.rhSubmitFailed'));
            return data.data || data;
        });
        const taskId = submit.taskId;
        if(!taskId) throw new Error(tr('api.rhNoTaskId'));
        rhWorkflowEditorState.previewStatus = trf('api.taskSubmitted', {id:taskId});
        renderRhMappedPreview();
        let result = null;
        for(let i = 0; i < 720; i++){
            await new Promise(resolve => setTimeout(resolve, 2500));
            const data = await fetch(`/api/runninghub/query?taskId=${encodeURIComponent(taskId)}`).then(async r => {
                const json = await r.json();
                if(!r.ok || json.success === false) throw new Error(json.detail || json.error || tr('api.rhQueryFailed'));
                return json.data || json;
            });
            if(data.status === 'SUCCESS'){
                result = data;
                break;
            }
            if(data.status === 'FAILED') throw new Error(data.failReason || tr('api.rhTaskFailed'));
            rhWorkflowEditorState.previewStatus = tr(data.status === 'QUEUED' ? 'api.queued' : 'api.running');
            renderRhMappedPreview();
        }
        if(!result) throw new Error(tr('api.rhTimeout'));
        const outputs = result.urls || [];
        if(!outputs.length) throw new Error(tr('api.rhNoOutputs'));
        rhWorkflowEditorState.previewOutputs = outputs;
        rhWorkflowEditorState.previewStatus = tr('api.testComplete');
        setStatus(tr('api.rhTestComplete'), 'success');
    } catch(err) {
        rhWorkflowEditorState.previewStatus = err.message || String(err);
        setStatus(rhWorkflowEditorState.previewStatus);
        showError(rhWorkflowEditorState.previewStatus);
    } finally {
        rhWorkflowEditorState.previewRunning = false;
        renderRhMappedPreview();
    }
}
function renderRhEditorSourcePane(){
    if(rhEditorMode === 'app') renderRhAppFieldCards();
    else renderRhWorkflowEditorGraph();
}
function renderRhWorkflowEditorSummary(){
    const config = rhWorkflowEditorState.config;
    if(!config || !rhWorkflowEditorSummary) return;
    const fields = config.fields || [];
    const enabled = fields.filter(field => field.enabled === true).length;
    const nodes = rhEditorMode === 'app' ? 1 : Object.keys(config.workflowJson || {}).length;
    const imageFields = fields.filter(field => field.enabled === true && rhWorkflowFieldKind(field) === 'IMAGE');
    const optionalImages = imageFields.filter(field => field.required !== true).length;
    rhWorkflowEditorSummary.innerHTML = `
        <dl>
            <div><dt>${escapeHtml(tr(rhEditorMode === 'app' ? 'api.app' : 'api.node'))}</dt><dd>${nodes}</dd></div>
            <div><dt>${escapeHtml(tr('api.fields'))}</dt><dd>${enabled} / ${fields.length}</dd></div>
            ${rhEditorMode === 'workflow' ? `<div><dt>${escapeHtml(tr('api.optionalImages'))}</dt><dd>${optionalImages} / ${imageFields.length}</dd></div>` : ''}
        </dl>
    `;
}
function renderRhWorkflowEditorField(field){
    const key = rhWorkflowFieldKey(field);
    const checked = field.enabled === true;
    const type = rhWorkflowFieldKind(field);
    const optionsText = Array.isArray(field.options) ? field.options.join('\n') : '';
    const randomOn = field.random_enabled === true;
    const keepOriginal = field.sourceFromUpstream === false;
    const imageSlotControls = rhEditorMode === 'workflow' && type === 'IMAGE' ? `
        <div class="rh-image-slot-row">
            <ic-number-input name="runninghub_${escapeAttr(key)}_image_order" label="${escapeAttr(tr('api.order'))}" min="1" step="1" value="${escapeAttr(field.imageOrder || '')}" oninput="updateRhWorkflowEditorField('${escapeAttr(key)}','imageOrder',this.value)"></ic-number-input>
            <ic-switch class="rh-editor-required" name="runninghub_${escapeAttr(key)}_required" label="${escapeAttr(tr('api.required'))}" ${field.required === true ? 'checked' : ''} onchange="updateRhWorkflowEditorField('${escapeAttr(key)}','required',this.checked)"></ic-switch>
        </div>
    ` : '';
    return `
        <div class="rh-editor-field-panel ${checked ? 'active' : ''}">
            <ic-switch class="rh-editor-enabled" name="runninghub_${escapeAttr(key)}_enabled" label="${escapeAttr(tr(checked ? 'api.disableField' : 'api.enableField'))}" ${checked ? 'checked' : ''} onchange="toggleRhWorkflowEditorField('${escapeAttr(key)}')"></ic-switch>
            <div class="rh-editor-field-main">
                <ic-switch class="rh-editor-keep" name="runninghub_${escapeAttr(key)}_keep_original" label="${escapeAttr(tr(keepOriginal ? 'api.keepWorkflowSetting' : 'api.exposeOverride'))}" ${keepOriginal ? 'checked' : ''} onchange="updateRhWorkflowEditorField('${escapeAttr(key)}','sourceFromUpstream',!this.checked)"></ic-switch>
                <div class="rh-editor-field-controls">
                    <ic-input name="runninghub_${escapeAttr(key)}_label" label="${escapeAttr(tr('api.name'))}" type="text" value="${escapeAttr(field.label || '')}" oninput="updateRhWorkflowEditorField('${escapeAttr(key)}','label',this.value)"></ic-input>
                    <ic-select name="runninghub_${escapeAttr(key)}_type" label="${escapeAttr(tr('api.modelType'))}" onchange="updateRhWorkflowEditorField('${escapeAttr(key)}','fieldType',this.value)">
                        ${['TEXT','NUMBER','SLIDER','BOOLEAN','SELECT','IMAGE','VIDEO','AUDIO'].map(option => `<option value="${option}" ${String(field.fieldType || type).toUpperCase() === option ? 'selected' : ''}>${rhWorkflowFieldTypeLabel(option)}</option>`).join('')}
                    </ic-select>
                </div>
                ${imageSlotControls}
                <div class="rh-editor-field-controls rh-editor-wide-controls">
                    <ic-textarea name="runninghub_${escapeAttr(key)}_options" label="${escapeAttr(tr('api.dropdownPlaceholder'))}" value="${escapeAttr(optionsText)}" oninput="updateRhWorkflowEditorField('${escapeAttr(key)}','options',this.value)"></ic-textarea>
                </div>
                <div class="rh-editor-random-row">
                    <ic-switch class="rh-editor-random" name="runninghub_${escapeAttr(key)}_random" label="${escapeAttr(tr('api.random'))}" ${randomOn ? 'checked' : ''} onchange="updateRhWorkflowEditorField('${escapeAttr(key)}','random_enabled',this.checked)"></ic-switch>
                    <ic-number-input name="runninghub_${escapeAttr(key)}_min" label="${escapeAttr(tr('api.minimum'))}" value="${escapeAttr(rhFiniteNumberValue(field.min))}" oninput="updateRhWorkflowEditorField('${escapeAttr(key)}','min',this.value)"></ic-number-input>
                    <ic-number-input name="runninghub_${escapeAttr(key)}_max" label="${escapeAttr(tr('api.maximum'))}" value="${escapeAttr(rhFiniteNumberValue(field.max))}" oninput="updateRhWorkflowEditorField('${escapeAttr(key)}','max',this.value)"></ic-number-input>
                    <ic-number-input name="runninghub_${escapeAttr(key)}_step" label="${escapeAttr(tr('api.step'))}" value="${escapeAttr(rhFiniteNumberValue(field.step))}" oninput="updateRhWorkflowEditorField('${escapeAttr(key)}','step',this.value)"></ic-number-input>
                </div>
            </div>
        </div>
    `;
}
function renderRhAppFieldCards(){
    const config = rhWorkflowEditorState.config;
    if(!rhWorkflowEditorGraphWrap || !config) return;
    closeRhNodePopover();
    rhWorkflowEditorGraphWrap.classList.remove('rh-editor-graph-wrap');
    rhWorkflowEditorGraphWrap.classList.add('rh-app-field-wrap');
    rhWorkflowEditorGraphWrap.innerHTML = `
        <div class="rh-app-field-list">
            ${(config.fields || []).length
                ? (config.fields || []).map(field => renderRhAppFieldCard(field)).join('')
                : `<ic-empty-state title="${escapeAttr(tr('api.noAppParams'))}" label="${escapeAttr(tr('api.noAppParams'))}"></ic-empty-state>`}
        </div>
    `;
}
function restoreRhGraphWrap(){
    if(!rhWorkflowEditorGraphWrap || rhWorkflowEditorGraphSvg?.parentElement === rhWorkflowEditorGraphWrap) return;
    rhWorkflowEditorGraphWrap.classList.remove('rh-app-field-wrap');
    rhWorkflowEditorGraphWrap.classList.add('rh-editor-graph-wrap');
    rhWorkflowEditorGraphWrap.innerHTML = `
        <svg id="rhWorkflowEditorGraphSvg" class="rh-editor-graph-svg"></svg>
        <ic-toolbar class="rh-editor-graph-controls" appearance="plain" label="${escapeAttr(tr('api.workflowCanvasZoom'))}">
            <ic-icon-button type="button" hierarchy="secondary" icon="zoom-out" label="${escapeAttr(tr('canvas.decrease'))}" onclick="rhEditorGraphZoom(-1)"></ic-icon-button>
            <ic-badge id="rhWorkflowEditorZoom" kind="label" tone="neutral">100%</ic-badge>
            <ic-icon-button type="button" hierarchy="secondary" icon="zoom-in" label="${escapeAttr(tr('canvas.increase'))}" onclick="rhEditorGraphZoom(1)"></ic-icon-button>
            <ic-icon-button type="button" hierarchy="secondary" icon="fit" label="${escapeAttr(tr('canvas.fit'))}" onclick="rhEditorGraphFit()"></ic-icon-button>
        </ic-toolbar>
    `;
    rhWorkflowEditorGraphSvg = document.getElementById('rhWorkflowEditorGraphSvg');
    rhWorkflowEditorZoom = document.getElementById('rhWorkflowEditorZoom');
}
function renderRhAppFieldCard(field){
    const key = rhWorkflowFieldKey(field);
    const checked = field.enabled === true;
    return `
        <div class="rh-app-field-row ${checked ? 'active' : ''}" data-field-key="${escapeAttr(key)}">
            <ic-switch class="rh-app-field-enabled" name="runninghub_${escapeAttr(key)}_enabled" label="${escapeAttr(field.label || field.fieldName)}" ${checked ? 'checked' : ''} onchange="toggleRhWorkflowEditorField('${escapeAttr(key)}')"></ic-switch>
            <span class="rh-app-field-meta">${escapeHtml(field.fieldName)} · ${escapeHtml(rhWorkflowFieldKind(field))}</span>
            <ic-icon-button class="rh-app-field-open" type="button" hierarchy="quiet" icon="settings" label="${escapeAttr(tr('api.editAppParams'))}" onclick="openRhAppFieldPopover('${escapeAttr(key)}', this.closest('.rh-app-field-row'))"></ic-icon-button>
        </div>
    `;
}
function openRhAppFieldPopover(key, anchorEl){
    const config = rhWorkflowEditorState.config;
    const field = (config?.fields || []).find(item => rhWorkflowFieldKey(item) === key);
    if(!field) return;
    closeRhNodePopover();
    const pop = document.createElement('ic-popover');
    pop.id = 'rhNodePopover';
    pop.className = 'rh-node-popover rh-app-popover';
    pop.dataset.fieldKey = String(key || '');
    pop.setAttribute('label', field.label || field.fieldName);
    pop.setAttribute('content', 'interactive');
    pop.setAttribute('dismiss-policy', 'light');
    pop.setAttribute('focus-policy', 'move-into');
    pop.innerHTML = `
        <div class="rh-popover-head">
            <div>
                <strong>${escapeHtml(field.label || field.fieldName)}</strong>
                <span>${escapeHtml(field.fieldName)}</span>
            </div>
            <ic-icon-button type="button" hierarchy="quiet" icon="close" label="${escapeAttr(tr('common.close'))}" onclick="closeRhNodePopover()"></ic-icon-button>
        </div>
        <div class="rh-popover-body">${renderRhWorkflowEditorField(field)}</div>
    `;
    (rhWorkflowEditorOverlay || document.body).appendChild(pop);
    showRhEditorPopover(pop, anchorEl);
}
function computeRhWorkflowEditorLayers(workflow){
    const ids = Object.keys(workflow || {});
    const incoming = {}, outgoing = {};
    ids.forEach(id => { incoming[id] = new Set(); outgoing[id] = new Set(); });
    ids.forEach(id => {
        Object.values(workflow[id]?.inputs || {}).forEach(value => {
            if(Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && workflow[value[0]]){
                incoming[id].add(value[0]);
                outgoing[value[0]].add(id);
            }
        });
    });
    const layer = {};
    const visiting = new Set();
    function dfs(id, lv){
        if(visiting.has(id)) return;
        layer[id] = Math.max(layer[id] || 0, lv);
        visiting.add(id);
        outgoing[id].forEach(child => dfs(child, lv + 1));
        visiting.delete(id);
    }
    ids.forEach(id => { if(incoming[id].size === 0) dfs(id, 0); });
    ids.forEach(id => { if(!(id in layer)) layer[id] = 0; });
    const buckets = {};
    ids.forEach(id => { (buckets[layer[id]] = buckets[layer[id]] || []).push(id); });
    return { buckets };
}
function renderRhWorkflowEditorGraph(){
    const config = rhWorkflowEditorState.config;
    restoreRhGraphWrap();
    closeRhNodePopover();
    const workflow = config?.workflowJson || {};
    const svg = rhWorkflowEditorGraphSvg;
    const wrap = rhWorkflowEditorGraphWrap;
    if(!svg || !wrap) return;
    if(!workflow || !Object.keys(workflow).length){
        svg.innerHTML = `<text x="24" y="42" fill="currentColor">${escapeHtml(tr('api.noWorkflowPreview'))}</text>`;
        return;
    }
    const { buckets } = computeRhWorkflowEditorLayers(workflow);
    const NODE_W = 136, NODE_H = 52, X_GAP = 42, Y_GAP = 16;
    const positions = {};
    const levels = Object.keys(buckets).map(Number).sort((a,b)=>a-b);
    let maxRows = 0;
    levels.forEach(lv => {
        const ids = buckets[lv].sort((a,b)=>parseInt(a,10)-parseInt(b,10));
        ids.forEach((id, idx) => positions[id] = { x:lv * (NODE_W + X_GAP) + 18, y:idx * (NODE_H + Y_GAP) + 18 });
        maxRows = Math.max(maxRows, ids.length);
    });
    const edges = [];
    Object.keys(workflow).forEach(toId => {
        const seen = new Set();
        Object.values(workflow[toId]?.inputs || {}).forEach(value => {
            if(Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && positions[value[0]] && positions[toId]){
                if(seen.has(value[0])) return;
                seen.add(value[0]);
                const from = positions[value[0]], to = positions[toId];
                const x1 = from.x + NODE_W, y1 = from.y + NODE_H / 2;
                const x2 = to.x, y2 = to.y + NODE_H / 2;
                const cx = (x1 + x2) / 2;
                edges.push(`<path class="rh-editor-edge" d="M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}"></path>`);
            }
        });
    });
    const activeNodes = new Set((config.fields || []).filter(field => field.enabled === true).map(field => String(field.nodeId)));
    const nodes = Object.entries(workflow).map(([id, node]) => {
        const pos = positions[id];
        const title = workflowNodeTitle(node);
        const klass = workflowNodeClass(node);
        const cat = workflowNodeCategory(node);
        const count = (config.fields || []).filter(field => field.enabled === true && String(field.nodeId) === String(id)).length;
        return `
            <g class="rh-editor-gnode cat-${cat} ${activeNodes.has(String(id)) ? 'has-exposed' : ''} ${String(id) === rhWorkflowEditorState.activeNodeId ? 'is-active' : ''}" data-node-id="${escapeAttr(id)}" transform="translate(${pos.x},${pos.y})" onclick="openRhWorkflowNodePopover('${escapeAttr(id)}', this)">
                <rect width="${NODE_W}" height="${NODE_H}" rx="8"></rect>
                <text class="rh-editor-gtitle" x="10" y="20">${escapeHtml(title.length > 15 ? title.slice(0, 15) + '...' : title)}</text>
                <text class="rh-editor-gsub" x="10" y="36">${escapeHtml(klass.length > 18 ? klass.slice(0, 18) + '...' : klass)}</text>
                <text class="rh-editor-gsub" x="${NODE_W - 8}" y="20" text-anchor="end">#${escapeHtml(id)}</text>
                ${count ? `<text class="rh-editor-gbadge" x="${NODE_W - 8}" y="43" text-anchor="end">${count}</text>` : ''}
            </g>
        `;
    }).join('');
    rhWorkflowEditorState.graph.w = levels.length * (NODE_W + X_GAP) + 18;
    rhWorkflowEditorState.graph.h = maxRows * (NODE_H + Y_GAP) + 18;
    svg.setAttribute('viewBox', `0 0 ${wrap.clientWidth || 800} ${wrap.clientHeight || 520}`);
    svg.innerHTML = `<g id="rhWorkflowEditorViewport" transform="translate(${rhWorkflowEditorState.graph.x},${rhWorkflowEditorState.graph.y}) scale(${rhWorkflowEditorState.graph.k})">${edges.join('')}${nodes}</g>`;
    bindRhWorkflowEditorPanZoom();
    updateRhEditorZoom();
}
function updateRhEditorZoom(){
    if(rhWorkflowEditorZoom) rhWorkflowEditorZoom.textContent = Math.round((rhWorkflowEditorState.graph.k || 1) * 100) + '%';
}
function applyRhEditorGraphTransform(){
    const vp = document.getElementById('rhWorkflowEditorViewport');
    const g = rhWorkflowEditorState.graph;
    if(vp) vp.setAttribute('transform', `translate(${g.x},${g.y}) scale(${g.k})`);
    updateRhEditorZoom();
}
function rhEditorGraphZoom(dir){
    const wrap = rhWorkflowEditorGraphWrap;
    if(!wrap) return;
    const g = rhWorkflowEditorState.graph;
    const factor = dir > 0 ? 1.2 : 1 / 1.2;
    const newK = Math.max(0.2, Math.min(3, g.k * factor));
    const cx = wrap.clientWidth / 2;
    const cy = wrap.clientHeight / 2;
    g.x = cx - (cx - g.x) * (newK / g.k);
    g.y = cy - (cy - g.y) * (newK / g.k);
    g.k = newK;
    applyRhEditorGraphTransform();
}
function rhEditorGraphFit(){
    const wrap = rhWorkflowEditorGraphWrap;
    const g = rhWorkflowEditorState.graph;
    if(!wrap || !g.w || !g.h) return;
    const pad = 24;
    const k = Math.max(0.2, Math.min(2, Math.min((wrap.clientWidth - pad * 2) / g.w, (wrap.clientHeight - pad * 2) / g.h)));
    g.k = k;
    g.x = (wrap.clientWidth - g.w * k) / 2;
    g.y = (wrap.clientHeight - g.h * k) / 2;
    applyRhEditorGraphTransform();
}
function bindRhWorkflowEditorPanZoom(){
    const svg = rhWorkflowEditorGraphSvg;
    const wrap = rhWorkflowEditorGraphWrap;
    if(!svg || !wrap || svg.dataset.editorPanZoomBound) return;
    svg.dataset.editorPanZoomBound = '1';
    rhWorkflowEditorState.bound = true;
    wrap.addEventListener('wheel', event => {
        if(!rhWorkflowEditorState.open) return;
        event.preventDefault();
        const g = rhWorkflowEditorState.graph;
        const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
        const newK = Math.max(0.2, Math.min(3, g.k * factor));
        const rect = wrap.getBoundingClientRect();
        const mx = event.clientX - rect.left;
        const my = event.clientY - rect.top;
        g.x = mx - (mx - g.x) * (newK / g.k);
        g.y = my - (my - g.y) * (newK / g.k);
        g.k = newK;
        applyRhEditorGraphTransform();
    }, { passive:false });
    svg.addEventListener('mousedown', event => {
        if(!rhWorkflowEditorState.open) return;
        event.preventDefault();
        rhWorkflowEditorState.pan = { sx:event.clientX, sy:event.clientY, ox:rhWorkflowEditorState.graph.x, oy:rhWorkflowEditorState.graph.y };
        wrap.classList.add('is-panning');
    });
    window.addEventListener('mousemove', event => {
        const pan = rhWorkflowEditorState.pan;
        if(!pan) return;
        rhWorkflowEditorState.graph.x = pan.ox + event.clientX - pan.sx;
        rhWorkflowEditorState.graph.y = pan.oy + event.clientY - pan.sy;
        applyRhEditorGraphTransform();
    });
    window.addEventListener('mouseup', () => {
        if(rhWorkflowEditorState.pan){
            rhWorkflowEditorState.pan = null;
            wrap.classList.remove('is-panning');
        }
    });
}
function renderRunningHubCards(){
    const item = provider();
    if(!item || item.id !== 'runninghub'){
        if(rhAppsList) rhAppsList.innerHTML = '';
        if(rhWorkflowsList) rhWorkflowsList.innerHTML = '';
        return;
    }
    ensureRunningHubLists(item);
    const apps = item.rh_apps.map((entry, index) => ({...entry, _rhIndex:index})).filter(entry => entry?.hidden !== true);
    const workflows = item.rh_workflows.map((entry, index) => ({...entry, _rhIndex:index})).filter(entry => entry?.hidden !== true);
    if(rhAppsCount) rhAppsCount.textContent = apps.length;
    if(rhWorkflowsCount) rhWorkflowsCount.textContent = workflows.length;
    renderRhEntryList(rhAppsList, apps, 'app');
    renderRhEntryList(rhWorkflowsList, workflows, 'workflow');
}
function rhEntryThumbnailCandidates(kind, entry){
    const id = String((kind === 'workflow' ? (entry?.workflowId || entry?.id) : (entry?.appId || entry?.id)) || '').trim().replace(/[^0-9A-Za-z_-]/g, '');
    if(!id) return [];
    const prefix = kind === 'workflow' ? 'workflow' : 'app';
    const exts = ['jpg'];
    const names = [`${prefix}-${id}`, id];
    const roots = ['/static/runninghub/thumbnails', '/static/runninghub'];
    const urls = [];
    names.forEach(name => {
        exts.forEach(ext => {
            roots.forEach(root => urls.push(`${root}/${name}.${ext}`));
        });
    });
    return urls;
}
function rhEntryThumbnailInfo(kind, entry){
    if(entry?.thumbnailRemoved === true) return {src:'', fallbacks:[]};
    const candidates = rhEntryThumbnailCandidates(kind, entry);
    const thumbnail = String(entry?.thumbnail || '').trim();
    const src = thumbnail || candidates[0] || '';
    const fallbacks = thumbnail ? candidates : candidates.slice(1);
    return {src, fallbacks};
}
function fallbackRhEntryThumbnail(frame){
    const fallbacks = String(frame?.dataset?.rhFallbacks || '').split('|').filter(Boolean);
    const next = fallbacks.shift();
    if(next){
        frame.dataset.rhFallbacks = fallbacks.join('|');
        frame.setAttribute('src', next);
        frame.setAttribute('state', 'normal');
        return;
    }
    frame.setAttribute('state', 'upload');
    frame.removeAttribute('src');
    frame.removeAttribute('alt');
}
function renderRhEntryThumbnailFrame(kind, entry, index){
    const info = rhEntryThumbnailInfo(kind, entry);
    const label = entry.title || tr(kind === 'app' ? 'api.appName' : 'api.workflowName');
    const common = `class="rh-entry-thumbnail" data-rh-entry-thumbnail data-rh-kind="${kind}" data-rh-index="${index}" data-rh-fallbacks="${escapeAttr(info.fallbacks.join('|'))}" size="medium" label="${escapeAttr(label)}"`;
    if(!info.src) return `<ic-image-frame ${common} state="upload"></ic-image-frame>`;
    return `<ic-image-frame ${common} state="normal" src="${escapeAttr(info.src)}" alt="${escapeAttr(label)}"></ic-image-frame>`;
}
function renderRhEntryList(target, list, kind){
    if(!target) return;
    if(!list.length){
        const message = tr(kind === 'app' ? 'api.emptyAppHint' : 'api.emptyWorkflowHint');
        target.innerHTML = `<ic-empty-state title="${escapeAttr(message)}" label="${escapeAttr(message)}"></ic-empty-state>`;
        return;
    }
    target.innerHTML = list.map((entry, index) => `
        <ic-card class="rh-entry-card" size="small" tone="subtle" label="${escapeAttr(entry.title || tr(kind === 'app' ? 'api.appName' : 'api.workflowName'))}">
          <div class="rh-entry-layout">
            ${renderRhEntryThumbnailFrame(kind, entry, entry._rhIndex ?? index)}
            <div class="rh-entry-main">
                <ic-form-field label="${escapeAttr(tr('api.name'))}"><ic-input slot="control" name="runninghub_${kind}_${entry._rhIndex ?? index}_name" value="${escapeAttr(entry.title || '')}" oninput="updateRhEntry('${kind}', ${entry._rhIndex ?? index}, 'title', this.value)" placeholder="${escapeAttr(tr(kind === 'app' ? 'api.appName' : 'api.workflowName'))}"></ic-input></ic-form-field>
                <div class="rh-entry-path"><ic-icon name="link" size="small"></ic-icon><span>${escapeHtml(kind === 'app' ? `/run/ai-app/${entry.id}` : `/run/workflow/${entry.id}`)}</span></div>
                <ic-textarea name="runninghub_${kind}_${entry._rhIndex ?? index}_note" label="${escapeAttr(tr('api.note'))}" value="${escapeAttr(entry.note || '')}" oninput="updateRhEntry('${kind}', ${entry._rhIndex ?? index}, 'note', this.value)" placeholder="${escapeAttr(tr('api.notePlaceholder'))}"></ic-textarea>
            </div>
            <ic-toolbar class="rh-entry-actions" appearance="plain" orientation="vertical" label="${escapeAttr(tr(kind === 'workflow' ? 'api.editWorkflow' : 'api.editAppParams'))}">
                ${kind === 'workflow'
                    ? `<ic-icon-button type="button" hierarchy="secondary" icon="settings" label="${escapeAttr(tr('api.editWorkflow'))}" onclick="openRhWorkflowEditor(${entry._rhIndex ?? index})"></ic-icon-button>`
                    : `<ic-icon-button type="button" hierarchy="secondary" icon="settings" label="${escapeAttr(tr('api.editAppParams'))}" onclick="openRhAppEditor(${entry._rhIndex ?? index})"></ic-icon-button>`}
                <ic-icon-button type="button" hierarchy="quiet" tone="danger" icon="delete" label="${escapeAttr(tr('api.delete'))}" onclick="removeRhEntry('${kind}', ${entry._rhIndex ?? index})"></ic-icon-button>
            </ic-toolbar>
          </div>
        </ic-card>
    `).join('');
}
function dispatchSelectionChange(element){
    if(!element) return;
    element.dispatchEvent(new CustomEvent('ic-change', {bubbles:true}));
}
function sortedProviders(){
    const order = ['modelscope', 'runninghub', 'volcengine'];
    return visibleProviders().sort((a, b) => {
        const ai = order.indexOf(a.id);
        const bi = order.indexOf(b.id);
        if(ai === -1 && bi === -1) return 0;
        if(ai === -1) return 1;
        if(bi === -1) return -1;
        return ai - bi;
    });
}
function providerDragAttrs(item){
    if(isFixedProvider(item)) return '';
    const id = escapeAttr(item.id);
    return ` draggable="true" data-provider-id="${id}" ondragstart="handleProviderDragStart(event,'${id}')" ondragover="handleProviderDragOver(event,'${id}')" ondrop="handleProviderDrop(event,'${id}')" ondragend="handleProviderDragEnd()"`;
}
const PROVIDER_ICON_ASSETS = Object.freeze({
    chatgpt:'/static/images/providers/chatgpt.svg',
    doubao:'/static/images/providers/doubao.svg',
    flux:'/static/images/providers/flux.svg',
    gemini:'/static/images/providers/gemini.svg',
    grok:'/static/images/providers/grok.svg',
    jimeng:'/static/images/providers/jimeng.svg'
});
const PROVIDER_ICON_ALIASES = Object.freeze({
    chatgpt:new Set(['chatgpt', 'openai', 'codex']),
    doubao:new Set(['doubao', 'volcengine', 'volces']),
    flux:new Set(['flux']),
    gemini:new Set(['gemini', 'gemini-cli', 'antigravity']),
    grok:new Set(['grok']),
    jimeng:new Set(['jimeng', 'jimeng-cli', '即梦'])
});
function providerIconKey(item){
    const identities = [item?.id, item?.name]
        .map(value => String(value || '').trim().toLowerCase())
        .filter(Boolean);
    for(const [key, aliases] of Object.entries(PROVIDER_ICON_ALIASES)){
        if(identities.some(identity => aliases.has(identity))) return key;
    }
    return '';
}
function providerIconMarkup(item){
    const key = providerIconKey(item);
    if(!key) return '<ic-icon name="settings" size="small" aria-hidden="true"></ic-icon>';
    const monochromeClass = key === 'doubao' ? '' : ' provider-platform-icon-monochrome';
    return `<img class="provider-platform-icon${monochromeClass}" src="${PROVIDER_ICON_ASSETS[key]}" alt="" aria-hidden="true">`;
}
function renderProviderList(){
    providerList.innerHTML = sortedProviders().map(item => {
        const tabValue = escapeAttr(item.id);
        const itemProtocol = String(item.protocol || 'openai').toLowerCase();
        const stateClass = item.enabled === false ? 'is-disabled' : (item.has_key || item.has_wallet_key || CLI_PROTOCOLS.has(itemProtocol) ? 'has-key' : 'missing-key');
        const protocolLabel = item.id === 'runninghub' ? 'RH' : String(item.protocol || 'openai').toUpperCase();
        if(item.id === 'modelscope'){
            return `
                <span class="provider-nav-item provider-nav-banner ${stateClass}" data-value="${tabValue}">
                    <span class="provider-nav-banner-inner">
                        <span class="provider-logo-wrap">
                            <img src="/static/images/providers/modelscope.gif" alt="ModelScope" class="ms-icon-light">
                            <img src="/static/images/providers/modelscope-1.gif" alt="ModelScope" class="ms-icon-dark">
                            <span class="provider-logo-fallback">ModelScope</span>
                        </span>
                        <!-- Brand-only navigation item; no status badge. -->
                    </span>
                </span>
            `;
        }
        if(item.id === 'runninghub'){
            return `
                <span class="provider-nav-item provider-nav-banner ${stateClass}" data-value="${tabValue}">
                    <span class="provider-nav-banner-inner">
                        <span class="provider-logo-wrap">
                            <img src="/static/images/providers/RunningHub-B.png" alt="RunningHub" class="runninghub-icon ms-icon-light">
                            <img src="/static/images/providers/RunningHub-W.png" alt="RunningHub" class="runninghub-icon ms-icon-dark">
                            <span class="provider-logo-fallback">RunningHub</span>
                        </span>
                        <!-- Brand-only navigation item; no status badge. -->
                    </span>
                </span>
            `;
        }
        if(item.id === 'volcengine'){
            return `
                <span class="provider-nav-item provider-nav-banner ${stateClass}" data-value="${tabValue}">
                    <span class="provider-nav-banner-inner">
                        <span class="provider-logo-wrap">
                            <img src="/static/images/providers/volcengine-theme-light.svg" alt="${escapeAttr(tr('api.volcengine'))}" class="volcengine-icon ms-icon-light">
                            <img src="/static/images/providers/volcengine-theme-dark.svg" alt="${escapeAttr(tr('api.volcengine'))}" class="volcengine-icon ms-icon-dark">
                            <span class="provider-logo-fallback">${escapeHtml(tr('api.volcengine'))}</span>
                        </span>
                        <!-- Brand-only navigation item; no status badge. -->
                    </span>
                </span>
            `;
        }
        return `
            <span class="provider-nav-item provider-nav-sortable ${stateClass}" data-value="${tabValue}"${providerDragAttrs(item)}>
                <span class="provider-nav-row">
                    <span class="provider-drag-handle" aria-hidden="true"><ic-icon name="drag" size="small"></ic-icon></span>
                    <span class="provider-platform-icon-slot">${providerIconMarkup(item)}</span>
                    <span class="provider-info">
                        <span class="provider-name">${escapeHtml(item.name || item.id)}</span>
                    </span>
                    <span class="provider-side-meta">
                        <ic-badge class="provider-protocol-tag" kind="label" size="small" tone="neutral">${escapeHtml(protocolLabel)}</ic-badge>
                    </span>
                </span>
            </span>
        `;
    }).join('');
}
function handleProviderDragStart(event, id){
    const item = providers.find(provider => provider.id === id);
    if(!item || isFixedProvider(item)){
        event.preventDefault();
        return;
    }
    providerDragId = id;
    event.currentTarget.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
}
function handleProviderDragOver(event, id){
    if(!providerDragId || providerDragId === id || isFixedProvider(id)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    providerList?.querySelectorAll('.provider-nav-drop-target').forEach(el => el.classList.remove('provider-nav-drop-target'));
    event.currentTarget.classList.add('provider-nav-drop-target');
}
function handleProviderDrop(event, targetId){
    event.preventDefault();
    providerList?.querySelectorAll('.provider-nav-drop-target').forEach(el => el.classList.remove('provider-nav-drop-target'));
    const sourceId = providerDragId || event.dataTransfer.getData('text/plain');
    providerDragId = '';
    if(!sourceId || sourceId === targetId || isFixedProvider(sourceId) || isFixedProvider(targetId)) return;
    const sourceIndex = providers.findIndex(item => item.id === sourceId);
    const targetIndex = providers.findIndex(item => item.id === targetId);
    if(sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = providers.splice(sourceIndex, 1);
    const adjustedTargetIndex = providers.findIndex(item => item.id === targetId);
    providers.splice(adjustedTargetIndex, 0, moved);
    renderProviderList();
    requestAutoSave();
}
function handleProviderDragEnd(){
    providerDragId = '';
    providerList?.querySelectorAll('.is-dragging,.provider-nav-drop-target').forEach(el => {
        el.classList.remove('is-dragging', 'provider-nav-drop-target');
    });
}
function renderEditor(){
    const item = provider();
    if(!item) return;
    editorTitle.textContent = item.name || item.id;
    nameInput.value = item.name || '';
    idInput.value = item.id || '';
    updateIdPreview();
    baseInput.placeholder = EXAMPLE_BASE_URL;
    baseInput.value = item.base_url || '';
    const lockedApi = lockedRecommendedApi(item);
    if(lockedApi) applyLockedRecommendedProtocol(item);
    if(protocolInput){
        protocolInput.value = item.id === 'runninghub' ? 'runninghub' : item.id === 'volcengine' ? 'volcengine' : (item.protocol || 'openai');
        protocolInput.disabled = FIXED_PROTOCOL_PROVIDER_IDS.has(item.id) || Boolean(lockedApi);
        protocolInput.title = lockedApi ? tr('api.fixedRecommendedProtocol') : (protocolInput.disabled ? tr('api.fixedBuiltinProtocol') : '');
    }
    if(imageRequestModeInput){
        imageRequestModeInput.value = normalizeImageRequestMode(item.image_request_mode);
        imageRequestModeInput.disabled = Boolean(lockedApi) || item.id === 'modelscope' || item.id === 'runninghub' || item.id === 'volcengine' || CLI_PROTOCOLS.has(String(protocolInput?.value || item.protocol || '').toLowerCase());
        imageRequestModeInput.title = lockedApi ? tr('api.fixedRecommendedImageProtocol') : '';
    }
    if(imageEditRouteInput){
        imageEditRouteInput.value = normalizeImageEditRoute(item.image_edit_route);
        imageEditRouteInput.disabled = item.id === 'modelscope' || item.id === 'runninghub' || item.id === 'volcengine' || CLI_PROTOCOLS.has(String(protocolInput?.value || item.protocol || '').toLowerCase());
    }
    keyInput.value = '';
    keyInput.placeholder = item.has_key ? `${tr('api.keepCurrentKey')} ${item.key_preview || ''}` : tr('api.enterKey');
    if(keyFormField) keyFormField.setAttribute('hint', item.has_key ? `${tr('api.keySaved')}${item.key_env || tr('api.deviceStatePath')}` : tr('api.noKey'));
    if(clearSavedKeyBtn) clearSavedKeyBtn.hidden = !item.has_key;
    const isModelScope = item.id === 'modelscope';
    const isRunningHub = item.id === 'runninghub';
    const isVolcengine = item.id === 'volcengine' || String(protocolInput?.value || item.protocol || '').toLowerCase() === 'volcengine';
    const isStandaloneVolcengine = item.id === 'volcengine';
    const isJimeng = String(protocolInput?.value || item.protocol || '').toLowerCase() === 'jimeng';
    const isCodex = String(protocolInput?.value || item.protocol || '').toLowerCase() === 'codex';
    const isGeminiCli = String(protocolInput?.value || item.protocol || '').toLowerCase() === 'gemini-cli';
    if(isRunningHub){
        ensureRunningHubLists(item);
        if(rhFreeKeyInput){
            rhFreeKeyInput.value = '';
            rhFreeKeyInput.placeholder = item.has_key ? `${tr('api.rhKeepCoinKey')} ${item.key_preview || ''}` : tr('api.rhEnterCoinKey');
        }
        if(rhWalletKeyInput){
            rhWalletKeyInput.value = '';
            rhWalletKeyInput.placeholder = item.has_wallet_key ? `${tr('api.rhKeepWalletKey')} ${item.wallet_key_preview || ''}` : tr('api.rhEnterWalletKey');
        }
        if(rhFreeKeyHint) rhFreeKeyHint.textContent = rhFreeKeyHintText(item);
        if(rhWalletKeyHint) rhWalletKeyHint.textContent = rhWalletKeyHintText(item);
        renderRunningHubCards();
    }
    if(isVolcengine){
        item.base_url = item.base_url || VOLCENGINE_DEFAULT_BASE_URL;
        item.protocol = 'volcengine';
        item.volcengine_project_name = item.volcengine_project_name || VOLCENGINE_DEFAULT_PROJECT_NAME;
        item.volcengine_region = item.volcengine_region || VOLCENGINE_DEFAULT_REGION;
        keyInput.placeholder = item.has_key ? trf('api.keepArkKey', {preview: item.key_preview || ''}) : tr('api.enterArkKey');
        if(keyFormField) keyFormField.setAttribute('hint', volcengineArkKeyHintText(item));
        if(volcArkKeyHint) volcArkKeyHint.textContent = volcengineArkKeyHintText(item);
        if(volcAkInput){
            volcAkInput.value = '';
            volcAkInput.placeholder = item.has_volcengine_access_key ? trf('api.keepAccessKey', {preview: item.volcengine_access_key_preview || ''}) : 'Access Key ID';
        }
        if(volcSkInput){
            volcSkInput.value = '';
            volcSkInput.placeholder = item.has_volcengine_secret_key ? trf('api.keepSecretKey', {preview: item.volcengine_secret_key_preview || ''}) : 'Secret Access Key';
        }
        if(volcAssetKeyHint) volcAssetKeyHint.textContent = volcengineAssetKeyHintText(item);
        if(volcProjectInput) volcProjectInput.value = item.volcengine_project_name || VOLCENGINE_DEFAULT_PROJECT_NAME;
        if(volcRegionInput) volcRegionInput.value = item.volcengine_region || VOLCENGINE_DEFAULT_REGION;
    }
    if(isJimeng){
        item.base_url = '';
        item.protocol = 'jimeng';
        applyJimengModelDefaults(item);
        keyInput.placeholder = tr('api.jimengCliNoKey');
        if(keyFormField) keyFormField.setAttribute('hint', tr('api.jimengCliInstallHint'));
    }
    if(isCodex){
        applyCliProtocolDefaults(item, 'codex');
        keyInput.placeholder = tr('api.codexCliNoKey');
        if(keyFormField) keyFormField.setAttribute('hint', tr('api.codexCliInstallHint'));
    }
    if(isGeminiCli){
        applyCliProtocolDefaults(item, 'gemini-cli');
        keyInput.placeholder = tr('api.antigravityCliNoKey');
        if(keyFormField) keyFormField.setAttribute('hint', tr('api.antigravityCliInstallHint'));
    }
    document.body.classList.toggle('show-ms', isModelScope);
    document.body.classList.toggle('show-runninghub', isRunningHub);
    document.body.classList.toggle('show-volcengine', isVolcengine);
    document.body.classList.toggle('show-volcengine-standalone', isStandaloneVolcengine);
    document.body.classList.toggle('show-jimeng', isJimeng);
    document.body.classList.toggle('show-codex', isCodex);
    document.body.classList.toggle('show-gemini-cli', isGeminiCli);
    updateApimartDomesticHint(item);
    renderProviderOnboarding(item);
    if(runninghubConfigBlock){
        runninghubConfigBlock.hidden = !isRunningHub;
    }
    if(!isRunningHub){
        if(rhPasteInput) rhPasteInput.value = '';
        if(rhAppsList) rhAppsList.innerHTML = '';
        if(rhWorkflowsList) rhWorkflowsList.innerHTML = '';
        if(rhAppsCount) rhAppsCount.textContent = '0';
        if(rhWorkflowsCount) rhWorkflowsCount.textContent = '0';
    }
    if(modelExtensions) modelExtensions.hidden = !isModelScope;
    if(jimengCliPanel){
        jimengCliPanel.hidden = !isJimeng;
        if(isJimeng) refreshJimengStatus(false);
    }
    if(codexCliPanel){
        codexCliPanel.hidden = !isCodex;
        if(isCodex) refreshCodexStatus(false);
    }
    if(geminiCliPanel){
        geminiCliPanel.hidden = !isGeminiCli;
        if(isGeminiCli) refreshGeminiCliStatus(false);
    }
    const deleteBtn = document.getElementById('deleteBtn');
    if(deleteBtn) deleteBtn.hidden = isFixedProvider(item);
    renderModels('image');
    renderModels('chat');
    renderModels('video');
    if(isModelScope) renderMsLoras();
    else if(msLoraList) msLoraList.innerHTML = '';
    renderProviderList();
}
function showVerificationToast(content, tone='info'){
    const message = String(content || '').replace(/\s+/g, ' ').trim();
    if(message) setStatus(message, tone);
}
function prettyJson(value){
    try { return JSON.stringify(value, null, 2); } catch(_) { return String(value || ''); }
}
function jimengCreditText(raw){
    if(!raw) return '';
    const parts = [];
    const seen = new Set();
    const visit = value => {
        if(!value || typeof value !== 'object') return;
        Object.entries(value).forEach(([key, item]) => {
            const low = key.toLowerCase();
            if(/credit|balance|quota|point|coin|积分|余额/.test(low) && item !== null && typeof item !== 'object'){
                const label = `${key}: ${item}`;
                if(!seen.has(label)){ seen.add(label); parts.push(label); }
            }
            if(item && typeof item === 'object') visit(item);
        });
    };
    visit(raw);
    return parts.join(' · ') || prettyJson(raw);
}
function setCliStatusBadge(badge, text, ok=null){
    if(!badge) return;
    badge.textContent = text || tr('api.notDetected');
    badge.setAttribute('tone', ok === true ? 'success' : (ok === false ? 'danger' : 'neutral'));
}
function setCliInfo(surface, text, tone='neutral'){
    if(!surface) return;
    const message = String(text || '').trim();
    surface.textContent = message || tr('api.notDetected');
    surface.setAttribute('tone', tone);
    surface.hidden = !message;
}
function setJimengStatus(text, ok=null){
    setCliStatusBadge(jimengCliStatus, text, ok);
}
function renderJimengLoginBox(data){
    if(!jimengLoginBox) return;
    const text = data?.text || '';
    const qrUrl = data?.qr_url || '';
    const qrHtml = qrUrl && qrUrl.startsWith('http')
        ? `<ic-media-container class="jimeng-qr-media" kind="image" label="${escapeAttr(tr('api.jimengQrAlt'))}" aspect="square" fit="contain"><img class="jimeng-qr-img" src="${escapeAttr(qrUrl)}" alt="${escapeAttr(tr('api.jimengQrAlt'))}"></ic-media-container>`
        : '';
    jimengLoginBox.hidden = false;
    jimengLoginBox.innerHTML = `${qrHtml}<pre>${escapeHtml(text || tr('api.waitingCliQr'))}</pre>`;
}
let jimengLoginTimer = null;
async function refreshJimengStatus(showCredit=true){
    if(!jimengCliPanel || jimengCliPanel.hidden) return;
    setJimengStatus(tr('api.checking'));
    try {
        const data = await fetch('/api/jimeng/status').then(r => r.json());
        setJimengStatus(data.logged_in ? tr('api.loggedIn') : (data.installed ? tr('api.notLoggedIn') : tr('api.notInstalled')), data.logged_in === true);
        if(data.installed && data.version_ok === false && jimengCredit){
            setCliInfo(jimengCredit, trf('api.cliOutdated', {version: data.cli_version || tr('api.unknown'), minimum: data.min_version || '1.4.2'}), 'warning');
        } else if(showCredit && data.raw && jimengCredit){
            setCliInfo(jimengCredit, jimengCreditText(data.raw));
        }
    } catch(e){
        setJimengStatus(tr('api.checkFailed'), false);
        setCliInfo(jimengCredit, e.message || String(e), 'danger');
    }
}
async function startJimengLogin(){
    setJimengStatus(tr('api.waitingScan'));
    if(jimengCredit) jimengCredit.hidden = true;
    try {
        const data = await fetch('/api/jimeng/login/start', {method:'POST'}).then(async r => {
            const json = await r.json();
            if(!r.ok) throw new Error(json.detail || tr('api.loginStartFailed'));
            return json;
        });
        renderJimengLoginBox(data);
        clearInterval(jimengLoginTimer);
        jimengLoginTimer = setInterval(pollJimengLogin, 2500);
    } catch(e){
        setJimengStatus(tr('api.loginFailed'), false);
        if(jimengLoginBox){
            jimengLoginBox.hidden = false;
            jimengLoginBox.innerHTML = `<ic-alert tone="danger">${escapeHtml(e.message || String(e))}</ic-alert>`;
        }
    }
}
async function pollJimengLogin(){
    try {
        const data = await fetch('/api/jimeng/login/status').then(r => r.json());
        renderJimengLoginBox(data);
        if(data.logged_in){
            clearInterval(jimengLoginTimer);
            setJimengStatus(tr('api.loggedIn'), true);
            setCliInfo(jimengCredit, jimengCreditText(data.raw), 'success');
        } else if(data.running){
            setJimengStatus(tr('api.waitingScan'));
        } else {
            setJimengStatus(tr('api.notLoggedIn'), false);
        }
    } catch(e){
        clearInterval(jimengLoginTimer);
        setJimengStatus(tr('api.loginCheckFailed'), false);
    }
}
async function refreshJimengCredit(){
    setJimengStatus(tr('api.queryingBalance'));
    try {
        const data = await fetch('/api/jimeng/credit').then(async r => {
            const json = await r.json();
            if(!r.ok) throw new Error(json.detail || tr('api.balanceQueryFailed'));
            return json;
        });
        setJimengStatus(tr('api.loggedIn'), true);
        setCliInfo(jimengCredit, jimengCreditText(data.raw), 'success');
    } catch(e){
        setJimengStatus(tr('api.notLoggedIn'), false);
        setCliInfo(jimengCredit, e.message || String(e), 'danger');
    }
}
async function logoutJimeng(){
    if(!await requestApiActionConfirmation({
        label:tr('api.logout'),
        description:tr('api.confirmJimengLogout'),
        confirmLabel:tr('api.logout')
    })) return;
    try {
        const data = await fetch('/api/jimeng/logout', {method:'POST'}).then(async r => {
            const json = await r.json();
            if(!r.ok) throw new Error(json.detail || tr('api.logoutFailed'));
            return json;
        });
        setJimengStatus(tr('api.loggedOut'), false);
        setCliInfo(jimengCredit, prettyJson(data.raw));
        if(jimengLoginBox) jimengLoginBox.hidden = true;
    } catch(e){
        setJimengStatus(tr('api.logoutFailed'), false);
        setCliInfo(jimengCredit, e.message || String(e), 'danger');
    }
}
function openJimengHelp(){
    if(!jimengHelpOverlay) return;
    void jimengHelpOverlay.show();
    loadJimengHelp();
}
function closeJimengHelp(){
    if(jimengHelpOverlay?.open) void jimengHelpOverlay.hide('close');
}
async function loadJimengHelp(){
    if(!jimengHelpOutput) return;
    jimengHelpOutput.textContent = tr('api.loading');
    try {
        const command = jimengHelpCommand?.value === '__root__' ? '' : (jimengHelpCommand?.value || '');
        const data = await fetch('/api/jimeng/help', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({command})
        }).then(async r => {
            const json = await r.json();
            if(!r.ok) throw new Error(json.detail || tr('api.helpLoadFailed'));
            return json;
        });
        jimengHelpOutput.textContent = data.text || prettyJson(data.raw);
    } catch(e){
        jimengHelpOutput.textContent = e.message || String(e);
    }
}
function setCodexStatus(text, ok=null){
    setCliStatusBadge(codexCliStatus, text, ok);
}
async function refreshCodexStatus(showInfo=true){
    if(!codexCliPanel || codexCliPanel.hidden) return;
    setCodexStatus(tr('api.checking'));
    try {
        const data = await fetch('/api/codex/status').then(r => r.json());
        setCodexStatus(data.installed ? tr('api.installed') : tr('api.notInstalled'), data.installed === true);
        if(showInfo && codexCliInfo){
            const parts = [];
            if(data.version) parts.push(data.version);
            if(data.path) parts.push(data.path);
            if(data.message) parts.push(data.message);
            setCliInfo(codexCliInfo, parts.join(' · '));
        }
    } catch(e){
        setCodexStatus(tr('api.checkFailed'), false);
        setCliInfo(codexCliInfo, e.message || String(e), 'danger');
    }
}
function openCodexHelp(){
    if(!codexHelpOverlay) return;
    void codexHelpOverlay.show();
    loadCodexHelp();
}
function closeCodexHelp(){
    if(codexHelpOverlay?.open) void codexHelpOverlay.hide('close');
}
async function loadCodexHelp(){
    if(!codexHelpOutput) return;
    codexHelpOutput.textContent = tr('api.loading');
    try {
        const command = codexHelpCommand?.value === '__root__' ? '' : (codexHelpCommand?.value || '');
        const data = await fetch('/api/codex/help', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({command})
        }).then(async r => {
            const json = await r.json();
            if(!r.ok) throw new Error(json.detail || tr('api.helpLoadFailed'));
            return json;
        });
        codexHelpOutput.textContent = data.text || prettyJson(data.raw);
    } catch(e){
        codexHelpOutput.textContent = e.message || String(e);
    }
}
function setGeminiCliStatus(text, ok=null){
    setCliStatusBadge(geminiCliStatus, text, ok);
}
async function refreshGeminiCliStatus(showInfo=true){
    if(!geminiCliPanel || geminiCliPanel.hidden) return;
    setGeminiCliStatus(tr('api.checking'));
    try {
        const data = await fetch('/api/gemini-cli/status').then(r => r.json());
        setGeminiCliStatus(data.installed ? tr('api.installed') : tr('api.notInstalled'), data.installed === true);
        if(showInfo && geminiCliInfo){
            const parts = [];
            if(data.version) parts.push(data.version);
            if(data.path) parts.push(data.path);
            if(data.message) parts.push(data.message);
            setCliInfo(geminiCliInfo, parts.join(' · '));
        }
    } catch(e){
        setGeminiCliStatus(tr('api.checkFailed'), false);
        setCliInfo(geminiCliInfo, e.message || String(e), 'danger');
    }
}
function openGeminiCliHelp(){
    if(!geminiCliHelpOverlay) return;
    void geminiCliHelpOverlay.show();
    loadGeminiCliHelp();
}
function closeGeminiCliHelp(){
    if(geminiCliHelpOverlay?.open) void geminiCliHelpOverlay.hide('close');
}
async function loadGeminiCliHelp(){
    if(!geminiCliHelpOutput) return;
    geminiCliHelpOutput.textContent = tr('api.loading');
    try {
        const command = geminiCliHelpCommand?.value === '__root__' ? '' : (geminiCliHelpCommand?.value || '');
        const data = await fetch('/api/gemini-cli/help', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({command})
        }).then(async r => {
            const json = await r.json();
            if(!r.ok) throw new Error(json.detail || tr('api.helpLoadFailed'));
            return json;
        });
        geminiCliHelpOutput.textContent = data.text || prettyJson(data.raw);
    } catch(e){
        geminiCliHelpOutput.textContent = e.message || String(e);
    }
}
function currentProviderApiKey(item){
    if(item?.id === 'runninghub'){
        return rhWalletKeyInput?.value.trim() || rhFreeKeyInput?.value.trim() || '';
    }
    return keyInput.value.trim();
}
function normalizeImageRequestMode(value){
    const mode = String(value || '').trim().toLowerCase();
    return ['openai', 'openai-json', 'openai-video-proxy', 'openai-responses'].includes(mode) ? mode : 'openai';
}
function normalizeImageEditRoute(value){
    const route = String(value || '').trim().toLowerCase();
    return ['general', 'auto', 'chat'].includes(route) ? route : 'general';
}
function imageRequestModeLabel(mode){
    const normalized = normalizeImageRequestMode(mode);
    if(normalized === 'openai-json') return 'OpenAI JSON';
    if(normalized === 'openai-video-proxy') return tr('api.openaiProxy');
    if(normalized === 'openai-responses') return 'OpenAI RS';
    return tr('api.openaiStandard');
}
function isRunningHubContext(item, baseUrl=''){
    const protocol = String(protocolInput?.value || item?.protocol || '').trim().toLowerCase();
    const url = String(baseUrl || baseInput?.value || item?.base_url || '').trim().toLowerCase();
    return item?.id === 'runninghub'
        || protocol === 'runninghub'
        || url.includes('runninghub.cn')
        || url.includes('runninghub.ai');
}
function applyDetectedImageRequestMode(mode){
    const item = provider();
    if(!item || !imageRequestModeInput) return false;
    if(applyLockedRecommendedProtocol(item)){
        if(protocolInput) protocolInput.value = item.protocol;
        imageRequestModeInput.value = item.image_request_mode;
        return false;
    }
    const detected = normalizeImageRequestMode(mode);
    const changed = normalizeImageRequestMode(item.image_request_mode) !== detected || normalizeImageRequestMode(imageRequestModeInput.value) !== detected;
    imageRequestModeInput.value = detected;
    item.image_request_mode = detected;
    return changed;
}
function applyDetectedProtocol(protocol){
    const item = provider();
    const detected = String(protocol || '').toLowerCase();
    if(!item || !protocolInput || !API_PROTOCOLS.includes(detected)) return false;
    if(applyLockedRecommendedProtocol(item)){
        protocolInput.value = item.protocol;
        if(imageRequestModeInput) imageRequestModeInput.value = item.image_request_mode;
        return false;
    }
    if(String(protocolInput.value || '').toLowerCase() === detected && String(item.protocol || '').toLowerCase() === detected) return false;
    protocolInput.value = detected;
    item.protocol = detected;
    item.base_url = CLI_PROTOCOLS.has(detected) ? '' : (baseInput?.value.trim() || item.base_url || '');
    if(detected === 'volcengine'){
        item.video_models = unique(item.video_models || []);
        item.volcengine_project_name = item.volcengine_project_name || VOLCENGINE_DEFAULT_PROJECT_NAME;
        item.volcengine_region = item.volcengine_region || VOLCENGINE_DEFAULT_REGION;
    }
    if(detected === 'runninghub'){
        item.base_url = item.base_url || RH_DEFAULT_BASE_URL;
        item.image_models = unique(item.image_models || []);
        item.chat_models = unique(item.chat_models || []);
        item.video_models = unique(item.video_models || []);
    }
    applyCliProtocolDefaults(item, detected);
    dispatchSelectionChange(protocolInput);
    return true;
}

function runninghubModelSourceNote(data){
    const raw = data?.raw || {};
    const source = String(raw.source || '').toLowerCase();
    const sourceLabel = source === 'openapi'
        ? tr('api.sourceOfficial')
        : source === 'github'
        ? tr('api.sourceGithub')
        : source === 'local'
        ? tr('api.sourceLocal')
        : source === 'llm'
        ? tr('api.sourceGateway')
        : source === 'fallback'
        ? tr('api.sourceFallback')
        : '';
    const parts = [];
    if(sourceLabel) parts.push(trf('api.sourceLabel', {source: sourceLabel}));
    if(raw.openapi_count !== undefined) parts.push(trf('api.directModels', {count: Number(raw.openapi_count || 0)}));
    if(raw.llm_count !== undefined) parts.push(`LLM ${Number(raw.llm_count || 0)}`);
    const text = parts.join(' · ');
    const warning = source === 'fallback' ? tr('api.incompleteOfficialModels') : '';
    return text ? ` · ${text}${warning}` : '';
}

async function testConnection(){
    const item = provider();
    if(!item) return;
    const btn = document.getElementById('testUrlBtn');
    const baseUrl = baseInput.value.trim();
    const isJimeng = (protocolInput?.value || '') === 'jimeng';
    const currentProtocol = String(protocolInput?.value || item.protocol || '').toLowerCase();
    const isCliProtocol = CLI_PROTOCOLS.has(currentProtocol);
    if(!baseUrl && !isJimeng && !isCliProtocol){ showError(tr('api.baseUrlRequired')); return; }
    if(btn) btn.loading = true;
    setStatus(tr('api.testingUrl'));
    try {
        const apiKey = currentProviderApiKey(item);
        const runninghubContext = isRunningHubContext(item, baseUrl);
        const data = await fetch('/api/providers/test-connection', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                base_url: baseUrl,
                api_key: apiKey,
                provider_id: runninghubContext ? 'runninghub' : item.id,
                protocol: runninghubContext ? 'runninghub' : (protocolInput?.value || 'openai'),
                image_request_mode: imageRequestModeInput?.value || item.image_request_mode || 'openai'
            })
        }).then(async r => {
            if(!r.ok) throw new Error((await r.json()).detail || tr('api.urlInvalid'));
            return r.json();
        });
        if(data.ok){
            const detectedProtocol = String(data.protocol || '').toLowerCase();
            if(detectedProtocol && detectedProtocol !== String(protocolInput?.value || '').toLowerCase()){
                applyDetectedProtocol(detectedProtocol);
            }
            if(data.image_request_mode) applyDetectedImageRequestMode(data.image_request_mode);
            // 存入 picker 状态并启用「选择模型」按钮，但不自动弹出
            lastFetchedAll = data.all || [];
            lastFetchedSuggestion = {
                image: new Set(data.image_models || []),
                chat: new Set(data.chat_models || []),
                video: new Set(data.video_models || []),
            };
            const openBtn = document.getElementById('openPickerBtn');
            if(openBtn) openBtn.disabled = false;
            const isRunningHubNow = runninghubContext || detectedProtocol === 'runninghub';
            const isVolcengineNow = !isRunningHubNow && (detectedProtocol === 'volcengine' || isVolcengineProvider(item));
            const volcengineNote = isVolcengineNow
                ? `${detectedProtocol === 'volcengine' ? tr('api.volcengineDetected') : ''}${tr('api.volcengineProtocolHint')}`
                : '';
            const jimengNote = isJimeng ? tr('api.jimengReady') : '';
            const codexNote = currentProtocol === 'codex' ? tr('api.codexReady') : '';
            const geminiCliNote = currentProtocol === 'gemini-cli' ? tr('api.antigravityReady') : '';
            const imageModeNote = ` · ${tr('api.imageInterface')}: ${imageRequestModeLabel(imageRequestModeInput?.value || item.image_request_mode)}`;
            const runninghubNote = isRunningHubNow
                ? ` · RunningHub OpenAPI${runninghubModelSourceNote(data)}`
                : imageModeNote;
            const verificationNotes = [volcengineNote, jimengNote, codexNote, geminiCliNote].filter(Boolean);
            markCurrentProviderVerified();
            await requestAutoSave();
            showVerificationToast(`${trf('api.urlVerifiedModels', {count: data.model_count, note: runninghubNote})}${verificationNotes.length ? ` · ${verificationNotes.join(' · ')}` : ''}`, 'success');
        } else {
            markProviderUnverified();
            if(!autoSaveState.dirty) setAutoSavePhase('saved');
            showVerificationToast(`${trf('api.urlVerifyFailedHttp', {status: data.status})} ${(data.message || '').slice(0,200)}`, 'danger');
        }
    } catch(e){
        markProviderUnverified();
        if(!autoSaveState.dirty) setAutoSavePhase('saved');
        showVerificationToast(`⚠ ${e.message || String(e)}`, 'danger');
    } finally {
        if(btn) btn.loading = false;
    }
}
let lastFetchedAll = [];          // 全部模型 id 列表
let lastFetchedSuggestion = null; // 后端自动分类建议
let lastFetchedModelNames = {};   // {模型 id: 展示名}

function setFetchedModelState(data){
    lastFetchedAll = Array.isArray(data?.all) ? data.all : [];
    lastFetchedSuggestion = {
        image: new Set(data?.image_models || []),
        chat: new Set(data?.chat_models || []),
        video: new Set(data?.video_models || []),
    };
    lastFetchedModelNames = (data?.model_names && typeof data.model_names === 'object') ? {...data.model_names} : {};
}
const RH_KNOWN_MODEL_LABELS = {
    'gpt-image-2.0/text-to-image-channel-low-price':'api.rhLabelGpt2TextLow',
    'gpt-image-2.0/edit-channel-low-price':'api.rhLabelGpt2EditLow',
    'gpt-image-2/text-to-image-official-stable':'api.rhLabelGpt2TextStable',
    'gpt-image-2/image-to-image-official-stable':'api.rhLabelGpt2ImageStable',
    'nano-banana/text-to-image-official-stable':'api.rhLabelNanoTextStable',
    'nano-banana/image-to-image-official-stable':'api.rhLabelNanoImageStable',
    'nano-banana-pro/text-to-image-official-stable':'api.rhLabelNanoProTextStable',
    'nano-banana-pro/image-to-image-official-stable':'api.rhLabelNanoProImageStable',
};
function isRunningHubLike(item){
    const base = String(item?.base_url || '').toLowerCase();
    return item?.id === 'runninghub' || String(item?.protocol || '').toLowerCase() === 'runninghub' || base.includes('runninghub.cn');
}
function rhActionLabel(text){
    const value = String(text || '').toLowerCase().replace(/[_/-]+/g, ' ');
    if(/start\s+end\s+to\s+video/.test(value)) return tr('api.actionStartEndVideo');
    if(/multimodal\s+video/.test(value)) return tr('api.actionMultimodalVideo');
    if(/image\s+to\s+video|图生视频/.test(value)) return tr('api.actionImageVideo');
    if(/text\s+to\s+video|文生视频/.test(value)) return tr('api.actionTextVideo');
    if(/image\s+to\s+image|image\s+edit|edit|图生图|图片编辑/.test(value)) return tr('api.actionImageEdit');
    if(/text\s+to\s+image|文生图/.test(value)) return tr('api.actionTextImage');
    return '';
}
function runningHubReadableModelName(model, item){
    const raw = String(model || '').trim();
    if(!raw) return '';
    const saved = item?.model_names && typeof item.model_names === 'object' ? item.model_names[raw] : '';
    if(saved && saved !== raw) return saved;
    const fetched = lastFetchedModelNames?.[raw];
    if(fetched && fetched !== raw) return fetched;
    if(RH_KNOWN_MODEL_LABELS[raw]) return tr(RH_KNOWN_MODEL_LABELS[raw]);
    const lower = raw.toLowerCase();
    const action = rhActionLabel(raw);
    const normalized = raw.replace(/[_/-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if(lower.includes('alibaba') || lower.includes('wan-') || lower.includes('wan ')){
        const version = (normalized.match(/wan\s*(\d+(?:\.\d+)?)/i) || [])[1];
        return `${tr('api.vendorAliWan')}${version ? ' ' + version : ''}${action ? ' · ' + action : ''}`;
    }
    if(lower.includes('bytedance') || lower.includes('jimeng')){
        const version = (normalized.match(/jimeng\s*(\d+(?:\.\d+)?)/i) || [])[1];
        return `${tr('api.vendorByteJimeng')}${version ? ' ' + version : ''}${action ? ' · ' + action : ''}`;
    }
    if(lower.includes('seedance')){
        const version = (normalized.match(/seedance\s*(\d+(?:\.\d+)?)/i) || [])[1];
        const fast = /fast/i.test(raw) ? ' · Fast' : '';
        return `Seedance${version ? ' · ' + version : ''}${fast}${action ? ' · ' + action : ''}`;
    }
    if(lower.includes('kling')) return `${tr('api.vendorKling')}${normalized.match(/\d+(?:\.\d+)?/) ? ' ' + normalized.match(/\d+(?:\.\d+)?/)[0] : ''}${/standard/i.test(raw) ? ` ${tr('api.standardEdition')}` : ''}${action ? ' · ' + action : ''}`;
    if(lower.includes('hailuo')) return `${tr('api.vendorHailuo')}${action ? ' · ' + action : ''}`;
    if(lower.includes('luma')) return normalized.replace(/^luma/i, 'Luma').replace(/\bimage edit\b/i, tr('api.actionImageEdit')).replace(/\bimage to video\b/i, tr('api.actionImageVideo')).replace(/\btext to video\b/i, tr('api.actionTextVideo'));
    if(lower.includes('vidu')) return normalized.replace(/^vidu/i, 'Vidu').replace(/\bimage edit\b/i, tr('api.actionImageEdit')).replace(/\bimage to video\b/i, tr('api.actionImageVideo')).replace(/\btext to video\b/i, tr('api.actionTextVideo'));
    if(lower.includes('gpt-image-2')) return `${tr('api.allroundImageG2')}${action ? ' · ' + action : ''}`;
    if(lower.includes('nano-banana-pro')) return `${tr('api.allroundImagePro')}${action ? ' · ' + action : ''}`;
    if(lower.includes('nano-banana')) return `${tr('api.allroundImage')}${action ? ' · ' + action : ''}`;
    if(lower.includes('qwen-image')) return `${tr('api.qwenImage')}${lower.includes('pro') ? ' Pro' : ''}${action ? ' · ' + action : ''}`;
    if(lower.includes('seedream')) return `${tr('api.jimengSeedream')}${action ? ' · ' + action : ''}`;
    return raw;
}
function modelDisplayName(model, item){
    return isRunningHubLike(item) ? runningHubReadableModelName(model, item) : String(model || '');
}
function modelVendorIconMarkup(model, item = provider()){
    return window.ModelVendorIcons?.markup(model, item?.id, item?.name) || '';
}
function providerModelBadge(model, label){
    const text = `${model || ''} ${label || ''}`.toLowerCase();
    if(text.includes('gpt-image')) return 'G';
    if(text.includes('nano')) return 'N';
    if(text.includes('qwen')) return 'Q';
    if(text.includes('seedream')) return 'S';
    if(text.includes('seedance')) return 'SD';
    if(text.includes('wan') || text.includes('万相')) return 'W';
    if(text.includes('jimeng') || text.includes('即梦')) return 'J';
    if(text.includes('luma')) return 'L';
    if(text.includes('vidu')) return 'V';
    if(text.includes('alibaba') || text.includes('阿里')) return 'A';
    if(text.includes('bytedance') || text.includes('字节')) return 'B';
    return 'RH';
}

async function fetchModels(){
    const item = provider();
    if(!item) return;
    syncEditor();
    const btn = document.getElementById('fetchModelsBtn');
    const baseUrl = baseInput.value.trim();
    const apiKey = currentProviderApiKey(item);
    const isJimeng = (protocolInput?.value || '') === 'jimeng';
    const isCliProtocol = CLI_PROTOCOLS.has(String(protocolInput?.value || item.protocol || '').toLowerCase());
    if(!baseUrl && !isJimeng && !isCliProtocol){ showError(tr('api.baseUrlRequired')); return; }
    if(btn){ btn.disabled = true; btn.querySelector('span').textContent = tr('api.fetchingModels'); }
    setStatus(tr('api.fetchingUpstreamModels'));
    try {
        const runninghubContext = isRunningHubContext(item, baseUrl);
        const data = await fetch('/api/providers/fetch-models', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                base_url:baseUrl,
                api_key:apiKey,
                provider_id:runninghubContext ? 'runninghub' : item.id,
                protocol:runninghubContext ? 'runninghub' : (protocolInput?.value || 'openai'),
                image_request_mode:imageRequestModeInput?.value || item.image_request_mode || 'openai'
            })
        }).then(async r => {
            if(!r.ok) throw new Error((await r.json()).detail || tr('api.fetchFailed'));
            return r.json();
        });
        setFetchedModelState(data);
        const detectedProtocol = String(data.protocol || '').toLowerCase();
        if(detectedProtocol && detectedProtocol !== String(protocolInput?.value || '').toLowerCase()){
            applyDetectedProtocol(detectedProtocol);
        }
        if(data.image_request_mode) applyDetectedImageRequestMode(data.image_request_mode);
        // 启用「选择模型」按钮，并 statusbar 显示已拉取数量
        const openBtn = document.getElementById('openPickerBtn');
        if(openBtn) openBtn.disabled = false;
        const extra = (runninghubContext || detectedProtocol === 'runninghub' || item.id === 'runninghub')
            ? ` · RunningHub OpenAPI${runninghubModelSourceNote(data)}`
            : (detectedProtocol === 'volcengine' || isVolcengineProvider(item)) ? tr('api.arkDetectedHint') : '';
        const imageModeExtra = normalizeImageRequestMode(imageRequestModeInput?.value || item.image_request_mode) === 'openai-json' ? tr('api.openaiJsonSet') : '';
        setStatus(trf('api.modelsFetched', {count: data.total, extra: `${extra}${imageModeExtra}`}), 'success');
        openModelPicker();
    } catch(e){
        showError(`${tr('api.fetchFailed')}: ${e.message || e}`);
    } finally {
        if(btn){ btn.disabled = false; btn.querySelector('span').textContent = tr('api.fetchModels'); }
    }
}

// —— 模型选择器浮层 ——
// 每个模型只归一类（根据用户已配置 或 关键字猜测）；勾选 = 纳入该分类
let pickerState = { category: {}, selected: {} };
let pickerVisibleIds = [];
let pickerFilterValue = '';
function openModelPicker(){
    const item = provider();
    if(!item || !lastFetchedAll.length){ showError(tr('api.noFetchedModels')); return; }
    const existing = { image: new Set(item.image_models||[]), chat: new Set(item.chat_models||[]), video: new Set(item.video_models||[]) };
    const allIds = new Set([...lastFetchedAll, ...(item.image_models||[]), ...(item.chat_models||[]), ...(item.video_models||[])]);
    pickerState = { category: {}, selected: {} };
    allIds.forEach(id => {
        // 类别归属：用户已配置 > 关键字建议 > 默认 chat
        let cat;
        if(existing.image.has(id)) cat = 'image';
        else if(existing.video.has(id)) cat = 'video';
        else if(existing.chat.has(id)) cat = 'chat';
        else if(lastFetchedSuggestion?.image?.has(id)) cat = 'image';
        else if(lastFetchedSuggestion?.video?.has(id)) cat = 'video';
        else cat = 'chat';
        pickerState.category[id] = cat;
        // 默认勾选状态：已在用户配置里的 = 勾选；新拉的 = 不勾选（让用户主动选）
        pickerState.selected[id] = existing.image.has(id) || existing.chat.has(id) || existing.video.has(id);
    });
    // 默认 tab 切回「全部」
    const tabs = document.getElementById('pickerCategoryTabs');
    if(tabs) tabs.setAttribute('value', 'all');
    pickerFilterValue = '';
    const filterInput = document.getElementById('pickerFilter');
    if(filterInput) filterInput.value = '';
    document.getElementById('modelPickerOverlay')?.show();
    renderModelPicker();
}
function closeModelPicker(){ document.getElementById('modelPickerOverlay')?.hide('cancel'); }
function renderModelPicker(event){
    const item = provider();
    if(event) pickerFilterValue = eventControlValue(event, document.getElementById('pickerFilter'));
    const filter = pickerFilterValue.toLowerCase();
    const currentTab = document.getElementById('pickerCategoryTabs')?.getAttribute('value') || 'all';
    const ids = Object.keys(pickerState.category).sort();
    // 各分类总数 / 已选数
    const totals = { all: ids.length, image:0, chat:0, video:0 };
    const selecteds = { all:0, image:0, chat:0, video:0 };
    ids.forEach(id => {
        const cat = pickerState.category[id];
        totals[cat]++;
        if(pickerState.selected[id]){ selecteds[cat]++; selecteds.all++; }
    });
    // 过滤显示
    const list = ids.filter(id => {
        const label = modelDisplayName(id, item);
        if(filter && !id.toLowerCase().includes(filter) && !label.toLowerCase().includes(filter)) return false;
        if(currentTab === 'all') return true;
        return pickerState.category[id] === currentTab;
    });
    pickerVisibleIds = list;
    document.getElementById('pickerCount').textContent = trf('api.modelPickerCount', {total: totals.all, shown: list.length});
    const categoryLabels = {
        all: tr('api.all'),
        image: tr('api.imageGeneration'),
        chat: 'LLM',
        video: tr('api.videoModels'),
    };
    document.querySelectorAll('#pickerCategoryTabs > [data-cat]').forEach(tab => {
        const cat = tab.dataset.cat;
        tab.textContent = `${categoryLabels[cat]} ${selecteds[cat]}/${totals[cat]}`;
    });
    // 语义化多选清单：表格负责稳定列，Checkbox 负责选择状态。
    const rows = list.map((id, index) => {
        const checked = pickerState.selected[id];
        const label = modelDisplayName(id, item);
        const badge = providerModelBadge(id, label);
        return `
            <tr>
                <td><span class="model-picker-name">${modelVendorIconMarkup(id, item)}<ic-checkbox label="${escapeAttr(label || id)}" ${checked ? 'checked' : ''} onchange="setPickerRowSelectionByIndex(${index}, event)"></ic-checkbox></span></td>
                <td class="model-picker-id" title="${escapeAttr(id)}">${escapeHtml(id)}</td>
                <td><ic-badge kind="label" tone="neutral">${escapeHtml(categoryLabels[pickerState.category[id]])}</ic-badge></td>
                <td><ic-badge kind="label" tone="neutral">${escapeHtml(badge)}</ic-badge></td>
            </tr>
        `;
    }).join('');
    document.getElementById('pickerList').innerHTML = `
        <table>
            <caption class="visually-hidden">${escapeHtml(tr('api.upstreamModels'))}</caption>
            <thead><tr>
                <th scope="col">${escapeHtml(tr('api.modelName'))}</th>
                <th scope="col">${escapeHtml(tr('api.modelId'))}</th>
                <th scope="col">${escapeHtml(tr('api.modelType'))}</th>
                <th scope="col">${escapeHtml(tr('api.modelSeries'))}</th>
            </tr></thead>
            <tbody>${rows || `<tr><td colspan="4"><ic-empty-state title="${escapeAttr(tr('api.noMatches'))}" label="${escapeAttr(tr('api.noMatches'))}">${escapeHtml(tr('api.searchModels'))}</ic-empty-state></td></tr>`}</tbody>
        </table>
    `;
    // 底部汇总
    const sumImage = document.getElementById('sumImage');
    const sumChat = document.getElementById('sumChat');
    const sumVideo = document.getElementById('sumVideo');
    const sumUnsel = document.getElementById('sumUnsel');
    if(sumImage){ sumImage.textContent = trf('api.imageSummary', {count:selecteds.image}); sumImage.setAttribute('tone', selecteds.image ? 'success' : 'neutral'); }
    if(sumChat){ sumChat.textContent = trf('api.chatSummary', {count:selecteds.chat}); sumChat.setAttribute('tone', selecteds.chat ? 'success' : 'neutral'); }
    if(sumVideo){ sumVideo.textContent = trf('api.videoSummary', {count:selecteds.video}); sumVideo.setAttribute('tone', selecteds.video ? 'success' : 'neutral'); }
    if(sumUnsel){ sumUnsel.textContent = trf('api.unselectedSummary', {count:totals.all - selecteds.all}); }
}
function togglePickerRow(id){
    pickerState.selected[id] = !pickerState.selected[id];
    renderModelPicker();
}
function togglePickerRowByIndex(index){
    const id = pickerVisibleIds[index];
    if(typeof id !== 'string') return;
    togglePickerRow(id);
}
function setPickerRowSelectionByIndex(index, event){
    const id = pickerVisibleIds[index];
    if(typeof id !== 'string') return;
    pickerState.selected[id] = Boolean(event?.currentTarget?.checked);
    renderModelPicker();
}
function selectPickerCat(cat){
    const tabs = document.getElementById('pickerCategoryTabs');
    if(tabs) tabs.setAttribute('value', cat);
    renderModelPicker();
}
function applyModelPicker(){
    const item = provider(); if(!item) return;
    const image = [], chat = [], video = [];
    const modelNames = {};
    Object.entries(pickerState.selected).forEach(([id, sel]) => {
        if(!sel) return;
        const cat = pickerState.category[id];
        if(cat === 'image') image.push(id);
        else if(cat === 'video') video.push(id);
        else chat.push(id);
        const label = modelDisplayName(id, item);
        if(label && label !== id) modelNames[id] = label;
    });
    item.image_models = image;
    item.chat_models = chat;
    item.video_models = video;
    item.model_names = modelNames;
    renderModels('image'); renderModels('chat'); renderModels('video');
    renderMsLoras();
    setStatus(trf('api.modelsApplied', {image: image.length, chat: chat.length, video: video.length}), 'success');
    closeModelPicker();
    requestAutoSave();
}
async function saveKeyOnly(){
    const item = provider();
    if(!item) return;
    const key = keyInput.value.trim();
    if(!key){ showError(tr('api.enterKeyAlert')); return; }
    item.api_key = key;
    const ok = await saveProviders();
    if(ok) keyInput.value = '';
}
function requestConfirmationDialog(dialog, {label, description, confirmLabel, consequence='destructive'}={}){
    if(!dialog) return Promise.resolve(false);
    dialog.label = label || tr('api.confirmActionTitle');
    dialog.description = description || tr('api.confirmActionDescription');
    dialog.cancelLabel = tr('common.cancel');
    dialog.confirmLabel = confirmLabel || tr('common.confirm');
    dialog.consequence = consequence;
    const copy = dialog.querySelector('[data-confirmation-copy]');
    if(copy) copy.textContent = dialog.description;
    return new Promise(resolve => {
        let settled = false;
        const cleanup = () => {
            dialog.removeEventListener('ic-confirm', onConfirm);
            dialog.removeEventListener('ic-cancel', onCancel);
        };
        const finish = async accepted => {
            if(settled) return;
            settled = true;
            cleanup();
            if(accepted) await dialog.hide('confirm');
            resolve(accepted);
        };
        const onConfirm = () => { void finish(true); };
        const onCancel = () => { void finish(false); };
        dialog.addEventListener('ic-confirm', onConfirm);
        dialog.addEventListener('ic-cancel', onCancel);
        dialog.show();
    });
}
function requestApiActionConfirmation(options){
    return requestConfirmationDialog(document.getElementById('apiActionConfirmation'), options);
}
async function clearKeyOnly(){
    const item = provider();
    if(!item) return;
    if(!item.has_key) return;
    if(!await requestApiActionConfirmation({
        label:tr('api.clearKeyTitle'),
        description:tr('api.confirmClearKey'),
        confirmLabel:tr('api.confirmClearAction')
    })) return;
    item._clearKey = true;
    const ok = await requestAutoSave({affectsVerification:true});
    if(ok) keyInput.value = '';
}
const FIXED_PROTOCOL_PROVIDER_IDS = new Set(['modelscope', 'volcengine', 'runninghub']);
function providerSupportsModelProtocol(item){
    return Boolean(item) && !FIXED_PROTOCOL_PROVIDER_IDS.has(item.id);
}
function modelProtocolSelectHtml(kind, index, model, item){
    if(kind === 'video' || !providerSupportsModelProtocol(item)) return '';
    const map = (item.model_protocols && typeof item.model_protocols === 'object') ? item.model_protocols : {};
    const current = String(map[String(model || '').trim()] || '').toLowerCase();
    const opt = (val, label) => `<option value="${val}" ${current === val ? 'selected' : ''}>${label}</option>`;
    return `<ic-select class="model-protocol-select" data-model-kind="${kind}" data-model-index="${index}" name="${kind}_model_protocol_${index}" aria-label="${escapeAttr(tr('api.modelProtocolTitle'))}" title="${escapeAttr(tr('api.modelProtocolTitle'))}">
        <option value="inherit" ${current === '' ? 'selected' : ''}>${escapeHtml(tr('api.default'))}</option>
        ${opt('openai', 'OpenAI')}
        ${opt('gemini', 'Gemini')}
    </ic-select>`;
}
function renderModels(kind){
    const item = provider();
    const key = kind === 'image' ? 'image_models' : kind === 'video' ? 'video_models' : 'chat_models';
    const list = kind === 'image' ? imageModelList : kind === 'video' ? videoModelList : chatModelList;
    const models = item?.[key] || [];
    if(!models.length){
        list.innerHTML = `<ic-empty-state title="${escapeAttr(tr('api.noModels'))}" label="${escapeAttr(tr('api.noModels'))}"></ic-empty-state>`;
        return;
    }
    const showProtocol = kind !== 'video' && providerSupportsModelProtocol(item);
    list.innerHTML = models.map((model, index) => {
        const label = modelDisplayName(model, item);
        const hasModelId = Boolean(String(model || '').trim());
        const modelIdControl = hasModelId
            ? 'readonly'
            : `data-auto-save="setting" oninput="updateModel('${kind}', ${index}, eventControlValue(event, this))"`;
        return `
            <div class="model-row${showProtocol ? ' has-protocol' : ''}" role="listitem">
                <div class="model-entry-identity">
                    ${modelVendorIconMarkup(model, item)}
                    <div class="model-id-field">
                        ${label && label !== model ? `<div class="model-display-name">${escapeHtml(label)}</div>` : ''}
                        <ic-input name="${kind}_model_${index}" type="text" aria-label="${escapeAttr(tr('api.modelId'))}" value="${escapeAttr(model)}" ${modelIdControl}></ic-input>
                    </div>
                </div>
                ${modelProtocolSelectHtml(kind, index, model, item)}
                <ic-icon-button type="button" hierarchy="quiet" tone="danger" icon="delete" label="${escapeAttr(tr('api.delete'))}" onclick="removeModel('${kind}', ${index})"></ic-icon-button>
            </div>
        `;
    }).join('');
    list.querySelectorAll('.model-protocol-select').forEach(select => {
        select.addEventListener('ic-change', event => {
            updateModelProtocol(select.dataset.modelKind, Number(select.dataset.modelIndex), event.detail?.value || select.value);
            requestAutoSave();
        });
    });
}
function selectModelCategory(kind){
    const selected = ['image', 'video', 'chat'].includes(kind) ? kind : 'image';
    document.querySelectorAll('[data-model-category]').forEach(panel => {
        panel.hidden = panel.dataset.modelCategory !== selected;
    });
}
function msLoraTargetOptions(selected){
    const item = provider();
    const models = unique([selected, ...MS_BUILTIN_IMAGE_MODELS, ...((item?.image_models) || [])]);
    return models.filter(Boolean).map(model => `<option value="${escapeAttr(model)}" ${model === selected ? 'selected' : ''}>${escapeHtml(model)}</option>`).join('');
}
function normalizeLoraStrength(value){
    const n = Number(value);
    if(!Number.isFinite(n)) return 0.8;
    return Math.max(0, Math.min(2, n));
}
function renderMsLoras(){
    const item = provider();
    if(!msLoraList || !item || item.id !== 'modelscope') return;
    item.ms_loras = Array.isArray(item.ms_loras) ? item.ms_loras : [];
    if(!item.ms_loras.length){
        msLoraList.innerHTML = `<ic-empty-state title="${escapeAttr(tr('api.loraEmpty'))}" label="${escapeAttr(tr('api.loraEmpty'))}">${escapeHtml(tr('api.loraManagerDesc'))}</ic-empty-state>`;
        return;
    }
    msLoraList.innerHTML = item.ms_loras.map((lora, index) => {
        const target = lora.target_model || lora.model || MS_BUILTIN_IMAGE_MODELS[0];
        const strength = normalizeLoraStrength(lora.strength ?? lora.default_strength ?? 0.8);
        return `
            <div class="lora-row">
                <ic-input class="lora-field" name="lora_id_${index}" type="text" label="${escapeAttr(tr('api.loraId'))}" value="${escapeAttr(lora.id || '')}" placeholder="${escapeAttr(tr('api.loraIdPlaceholder'))}" data-auto-save="setting" oninput="updateMsLora(${index}, 'id', eventControlValue(event, this))"></ic-input>
                <ic-select class="lora-field lora-target-select" data-lora-index="${index}" name="lora_target_${index}" label="${escapeAttr(tr('api.loraTargetModel'))}">${msLoraTargetOptions(target)}</ic-select>
                <ic-number-input class="lora-field" name="lora_strength_${index}" label="${escapeAttr(tr('api.loraDefaultStrength'))}" min="0" max="2" step="0.05" value="${strength}" data-auto-save="setting" oninput="updateMsLora(${index}, 'strength', eventControlValue(event, this))"></ic-number-input>
                <ic-icon-button type="button" hierarchy="quiet" tone="danger" icon="delete" label="${escapeAttr(tr('common.delete'))}" onclick="removeMsLora(${index})"></ic-icon-button>
            </div>
        `;
    }).join('');
    msLoraList.querySelectorAll('.lora-target-select').forEach(select => {
        select.addEventListener('ic-change', event => {
            updateMsLora(Number(select.dataset.loraIndex), 'target_model', event.detail?.value || select.value);
            requestAutoSave();
        });
    });
}
function addMsLora(){
    const item = provider();
    if(!item || item.id !== 'modelscope') return;
    item.ms_loras = Array.isArray(item.ms_loras) ? item.ms_loras : [];
    item.ms_loras.push({
        id:'',
        name:'',
        target_model: (item.image_models || [])[0] || MS_BUILTIN_IMAGE_MODELS[0],
        strength:0.8,
        enabled:true,
        note:''
    });
    renderMsLoras();
    markAutoSaveDirty();
}
function updateMsLora(index, field, value){
    const item = provider();
    if(!item || item.id !== 'modelscope') return;
    item.ms_loras = Array.isArray(item.ms_loras) ? item.ms_loras : [];
    const lora = item.ms_loras[index];
    if(!lora) return;
    if(field === 'strength') lora.strength = normalizeLoraStrength(value);
    else lora[field] = value;
}
function removeMsLora(index){
    const item = provider();
    if(!item || item.id !== 'modelscope') return;
    item.ms_loras = Array.isArray(item.ms_loras) ? item.ms_loras : [];
    item.ms_loras.splice(index, 1);
    renderMsLoras();
    requestAutoSave();
}
function selectProvider(id){
    if(isProviderTemporarilyHidden(providers.find(item => item.id === id))) return;
    if(autoSaveState.dirty && !validAutoSaveInputs()){
        if(providerList){
            providerList.value = selectedId;
            providerList.setAttribute('value', selectedId);
        }
        return;
    }
    syncEditor();
    selectedId = id;
    renderEditor();
    if(autoSaveState.dirty) commitAutoSave();
    else setAutoSavePhase('saved');
}
function addProvider(){
    syncEditor();
    let id = 'custom-api';
    let index = 2;
    while(providers.some(item => item.id === id)) id = `custom-api-${index++}`;
    providers.push({id, name:'API', base_url:'', protocol:'openai', image_request_mode:'openai', image_edit_route:'general', image_generation_endpoint:'', image_edit_endpoint:'', enabled:true, primary:false, image_models:[], chat_models:[], video_models:[], has_key:false, key_preview:''});
    selectedId = id;
    renderEditor();
    requestAutoSave({affectsVerification:true});
}
async function addCliProvider(kind){
    const preset = CLI_PROVIDER_PRESETS[kind];
    if(!preset) return;
    syncEditor();
    let item = providers.find(provider => provider.id === preset.id);
    if(!item) item = providers.find(provider => String(provider.protocol || '').toLowerCase() === preset.protocol);
    if(!item){
        item = {
            id:preset.id,
            name:preset.name,
            base_url:'',
            protocol:preset.protocol,
            image_request_mode:'openai',
            image_edit_route:'general',
            image_generation_endpoint:'',
            image_edit_endpoint:'',
            enabled:true,
            primary:false,
            image_models:[],
            chat_models:[],
            video_models:[],
            model_protocols:{},
            has_key:false,
            key_preview:''
        };
        providers.push(item);
    }
    item.id = preset.id;
    item.name = item.name || preset.name;
    item.base_url = '';
    item.protocol = preset.protocol;
    if(preset.protocol === 'jimeng'){
        applyJimengModelDefaults(item);
        item.chat_models = unique(item.chat_models || []);
    } else {
        applyCliProtocolDefaults(item, preset.protocol);
    }
    selectedId = item.id;
    renderProviderList();
    renderEditor();
    if(protocolInput) protocolInput.value = preset.protocol;
    const ok = await saveProviders();
    if(ok){
        selectedId = item.id;
        renderEditor();
        if(protocolInput) protocolInput.value = preset.protocol;
        setStatus(trf('api.cliProviderAdded', {name: preset.name}), 'success');
    }
}
async function deleteProvider(){
    const item = provider();
    if(!item) return;
    if(isFixedProvider(item)){ showError(tr('api.defaultNoDelete')); return; }
    if(providers.length <= 1){ showError(tr('api.keepOne')); return; }
    if(!await requestApiActionConfirmation({
        label:tr('api.deleteProvider'),
        description:trf('api.confirmDeleteProvider', {name:item.name || item.id}),
        confirmLabel:tr('common.delete')
    })) return;
    providers = providers.filter(p => p.id !== item.id);
    selectedId = providers[0]?.id || '';
    renderEditor();
    requestAutoSave();
}
async function saveRhKeyOnly(kind){
    const item = provider();
    if(!item || item.id !== 'runninghub') return;
    const input = kind === 'wallet' ? rhWalletKeyInput : rhFreeKeyInput;
    const key = input?.value.trim() || '';
    if(!key){ showError(tr('api.enterKeyAlert')); return; }
    syncEditor();
    const ok = await saveProviders();
    if(ok && input) input.value = '';
}
async function clearRhKeyOnly(kind){
    const item = provider();
    if(!item || item.id !== 'runninghub') return;
    if(!await requestApiActionConfirmation({
        label:tr(kind === 'wallet' ? 'api.clearRhWalletKeyTitle' : 'api.clearRhCoinKeyTitle'),
        description:tr('api.confirmClearKey'),
        confirmLabel:tr('api.confirmClearAction')
    })) return;
    if(kind === 'wallet') item._clearWalletKey = true;
    else item._clearKey = true;
    const ok = await requestAutoSave({affectsVerification:true});
    if(ok){
        if(kind === 'wallet' && rhWalletKeyInput) rhWalletKeyInput.value = '';
        if(kind !== 'wallet' && rhFreeKeyInput) rhFreeKeyInput.value = '';
    }
}
async function saveVolcengineAssetKeys(){
    const item = provider();
    if(!item || item.id !== 'volcengine') return;
    const ak = volcAkInput?.value.trim() || '';
    const sk = volcSkInput?.value.trim() || '';
    if(!ak && !sk){ showError(tr('api.enterVolcAssetKey')); return; }
    syncEditor();
    const ok = await saveProviders();
    if(ok){
        if(volcAkInput) volcAkInput.value = '';
        if(volcSkInput) volcSkInput.value = '';
    }
}
async function clearVolcengineAssetKeys(){
    const item = provider();
    if(!item || item.id !== 'volcengine') return;
    if(!await requestApiActionConfirmation({
        label:tr('api.clearVolcAssetKeys'),
        description:tr('api.confirmClearVolcAssetKeys'),
        confirmLabel:tr('api.confirmClearAction')
    })) return;
    item._clearVolcengineAccessKey = true;
    item._clearVolcengineSecretKey = true;
    const ok = await requestAutoSave({affectsVerification:true});
    if(ok){
        if(volcAkInput) volcAkInput.value = '';
        if(volcSkInput) volcSkInput.value = '';
    }
}
function addModel(kind){
    const item = provider();
    const key = kind === 'image' ? 'image_models' : kind === 'video' ? 'video_models' : 'chat_models';
    item[key] = [...(item[key] || []), ''];
    renderModels(kind);
    if(kind === 'image') renderMsLoras();
    markAutoSaveDirty();
}
function modelProtocolStillUsed(item, name){
    if(!item || !name) return false;
    const lists = ['image_models', 'chat_models', 'video_models'];
    return lists.some(k => Array.isArray(item[k]) && item[k].includes(name));
}
function updateModel(kind, index, value){
    const item = provider();
    const key = kind === 'image' ? 'image_models' : kind === 'video' ? 'video_models' : 'chat_models';
    const oldName = String(item[key][index] || '').trim();
    const newName = String(value || '').trim();
    item[key][index] = value;
    // 重命名时迁移该模型的协议覆盖
    if(item.model_protocols && typeof item.model_protocols === 'object' && oldName && oldName !== newName){
        if(Object.prototype.hasOwnProperty.call(item.model_protocols, oldName)){
            const proto = item.model_protocols[oldName];
            // 旧名称在其他列表里不再使用时才删除旧键
            const stillUsedElsewhere = (() => {
                const lists = ['image_models', 'chat_models', 'video_models'];
                return lists.some(k => Array.isArray(item[k]) && item[k].some((m, i) => !(k === key && i === index) && String(m || '').trim() === oldName));
            })();
            if(!stillUsedElsewhere) delete item.model_protocols[oldName];
            if(newName) item.model_protocols[newName] = proto;
        }
    }
    if(item.model_names && typeof item.model_names === 'object' && oldName && oldName !== newName){
        if(Object.prototype.hasOwnProperty.call(item.model_names, oldName)){
            const label = item.model_names[oldName];
            if(!modelProtocolStillUsed(item, oldName)) delete item.model_names[oldName];
            if(newName && label && label !== newName) item.model_names[newName] = label;
        }
    }
    if(kind === 'image') renderMsLoras();
}
function updateModelProtocol(kind, index, value){
    const item = provider();
    const key = kind === 'image' ? 'image_models' : kind === 'video' ? 'video_models' : 'chat_models';
    const name = String(item[key]?.[index] || '').trim();
    if(!name) return;
    if(!item.model_protocols || typeof item.model_protocols !== 'object') item.model_protocols = {};
    const proto = String(value || '').trim().toLowerCase();
    if(proto === 'openai' || proto === 'gemini'){
        item.model_protocols[name] = proto;
    } else {
        delete item.model_protocols[name];
    }
}
function removeModel(kind, index){
    const item = provider();
    const key = kind === 'image' ? 'image_models' : kind === 'video' ? 'video_models' : 'chat_models';
    const removed = String(item[key][index] || '').trim();
    item[key].splice(index, 1);
    // 清理不再使用的协议覆盖
    if(removed && item.model_protocols && typeof item.model_protocols === 'object' && !modelProtocolStillUsed(item, removed)){
        delete item.model_protocols[removed];
    }
    if(removed && item.model_names && typeof item.model_names === 'object' && !modelProtocolStillUsed(item, removed)){
        delete item.model_names[removed];
    }
    renderModels(kind);
    if(kind === 'image') renderMsLoras();
    requestAutoSave();
}
async function loadProviders(){
    setStatus(tr('api.loading'));
    try {
        const data = await fetch('/api/providers', {cache:'no-store'}).then(r => r.json());
        providers = data.providers || [];
        selectedId = sortedProviders()[0]?.id || '';
        renderEditor();
        autoSaveState.dirty = false;
        autoSaveState.lastError = '';
        setAutoSavePhase('saved');
        setStatus('');
    } catch(err) {
        autoSaveState.lastError = tr('api.loadFailed');
        setAutoSavePhase('error');
        setStatus(tr('api.loadFailed'), 'danger');
    }
}
function apiSettingsImportInput(){
    return document.getElementById('apiSettingsImportInput');
}
let apiTransferPasswordResolve = null;
let apiTransferNeedsConfirmation = false;
function closeApiTransferPassword(value=null){
    const dialog = document.getElementById('apiTransferDialog');
    if(dialog?.open) dialog.hide(value === null ? 'cancel' : 'submit');
    const password = document.getElementById('apiTransferPassword');
    const confirmation = document.getElementById('apiTransferPasswordConfirm');
    if(password) password.value = '';
    if(confirmation) confirmation.value = '';
    const resolve = apiTransferPasswordResolve;
    apiTransferPasswordResolve = null;
    apiTransferNeedsConfirmation = false;
    if(resolve) resolve(value);
}
function submitApiTransferPassword(event){
    event?.preventDefault?.();
    const password = document.getElementById('apiTransferPassword')?.value || '';
    const confirmation = document.getElementById('apiTransferPasswordConfirm')?.value || '';
    if(password.length < 8){
        showError(tr('api.passwordMin'));
        return;
    }
    if(password.length > 256){
        showError(tr('api.passwordMax'));
        return;
    }
    if(apiTransferNeedsConfirmation && password !== confirmation){
        showError(tr('api.passwordMismatch'));
        return;
    }
    closeApiTransferPassword(password);
}
function requestApiTransferPassword({title, description, confirmPassword=false}={}){
    if(apiTransferPasswordResolve) closeApiTransferPassword(null);
    const dialog = document.getElementById('apiTransferDialog');
    const password = document.getElementById('apiTransferPassword');
    const confirmation = document.getElementById('apiTransferPasswordConfirm');
    const confirmationField = document.getElementById('apiTransferConfirmField');
    if(!dialog || !password || !confirmation) return Promise.resolve(null);
    document.getElementById('apiTransferTitle').textContent = title || tr('api.encryptedPackage');
    dialog.label = title || tr('api.encryptedPackage');
    document.getElementById('apiTransferDescription').textContent = description || '';
    apiTransferNeedsConfirmation = Boolean(confirmPassword);
    confirmationField.hidden = !apiTransferNeedsConfirmation;
    password.value = '';
    confirmation.value = '';
    dialog.show();
    return new Promise(resolve => {
        apiTransferPasswordResolve = resolve;
    });
}
async function encryptedApiError(res, fallback){
    const data = await res.json().catch(() => ({}));
    return data.detail || data.message || fallback;
}
async function exportEncryptedApiSettings(){
    const password = await requestApiTransferPassword({
        title:tr('api.exportPackageTitle'),
        description:tr('api.exportPackageDesc'),
        confirmPassword:true
    });
    if(password === null) return;
    setStatus(tr('api.generatingPackage'));
    try {
        const res = await fetch('/api/providers/export-encrypted', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({password})
        });
        if(!res.ok) throw new Error(await encryptedApiError(res, tr('api.exportFailed')));
        const blob = await res.blob();
        const disposition = res.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename="?([^";]+)"?/i);
        const filename = match?.[1] || `infinite-canvas-api-settings-${Date.now()}.icapi`;
        const href = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = href;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
        setStatus(tr('api.packageExported'), 'success');
    } catch(err){
        setStatus(err.message || tr('api.packageExportFailed'), 'danger');
    }
}
function chooseEncryptedApiSettings(){
    const input = apiSettingsImportInput();
    if(!input) return;
    input.clear({silent:true});
    input.open();
}
function requestApiImportConfirmation(){
    const dialog = document.getElementById('apiImportConfirmation');
    return requestConfirmationDialog(dialog, {
        label:tr('api.confirmImportTitle'),
        description:tr('api.confirmPackageImport'),
        confirmLabel:tr('api.confirmImportAction'),
        consequence:'neutral'
    });
}
async function importEncryptedApiSettings(file){
    if(!file) return;
    const password = await requestApiTransferPassword({
        title:tr('api.importPackageTitle'),
        description:trf('api.importPackageDesc', {file: file.name}),
        confirmPassword:false
    });
    if(password === null) return;
    if(!await requestApiImportConfirmation()) return;
    const existingIds = new Set((providers || []).map(item => String(item?.id || '')));
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('password', password);
    setStatus(tr('api.importingPackage'));
    try {
        const res = await fetch('/api/providers/import-encrypted', {
            method:'POST',
            body:form
        });
        const data = await res.json().catch(() => ({}));
        if(!res.ok) throw new Error(data.detail || data.message || tr('api.importFailed'));
        const imported = Array.isArray(data.imported) ? data.imported : [];
        const added = Array.isArray(data.added)
            ? data.added
            : imported.filter(item => !existingIds.has(String(item?.id || '')));
        const updated = Array.isArray(data.updated)
            ? data.updated
            : imported.filter(item => existingIds.has(String(item?.id || '')));
        const addedNames = added.map(item => item.name || item.id).filter(Boolean);
        const updatedNames = updated.map(item => item.name || item.id).filter(Boolean);
        if(Array.isArray(data.providers)){
            providers = data.providers;
        } else {
            const refreshed = await fetch('/api/providers', {cache:'no-store'}).then(r => {
                if(!r.ok) throw new Error(tr('api.importRefreshFailed'));
                return r.json();
            });
            providers = refreshed.providers || [];
        }
        selectedId = added[0]?.id || imported[0]?.id || sortedProviders()[0]?.id || '';
        renderEditor();
        broadcastStudioApiChange('providers-changed');
        const addedText = addedNames.length
            ? trf('api.addedProviders', {count: addedNames.length, names: addedNames.join(', ')})
            : tr('api.noProvidersAdded');
        const updatedText = updatedNames.length
            ? trf('api.updatedProviders', {count: updatedNames.length, names: updatedNames.join(', ')})
            : '';
        setStatus([addedText, updatedText].filter(Boolean).join(tr('api.messageSeparator')), 'success');
    } catch(err){
        setStatus(err.message || tr('api.packageImportFailed'), 'danger');
    }
}
async function saveProviders({silent=false, expectedRevision=null}={}){
    syncEditor();
    providers.forEach(item => {
        item.id = normalizeId(item.id);
        applyLockedRecommendedProtocol(item);
        item.protocol = item.id === 'runninghub'
            ? 'runninghub'
            : item.id === 'volcengine'
            ? 'volcengine'
            : API_PROTOCOLS.includes(String(item.protocol || '').toLowerCase()) ? String(item.protocol).toLowerCase() : 'openai';
        const isCliProtocol = CLI_PROTOCOLS.has(item.protocol);
        item.image_request_mode = normalizeImageRequestMode(
            item.id === 'modelscope' || item.id === 'runninghub' || item.id === 'volcengine' || isCliProtocol
                ? 'openai'
                : item.image_request_mode
        );
        item.image_edit_route = normalizeImageEditRoute(
            item.id === 'modelscope' || item.id === 'runninghub' || item.id === 'volcengine' || isCliProtocol
                ? 'general'
                : item.image_edit_route
        );
        if(isCliProtocol) applyCliProtocolDefaults(item, item.protocol);
        if(item.id === 'runninghub'){
            item.base_url = item.base_url || RH_DEFAULT_BASE_URL;
            item.image_models = unique(item.image_models || []);
            item.chat_models = unique(item.chat_models || []);
            item.video_models = unique(item.video_models || []);
        }
        item.image_generation_endpoint = '';
        item.image_edit_endpoint = '';
        item.image_models = unique(item.image_models || []);
        item.chat_models = unique(item.chat_models || []);
        item.video_models = unique(item.video_models || []);
        const modelNameSource = (item.model_names && typeof item.model_names === 'object') ? item.model_names : {};
        const modelNameMap = {};
        [...item.image_models, ...item.chat_models, ...item.video_models].forEach(model => {
            const raw = String(model || '').trim();
            const label = String(modelNameSource[raw] || modelDisplayName(raw, item) || '').trim();
            if(raw && label && label !== raw) modelNameMap[raw] = label;
        });
        item.model_names = modelNameMap;
        item.rh_apps = normalizeRhEntries(item.rh_apps || [], 'app');
        item.rh_workflows = normalizeRhEntries(item.rh_workflows || [], 'workflow');
        item.ms_loras = (Array.isArray(item.ms_loras) ? item.ms_loras : []).map(lora => ({
            id:String(lora.id || '').trim(),
            name:String(lora.name || lora.id || '').trim(),
            target_model:String(lora.target_model || '').trim(),
            strength:normalizeLoraStrength(lora.strength ?? 0.8),
            enabled:lora.enabled !== false,
            note:String(lora.note || '').trim()
        })).filter(lora => lora.id && lora.target_model);
    });
    if(new Set(providers.map(item => item.id)).size !== providers.length){
        showError(tr('api.duplicateId'));
        return false;
    }
    if(!silent) setStatus(tr('api.saving'));
    try {
        const res = await fetch('/api/providers', {
            method:'PUT',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(providers.map(item => ({
                id:item.id,
                name:item.name,
                base_url:item.base_url,
                protocol:(item.id === 'modelscope') ? 'openai' : item.id === 'runninghub' ? 'runninghub' : item.id === 'volcengine' ? 'volcengine' : (item.protocol || 'openai'),
                image_request_mode:item.image_request_mode || 'openai',
                image_edit_route:item.image_edit_route || 'general',
                image_generation_endpoint:item.image_generation_endpoint || '',
                image_edit_endpoint:item.image_edit_endpoint || '',
                enabled:item.enabled !== false,
                primary:false,
                image_models:item.image_models || [],
                chat_models:item.chat_models || [],
                video_models:item.video_models || [],
                model_names:(item.model_names && typeof item.model_names === 'object') ? item.model_names : {},
                model_protocols:(item.model_protocols && typeof item.model_protocols === 'object') ? item.model_protocols : {},
                ms_loras:item.id === 'modelscope' ? (item.ms_loras || []) : [],
                ms_defaults_version:item.id === 'modelscope' ? (item.ms_defaults_version || 1) : 0,
                rh_apps:item.id === 'runninghub' ? (item.rh_apps || []) : [],
                rh_workflows:item.id === 'runninghub' ? (item.rh_workflows || []) : [],
                volcengine_project_name:item.id === 'volcengine' ? (item.volcengine_project_name || VOLCENGINE_DEFAULT_PROJECT_NAME) : '',
                volcengine_region:item.id === 'volcengine' ? (item.volcengine_region || VOLCENGINE_DEFAULT_REGION) : '',
                volcengine_access_key_id:item.volcengine_access_key_id || undefined,
                volcengine_secret_access_key:item.volcengine_secret_access_key || undefined,
                api_key:item.api_key || undefined,
                wallet_api_key:item.wallet_api_key || undefined,
                clear_key:item._clearKey === true,
                clear_wallet_key:item._clearWalletKey === true,
                clear_volcengine_access_key_id:item._clearVolcengineAccessKey === true,
                clear_volcengine_secret_access_key:item._clearVolcengineSecretKey === true
            })))
        });
        if(!res.ok) throw new Error((await res.json()).detail || tr('api.saveFailed'));
        const data = await res.json();
        const hasNewerLocalChanges = expectedRevision !== null && autoSaveState.revision !== expectedRevision;
        if(!hasNewerLocalChanges){
            providers = data.providers || providers;
            providers.forEach(item => {
                delete item.api_key;
                delete item.wallet_api_key;
                delete item.volcengine_access_key_id;
                delete item.volcengine_secret_access_key;
                delete item._clearKey;
                delete item._clearWalletKey;
                delete item._clearVolcengineAccessKey;
                delete item._clearVolcengineSecretKey;
            });
            selectedId = provider()?.id || providers[0]?.id || '';
            renderEditor();
        }
        if(!silent) setStatus(tr('api.saved'), 'success');
        // 广播变更，画布等其他 iframe 立即重新拉取最新平台/模型列表
        broadcastStudioApiChange('providers-changed');
        return true;
    } catch(err) {
        autoSaveState.lastError = err.message || tr('api.saveFailed');
        if(!silent) setStatus(autoSaveState.lastError, 'danger');
        return false;
    }
}
function escapeHtml(str){
    return String(str || '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}
function escapeAttr(str){ return escapeHtml(str).replace(/`/g, '&#96;'); }
window.addEventListener('message', event => {
    if(event.data?.type === 'studio-theme' && window.StudioTheme) window.StudioTheme.set(event.data.theme);
    if(event.data?.type === 'studio-lang' && window.StudioI18n) {
        window.StudioI18n.set(event.data.lang);
        renderEditor();
    }
});
rhWorkflowEditorOverlay?.addEventListener('ic-after-hide', () => {
    rhWorkflowEditorState.open = false;
    closeRhNodePopover();
});
document.addEventListener('mousedown', event => {
    if(!rhWorkflowEditorState.open) return;
    const pop = document.getElementById('rhNodePopover');
    if(!pop) return;
    if(pop.contains(event.target)) return;
    if(event.target.closest('.rh-editor-gnode,.rh-app-field-row')) return;
    closeRhNodePopover();
});
window.addEventListener('studio-lang-change', () => {
    renderEditor();
});
window.onload = () => {
    if(window.StudioTheme) window.StudioTheme.apply();
    if(window.StudioI18n) window.StudioI18n.apply();
    loadProviders();
    // 平台名输入时实时预览生成的 ID
    if(nameInput) nameInput.addEventListener('input', updateIdPreview);
    if(providerList) providerList.addEventListener('ic-change', event => { const id = event.detail?.value || ''; if(id && id !== selectedId) selectProvider(id); });
    if(modelCategoryTabs) {
        selectModelCategory(modelCategoryTabs.getAttribute('value') || 'image');
        modelCategoryTabs.addEventListener('ic-change', event => selectModelCategory(event.detail?.value || 'image'));
    }
    document.addEventListener('input', handleAutoSaveInput);
    document.addEventListener('focusout', handleAutoSaveFocusOut);
    document.addEventListener('keydown', handleAutoSaveKeyDown);
    if(protocolInput) protocolInput.addEventListener('ic-change', () => {
        updateProtocolFromInput();
        requestAutoSave({affectsVerification:true});
    });
    if(baseInput) baseInput.addEventListener('input', () => updateApimartDomesticHint());
    if(imageRequestModeInput) imageRequestModeInput.addEventListener('ic-change', () => {
        const item = provider();
        if(!item) return;
        if(applyLockedRecommendedProtocol(item)){
            if(protocolInput) protocolInput.value = item.protocol;
            imageRequestModeInput.value = item.image_request_mode;
            return;
        }
        item.image_request_mode = normalizeImageRequestMode(imageRequestModeInput.value);
        requestAutoSave({affectsVerification:true});
    });
    if(imageEditRouteInput) imageEditRouteInput.addEventListener('ic-change', () => {
        const item = provider();
        if(!item) return;
        item.image_edit_route = normalizeImageEditRoute(imageEditRouteInput.value);
        requestAutoSave({affectsVerification:true});
    });
    [keyInput, rhFreeKeyInput, rhWalletKeyInput].forEach(input => {
        if(input) input.addEventListener('input', () => {
            refreshProviderOnboarding();
            if(input === keyInput) updateApimartDomesticHint();
        });
    });
    document.getElementById('pickerCategoryTabs')?.addEventListener('ic-change', event => {
        selectPickerCat(event.detail?.value || 'all');
    });
    apiSettingsImportInput()?.addEventListener('ic-change', event => {
        const file = event.detail?.acceptedFiles?.[0];
        importEncryptedApiSettings(file);
    });
    rhAssetFileInput?.addEventListener('ic-change', event => {
        handleRhAssetFile(event.detail?.acceptedFiles?.[0]);
    });
    document.addEventListener('ic-upload-request', event => {
        const previewFrame = event.target?.closest?.('ic-image-frame[data-rh-preview-key],ic-media-slot[data-rh-preview-key]');
        if(previewFrame){
            pickRhPreviewMedia(previewFrame.dataset.rhPreviewKey || '', previewFrame.dataset.rhPreviewKind || 'IMAGE');
            return;
        }
        const frame = event.target?.closest?.('ic-image-frame[data-rh-entry-thumbnail]');
        if(!frame) return;
        pickRhThumbnail(frame.dataset.rhKind || '', Number(frame.dataset.rhIndex));
    });
    document.addEventListener('ic-replace-request', event => {
        const previewSlot = event.target?.closest?.('ic-media-slot[data-rh-preview-key]');
        if(previewSlot) pickRhPreviewMedia(previewSlot.dataset.rhPreviewKey || '', previewSlot.dataset.rhPreviewKind || 'IMAGE');
    });
    document.addEventListener('ic-remove', event => {
        const previewFrame = event.target?.closest?.('ic-image-frame[data-rh-preview-key],ic-media-slot[data-rh-preview-key]');
        if(previewFrame){
            removeRhPreviewImage(previewFrame.dataset.rhPreviewKey || '');
            return;
        }
        const frame = event.target?.closest?.('ic-image-frame[data-rh-entry-thumbnail]');
        if(!frame) return;
        removeRhEntryThumbnail(frame.dataset.rhKind || '', Number(frame.dataset.rhIndex));
    });
    document.addEventListener('ic-error', event => {
        const frame = event.target?.closest?.('ic-image-frame[data-rh-entry-thumbnail]');
        if(frame) fallbackRhEntryThumbnail(frame);
    });
    document.addEventListener('ic-retry', event => {
        const slot = event.target?.closest?.('ic-media-slot[data-rh-preview-key]');
        if(slot) pickRhPreviewMedia(slot.dataset.rhPreviewKey || '', slot.dataset.rhPreviewKind || 'IMAGE');
    });
};
