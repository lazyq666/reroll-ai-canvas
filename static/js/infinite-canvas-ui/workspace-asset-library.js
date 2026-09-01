const escapeText = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const copy = (key, zh, en) => {
  const translated = globalThis.StudioI18n?.t?.(key);
  if (translated && translated !== key) return translated;
  return (document.documentElement.lang || '').toLowerCase().startsWith('en') ? en : zh;
};

const format = (key, values, zh, en) => {
  let text = copy(key, zh, en);
  Object.entries(values || {}).forEach(([name, value]) => {
    text = text.replaceAll(`{${name}}`, String(value));
  });
  return text;
};

export class IcWorkspaceAssetLibrary extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._items = [];
    this._folders = [];
    this._allCount = 0;
    this._activeFolderId = '';
    this._cursor = '';
    this._query = '';
    this._loading = false;
    this._error = '';
    this._atCapacity = false;
    this._request = 0;
    this._editingId = '';
    this._editingName = '';
    this._editingError = '';
    this._folderEditorMode = '';
    this._folderEditorId = '';
    this._folderEditorName = '';
    this._folderEditorError = '';
    this._pendingDelete = null;
    this._pendingFolderDelete = null;
    this._importing = false;
    this._importNotice = '';
    this._searchTimer = 0;
    this._handleLanguageChange = () => this.render();
    this.shadowRoot.addEventListener('ic-confirm', event => {
      if (event.target.matches?.('[data-delete-confirmation]') && this._pendingDelete) this.unpublish(this._pendingDelete);
      if (event.target.matches?.('[data-folder-delete-confirmation]') && this._pendingFolderDelete) this.deleteFolder(this._pendingFolderDelete);
    });
    this.shadowRoot.addEventListener('ic-cancel', event => {
      if (event.target.matches?.('[data-delete-confirmation]')) this._pendingDelete = null;
      if (event.target.matches?.('[data-folder-delete-confirmation]')) this._pendingFolderDelete = null;
    });
  }

  connectedCallback() {
    window.addEventListener('studio-lang-change', this._handleLanguageChange);
    this.render();
  }

  disconnectedCallback() {
    window.removeEventListener('studio-lang-change', this._handleLanguageChange);
    clearTimeout(this._searchTimer);
  }

  get items() { return this._items.map(item => ({ ...item })); }
  get folders() { return this._folders.map(folder => ({ ...folder })); }
  get activeFolderId() { return this._activeFolderId; }

  async refresh({ preserveQuery = true } = {}) {
    if (!preserveQuery) this._query = '';
    this._items = [];
    this._cursor = '';
    this._error = '';
    await this.load({ reset: true });
    this.shadowRoot.querySelector('[data-search]')?.focus({ preventScroll:true });
  }

  async load({ reset = false } = {}) {
    if (this._loading && !reset) return;
    const request = ++this._request;
    this._loading = true;
    this._error = '';
    if (reset) { this._items = []; this._cursor = ''; }
    this.render();
    try {
      const search = new URLSearchParams({ query: this._query, limit: '60' });
      if (this._activeFolderId) search.set('folder_id', this._activeFolderId);
      if (!reset && this._cursor) search.set('cursor', this._cursor);
      const response = await fetch(`/api/workspace-assets?${search}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || payload.message || copy('smart.assetLibraryLoadFailed', '资产库加载失败', 'Could not load the asset library'));
      }
      const payload = await response.json();
      if (request !== this._request) return;
      const additions = Array.isArray(payload.items) ? payload.items : [];
      this._items = (reset ? additions : [...this._items, ...additions]).slice(-120);
      this._folders = Array.isArray(payload.folders) ? payload.folders : [];
      this._allCount = Number(payload.all_count ?? this._items.length) || 0;
      this._cursor = String(payload.next_cursor || '');
      this._atCapacity = Boolean(payload.at_capacity);
    } catch (error) {
      if (request === this._request) this._error = error.message || copy('smart.assetLibraryLoadRetry', '资产库加载失败，请重试', 'Could not load the asset library. Try again.');
    } finally {
      if (request === this._request) { this._loading = false; this.render(); }
    }
  }

  scheduleSearch(value) {
    this._query = String(value ?? '');
    this.shadowRoot.querySelector('[data-search-clear]')?.toggleAttribute('hidden', !this._query);
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.load({ reset: true }), 220);
  }

  async selectFolder(folderId) {
    const next = String(folderId || '');
    if (next === this._activeFolderId) return;
    this._activeFolderId = next;
    this.cancelAssetRename({ render:false });
    await this.load({ reset:true });
  }

  async rename(item, name) {
    this._editingName = String(name ?? '');
    const clean = this._editingName.trim();
    if (!clean || clean.length > 120) {
      this._editingError = copy('smart.assetLibraryNameValidation', '素材名称需为 1–120 个字符', 'Asset names must be 1–120 characters.');
      this.render();
      queueMicrotask(() => this.shadowRoot.querySelector('[data-rename-input]')?.focus({ preventScroll:true }));
      return;
    }
    try {
      const response = await fetch(`/api/workspace-assets/${encodeURIComponent(item.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: clean }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        this._editingError = payload.detail || copy('smart.assetLibraryRenameFailed', '素材改名失败', 'Could not rename the asset.');
        this.render();
        queueMicrotask(() => this.shadowRoot.querySelector('[data-rename-input]')?.focus({ preventScroll:true }));
        return;
      }
      const payload = await response.json();
      this._items = this._items.map(entry => entry.id === item.id ? payload.item : entry);
      this.cancelAssetRename({ render:false });
      this.render();
    } catch (error) {
      this._editingError = error?.message || copy('smart.assetLibraryRenameFailed', '素材改名失败', 'Could not rename the asset.');
      this.render();
      queueMicrotask(() => this.shadowRoot.querySelector('[data-rename-input]')?.focus({ preventScroll:true }));
    }
  }

  async unpublish(item) {
    const confirmation = this.shadowRoot.querySelector('[data-delete-confirmation]');
    if (confirmation) confirmation.confirmLoading = true;
    try {
      const response = await fetch(`/api/workspace-assets/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        this._error = payload.detail || copy('smart.assetLibraryRemoveFailed', '从资产库移除失败', 'Could not remove the asset from the library.');
        this._pendingDelete = null;
        this.render();
        return;
      }
      this._pendingDelete = null;
      await this.load({ reset:true });
      queueMicrotask(() => (this.shadowRoot.querySelector('.card') || this.shadowRoot.querySelector('[data-search]'))?.focus());
    } catch (error) {
      this._error = error?.message || copy('smart.assetLibraryRemoveFailed', '从资产库移除失败', 'Could not remove the asset from the library.');
      this._pendingDelete = null;
      this.render();
    }
  }

  startRename(itemId) {
    const item = this._items.find(entry => entry.id === itemId);
    if (!item) return;
    this._editingId = itemId;
    this._editingName = item.name;
    this._editingError = '';
    this.render();
    queueMicrotask(() => this.shadowRoot.querySelector('[data-rename-input]')?.select());
  }

  cancelAssetRename({ restoreFocus = true, render = true } = {}) {
    const itemId = this._editingId;
    this._editingId = '';
    this._editingName = '';
    this._editingError = '';
    if (render) this.render();
    if (restoreFocus && render) requestAnimationFrame(() => this.shadowRoot.querySelector(`[data-rename="${CSS.escape(itemId)}"]`)?.focus({ preventScroll:true }));
  }

  submitRename() {
    const item = this._items.find(entry => entry.id === this._editingId);
    const input = this.shadowRoot.querySelector('[data-rename-input]');
    if (item && input) this.rename(item, input.value);
  }

  requestDelete(itemId, trigger) {
    const item = this._items.find(entry => entry.id === itemId);
    const confirmation = this.shadowRoot.querySelector('[data-delete-confirmation]');
    if (!item || !confirmation || !trigger) return;
    this._pendingDelete = item;
    confirmation.setAttribute('label', format('smart.assetLibraryRemoveTitle', {name:item.name}, `从资产库移除“${item.name}”？`, `Remove “${item.name}” from the asset library?`));
    confirmation.setAttribute('description', copy('smart.assetLibraryRemoveDescription', '移除后，这张图片将不再出现在资产库中。画布中的图片和已经插入的引用不受影响。', 'The image will no longer appear in the asset library. Images and references already on canvases are unaffected.'));
    confirmation.show(trigger);
  }

  startFolderEditor(mode, folderId = '') {
    const folder = this._folders.find(candidate => candidate.id === folderId);
    this._folderEditorMode = mode;
    this._folderEditorId = folder?.id || '';
    this._folderEditorName = folder?.name || '';
    this._folderEditorError = '';
    this.render();
    queueMicrotask(() => this.shadowRoot.querySelector('[data-folder-name]')?.select());
  }

  cancelFolderEditor({ restoreFocus = true } = {}) {
    const folderId = this._folderEditorId;
    this._folderEditorMode = '';
    this._folderEditorId = '';
    this._folderEditorName = '';
    this._folderEditorError = '';
    this.render();
    if (restoreFocus) requestAnimationFrame(() => (folderId
      ? this.shadowRoot.querySelector(`[data-folder-edit="${CSS.escape(folderId)}"]`)
      : this.shadowRoot.querySelector('[data-folder-new]'))?.focus({ preventScroll:true }));
  }

  async saveFolder() {
    const name = String(this.shadowRoot.querySelector('[data-folder-name]')?.value || '').trim();
    if (!name || name.length > 24) {
      this._folderEditorError = copy('smart.assetLibraryFolderValidation', '文件夹名称需为 1–24 个字符', 'Folder names must be 1–24 characters.');
      this.render();
      queueMicrotask(() => this.shadowRoot.querySelector('[data-folder-name]')?.focus({ preventScroll:true }));
      return;
    }
    const editing = this._folderEditorMode === 'edit';
    const url = editing ? `/api/workspace-assets/folders/${encodeURIComponent(this._folderEditorId)}` : '/api/workspace-assets/folders';
    try {
      const response = await fetch(url, {
        method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        this._folderEditorError = payload.detail || copy('smart.assetLibraryFolderSaveFailed', '文件夹保存失败', 'Could not save the folder.');
        this.render();
        queueMicrotask(() => this.shadowRoot.querySelector('[data-folder-name]')?.focus({ preventScroll:true }));
        return;
      }
      const payload = await response.json();
      this._folderEditorMode = '';
      this._folderEditorId = '';
      this._folderEditorName = '';
      this._folderEditorError = '';
      await this.load({ reset:true });
      const id = payload.folder?.id || '';
      requestAnimationFrame(() => this.shadowRoot.querySelector(`[data-folder-id="${CSS.escape(id)}"]`)?.focus({ preventScroll:true }));
    } catch (error) {
      this._folderEditorError = error?.message || copy('smart.assetLibraryFolderSaveFailed', '文件夹保存失败', 'Could not save the folder.');
      this.render();
    }
  }

  requestFolderDelete(folderId, trigger) {
    const folder = this._folders.find(candidate => candidate.id === folderId);
    const confirmation = this.shadowRoot.querySelector('[data-folder-delete-confirmation]');
    if (!folder || !confirmation || !trigger) return;
    this._pendingFolderDelete = folder;
    confirmation.setAttribute('label', format('smart.assetLibraryFolderDeleteTitle', {name:folder.name}, `删除文件夹“${folder.name}”？`, `Delete the “${folder.name}” folder?`));
    confirmation.setAttribute('description', format('smart.assetLibraryFolderDeleteDescription', {count:folder.item_count || 0}, `其中 ${folder.item_count || 0} 项素材会保留在“全部”中，素材本身不会被移除。`, `${folder.item_count || 0} assets will remain in All. The assets themselves will not be removed.`));
    confirmation.show(trigger);
  }

  async deleteFolder(folder) {
    const confirmation = this.shadowRoot.querySelector('[data-folder-delete-confirmation]');
    if (confirmation) confirmation.confirmLoading = true;
    try {
      const response = await fetch(`/api/workspace-assets/folders/${encodeURIComponent(folder.id)}`, { method:'DELETE' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || copy('smart.assetLibraryFolderDeleteFailed', '文件夹删除失败', 'Could not delete the folder.'));
      }
      if (this._activeFolderId === folder.id) this._activeFolderId = '';
      this._pendingFolderDelete = null;
      await this.load({ reset:true });
    } catch (error) {
      this._error = error?.message || copy('smart.assetLibraryFolderDeleteFailed', '文件夹删除失败', 'Could not delete the folder.');
      this._pendingFolderDelete = null;
      this.render();
    }
  }

  async moveToFolder(itemId, folderId) {
    const item = this._items.find(entry => entry.id === itemId);
    if (!item || String(item.folder_id || '') === String(folderId || '')) return;
    try {
      const response = await fetch(`/api/workspace-assets/${encodeURIComponent(itemId)}`, {
        method:'PATCH', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ folder_id:String(folderId || '') }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || copy('smart.assetLibraryMoveFailed', '素材移动失败', 'Could not move the asset.'));
      }
      await response.json();
      await this.load({ reset:true });
    } catch (error) {
      this._error = error?.message || copy('smart.assetLibraryMoveFailed', '素材移动失败', 'Could not move the asset.');
      this.render();
    }
  }

  async importFiles(fileList) {
    const files = [...(fileList || [])];
    if (!files.length || this._importing) return;
    this._importing = true;
    this._importNotice = '';
    this.render();
    try {
      const body = new FormData();
      files.forEach(file => body.append('files', file, file.name));
      body.append('folder_id', this._activeFolderId);
      const response = await fetch('/api/workspace-assets/import', { method:'POST', body });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || payload.message || copy('smart.assetLibraryImportFailed', '批量导入失败', 'Batch import failed.'));
      const created = Number(payload.created || 0);
      const existing = Number(payload.existing || 0);
      const failed = Number(payload.failed || 0);
      this._importNotice = format(
        'smart.assetLibraryImportSummary',
        {created, existing, failed},
        `已导入 ${created} 项，${existing} 项已存在，${failed} 项失败`,
        `Imported ${created}; already present ${existing}; failed ${failed}`,
      );
      await this.load({ reset:true });
      this.dispatchEvent(new CustomEvent('ic-assets-imported', {
        bubbles:true,
        composed:true,
        detail:{ created, existing, failed, failures:Array.isArray(payload.failures) ? payload.failures : [] },
      }));
    } catch (error) {
      this._error = error?.message || copy('smart.assetLibraryImportFailed', '批量导入失败', 'Batch import failed.');
    } finally {
      this._importing = false;
      this.render();
    }
  }

  moveCardFocus(card, direction) {
    const cards = [...this.shadowRoot.querySelectorAll('.card')];
    const currentIndex = cards.indexOf(card);
    if (currentIndex < 0) return false;
    const rect = card.getBoundingClientRect();
    const origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const vertical = direction === 'ArrowDown' || direction === 'ArrowUp';
    const sign = direction === 'ArrowDown' || direction === 'ArrowRight' ? 1 : -1;
    const candidates = cards.map((candidate, index) => {
      if (index === currentIndex) return null;
      const candidateRect = candidate.getBoundingClientRect();
      const point = { x:candidateRect.left + candidateRect.width / 2, y:candidateRect.top + candidateRect.height / 2 };
      const primary = (vertical ? point.y - origin.y : point.x - origin.x) * sign;
      if (primary <= 1) return null;
      const secondary = Math.abs(vertical ? point.x - origin.x : point.y - origin.y);
      return { candidate, score:primary * 4 + secondary };
    }).filter(Boolean).sort((left, right) => left.score - right.score);
    if (candidates[0]) {
      candidates[0].candidate.focus({ preventScroll:true });
      candidates[0].candidate.scrollIntoView({ block:'nearest' });
      return true;
    }
    if (sign > 0 && this._cursor && !this._loading) this.load();
    return false;
  }

  render() {
    const previousScroll = this.shadowRoot.querySelector('.results')?.scrollTop || 0;
    const previousSearch = this.shadowRoot.querySelector('[data-search]');
    const restoreSearchFocus = Boolean(previousSearch?.matches(':focus-within'));
    const searchSelection = previousSearch?.selectionStart ?? this._query.length;
    const removeDescription = copy('smart.assetLibraryRemoveDescription', '移除后，这张图片将不再出现在资产库中。画布中的图片和已经插入的引用不受影响。', 'The image will no longer appear in the asset library. Images and references already on canvases are unaffected.');
    const folderEditor = this._folderEditorMode ? `
      <div class="folder-editor"><ic-form-field class="folder-field" aria-label="${escapeText(copy('smart.assetLibraryFolderName', '文件夹名称', 'Folder name'))}" data-component-name="ic-form-field-text-s" validation="${escapeText(this._folderEditorError)}"><ic-input slot="control" data-folder-name type="text" size="s" value="${escapeText(this._folderEditorName)}" placeholder="${escapeText(copy('smart.assetLibraryFolderPlaceholder', '请输入文件夹名称', 'Enter a folder name'))}" maxlength="24" autocomplete="off"></ic-input></ic-form-field></div>` : '';
    this.shadowRoot.innerHTML = `
      <style>
        :host { box-sizing:border-box; display:flex; width:100%; height:100%; min-height:0; color:var(--ui-color-text-primary); }
        * { box-sizing:border-box; }
        .library { position:relative; width:100%; min-height:0; background:var(--ui-color-surface); }
        .layout { width:100%; height:100%; min-width:0; min-height:0; display:grid; grid-template-columns:calc(13 * var(--ui-space-4)) minmax(0,1fr); gap:var(--ui-space-4); padding:var(--ui-space-4) var(--ui-space-6) var(--ui-space-6); }
        .sidebar { min-width:0; min-height:0; display:flex; flex-direction:column; gap:var(--ui-space-2); padding:var(--ui-space-3); overflow:auto; border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary); border-radius:var(--ui-radius-l); background:var(--ui-color-surface); }
        .search-field,.search-field ic-input,.folder-field,.folder-field ic-input { width:100%; min-width:0; }
        .search-field ic-input,.folder-field ic-input { --wa-form-control-height:var(--ui-control-height-s); --wa-form-control-value-font-size:var(--ui-font-size-2); }
        .search-field ic-input::part(input)::-webkit-search-cancel-button { display:none; -webkit-appearance:none; }
        [data-search-clear][hidden] { display:none; }
        .folder-heading { display:flex; align-items:center; justify-content:space-between; min-height:var(--ui-control-height-s); padding-inline:var(--ui-space-2); color:var(--ui-color-text-tertiary); font:var(--ui-text-caption); }
        .folders { display:flex; flex-direction:column; gap:0.125rem; }
        .folder-row { position:relative; min-width:0; }
        .folder-button,.folder-new { width:100%; min-height:var(--ui-control-height-s); display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:var(--ui-space-2); padding:0 var(--ui-space-2); border:0; border-radius:var(--ui-radius-s); color:var(--ui-color-text-primary); background:transparent; font:inherit; text-align:start; }
        .folder-button:is(:hover,:focus-visible),.folder-new:is(:hover,:focus-visible),.folder-button[data-drop-target] { background:var(--ui-color-action-tertiary-hover); }
        .folder-button[aria-current="page"] { background:var(--ui-color-action-secondary-selected); }
        .folder-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .folder-count { color:var(--ui-color-text-tertiary); font:var(--ui-text-caption); }
        .folder-actions { position:absolute; inset-inline-end:var(--ui-space-2); top:50%; display:flex; align-items:center; gap:var(--ui-space-1); border-radius:var(--ui-radius-s); background:inherit; opacity:0; visibility:hidden; pointer-events:none; transform:translateY(-50%); }
        .folder-row:is(:hover,:focus-within) .folder-actions { opacity:1; visibility:visible; pointer-events:auto; }
        .folder-actions ic-icon-button { --ic-icon-button-control-size:1.5rem; --ic-icon-button-icon-size:var(--ui-icon-size-s); }
        .folder-new { display:flex; justify-content:flex-start; }
        .folder-editor { min-height:var(--ui-control-height-s); padding-inline:var(--ui-space-2); }
        .content { min-width:0; min-height:0; display:grid; grid-template-rows:auto minmax(0,1fr); }
        .toolbar { min-height:var(--ui-control-height-m); display:flex; align-items:center; justify-content:flex-end; gap:var(--ui-space-2); padding:0 0 var(--ui-space-3); border-block-end:var(--ui-border-width-thin) solid var(--ui-color-border-secondary); }
        .import-notice { margin-inline-end:auto; color:var(--ui-color-text-secondary); font:var(--ui-text-caption); }
        .capacity { margin-inline-end:auto; color:var(--ui-color-text-danger); font-size:var(--ui-font-size-2); }
        .results { min-height:0; overflow:auto; overscroll-behavior:contain; padding-block-start:var(--ui-space-3); }
        .grid { columns:11.25rem; column-gap:var(--ui-space-3); }
        .card { position:relative; width:100%; min-height:5rem; margin:0 0 var(--ui-space-3); padding:0; display:inline-flex; flex-direction:column; gap:var(--ui-space-1); break-inside:avoid; color:inherit; cursor:pointer; vertical-align:top; }
        .card:focus-visible { outline:var(--ui-focus-ring); outline-offset:var(--ui-focus-ring-offset); }
        .card img { width:100%; height:auto; max-height:33.75rem; display:block; object-fit:contain; border-radius:var(--ui-radius-xs); background:var(--ui-color-surface-subtle); }
        .meta { position:relative; min-width:0; min-height:1.75rem; display:flex; align-items:center; background:var(--ui-color-surface); }
        .name { min-width:0; flex:1; overflow:hidden; color:var(--ui-color-text-secondary); font-size:var(--ui-font-size-2); font-weight:var(--ui-font-weight-regular); text-overflow:ellipsis; white-space:nowrap; }
        .actions { position:absolute; inset-inline-end:0; top:50%; display:flex; align-items:center; gap:var(--ui-space-1); padding:0; border-radius:var(--ui-radius-s); background:inherit; opacity:0; visibility:hidden; pointer-events:none; transform:translateY(-50%); transition:opacity var(--ui-motion-duration-fast) var(--ui-motion-ease-standard); }
        .card:is(:hover,:focus-within) .actions { opacity:1; visibility:visible; pointer-events:auto; }
        .actions ic-icon-button { color:var(--ui-color-text-primary); --ic-icon-button-control-size:1.5rem; --ic-icon-button-icon-size:var(--ui-icon-size-s); }
        .actions ic-icon-button::part(base),.folder-actions ic-icon-button::part(base) { inline-size:100%; min-inline-size:100%; block-size:100%; min-block-size:100%; padding:0; }
        .rename-field { width:100%; min-width:0; }
        .rename-input { width:100%; min-width:0; --wa-form-control-height:1.75rem; }
        .state { padding:var(--ui-space-8); color:var(--ui-color-text-tertiary); text-align:center; }
        .state button { margin-inline-start:var(--ui-space-2); }
        button { font:inherit; }
        @media (max-width:720px) { .layout { grid-template-columns:minmax(0,1fr); grid-template-rows:auto minmax(0,1fr); padding:var(--ui-space-3) var(--ui-space-4) var(--ui-space-4); } .sidebar { max-height:16rem; } }
      </style>
      <section class="library" aria-label="${escapeText(copy('smart.workspaceAssetLibrary', '资产库', 'Asset library'))}">
        <div class="layout">
          <aside class="sidebar">
            <ic-form-field class="search-field" aria-label="${escapeText(copy('smart.assetLibrarySearch', '搜索资产库', 'Search asset library'))}" data-component-name="ic-form-field-search-s">
              <ic-input slot="control" data-search type="search" size="s" value="${escapeText(this._query)}" placeholder="${escapeText(copy('smart.assetLibrarySearchPlaceholder', '搜索素材名称', 'Search asset names'))}" aria-label="${escapeText(copy('smart.assetLibrarySearch', '搜索资产库', 'Search asset library'))}" autocomplete="off" end-action>
                <ic-icon slot="start" name="search"></ic-icon><ic-icon-button slot="end" type="button" size="s" background="ghost" icon="close" label="${escapeText(copy('smart.clearSearch', '清除搜索', 'Clear search'))}" data-search-clear ${this._query ? '' : 'hidden'}></ic-icon-button>
              </ic-input>
            </ic-form-field>
            <div class="folder-heading"><span>${escapeText(copy('smart.assetLibraryFolders', '文件夹', 'Folders'))}</span></div>
            <nav class="folders" aria-label="${escapeText(copy('smart.assetLibraryFolders', '文件夹', 'Folders'))}">
              <div class="folder-row"><button type="button" class="folder-button" data-folder-id="" ${this._activeFolderId ? '' : 'aria-current="page"'}><span class="folder-label">${escapeText(copy('smart.assetLibraryAll', '全部', 'All'))}</span><small class="folder-count">${this._allCount}</small></button></div>
              ${this._folders.map(folder => this._folderEditorMode === 'edit' && this._folderEditorId === folder.id
                ? `<div class="folder-row">${folderEditor}</div>`
                : `<div class="folder-row"><button type="button" class="folder-button" data-folder-id="${escapeText(folder.id)}" ${this._activeFolderId === folder.id ? 'aria-current="page"' : ''}><span class="folder-label">${escapeText(folder.name)}</span><small class="folder-count">${Number(folder.item_count) || 0}</small></button><span class="folder-actions"><ic-icon-button type="button" size="s" hierarchy="quiet" icon="edit" label="${escapeText(copy('smart.assetLibraryRenameFolder', '重命名文件夹', 'Rename folder'))}" data-folder-edit="${escapeText(folder.id)}"></ic-icon-button><ic-icon-button type="button" size="s" hierarchy="quiet" icon="delete" label="${escapeText(copy('smart.assetLibraryDeleteFolder', '删除文件夹', 'Delete folder'))}" data-folder-delete="${escapeText(folder.id)}"></ic-icon-button></span></div>`).join('')}
              ${this._folderEditorMode === 'create' ? folderEditor : ''}${this._folderEditorMode ? '' : `<button class="folder-new" type="button" data-folder-new><ic-icon name="add"></ic-icon><span>${escapeText(copy('smart.assetLibraryNewFolder', '新建文件夹', 'New folder'))}</span></button>`}
            </nav>
          </aside>
          <main class="content">
            <header class="toolbar">
              ${this._atCapacity ? `<span class="capacity">${escapeText(copy('smart.assetLibraryCapacity', '已达到 5,000 条上限', 'The 5,000-asset limit has been reached.'))}</span>` : ''}
              ${this._importNotice ? `<span class="import-notice" role="status">${escapeText(this._importNotice)}</span>` : ''}
              <input data-import-input type="file" accept="image/*" multiple hidden>
              <ic-button type="button" size="s" hierarchy="secondary" data-import-trigger ${this._importing ? 'loading disabled' : ''}><ic-icon slot="start" name="add"></ic-icon>${escapeText(copy('smart.assetLibraryBatchImport', '批量导入', 'Batch import'))}</ic-button>
            </header>
            <div class="results" tabindex="-1">
              ${this._items.length ? `<div class="grid">${this._items.map(item => {
                const label = format('smart.assetLibraryInsertAsset', {name:item.name}, `插入“${item.name}”到智能画布`, `Insert “${item.name}” into the Smart Canvas`);
                return `<article class="card" tabindex="0" data-id="${escapeText(item.id)}" draggable="true" aria-label="${escapeText(label)}"><img src="${escapeText(item.url)}" alt="" loading="lazy"><div class="meta">${this._editingId === item.id ? `<ic-form-field class="rename-field" aria-label="${escapeText(copy('smart.assetLibraryAssetName', '素材名称', 'Asset name'))}" data-component-name="ic-form-field-text-s" validation="${escapeText(this._editingError)}"><ic-input class="rename-input" slot="control" data-rename-input type="text" size="s" value="${escapeText(this._editingName)}" maxlength="120" autocomplete="off"></ic-input></ic-form-field>` : `<span class="name">${escapeText(item.name)}</span>`}${item.can_manage && this._editingId !== item.id ? `<span class="actions"><ic-icon-button type="button" size="s" hierarchy="quiet" icon="edit" label="${escapeText(copy('smart.assetLibraryRenameAsset', '编辑名称', 'Rename asset'))}" data-rename="${escapeText(item.id)}"></ic-icon-button><ic-icon-button type="button" size="s" hierarchy="quiet" icon="delete" label="${escapeText(copy('smart.assetLibraryRemove', '从资产库移除', 'Remove from asset library'))}" data-delete="${escapeText(item.id)}"></ic-icon-button></span>` : ''}</div></article>`;
              }).join('')}</div>` : (!this._loading && !this._error ? `<div class="state">${escapeText(copy('smart.assetLibraryEmpty', '当前文件夹中暂无匹配图片', 'No matching images in this folder.'))}</div>` : '')}
              ${this._loading ? `<div class="state" role="status">${escapeText(copy('common.loading', '正在加载…', 'Loading…'))}</div>` : ''}${this._error ? `<div class="state" role="alert">${escapeText(this._error)}<button type="button" data-retry>${escapeText(copy('common.retry', '重试', 'Retry'))}</button></div>` : ''}
            </div>
          </main>
        </div>
        <ic-confirm-popover data-delete-confirmation label="${escapeText(copy('smart.assetLibraryRemoveConfirm', '确认从资产库移除？', 'Remove from the asset library?'))}" description="${escapeText(removeDescription)}" cancel-label="${escapeText(copy('common.cancel', '取消', 'Cancel'))}" confirm-label="${escapeText(copy('smart.assetLibraryRemoveConfirmAction', '移除', 'Remove'))}" consequence="destructive" placement="inline-end" alignment="start"></ic-confirm-popover>
        <ic-confirm-popover data-folder-delete-confirmation label="${escapeText(copy('smart.assetLibraryFolderDeleteConfirm', '确认删除文件夹？', 'Delete this folder?'))}" cancel-label="${escapeText(copy('common.cancel', '取消', 'Cancel'))}" confirm-label="${escapeText(copy('smart.assetLibraryDeleteFolder', '删除文件夹', 'Delete folder'))}" consequence="destructive" placement="inline-end" alignment="start"></ic-confirm-popover>
      </section>`;

    const search = this.shadowRoot.querySelector('[data-search]');
    search.addEventListener('input', event => this.scheduleSearch(event.currentTarget.value));
    this.shadowRoot.querySelector('[data-search-clear]')?.addEventListener('click', async () => { clearTimeout(this._searchTimer); this._query = ''; await this.load({ reset:true }); this.shadowRoot.querySelector('[data-search]')?.focus({ preventScroll:true }); });
    this.shadowRoot.querySelectorAll('[data-folder-id]').forEach(button => {
      button.addEventListener('click', () => this.selectFolder(button.dataset.folderId));
      button.addEventListener('dragover', event => { if (!event.dataTransfer?.types.includes('application/x-workspace-asset')) return; event.preventDefault(); button.dataset.dropTarget = ''; });
      button.addEventListener('dragleave', () => delete button.dataset.dropTarget);
      button.addEventListener('drop', event => { event.preventDefault(); delete button.dataset.dropTarget; this.moveToFolder(event.dataTransfer?.getData('application/x-workspace-asset'), button.dataset.folderId); });
    });
    this.shadowRoot.querySelector('[data-folder-new]')?.addEventListener('click', () => this.startFolderEditor('create'));
    this.shadowRoot.querySelectorAll('[data-folder-edit]').forEach(button => button.addEventListener('click', () => this.startFolderEditor('edit', button.dataset.folderEdit)));
    this.shadowRoot.querySelectorAll('[data-folder-delete]').forEach(button => button.addEventListener('click', () => this.requestFolderDelete(button.dataset.folderDelete, button)));
    const folderName = this.shadowRoot.querySelector('[data-folder-name]');
    folderName?.addEventListener('input', () => { this._folderEditorName = folderName.value; this._folderEditorError = ''; });
    folderName?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); this.saveFolder(); } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.cancelFolderEditor(); } });
    const importInput = this.shadowRoot.querySelector('[data-import-input]');
    this.shadowRoot.querySelector('[data-import-trigger]')?.addEventListener('click', () => importInput?.click());
    importInput?.addEventListener('change', () => this.importFiles(importInput.files));
    const results = this.shadowRoot.querySelector('.results');
    results.scrollTop = previousScroll;
    results.addEventListener('scroll', () => { if (this._cursor && !this._loading && results.scrollHeight - results.scrollTop - results.clientHeight < 240) this.load(); }, { passive: true });
    this.shadowRoot.querySelectorAll('.card').forEach(card => {
      const item = this._items.find(entry => entry.id === card.dataset.id);
      card.addEventListener('click', event => { if (!item || event.target.closest('button,ic-button,ic-icon-button,input,ic-input,form,ic-form-field')) return; this.dispatchEvent(new CustomEvent('ic-asset-insert', { bubbles:true, composed:true, detail:{ item:{...item} } })); });
      card.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.target.closest('input,ic-input,button,ic-button,ic-icon-button')) { event.preventDefault(); card.click(); } if (event.key.startsWith('Arrow') && this.moveCardFocus(card, event.key)) { event.preventDefault(); event.stopPropagation(); } });
      card.addEventListener('dragstart', event => { if (!item) return event.preventDefault(); event.dataTransfer?.setData('application/x-workspace-asset', item.id); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; });
    });
    this.shadowRoot.querySelectorAll('[data-rename]').forEach(button => button.addEventListener('click', () => this.startRename(button.dataset.rename)));
    this.shadowRoot.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => this.requestDelete(button.dataset.delete, button)));
    const renameInput = this.shadowRoot.querySelector('[data-rename-input]');
    renameInput?.addEventListener('input', () => { this._editingName = renameInput.value; this._editingError = ''; });
    renameInput?.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.cancelAssetRename(); } else if (event.key === 'Enter') { event.preventDefault(); this.submitRename(); } });
    renameInput?.addEventListener('focusout', () => setTimeout(() => { if (this._editingId && !this.shadowRoot.querySelector('[data-rename-input]')?.matches(':focus-within')) this.submitRename(); }, 0));
    this.shadowRoot.querySelector('[data-retry]')?.addEventListener('click', () => this.load({ reset: !this._items.length }));
    if (restoreSearchFocus) queueMicrotask(() => { const nextSearch = this.shadowRoot.querySelector('[data-search]'); nextSearch?.focus({ preventScroll:true }); nextSearch?.setSelectionRange?.(searchSelection, searchSelection); });
  }
}
