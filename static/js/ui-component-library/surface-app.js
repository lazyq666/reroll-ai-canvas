(() => {
  if ('scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual';
  }

  const SURFACE_MANIFEST_URL = '/static/design-system/infinite-canvas-ui/surface-manifest.json';
  const LEGACY_MANIFEST_URL = '/static/design-system/live-catalog/manifest.json';
  const SEMANTIC_BASELINE_URL = '/static/design-system/infinite-canvas-ui/semantic-baseline-v1.json';
  const model = window.InfiniteCanvasUiSurfaceModel;
  const tabs = [...document.querySelectorAll('[data-surface-tab]')];
  const panels = [...document.querySelectorAll('[data-surface-panel]')];
  const surfaceStatus = document.querySelector('[data-surface-status]');
  const lifecycleHost = document.querySelector('[data-contract-lifecycle]');
  const migrationSummaryHost = document.querySelector('[data-migration-summary]');
  const migrationList = document.querySelector('[data-migration-list]');
  const migrationReverse = document.querySelector('[data-migration-reverse]');
  const migrationSearch = document.querySelector('[data-migration-search]');
  const migrationPage = document.querySelector('[data-migration-page]');
  const migrationPrevious = document.querySelector('[data-migration-previous]');
  const migrationNext = document.querySelector('[data-migration-next]');
  const legacySidebarToggle = document.querySelector('[data-sidebar-toggle]');
  const targetReviewTabs = [...document.querySelectorAll('ic-nav-item[data-target-review]')];
  const targetReviewNames = new Set(targetReviewTabs.map(item => item.dataset.targetReview));
  const targetReviewSearch = document.querySelector('[data-target-review-search]');
  const targetReviewSearchStatus = document.querySelector('[data-target-review-search-status]');
  const targetComponentSearchResults = document.querySelector('[data-target-component-search-results]');
  const targetReviewSearchPanel = document.querySelector('[data-target-review-search-panel]');
  const targetReviewSearchTrigger = document.querySelector('[data-target-review-search-trigger]');
  const targetReviewGroups = [...document.querySelectorAll('.target-review-section[data-target-review-group]')];
  const targetReviewTitle = document.querySelector('[data-target-review-title]');
  const targetThemeToggle = document.querySelector('[data-target-theme-toggle]');
  const targetThemeIcon = document.querySelector('[data-target-theme-icon]');
  const targetThemeLabel = document.querySelector('[data-target-theme-label]');
  const targetSurfaceGrid = document.querySelector('.target-surface-grid');
  const acceptanceReview = document.querySelector('[data-acceptance-review]');
  const composerMatrix = document.querySelector('[data-composer-matrix]');
  const promptTemplateLibraryMatrix = document.querySelector('[data-prompt-template-library-matrix]');
  const searchNavigationSidebarMatrix = document.querySelector('[data-search-navigation-sidebar-matrix]');
  const imageEditingMatrix = document.querySelector('[data-image-editing-matrix]');
  const imageEditModeToolbarMatrix = document.querySelector('[data-image-edit-mode-toolbar-matrix]');
  const smartNodeToolbarMatrix = document.querySelector('[data-smart-node-toolbar-matrix]');
  const smartNodeContextMenuMatrix = document.querySelector('[data-smart-node-context-menu-matrix]');
  const smartCanvasDockMatrix = document.querySelector('[data-smart-canvas-dock-matrix]');
  const smartMinimapMatrix = document.querySelector('[data-smart-minimap-matrix]');
  const nodesMatrix = document.querySelector('[data-nodes-matrix]');
  const dialogMatrix = document.querySelector('[data-dialog-matrix]');
  const menuPopoverMatrix = document.querySelector('[data-menu-popover-matrix]');
  const navigationCommandMatrix = document.querySelector('[data-navigation-command-matrix]');
  const containersDataMatrix = document.querySelector('[data-containers-data-matrix]');
  const fileMediaInputMatrix = document.querySelector('[data-file-media-input-matrix]');
  const feedbackProgressMatrix = document.querySelector('[data-feedback-progress-matrix]');
  const emptyStatesMatrix = document.querySelector('[data-empty-states-matrix]');
  const generationFailureFeedbackMatrix = document.querySelector('[data-generation-failure-feedback-matrix]');
  const selectionAdjustmentMatrix = document.querySelector('[data-selection-adjustment-matrix]');
  const headingMatrix = document.querySelector('[data-heading-matrix]');
  const actionsMatrix = document.querySelector('[data-actions-matrix]');
  const textEntryMatrix = document.querySelector('[data-text-entry-matrix]');
  const designTokensExplorer = document.querySelector('[data-design-tokens-explorer]');
  const foundationsMatrix = document.querySelector('[data-foundations-matrix]');
  const scrollbarMatrix = document.querySelector('[data-scrollbar-matrix]');
  const pendingMotionReference = document.querySelector('[data-pending-motion-reference]');
  const pendingHalftoneReference = document.querySelector('[data-pending-halftone-reference]');
  const pendingPerformancePrototype = document.querySelector('[data-pending-performance-prototype]');
  const clickSparkReference = document.querySelector('[data-click-spark-reference]');
  const componentTracer = document.querySelector('[data-target-tracer]');
  const targetReviewFrames = [...document.querySelectorAll('.target-review-preview > iframe')];
  const targetFrameObservers = new WeakMap();
  const nestedFrameObservers = new WeakMap();
  const dialogVisibilityDocuments = new WeakSet();
  const targetMatrixReadinessObservers = new WeakMap();
  const pendingMappings = new Map();
  const matrixPresentation = window.InfiniteCanvasUiMatrixPresentation;
  const NON_COMPONENT_REVIEWS = new Set([
    'actions',
    'design-tokens',
    'foundations',
    'scrollbar',
    'pending-motion-reference',
    'pending-halftone-reference',
    'pending-performance-prototype',
    'click-spark-reference',
    'components',
    'nodes',
  ]);
  let surfaceManifest = null;
  let legacyManifest = null;
  let semanticBaseline = null;
  let store = null;
  let page = 0;
  let targetTheme = 'light';

  const targetReviewLabels = Object.freeze({
    actions: '按钮',
    heading: '标题',
    'text-entry': '文本输入',
    'selection-adjustment': '选择与调节',
    'file-media-input': '文件与媒体输入',
    'containers-data': '容器与数据展示',
    'navigation-command': '导航与命令',
    dialog: '对话框',
    'menu-popover': '菜单、浮层与提示',
    'feedback-progress': '反馈与进度',
    'empty-states': '空状态',
    'generation-failure-feedback': '生成失败反馈',
    composer: '生成编辑器',
    'prompt-template-library': '提示词模板库',
    'search-navigation-sidebar': '检索导航侧栏',
    'image-editing': '图片编辑区',
    'image-edit-mode-toolbar': '图片编辑模式栏',
    'smart-node-toolbar': '节点浮动操作栏',
    'smart-node-context-menu': '节点右键菜单',
    'smart-canvas-dock': '智能画布工具栏',
    'smart-minimap': '智能画布导航地图',
    nodes: '节点',
    'design-tokens': '设计参数',
    foundations: '设计基础',
    scrollbar: '滚动条',
    'pending-motion-reference': '动画实验 A',
    'pending-halftone-reference': '动画实验 B',
    'pending-performance-prototype': '动画性能对比',
    'click-spark-reference': '点击反馈实验',
    components: '组件检查器',
  });

  const targetComponents = [
    ['ic-button', 'Button', 'actions'],
    ['ic-icon-button', 'Icon Button', 'actions'],
    ['ic-video-play-button', 'Video Play Button', 'actions'],
    ['ic-button', 'Button · Generation Task Query', 'actions', 'ic-button-node-generation-task-query'],
    ['ic-button-group', 'Button Group', 'actions'],
    ['ic-heading', 'Heading', 'heading'],
    ['ic-input', 'Input', 'text-entry'],
    ['ic-textarea', 'Textarea', 'text-entry'],
    ['ic-form-field', 'Form Field', 'text-entry'],
    ['ic-form-field', 'Search Field', 'text-entry', 'ic-form-field-search'],
    ['ic-prompt-composer', 'Prompt Composer', 'text-entry'],
    ['ic-checkbox', 'Checkbox', 'selection-adjustment'],
    ['ic-checkbox', 'Checkbox · List', 'selection-adjustment', 'ic-checkbox-list'],
    ['ic-aspect-ratio-picker', 'Aspect Ratio Picker', 'selection-adjustment'],
    ['ic-aspect-ratio-picker', 'Aspect Ratio Picker · Multiple', 'selection-adjustment', 'ic-aspect-ratio-picker-multiple'],
    ['ic-color-field', 'Color Field', 'selection-adjustment'],
    ['ic-number-input', 'Number Input', 'selection-adjustment'],
    ['ic-radio-group', 'Radio Group', 'selection-adjustment'],
    ['ic-radio', 'Radio', 'selection-adjustment'],
    ['ic-select', 'Select', 'selection-adjustment'],
    ['ic-select', 'Select · Model', 'selection-adjustment', 'ic-select-model'],
    ['ic-generation-settings-picker', 'Generation Settings Picker', 'selection-adjustment'],
    ['ic-select', 'Select · Count', 'selection-adjustment', 'ic-select-count'],
    ['ic-slider', 'Slider', 'selection-adjustment'],
    ['ic-switch', 'Switch', 'selection-adjustment'],
    ['ic-file-input', 'File Input', 'file-media-input'],
    ['ic-upload-surface', 'Upload Surface', 'file-media-input'],
    ['ic-media-player-controls', 'Media Player Controls', 'file-media-input'],
    ['ic-media-slot', 'Media Slot', 'file-media-input'],
    ['ic-reference-thumbnail', 'Reference Thumbnail', 'file-media-input'],
    ['ic-image-frame', 'Image Frame', 'file-media-input'],
    ['ic-card', 'Card', 'containers-data'],
    ['ic-divider', 'Divider', 'containers-data'],
    ['ic-list', 'List', 'containers-data'],
    ['ic-table', 'Table', 'containers-data'],
    ['ic-media-container', 'Media Container', 'containers-data'],
    ['ic-tabs', 'Tabs', 'navigation-command'],
    ['ic-segmented-control', 'Segmented Control', 'navigation-command'],
    ['section-navigation', 'Section Navigation', 'navigation-command'],
    ['ic-toolbar', 'Toolbar', 'navigation-command'],
    ['ic-floating-toolbar', 'Floating Toolbar', 'navigation-command'],
    ['ic-nav-item', 'Navigation Item', 'navigation-command'],
    ['ic-nav-disclosure', 'Expandable Navigation', 'navigation-command'],
    ['ic-breadcrumb', 'Breadcrumb', 'navigation-command'],
    ['ic-pagination', 'Pagination', 'navigation-command'],
    ['ic-steps', 'Steps', 'navigation-command'],
    ['ic-dialog', 'Dialog', 'dialog'],
    ['ic-confirmation-dialog', 'Confirmation Dialog', 'dialog'],
    ['ic-ai-processor-dialog', 'AI Processor Dialog', 'dialog'],
    ['generation-log-modal', 'Generation Log Modal', 'dialog'],
    ['ic-menu', 'Menu', 'menu-popover'],
    ['ic-menu', 'Menu · 引用该节点生成', 'menu-popover', 'ic-menu-reference-generate'],
    ['ic-menu-item', 'Menu Item', 'menu-popover'],
    ['ic-popover', 'Popover', 'menu-popover'],
    ['ic-confirm-popover', 'Confirm Popover', 'menu-popover'],
    ['ic-tooltip', 'Tooltip', 'menu-popover'],
    ['ic-mention-picker', 'Mention Picker', 'menu-popover'],
    ['ic-mention-picker', 'Mention Picker · 提示词', 'menu-popover', 'ic-mention-picker-prompt'],
    ['ic-mention-picker', 'Mention Picker · 输入图', 'menu-popover', 'ic-mention-picker-media'],
    ['ic-thumb-hovercard', 'Thumb Hovercard', 'menu-popover'],
    ['ic-alert', 'Alert', 'feedback-progress'],
    ['ic-badge', 'Badge', 'feedback-progress'],
    ['ic-badge', 'Badge · Node Runtime Status', 'feedback-progress', 'ic-badge-node-runtime-status'],
    ['ic-toast', 'Toast', 'feedback-progress'],
    ['ic-loading', 'Loading', 'feedback-progress'],
    ['ic-progress', 'Progress', 'feedback-progress'],
    ['ic-skeleton', 'Skeleton', 'feedback-progress'],
    ['ic-empty-state', 'Empty State', 'empty-states'],
    ['ic-generation-pending', 'Generation Pending', 'feedback-progress'],
    ['ic-generation-recovery', 'Generation Recovery', 'feedback-progress'],
    ['smart-canvas-placeholder', 'Smart Canvas · 正在生成图片', 'empty-states', 'smart-canvas-far-generation-pending'],
    ['smart-canvas-placeholder', 'Smart Canvas · 提示词文本骨架', 'empty-states', 'smart-canvas-far-prompt-skeleton'],
    ['smart-canvas-placeholder', 'Smart Canvas · 编组图片格', 'empty-states', 'smart-canvas-far-smart-group-media-skeleton'],
    ['smart-canvas-placeholder', 'Smart Canvas · 音频占位', 'empty-states', 'smart-canvas-far-audio-placeholder'],
    ['smart-canvas-placeholder', 'Smart Canvas · 视频占位', 'empty-states', 'smart-canvas-far-video-placeholder'],
    ['smart-composer', 'Composer · Generation authoring', 'composer'],
    ['ic-prompt-template-library', 'Prompt Template Library', 'prompt-template-library'],
    ['search-navigation-sidebar', 'Search Navigation Sidebar', 'search-navigation-sidebar'],
    ['ic-image-edit-selector', 'Image Edit Selector', 'image-editing'],
    ['ic-image-edit-slider', 'Image Edit Slider', 'image-editing'],
    ['ic-image-edit-value', 'Image Edit Value', 'image-editing'],
    ['ic-image-edit-dock', 'Image Edit Dock', 'image-editing'],
    ['ic-image-edit-mode-toolbar', 'Image Edit Mode Toolbar', 'image-edit-mode-toolbar'],
    ['ic-smart-node-toolbar', 'Smart Node Toolbar', 'smart-node-toolbar'],
    ['ic-smart-node-context-menu', 'Smart Node Context Menu', 'smart-node-context-menu'],
    ['ic-smart-canvas-dock', 'Smart Canvas Dock', 'smart-canvas-dock'],
    ['ic-smart-minimap', 'Smart Minimap', 'smart-minimap'],
    ['ic-canvas-node', 'Canvas Node', 'nodes'],
    ['ic-canvas-node', 'Canvas Node · Image / Media', 'nodes', 'ic-canvas-node-image'],
    ['ic-canvas-node', 'Canvas Node · Prompt', 'nodes', 'ic-canvas-node-prompt'],
    ['ic-canvas-node', 'Canvas Node · Prompt Generation', 'nodes', 'ic-canvas-node-prompt-generation'],
    ['ic-canvas-node', 'Canvas Node · Splitter', 'nodes', 'ic-canvas-node-splitter'],
    ['ic-canvas-node', 'Canvas Node · Loop', 'nodes', 'ic-canvas-node-loop'],
    ['ic-canvas-node', 'Canvas Node · Smart Group', 'nodes', 'ic-canvas-node-smart-group'],
    ['ic-canvas-node', 'Canvas Node · Frame', 'nodes', 'ic-canvas-node-frame'],
    ['ic-canvas-node', 'Canvas Node · Text Annotation', 'nodes', 'ic-canvas-node-text-annotation'],
    ['ic-canvas-node', 'Canvas Node · Brush Stroke', 'nodes', 'ic-canvas-node-brush-stroke'],
    ['ic-icon', 'Icon', 'foundations'],
    ['ic-scrollbar', 'Scrollbar Foundation', 'scrollbar'],
  ].map(([tag, label, review, name = tag]) => ({ tag, name, label, review, reviewLabel: targetReviewLabels[review] }));

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const lifecycleLabels = {
    draft: ['草稿', '仍可修改用途、合同与映射'],
    contract_confirmed: ['合同已确认', '第一次人工确认：用途、接口、合法组合与旧实例映射'],
    implemented: ['已实现', '真实 ic-* 技术 Tracer 已存在'],
    live_confirmed: ['真实运行已确认', '第二次人工确认：视觉、交互、键盘与无障碍'],
    migration_ready: ['可迁移', '允许进入后续页面迁移'],
  };

  const lifecycleTasks = {
    contract_confirmed: {
      title: '确认组件合同',
      description: '先在 Migration Map 检查全量语义分类、命名和页面模块边界，再判断当前 Target 合同，最后留下第一次人工确认。',
      checks: [
        'Foundations、Primitives、Patterns、Domain Components 与页面模块边界清楚',
        '同用途旧实现已合并，只有表达产品意义的视觉差异被保留',
        '每个旧实例的目标、页面模块或业务例外建议都能从理由和源码证据理解',
        'Button、Input、Dialog 的用途和状态容易理解',
        '主题、宽度与内容只是使用情境，不被误当成组件变体',
        '旧界面证据和迁移工作没有混入 Target 规范',
      ],
    },
    implemented: {
      title: '记录实现证据',
      description: '合同已确认。现在只需记录真实 ic-* 实现和验收预览已经存在。',
      checks: [
        '预览使用项目拥有的 ic-* 公开接口',
        '实现证据能指向 ic-core-v1 与当前 Target Tracer',
      ],
    },
    live_confirmed: {
      title: '完成真实运行验收',
      description: '操作真实组件，确认视觉、键盘、焦点与对话框行为，再留下第二次人工确认。',
      checks: [
        '浅色、深色、桌面、窄屏与长内容均可读',
        'Tab 焦点清楚，禁用、只读、加载与必填状态可辨认',
        'Dialog 标题可见，焦点进入，Escape 关闭后返回触发按钮',
      ],
    },
    migration_ready: {
      title: '完成迁移映射',
      description: '所有旧实例必须各有且仅有一个去向，才能允许后续页面迁移。',
      checks: [
        '未决定数量降为 0',
        '每个旧实例只对应一个 Target、页面模块、业务例外或删除结果',
        '从目标结果可以反查覆盖的旧实例',
      ],
    },
    complete: {
      title: '验收流程已完成',
      description: '合同、实现、真实运行和迁移映射均已留下可追踪证据。',
      checks: ['保持导出的 Decision Store JSON 作为可移交记录'],
    },
  };

  const outcomeLabels = {
    'target-component': '目标 ic-* 组件',
    'page-module': '页面模块',
    'business-exception': '业务例外',
    remove: '删除',
  };

  function setStatus(message, tone = '') {
    if (!surfaceStatus) return;
    surfaceStatus.textContent = message;
    surfaceStatus.dataset.tone = tone;
  }

  function switchSurface(name) {
    document.body.dataset.activeSurface = name;
    for (const tab of tabs) {
      const active = tab.dataset.surfaceTab === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    for (const panel of panels) panel.hidden = panel.dataset.surfacePanel !== name;
    if (legacySidebarToggle) legacySidebarToggle.hidden = name !== 'legacy';
  }

  function targetGroupForReview(name) {
    return targetReviewTabs.find(tab => tab.dataset.targetReview === name)?.dataset.targetReviewGroup || 'families';
  }

  function targetReviewFromHash() {
    try {
      const name = decodeURIComponent(window.location.hash.slice(1));
      return targetReviewNames.has(name) ? name : '';
    } catch (_) {
      return '';
    }
  }

  function updateTargetReviewHistory(name, mode = 'push') {
    if (!targetReviewNames.has(name)) return;
    const nextHash = `#${encodeURIComponent(name)}`;
    if (window.location.hash === nextHash) return;
    window.history[mode === 'replace' ? 'replaceState' : 'pushState'](null, '', nextHash);
  }

  function setActiveTargetGroup(group) {
    for (const section of targetReviewGroups) {
      section.toggleAttribute('data-child-current', section.dataset.targetReviewGroup === group);
    }
  }

  function updateTargetReviewChrome(name) {
    if (targetReviewTitle) targetReviewTitle.textContent = targetReviewLabels[name] || '组件预览';
    setActiveTargetGroup(targetGroupForReview(name));
  }

  function syncTargetMatrixReadiness(previewDocument, name, result) {
    const existingObserver = targetMatrixReadinessObservers.get(previewDocument);
    if (result?.matrices > 0) {
      existingObserver?.disconnect();
      targetMatrixReadinessObservers.delete(previewDocument);
      return;
    }
    if (existingObserver || !previewDocument.body || !previewDocument.defaultView?.MutationObserver) return;
    let pending = false;
    const observer = new previewDocument.defaultView.MutationObserver(() => {
      if (pending || document.body.dataset.activeReview !== name) return;
      pending = true;
      previewDocument.defaultView.requestAnimationFrame(() => {
        pending = false;
        applyTargetMatrix(previewDocument, name);
      });
    });
    observer.observe(previewDocument.body, { childList: true, subtree: true });
    targetMatrixReadinessObservers.set(previewDocument, observer);
  }

  function applyTargetMatrix(previewDocument, name = document.body.dataset.activeReview) {
    if (!previewDocument?.documentElement || NON_COMPONENT_REVIEWS.has(name) || !matrixPresentation) return null;
    const result = matrixPresentation.apply(previewDocument);
    syncTargetMatrixReadiness(previewDocument, name, result);
    return result;
  }

  function syncTargetThemeControl() {
    const dark = targetTheme === 'dark';
    document.documentElement.dataset.uiTheme = targetTheme;
    document.documentElement.classList.toggle('theme-dark', dark);
    targetThemeToggle?.setAttribute('aria-pressed', dark ? 'true' : 'false');
    targetThemeToggle?.setAttribute('aria-label', dark ? '切换明亮' : '切换深色');
    if (targetThemeIcon) targetThemeIcon.textContent = dark ? '☀' : '☾';
    if (targetThemeLabel) targetThemeLabel.textContent = dark ? '切换明亮' : '切换深色';
  }

  function prepareTargetPreviewDocument(previewDocument) {
    if (!previewDocument?.documentElement) return;
    const root = previewDocument.documentElement;
    root.dataset.uiTheme = targetTheme;
    root.dataset.uiLibraryLayout = 'compact';
    root.classList.toggle('theme-dark', targetTheme === 'dark');
    if (!previewDocument.querySelector('link[data-ui-library-preview-style]')) {
      const stylesheet = previewDocument.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = '/static/css/ui-component-library-preview.css?v=2026.08.27.feedback-progress-surface.1';
      stylesheet.dataset.uiLibraryPreviewStyle = 'true';
      previewDocument.head?.append(stylesheet);
    }
    for (const nestedFrame of previewDocument.querySelectorAll('iframe')) {
      if (!nestedFrame.dataset.uiLibraryThemeBound) {
        nestedFrame.dataset.uiLibraryThemeBound = 'true';
        nestedFrame.addEventListener('load', () => {
          try {
            prepareTargetPreviewDocument(nestedFrame.contentDocument);
          } catch (_) {
            // Theme propagation only targets same-origin component previews.
          }
        });
      }
      try {
        prepareTargetPreviewDocument(nestedFrame.contentDocument);
      } catch (_) {
        // Keep unavailable or non-same-origin fixtures unchanged.
      }
    }
    applyTargetMatrix(previewDocument);
  }

  function applyTargetTheme(theme) {
    targetTheme = theme === 'dark' ? 'dark' : 'light';
    syncTargetThemeControl();
    for (const frame of targetReviewFrames) {
      if (!frame.hasAttribute('src')) continue;
      try {
        prepareTargetPreviewDocument(frame.contentDocument);
      } catch (_) {
        // Loaded review frames are same-origin; lazy frames receive the theme on load.
      }
    }
  }

  function switchTargetReview(name) {
    document.body.dataset.activeReview = name;
    updateTargetReviewChrome(name);
    const showComposer = name === 'composer';
    const showPromptTemplateLibrary = name === 'prompt-template-library';
    const showSearchNavigationSidebar = name === 'search-navigation-sidebar';
    const showImageEditing = name === 'image-editing';
    const showImageEditModeToolbar = name === 'image-edit-mode-toolbar';
    const showSmartNodeToolbar = name === 'smart-node-toolbar';
    const showSmartNodeContextMenu = name === 'smart-node-context-menu';
    const showSmartCanvasDock = name === 'smart-canvas-dock';
    const showSmartMinimap = name === 'smart-minimap';
    const showFileMediaInput = name === 'file-media-input';
    const showContainersData = name === 'containers-data';
    const showDialog = name === 'dialog';
    const showMenuPopover = name === 'menu-popover';
    const showNavigationCommand = name === 'navigation-command';
    const showFeedbackProgress = name === 'feedback-progress';
    const showNodes = name === 'nodes';
    const showEmptyStates = name === 'empty-states';
    const showGenerationFailureFeedback = name === 'generation-failure-feedback';
    const showSelectionAdjustment = name === 'selection-adjustment';
    const showHeading = name === 'heading';
    const showTextEntry = name === 'text-entry';
    const showActions = name === 'actions';
    const showDesignTokens = name === 'design-tokens';
    const showFoundations = name === 'foundations';
    const showScrollbar = name === 'scrollbar';
    const showPendingMotionReference = name === 'pending-motion-reference';
    const showPendingHalftoneReference = name === 'pending-halftone-reference';
    const showPendingPerformancePrototype = name === 'pending-performance-prototype';
    const showClickSparkReference = name === 'click-spark-reference';
    if (composerMatrix) composerMatrix.hidden = !showComposer;
    if (promptTemplateLibraryMatrix) promptTemplateLibraryMatrix.hidden = !showPromptTemplateLibrary;
    if (searchNavigationSidebarMatrix) searchNavigationSidebarMatrix.hidden = !showSearchNavigationSidebar;
    if (imageEditingMatrix) imageEditingMatrix.hidden = !showImageEditing;
    if (imageEditModeToolbarMatrix) imageEditModeToolbarMatrix.hidden = !showImageEditModeToolbar;
    if (smartNodeToolbarMatrix) smartNodeToolbarMatrix.hidden = !showSmartNodeToolbar;
    if (smartNodeContextMenuMatrix) smartNodeContextMenuMatrix.hidden = !showSmartNodeContextMenu;
    if (smartCanvasDockMatrix) smartCanvasDockMatrix.hidden = !showSmartCanvasDock;
    if (smartMinimapMatrix) smartMinimapMatrix.hidden = !showSmartMinimap;
    if (dialogMatrix) dialogMatrix.hidden = !showDialog;
    if (menuPopoverMatrix) menuPopoverMatrix.hidden = !showMenuPopover;
    if (navigationCommandMatrix) navigationCommandMatrix.hidden = !showNavigationCommand;
    if (containersDataMatrix) containersDataMatrix.hidden = !showContainersData;
    if (fileMediaInputMatrix) fileMediaInputMatrix.hidden = !showFileMediaInput;
    if (feedbackProgressMatrix) feedbackProgressMatrix.hidden = !showFeedbackProgress;
    if (nodesMatrix) nodesMatrix.hidden = !showNodes;
    if (emptyStatesMatrix) emptyStatesMatrix.hidden = !showEmptyStates;
    if (generationFailureFeedbackMatrix) generationFailureFeedbackMatrix.hidden = !showGenerationFailureFeedback;
    if (selectionAdjustmentMatrix) selectionAdjustmentMatrix.hidden = !showSelectionAdjustment;
    if (headingMatrix) headingMatrix.hidden = !showHeading;
    if (actionsMatrix) actionsMatrix.hidden = !showActions;
    if (textEntryMatrix) textEntryMatrix.hidden = !showTextEntry;
    if (designTokensExplorer) designTokensExplorer.hidden = !showDesignTokens;
    if (foundationsMatrix) foundationsMatrix.hidden = !showFoundations;
    if (scrollbarMatrix) scrollbarMatrix.hidden = !showScrollbar;
    if (pendingMotionReference) pendingMotionReference.hidden = !showPendingMotionReference;
    if (pendingHalftoneReference) pendingHalftoneReference.hidden = !showPendingHalftoneReference;
    if (pendingPerformancePrototype) pendingPerformancePrototype.hidden = !showPendingPerformancePrototype;
    if (clickSparkReference) clickSparkReference.hidden = !showClickSparkReference;
    if (componentTracer) componentTracer.hidden = name !== 'components';
    const showStandalonePreview = [
      showComposer,
      showPromptTemplateLibrary,
      showSearchNavigationSidebar,
      showImageEditing,
      showImageEditModeToolbar,
      showSmartNodeToolbar,
      showSmartNodeContextMenu,
      showSmartCanvasDock,
      showSmartMinimap,
      showFileMediaInput,
      showContainersData,
      showDialog,
      showMenuPopover,
      showNavigationCommand,
      showFeedbackProgress,
      showNodes,
      showEmptyStates,
      showGenerationFailureFeedback,
      showSelectionAdjustment,
      showHeading,
      showTextEntry,
      showActions,
      showDesignTokens,
      showFoundations,
      showScrollbar,
      showPendingMotionReference,
      showPendingHalftoneReference,
      showPendingPerformancePrototype,
      showClickSparkReference,
    ].some(Boolean);
    if (acceptanceReview) acceptanceReview.hidden = showStandalonePreview;
    targetSurfaceGrid?.classList.toggle('actions-contract-mode', showStandalonePreview);
    for (const item of targetReviewTabs) {
      const active = item.dataset.targetReview === name;
      if (active) item.setAttribute('current', 'page');
      else item.removeAttribute('current');
    }
    const visibleFrame = targetReviewFrames.find(frame => !frame.hidden);
    if (visibleFrame && loadTargetFrame(visibleFrame)) {
      requestAnimationFrame(() => fitTargetFrame(visibleFrame));
    }
  }

  function loadTargetFrame(frame) {
    if (frame.hasAttribute('src')) return true;
    const source = frame.dataset.src;
    if (!source) return false;
    frame.src = source;
    return false;
  }

  function resetTargetReviewScroll() {
    if (!targetSurfaceGrid) return;
    const top = Math.max(
      0,
      targetSurfaceGrid.getBoundingClientRect().top + window.scrollY,
    );
    window.scrollTo({ top, left: 0, behavior: 'auto' });
  }

  function fitTargetFrame(frame) {
    if (!frame || frame.hidden) return;
    if (frame.matches('[data-design-tokens-explorer]')) {
      frame.style.height = '100vh';
      return;
    }
    if (frame.matches('[data-dialog-matrix]')) {
      try {
        const previewDocument = frame.contentDocument;
        if (previewDocument?.documentElement) {
          prepareTargetPreviewDocument(previewDocument);
          fitNestedFrames(previewDocument);
        }
      } catch (_) {
        // The Dialog review is same-origin; keep the viewport fallback if unavailable.
      }
      frame.style.height = 'calc(100dvh - var(--ui-space-16))';
      frame.style.minHeight = '0';
      return;
    }
    try {
      const document = frame.contentDocument;
      if (!document?.documentElement) return;
      prepareTargetPreviewDocument(document);
      fitNestedFrames(document);
      const update = () => {
        if (frame.hidden) return;
        const height = Math.max(
          720,
          document.documentElement.scrollHeight,
          document.body?.scrollHeight || 0,
        );
        frame.style.height = `${height}px`;
      };
      update();
      if (!targetFrameObservers.has(frame) && typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(update);
        observer.observe(document.documentElement);
        if (document.body) observer.observe(document.body);
        targetFrameObservers.set(frame, observer);
      }
    } catch (_) {
      // Formal review frames are same-origin; keep the CSS fallback if unavailable.
    }
  }

  function fitNestedFrame(frame) {
    frame.setAttribute('scrolling', 'no');
    try {
      const document = frame.contentDocument;
      if (!document?.documentElement) return;
      prepareTargetPreviewDocument(document);
      keepNestedDialogVisible(frame, document);
      const update = () => {
        const height = Math.max(
          document.documentElement.scrollHeight,
          document.body?.scrollHeight || 0,
        );
        const frameChrome = Math.max(0, frame.offsetHeight - frame.clientHeight);
        if (height > 0) frame.style.height = `${height + frameChrome}px`;
      };
      update();
      if (!nestedFrameObservers.has(frame) && typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(update);
        observer.observe(document.documentElement);
        if (document.body) observer.observe(document.body);
        nestedFrameObservers.set(frame, observer);
      }
    } catch (_) {
      // Keep the source-defined height for an unavailable or non-same-origin fixture.
    }
  }

  function keepNestedDialogVisible(frame, document) {
    if (dialogVisibilityDocuments.has(document)) return;
    dialogVisibilityDocuments.add(document);
    document.addEventListener('ic-after-show', event => {
      const nativeDialog = event.target?.shadowRoot?.querySelector('dialog');
      const outerFrame = frame.ownerDocument?.defaultView?.frameElement;
      const topWindow = outerFrame?.ownerDocument?.defaultView;
      if (!nativeDialog || !outerFrame || !topWindow) return;
      requestAnimationFrame(() => {
        const dialogRect = nativeDialog.getBoundingClientRect();
        const dialogTop = outerFrame.getBoundingClientRect().top
          + frame.getBoundingClientRect().top
          + dialogRect.top;
        const centeredTop = Math.max(16, (topWindow.innerHeight - dialogRect.height) / 2);
        topWindow.scrollBy({ top: dialogTop - centeredTop, behavior: 'smooth' });
      });
    });
  }

  function fitNestedFrames(document) {
    for (const frame of document.querySelectorAll('iframe')) {
      if (!frame.dataset.fitWithoutScroll) {
        frame.dataset.fitWithoutScroll = 'true';
        frame.addEventListener('load', () => fitNestedFrame(frame));
      }
      fitNestedFrame(frame);
    }
  }

  syncTargetThemeControl();
  for (const frame of targetReviewFrames) {
    const usesIndependentScroll = frame.matches('[data-design-tokens-explorer], [data-dialog-matrix]');
    frame.setAttribute('allow', 'clipboard-write');
    frame.setAttribute('scrolling', usesIndependentScroll ? 'yes' : 'no');
    frame.addEventListener('load', () => fitTargetFrame(frame));
  }

  function currentMapping(instanceId) {
    return pendingMappings.get(instanceId) || store.snapshot().mappings[instanceId] || null;
  }

  function renderTargetComponentSearch() {
    if (!targetReviewSearch || !targetComponentSearchResults) return;
    const query = targetReviewSearch.value.trim().toLocaleLowerCase();
    const matches = query
      ? targetComponents.filter(component => (
          `${component.name} ${component.tag} ${component.label} ${component.reviewLabel}`.toLocaleLowerCase().includes(query)
        ))
      : [];
    targetComponentSearchResults.hidden = !query;
    targetComponentSearchResults.innerHTML = matches.length
      ? matches.map(component => `
        <button type="button" data-target-component="${component.name}">
          <strong>${component.name}</strong>
          <small>${component.reviewLabel}</small>
        </button>`).join('')
      : query ? '<p class="target-component-search-empty">没有匹配的组件。</p>' : '';
    if (targetReviewSearchStatus) {
      targetReviewSearchStatus.textContent = query
        ? `找到 ${matches.length} 个组件`
        : `${targetComponents.length} 个组件可搜索`;
    }
  }

  function selectTargetReview(name, historyMode = 'push') {
    if (!targetReviewNames.has(name)) return;
    switchTargetReview(name);
    if (historyMode !== 'none') updateTargetReviewHistory(name, historyMode);
    requestAnimationFrame(resetTargetReviewScroll);
  }

  function componentOffsetInDocument(document, component, depth = 0) {
    if (!document?.documentElement || depth > 3) return null;
    const exactNameSelector = `[data-component-name="${component.name}"]`;
    const familyNameSelector = `[data-component-name="${component.tag}"], [data-component-name^="${component.tag}-"]`;
    let match = document.querySelector(exactNameSelector)
      || document.querySelector(familyNameSelector)
      || document.querySelector(component.tag);
    if (!match) {
      match = [...document.querySelectorAll('h1, h2, h3')].find(heading => {
        const text = heading.textContent.toLocaleLowerCase();
        return text.includes(component.tag) || text.includes(component.label.toLocaleLowerCase());
      });
    }
    if (match) {
      const anchor = match.closest('tr, section, article, [data-component-group]') || match;
      return anchor.getBoundingClientRect().top;
    }
    for (const frame of document.querySelectorAll('iframe')) {
      try {
        const childOffset = componentOffsetInDocument(frame.contentDocument, component, depth + 1);
        if (childOffset !== null) return frame.getBoundingClientRect().top + childOffset;
      } catch (_) {
        // Search only same-origin review frames that are ready.
      }
    }
    return null;
  }

  function jumpToTargetComponent(component, attempt = 0) {
    const visibleFrame = targetReviewFrames.find(item => !item.hidden);
    const previewDocument = visibleFrame?.contentDocument || document;
    let offset = null;
    try {
      offset = componentOffsetInDocument(previewDocument, component);
    } catch (_) {
      offset = null;
    }
    if (offset === null && attempt < 20) {
      window.setTimeout(() => jumpToTargetComponent(component, attempt + 1), 120);
      return;
    }
    const previewTop = visibleFrame?.getBoundingClientRect().top || 0;
    const top = previewTop + window.scrollY + Math.max(0, offset || 0) - 80;
    window.scrollTo({ top: Math.max(0, top), left: 0, behavior: 'smooth' });
    if (targetReviewSearchStatus) {
      targetReviewSearchStatus.textContent = `已打开 ${component.tag} · ${component.reviewLabel}`;
    }
  }

  function openTargetComponent(tag) {
    const component = targetComponents.find(item => item.name === tag);
    if (!component) return;
    selectTargetReview(component.review);
    requestAnimationFrame(() => jumpToTargetComponent(component));
    targetReviewSearch.value = component.name;
    targetComponentSearchResults.hidden = true;
  }

  function setTargetSearchOpen(open) {
    if (!targetReviewSearchPanel || !targetReviewSearchTrigger) return;
    targetReviewSearchPanel.hidden = !open;
    targetReviewSearchTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    targetReviewSearchTrigger.classList.toggle('active', open);
    if (open) {
      requestAnimationFrame(() => targetReviewSearch?.focus());
    } else {
      if (targetReviewSearch) targetReviewSearch.value = '';
      renderTargetComponentSearch();
    }
  }

  for (const item of targetReviewTabs) {
    item.addEventListener('click', event => {
      event.preventDefault();
      selectTargetReview(item.dataset.targetReview);
    });
  }
  window.addEventListener('popstate', () => {
    const name = targetReviewFromHash();
    if (name) selectTargetReview(name, 'none');
  });
  targetReviewSearchTrigger?.addEventListener('click', () => {
    setTargetSearchOpen(targetReviewSearchTrigger.getAttribute('aria-expanded') !== 'true');
  });
  targetThemeToggle?.addEventListener('click', () => {
    applyTargetTheme(targetTheme === 'dark' ? 'light' : 'dark');
  });
  targetReviewSearch?.addEventListener('input', renderTargetComponentSearch);
  targetReviewSearch?.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      setTargetSearchOpen(false);
      targetReviewSearchTrigger?.focus();
      return;
    }
    if (event.key !== 'Enter') return;
    const firstMatch = targetComponentSearchResults?.querySelector('[data-target-component]');
    if (!firstMatch) return;
    event.preventDefault();
    openTargetComponent(firstMatch.dataset.targetComponent);
  });
  targetComponentSearchResults?.addEventListener('click', event => {
    const result = event.target.closest('[data-target-component]');
    if (result) openTargetComponent(result.dataset.targetComponent);
  });
  renderTargetComponentSearch();

  function renderLifecycle() {
    const document = store.snapshot();
    const states = surfaceManifest.lifecycle.states;
    const statusIndex = states.indexOf(document.status);
    const assessment = store.assessment();
    const summary = store.migrationSummary();
    const nextStatus = states[statusIndex + 1] || '';
    const task = lifecycleTasks[nextStatus || 'complete'];
    const implementationNote = surfaceManifest.surfaces.target.implementationAvailable
      && document.status === 'draft'
      ? '<p class="lifecycle-note">实现已经存在，但不会绕过第一次人工确认。</p>'
      : '';

    lifecycleHost.innerHTML = `
      <div class="acceptance-task">
        <span class="acceptance-task-count">当前阶段 ${statusIndex + 1}/${states.length} · ${escapeHtml(lifecycleLabels[document.status][0])}</span>
        <div class="lifecycle-heading">
          <h3>${escapeHtml(task.title)}</h3>
          <p>${escapeHtml(task.description)}</p>
        </div>
        ${assessment.stale ? `<div class="lifecycle-stale"><strong>当前确认已过期（stale）</strong><br>${escapeHtml(assessment.reasons.join('；'))}</div>` : ''}
        <ul class="acceptance-checklist">${task.checks.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        ${implementationNote}
        ${nextStatus === 'migration_ready' ? `<p class="lifecycle-note">Migration Map：${summary.resolved}/${summary.total} 已决定，${summary.unresolved} 项未决。</p>` : ''}
        ${nextStatus && !assessment.stale ? lifecycleForm(nextStatus, summary) : ''}
        ${!nextStatus ? '<p class="lifecycle-note"><strong>当前已到 migration_ready。</strong></p>' : ''}
      </div>
      <details class="lifecycle-details">
        <summary>查看完整五阶段流程 <span>当前：${escapeHtml(lifecycleLabels[document.status][0])}</span></summary>
        <ol class="lifecycle-steps">${states.map((state, index) => `
          <li class="lifecycle-step${index < statusIndex ? ' complete' : ''}${index === statusIndex ? ' current' : ''}">
            <b>${index < statusIndex ? '✓' : index + 1}</b>
            <div><strong>${escapeHtml(lifecycleLabels[state][0])}</strong><span>${escapeHtml(lifecycleLabels[state][1])}</span></div>
          </li>`).join('')}</ol>
      </details>`;

    lifecycleHost.querySelector('[data-lifecycle-form]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        const evidence = nextStatus === 'implemented'
          ? { evidence: form.querySelector('[name="evidence"]').value }
          : nextStatus === 'migration_ready'
            ? {}
            : {
                human: true,
                reviewer: form.querySelector('[name="reviewer"]').value,
                note: form.querySelector('[name="note"]').value,
              };
        store.transition(nextStatus, evidence);
        store.save();
        renderLifecycle();
        renderMigrationSummary();
        setStatus(`合同状态已更新为 ${lifecycleLabels[nextStatus][0]}`);
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });
  }

  function lifecycleForm(nextStatus, summary) {
    if (nextStatus === 'implemented') {
      return `
        <form class="lifecycle-form" data-lifecycle-form>
          <label>实现证据<input name="evidence" value="ic-core-v1 + Target tracer" required></label>
          <button type="submit">记录已实现</button>
        </form>`;
    }
    if (nextStatus === 'migration_ready') {
      return `
        <form class="lifecycle-form" data-lifecycle-form>
          <p class="lifecycle-note">只有 ${summary.total} 个旧实例全部有且仅有一个去向时才能进入可迁移。</p>
          <button type="submit"${summary.unresolved ? ' disabled' : ''}>允许进入页面迁移</button>
        </form>`;
    }
    const label = nextStatus === 'contract_confirmed' ? '合同人工确认' : '真实运行人工确认';
    return `
      <form class="lifecycle-form" data-lifecycle-form>
        <label>人工确认人<input name="reviewer" autocomplete="name" required></label>
        <label>确认说明<textarea name="note" required placeholder="记录已亲自检查的内容"></textarea></label>
        <button type="submit">记录${label}</button>
      </form>`;
  }

  function renderMigrationSummary() {
    const summary = store.migrationSummary();
    const migrated = Number(semanticBaseline.coverage?.migratedInstanceCount || 0);
    const classificationStatus = semanticBaseline.review?.status === 'pending-human-confirmation'
      ? '语义分类待人工确认'
      : `语义分类 ${semanticBaseline.review?.status || '未知'}`;
    migrationSummaryHost.textContent = [
      classificationStatus,
      `共 ${summary.total} 个 Legacy 实例`,
      `已决定 ${summary.resolved}`,
      `未决定 ${summary.unresolved}`,
      `已迁移 ${migrated}`,
      ...Object.entries(summary.outcomes).map(([id, count]) => `${outcomeLabels[id]} ${count}`),
    ].join(' · ');
  }

  function searchable(instance) {
    return [
      instance.label,
      instance.candidateId,
      instance.suggestedTargetId,
      instance.classification?.layer,
      instance.classification?.rationale,
      instance.migrationStatus,
      instance.migrationId,
      instance.migratedTo,
      instance.replacement,
      ...Object.values(instance.evidence || {}),
    ].join(' ').toLocaleLowerCase();
  }

  function migrationCard(instance) {
    const mapping = currentMapping(instance.id);
    const classification = instance.classification || {};
    const outcomes = surfaceManifest.surfaces.migration.outcomes;
    const card = document.createElement('article');
    card.className = 'migration-card';
    card.dataset.legacyInstanceId = instance.id;
    card.dataset.migrationStatus = instance.migrationStatus;
    card.innerHTML = `
      <div>
        <h3>${escapeHtml(instance.label)}${instance.migrationStatus === 'migrated' ? '<span class="migration-status">已迁移</span>' : ''}</h3>
        <p>${escapeHtml(instance.evidence.scenario || '尚无场景说明')}</p>
        <p class="migration-rationale"><strong>${escapeHtml(classification.layer || '未分类')}</strong> · ${escapeHtml(classification.rationale || '尚无语义分类理由')}</p>
        <div class="migration-evidence">
          <span>${escapeHtml(instance.evidence.surface || '未分类页面')} · ${escapeHtml(instance.evidence.source)}</span>
          <span>${escapeHtml(instance.evidence.file)}:${escapeHtml(instance.evidence.line)} · ${escapeHtml(instance.evidence.domPath)}</span>
          <span>Legacy ID · ${escapeHtml(instance.id)}</span>
        </div>
      </div>
      ${instance.migrationStatus === 'migrated' ? `
      <div class="migration-complete">
        <strong>${escapeHtml(instance.migratedTo)}</strong>
        <span>${escapeHtml(instance.replacement)}</span>
        <small>${escapeHtml(instance.migrationId)} · ${instance.visualAcceptance === 'confirmed' ? '实现与人工视觉验收均已完成' : '实现完成，待页面人工视觉验收'}</small>
      </div>` : `<div class="migration-fields">
        <label>最终去向
          <select data-mapping-outcome>
            <option value="">尚未决定</option>
            ${outcomes.map((outcome) => `<option value="${escapeHtml(outcome.id)}"${mapping?.outcome === outcome.id ? ' selected' : ''}>${escapeHtml(outcome.label)}</option>`).join('')}
          </select>
        </label>
        ${referenceField(mapping)}
      </div>`}`;
    return card;
  }

  function referenceField(mapping) {
    if (!mapping || mapping.outcome === 'remove') return '';
    if (mapping.outcome === 'target-component') {
      return `
        <label>目标组件
          <select data-mapping-reference>
            <option value="">选择 ic-* 组件</option>
            ${surfaceManifest.surfaces.migration.targetComponentIds.map((id) => `<option value="${escapeHtml(id)}"${mapping.reference === id ? ' selected' : ''}>${escapeHtml(id)}</option>`).join('')}
          </select>
        </label>`;
    }
    return `
      <label>${mapping.outcome === 'page-module' ? '页面模块' : '例外说明'}
        <input data-mapping-reference value="${escapeHtml(mapping.reference || '')}" placeholder="填写可追踪名称">
      </label>`;
  }

  function renderMigrationMap() {
    const query = migrationSearch.value.trim().toLocaleLowerCase();
    const filtered = query
      ? store.instances().filter((instance) => searchable(instance).includes(query))
      : store.instances();
    const pageSize = 30;
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    page = Math.max(0, Math.min(page, pages - 1));
    const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);
    migrationList.innerHTML = '';
    visible.forEach((instance) => migrationList.appendChild(migrationCard(instance)));
    if (!visible.length) migrationList.innerHTML = '<div class="empty-category">没有匹配的旧实例。</div>';
    migrationPage.textContent = `${page + 1} / ${pages}`;
    migrationPrevious.disabled = page === 0;
    migrationNext.disabled = page >= pages - 1;
    renderMigrationSummary();
    renderReverseMappings();
  }

  function renderReverseMappings() {
    const groups = store.reverseMappings();
    const instances = new Map(store.instances().map((instance) => [instance.id, instance]));
    const entries = Object.entries(groups);
    migrationReverse.innerHTML = `
      <h3>目标反向覆盖</h3>
      ${entries.length ? entries.map(([key, instanceIds]) => `
        <div class="reverse-group">
          <strong>${escapeHtml(key)}</strong>
          <span>${instanceIds.length} 个旧实例 · ${escapeHtml(instanceIds.slice(0, 3).map((id) => instances.get(id)?.label || id).join('、'))}${instanceIds.length > 3 ? '…' : ''}</span>
        </div>`).join('') : '<p class="panel-placeholder">完成映射后，可以从目标组件、页面模块、业务例外或删除结果反查旧实例。</p>'}`;
  }

  function persistMapping(instanceId, mapping) {
    try {
      store.setMapping(instanceId, mapping);
      pendingMappings.delete(instanceId);
      store.save();
      renderMigrationMap();
      renderLifecycle();
    } catch (error) {
      setStatus(error.message, 'error');
    }
  }

  function download(raw) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    link.download = 'infinite-canvas-ui-component-surfaces-v1.json';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function bindInteractions() {
    tabs.forEach((tab) => tab.addEventListener('click', () => switchSurface(tab.dataset.surfaceTab)));
    migrationSearch.addEventListener('input', () => { page = 0; renderMigrationMap(); });
    migrationPrevious.addEventListener('click', () => { page -= 1; renderMigrationMap(); });
    migrationNext.addEventListener('click', () => { page += 1; renderMigrationMap(); });
    migrationList.addEventListener('change', (event) => {
      const card = event.target.closest('[data-legacy-instance-id]');
      if (!card) return;
      const instanceId = card.dataset.legacyInstanceId;
      if (event.target.matches('[data-mapping-outcome]')) {
        const outcome = event.target.value;
        if (!outcome) {
          pendingMappings.delete(instanceId);
          if (store.snapshot().mappings[instanceId]) store.clearMapping(instanceId);
          store.save();
          renderMigrationMap();
          renderLifecycle();
          return;
        }
        if (outcome === 'remove') return persistMapping(instanceId, { outcome });
        pendingMappings.set(instanceId, { outcome, reference: '' });
        renderMigrationMap();
        return;
      }
      if (event.target.matches('[data-mapping-reference]')) {
        const pending = currentMapping(instanceId);
        const reference = event.target.value.trim();
        if (pending && reference) persistMapping(instanceId, { outcome: pending.outcome, reference });
      }
    });
    migrationList.addEventListener('input', (event) => {
      if (!event.target.matches('input[data-mapping-reference]')) return;
      const card = event.target.closest('[data-legacy-instance-id]');
      const pending = currentMapping(card.dataset.legacyInstanceId);
      pendingMappings.set(card.dataset.legacyInstanceId, {
        outcome: pending.outcome,
        reference: event.target.value,
      });
    });
    document.querySelector('[data-surface-save]').addEventListener('click', () => {
      setStatus(store.save() ? '组件界面草稿已保存' : '浏览器存储不可用，请导出 JSON', store.storageAvailable() ? '' : 'error');
    });
    document.querySelector('[data-surface-export]').addEventListener('click', () => download(store.exportJson()));
    const importInput = document.querySelector('[data-surface-import-file]');
    document.querySelector('[data-surface-import]').addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async () => {
      const file = importInput.files?.[0];
      if (!file) return;
      try {
        const raw = await file.text();
        if (!window.confirm('导入将替换当前组件界面草稿，是否继续？')) return;
        store.importJson(raw);
        store.save();
        pendingMappings.clear();
        renderLifecycle();
        renderMigrationMap();
        setStatus('组件界面决策文件已导入');
      } catch (error) {
        setStatus(`导入失败：${error.message}`, 'error');
      } finally {
        importInput.value = '';
      }
    });
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error(`${url} · HTTP ${response.status}`);
    return response.json();
  }

  async function boot() {
    try {
      [surfaceManifest, legacyManifest, semanticBaseline] = await Promise.all([
        fetchJson(SURFACE_MANIFEST_URL),
        fetchJson(LEGACY_MANIFEST_URL),
        fetchJson(SEMANTIC_BASELINE_URL),
      ]);
      if (surfaceManifest.schemaVersion !== model.SCHEMA_VERSION) {
        throw new Error('Surface Manifest Schema 不受支持');
      }
      store = window.InfiniteCanvasUiSurfaceModel.createStore({
        surfaceManifest,
        legacyManifest,
        semanticBaseline,
        storage: window.localStorage,
      });
      bindInteractions();
      renderLifecycle();
      renderMigrationMap();
      switchSurface('target');
      const initialReview = targetReviewFromHash() || 'actions';
      switchTargetReview(initialReview);
      updateTargetReviewHistory(initialReview, 'replace');
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      setStatus(`语义基线已载入 · ${store.instances().length} 个旧实例 · 待人工确认`);
    } catch (error) {
      setStatus(`语义基线无法载入：${error.message}`, 'error');
      lifecycleHost.innerHTML = `<section class="blocking-state" role="alert"><h2>语义基线无法载入</h2><p>${escapeHtml(error.message)}</p></section>`;
    }
  }

  boot();
})();
