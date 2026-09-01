// canvas-list.js — Project Workspace.
// Two-pane: LEFT project list, RIGHT pannable/zoomable board of canvas cards.
// Self-contained; relies only on global fetch and StudioI18n.

/* ===== Small helpers (copied from the previous gate file) ===== */
function refreshIcons(){}
function tr(key){ return window.StudioI18n ? StudioI18n.t(key) : key; }
function langIsEn(){ return window.StudioI18n?.lang?.() === 'en'; }
function escapeHtml(str){ return String(str == null ? '' : str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
function escapeAttr(str){ return escapeHtml(str); }
function L(zh, en){ return langIsEn() ? en : zh; }
function compactLabel(fullZh, compactZh, en){ return window.innerWidth <= 760 ? L(compactZh, en) : L(fullZh, en); }
const CANVAS_LIST_PROJECT_KEY = 'canvasListCurrentProjectId';
const CANVAS_LIST_SHARE_CACHE_PREFIX = 'canvasListShareUrls';
const CANVAS_LIST_ZOOM_SPEED_STORAGE_KEY = 'smartCanvasZoomSpeed';
const CANVAS_LIST_PAN_SPEED_STORAGE_KEY = 'smartCanvasPanSpeed';
const CANVAS_LIST_COVER_PREVIEW_WIDTH = 512;
const CANVAS_LIST_PROJECT_CACHE_LIMIT = 3;

function canvasListCoverPreviewUrl(value, width = CANVAS_LIST_COVER_PREVIEW_WIDTH){
    const raw = String(value || '').trim();
    if(!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
    try {
        const parsed = new URL(raw, window.location.origin);
        if(parsed.pathname === '/api/media-preview') return raw;
    } catch(e) {}
    if(!raw.startsWith('/assets/')) return raw;
    if(!/\.(png|jpe?g|webp|gif|bmp|avif|tiff?)(\?|#|$)/i.test(raw)) return raw;
    const previewWidth = Math.max(64, Math.min(2048, Math.round(Number(width) || CANVAS_LIST_COVER_PREVIEW_WIDTH)));
    return `/api/media-preview?w=${previewWidth}&url=${encodeURIComponent(raw)}`;
}

function canvasListZoomSpeed(){
    try {
        const value = Number(localStorage.getItem(CANVAS_LIST_ZOOM_SPEED_STORAGE_KEY));
        return Number.isFinite(value) && value >= .5 && value <= 2 ? value : 1;
    } catch(e){
        return 1;
    }
}

function canvasListPanSpeed(){
    try {
        const value = Number(localStorage.getItem(CANVAS_LIST_PAN_SPEED_STORAGE_KEY));
        return Number.isFinite(value) && value >= .5 && value <= 2 ? value : 1;
    } catch(e){
        return 1;
    }
}

function rememberedProjectId(){
    try {
        return new URLSearchParams(window.location.search).get('project') || localStorage.getItem(CANVAS_LIST_PROJECT_KEY) || 'default';
    } catch(e){
        return 'default';
    }
}

function rememberProjectId(pid){
    if(!pid) return;
    try { localStorage.setItem(CANVAS_LIST_PROJECT_KEY, pid); } catch(e){}
}

function shareUrlCacheKey(){
    return `${CANVAS_LIST_SHARE_CACHE_PREFIX}:${currentUser?.id || 'anonymous'}`;
}

function readShareUrlCache(){
    try {
        const value = JSON.parse(sessionStorage.getItem(shareUrlCacheKey()) || '{}');
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch(e){
        return {};
    }
}

function normalizeShareUrl(value){
    try {
        const url = new URL(value, location.origin);
        return url.origin === location.origin && url.pathname.startsWith('/share/') ? url.href : '';
    } catch(e){
        return '';
    }
}

function rememberedShareUrl(canvasId){
    return normalizeShareUrl(readShareUrlCache()[canvasId]);
}

function rememberShareUrl(canvasId, value){
    try {
        const cache = readShareUrlCache();
        const url = normalizeShareUrl(value);
        if(url) cache[canvasId] = url;
        else delete cache[canvasId];
        sessionStorage.setItem(shareUrlCacheKey(), JSON.stringify(cache));
    } catch(e){}
}

async function copyText(value){
    try {
        if(navigator.clipboard?.writeText){
            await navigator.clipboard.writeText(value);
            return true;
        }
    } catch(e){}
    const field = document.createElement('textarea');
    field.value = value;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch(e){}
    field.remove();
    return copied;
}

function formatCanvasTime(value){
    if(!value) return '--';
    const raw = Number(value);
    const time = raw < 10000000000 ? raw * 1000 : raw;
    const date = new Date(time);
    if(Number.isNaN(date.getTime())) return '--';
    return date.toLocaleString(langIsEn() ? 'en-US' : 'zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}

function renderCanvasIcon(icon, size = 16){
    if(!icon || icon === '🧩') return `<ic-icon name="collection" size="small" aria-hidden="true"></ic-icon>`;
    if(/[^\x00-\x7F]/.test(icon)) return escapeHtml(icon);
    const semanticIcon = icon === 'sparkles' ? 'app' : icon === 'layers' ? 'canvas' : 'collection';
    return `<ic-icon name="${semanticIcon}" size="small" aria-hidden="true"></ic-icon>`;
}

/* ===== DOM refs ===== */
const board = document.getElementById('board');
const boardWorld = document.getElementById('boardWorld');
const boardEmptyHint = document.getElementById('boardEmptyHint');
const boardLoading = document.getElementById('boardLoading');
const projectListEl = document.getElementById('projectList');
const trashEntryBtn = document.getElementById('trashEntry');
const trashBadge = document.getElementById('trashBadge');
const trashPanel = document.getElementById('trashPanel');
const trashListEl = document.getElementById('trashList');
const trashCloseBtn = document.getElementById('trashClose');
const newProjectBtn = document.getElementById('newProjectBtn');
const newProjectRow = document.getElementById('newProjectRow');
const newProjectInput = document.getElementById('newProjectInput');
const newProjectConfirm = document.getElementById('newProjectConfirm');
const newProjectCancel = document.getElementById('newProjectCancel');
const newCanvasBtn = document.getElementById('newCanvasBtn');
const boardLoadMoreBtn = document.getElementById('boardLoadMore');
const boardRefreshBtn = document.getElementById('boardRefresh');
const boardResetViewBtn = document.getElementById('boardResetView');
const pasteCanvasBtn = document.getElementById('pasteCanvasBtn');
const emptyCreateCanvasBtn = document.getElementById('emptyCreateCanvasBtn');
const createCanvasDialog = document.getElementById('createCanvasDialog');
const createCanvasName = document.getElementById('createCanvasName');
const createCanvasKind = document.getElementById('createCanvasKind');
const createCanvasCancel = document.getElementById('createCanvasCancel');
const createCanvasConfirm = document.getElementById('createCanvasConfirm');
const canvasActionConfirmation = document.getElementById('canvasActionConfirmation');
const canvasActionConfirmationCopy = document.getElementById('canvasActionConfirmationCopy');
const canvasSharePopover = document.getElementById('canvasSharePopover');

/* ===== State ===== */
let projects = [];
let canvases = [];          // currently loaded project batch(es)
const canvasCacheByProject = new Map();
const canvasPageState = new Map();
let deletedCanvases = [];
let currentProjectId = rememberedProjectId();
let activeStatusToast = null;
let clipboardCanvas = null;   // 剪切的画布快照（切换项目后仍可粘贴）
let currentUser = null;
let canvasBatchLoading = false;
let canvasListPageLeaving = false;
const canvasListPerformance = {
    batches:[],
    longTasks:[],
    coverRequests:0,
    firstCardPaintAt:0,
    interactionReadyAt:0,
    projectSwitchMs:[],
};
let canvasProjectSwitchStartedAt = 0;
window.canvasListPerformance = canvasListPerformance;
if('PerformanceObserver' in window){
    try {
        const observer = new PerformanceObserver(list => {
            list.getEntries().forEach(entry => canvasListPerformance.longTasks.push({
                startTime:Math.round(entry.startTime),
                duration:Math.round(entry.duration),
            }));
        });
        observer.observe({entryTypes:['longtask']});
    } catch(_error) {}
}

function cachedProjectCanvases(projectId){
    if(!canvasCacheByProject.has(projectId)) return [];
    const value = canvasCacheByProject.get(projectId) || [];
    canvasCacheByProject.delete(projectId);
    canvasCacheByProject.set(projectId, value);
    return value;
}

function cacheProjectCanvases(projectId, items){
    canvasCacheByProject.delete(projectId);
    canvasCacheByProject.set(projectId, items);
    for(const cachedProjectId of canvasCacheByProject.keys()){
        if(canvasCacheByProject.size <= CANVAS_LIST_PROJECT_CACHE_LIMIT) break;
        if(cachedProjectId === currentProjectId) continue;
        canvasCacheByProject.delete(cachedProjectId);
        canvasPageState.delete(cachedProjectId);
    }
}

// board viewport (mirrors smart-canvas math)
const viewport = { x: 0, y: 0, scale: 1 };
const MIN_SCALE = 0.3, MAX_SCALE = 2;

/* ===== Status toast ===== */
function setStatus(text, tone = 'neutral'){
    activeStatusToast?.remove();
    activeStatusToast = null;
    if(!text) return;
    const toast = document.createElement('ic-toast');
    toast.textContent = text;
    toast.setAttribute('tone', tone);
    toast.dataset.icOverlay = '';
    document.body.appendChild(toast);
    activeStatusToast = toast;
    window.setTimeout(() => {
        if(activeStatusToast === toast) activeStatusToast = null;
        toast.remove();
    }, 2200);
}

function setBoardLoading(loading, label = L('正在加载画布','Loading canvases')){
    board.setAttribute('aria-busy', String(Boolean(loading)));
    if(!boardLoading) return;
    boardLoading.hidden = !loading;
    boardLoading.setAttribute('label', label);
}

/* ===== Viewport math (mirrors smart-canvas.js) ===== */
function applyViewport(){
    boardWorld.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`;
    board.style.backgroundSize = `${120 * viewport.scale}px ${120 * viewport.scale}px, ${120 * viewport.scale}px ${120 * viewport.scale}px, ${24 * viewport.scale}px ${24 * viewport.scale}px`;
    board.style.backgroundPosition = `${viewport.x}px ${viewport.y}px, ${viewport.x}px ${viewport.y}px, ${viewport.x}px ${viewport.y}px`;
}
function screenToWorld(clientX, clientY){
    const rect = board.getBoundingClientRect();
    return {
        x: (clientX - rect.left - viewport.x) / viewport.scale,
        y: (clientY - rect.top - viewport.y) / viewport.scale
    };
}
function boardCenterWorld(){
    return {
        x: (board.clientWidth / 2 - viewport.x) / viewport.scale,
        y: (board.clientHeight / 2 - viewport.y) / viewport.scale
    };
}
function resetView(){
    const cards = Array.from(boardWorld.querySelectorAll('.ws-card'));
    if(!cards.length){
        viewport.x = 0; viewport.y = 0; viewport.scale = 1; applyViewport();
        return;
    }
    const bounds = cards.reduce((acc, el) => {
        const x = parseFloat(el.style.left) || 0;
        const y = parseFloat(el.style.top) || 0;
        const w = el.offsetWidth || 248;
        const h = el.offsetHeight || 150;
        acc.minX = Math.min(acc.minX, x);
        acc.minY = Math.min(acc.minY, y);
        acc.maxX = Math.max(acc.maxX, x + w);
        acc.maxY = Math.max(acc.maxY, y + h);
        return acc;
    }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const padding = board.clientWidth < 640 ? 20 : 40;
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    const fitScale = Math.min(1, (board.clientWidth - padding * 2) / width, (board.clientHeight - padding * 2) / height);
    viewport.scale = board.clientWidth < 640 ? 1 : Math.min(MAX_SCALE, Math.max(0.9, fitScale));
    const fitsX = width * viewport.scale <= board.clientWidth - padding * 2;
    const fitsY = height * viewport.scale <= board.clientHeight - padding * 2;
    viewport.x = Math.round((fitsX ? (board.clientWidth - width * viewport.scale) / 2 : padding) - bounds.minX * viewport.scale);
    viewport.y = Math.round((fitsY ? Math.max(padding, (board.clientHeight - height * viewport.scale) / 2) : padding) - bounds.minY * viewport.scale);
    applyViewport();
}

/* ===== Board pointer / temporary hand / zoom ===== */
let panState = null;
let boardSpacePan = false;
let suppressBoardClick = false;
let suppressBoardClickTimer = null;
function isCanvasListEditableTarget(target){
    const el = target || document.activeElement;
    return !!el?.closest?.('input, textarea, select, option, [contenteditable="true"]');
}
function refreshBoardToolState(){
    board.classList.toggle('temporary-pan', boardSpacePan && !panState);
}
function onBoardPanStart(e){
    const middle = e.button === 1;
    const temporaryHandLeft = e.button === 0 && boardSpacePan;
    if(!middle && !temporaryHandLeft) return;
    if(e.target.closest('.ws-board-empty-actions,.ws-topbar-right')) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    closeCardMenu();
    panState = { button: e.button, startX: e.clientX, startY: e.clientY, ox: viewport.x, oy: viewport.y, moved: false };
    clearTimeout(suppressBoardClickTimer);
    suppressBoardClickTimer = null;
    suppressBoardClick = true;
    board.classList.remove('temporary-pan');
    board.classList.add('panning');
}
function onBoardPanMove(e){
    if(!panState) return;
    viewport.x = panState.ox + (e.clientX - panState.startX);
    viewport.y = panState.oy + (e.clientY - panState.startY);
    if(Math.abs(e.clientX - panState.startX) > 3 || Math.abs(e.clientY - panState.startY) > 3) panState.moved = true;
    applyViewport();
}
function onBoardPanEnd(){
    if(!panState) return;
    panState = null;
    board.classList.remove('panning');
    clearTimeout(suppressBoardClickTimer);
    suppressBoardClickTimer = setTimeout(() => {
        suppressBoardClick = false;
        suppressBoardClickTimer = null;
    }, 0);
    refreshBoardToolState();
}
function cancelBoardPan(){
    clearTimeout(suppressBoardClickTimer);
    suppressBoardClickTimer = null;
    suppressBoardClick = false;
    panState = null;
    boardSpacePan = false;
    board.classList.remove('panning', 'temporary-pan');
}
function suppressTemporaryHandClick(e){
    if(boardSpacePan || suppressBoardClick){
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
    }
}
function canvasListWheelZoomFactor(event, pageSize){
    const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? pageSize : 1;
    const isMac = /^Mac/.test(navigator.platform || '');
    const sensitivity = 0.0016;
    const macMultiplier = isMac ? 1.15 : 1;
    return Math.exp(-event.deltaY * unit * sensitivity * macMultiplier * canvasListZoomSpeed());
}
function onBoardWheel(e){
    e.preventDefault();
    if(!(e.metaKey || e.ctrlKey)){
        const speed = canvasListPanSpeed();
        viewport.x -= Number(e.deltaX || 0) * speed;
        viewport.y -= Number(e.deltaY || 0) * speed;
        applyViewport();
        return;
    }
    const rect = board.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    // world point under cursor before zoom
    const wx = (px - viewport.x) / viewport.scale;
    const wy = (py - viewport.y) / viewport.scale;
    const factor = canvasListWheelZoomFactor(e, board.clientHeight || window.innerHeight || 800);
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewport.scale * factor));
    viewport.scale = next;
    // keep the same world point under the cursor
    viewport.x = px - wx * next;
    viewport.y = py - wy * next;
    applyViewport();
}

/* ===== Data loading ===== */
function currentProject(){ return projects.find(p => p.id === currentProjectId) || projects[0] || null; }
function canvasesInProject(pid){ return canvases.filter(c => (c.project || 'default') === pid); }

async function loadAll(){
    try {
        // The current project's first card batch is the only blocking canvas
        // payload. Project counts and trash context follow after first paint.
        await loadCurrentProjectBatch({ reset: true });
        const pRes = await fetch('/api/projects');
        const pData = pRes.ok ? await pRes.json() : { projects: [] };
        projects = (pData.projects || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
        if(!projects.length){
            currentProjectId = '';
            canvases = [];
            renderProjects();
            renderBoard();
            newCanvasBtn.hidden = true;
            if(emptyCreateCanvasBtn) emptyCreateCanvasBtn.hidden = true;
            setStatus(L('管理员尚未为此账号分配项目','No projects are assigned to this account'));
            loadSecondaryCanvasData();
            return;
        }
        newCanvasBtn.hidden = false;
        if(emptyCreateCanvasBtn) emptyCreateCanvasBtn.hidden = false;
        // pick first project (prefer default / order 0)
        if(!projects.find(p => p.id === currentProjectId)){
            const def = projects.find(p => p.id === 'default') || projects.slice().sort((a, b) => (a.order || 0) - (b.order || 0))[0];
            currentProjectId = def ? def.id : 'default';
            await loadCurrentProjectBatch({ reset: true });
        }
        rememberProjectId(currentProjectId);
        renderProjects();
        resetView();
        if(pData.rebuilding) refreshProjectsInBackground();
        loadSecondaryCanvasData();
    } catch(e){
        if(canvasListPageLeaving) return;
        console.error(e);
        setStatus(L('加载失败','Load failed'));
    }
}

function refreshProjectsInBackground(){
    scheduleCanvasIdleWork(async () => {
        try {
            const response = await fetch('/api/projects');
            if(!response.ok) return;
            const data = await response.json();
            projects = (data.projects || []).slice().sort(
                (a, b) => (a.order || 0) - (b.order || 0)
            );
            renderProjects();
            if(data.rebuilding) refreshProjectsInBackground();
        } catch(error) {
            if(canvasListPageLeaving) return;
            console.error(error);
        }
    });
}

async function loadCurrentProjectBatch({ reset = false } = {}){
    const projectId = currentProjectId;
    if(reset) setBoardLoading(true);
    const existing = reset ? [] : cachedProjectCanvases(projectId);
    const page = reset ? { cursor:'', exhausted:false } : (canvasPageState.get(projectId) || { cursor:'', exhausted:false });
    if(page.exhausted && !reset){
        canvases = existing;
        renderBoard();
        return;
    }
    try {
        const url = `/api/canvases?project=${encodeURIComponent(currentProjectId)}&limit=40&cursor=${encodeURIComponent(page.cursor || '')}`;
        const response = await fetch(url);
        if(!response.ok) throw new Error('canvas batch load failed');
        const data = await response.json();
        if(currentProjectId !== projectId) return;
        const byId = new Map(existing.map(item => [item.id, item]));
        const additions = (data.canvases || []).filter(item => !byId.has(item.id));
        (data.canvases || []).forEach(item => byId.set(item.id, item));
        const loaded = Array.from(byId.values());
        cacheProjectCanvases(projectId, loaded);
        canvasPageState.set(projectId, {
            cursor: data.next_cursor || '',
            exhausted: !data.rebuilding
                && (!data.next_cursor || !(data.canvases || []).length),
            total: Number.isFinite(Number(data.total)) ? Number(data.total) : loaded.length,
            rebuilding:Boolean(data.rebuilding),
            indexError:Boolean(data.index_error),
            indexReadMs:Number(data.index_read_ms || 0),
        });
        canvasListPerformance.batches.push({
            projectId,
            indexReadMs:Number(data.index_read_ms || 0),
            responseBytes:new Blob([JSON.stringify(data)]).size,
            count:(data.canvases || []).length,
            receivedAt:Math.round(performance.now()),
        });
        canvases = loaded;
        if(reset) renderBoard();
        else renderCanvasAdditions(additions);
        updateLoadMoreButton();
        performance.mark?.('canvas-list-batch-rendered');
    } finally {
        if(reset && currentProjectId === projectId) setBoardLoading(false);
    }
}

function scheduleCanvasIdleWork(callback){
    // Leave a short interaction window after first paint/project changes before
    // consuming idle time with later cards and trash metadata.
    setTimeout(() => {
        if('requestIdleCallback' in window) window.requestIdleCallback(callback, { timeout: 800 });
        else callback();
    }, 160);
}

function loadSecondaryCanvasData({ refreshTrash = true } = {}){
    const projectId = currentProjectId;
    scheduleCanvasIdleWork(async () => {
        if(currentProjectId !== projectId) return;
        if(refreshTrash) refreshTrashCount();
    });
}

function updateLoadMoreButton(){
    if(!boardLoadMoreBtn) return;
    const page = canvasPageState.get(currentProjectId);
    const loaded = canvasesInProject(currentProjectId).length;
    const total = Number(page?.total || loaded);
    const show = Boolean(page && (page.rebuilding || !page.exhausted || loaded < total));
    boardLoadMoreBtn.hidden = !show;
    boardLoadMoreBtn.toggleAttribute('disabled', canvasBatchLoading);
    boardLoadMoreBtn.toggleAttribute('loading', canvasBatchLoading);
    const label = page?.rebuilding ? L('继续建立列表','Continue indexing') : L('加载更多','Load more');
    const detail = total > loaded ? ` (${loaded}/${total})` : '';
    const span = boardLoadMoreBtn.querySelector('span');
    if(span) span.textContent = label;
    boardLoadMoreBtn.title = `${label}${detail}`;
    boardLoadMoreBtn.setAttribute('aria-label', `${label}${detail}`);
}

async function loadNextCanvasBatch(){
    if(canvasBatchLoading) return;
    canvasBatchLoading = true;
    updateLoadMoreButton();
    try {
        await loadCurrentProjectBatch();
    } catch(e){
        console.error(e);
        setStatus(L('加载更多画布失败','Failed to load more canvases'));
    } finally {
        canvasBatchLoading = false;
        updateLoadMoreButton();
    }
}

async function refreshCanvasListSession(){
    const res = await fetch('/api/auth/me', { cache:'no-store' });
    if(!res.ok){
        const error = new Error('unauthorized');
        error.status = res.status;
        throw error;
    }
    const data = await res.json();
    currentUser = data.user || null;
    const canManageProjects = currentUser?.role === 'admin';
    newProjectBtn.hidden = !canManageProjects;
    if(!canManageProjects) closeNewProject();
    await loadAll();
}

function handleCanvasListSessionError(error){
    console.error(error);
    if(error?.status === 401){
        window.top.location.href = '/login';
        return;
    }
    setStatus(L('加载失败','Load failed'));
}

function projectCanvasCount(pid){
    const p = projects.find(x => x.id === pid);
    // prefer live count from canvases array; fall back to server count
    const cached = canvasCacheByProject.get(pid);
    const page = canvasPageState.get(pid);
    return cached && page?.exhausted ? cached.length : (p?.canvas_count ?? cached?.length ?? 0);
}

/* ===== Project sidebar rendering ===== */
function renderProjects(){
    projectListEl.setAttribute('value', currentProjectId);
    projectListEl.innerHTML = '';
    const canManageProjects = currentUser?.role === 'admin';
    projects.forEach(p => {
        const row = document.createElement('div');
        row.className = `ws-project-row${canManageProjects ? ' has-actions' : ''}`;
        row.dataset.projectId = p.id;
        row.dataset.value = p.id;
        const count = projectCanvasCount(p.id);
        const isDefault = p.id === 'default';
        row.innerHTML = `
            <span class="ws-project-nav">
                <ic-icon class="ws-project-icon" name="${isDefault ? 'project-default' : 'project'}" size="small" aria-hidden="true"></ic-icon>
                <span class="ws-project-name">${escapeHtml(p.name)}</span>
                <ic-badge class="ws-project-count" kind="count" tone="neutral">${count}</ic-badge>
            </span>
            ${canManageProjects ? `<span class="ws-project-actions">
                <ic-icon-button class="ws-proj-act rename" type="button" size="s" hierarchy="quiet" icon="edit" label="${L('重命名','Rename')}"></ic-icon-button>
                ${isDefault ? '' : `<ic-icon-button class="ws-proj-act del" type="button" size="s" hierarchy="quiet" tone="danger" icon="delete" label="${L('删除','Delete')}"></ic-icon-button>`}
            </span>` : ''}`;
        const renameBtn = row.querySelector('.ws-proj-act.rename');
        if(renameBtn) renameBtn.onclick = e => { e.stopPropagation(); startProjectRename(p.id, row); };
        const delBtn = row.querySelector('.ws-proj-act.del');
        if(delBtn) delBtn.onclick = async e => {
            e.stopPropagation();
            if(await requestCanvasConfirmation({
                label:L('删除项目','Delete project'),
                description:langIsEn()
                    ? `Delete “${p.name}”? Its canvases will move back to Default.`
                    : `删除「${p.name}」？其中的画布将移回默认项目。`,
                confirmLabel:L('删除','Delete'),
                consequence:'destructive',
            })) deleteProject(p.id);
        };
        projectListEl.appendChild(row);
    });
    refreshIcons();
}

async function selectProject(pid){
    if(pid === currentProjectId && !trashPanel.classList.contains('active')) return;
    canvasProjectSwitchStartedAt = performance.now();
    currentProjectId = pid;
    rememberProjectId(pid);
    closeTrashView();
    canvases = cachedProjectCanvases(pid);
    renderProjects();
    if(canvases.length){
        renderBoard();
    } else {
        await loadCurrentProjectBatch({ reset: true });
    }
    canvasListPerformance.projectSwitchMs.push(Number(
        (performance.now() - canvasProjectSwitchStartedAt).toFixed(2)
    ));
    canvasProjectSwitchStartedAt = 0;
    resetView();
    loadSecondaryCanvasData();
}

function startProjectRename(pid, row){
    const p = projects.find(x => x.id === pid);
    if(!p) return;
    const nameEl = row.querySelector('.ws-project-name');
    if(!nameEl || row.querySelector('ic-input')) return;
    const input = document.createElement('ic-input');
    input.type = 'text'; input.maxLength = 60; input.value = p.name;
    input.className = 'ws-project-name-input';
    input.setAttribute('aria-label', L('项目名称','Project name'));
    nameEl.replaceWith(input);
    let done = false;
    const finish = commit => {
        if(done) return; done = true;
        const v = input.value.trim();
        if(commit && v && v !== p.name) renameProject(pid, v);
        else renderProjects();
    };
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('focusout', () => finish(true));
    input.addEventListener('keydown', e => {
        e.stopPropagation();
        if(e.key === 'Enter'){ e.preventDefault(); finish(true); }
        if(e.key === 'Escape'){ e.preventDefault(); finish(false); }
    });
    Promise.resolve(input.updateComplete).then(() => {
        input.focus();
        input.input?.select?.();
    });
}

/* ===== Project CRUD ===== */
function openNewProject(){
    newProjectRow.classList.add('active');
    newProjectInput.value = '';
    newProjectInput.focus();
}
function closeNewProject(){
    newProjectRow.classList.remove('active');
    newProjectInput.value = '';
}
async function createProject(){
    const name = newProjectInput.value.trim() || L('新项目','New project');
    closeNewProject();
    try {
        const res = await fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        if(!res.ok) throw new Error('create project failed');
        const data = await res.json();
        const proj = data.project;
        if(proj){
            projects.push(proj);
            projects.sort((a, b) => (a.order || 0) - (b.order || 0));
            selectProject(proj.id);
            renderProjects();
        }
    } catch(e){
        console.error(e); setStatus(L('创建项目失败','Create project failed'));
    }
}
async function renameProject(pid, name){
    const p = projects.find(x => x.id === pid);
    if(p) p.name = name;
    renderProjects();
    if(pid === currentProjectId) updateBoardHeader();
    try {
        const res = await fetch(`/api/projects/${encodeURIComponent(pid)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        if(!res.ok) throw new Error('rename project failed');
    } catch(e){ console.error(e); setStatus(L('重命名失败','Rename failed')); loadAll(); }
}
async function deleteProject(pid){
    try {
        const res = await fetch(`/api/projects/${encodeURIComponent(pid)}`, { method: 'DELETE' });
        if(!res.ok) throw new Error('delete project failed');
        // canvases of deleted project move back to default
        canvases.forEach(c => { if((c.project || 'default') === pid) c.project = 'default'; });
        projects = projects.filter(p => p.id !== pid);
        if(currentProjectId === pid) currentProjectId = 'default';
        rememberProjectId(currentProjectId);
        renderProjects();
        renderBoard();
    } catch(e){ console.error(e); setStatus(L('删除项目失败','Delete project failed')); loadAll(); }
}

/* ===== Board rendering ===== */
function updateBoardHeader(){
    updateLoadMoreButton();
}

function autoLayoutNulls(items){
    // Grid layout for legacy cards with null board position; persist one batch.
    const X0 = 40, Y0 = 40, XSTRIDE = 312, YSTRIDE = 286, COLS = 4;
    const positioned = items.filter(c => c.board_x != null && c.board_y != null);
    const nulls = items.filter(c => c.board_x == null || c.board_y == null);
    // start index after existing positioned grid slots to reduce overlap
    let i = positioned.length;
    const updates = [];
    nulls.forEach(c => {
        const col = i % COLS, rowIdx = Math.floor(i / COLS);
        c.board_x = X0 + col * XSTRIDE;
        c.board_y = Y0 + rowIdx * YSTRIDE;
        i++;
        updates.push({ id:c.id, board_x:c.board_x, board_y:c.board_y });
    });
    if(updates.length) persistMetaBatch(updates);
}

let renderBatchToken = 0;
function renderBoard(){
    updateBoardHeader();
    const items = canvasesInProject(currentProjectId);
    autoLayoutNulls(items);
    boardWorld.innerHTML = '';
    const token = ++renderBatchToken;
    renderCanvasBatch(items, 0, token);
    const hasProjects = projects.length > 0;
    boardEmptyHint.setAttribute('title', hasProjects ? L('暂无画布','No canvases') : L('暂无可访问项目','No accessible projects'));
    boardEmptyHint.setAttribute('label', hasProjects ? L('画布列表为空','Empty canvas list') : L('项目列表为空','Empty project list'));
    const emptyDescription = boardEmptyHint.querySelector(':scope > span:not([slot])');
    if(emptyDescription) emptyDescription.textContent = hasProjects
        ? L('为当前项目创建第一块画布','Create the first canvas for this project')
        : L('管理员尚未为此账号分配项目','No projects are assigned to this account');
    boardEmptyHint.classList.toggle('hidden', items.length > 0);
    updatePasteBtn();
    refreshIcons();
}

function renderCanvasAdditions(items){
    updateBoardHeader();
    autoLayoutNulls(canvasesInProject(currentProjectId));
    if(items.length) renderCanvasBatch(items, 0, renderBatchToken);
    boardEmptyHint.classList.toggle('hidden', canvasesInProject(currentProjectId).length > 0);
    updatePasteBtn();
}

function renderCanvasBatch(items, offset = 0, token = renderBatchToken){
    if(token !== renderBatchToken) return;
    const startedAt = performance.now();
    const end = Math.min(items.length, offset + 16);
    for(let index = offset; index < end; index++) boardWorld.appendChild(buildCard(items[index]));
    if(end > offset && !canvasListPerformance.firstCardPaintAt){
        canvasListPerformance.firstCardPaintAt = Math.round(performance.now());
        canvasListPerformance.interactionReadyAt = canvasListPerformance.firstCardPaintAt;
        performance.mark?.('canvas-list-first-card');
    }
    canvasListPerformance.batches.push({
        renderStart:Math.round(startedAt),
        renderDuration:Number((performance.now() - startedAt).toFixed(2)),
        rendered:end - offset,
    });
    refreshIcons();
    if(end < items.length) requestAnimationFrame(() => renderCanvasBatch(items, end, token));
}

function buildCard(c){
    const isSmart = (c.kind || 'classic') === 'smart';
    const canEdit = currentUser && ['admin', 'designer'].includes(currentUser.role);
    const card = document.createElement('div');
    card.className = 'ws-card'
        + (String(c.color || '').trim() ? ' cc-marked' : '')
        + (clipboardCanvas?.id === c.id ? ' cut' : '');
    card.dataset.canvasId = c.id;
    card.tabIndex = 0;
    card.setAttribute('role', 'link');
    card.setAttribute('aria-label', `${c.title || L('未命名画布','Untitled canvas')} · ${isSmart ? L('智能画布','Smart canvas') : L('普通画布','Classic canvas')}`);
    card.style.left = (c.board_x || 0) + 'px';
    card.style.top = (c.board_y || 0) + 'px';
    const coverUrl = String(c.cover_url || '').trim();
    const coverPreviewUrl = canvasListCoverPreviewUrl(coverUrl);
    const canvasLabel = `${c.title || L('未命名画布','Untitled canvas')} · ${isSmart ? L('智能画布','Smart canvas') : L('普通画布','Classic canvas')}`;
    const canvasKindTag = isSmart
        ? ''
        : `<ic-badge class="ws-card-kind classic" kind="label" tone="neutral">${compactLabel('普通画布','普通','Classic')}</ic-badge>`;
    card.innerHTML = `
        <ic-card class="ws-card-surface" size="small" label="${escapeAttr(canvasLabel)}">
            <ic-media-container class="ws-card-thumb ${coverUrl ? 'has-cover' : ''}" kind="image" fit="cover" aspect="landscape" state="ready" label="${escapeAttr(c.title || L('画布封面','Canvas cover'))}">
                ${coverUrl ? `<img class="ws-card-cover" src="${escapeAttr(coverPreviewUrl)}" data-original-src="${escapeAttr(coverUrl)}" alt="${escapeAttr(c.title || L('画布封面','Canvas cover'))}" loading="lazy" decoding="async">` : ''}
                <div class="ws-card-thumb-placeholder" aria-hidden="true">
                    <span class="ws-card-thumb-icon"><ic-icon name="${isSmart ? 'app' : 'canvas'}" size="large" aria-hidden="true"></ic-icon></span>
                    <span>${L('暂无画布图片','No canvas image')}</span>
                </div>
                <div class="ws-card-top">
                    <div class="ws-card-labels">
                        ${canvasKindTag}
                        ${canEdit ? `<ic-badge class="ws-card-access" kind="label" tone="neutral"><ic-icon name="edit" size="small" aria-hidden="true"></ic-icon>${L('可编辑','Editable')}</ic-badge>` : ''}
                        ${c.visibility === 'private' ? `<ic-badge class="ws-card-privacy" kind="label" tone="neutral"><ic-icon name="lock" size="x-small" aria-hidden="true"></ic-icon>${L('仅自己','Private')}</ic-badge>` : ''}
                    </div>
                    <ic-icon-button class="ws-card-menu" type="button" size="s" hierarchy="secondary" icon="more" label="${L('更多','More')}"></ic-icon-button>
                </div>
            </ic-media-container>
            <div class="ws-card-content">
                <div class="ws-card-title">${escapeHtml(c.title)}</div>
                <div class="ws-card-meta">
                    <span class="ws-card-nodes">${(c.node_count != null ? c.node_count : 0)} ${L('节点','nodes')}</span>
                    <span class="ws-card-meta-dot"></span>
                    <span class="ws-card-time">${formatCanvasTime(c.updated_at || c.created_at)}</span>
                </div>
            </div>
        </ic-card>`;
    attachCardDrag(card, c);
    const menuBtn = card.querySelector('.ws-card-menu');
    menuBtn.onmousedown = e => e.stopPropagation();
    menuBtn.onclick = e => { e.stopPropagation(); openCardMenu(c.id, menuBtn); };
    card.querySelector('.ws-card-cover')?.addEventListener('error', event => {
        const image = event.currentTarget;
        const original = image.dataset.originalSrc || '';
        if(!image.dataset.originalFallback && original && image.getAttribute('src') !== original){
            image.dataset.originalFallback = '1';
            image.src = original;
            return;
        }
        image.closest('.ws-card-thumb')?.classList.add('cover-failed');
    });
    card.querySelector('.ws-card-cover')?.addEventListener('load', () => {
        canvasListPerformance.coverRequests += 1;
    }, {once:true});
    card.addEventListener('keydown', event => {
        if(event.key !== 'Enter' || event.target.closest('button,input,ic-button,ic-icon-button,ic-input')) return;
        event.preventDefault();
        openCanvas(c);
    });
    return card;
}

/* ===== Card drag vs click ===== */
function attachCardDrag(card, c){
    card.addEventListener('mousedown', e => {
        if(e.button !== 0) return;
        if(boardSpacePan || panState) return;
        if(e.target.closest('.ws-card-menu')) return;
        if(card.querySelector('.ws-card-title-input')) return; // editing title
        e.stopPropagation();
        closeCardMenu();
        const startWorld = screenToWorld(e.clientX, e.clientY);
        const origX = c.board_x || 0, origY = c.board_y || 0;
        let moved = false;
        const onMove = ev => {
            const w = screenToWorld(ev.clientX, ev.clientY);
            const dx = w.x - startWorld.x, dy = w.y - startWorld.y;
            if(!moved && (Math.abs(dx * viewport.scale) > 5 || Math.abs(dy * viewport.scale) > 5)){
                moved = true; card.classList.add('dragging');
            }
            if(moved){
                c.board_x = origX + dx; c.board_y = origY + dy;
                card.style.left = c.board_x + 'px';
                card.style.top = c.board_y + 'px';
            }
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            card.classList.remove('dragging');
            if(moved){
                persistMeta(c.id, { board_x: Math.round(c.board_x), board_y: Math.round(c.board_y) });
            } else {
                openCanvas(c);
            }
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

function canvasHref(c){
    const enc = encodeURIComponent(c.id);
    const project = encodeURIComponent(c.project || currentProjectId || 'default');
    return (c.kind === 'smart')
        ? `/static/smart-canvas.html?id=${enc}&project=${project}&v=${Date.now()}`
        : `/static/canvas.html?id=${enc}&project=${project}&v=${Date.now()}`;
}

function openCanvas(c){
    rememberProjectId(c.project || currentProjectId || 'default');
    window.location.href = canvasHref(c);
}

/* ===== Card create flow ===== */
let createKind = 'smart';
let createWorldPoint = null;
function closeCreateCard(){
    createWorldPoint = null;
    if(createCanvasDialog?.open) createCanvasDialog.hide('cancel');
}
function openCreateCard(worldPt){
    closeCardMenu();
    createWorldPoint = worldPt || boardCenterWorld();
    createKind = 'smart';
    createCanvasDialog.label = L('新建画布','New canvas');
    createCanvasName.value = '';
    createCanvasName.placeholder = L('画布名称（可留空）','Canvas name (optional)');
    createCanvasKind.setAttribute('value', 'smart');
    createCanvasDialog.show();
}

async function createCanvasOnBoard(title, kind, worldPt){
    const isSmart = kind === 'smart';
    const base = isSmart ? L('智能画布','Smart canvas') : L('画布','Canvas');
    const name = title || `${base} ${new Date().toLocaleTimeString(langIsEn() ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    if(createCanvasDialog?.open) await createCanvasDialog.hide('confirm');
    createWorldPoint = null;
    try {
        const res = await fetch('/api/canvases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: name,
                icon: isSmart ? 'sparkles' : '🧩',
                kind: isSmart ? 'smart' : 'classic',
                project: currentProjectId,
                board_x: Math.round(worldPt.x),
                board_y: Math.round(worldPt.y)
            })
        });
        if(!res.ok) throw new Error('create canvas failed');
        const data = await res.json();
        const nc = data.canvas;
        if(nc){
            if(nc.project == null) nc.project = currentProjectId;
            if(nc.board_x == null) nc.board_x = Math.round(worldPt.x);
            if(nc.board_y == null) nc.board_y = Math.round(worldPt.y);
            canvases.push(nc);
            cacheProjectCanvases(currentProjectId, canvases);
            const page = canvasPageState.get(currentProjectId);
            if(page) page.total = Math.max(canvases.length, Number(page.total || 0) + 1);
            renderBoard();
            renderProjects();
        }
    } catch(e){ console.error(e); setStatus(L('创建失败','Create failed')); }
}

/* ===== Card context menu (rename / delete / move) ===== */
let pendingCanvasConfirmation = null;

function requestCanvasConfirmation({label, description, confirmLabel, consequence = 'neutral'}){
    pendingCanvasConfirmation?.(false);
    canvasActionConfirmation.label = label;
    canvasActionConfirmation.description = description;
    canvasActionConfirmation.confirmLabel = confirmLabel;
    canvasActionConfirmation.cancelLabel = L('取消','Cancel');
    canvasActionConfirmation.consequence = consequence;
    canvasActionConfirmationCopy.textContent = description;
    return new Promise(resolve => {
        pendingCanvasConfirmation = resolve;
        canvasActionConfirmation.show();
    });
}

canvasActionConfirmation.addEventListener('ic-confirm', async () => {
    const resolve = pendingCanvasConfirmation;
    pendingCanvasConfirmation = null;
    await canvasActionConfirmation.hide('confirm');
    resolve?.(true);
});
canvasActionConfirmation.addEventListener('ic-cancel', () => {
    const resolve = pendingCanvasConfirmation;
    pendingCanvasConfirmation = null;
    resolve?.(false);
});

function closeCardMenu(){
    const menu = document.querySelector('.ws-card-pop');
    menu?.hide?.('programmatic');
    menu?.remove();
    canvasSharePopover?.hide?.('programmatic');
}
function openCardMenu(canvasId, anchorBtn){
    closeCardMenu();
    const c = canvases.find(x => x.id === canvasId);
    if(!c) return;
    const pop = document.createElement('ic-menu');
    pop.className = 'ws-card-pop';
    pop.setAttribute('label', L('画布操作','Canvas actions'));
    pop.setAttribute('trigger', 'dropdown');
    pop.setAttribute('selection', 'command');
    pop.setAttribute('placement', 'block-end');
    pop.setAttribute('alignment', 'end');
    const maySetPrivacy = currentUser?.role === 'admin' && String(c.owner_id || '') === String(currentUser.id || '');
    pop.innerHTML = `
        <ic-menu-item kind="command" icon="edit" label="${L('重命名','Rename')}" value="rename" data-act="rename"></ic-menu-item>
        <ic-menu-item kind="command" icon="link" label="${L('分享','Share')}" value="share" data-act="share"></ic-menu-item>
        ${maySetPrivacy ? `<ic-menu-item kind="command" icon="${c.visibility === 'private' ? 'people' : 'lock'}" label="${c.visibility === 'private' ? L('设为全员可见','Make shared') : L('仅自己可见','Make private')}" value="privacy" data-act="privacy"></ic-menu-item>` : ''}
        <span role="separator" aria-hidden="true"></span>
        <ic-menu-item kind="command" icon="download" label="${L('导出画布','Export canvas')}" value="export" data-act="export"></ic-menu-item>
        <ic-menu-item kind="command" icon="archive" label="${L('导出画布 + 资源','Export with assets')}" value="export-assets" data-act="export-assets"></ic-menu-item>
        <ic-menu-item kind="command" icon="cut" label="${L('剪切到其他项目','Cut to project')}" value="cut" data-act="cut"></ic-menu-item>
        <span role="separator" aria-hidden="true"></span>
        <ic-menu-item kind="command" icon="delete" label="${L('删除','Delete')}" value="delete" tone="danger" data-act="delete"></ic-menu-item>
        <span role="separator" aria-hidden="true"></span>
        <ic-menu-item class="ws-card-id-item" kind="command" label="${L('画布 ID','Canvas ID')} · ${escapeAttr(c.id)}" title="${escapeAttr(c.id)}" value="copy-id" data-act="copy-id">
            <ic-icon name="copy" size="x-small" aria-hidden="true"></ic-icon>
        </ic-menu-item>`;
    document.body.appendChild(pop);
    pop.addEventListener('ic-select', event => {
        const item = event.composedPath().find(node => node?.localName === 'ic-menu-item');
        const action = item?.dataset.act;
        closeCardMenu();
        if(action === 'rename') startCardRename(canvasId);
        else if(action === 'share') shareCanvas(canvasId, anchorBtn);
        else if(action === 'privacy') toggleCanvasVisibility(canvasId);
        else if(action === 'export') exportCanvas(canvasId);
        else if(action === 'export-assets') exportCanvasWithResources(canvasId);
        else if(action === 'cut') cutCanvas(canvasId);
        else if(action === 'delete') showCardDeleteConfirm(canvasId);
        else if(action === 'copy-id') copyCanvasId(canvasId);
    });
    pop.show(anchorBtn);
}

async function copyCanvasId(canvasId){
    const copied = await copyText(canvasId);
    setStatus(
        copied ? L('画布 ID 已复制','Canvas ID copied') : L('无法复制画布 ID','Unable to copy Canvas ID'),
        copied ? 'neutral' : 'danger',
    );
}

function renderSharePopoverLink(url){
    const container = canvasSharePopover?.querySelector('.ws-share-link-slot');
    if(!container) return;
    if(url){
        container.innerHTML = `<a class="ws-share-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" title="${L('打开分享链接','Open share link')}"><span>${escapeHtml(url)}</span><ic-icon name="external-link" size="small" aria-hidden="true"></ic-icon></a>`;
    } else {
        container.innerHTML = `<div class="ws-share-link-missing" title="${L('当前会话没有保存原分享链接','The original link is not available in this session')}">${L('原链接未保存在当前会话，可重新生成','Original link unavailable; regenerate it')}</div>`;
    }
}

function openSharePopover(id, url, anchorBtn){
    canvasSharePopover.label = L('分享链接','Share link');
    canvasSharePopover.querySelector('.ws-share-popover-title').textContent = L('分享链接','Share link');
    const revokeBtn = canvasSharePopover.querySelector('[data-share-revoke]');
    const regenerateBtn = canvasSharePopover.querySelector('[data-share-regenerate]');
    revokeBtn.label = L('取消分享','Revoke share');
    regenerateBtn.label = L('重新生成链接','Regenerate link');
    revokeBtn.onclick = event => revokeCanvasShare(id, event.currentTarget);
    regenerateBtn.onclick = event => regenerateCanvasShare(id, event.currentTarget);
    renderSharePopoverLink(url);
    canvasSharePopover.show(anchorBtn);
}

async function shareCanvas(id, anchorBtn){
    const base = `/api/canvases/${encodeURIComponent(id)}/share`;
    anchorBtn.disabled = true;
    anchorBtn.setAttribute('aria-busy', 'true');
    try {
        const statusRes = await fetch(base);
        const status = await statusRes.json().catch(() => ({}));
        if(!statusRes.ok) throw new Error(status.detail || L('无法读取分享状态','Failed to read share status'));
        if(status.active){
            openSharePopover(id, rememberedShareUrl(id), anchorBtn);
            return;
        }
        rememberShareUrl(id, '');
        setStatus(L('正在创建分享链接…','Creating share link…'));
        const res = await fetch(base, { method:'POST' });
        const data = await res.json().catch(() => ({}));
        if(!res.ok) throw new Error(data.detail || L('创建分享失败','Failed to create share link'));
        const url = normalizeShareUrl(data.url);
        if(!url) throw new Error(L('分享链接格式无效','Invalid share link'));
        rememberShareUrl(id, url);
        const copied = await copyText(url);
        closeCardMenu();
        setStatus(copied ? L('分享链接已复制','Share link copied') : L('分享链接已创建','Share link created'));
    } catch(e) {
        console.error(e);
        setStatus(e.message || L('创建分享失败','Failed to create share link'));
    } finally {
        if(anchorBtn.isConnected){
            anchorBtn.disabled = false;
            anchorBtn.removeAttribute('aria-busy');
        }
    }
}

async function revokeCanvasShare(id, actionBtn){
    if(!await requestCanvasConfirmation({
        label:L('取消分享','Revoke share'),
        description:L('确定让已分享的链接立即失效吗？','Revoke the existing share link now?'),
        confirmLabel:L('取消分享','Revoke share'),
        consequence:'destructive',
    })) return;
    actionBtn.disabled = true;
    try {
        const res = await fetch(`/api/canvases/${encodeURIComponent(id)}/share`, { method:'DELETE' });
        const data = await res.json().catch(() => ({}));
        if(!res.ok) throw new Error(data.detail || L('撤销失败','Failed to revoke'));
        rememberShareUrl(id, '');
        closeCardMenu();
        setStatus(L('分享链接已撤销','Share link revoked'));
    } catch(e) {
        console.error(e);
        actionBtn.disabled = false;
        setStatus(e.message || L('撤销失败','Failed to revoke'));
    }
}

async function regenerateCanvasShare(id, actionBtn){
    if(!await requestCanvasConfirmation({
        label:L('重新生成分享链接','Regenerate share link'),
        description:L('重新生成会让旧链接立即失效，继续？','Regenerating will revoke the existing link immediately. Continue?'),
        confirmLabel:L('重新生成','Regenerate'),
        consequence:'destructive',
    })) return;
    const actionButtons = canvasSharePopover.querySelectorAll('.ws-share-action');
    actionButtons.forEach(button => { button.disabled = true; });
    actionBtn.classList.add('is-busy');
    try {
        const res = await fetch(`/api/canvases/${encodeURIComponent(id)}/share/regenerate`, { method:'POST' });
        const data = await res.json().catch(() => ({}));
        if(!res.ok) throw new Error(data.detail || L('重新生成失败','Failed to regenerate link'));
        const url = normalizeShareUrl(data.url);
        if(!url) throw new Error(L('分享链接格式无效','Invalid share link'));
        rememberShareUrl(id, url);
        renderSharePopoverLink(url);
        const copied = await copyText(url);
        setStatus(copied ? L('新分享链接已复制','New share link copied') : L('分享链接已重新生成','Share link regenerated'));
    } catch(e) {
        console.error(e);
        setStatus(e.message || L('重新生成失败','Failed to regenerate link'));
    } finally {
        actionBtn.classList.remove('is-busy');
        actionButtons.forEach(button => { button.disabled = false; });
    }
}

async function toggleCanvasVisibility(id){
    const c = canvases.find(item => item.id === id);
    if(!c) return;
    const visibility = c.visibility === 'private' ? 'shared' : 'private';
    if(visibility === 'private' && !await requestCanvasConfirmation({
        label:L('设为仅自己可见','Make private'),
        description:L('设为仅自己可见后，现有分享链接会立即失效。继续？','Existing share links will be revoked immediately. Continue?'),
        confirmLabel:L('设为仅自己可见','Make private'),
        consequence:'destructive',
    })) return;
    try {
        const res = await fetch(`/api/canvases/${encodeURIComponent(id)}/visibility`, {
            method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({visibility})
        });
        const data = await res.json().catch(() => ({}));
        if(!res.ok) throw new Error(data.detail || L('权限设置失败','Failed to update visibility'));
        Object.assign(c, data.canvas || {visibility});
        renderBoard();
        setStatus(visibility === 'private' ? L('已设为仅自己可见','Canvas is now private') : L('已设为全员可见','Canvas is now shared'));
    } catch(e) { console.error(e); setStatus(e.message || L('权限设置失败','Failed to update visibility')); }
}

async function showCardDeleteConfirm(canvasId){
    const canvas = canvases.find(item => item.id === canvasId);
    if(!canvas) return;
    const accepted = await requestCanvasConfirmation({
        label:L('将画布移入回收站','Move canvas to trash'),
        description:langIsEn()
            ? `Move “${canvas.title}” to trash? You can restore it within 30 days.`
            : `将「${canvas.title}」移入回收站？30 天内可以恢复。`,
        confirmLabel:L('移入回收站','Move to trash'),
        consequence:'neutral',
    });
    if(accepted) deleteCanvas(canvasId);
}

/* ===== Export canvas (download the full canvas JSON) ===== */
async function exportCanvas(id){
    const c = canvases.find(x => x.id === id);
    setStatus(L('正在导出...','Exporting...'));
    try {
        const res = await fetch(`/api/canvases/${encodeURIComponent(id)}`);
        if(!res.ok) throw new Error('export failed');
        const data = await res.json();
        const cv = data.canvas || data;
        const base = String((c?.title) || cv.title || 'canvas').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 60) || 'canvas';
        const blob = new Blob([JSON.stringify(cv, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = base + '.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        setStatus(L('已导出','Exported'));
    } catch(e){ console.error(e); setStatus(L('导出失败','Export failed')); }
}

/* ===== Export canvas with referenced resources ===== */
const ZIP_ENCODER = new TextEncoder();
let ZIP_CRC_TABLE = null;

function safeExportBase(name, fallback = 'canvas'){
    return String(name || fallback).replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 60) || fallback;
}

function collectCanvasResourceUrls(value, out = [], seen = new Set()){
    if(value == null) return out;
    if(typeof value === 'string'){
        const text = value.trim();
        if(isCanvasResourceUrl(text) && !seen.has(text)){
            seen.add(text);
            out.push(text);
        }
        return out;
    }
    if(Array.isArray(value)){
        value.forEach(item => collectCanvasResourceUrls(item, out, seen));
        return out;
    }
    if(typeof value === 'object'){
        Object.values(value).forEach(item => collectCanvasResourceUrls(item, out, seen));
    }
    return out;
}

function isCanvasResourceUrl(url){
    return url.startsWith('/assets/') || /^https?:\/\//i.test(url);
}

function exportResourceName(url, index, used){
    let name = '';
    try {
        const parsed = new URL(url, location.origin);
        name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    } catch(e) {
        name = String(url || '').split(/[?#]/)[0].split('/').pop() || '';
    }
    name = safeExportBase(name || `resource-${String(index + 1).padStart(3, '0')}`, `resource-${index + 1}`);
    if(!/\.[a-z0-9]{1,8}$/i.test(name)) name += '.bin';
    let finalName = `resources/${name}`;
    const dot = finalName.lastIndexOf('.');
    const stem = dot > 0 ? finalName.slice(0, dot) : finalName;
    const ext = dot > 0 ? finalName.slice(dot) : '';
    let suffix = 2;
    while(used.has(finalName)){
        finalName = `${stem}-${suffix}${ext}`;
        suffix++;
    }
    used.add(finalName);
    return finalName;
}

async function fetchResourceBytes(url){
    const res = await fetch(url);
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
}

function zipCrc32(bytes){
    if(!ZIP_CRC_TABLE){
        ZIP_CRC_TABLE = new Uint32Array(256);
        for(let i = 0; i < 256; i++){
            let c = i;
            for(let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
            ZIP_CRC_TABLE[i] = c >>> 0;
        }
    }
    let crc = 0xffffffff;
    for(let i = 0; i < bytes.length; i++) crc = ZIP_CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function zipDosTime(date = new Date()){
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const year = Math.max(1980, date.getFullYear());
    const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
}

function zipHeader(signature, size){
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, signature, true);
    return { bytes, view };
}

function createZipBlob(entries){
    const now = zipDosTime();
    const files = [];
    const central = [];
    let offset = 0;
    entries.forEach(entry => {
        const nameBytes = ZIP_ENCODER.encode(entry.name);
        const data = entry.bytes instanceof Uint8Array ? entry.bytes : ZIP_ENCODER.encode(String(entry.bytes || ''));
        const crc = zipCrc32(data);
        const local = zipHeader(0x04034b50, 30 + nameBytes.length);
        local.view.setUint16(4, 20, true);
        local.view.setUint16(6, 0x0800, true);
        local.view.setUint16(8, 0, true);
        local.view.setUint16(10, now.time, true);
        local.view.setUint16(12, now.day, true);
        local.view.setUint32(14, crc, true);
        local.view.setUint32(18, data.length, true);
        local.view.setUint32(22, data.length, true);
        local.view.setUint16(26, nameBytes.length, true);
        local.bytes.set(nameBytes, 30);
        files.push(local.bytes, data);

        const cd = zipHeader(0x02014b50, 46 + nameBytes.length);
        cd.view.setUint16(4, 20, true);
        cd.view.setUint16(6, 20, true);
        cd.view.setUint16(8, 0x0800, true);
        cd.view.setUint16(10, 0, true);
        cd.view.setUint16(12, now.time, true);
        cd.view.setUint16(14, now.day, true);
        cd.view.setUint32(16, crc, true);
        cd.view.setUint32(20, data.length, true);
        cd.view.setUint32(24, data.length, true);
        cd.view.setUint16(28, nameBytes.length, true);
        cd.view.setUint32(42, offset, true);
        cd.bytes.set(nameBytes, 46);
        central.push(cd.bytes);
        offset += local.bytes.length + data.length;
    });
    const centralSize = central.reduce((sum, bytes) => sum + bytes.length, 0);
    const end = zipHeader(0x06054b50, 22);
    end.view.setUint16(8, entries.length, true);
    end.view.setUint16(10, entries.length, true);
    end.view.setUint32(12, centralSize, true);
    end.view.setUint32(16, offset, true);
    return new Blob([...files, ...central, end.bytes], { type:'application/zip' });
}

async function exportCanvasWithResources(id){
    const c = canvases.find(x => x.id === id);
    setStatus(L('正在收集资源...','Collecting assets...'));
    try {
        const res = await fetch(`/api/canvases/${encodeURIComponent(id)}`);
        if(!res.ok) throw new Error('export failed');
        const data = await res.json();
        const cv = data.canvas || data;
        const base = safeExportBase((c?.title) || cv.title || 'canvas');
        const urls = collectCanvasResourceUrls(cv).slice(0, 1000);
        const usedNames = new Set(['canvas.json', 'resources-manifest.json']);
        const entries = [{ name:'canvas.json', bytes:ZIP_ENCODER.encode(JSON.stringify(cv, null, 2)) }];
        const manifest = [];
        let skipped = 0;
        for(let i = 0; i < urls.length; i++){
            const url = urls[i];
            try {
                const bytes = await fetchResourceBytes(url);
                const name = exportResourceName(url, i, usedNames);
                entries.push({ name, bytes });
                manifest.push({ url, file:name, size:bytes.length });
            } catch(e) {
                skipped++;
                manifest.push({ url, skipped:true, reason:String(e?.message || e || 'fetch failed').slice(0, 120) });
            }
        }
        entries.push({ name:'resources-manifest.json', bytes:ZIP_ENCODER.encode(JSON.stringify({ canvas_id:id, resources:manifest }, null, 2)) });
        const blob = createZipBlob(entries);
        const href = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = href;
        a.download = `${base}.zip`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1500);
        const included = Math.max(0, entries.length - 2);
        setStatus(skipped
            ? L(`已导出，跳过 ${skipped} 个资源`, `Exported, skipped ${skipped} assets`)
            : L(`已导出 ${included} 个资源`, `Exported ${included} assets`));
    } catch(e){ console.error(e); setStatus(L('导出失败','Export failed')); }
}

/* ===== Cut / paste a canvas across projects ===== */
function cutCanvas(id){
    const source = canvases.find(item => item.id === id);
    clipboardCanvas = source ? {...source} : null;
    setStatus(L('已剪切，切换到目标项目后点“粘贴到此项目”','Cut — open another project, then Paste'));
    renderBoard();
}
function updatePasteBtn(){
    if(!pasteCanvasBtn) return;
    const show = Boolean(clipboardCanvas);
    pasteCanvasBtn.hidden = !show;
}
async function pasteCanvas(){
    if(!clipboardCanvas) return;
    const c = clipboardCanvas;
    const targetPid = currentProjectId;
    clipboardCanvas = null;
    if(!c){ updatePasteBtn(); renderBoard(); return; }
    if((c.project || 'default') === targetPid){ renderBoard(); setStatus(L('已在当前项目','Already in this project')); return; }
    await moveCanvasToProject(c.id, targetPid, c);
}

function startCardRename(canvasId){
    const card = boardWorld.querySelector(`.ws-card[data-canvas-id="${CSS.escape(canvasId)}"]`);
    const c = canvases.find(x => x.id === canvasId);
    if(!card || !c) return;
    const titleEl = card.querySelector('.ws-card-title');
    if(!titleEl || titleEl.querySelector('ic-input')) return;
    const input = document.createElement('ic-input');
    input.type = 'text'; input.maxLength = 80; input.value = c.title || '';
    input.className = 'ws-card-title-input';
    input.setAttribute('aria-label', L('画布名称','Canvas name'));
    titleEl.innerHTML = ''; titleEl.appendChild(input);
    let done = false;
    const finish = commit => {
        if(done) return; done = true;
        const v = input.value.trim();
        if(commit && v && v !== c.title) setCanvasTitle(canvasId, v);
        else renderBoard();
    };
    input.addEventListener('mousedown', e => e.stopPropagation());
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('focusout', () => finish(true));
    input.addEventListener('keydown', e => {
        e.stopPropagation();
        if(e.key === 'Enter'){ e.preventDefault(); finish(true); }
        if(e.key === 'Escape'){ e.preventDefault(); finish(false); }
    });
    Promise.resolve(input.updateComplete).then(() => {
        input.focus();
        input.input?.select?.();
    });
}

async function setCanvasTitle(id, title){
    const c = canvases.find(x => x.id === id);
    if(c) c.title = title;
    renderBoard();
    await persistMeta(id, { title });
}

async function moveCanvasToProject(id, projectId, sourceRecord=null){
    const c = canvases.find(x => x.id === id) || sourceRecord;
    const sourceProject = c?.project || currentProjectId;
    if(c) c.project = projectId;
    canvasCacheByProject.delete(sourceProject);
    canvasCacheByProject.delete(projectId);
    canvasPageState.delete(sourceProject);
    canvasPageState.delete(projectId);
    canvases = canvases.filter(item => item.id !== id);
    await persistMeta(id, { project: projectId });
    await loadCurrentProjectBatch({reset:true});
    renderProjects();
    setStatus(L('已移动','Moved'));
}

/* ===== Card meta persist (POST /meta) ===== */
async function persistMeta(id, patch){
    try {
        const res = await fetch(`/api/canvases/${encodeURIComponent(id)}/meta`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch)
        });
        if(!res.ok) throw new Error('meta save failed');
        const data = await res.json();
        if(data.canvas){
            const idx = canvases.findIndex(x => x.id === id);
            if(idx >= 0) canvases[idx] = { ...canvases[idx], ...data.canvas };
        }
    } catch(e){ console.error(e); setStatus(L('保存失败','Save failed')); }
}

async function persistMetaBatch(updates){
    try {
        const res = await fetch('/api/canvases/meta/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updates })
        });
        if(!res.ok) throw new Error('meta batch save failed');
    } catch(e){ console.error(e); setStatus(L('保存失败','Save failed')); }
}

/* ===== Delete canvas (soft -> trash, with confirm) ===== */
async function deleteCanvas(id){
    const c = canvases.find(x => x.id === id);
    if(!c) return;
    try {
        const res = await fetch(`/api/canvases/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if(!res.ok) throw new Error('delete failed');
        canvases = canvases.filter(x => x.id !== id);
        cacheProjectCanvases(currentProjectId, canvases);
        const page = canvasPageState.get(currentProjectId);
        if(page) page.total = Math.max(0, Number(page.total || 0) - 1);
        renderBoard();
        renderProjects();
        refreshTrashCount();
        setStatus(L('已移入回收站','Moved to trash'));
    } catch(e){ console.error(e); setStatus(L('删除失败','Delete failed')); }
}

/* ===== Trash / recycle bin ===== */
async function refreshTrashCount(){
    try {
        const res = await fetch('/api/canvases/trash');
        if(!res.ok) return;
        const data = await res.json();
        deletedCanvases = data.canvases || [];
        const n = deletedCanvases.length;
        trashBadge.textContent = String(n);
        trashBadge.classList.toggle('visible', n > 0);
    } catch(e){}
}
async function openTrashView(){
    trashEntryBtn.classList.add('active');
    trashPanel.classList.add('active');
    closeCardMenu(); closeCreateCard();
    await loadTrash();
}
function closeTrashView(){
    trashEntryBtn.classList.remove('active');
    trashPanel.classList.remove('active');
}
async function loadTrash(){
    try {
        const res = await fetch('/api/canvases/trash');
        if(!res.ok) throw new Error('trash load failed');
        const data = await res.json();
        deletedCanvases = data.canvases || [];
        renderTrash();
        const n = deletedCanvases.length;
        trashBadge.textContent = String(n);
        trashBadge.classList.toggle('visible', n > 0);
    } catch(e){ console.error(e); setStatus(L('加载回收站失败','Load trash failed')); }
}
function renderTrash(){
    trashListEl.innerHTML = '';
    const canPurge = currentUser?.role === 'admin';
    if(!deletedCanvases.length){
        const empty = document.createElement('ic-empty-state');
        empty.className = 'ws-trash-empty';
        empty.setAttribute('title', L('回收站为空','Trash is empty'));
        empty.setAttribute('label', L('回收站','Trash'));
        trashListEl.appendChild(empty);
        return;
    }
    deletedCanvases.forEach(c => {
        const isSmart = (c.kind || 'classic') === 'smart';
        const projName = (projects.find(p => p.id === (c.project || 'default')) || {}).name || L('默认项目','Default');
        const canvasKindTag = isSmart
            ? ''
            : `<ic-badge class="ws-card-kind classic" kind="label" tone="neutral">${L('普通','Classic')}</ic-badge>`;
        const card = document.createElement('ic-card');
        card.className = 'ws-trash-card';
        card.setAttribute('size', 'small');
        card.setAttribute('label', c.title || L('已删除画布','Deleted canvas'));
        card.dataset.canvasId = c.id;
        card.innerHTML = `
            <div class="ws-card-top">
                <span class="ws-card-icon">${renderCanvasIcon(isSmart && /[^\x00-\x7F]/.test(c.icon || '') ? 'sparkles' : c.icon, 17)}</span>
                ${canvasKindTag}
            </div>
            <div class="ws-card-title">${escapeHtml(c.title)}</div>
            <div class="ws-card-meta"><span class="ws-card-nodes">${escapeHtml(projName)}</span><span class="ws-card-meta-dot"></span><span class="ws-card-time">${formatCanvasTime(c.deleted_at)}</span></div>
            <div class="ws-card-actions">
                <ic-button class="ws-trash-act restore" type="button" hierarchy="secondary"><ic-icon slot="start" name="restore" aria-hidden="true"></ic-icon><span>${L('恢复','Restore')}</span></ic-button>
                ${canPurge ? `
                <ic-button class="ws-trash-act purge" type="button" hierarchy="secondary" tone="danger"><ic-icon slot="start" name="delete" aria-hidden="true"></ic-icon><span>${L('彻底删除','Delete')}</span></ic-button>
                ` : ''}
            </div>`;
        card.querySelector('.ws-trash-act.restore').onclick = () => restoreCanvas(c.id);
        if(canPurge){
            card.querySelector('.ws-trash-act.purge').onclick = () => requestPurgeCanvas(c.id);
        }
        trashListEl.appendChild(card);
    });
}

async function requestPurgeCanvas(id){
    const canvas = deletedCanvases.find(item => item.id === id);
    if(!canvas) return;
    if(!await requestCanvasConfirmation({
        label:L('彻底删除画布','Delete canvas permanently'),
        description:langIsEn()
            ? `Delete “${canvas.title}” permanently? This action cannot be undone.`
            : `彻底删除「${canvas.title}」？删除后不可恢复。`,
        confirmLabel:L('彻底删除','Delete permanently'),
        consequence:'destructive',
    })) return;
    purgeCanvas(id);
}
async function restoreCanvas(id){
    try {
        const res = await fetch(`/api/canvases/${encodeURIComponent(id)}/restore`, { method: 'POST' });
        if(!res.ok) throw new Error('restore failed');
        deletedCanvases = deletedCanvases.filter(c => c.id !== id);
        await loadAll();           // restored canvas returns to its stored project
        renderTrash();
        setStatus(L('已恢复','Restored'));
    } catch(e){ console.error(e); setStatus(L('恢复失败','Restore failed')); }
}
async function purgeCanvas(id){
    try {
        const res = await fetch(`/api/canvases/${encodeURIComponent(id)}/purge`, { method: 'DELETE' });
        if(!res.ok) throw new Error('purge failed');
        deletedCanvases = deletedCanvases.filter(c => c.id !== id);
        renderTrash();
        const n = deletedCanvases.length;
        trashBadge.textContent = String(n);
        trashBadge.classList.toggle('visible', n > 0);
        setStatus(L('已彻底删除','Deleted'));
    } catch(e){ console.error(e); setStatus(L('删除失败','Delete failed')); }
}

/* ===== Event bindings ===== */
board.addEventListener('mousedown', onBoardPanStart, true);
board.addEventListener('click', suppressTemporaryHandClick, true);
document.addEventListener('mousemove', onBoardPanMove);
document.addEventListener('mouseup', onBoardPanEnd);
board.addEventListener('wheel', onBoardWheel, { passive: false });
board.addEventListener('dblclick', e => {
    if(e.target.closest('.ws-card,.ws-topbar-right')) return;
    openCreateCard(screenToWorld(e.clientX, e.clientY));
});

newCanvasBtn.addEventListener('click', () => openCreateCard(boardCenterWorld()));
emptyCreateCanvasBtn?.addEventListener('mousedown', e => e.stopPropagation());
emptyCreateCanvasBtn?.addEventListener('click', e => {
    e.stopPropagation();
    openCreateCard(boardCenterWorld());
});
createCanvasKind.addEventListener('ic-change', event => {
    createKind = event.detail?.value || 'smart';
});
createCanvasCancel.addEventListener('click', closeCreateCard);
createCanvasConfirm.addEventListener('click', () => {
    if(!createWorldPoint) return;
    createCanvasOnBoard(createCanvasName.value.trim(), createKind, createWorldPoint);
});
createCanvasName.addEventListener('keydown', event => {
    if(event.key !== 'Enter' || !createWorldPoint) return;
    event.preventDefault();
    createCanvasOnBoard(createCanvasName.value.trim(), createKind, createWorldPoint);
});
createCanvasDialog.addEventListener('ic-after-hide', () => { createWorldPoint = null; });
boardRefreshBtn.addEventListener('click', () => refreshCanvasListSession().catch(handleCanvasListSessionError));
boardLoadMoreBtn?.addEventListener('click', loadNextCanvasBatch);
boardResetViewBtn.addEventListener('click', resetView);
pasteCanvasBtn?.addEventListener('click', pasteCanvas);

projectListEl.addEventListener('ic-change', event => {
    const projectId = event.detail?.value;
    if(projectId) selectProject(projectId);
});
newProjectBtn.addEventListener('click', openNewProject);
newProjectConfirm.addEventListener('click', createProject);
newProjectCancel.addEventListener('click', closeNewProject);
newProjectInput.addEventListener('keydown', e => {
    if(e.key === 'Enter'){ e.preventDefault(); createProject(); }
    if(e.key === 'Escape'){ e.preventDefault(); closeNewProject(); }
});

trashEntryBtn.addEventListener('click', () => {
    if(trashPanel.classList.contains('active')) closeTrashView();
    else openTrashView();
});
trashCloseBtn.addEventListener('click', closeTrashView);

// close the card menu when clicking outside; public Popover owns its own dismissal.
document.addEventListener('mousedown', e => {
    const floatingPanel = document.querySelector('.ws-card-pop');
    if(floatingPanel && !e.target.closest('.ws-card-pop') && !e.target.closest('.ws-card-menu')){
        closeCardMenu();
    }
});

document.addEventListener('keydown', e => {
    if(e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey && !isCanvasListEditableTarget(e.target)){
        if(e.repeat) return;
        e.preventDefault();
        boardSpacePan = true;
        closeCardMenu();
        refreshBoardToolState();
        return;
    }
    if(e.key !== 'Escape') return;
    closeCardMenu();
    closeCreateCard();
    if(trashPanel.classList.contains('active')) closeTrashView();
});
document.addEventListener('keyup', e => {
    if(e.code !== 'Space' || !boardSpacePan) return;
    boardSpacePan = false;
    refreshBoardToolState();
});
window.addEventListener('blur', cancelBoardPan);
window.addEventListener('pagehide', () => {
    canvasListPageLeaving = true;
});
document.addEventListener('visibilitychange', () => {
    if(document.hidden) cancelBoardPan();
});

// language switch from parent (index.html) via postMessage
window.addEventListener('message', event => {
    if(event.origin && event.origin !== location.origin) return;
    if(event.data?.type === 'studio-lang'){
        if(event.data.lang && window.StudioI18n) StudioI18n.set(event.data.lang);
        window.StudioI18n?.apply?.();
        renderProjects();
        renderBoard();
        if(trashPanel.classList.contains('active')) renderTrash();
        refreshIcons();
    }
    if(event.data?.type === 'canvas-focus'){
        refreshCanvasListSession().catch(handleCanvasListSessionError);
    }
});

/* ===== Boot ===== */
window.StudioI18n?.apply?.();
applyViewport();
refreshCanvasListSession().catch(handleCanvasListSessionError);
refreshIcons();
