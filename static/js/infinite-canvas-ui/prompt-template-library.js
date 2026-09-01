/**
 * Controlled Prompt Template Library contract.
 *
 * Smart Canvas owns library/template records and every persistence side effect.
 * The shared ic-dialog owns the explicit-dismissal Large Modal and focus scope.
 * This content module owns search, editing, category navigation, drag intent,
 * confirmation, and reorder state.
 * Core CRUD events use the confirmed ic-template-* names. The additional
 * ic-library-change, ic-category-*, ic-template-copy, and ic-close events keep
 * library/category routing, clipboard work, and trigger-focus restoration at
 * the owning application boundary. Category naming is collected here but
 * persisted by the host: ic-category-create carries { libraryId, name } and
 * ic-category-edit carries { libraryId, categoryId, name }.
 */
const PUBLIC_EVENTS = Object.freeze([
  'ic-library-change',
  'ic-category-change',
  'ic-close',
  'ic-template-select',
  'ic-template-copy',
  'ic-template-promote',
  'ic-template-create',
  'ic-template-edit',
  'ic-template-move',
  'ic-template-delete',
  'ic-template-reorder',
  'ic-category-create',
  'ic-category-edit',
  'ic-category-delete',
]);


function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}


function isEnglish(host) {
  return (host.closest('[lang]')?.lang || document.documentElement.lang || '')
    .toLowerCase()
    .startsWith('en');
}


function labels(host) {
  const english = isEnglish(host);
  return english ? {
    title: 'Prompt template library', all: 'All', search: 'Search prompts', clear: 'Clear search', close: 'Close prompt library',
    common: 'Shared across canvases', canvas: 'Current canvas',
    newTemplate: 'New prompt', createTemplateEntry: 'Create prompt template', empty: 'No matching templates',
    fromCommon: 'Copy from shared', folder: 'Group', copyToCanvas: 'Copy to current canvas', promote: 'Make shared', edit: 'Edit template', remove: 'Delete template',
    promoteTitle: 'Make this prompt shared', promoteMessage: 'Choose a shared group.', promoteConfirm: 'Make shared', createGroupFirst: 'Create a shared group first',
    createGroup: 'New group', renameGroup: 'Rename group', deleteGroup: 'Delete group', groupName: 'Group name', groupNamePlaceholder: 'Enter group name',
    moveTemplate: 'Drag to move to a group', movingTemplate: 'Moving prompt', dropTemplate: 'Release to move',
    name: 'Template name', category: 'Group', prompt: 'Prompt', cover: 'Cover image',
    chooseCover: 'Choose image', clearCover: 'Remove cover', previewEmpty: 'Start typing a prompt', cancel: 'Cancel', save: 'Save',
    deleteMessage: 'This action cannot be undone.', deleteConfirm: 'Delete template',
    groupDeleteEmpty: 'This group is empty. Deleting the group cannot be undone.',
    groupDeleteMove: count => `${count} prompt${count === 1 ? '' : 's'} will move to “Uncategorized”; the prompts themselves will not be deleted.`,
    create: 'Create', required: 'Name and prompt are required', groupRequired: 'Group name is required',
  } : {
    title: '提示词模板库', all: '全部', search: '搜索提示词', clear: '清除搜索', close: '关闭提示词库',
    common: '通用', canvas: '当前画布',
    newTemplate: '新建提示词', createTemplateEntry: '创建新提示词模板', empty: '没有匹配的提示词',
    fromCommon: '从通用复制', folder: '分类', copyToCanvas: '复制到当前画布', promote: '设为通用', edit: '编辑模板', remove: '删除模板',
    promoteTitle: '设为通用', promoteMessage: '请选择一个通用分类。', promoteConfirm: '设为通用', createGroupFirst: '请先创建通用分类',
    createGroup: '新建分组', renameGroup: '重命名分组', deleteGroup: '删除分组', groupName: '分组名称', groupNamePlaceholder: '请输入分组名',
    moveTemplate: '拖到左侧分类即可移动', movingTemplate: '正在移动提示词', dropTemplate: '松开即移动',
    name: '模板名称', category: '所属分组', prompt: '提示词内容', cover: '封面图',
    chooseCover: '选择图片', clearCover: '移除封面', previewEmpty: '在右侧输入提示词', cancel: '取消', save: '保存',
    deleteMessage: '删除后无法恢复。', deleteConfirm: '确认删除',
    groupDeleteEmpty: '该分组为空；删除分组后无法恢复。',
    groupDeleteMove: count => `组内 ${count} 个提示词会移至“未分类”，模板本身不会删除。`,
    create: '创建', required: '模板名称和提示词内容不能为空', groupRequired: '分组名称不能为空',
  };
}


export class IcPromptTemplateLibrary extends HTMLElement {
  static observedAttributes = [
    'active-library', 'active-category', 'selected-template', 'can-manage', 'busy',
    'aria-label', 'aria-labelledby',
  ];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._libraries = [];
    this._templates = [];
    this._query = '';
    this._editorMode = '';
    this._editorTemplateId = '';
    this._editorDraft = null;
    this._editorCoverUrl = '';
    this._editorCoverFile = null;
    this._coverPickerOpen = false;
    this._coverPickerReleaseTimer = 0;
    this._handleWindowFocus = () => {
      if (this._coverPickerOpen) this.deferCoverPickerEscapeRelease();
    };
    this._categoryEditorMode = '';
    this._categoryEditorId = '';
    this._categoryEditorName = '';
    this._categoryEditorError = '';
    this._templateDeleteCandidateId = '';
    this._promotionTemplateId = '';
    this._categoryDeleteCandidateId = '';
    this._draggedCategoryId = '';
    this._draggedTemplateId = '';
    this._templateDragState = null;
    this._templateDropReleaseTimer = 0;
    this._pointerCategoryDrag = null;
    this._composingControl = null;
    this._pendingRenderOptions = null;
    this.shadowRoot.addEventListener('click', event => this.handleClick(event));
    this.shadowRoot.addEventListener('click', event => {
      if (event.target.matches?.('[data-editor-cover-input]')) this.armCoverPickerEscapeGuard();
    }, { capture: true });
    this.shadowRoot.addEventListener('input', event => this.handleInput(event));
    this.shadowRoot.addEventListener('compositionstart', event => this.handleCompositionStart(event));
    this.shadowRoot.addEventListener('compositionend', event => this.handleCompositionEnd(event));
    this.shadowRoot.addEventListener('focusout', event => this.handleFocusOut(event));
    this.shadowRoot.addEventListener('change', event => this.handleChange(event));
    this.shadowRoot.addEventListener('ic-change', event => this.handleChange(event));
    this.shadowRoot.addEventListener('ic-confirm', event => this.handleConfirmation(event));
    this.shadowRoot.addEventListener('ic-cancel', event => this.handleConfirmationCancel(event));
    this.shadowRoot.addEventListener('keydown', event => this.handleKeydown(event));
    this.shadowRoot.addEventListener('contextmenu', event => {
      if (this.modalOpen) event.stopPropagation();
    });
    this.shadowRoot.addEventListener('paste', event => {
      if (this.modalOpen) event.stopPropagation();
    });
    this.shadowRoot.addEventListener('dragstart', event => this.handleDragStart(event));
    this.shadowRoot.addEventListener('dragover', event => this.handleDragOver(event));
    this.shadowRoot.addEventListener('drop', event => this.handleDrop(event));
    this.shadowRoot.addEventListener('dragend', () => this.handleDragEnd());
    this.shadowRoot.addEventListener('pointerdown', event => this.handleCategoryPointerDown(event));
    this.shadowRoot.addEventListener('pointermove', event => this.handleCategoryPointerMove(event));
    this.shadowRoot.addEventListener('pointerup', event => this.handleCategoryPointerEnd(event));
    this.shadowRoot.addEventListener('pointercancel', event => this.handleCategoryPointerEnd(event, true));
  }

  connectedCallback() {
    window.addEventListener('focus', this._handleWindowFocus);
    this.requestRender();
  }
  disconnectedCallback() {
    this.resetDeleteConfirmation();
    this.resetDragState();
    this._composingControl = null;
    this._pendingRenderOptions = null;
    window.removeEventListener('focus', this._handleWindowFocus);
    this.releaseCoverPickerEscapeGuard();
    if (this._editorCoverFile && this._editorCoverUrl.startsWith('blob:')) URL.revokeObjectURL(this._editorCoverUrl);
  }
  attributeChangedCallback(name, oldValue, newValue) {
    if (!this.isConnected || oldValue === newValue) return;
    if (name === 'busy') {
      this.shadowRoot.querySelector('[part="workspace"]')?.setAttribute('aria-busy', String(this.busy));
      this.shadowRoot.querySelectorAll('ic-confirm-popover').forEach(confirmation => {
        confirmation.confirmLoading = this.busy;
      });
      return;
    }
    if (name === 'selected-template') return;
    this.requestRender();
  }

  get libraries() { return this._libraries; }
  set libraries(value) {
    this._libraries = Array.isArray(value) ? value : [];
    if (this.shadowRoot?.querySelector('[data-category-editor-name],[data-editor-field]')) return;
    this.requestRender();
  }

  get templates() { return this._templates; }
  set templates(value) {
    this._templates = Array.isArray(value) ? value : [];
    if (this.refreshBrowseTemplates()) return;
    if (this.shadowRoot?.querySelector('[data-category-editor-name],[data-editor-field]')) return;
    this.requestRender();
  }

  get activeLibrary() { return this.getAttribute('active-library') || this._libraries[0]?.id || ''; }
  set activeLibrary(value) { this.setAttribute('active-library', String(value || '')); }

  get activeCategory() { return this.getAttribute('active-category') || 'all'; }
  set activeCategory(value) { this.setAttribute('active-category', String(value || 'all')); }

  get selectedTemplate() { return this.getAttribute('selected-template') || ''; }
  set selectedTemplate(value) { this.setAttribute('selected-template', String(value || '')); }

  get modalOpen() { return Boolean(this.closest('ic-dialog')?.open || this.hasAttribute('open')); }

  get canManage() { return this.hasAttribute('can-manage'); }
  set canManage(value) { this.toggleAttribute('can-manage', Boolean(value)); }

  get busy() { return this.hasAttribute('busy'); }
  set busy(value) { this.toggleAttribute('busy', Boolean(value)); }

  get query() { return this._query; }
  set query(value) {
    this._query = String(value || '');
    const search = this.shadowRoot?.querySelector('[data-search]');
    if (search && search.value !== this._query) search.value = this._query;
    if (!this.refreshSearchResults()) this.render();
  }

  get activeLibraryRecord() {
    return this._libraries.find(library => library?.id === this.activeLibrary) || this._libraries[0] || null;
  }

  get activeScope() {
    return this.activeLibraryRecord?.scope || (this.activeLibrary === 'canvas' ? 'canvas' : 'common');
  }

  get commonLibraryRecord() {
    return this._libraries.find(library => library?.scope === 'common' || library?.id === 'common') || null;
  }

  get commonCategories() {
    const categories = this.commonLibraryRecord?.categories;
    return Array.isArray(categories) ? categories.filter(category => category?.id && category?.name) : [];
  }

  get editable() { return this.canManage && !this.activeLibraryRecord?.readonly; }

  get activeCategories() {
    if (this.activeScope === 'canvas') return [];
    const categories = this.activeLibraryRecord?.categories;
    return Array.isArray(categories) ? categories.filter(category => category?.id && category?.name) : [];
  }

  get visibleTemplates() {
    const libraryId = this.activeLibrary;
    const query = this._query.trim().toLowerCase();
    return this._templates.filter(template => {
      if (!template?.id) return false;
      if (libraryId && template.libraryId && template.libraryId !== libraryId) return false;
      if (this.activeCategory !== 'all' && template.category !== this.activeCategory) return false;
      if (!query) return true;
      return [template.name, template.name_en, template.positive, template.negative]
        .join(' ').toLowerCase().includes(query);
    });
  }

  openCreate() {
    if (!this.editable) return;
    if (this.activeScope !== 'canvas' && !this.activeCategories.length) {
      this.openCategoryEditor('create');
      return;
    }
    const category = this.activeScope === 'canvas' ? '' : this.activeCategory !== 'all' && this.activeCategories.some(item => item.id === this.activeCategory)
      ? this.activeCategory
      : this.activeCategories[0]?.id || '';
    this._editorMode = 'create';
    this._editorTemplateId = '';
    this._editorDraft = { name: '', category, positive: '', cover: '' };
    this._editorCoverUrl = '';
    this._editorCoverFile = null;
    this.resetDeleteConfirmation();
    this.render({ focusEditor: true });
  }

  openEdit(templateId) {
    if (!this.editable) return;
    const template = this._templates.find(item => item?.id === templateId && (!item.libraryId || item.libraryId === this.activeLibrary));
    if (!template) return;
    this._editorMode = 'edit';
    this._editorTemplateId = template.id;
    this._editorDraft = {
      name: template.name || '',
      category: template.category || this.activeCategories[0]?.id || '',
      positive: template.positive || '',
      cover: template.cover || '',
    };
    this._editorCoverUrl = template.cover || '';
    this._editorCoverFile = null;
    this.resetDeleteConfirmation();
    this.render({ focusEditor: true });
  }

  closeEditor() {
    const taskWasOpen = Boolean(this._editorMode || this._editorDraft || this._templateDeleteCandidateId);
    if (this._editorCoverFile && this._editorCoverUrl.startsWith('blob:')) URL.revokeObjectURL(this._editorCoverUrl);
    this._editorMode = '';
    this._editorTemplateId = '';
    this._editorDraft = null;
    this._editorCoverUrl = '';
    this._editorCoverFile = null;
    this._templateDeleteCandidateId = '';
    this.releaseCoverPickerEscapeGuard();
    this.resetDeleteConfirmation();
    if (taskWasOpen) this.render();
  }

  armCoverPickerEscapeGuard() {
    clearTimeout(this._coverPickerReleaseTimer);
    this._coverPickerReleaseTimer = 0;
    this._coverPickerOpen = true;
  }

  deferCoverPickerEscapeRelease() {
    clearTimeout(this._coverPickerReleaseTimer);
    this._coverPickerReleaseTimer = setTimeout(() => {
      this._coverPickerOpen = false;
      this._coverPickerReleaseTimer = 0;
    }, 750);
  }

  releaseCoverPickerEscapeGuard() {
    clearTimeout(this._coverPickerReleaseTimer);
    this._coverPickerReleaseTimer = 0;
    this._coverPickerOpen = false;
  }

  setEditorCover(value) {
    if (this._editorCoverFile && this._editorCoverUrl.startsWith('blob:')) URL.revokeObjectURL(this._editorCoverUrl);
    this._editorCoverFile = null;
    this._editorCoverUrl = String(value || '');
    if (this._editorDraft) this._editorDraft.cover = this._editorCoverUrl;
    this.render();
  }

  openCategoryEditor(mode, categoryId = '') {
    if (!this.editable || !['create', 'edit'].includes(mode)) return;
    const category = mode === 'edit'
      ? this.activeCategories.find(item => item.id === categoryId)
      : null;
    if (mode === 'edit' && !category) return;
    this._categoryEditorMode = mode;
    this._categoryEditorId = category?.id || '';
    this._categoryEditorName = category?.name || '';
    this._categoryEditorError = '';
    this.resetDeleteConfirmation();
    this.render({ focusCategoryEditor: true });
  }

  startCategoryRename(categoryId) {
    this.openCategoryEditor('edit', categoryId);
  }

  closeCategoryEditor() {
    const taskWasOpen = Boolean(this._categoryEditorMode);
    this._categoryEditorMode = '';
    this._categoryEditorId = '';
    this._categoryEditorName = '';
    this._categoryEditorError = '';
    if (taskWasOpen) this.render();
  }

  saveCategoryEditor() {
    const categoryName = this.shadowRoot.querySelector('[data-category-editor-name]')?.value?.trim() || '';
    this._categoryEditorName = categoryName;
    if (!categoryName) {
      this._categoryEditorError = labels(this).groupRequired;
      this.render({ focusCategoryEditor: true });
      return false;
    }
    const detail = {
      libraryId: this.activeLibrary,
      name: categoryName,
    };
    if (this._categoryEditorMode === 'edit') detail.categoryId = this._categoryEditorId;
    this.emit(this._categoryEditorMode === 'create' ? 'ic-category-create' : 'ic-category-edit', detail);
    return true;
  }

  requestTemplateDelete(templateId, trigger) {
    const template = this._templates.find(item => item?.id === templateId && (!item.libraryId || item.libraryId === this.activeLibrary));
    const confirmation = this.shadowRoot.querySelector('[data-template-delete-confirmation]');
    if (!this.editable || !template || !confirmation || !trigger) return;
    const copy = labels(this);
    this._templateDeleteCandidateId = template.id;
    confirmation.setAttribute('label', isEnglish(this) ? `Delete the “${template.name || template.id}” template?` : `删除“${template.name || template.id}”模板？`);
    confirmation.setAttribute('description', copy.deleteMessage);
    confirmation.show(trigger);
  }

  requestPromotion(templateId) {
    const template = this._templates.find(item => item?.id === templateId && (!item.libraryId || item.libraryId === this.activeLibrary));
    if (!this.editable || this.activeScope !== 'canvas' || !template) return;
    this._promotionTemplateId = template.id;
    this.render({ focusPromotion: true });
  }

  closePromotion() {
    if (!this._promotionTemplateId) return;
    this._promotionTemplateId = '';
    this.render();
  }

  closeTemplateDeleteConfirmation() {
    this._templateDeleteCandidateId = '';
    this.shadowRoot?.querySelector('[data-template-delete-confirmation]')?.hide?.('programmatic');
  }

  resetDeleteConfirmation() {
    this._categoryDeleteCandidateId = '';
    this.shadowRoot?.querySelector('[data-category-delete-confirmation]')?.hide?.('programmatic');
  }

  requestCategoryDelete(categoryId, trigger) {
    const category = this.commonCategories.find(item => item.id === categoryId);
    const confirmation = this.shadowRoot.querySelector('[data-category-delete-confirmation]');
    if (!this.editable || !category || category.managed || !confirmation || !trigger) return;
    const commonLibraryId = this.commonLibraryRecord?.id || 'common';
    const templateCount = this._templates.filter(template => (
      template?.id
      && (!template.libraryId || template.libraryId === commonLibraryId)
      && template.category === category.id
    )).length;
    const copy = labels(this);
    this._categoryDeleteCandidateId = category.id;
    confirmation.setAttribute('label', isEnglish(this) ? `Delete the “${category.name}” group?` : `删除“${category.name}”分组？`);
    confirmation.setAttribute('description', templateCount ? copy.groupDeleteMove(templateCount) : copy.groupDeleteEmpty);
    confirmation.show(trigger);
  }

  handleConfirmation(event) {
    if (this.busy) return;
    if (event.target.matches?.('[data-template-delete-confirmation]')) {
      const templateId = this._templateDeleteCandidateId;
      if (!templateId) return;
      event.target.hide('confirm');
      this._templateDeleteCandidateId = '';
      this.emit('ic-template-delete', { libraryId: this.activeLibrary, templateId });
      return;
    }
    if (!event.target.matches?.('[data-category-delete-confirmation]')) return;
    const categoryId = this._categoryDeleteCandidateId;
    if (!categoryId) return;
    event.target.hide('confirm');
    this._categoryDeleteCandidateId = '';
    this.emit('ic-category-delete', { libraryId: this.commonLibraryRecord?.id || 'common', categoryId });
  }

  handleConfirmationCancel(event) {
    if (event.target.matches?.('[data-template-delete-confirmation]')) {
      this._templateDeleteCandidateId = '';
      return;
    }
    if (event.target.matches?.('[data-category-delete-confirmation]')) this._categoryDeleteCandidateId = '';
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail }));
  }

  handleClick(event) {
    const button = event.target.closest('button,ic-button,ic-icon-button');
    const selectedCard = event.target.closest('[data-template-id]');
    if (!button) {
      if (selectedCard) this.emit('ic-template-select', { templateId: selectedCard.dataset.templateId, libraryId: this.activeLibrary, source: 'card' });
      return;
    }
    if (this.busy && !button.matches('[data-close],[data-editor-cancel],[data-promotion-cancel]')) return;
    if (button.matches('[data-template-new]')) {
      this.openCreate();
      return;
    }
    if (button.matches('[data-category-new]')) {
      const commonLibraryId = this.commonLibraryRecord?.id || 'common';
      if (this.activeLibrary !== commonLibraryId) {
        this.emit('ic-library-change', { libraryId: commonLibraryId });
        requestAnimationFrame(() => this.openCategoryEditor('create'));
        return;
      }
      this.openCategoryEditor('create');
      return;
    }
    if (button.matches('[data-category-edit]')) {
      const commonLibraryId = this.commonLibraryRecord?.id || 'common';
      if (this.activeLibrary !== commonLibraryId) {
        const categoryId = button.dataset.categoryEdit;
        this.emit('ic-library-change', { libraryId: commonLibraryId });
        requestAnimationFrame(() => this.startCategoryRename(categoryId));
        return;
      }
      this.startCategoryRename(button.dataset.categoryEdit);
      return;
    }
    if (button.matches('[data-category-delete]')) {
      const categoryId = button.dataset.categoryDelete;
      const commonLibraryId = this.commonLibraryRecord?.id || 'common';
      if (this.activeLibrary !== commonLibraryId) {
        this.emit('ic-library-change', { libraryId: commonLibraryId });
        requestAnimationFrame(() => {
          const nextTrigger = this.shadowRoot.querySelector(`[data-category-delete="${CSS.escape(categoryId)}"]`);
          this.requestCategoryDelete(categoryId, nextTrigger);
        });
        return;
      }
      this.requestCategoryDelete(categoryId, button);
      return;
    }
    if (button.matches('[data-template-copy]')) {
      this.emit('ic-template-copy', { libraryId: this.activeLibrary, templateId: button.dataset.templateCopy, action: 'copy-to-canvas' });
      return;
    }
    if (button.matches('[data-template-promote]')) {
      this.requestPromotion(button.dataset.templatePromote);
      return;
    }
    if (button.matches('[data-template-edit]')) {
      this.openEdit(button.dataset.templateEdit);
      return;
    }
    if (button.matches('[data-promotion-cancel]')) {
      this.closePromotion();
      return;
    }
    if (button.matches('[data-promotion-create-category]')) {
      this.closePromotion();
      this.emit('ic-library-change', { libraryId: this.commonLibraryRecord?.id || 'common', action: 'create-category' });
      return;
    }
    if (button.matches('[data-promotion-save]')) {
      const categoryId = this.shadowRoot.querySelector('[data-promotion-category]')?.value || '';
      const category = this.commonCategories.find(item => item.id === categoryId);
      if (!category || !this._promotionTemplateId) return;
      this.emit('ic-template-promote', {
        templateId: this._promotionTemplateId,
        categoryId: category.category_id || category.id,
        libraryId: category.library_id || '',
      });
      return;
    }
    if (button.matches('[data-editor-cancel]')) {
      this.closeEditor();
      return;
    }
    if (button.matches('[data-editor-cover-clear]')) {
      this.setEditorCover('');
      return;
    }
    if (button.matches('[data-editor-cover-choose]')) {
      this.armCoverPickerEscapeGuard();
      this.shadowRoot.querySelector('[data-editor-cover-input]')?.open();
      return;
    }
    if (button.matches('[data-editor-delete]')) {
      const templateId = this._editorTemplateId;
      if (templateId) this.requestTemplateDelete(templateId, button);
      return;
    }
    if (button.matches('[data-editor-save]')) {
      const draft = this.readEditorDraft();
      if (!draft.name || !draft.positive) {
        this._editorDraft = { ...draft, error: labels(this).required };
        this.render({ focusEditor: !draft.name });
        return;
      }
      const detail = {
        libraryId: this.activeLibrary,
        templateId: this._editorTemplateId,
        draft: { ...draft, cover: this._editorCoverUrl, coverFile: this._editorCoverFile },
      };
      this.emit(this._editorMode === 'create' ? 'ic-template-create' : 'ic-template-edit', detail);
      return;
    }
    if (button.matches('[data-library-id]')) {
      this.emit('ic-library-change', { libraryId: button.dataset.libraryId });
      return;
    }
    if (button.matches('[data-category-id]')) {
      this.emit('ic-category-change', { categoryId: button.dataset.categoryId });
      return;
    }
    if (button.matches('[data-search-clear]')) {
      this._query = '';
      const search = this.shadowRoot.querySelector('[data-search]');
      if (search) search.value = '';
      this.refreshSearchResults();
      search?.focus({ preventScroll: true });
      return;
    }
    if (button.matches('[data-close]')) {
      this.emit('ic-close', { reason: 'button' });
      return;
    }
    const card = button.closest('[data-template-id]');
    if (card) {
      this.emit('ic-template-select', {
        templateId: card.dataset.templateId,
        libraryId: this.activeLibrary,
        source: 'card',
      });
    }
  }

  handleInput(event) {
    if (event.target.matches('[data-search]')) {
      this._query = event.target.value;
      this.refreshSearchResults();
      return;
    }
    if (event.target.matches('[data-category-editor-name]')) {
      this._categoryEditorName = event.target.value;
      this._categoryEditorError = '';
      return;
    }
    if (event.target.matches('[data-editor-field]')) {
      const draft = this.readEditorDraft();
      const previewName = this.shadowRoot.querySelector('[data-editor-preview-name]');
      const previewPrompt = this.shadowRoot.querySelector('[data-editor-preview-prompt]');
      if (previewName) previewName.textContent = draft.name || labels(this).newTemplate;
      if (previewPrompt) previewPrompt.textContent = draft.positive || labels(this).previewEmpty;
    }
  }

  handleCompositionStart(event) {
    if (event.target.matches('[data-search],[data-category-editor-name],[data-editor-field]')) {
      this._composingControl = event.target;
    }
  }

  handleCompositionEnd(event) {
    if (event.target !== this._composingControl) return;
    this._composingControl = null;
    const options = this._pendingRenderOptions;
    this._pendingRenderOptions = null;
    if (options) requestAnimationFrame(() => {
      if (this.isConnected) this.render(options);
    });
  }

  handleFocusOut(event) {
    if (!this._categoryEditorMode || !event.target.matches('[data-category-editor-name]')) return;
    setTimeout(() => {
      if (this._categoryEditorMode && !this.shadowRoot.querySelector('[data-category-editor-name]')?.matches(':focus-within')) {
        this.saveCategoryEditor();
      }
    }, 0);
  }

  handleChange(event) {
    if (event.target.matches('[data-category-tabs]')) {
      const categoryId = event.detail?.value || event.target.value || 'all';
      const commonLibraryId = this.commonLibraryRecord?.id || 'common';
      if (this.activeLibrary !== commonLibraryId) this.emit('ic-library-change', { libraryId: commonLibraryId });
      this.emit('ic-category-change', { categoryId });
      return;
    }
    if (!event.target.matches('[data-editor-cover-input]')) return;
    this.releaseCoverPickerEscapeGuard();
    const coverFile = [...(event.detail?.acceptedFiles || event.target.files || [])]
      .find(file => String(file.type || '').startsWith('image/')) || null;
    if (!coverFile) return;
    if (this._editorCoverFile && this._editorCoverUrl.startsWith('blob:')) URL.revokeObjectURL(this._editorCoverUrl);
    this._editorCoverFile = coverFile;
    this._editorCoverUrl = URL.createObjectURL(coverFile);
    if (this._editorDraft) this._editorDraft.cover = '';
    this.render();
  }

  readEditorDraft() {
    const draft = {
      name: this.shadowRoot.querySelector('[data-editor-name]')?.value?.trim() ?? this._editorDraft?.name ?? '',
      category: this.activeScope === 'canvas' ? '' : this._editorDraft?.category ?? this.activeCategories[0]?.id ?? '',
      positive: this.shadowRoot.querySelector('[data-editor-positive]')?.value?.trim() ?? this._editorDraft?.positive ?? '',
      cover: this._editorDraft?.cover || '',
    };
    this._editorDraft = draft;
    return draft;
  }

  handleKeydown(event) {
    if (this.modalOpen) event.stopPropagation();
    if (event.key === 'Escape' && this._coverPickerOpen) {
      event.preventDefault();
      event.stopPropagation();
      this.releaseCoverPickerEscapeGuard();
      return;
    }
    if (event.key === 'Escape' && this._templateDeleteCandidateId) {
      event.preventDefault();
      event.stopPropagation();
      this.closeTemplateDeleteConfirmation();
      return;
    }
    if (event.key === 'Escape' && this._promotionTemplateId) {
      event.preventDefault();
      event.stopPropagation();
      this.closePromotion();
      return;
    }
    if (event.key === 'Escape' && this._categoryEditorMode) {
      event.preventDefault();
      event.stopPropagation();
      this.closeCategoryEditor();
      return;
    }
    if (event.key === 'Enter' && this._categoryEditorMode && event.target.matches('[data-category-editor-name]')) {
      event.preventDefault();
      this.saveCategoryEditor();
      return;
    }
    if (event.key === 'Escape' && this._editorMode) {
      event.preventDefault();
      event.stopPropagation();
      this.closeEditor();
      return;
    }
    if (event.key === 'Escape' && this.modalOpen) {
      event.preventDefault();
      event.stopPropagation();
      this.emit('ic-close', { reason: 'escape' });
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      const card = event.target.closest('[data-template-id]');
      if (!card || event.target.closest('button,ic-button,ic-icon-button,input,ic-input,select,ic-select,textarea,ic-textarea,ic-file-input')) return;
      event.preventDefault();
      this.emit('ic-template-select', { templateId: card.dataset.templateId, libraryId: this.activeLibrary, source: 'keyboard' });
    }
  }

  handleDragStart(event) {
    const template = event.target.closest('[data-template-drag]');
    if (template) {
      this._draggedTemplateId = template.dataset.templateId || '';
      this._draggedCategoryId = '';
      this.createTemplateDragPreview(template, event);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-ic-prompt-template', this._draggedTemplateId);
        event.dataTransfer.setData('text/plain', this._draggedTemplateId);
        const dragProxy = document.createElement('span');
        Object.assign(dragProxy.style, { position:'fixed', width:'1px', height:'1px', opacity:'0.01', pointerEvents:'none' });
        this.shadowRoot.querySelector('[part="workspace"]')?.append(dragProxy);
        event.dataTransfer.setDragImage?.(dragProxy, 0, 0);
        requestAnimationFrame(() => dragProxy.remove());
      }
      return;
    }
    const item = event.target.closest('[data-category-item]');
    if (!item || !event.target.closest('[data-category-drag]')) return;
    this._draggedCategoryId = item.dataset.categoryItem;
    this._draggedTemplateId = '';
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', this._draggedCategoryId);
    }
  }

  createTemplateDragPreview(source, event) {
    const template = this._templates.find(item => item?.id === this._draggedTemplateId);
    const sourceRect = source.getBoundingClientRect();
    const previewVisual = source.querySelector('[part="template-preview"]')?.outerHTML || '';
    const preview = document.createElement('div');
    preview.setAttribute('part', 'template-drag-preview');
    preview.setAttribute('aria-hidden', 'true');
    preview.innerHTML = `<div part="template-drag-visual">${previewVisual}<span part="template-drag-name">${escapeHtml(template?.name || template?.id || '')}</span></div><div part="template-drag-status"><ic-icon name="forward"></ic-icon><span data-template-drag-status>${escapeHtml(labels(this).movingTemplate)}</span></div>`;
    preview.style.width = `${Math.min(sourceRect.width, 280)}px`;
    source.setAttribute('data-template-dragging', '');
    this.shadowRoot.querySelector('[part="workspace"]')?.append(preview);
    this._templateDragState = {
      source,
      preview,
      offsetX: Math.max(0, Math.min(sourceRect.width, (event.clientX || sourceRect.left + sourceRect.width / 2) - sourceRect.left)),
      offsetY: Math.max(0, Math.min(sourceRect.height, (event.clientY || sourceRect.top + sourceRect.height / 2) - sourceRect.top)),
      target: null,
    };
    this.updateTemplateDragPreview(event, null);
  }

  updateTemplateDragPreview(event, target) {
    const drag = this._templateDragState;
    if (!drag?.preview) return;
    const previewRect = drag.preview.getBoundingClientRect();
    let left = (event.clientX || 0) - Math.min(drag.offsetX, previewRect.width);
    let top = (event.clientY || 0) - Math.min(drag.offsetY, previewRect.height);
    const targetId = target?.dataset.categoryItem || '';
    if (targetId) {
      const targetRect = target.getBoundingClientRect();
      const dx = targetRect.left + targetRect.width / 2 - (left + previewRect.width / 2);
      const dy = targetRect.top + targetRect.height / 2 - (top + previewRect.height / 2);
      const distance = Math.max(1, Math.hypot(dx, dy));
      const pull = Math.min(12, distance * .12);
      left += dx / distance * pull;
      top += dy / distance * pull;
      drag.preview.setAttribute('data-magnetized', '');
      const categoryName = target.querySelector('[part="category-label"]')?.textContent?.trim() || '';
      const status = drag.preview.querySelector('[data-template-drag-status]');
      if (status) status.textContent = `${labels(this).dropTemplate}·${categoryName}`;
    } else {
      drag.preview.removeAttribute('data-magnetized');
      const status = drag.preview.querySelector('[data-template-drag-status]');
      if (status) status.textContent = labels(this).movingTemplate;
    }
    drag.preview.style.left = `${left}px`;
    drag.preview.style.top = `${top}px`;
    drag.target = target || null;
  }

  handleDragOver(event) {
    const target = event.target.closest('[data-category-item]');
    if (!this._draggedCategoryId && !this._draggedTemplateId) return;
    if (this._draggedTemplateId) {
      const template = this._templates.find(item => item?.id === this._draggedTemplateId);
      this.shadowRoot.querySelectorAll('[data-category-item][data-template-drop-target]')
        .forEach(item => item.removeAttribute('data-template-drop-target'));
      const validTarget = target && template && template.category !== target.dataset.categoryItem ? target : null;
      if (validTarget) validTarget.setAttribute('data-template-drop-target', '');
      this.updateTemplateDragPreview(event, validTarget);
      if (!validTarget) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      return;
    }
    if (!target || target.dataset.categoryItem === this._draggedCategoryId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  handleDrop(event) {
    const target = event.target.closest('[data-category-item]');
    const templateId = this._draggedTemplateId;
    const sourceId = this._draggedCategoryId;
    if (!target) {
      this.resetDragState();
      return;
    }
    const targetId = target.dataset.categoryItem;
    if (templateId) {
      const template = this._templates.find(item => item?.id === templateId);
      if (!template || template.category === targetId) {
        this.resetDragState();
        return;
      }
      event.preventDefault();
      this.releaseTemplateDragPreview(target, () => this.emit('ic-template-move', {
        libraryId: this.activeLibrary,
        templateId,
        categoryId: targetId,
      }));
      return;
    }
    this.resetDragState();
    if (!sourceId || targetId === sourceId) return;
    event.preventDefault();
    this.reorderCategories(sourceId, targetId);
  }

  releaseTemplateDragPreview(target, onComplete) {
    const drag = this._templateDragState;
    if (!drag?.preview) {
      this.resetDragState();
      onComplete?.();
      return;
    }
    const rect = target.getBoundingClientRect();
    target.setAttribute('data-template-drop-committing', '');
    drag.preview.setAttribute('data-releasing', '');
    requestAnimationFrame(() => {
      drag.preview.style.left = `${rect.left}px`;
      drag.preview.style.top = `${rect.top}px`;
      drag.preview.style.width = `${rect.width}px`;
      drag.preview.style.height = `${rect.height}px`;
    });
    this._templateDropReleaseTimer = window.setTimeout(() => {
      this._templateDropReleaseTimer = 0;
      this.resetDragState();
      onComplete?.();
    }, 190);
  }

  handleDragEnd() {
    if (this._templateDropReleaseTimer) return;
    this.resetDragState();
  }

  resetDragState() {
    if (this._templateDropReleaseTimer) clearTimeout(this._templateDropReleaseTimer);
    this._templateDropReleaseTimer = 0;
    this._templateDragState?.source?.removeAttribute('data-template-dragging');
    this._templateDragState?.preview?.remove();
    this._templateDragState = null;
    this._draggedCategoryId = '';
    this._draggedTemplateId = '';
    this.shadowRoot.querySelectorAll('[data-template-drop-target],[data-template-drop-committing]')
      .forEach(item => {
        item.removeAttribute('data-template-drop-target');
        item.removeAttribute('data-template-drop-committing');
      });
  }

  reorderCategories(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return false;
    const categoryIds = this.activeCategories.map(item => item.id);
    const sourceIndex = categoryIds.indexOf(sourceId);
    const targetIndex = categoryIds.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return false;
    categoryIds.splice(sourceIndex, 1);
    categoryIds.splice(targetIndex, 0, sourceId);
    this.emit('ic-template-reorder', { scope: 'categories', categoryIds });
    return true;
  }

  handleCategoryPointerDown(event) {
    const item = event.target.closest('[data-category-item]');
    const interactive = event.target.closest('button,a,input,select,textarea,ic-button,ic-icon-button,ic-input,ic-select,ic-textarea');
    if (!item || interactive || this.activeScope === 'canvas' || (event.button !== undefined && event.button !== 0)) return;
    item.setPointerCapture?.(event.pointerId);
    this._pointerCategoryDrag = {
      pointerId: event.pointerId,
      sourceId: item.dataset.categoryItem,
      targetId: '',
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - item.getBoundingClientRect().left,
      offsetY: event.clientY - item.getBoundingClientRect().top,
      handle:item,
      item,
      preview: null,
    };
  }

  createCategoryDragPreview(drag, event) {
    const preview = drag.item.cloneNode(true);
    preview.setAttribute('part', 'category-drag-preview');
    preview.setAttribute('aria-hidden', 'true');
    preview.removeAttribute('data-category-item');
    preview.removeAttribute('data-drag-target');
    preview.removeAttribute('draggable');
    preview.style.width = `${drag.item.getBoundingClientRect().width}px`;
    preview.querySelectorAll('[draggable]').forEach(element => element.removeAttribute('draggable'));
    preview.querySelectorAll('button,ic-button,ic-icon-button,input,select,textarea').forEach(control => {
      control.setAttribute('tabindex', '-1');
    });
    drag.item.setAttribute('data-dragging', '');
    this.shadowRoot.querySelector('[part="workspace"]')?.append(preview);
    drag.preview = preview;
    this.updateCategoryDragPreview(drag, event);
  }

  updateCategoryDragPreview(drag, event) {
    if (!drag.preview) return;
    drag.preview.style.left = `${event.clientX - drag.offsetX}px`;
    drag.preview.style.top = `${event.clientY - drag.offsetY}px`;
  }

  removeCategoryDragPreview(drag) {
    drag.item?.removeAttribute('data-dragging');
    drag.preview?.remove();
    drag.preview = null;
  }

  renderTemplateGrid() {
    const copy = labels(this);
    const templates = this.visibleTemplates;
    const canEdit = this.editable;
    const canvasScope = this.activeScope === 'canvas';
    return `
      <button part="new-card" type="button" data-template-new ${canEdit ? '' : 'disabled'}><span part="new-card-mark"><ic-icon name="add"></ic-icon></span><span part="new-card-copy">${copy.createTemplateEntry}</span></button>
      ${templates.map(template => {
        const templateIndex = templates.indexOf(template);
        const noCover = !template.cover;
        return `<article part="template-card" data-template-id="${escapeHtml(template.id)}" ${noCover ? 'data-no-cover' : ''} ${!canvasScope && canEdit ? `draggable="true" data-template-drag title="${escapeHtml(copy.moveTemplate)}"` : ''}>
          <button part="template-select" type="button" aria-label="${escapeHtml(template.name || template.id)}">
            <span part="template-preview" ${noCover ? `data-no-cover style="--prompt-template-no-cover-tone:var(--ui-color-prompt-template-placeholder-${templateIndex % 6 + 1})"` : ''}>${template.cover ? `<img src="${escapeHtml(template.cover)}" alt="">` : `<p>${escapeHtml(template.positive || '')}</p>`}</span>
            <span part="template-mask" aria-hidden="true"></span>
          </button>
          <span part="template-meta"><span part="template-name">${escapeHtml(template.name || template.id)}</span><span part="template-actions">${canEdit ? `<ic-icon-button type="button" size="s" hierarchy="secondary" icon="edit" label="${copy.edit}" tooltip-placement="block-start" data-template-edit="${escapeHtml(template.id)}"></ic-icon-button>` : ''}</span></span>
        </article>`;
      }).join('')}
      ${templates.length || !this._query ? '' : `<div part="empty">${copy.empty}</div>`}
    `;
  }

  refreshSearchResults() {
    const grid = this.shadowRoot?.querySelector('[part="grid"]');
    if (!grid) return false;
    grid.innerHTML = this.renderTemplateGrid();
    this.shadowRoot.querySelector('[part="search-clear"]')?.toggleAttribute('hidden', !this._query);
    return true;
  }

  refreshBrowseTemplates() {
    if (!this.refreshSearchResults()) return false;
    const commonLibraryId = this.commonLibraryRecord?.id || 'common';
    const counts = this._templates.reduce((result, template) => {
      if (!template?.id) return result;
      const libraryId = template.libraryId || commonLibraryId;
      result[libraryId] = (result[libraryId] || 0) + 1;
      return result;
    }, {});
    this.shadowRoot.querySelectorAll('[data-library-count]').forEach(count => {
      count.textContent = counts[count.dataset.libraryCount] || 0;
    });
    return true;
  }

  requestRender(options = {}) {
    if (this._composingControl?.isConnected) {
      this._pendingRenderOptions = { ...(this._pendingRenderOptions || {}), ...options };
      return;
    }
    this.render(options);
  }

  activeTextControlState() {
    const control = this.shadowRoot.activeElement;
    const selector = [
      '[data-search]',
      '[data-category-editor-name]',
      '[data-editor-name]',
      '[data-editor-positive]',
    ].find(candidate => control?.matches?.(candidate));
    if (!selector) return null;
    const nativeControl = control.shadowRoot?.activeElement
      || control.shadowRoot?.querySelector('input,textarea')
      || control;
    return {
      selector,
      selectionStart:Number.isInteger(nativeControl.selectionStart) ? nativeControl.selectionStart : null,
      selectionEnd:Number.isInteger(nativeControl.selectionEnd) ? nativeControl.selectionEnd : null,
      selectionDirection:nativeControl.selectionDirection || 'none',
    };
  }

  restoreTextControlState(state) {
    const control = state ? this.shadowRoot.querySelector(state.selector) : null;
    if (!control) return;
    control.focus({ preventScroll: true });
    const nativeControl = control.shadowRoot?.querySelector('input,textarea') || control;
    if (state.selectionStart !== null && typeof nativeControl.setSelectionRange === 'function') {
      nativeControl.setSelectionRange(state.selectionStart, state.selectionEnd, state.selectionDirection);
    }
  }

  handleCategoryPointerMove(event) {
    const drag = this._pointerCategoryDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
    event.preventDefault();
    if (!drag.preview) this.createCategoryDragPreview(drag, event);
    else this.updateCategoryDragPreview(drag, event);
    const target = this.shadowRoot.elementFromPoint?.(event.clientX, event.clientY)?.closest?.('[data-category-item]');
    const targetId = target?.dataset.categoryItem || '';
    this.shadowRoot.querySelectorAll('[data-category-item][data-drag-target]').forEach(item => item.removeAttribute('data-drag-target'));
    drag.targetId = targetId !== drag.sourceId ? targetId : '';
    if (drag.targetId) target.setAttribute('data-drag-target', '');
  }

  handleCategoryPointerEnd(event, canceled = false) {
    const drag = this._pointerCategoryDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this._pointerCategoryDrag = null;
    this.shadowRoot.querySelectorAll('[data-category-item][data-drag-target]').forEach(item => item.removeAttribute('data-drag-target'));
    drag.handle.releasePointerCapture?.(event.pointerId);
    this.removeCategoryDragPreview(drag);
    if (!canceled) this.reorderCategories(drag.sourceId, drag.targetId);
  }

  syncContract() {
    const named = this.getAttribute('aria-label')?.trim() || this.getAttribute('aria-labelledby')?.trim();
    const reason = named ? '' : 'aria-label or aria-labelledby is required';
    this.dataset.icContractStatus = reason ? 'invalid' : 'ready';
    if (reason) this.dataset.icContractReason = reason;
    else delete this.dataset.icContractReason;
  }

  renderTaskContent(copy, editorDraft, promotionTemplate) {
    if (promotionTemplate) return `<section class="task-surface" part="delete-confirmation" role="dialog" aria-labelledby="ic-template-promotion-title">
      <h2 id="ic-template-promotion-title">${copy.promoteTitle}</h2>
      <p><strong>${escapeHtml(promotionTemplate.name || promotionTemplate.id)}</strong> · ${copy.promoteMessage}</p>
      ${this.commonCategories.length ? `<ic-select data-promotion-category name="promotion-category" label="${escapeHtml(copy.category)}" value="${escapeHtml(this.commonCategories[0]?.id || '')}">${this.commonCategories.map(category => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join('')}</ic-select>` : `<p>${copy.createGroupFirst}</p>`}
      <div part="delete-confirmation-actions"><ic-button type="button" hierarchy="secondary" data-promotion-cancel>${copy.cancel}</ic-button>${this.commonCategories.length ? `<ic-button type="button" hierarchy="primary" data-promotion-save>${copy.promoteConfirm}</ic-button>` : `<ic-button type="button" hierarchy="primary" data-promotion-create-category>${copy.createGroup}</ic-button>`}</div>
    </section>`;
    if (!this._editorMode) return '';
    return `<section class="task-surface" part="editor" role="region" aria-labelledby="ic-template-editor-title">
      <header part="editor-header"><span part="editor-title-mark"><ic-icon name="prompt-library"></ic-icon></span><h2 id="ic-template-editor-title">${this._editorMode === 'create' ? copy.newTemplate : copy.edit}</h2></header>
      <div part="editor-preview editor-cover" aria-label="${escapeHtml(copy.cover)}" ${this._editorCoverUrl ? 'data-has-cover' : ''}>
        <ic-media-container label="${escapeHtml(copy.cover)}" kind="image" fit="cover" aspect="auto" state="${this._editorCoverUrl ? 'ready' : 'unavailable'}">${this._editorCoverUrl ? `<img src="${escapeHtml(this._editorCoverUrl)}" alt="">` : '<ic-icon slot="fallback" name="image"></ic-icon>'}</ic-media-container>
        <div part="editor-preview-copy" ${this._editorCoverUrl ? 'hidden' : ''}><span part="editor-preview-quote" aria-hidden="true">“</span><p data-editor-preview-prompt>${escapeHtml(editorDraft.positive || copy.previewEmpty)}</p></div>
        <div part="editor-preview-footer"><strong part="editor-preview-name" data-editor-preview-name>${escapeHtml(editorDraft.name || copy.newTemplate)}</strong><div part="editor-cover-actions"><ic-button type="button" hierarchy="secondary" data-editor-cover-choose>${copy.chooseCover}</ic-button><ic-button type="button" hierarchy="secondary" data-editor-cover-clear ${this._editorCoverUrl ? '' : 'hidden'}>${copy.clearCover}</ic-button></div><ic-file-input data-editor-cover-input label="${escapeHtml(copy.cover)}" accept="image/*" hidden></ic-file-input></div>
      </div>
      <div part="editor-fields">
        <ic-input data-editor-field data-editor-name label="${escapeHtml(copy.name)}" value="${escapeHtml(editorDraft.name)}" autocomplete="off"></ic-input>
        <ic-textarea data-editor-field data-editor-positive label="${escapeHtml(copy.prompt)}" value="${escapeHtml(editorDraft.positive)}" rows="12" resize="none"></ic-textarea>
        ${editorDraft.error ? `<span part="editor-error">${escapeHtml(editorDraft.error)}</span>` : ''}
      </div>
      <div part="editor-actions">
        ${this._editorMode === 'edit' ? `<ic-button type="button" hierarchy="secondary" tone="danger" data-editor-delete>${copy.remove}</ic-button>` : ''}
        <ic-button type="button" hierarchy="secondary" data-editor-cancel>${copy.cancel}</ic-button><ic-button type="button" hierarchy="primary" data-editor-save>${this._editorMode === 'create' ? copy.create : copy.save}</ic-button>
      </div>
    </section>`;
  }

  render(options = {}) {
    if (!this.shadowRoot) return;
    this.syncContract();
    const copy = labels(this);
    const categories = this.commonCategories;
    const commonLibraryId = this.commonLibraryRecord?.id || 'common';
    const canvasLibraryId = this._libraries.find(item => item?.scope === 'canvas' || item?.id === 'canvas')?.id || 'canvas';
    const libraryCounts = this._templates.reduce((counts, template) => {
      if (!template?.id) return counts;
      const libraryId = template.libraryId || commonLibraryId;
      counts[libraryId] = (counts[libraryId] || 0) + 1;
      return counts;
    }, {});
    const canEdit = this.editable;
    const canEditCommon = this.canManage && !this.commonLibraryRecord?.readonly;
    const canvasScope = this.activeScope === 'canvas';
    if (!canEdit) {
      this._categoryEditorMode = '';
      this._templateDeleteCandidateId = '';
    }
    const editorDraft = this._editorDraft || { name: '', category: categories[0]?.id || '', positive: '', cover: '' };
    const promotionTemplate = this._templates.find(item => item?.id === this._promotionTemplateId) || null;
    const blockingOverlayOpen = Boolean(this._editorMode || promotionTemplate);
    const activeTextControl = this.activeTextControlState();

    this.shadowRoot.innerHTML = `
      <style>
        :host { min-width:0; min-height:0; height:100%; display:block; color:var(--ui-color-text-primary); font:var(--ui-text-body); }
        * { box-sizing:border-box; }
        button { cursor:pointer; }
        :is([part="close"],[part="new-card"],[part="template-select"]) { font:inherit; }
        [part="workspace"] { position:relative; min-width:0; min-height:0; height:100%; overflow:hidden; background:var(--ui-color-surface); }
        [part="library-view"] { min-width:0; min-height:0; height:100%; display:flex; flex-direction:column; gap:0; padding:0; }
        [part="library-view"][inert] { pointer-events:none; user-select:none; }
        [part="header"] { position:relative; min-width:0; flex:none; display:block; padding:var(--ui-space-5) var(--ui-space-6); border-block-end:var(--ui-border-width-thin) solid var(--ui-color-border-tertiary); }
        [part="title"] { min-width:0; margin:0; color:var(--ui-color-text-primary); font-family:var(--ui-font-display); font-size:var(--ui-font-size-5); font-weight:var(--ui-font-weight-medium); line-height:calc(5 * var(--ui-space-1)); }
        [part="search"] { width:100%; min-width:0; margin-block-start:var(--ui-space-2); }
        [part="search-input"] { width:100%; min-width:0; }
        [part="search-input"] { --wa-form-control-height:var(--ui-control-height-s); --wa-form-control-value-font-size:var(--ui-font-size-2); }
        [part="search-input"]::part(base) { color:var(--ui-color-text-primary); background:var(--ui-color-surface); border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary); border-radius:var(--ui-radius-s); }
        [part="search-input"]::part(input)::-webkit-search-cancel-button { display:none; -webkit-appearance:none; }
        [part="search-clear"] { --ic-icon-button-control-size:var(--ui-control-height-s); }
        [part="close"] { position:absolute; inset:auto var(--ui-space-6) auto auto; top:50%; width:var(--ui-control-height-s); height:var(--ui-control-height-s); display:inline-grid; place-items:center; padding:0; border:0; border-radius:var(--ui-radius-m); color:var(--ui-color-text-tertiary); background:var(--ui-color-action-tertiary); transform:translateY(-50%); }
        [part="close"]:hover { color:var(--ui-color-text-primary); background:var(--ui-color-action-tertiary-hover); }
        [part="search-clear"][hidden] { display:none; }
        ic-icon { width:var(--ui-icon-size-s); height:var(--ui-icon-size-s); }
        [part="library-layout"] { min-width:0; min-height:0; flex:1; display:grid; grid-template-columns:calc(13 * var(--ui-space-4)) minmax(0,1fr); gap:var(--ui-space-4); padding:var(--ui-space-4) var(--ui-space-6) var(--ui-space-6); }
        [part="sidebar"] { min-width:0; min-height:0; display:flex; flex-direction:column; gap:var(--ui-space-2); padding:var(--ui-space-3); overflow:auto; border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary); border-radius:var(--ui-radius-l); background:var(--ui-color-surface); }
        [part="library-switch"] { min-width:0; display:flex; flex-direction:column; gap:0.75rem; }
        [part="library-title"] { min-width:0; height:2rem; min-height:2rem; display:flex; align-items:center; gap:calc(1.5 * var(--ui-space-1)); margin:0; padding:var(--ui-space-2); border-radius:var(--ui-radius-m); color:var(--ui-color-text-secondary); font-family:var(--ui-font-sans); font-size:var(--ui-font-size-3); font-weight:var(--ui-font-weight-bold); line-height:calc(5 * var(--ui-space-1)); }
        [part="library-count"] { color:var(--ui-color-text-tertiary); font:var(--ui-text-caption); font-weight:var(--ui-font-weight-regular); }
        [part="category-tabs"] { width:100%; min-width:0; min-height:0; flex:none; overflow:visible; --ic-navigation-control-height:var(--ui-control-height-s); --ic-navigation-font-size:var(--ui-font-size-3); --ic-tabs-item-inline-padding:var(--ui-space-2); }
        [part="category-tabs"] > [data-value] { position:relative; width:100%; min-width:0; display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; justify-content:start; gap:var(--ui-space-2); color:var(--ui-color-text-primary); font-family:var(--ui-font-sans); font-size:var(--ui-font-size-3); font-weight:var(--ui-font-weight-regular); line-height:calc(5 * var(--ui-space-1)); text-align:start; }
        [part="category-tabs"] > [data-value] > [part="category-label"] { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        [part="category-rename-field"] { width:100%; min-width:0; }
        [part="category-rename-input"] { width:100%; min-width:0; --wa-form-control-height:1.75rem; }
        [part="category-add-editor"] { width:100%; min-width:0; min-height:var(--ui-control-height-s); display:flex; align-items:center; padding-inline:var(--ui-space-2); }
        [part="library-item"] { width:100%; min-height:var(--ui-control-height-s); display:flex; align-items:center; justify-content:flex-start; padding:var(--ui-space-2); border:0; border-radius:var(--ui-radius-s); color:var(--ui-color-text-primary); background:var(--ui-color-action-tertiary); font-family:var(--ui-font-sans); font-size:var(--ui-font-size-3); font-weight:var(--ui-font-weight-regular); line-height:calc(5 * var(--ui-space-1)); text-align:start; }
        [part="library-item"]:hover { background:var(--ui-color-action-tertiary-hover); }
        [part="library-item"][aria-current="page"] { background:var(--ui-color-action-secondary-selected); }
        [part="library-item"]:focus-visible { outline:var(--ui-focus-ring); outline-offset:var(--ui-focus-ring-offset); }
        [part="category-actions"] { position:absolute; inset-inline-end:var(--ui-space-2); top:50%; display:flex; align-items:center; gap:var(--ui-space-1); padding:0; border-radius:var(--ui-radius-s); background:inherit; opacity:0; visibility:hidden; pointer-events:none; transform:translateY(-50%); transition:opacity var(--ui-motion-duration-fast) var(--ui-motion-ease-standard); }
        [data-category-item]:is(:hover,:focus-within) [part="category-actions"] { opacity:1; visibility:visible; pointer-events:auto; }
        [part="category-actions"] ic-icon-button { color:var(--ui-color-text-primary); --ic-icon-button-control-size:1.5rem; --ic-icon-button-icon-size:var(--ui-icon-size-s); }
        [part="category-actions"] ic-icon-button::part(base) { inline-size:100%; min-inline-size:100%; block-size:100%; min-block-size:100%; padding:0; }
        [part="category-add"] { width:100%; min-height:var(--ui-control-height-s); display:flex; align-items:center; justify-content:flex-start; gap:var(--ui-space-2); padding-inline:var(--ui-space-2); border:0; border-radius:var(--ui-radius-s); color:var(--ui-color-text-primary); background:var(--ui-color-action-tertiary); font-family:var(--ui-font-sans); font-size:var(--ui-font-size-3); font-weight:var(--ui-font-weight-regular); line-height:calc(5 * var(--ui-space-1)); text-align:start; }
        [part="category-add"]:is(:hover,:focus-visible) { color:var(--ui-color-text-primary); background:var(--ui-color-action-tertiary-hover); }
        [data-category-item] { cursor:grab; touch-action:none; user-select:none; }
        [data-category-item][data-category-editing] { cursor:default; }
        [data-category-item]:active { cursor:grabbing; }
        [data-category-item][data-dragging] { opacity:.42; }
        [part="category-drag-preview"] { position:fixed; z-index:var(--ui-z-drag-preview); min-height:var(--ui-control-height-m); display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:var(--ui-space-2); padding-inline:var(--ui-space-2); border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary); border-radius:var(--ui-radius-s); color:var(--ui-color-text-primary); background:var(--ui-color-surface); pointer-events:none; opacity:.96; box-shadow:var(--ui-shadow-lg); transform:scale(1.015); transform-origin:center; }
        [data-category-item][data-drag-target] { outline:var(--ui-border-width-medium) solid var(--ui-color-border-selected); background:var(--ui-color-action-secondary-selected); }
        [data-category-item][data-template-drop-target] { outline:var(--ui-border-width-medium) solid var(--ui-color-border-selected); outline-offset:var(--ui-border-width-thin); background:var(--ui-color-action-secondary-selected); color:var(--ui-color-text-primary); box-shadow:var(--ui-shadow-raised); transform:scale(1.015); }
        [data-category-item][data-template-drop-committing] { animation:template-drop-feedback var(--ui-motion-duration-slow) var(--ui-motion-ease-standard); }
        [part="grid"] { width:100%; min-height:0; display:grid; grid-template-columns:repeat(auto-fill,minmax(14rem,1fr)); grid-auto-rows:max-content; align-content:start; align-items:start; gap:var(--ui-space-3); padding:var(--ui-space-1); overflow:auto; }
        [part="new-card"],[part="template-card"] { min-width:0; border-radius:var(--ui-radius-m); }
        [part="new-card"] { grid-column:1/-1; min-height:var(--ui-control-height-l); display:flex; align-items:center; gap:var(--ui-space-3); padding:var(--ui-space-2) var(--ui-space-3); border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary); color:var(--ui-color-text-primary); background:linear-gradient(100deg,var(--ui-color-action-secondary-selected),var(--ui-color-surface) 48%); text-align:start; transition:border-color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),box-shadow var(--ui-motion-duration-fast) var(--ui-motion-ease-standard); }
        [part="new-card"]:hover { border-color:var(--ui-color-border-primary); box-shadow:var(--ui-shadow-raised); }
        [part="new-card"]:focus-visible { outline:var(--ui-focus-ring); outline-offset:var(--ui-focus-ring-offset); }
        [part="new-card-mark"] { width:var(--ui-control-height-s); height:var(--ui-control-height-s); flex:none; display:grid; place-items:center; border-radius:var(--ui-radius-m); color:var(--ui-color-text-primary); background:var(--ui-color-surface); box-shadow:var(--ui-shadow-raised); }
        [part="new-card-copy"] { min-width:0; overflow:hidden; color:var(--ui-color-text-primary); font-size:var(--ui-font-size-3); font-weight:var(--ui-font-weight-bold); text-overflow:ellipsis; white-space:nowrap; }
        [part="new-card"]:disabled { display:none; }
        [part="template-card"] { position:relative; align-self:start; aspect-ratio:1/1; height:auto; display:block; padding:0; overflow:hidden; border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary); color:var(--ui-color-text-white); background:var(--ui-color-surface-subtle); box-shadow:var(--ui-shadow-raised); transition:border-color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),transform var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),box-shadow var(--ui-motion-duration-fast) var(--ui-motion-ease-standard); }
        [part="template-card"]:hover { border-color:var(--ui-color-border-primary); transform:translateY(-1px); }
        [part="template-card"]:focus-within { border-color:var(--ui-color-border-focus); box-shadow:var(--ui-shadow-none); }
        [part="template-card"][draggable="true"] { cursor:grab; }
        [part="template-card"][draggable="true"]:active { cursor:grabbing; }
        [part="template-card"][data-template-dragging] { opacity:.32; transform:scale(.97); }
        [part="template-drag-preview"] { position:fixed; z-index:var(--ui-z-drag-preview); display:grid; gap:var(--ui-space-2); margin:0; pointer-events:none; cursor:grabbing; opacity:.96; filter:saturate(1.06); transform:scale(1.02) rotate(.35deg); transform-origin:center; box-shadow:var(--ui-shadow-overlay); will-change:left,top,width,height,transform,opacity; }
        [part="template-drag-preview"][data-magnetized] { transform:scale(1.015); }
        [part="template-drag-preview"][data-releasing] { opacity:.18; transform:scale(.96); transition:left var(--ui-motion-duration-normal) var(--ui-motion-ease-standard),top var(--ui-motion-duration-normal) var(--ui-motion-ease-standard),width var(--ui-motion-duration-normal) var(--ui-motion-ease-standard),height var(--ui-motion-duration-normal) var(--ui-motion-ease-standard),opacity var(--ui-motion-duration-normal) var(--ui-motion-ease-standard),transform var(--ui-motion-duration-normal) var(--ui-motion-ease-standard); }
        [part="template-drag-visual"] { position:relative; aspect-ratio:1/1; overflow:hidden; border:var(--ui-border-width-thin) solid var(--ui-color-border-selected); border-radius:var(--ui-radius-m); outline:var(--ui-border-width-strong) solid var(--ui-color-border-selected); outline-offset:var(--ui-border-width-thin); background:var(--ui-color-surface); box-shadow:var(--ui-shadow-none); }
        [part="template-drag-visual"] [part="template-preview"] { position:absolute; inset:0; }
        [part="template-drag-name"] { position:absolute; inset:auto 0 0; z-index:var(--ui-z-raised); display:block; padding:var(--ui-space-6) var(--ui-space-3) var(--ui-space-3); overflow:hidden; color:var(--ui-color-text-white); background:linear-gradient(180deg,transparent,var(--ui-color-mask)); font-weight:var(--ui-font-weight-bold); text-overflow:ellipsis; white-space:nowrap; }
        [part="template-drag-status"] { justify-self:start; display:inline-flex; align-items:center; gap:var(--ui-space-1); min-height:var(--ui-control-height-s); padding-inline:var(--ui-space-2); border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary); border-radius:var(--ui-radius-pill); color:var(--ui-color-text-primary); background:var(--ui-color-surface); box-shadow:var(--ui-shadow-raised); font:var(--ui-text-caption); }
        @keyframes template-drop-feedback { 0% { transform:scale(.94); opacity:.68; } 58% { transform:scale(1.025); opacity:1; } 100% { transform:scale(1); opacity:1; } }
        @media (prefers-reduced-motion:reduce) { [part="template-drag-preview"][data-releasing],[data-category-item][data-template-drop-committing],[part="template-card"][data-template-dragging] { transition-duration:var(--ui-motion-duration-normal); animation-duration:var(--ui-motion-duration-normal); } }
        [part="template-select"] { position:absolute; inset:0; z-index:var(--ui-z-base); width:100%; min-width:0; display:block; padding:0; overflow:hidden; border:0; color:inherit; text-align:start; background:var(--ui-color-action-tertiary); }
        [part="template-select"]:focus-visible { outline:0; }
        [part="template-preview"] { position:absolute; inset:0; width:100%; min-height:0; display:grid; place-items:center; padding:0; overflow:hidden; background:linear-gradient(145deg,var(--ui-color-action-secondary-selected),var(--ui-color-surface-subtle)); }
        [part="template-preview"] img { width:100%; height:100%; object-fit:cover; }
        [part="template-preview"] p { display:-webkit-box; margin:0; padding:var(--ui-space-4); overflow:hidden; color:var(--ui-color-text-tertiary); -webkit-line-clamp:4; -webkit-box-orient:vertical; }
        [part="template-mask"] { position:absolute; z-index:var(--ui-z-raised); inset:auto 0 0; height:4rem; pointer-events:none; background:linear-gradient(180deg,transparent 0%,color-mix(in srgb,var(--ui-color-mask) 83%,transparent) 50%,var(--ui-color-mask) 100%); }
        [part="template-meta"] { position:absolute; z-index:var(--ui-z-sticky); inset:auto var(--ui-space-3) var(--ui-space-3); min-width:0; display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:var(--ui-space-2); pointer-events:none; }
        [part="template-name"] { overflow:hidden; color:var(--ui-color-text-white); font-size:16px; font-weight:var(--ui-font-weight-bold); line-height:var(--ui-line-height-tight); text-overflow:ellipsis; white-space:nowrap; }
        [part="template-preview"][data-no-cover] { place-items:start; background:var(--prompt-template-no-cover-tone); }
        [part="template-preview"][data-no-cover]::before { content:""; position:absolute; inset:0; background-image:linear-gradient(rgb(255 255 255 / 5.5%) 1px,transparent 1px),linear-gradient(90deg,rgb(255 255 255 / 5.5%) 1px,transparent 1px); background-size:28px 28px; pointer-events:none; mask-image:linear-gradient(to bottom,black,transparent 72%); }
        [part="template-preview"][data-no-cover]::after { content:"“"; position:absolute; left:18px; top:11px; color:rgb(255 255 255 / 20%); font:var(--ui-font-weight-bold) 60px/1 Georgia,serif; pointer-events:none; }
        [part="template-preview"][data-no-cover] p { position:absolute; z-index:var(--ui-z-base); inset:44px 18px calc(60px + 1rem); display:block; margin:0; padding:0; color:rgb(255 255 255 / 80%); font-size:var(--ui-font-size-3); line-height:2; -webkit-line-clamp:unset; -webkit-box-orient:unset; mask-image:linear-gradient(to bottom,black 0,black calc(100% - 10px),transparent 100%); -webkit-mask-image:linear-gradient(to bottom,black 0,black calc(100% - 10px),transparent 100%); }
        [part="template-card"][data-no-cover] { border:1px solid rgb(255 255 255 / 17%); border-radius:13px; box-shadow:0 7px 18px rgb(15 23 42 / 12%); }
        [part="template-card"][data-no-cover]:hover { transform:translateY(-2px); box-shadow:0 11px 25px rgb(15 23 42 / 18%); }
        [part="template-card"][data-no-cover] [part="template-mask"] { display:none; }
        [part="template-card"][data-no-cover] [part="template-meta"] { inset:auto 13px 13px 18px; padding-top:13px; }
        [part="template-card"][data-no-cover] [part="template-name"] { font-size:17px; font-weight:720; }
        [part="template-card"]:not([data-no-cover]) [part="template-meta"] { inset:auto 13px 13px 18px; padding-top:13px; }
        [part="template-actions"] { position:relative; display:flex; align-items:center; gap:var(--ui-space-1); pointer-events:auto; }
        [part="template-actions"] ic-icon-button { width:34px; height:34px; flex:none; color:var(--ui-color-text-white); opacity:.86; --ic-icon-button-control-size:34px; --ic-icon-context-stroke-width:var(--ui-icon-stroke-width-m); }
        [part="template-actions"] ic-icon-button::part(base) { width:100%; min-width:100%; height:100%; min-height:100%; border:0; color:var(--ui-color-text-white); background:var(--ui-color-action-tertiary); box-shadow:none; backdrop-filter:none; }
        [part="template-actions"] ic-icon-button:hover { opacity:1; }
        [part="template-actions"] ic-icon-button:hover::part(base) { background:var(--ui-color-action-tertiary); }
        [part="empty"] { grid-column:1/-1; min-height:13rem; display:grid; place-items:center; color:var(--ui-color-text-tertiary); }
        :host([busy]) [part="template-actions"],:host([busy]) [part="new-card"],:host([busy]) [part="editor-actions"] { pointer-events:none; opacity:.6; }
        [part="task-layer"] { position:absolute; inset:0; z-index:var(--ui-z-backdrop); display:grid; place-items:center; padding:var(--ui-space-5); overflow:auto; background:color-mix(in srgb,var(--ui-color-mask) 76%,transparent); backdrop-filter:blur(7px); }
        .task-surface { position:relative; border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary); border-radius:var(--ui-radius-m); background:var(--ui-color-surface); box-shadow:var(--ui-shadow-modal); }
        [part="editor"] { width:min(58.75rem,100%); max-height:100%; display:grid; grid-template-columns:minmax(18rem,.92fr) minmax(0,1.08fr); grid-template-rows:auto minmax(27.5rem,1fr) auto; column-gap:30px; row-gap:var(--ui-space-4); padding:22px; overflow:auto; }
        [part="editor-header"] { grid-column:1/-1; display:flex; align-items:center; gap:var(--ui-space-3); }
        [part="editor-title-mark"] { width:var(--ui-control-height-m); height:var(--ui-control-height-m); display:grid; flex:none; place-items:center; border-radius:var(--ui-radius-m); color:var(--ui-color-text-primary); background:var(--ui-color-action-secondary-selected); }
        [part="editor-title-mark"] ic-icon { width:var(--ui-icon-size-s); height:var(--ui-icon-size-s); }
        [part="editor-header"] h2 { margin:0; font:var(--ui-text-title-2); }
        [part~="editor-preview"] { position:relative; min-width:0; min-height:27.5rem; overflow:hidden; border-radius:var(--ui-radius-l); color:var(--ui-color-text-white); background:var(--ui-color-prompt-template-placeholder-1); }
        [part~="editor-preview"]::before { content:""; position:absolute; inset:0; z-index:var(--ui-z-base); background-image:linear-gradient(rgb(255 255 255 / 5.5%) 1px,transparent 1px),linear-gradient(90deg,rgb(255 255 255 / 5.5%) 1px,transparent 1px); background-size:28px 28px; pointer-events:none; mask-image:linear-gradient(to bottom,black,transparent 72%); }
        [part~="editor-preview"][data-has-cover]::before { opacity:.08; }
        [part~="editor-preview"] ic-media-container { position:absolute; inset:0; z-index:var(--ui-z-base); width:100%; height:100%; }
        [part~="editor-preview"] ic-media-container::part(frame) { width:100%; height:100%; border:0; border-radius:0; }
        [part~="editor-preview"]:not([data-has-cover]) ic-media-container { display:none; }
        [part="editor-preview-copy"] { position:absolute; inset:0; z-index:var(--ui-z-raised); display:flex; flex-direction:column; padding:54px 28px 86px; }
        [part="editor-preview-copy"][hidden] { display:none; }
        [part="editor-preview-quote"] { height:48px; color:rgb(255 255 255 / 22%); font:var(--ui-font-weight-bold) 68px/1 Georgia,serif; }
        [part="editor-preview-copy"] p { display:-webkit-box; margin:8px 0 0; overflow:hidden; color:rgb(255 255 255 / 94%); font-size:17px; line-height:1.85; -webkit-box-orient:vertical; -webkit-line-clamp:8; }
        [part="editor-preview-footer"] { position:absolute; z-index:var(--ui-z-sticky); inset:auto 18px 18px; min-width:0; display:flex; align-items:center; gap:var(--ui-space-3); }
        [part="editor-preview-name"] { min-width:0; flex:1; overflow:hidden; font-size:var(--ui-font-size-3); font-weight:var(--ui-font-weight-bold); text-overflow:ellipsis; white-space:nowrap; }
        [part="editor-cover-actions"] { display:flex; flex:none; align-items:center; gap:var(--ui-space-2); }
        [part="editor-cover-actions"] ic-button::part(base) { border-color:rgb(255 255 255 / 30%); color:var(--ui-color-text-white); background:rgb(10 15 25 / 25%); box-shadow:0 5px 18px rgb(10 15 25 / 12%); backdrop-filter:blur(10px); }
        [part="editor-fields"] { min-width:0; min-height:0; display:flex; flex-direction:column; gap:var(--ui-space-5); padding:0; }
        [part="editor-fields"] ic-input,[part="editor-fields"] ic-textarea { width:100%; min-width:0; }
        [part="editor-fields"] ic-textarea { min-height:0; flex:1; }
        [part="editor-fields"] ic-textarea::part(base),[part="editor-fields"] ic-textarea::part(textarea) { height:100%; }
        [part="editor-actions"] { grid-column:1/-1; display:flex; align-items:center; justify-content:flex-end; gap:var(--ui-space-2); padding:0; }
        [part="editor-actions"] [data-editor-delete] { margin-inline-end:auto; }
        [part="editor-cover-actions"] ic-button,[part="editor-actions"] ic-button { flex:none; }
        [part="editor-error"] { color:var(--ui-color-text-danger); font:var(--ui-text-caption); }
        [part="delete-confirmation"] { width:min(28rem,100%); display:grid; gap:var(--ui-space-3); padding:var(--ui-space-5); }
        [part="delete-confirmation"] h2,[part="delete-confirmation"] p { margin:0; }
        [part="delete-confirmation"] h2 { font:var(--ui-text-title-3); }
        [part="delete-confirmation"] p { color:var(--ui-color-text-tertiary); }
        [part="delete-confirmation-actions"] { display:flex; justify-content:flex-end; gap:var(--ui-space-2); }
        @media (max-width:720px) {
          [part="task-layer"] { padding:var(--ui-space-3); }
          [part="header"] { padding:var(--ui-space-5) var(--ui-space-6); }
          [part="search"] { width:100%; }
          [part="library-layout"] { grid-template-columns:minmax(0,1fr); grid-template-rows:auto minmax(0,1fr); padding:var(--ui-space-3) var(--ui-space-4) var(--ui-space-4); }
          [part="sidebar"] { max-height:16rem; }
          [part="editor"] { grid-template-columns:minmax(0,1fr); grid-template-rows:auto auto minmax(22.5rem,1fr) auto; gap:var(--ui-space-5); padding:var(--ui-space-3); }
          [part~="editor-preview"] { min-height:13.75rem; }
          [part="editor-preview-copy"] { padding:28px 20px 72px; }
          [part="editor-preview-quote"] { height:34px; font-size:52px; }
          [part="editor-preview-copy"] p { margin-top:4px; font-size:var(--ui-font-size-3); line-height:1.65; -webkit-line-clamp:3; }
          [part="editor-preview-footer"] { inset:auto 14px 14px; }
        }
      </style>
      <section part="workspace" aria-busy="${this.busy}" ${blockingOverlayOpen ? 'data-task' : ''}>
        <div part="library-view" ${blockingOverlayOpen ? 'inert aria-hidden="true"' : ''}>
          <header part="header">
          <h1 part="title">${escapeHtml(copy.title)}</h1>
          <button part="close" data-close type="button" aria-label="${copy.close}"><ic-icon name="close"></ic-icon></button>
        </header>
        <div part="library-layout">
          <aside part="sidebar" ${canvasScope ? 'data-canvas-scope' : ''}>
            <ic-form-field part="search" data-component-name="ic-form-field-search-s">
              <ic-input part="search-input" slot="control" data-search type="search" size="s" value="${escapeHtml(this._query)}" placeholder="${escapeHtml(copy.search)}" aria-label="${escapeHtml(copy.search)}" autocomplete="off" end-action>
                <ic-icon slot="start" name="search"></ic-icon>
                <ic-icon-button part="search-clear" slot="end" type="button" size="s" background="ghost" icon="close" label="${escapeHtml(copy.clear)}" data-search-clear ${this._query ? '' : 'hidden'}></ic-icon-button>
              </ic-input>
            </ic-form-field>
            <nav part="library-switch" data-library-switch aria-label="${escapeHtml(this.getAttribute('aria-label') || copy.title)}">
            <ic-tabs part="category-tabs" data-category-tabs data-legal-combination="vertical-manual-label" label="${escapeHtml(copy.folder)}" value="${escapeHtml(canvasScope ? '__inactive__' : this.activeCategory)}" orientation="vertical" activation="manual" space="0.125rem">
              <h2 part="library-title" id="ic-prompt-library-common-title"><span>${escapeHtml(copy.common)}</span><small part="library-count" data-library-count="${escapeHtml(commonLibraryId)}">${libraryCounts[commonLibraryId] || 0}</small></h2>
              <button type="button" data-value="all"><span part="category-label">${copy.all}</span></button>
              ${categories.map(category => {
                const editing = this._categoryEditorMode === 'edit' && this._categoryEditorId === category.id;
                return `<div data-value="${escapeHtml(category.id)}" data-category-item="${escapeHtml(category.id)}" ${editing ? 'data-category-editing' : ''}>
                ${editing ? `<ic-form-field part="category-rename-field" aria-label="${escapeHtml(copy.groupName)}" data-component-name="ic-form-field-text-s" validation="${escapeHtml(this._categoryEditorError)}"><ic-input part="category-rename-input" slot="control" data-category-editor-name type="text" size="s" value="${escapeHtml(this._categoryEditorName)}" maxlength="24" autocomplete="off"></ic-input></ic-form-field>` : `<span part="category-label">${escapeHtml(category.name)}</span>`}
                ${canEditCommon && !editing && !category.managed ? `<span part="category-actions"><ic-icon-button type="button" size="s" hierarchy="quiet" icon="edit" label="${copy.renameGroup}" data-category-edit="${escapeHtml(category.id)}"></ic-icon-button><ic-icon-button type="button" size="s" hierarchy="quiet" icon="delete" label="${copy.deleteGroup}" data-category-delete="${escapeHtml(category.id)}"></ic-icon-button></span>` : ''}
              </div>`;
              }).join('')}
              ${canEditCommon ? (this._categoryEditorMode === 'create'
                ? `<div part="category-add-editor" data-category-editing aria-label="${escapeHtml(copy.createGroup)}"><ic-form-field part="category-rename-field" aria-label="${escapeHtml(copy.groupName)}" data-component-name="ic-form-field-text-s" validation="${escapeHtml(this._categoryEditorError)}"><ic-input part="category-rename-input" slot="control" data-category-editor-name type="text" size="s" value="${escapeHtml(this._categoryEditorName)}" placeholder="${escapeHtml(copy.groupNamePlaceholder)}" maxlength="24" autocomplete="off"></ic-input></ic-form-field></div>`
                : `<button part="category-add" type="button" data-category-new><ic-icon name="add"></ic-icon><span>${copy.createGroup}</span></button>`)
                : ''}
            </ic-tabs>
            <ic-tabs part="category-tabs" data-library-tabs data-legal-combination="vertical-manual-label" label="${escapeHtml(copy.canvas)}" value="${escapeHtml(canvasScope ? canvasLibraryId : '__inactive__')}" orientation="vertical" activation="manual" space="0.125rem">
              <h2 part="library-title" id="ic-prompt-library-canvas-title"><span>${escapeHtml(copy.canvas)}</span><small part="library-count" data-library-count="${escapeHtml(canvasLibraryId)}">${libraryCounts[canvasLibraryId] || 0}</small></h2>
              <button part="library-item" type="button" data-value="${escapeHtml(canvasLibraryId)}" data-library-id="${escapeHtml(canvasLibraryId)}" ${canvasScope ? 'aria-current="page"' : ''}>${escapeHtml(copy.all)}</button>
            </ic-tabs>
            </nav>
          </aside>
          <main part="grid">${this.renderTemplateGrid()}</main>
          </div>
        </div>
        ${blockingOverlayOpen ? `<div part="task-layer">${this.renderTaskContent(copy, editorDraft, promotionTemplate)}</div>` : ''}
        <ic-confirm-popover data-category-delete-confirmation cancel-label="${escapeHtml(copy.cancel)}" confirm-label="${escapeHtml(copy.deleteGroup)}" consequence="destructive" placement="inline-end" alignment="start"></ic-confirm-popover>
        <ic-confirm-popover data-template-delete-confirmation cancel-label="${escapeHtml(copy.cancel)}" confirm-label="${escapeHtml(copy.deleteConfirm)}" consequence="destructive" placement="block-start" alignment="start"></ic-confirm-popover>
      </section>
    `;

    if (options.focusPromotion) {
      requestAnimationFrame(() => (this.shadowRoot.querySelector('[data-promotion-category]') || this.shadowRoot.querySelector('[data-promotion-create-category]'))?.focus({ preventScroll: true }));
    } else if (options.focusCategoryEditor) {
      requestAnimationFrame(() => this.shadowRoot.querySelector('[data-category-editor-name]')?.focus({ preventScroll: true }));
    } else if (options.focusEditor) {
      requestAnimationFrame(() => this.shadowRoot.querySelector('[data-editor-name]')?.focus({ preventScroll: true }));
    } else if (options.focusSearch) {
      requestAnimationFrame(() => {
        const input = this.shadowRoot.querySelector('[data-search]');
        input?.focus({ preventScroll: true });
      });
    } else if (activeTextControl) {
      requestAnimationFrame(() => this.restoreTextControlState(activeTextControl));
    }
  }
}

export { PUBLIC_EVENTS as IC_PROMPT_TEMPLATE_LIBRARY_EVENTS };
