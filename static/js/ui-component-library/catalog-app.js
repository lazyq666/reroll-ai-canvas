(() => {
  const MANIFEST_URL = '/static/design-system/live-catalog/manifest.json';
  const SANDBOX_URL = '/static/design-system/live-catalog/sandbox.html?v=2026.08.07.3';
  const protocol = window.UiComponentSandboxProtocol;
  const decisionApi = window.UiComponentDecisionStore;
  const categoryList = document.querySelector('[data-category-list]');
  const candidateRegion = document.querySelector('[data-candidate-region]');
  const decisionContent = document.querySelector('[data-decision-content]');
  const draftStatus = document.querySelector('[data-draft-status]');
  const targetStatus = document.querySelector('[data-target-status]');
  const sidebar = document.querySelector('[data-catalog-sidebar]');
  const backdrop = document.querySelector('[data-sidebar-backdrop]');
  const toggle = document.querySelector('[data-sidebar-toggle]');
  const frameCandidates = new Map();
  let manifest = null;
  let store = null;
  let selectedCategoryId = '';
  let selectedTargetId = '';

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const stateLabels = {
    light: '浅色',
    dark: '深色',
    default: '默认',
    hover: '悬停',
    pressed: '按下',
    'focus-visible': '键盘焦点',
    disabled: '禁用',
    loading: '加载',
    empty: '空值',
    filled: '已填写',
    readonly: '只读',
    error: '错误',
    success: '成功',
    selected: '已选',
    partial: '部分选中',
    open: '展开',
    closed: '关闭',
    replay: '重播',
    enter: '进入',
    exit: '退出',
  };

  function stateLabel(value) {
    return stateLabels[value] || value;
  }

  const contentFormLabels = {
    'icon-stacked': '带图标 · 上下布局',
    'icon-inline': '带图标 · 左右布局',
    'text-only': '纯文字按钮',
    'icon-only': '纯图标按钮',
  };

  const sizeLabels = {
    large: 'L',
    normal: 'M',
    small: 'S',
    default: '默认',
  };

  function contentFormLabel(value) {
    return contentFormLabels[value] || value || '默认形态';
  }

  function sizeLabel(value) {
    return sizeLabels[value] || value;
  }

  function trustLabel(value) {
    return {
      'verified-live': '已核验',
      stale: '需复核',
      'fixture-failed': '预览失败',
    }[value] || value;
  }

  const componentRoleLabels = {
    Button: '按钮',
    'Lucide Icon': '图标',
    'Inline SVG': 'SVG 图形',
    'Graphic Asset': '图形资源',
    Input: '输入框',
    Textarea: '多行输入框',
    Select: '选择器',
    Checkbox: '复选框',
    Switch: '开关',
    Slider: '滑块',
    'File Upload': '文件上传',
    Card: '卡片',
    Badge: '标记',
    Alert: '提示',
    Toast: '消息提示',
    'Loading / Progress': '加载与进度',
    Tabs: '标签页',
    Menu: '菜单',
    Toolbar: '工具栏',
    Dialog: '弹窗',
    'Confirmation Dialog': '确认弹窗',
    Popover: '浮层',
    Tooltip: '文字提示',
    Divider: '分隔线',
  };

  const settingsSurfaces = new Set([
    '数据存储位置',
    '账号管理',
    'UI 组件库',
    'API 设置',
    '可用模型管理',
    '工作流设置',
  ]);
  const legacySurfaceAliases = new Map([
    ['ComfyUI 设置', '工作流设置'],
    ['模型管理', '可用模型管理'],
  ]);
  const moduleAliases = [
    [/jimengCliPanel|jimeng-actions/i, '即梦 CLI 模块'],
    [/geminiCliPanel|gemini-actions/i, 'Gemini CLI 模块'],
    [/modelPickerOverlay|model-picker/i, '模型选择弹窗'],
    [/apiTransferOverlay|api-transfer/i, 'API 配置迁移弹窗'],
    [/rhWorkflowEditorOverlay|rh-workflow-editor/i, 'RunningHub 工作流编辑弹窗'],
    [/runninghubConfigBlock|runninghub|rh-/i, 'RunningHub 工作流模块'],
    [/prompt-template/i, '提示词模板模块'],
    [/composer/i, 'Composer 输入区'],
    [/canvas-card/i, '画布卡片'],
    [/batch-detail|batchDetail/i, '批量任务详情'],
    [/account/i, '账号模块'],
  ];
  const fileSurfaceAliases = [
    [/preferences/i, '数据存储位置'],
    [/ui-component-library/i, 'UI 组件库'],
    [/smart-canvas/i, '智能画布'],
    [/canvas-list/i, '画布管理'],
    [/api-settings/i, 'API 设置'],
    [/comfyui-settings/i, '工作流设置'],
    [/available-model-management/i, '可用模型管理'],
    [/account-management|account-ui/i, '账号管理'],
    [/batch-generation|online/i, '在线批量生成'],
    [/canvas(?:\.js|\.html)/i, '经典画布'],
  ];

  function primarySource(candidate) {
    return (candidate.sources || []).find((item) => {
      const label = item.display_text?.trim();
      return label && label !== '该控件' && label !== '演示控件';
    }) || candidate.sources?.[0] || null;
  }

  function candidateLabel(candidate) {
    const source = primarySource(candidate);
    if (!source) return candidate.label;
    return source.display_text || candidate.label;
  }

  function sourceSurface(source) {
    const file = source?.file || '';
    const fileSurface = fileSurfaceAliases.find(([pattern]) => pattern.test(file))?.[1];
    if (fileSurface) return fileSurface;
    const declaredSurface = source?.surface?.trim() || '';
    return legacySurfaceAliases.get(declaredSurface) || declaredSurface;
  }

  function sourceModule(source) {
    const context = `${source?.domPath || source?.dom_path || ''} ${source?.enclosing_function || ''}`;
    return moduleAliases.find(([pattern]) => pattern.test(context))?.[1] || '';
  }

  function componentPathLabel(candidate, source) {
    const label = source?.display_text?.trim() || candidateLabel(candidate);
    const role = componentRoleLabels[candidate.componentType] || '组件';
    if (!label) return role;
    if (label.endsWith(role) || label.includes(`/${role}`)) return label;
    return `${label}${role}`;
  }

  function pathSegmentKey(segment) {
    return segment.replace(/\s+/g, '').replace(/(?:模块|区域|输入区)$/, '');
  }

  function usagePath(candidate, source = null) {
    const surface = sourceSurface(source);
    const areaParts = (source?.area || '').split('>').map((part) => part.trim()).filter(Boolean);
    const module = sourceModule(source);
    const parts = [];
    if (settingsSurfaces.has(surface)) parts.push('设置');
    if (surface) parts.push(surface);
    if (candidate.componentType === 'Graphic Asset' && !surface) parts.push('设计资源', '图形资源');
    if (candidate.componentType === 'Inline SVG' && !surface) parts.push('设计资源', '页面内联图形');
    if (candidate.componentType === 'Lucide Icon' && !surface) parts.push('设计资源', 'Lucide 图标');
    const genericArea = areaParts.length === 1 && ['页面操作区', '设置'].includes(areaParts[0]);
    if (!genericArea) parts.push(...areaParts);
    if (module) {
      const matchingArea = parts.findIndex((part) => pathSegmentKey(part) === pathSegmentKey(module));
      if (matchingArea >= 0) parts[matchingArea] = module;
      else parts.push(module);
    }
    if (genericArea && !module) parts.push(areaParts[0]);
    if (!parts.length) parts.push('未分类来源');
    parts.push(componentPathLabel(candidate, source));
    return [...new Set(parts)].join(' → ');
  }

  function candidateUsagePaths(candidate) {
    const sources = candidate.sources?.length ? candidate.sources : [null];
    return [...new Set(sources.map((source) => usagePath(candidate, source)))];
  }

  function targetLabel(target) {
    if (!target?.id?.startsWith('button.')) return target?.label || '';
    return {
      danger: '危险按钮',
      icon: '图标按钮',
      link: '链接按钮',
      primary: '主要按钮',
      secondary: '次要按钮',
      toggle: '切换按钮',
    }[target.id.split('.')[1]] || target.label;
  }

  function setSidebarOpen(open) {
    sidebar?.classList.toggle('is-open', open);
    if (backdrop) backdrop.hidden = !open;
    toggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function setStatus(message, tone = '') {
    if (!draftStatus) return;
    draftStatus.textContent = message;
    draftStatus.dataset.tone = tone;
  }

  function updateDraftStatus(message = '') {
    if (!store) return;
    const draft = store.snapshot();
    const storageNote = store.storageAvailable() ? '' : ' · 自动保存不可用';
    setStatus(message || `草稿 ${draft.progress.complete}/${draft.progress.total} 槽 · ${draft.progress.percent}%${storageNote}`);
  }

  function candidatesForTarget(targetId, options = {}) {
    return (manifest?.candidates || []).filter((candidate) => {
      if (candidate.targetId !== targetId) return false;
      if (options.verified && candidate.trust !== 'verified-live') return false;
      return true;
    });
  }

  function candidatesForCategory(categoryId) {
    return (manifest?.candidates || []).filter((candidate) => candidate.categoryId === categoryId);
  }

  function renderCategories() {
    categoryList.innerHTML = '';
    for (const category of manifest.categories) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `category-button${category.id === selectedCategoryId ? ' active' : ''}`;
      button.innerHTML = `
        <span class="category-copy">
          <strong>${escapeHtml(category.label)}</strong>
          <small>未开始 ${category.counts.notStarted} · 进行中 ${category.counts.inProgress} · 已完成 ${category.counts.completed} · 已过期 ${category.counts.stale}</small>
        </span>
        <span class="category-count">${category.counts.total}</span>`;
      button.addEventListener('click', () => {
        selectedCategoryId = category.id;
        selectedTargetId = Object.values(manifest.targets).find((target) => target.categoryId === category.id)?.id || '';
        renderCategories();
        renderCandidates();
        renderDecisionPanel();
        setSidebarOpen(false);
      });
      categoryList.appendChild(button);
    }
  }

  function sourceEvidence(candidate) {
    const context = manifest?.contexts?.[candidate.fixture?.contextId] || {};
    const originalPage = context.sourceEntry?.endsWith('.html') ? `/${context.sourceEntry}` : '';
    return `
      <details class="source-evidence">
        <summary>源码与核验依据 · ${(candidate.sources || []).length} 处</summary>
        <dl class="source-evidence-meta">
          <div><dt>候选编号</dt><dd>${escapeHtml(candidate.id)}</dd></div>
          <div><dt>内容指纹</dt><dd>${escapeHtml(candidate.sourceHash)}</dd></div>
        </dl>
        <ul class="source-list">${(candidate.sources || []).map((source) => `
          <li><strong>${escapeHtml(usagePath(candidate, source))}</strong><small>${escapeHtml(source.file)}:${escapeHtml(source.line || '')} · ${escapeHtml(source.selector || source.domPath || '')}</small></li>`).join('')}</ul>
        ${originalPage ? `<a class="source-open" href="${escapeHtml(originalPage)}" target="_blank" rel="noopener">打开原页面核验</a>` : ''}
      </details>`;
  }

  function postFixtureState(iframe, state) {
    iframe.contentWindow?.postMessage(protocol.message('set-state', { state }), '*');
  }

  function previewStates(candidate) {
    const appearances = candidate.coverage?.componentStates?.length
      ? candidate.coverage.componentStates
      : ['light'];
    const interactions = candidate.coverage?.interactionStates?.length
      ? candidate.coverage.interactionStates
      : ['default'];
    const baseTheme = appearances.includes('light') ? 'light' : appearances[0];
    const baseInteraction = interactions.includes('default') ? 'default' : interactions[0];
    return [
      ...appearances.map((theme) => ({
        label: stateLabel(theme),
        kind: '外观',
        state: { theme, interaction: baseInteraction },
      })),
      ...interactions.filter((interaction) => interaction !== baseInteraction).map((interaction) => ({
        label: stateLabel(interaction),
        kind: '交互',
        state: { theme: baseTheme, interaction },
      })),
    ];
  }

  function fixturePreview(candidate, preview) {
    const figure = document.createElement('figure');
    figure.className = 'fixture-preview';
    figure.setAttribute('data-fixture-state-preview', '');
    figure.dataset.theme = preview.state.theme;
    figure.dataset.interaction = preview.state.interaction;
    figure.innerHTML = `<figcaption><strong>${escapeHtml(preview.label)}</strong><span>${escapeHtml(preview.kind)}</span></figcaption>`;

    const viewport = document.createElement('div');
    viewport.className = 'fixture-viewport';
    const iframe = document.createElement('iframe');
    iframe.title = `${candidateLabel(candidate)} · ${preview.label}`;
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.src = SANDBOX_URL;
    iframe.loading = 'lazy';
    frameCandidates.set(iframe, { candidate, state: preview.state });
    viewport.appendChild(iframe);

    const error = document.createElement('div');
    error.className = 'fixture-error';
    error.dataset.fixtureError = '';
    error.hidden = true;
    error.innerHTML = `<strong>预览失败</strong><span data-fixture-error-message></span><button type="button" data-fixture-retry>重试</button>`;
    error.querySelector('[data-fixture-retry]').addEventListener('click', () => {
      error.hidden = true;
      iframe.hidden = false;
      iframe.src = `${SANDBOX_URL}&retry=${Date.now()}`;
    });
    viewport.appendChild(error);
    figure.appendChild(viewport);
    return figure;
  }

  function candidateCard(candidate) {
    const card = document.createElement('article');
    card.className = 'candidate-card';
    card.dataset.candidateId = candidate.id;
    const paths = candidateUsagePaths(candidate);
    card.innerHTML = `
      <header class="candidate-card-header">
        <div class="candidate-identity">
          <h3>${escapeHtml(candidateLabel(candidate))}</h3>
          <p class="candidate-path" data-component-path title="${escapeHtml(paths.join('\n'))}"><span>路径</span><b>${escapeHtml(paths[0])}</b>${paths.length > 1 ? `<em>另有 ${paths.length - 1} 处</em>` : ''}</p>
        </div>
        <div class="candidate-card-actions">
          <span class="trust-badge" data-trust="${escapeHtml(candidate.trust)}" title="${escapeHtml(candidate.trust)}">${escapeHtml(trustLabel(candidate.trust))}</span>
          ${candidate.fixture ? '<button type="button" data-fixture-reset-all>重置全部</button>' : ''}
        </div>
      </header>`;

    const fixtureShell = document.createElement('div');
    fixtureShell.className = 'fixture-shell';
    if (candidate.fixture) {
      const gallery = document.createElement('div');
      gallery.className = 'fixture-gallery';
      previewStates(candidate).forEach((preview) => gallery.appendChild(fixturePreview(candidate, preview)));
      fixtureShell.appendChild(gallery);
      card.querySelector('[data-fixture-reset-all]').addEventListener('click', () => {
        gallery.querySelectorAll('iframe').forEach((iframe) => {
          iframe.contentWindow?.postMessage(protocol.message('reset'), '*');
        });
      });
    } else {
      fixtureShell.innerHTML = '<div class="fixture-message"><p>预览未就绪，暂不能作为设计基准。</p></div>';
    }
    card.appendChild(fixtureShell);
    card.insertAdjacentHTML('beforeend', sourceEvidence(candidate));
    return card;
  }

  function renderLiveCandidates(categoryId) {
    const candidates = candidatesForCategory(categoryId);
    const section = document.createElement('section');
    section.className = 'live-candidate-section';
    section.innerHTML = `
      <header class="candidate-toolbar">
        <p class="candidate-summary" data-candidate-summary></p>
        <label><span>搜索</span><input type="search" data-candidate-search placeholder="名称、路径或文件"></label>
      </header>
      <div class="candidate-list" data-live-candidate-list></div>
      <nav class="candidate-pagination" aria-label="Live Fixture 分页">
        <button type="button" data-candidate-previous>上一页</button>
        <span data-candidate-page></span>
        <button type="button" data-candidate-next>下一页</button>
      </nav>`;
    const input = section.querySelector('[data-candidate-search]');
    const list = section.querySelector('[data-live-candidate-list]');
    const summary = section.querySelector('[data-candidate-summary]');
    const pageLabel = section.querySelector('[data-candidate-page]');
    const previous = section.querySelector('[data-candidate-previous]');
    const next = section.querySelector('[data-candidate-next]');
    const pageSize = 12;
    let page = 0;

    const searchableText = (candidate) => [
      candidate.id,
      candidate.label,
      candidate.componentType,
      ...candidateUsagePaths(candidate),
      ...(candidate.sources || []).flatMap((source) => [source.display_text, source.file, sourceSurface(source), source.area]),
    ].filter(Boolean).join(' ').toLocaleLowerCase();

    const refresh = () => {
      const query = input.value.trim().toLocaleLowerCase();
      const filtered = query
        ? candidates.filter((candidate) => searchableText(candidate).includes(query))
        : candidates;
      const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
      page = Math.min(page, pages - 1);
      const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);
      frameCandidates.clear();
      list.innerHTML = '';
      visible.forEach((candidate) => list.appendChild(candidateCard(candidate)));
      if (!visible.length) list.innerHTML = '<div class="empty-category">没有匹配的 Live Fixture。</div>';
      const verified = filtered.filter((candidate) => candidate.trust === 'verified-live').length;
      summary.textContent = query
        ? `${filtered.length} 个匹配 · ${verified} 个已核验`
        : `${candidates.length} 个候选 · ${verified} 个已核验`;
      pageLabel.textContent = `${page + 1} / ${pages}`;
      previous.disabled = page === 0;
      next.disabled = page >= pages - 1;
    };
    input.addEventListener('input', () => {
      page = 0;
      refresh();
    });
    previous.addEventListener('click', () => {
      page -= 1;
      refresh();
    });
    next.addEventListener('click', () => {
      page += 1;
      refresh();
    });
    refresh();
    return section;
  }

  function renderCandidates() {
    frameCandidates.clear();
    const categoryTargets = Object.values(manifest.targets).filter((item) => item.categoryId === selectedCategoryId);
    candidateRegion.innerHTML = `
      <nav class="target-tabs" aria-label="语义决策目标">${categoryTargets.map((item) => `<button type="button" data-target-id="${escapeHtml(item.id)}" class="${item.id === selectedTargetId ? 'active' : ''}">${escapeHtml(targetLabel(item))}</button>`).join('')}</nav>`;
    candidateRegion.querySelector('.target-tabs')?.addEventListener('click', (event) => {
      const targetId = event.target.closest('[data-target-id]')?.dataset.targetId;
      if (!targetId) return;
      selectedTargetId = targetId;
      renderCandidates();
      renderDecisionPanel();
    });
    candidateRegion.appendChild(renderLiveCandidates(selectedCategoryId));
  }

  function persistSlot(targetId, dimensionId, slot) {
    store.setSlot(targetId, dimensionId, slot);
    store.save();
    updateDraftStatus();
  }

  function candidatesForDimension(target, dimension, options = {}) {
    return candidatesForTarget(target.id, options).filter((candidate) => (
      (!candidate.size || candidate.size === dimension.size)
      && (!dimension.contentForm || candidate.contentForm === dimension.contentForm)
    ));
  }

  function baselineFields(target, dimension, slot, body) {
    const { key: dimensionId } = dimension;
    const verified = candidatesForTarget(target.id, { verified: true });
    const baselineCandidates = candidatesForDimension(target, dimension, { verified: true });
    body.innerHTML = `
      <label>主基准
        <select data-baseline-candidate>
          <option value="">${baselineCandidates.length ? '选择已核验候选' : '当前槽位暂无同形态候选'}</option>
          ${baselineCandidates.map((candidate) => `<option value="${escapeHtml(candidate.id)}"${candidate.id === slot.candidateId ? ' selected' : ''}>${escapeHtml(candidateLabel(candidate))}</option>`).join('')}
        </select>
      </label>
      <div data-state-references></div>`;
    const select = body.querySelector('[data-baseline-candidate]');
    select.addEventListener('change', () => {
      const next = select.value ? decisionApi.sourceBaseline(manifest, select.value) : { kind: 'empty' };
      persistSlot(target.id, dimensionId, next);
      renderDecisionPanel();
    });
    if (!slot.candidateId) return;
    const result = decisionApi.validateSlot(manifest, target, dimensionId, slot);
    const referenceHost = body.querySelector('[data-state-references]');
    referenceHost.innerHTML = result.missingStates.map((state) => {
      const options = verified.filter((candidate) => (
        (!candidate.size || candidate.size === dimension.size)
        && (!dimension.contentForm || candidate.contentForm === dimension.contentForm)
        && [
          ...(candidate.coverage?.componentStates || []),
          ...(candidate.coverage?.interactionStates || []),
        ].includes(state)
      ));
      return `<label class="state-reference-row"><span>${escapeHtml(stateLabel(state))}</span><select data-state-reference="${escapeHtml(state)}"><option value="">选择状态补选</option>${options.map((candidate) => `<option value="${escapeHtml(candidate.id)}">${escapeHtml(candidateLabel(candidate))}</option>`).join('')}</select></label>`;
    }).join('') || '<p class="derived-note">主基准及 stateReferences 已覆盖全部必需状态。</p>';
    referenceHost.addEventListener('change', (event) => {
      const state = event.target.dataset.stateReference;
      if (!state || !event.target.value) return;
      const next = decisionApi.setStateReference(manifest, slot, [state], event.target.value);
      persistSlot(target.id, dimensionId, next);
      renderDecisionPanel();
    });
  }

  function derivedFields(target, dimension, slot, body) {
    const { key: dimensionId } = dimension;
    const states = [...target.contract.componentStates, ...target.contract.interactionStates];
    const selectedStates = new Set(slot.requiredStates || []);
    body.innerHTML = `
      <div data-derived-requirement class="slot-fields">
        <p class="derived-note">派生要求只记录契约，不生成预览。</p>
        <label>参考候选<select data-derived-reference><option value="">选择现有实现</option>${candidatesForTarget(target.id).map((candidate) => `<option value="${escapeHtml(candidate.id)}"${candidate.id === slot.basedOnCandidateId ? ' selected' : ''}>${escapeHtml(candidateLabel(candidate))}</option>`).join('')}</select></label>
        <label>需要保留的视觉与交互特征<textarea data-derived-preserve>${escapeHtml(slot.preserveFeatures || '')}</textarea></label>
        <fieldset><legend>必须补齐的状态</legend><div class="state-checks">${states.map((state) => `<label><input type="checkbox" value="${escapeHtml(state)}" data-derived-state${selectedStates.has(state) ? ' checked' : ''}>${escapeHtml(stateLabel(state))}</label>`).join('')}</div></fieldset>
        <label>其他可验证要求<textarea data-derived-requirements>${escapeHtml(slot.requirements || '')}</textarea></label>
        <label><span>要求状态</span><select data-derived-status><option value="draft"${slot.requirementStatus !== 'confirmed' ? ' selected' : ''}>要求草案</option><option value="confirmed"${slot.requirementStatus === 'confirmed' ? ' selected' : ''}>已确认要求</option></select></label>
      </div>`;
    const form = body.querySelector('[data-derived-requirement]');
    form.addEventListener('input', () => {
      persistSlot(target.id, dimensionId, {
        kind: 'derived-requirement',
        requirementStatus: form.querySelector('[data-derived-status]').value,
        componentType: target.contract.componentType,
        semanticTarget: target.contract.semanticTarget,
        dimension: {
          size: dimension.size,
          ...(dimension.contentForm ? { contentForm: dimension.contentForm } : {}),
        },
        basedOnCandidateId: form.querySelector('[data-derived-reference]').value,
        preserveFeatures: form.querySelector('[data-derived-preserve]').value,
        requiredStates: [...form.querySelectorAll('[data-derived-state]:checked')].map((input) => input.value),
        requirements: form.querySelector('[data-derived-requirements]').value,
      });
    });
    form.addEventListener('change', () => form.dispatchEvent(new Event('input')));
  }

  function slotCard(target, dimension, slot) {
    const { key: dimensionId } = dimension;
    const card = document.createElement('section');
    card.className = 'slot-card';
    card.dataset.slotId = dimensionId;
    const result = decisionApi.validateSlot(manifest, target, dimensionId, slot);
    card.innerHTML = `
      <div class="slot-card-head"><div class="slot-size"><strong>${escapeHtml(sizeLabel(dimension.size))}</strong><span>${escapeHtml(dimension.size)}</span></div><span class="slot-validity ${result.valid ? 'valid' : 'invalid'}">${result.valid ? '已完成' : '待创建'}</span></div>
      <div class="slot-fields"><label>如何创建这个槽位<select data-slot-kind><option value="empty"${slot.kind === 'empty' ? ' selected' : ''}>尚未决定</option><option value="source-baseline"${slot.kind === 'source-baseline' ? ' selected' : ''}>选择现有候选作为基准</option><option value="derived-requirement"${slot.kind === 'derived-requirement' ? ' selected' : ''}>记录一个待实现的派生要求</option></select></label><div data-slot-body></div><p class="slot-errors">${escapeHtml(result.errors.join('；'))}</p></div>`;
    const body = card.querySelector('[data-slot-body]');
    if (slot.kind === 'source-baseline') baselineFields(target, dimension, slot, body);
    if (slot.kind === 'derived-requirement') derivedFields(target, dimension, slot, body);
    card.querySelector('[data-slot-kind]').addEventListener('change', (event) => {
      const kind = event.target.value;
      let next = { kind: 'empty' };
      if (kind === 'source-baseline') next = { kind, candidateId: '', sourceHash: '', stateReferences: {} };
      if (kind === 'derived-requirement') next = {
        kind,
        requirementStatus: 'draft',
        componentType: target.contract.componentType,
        semanticTarget: target.contract.semanticTarget,
        dimension: {
          size: dimension.size,
          ...(dimension.contentForm ? { contentForm: dimension.contentForm } : {}),
        },
        basedOnCandidateId: '',
        preserveFeatures: '',
        requiredStates: [],
        requirements: '',
      };
      persistSlot(target.id, dimensionId, next);
      renderDecisionPanel();
    });
    return card;
  }

  function renderDecisionPanel() {
    const target = manifest.targets[selectedTargetId];
    if (!target) {
      targetStatus.textContent = '尚未选择目标';
      decisionContent.innerHTML = '<p class="panel-placeholder">当前分类尚无已注册语义目标。</p>';
      return;
    }
    const draftTarget = store.snapshot().targets[target.id];
    const progress = store.snapshot().progress.targets[target.id];
    const dimensions = decisionApi.targetDimensions(target);
    const completed = Object.values(progress.slots).filter((result) => result.valid).length;
    targetStatus.textContent = progress.complete ? `${completed}/${dimensions.length} 已完成` : `${completed}/${dimensions.length} 槽`;
    const slots = document.createElement('div');
    slots.className = 'decision-slots';
    const guide = document.createElement('div');
    guide.className = 'decision-guide';
    guide.innerHTML = target.contract.contentForms?.length
      ? `<strong>槽位已按契约自动建立</strong><span>${target.contract.contentForms.length} 种内容布局 × ${target.contract.sizes.length} 种尺寸，共 ${dimensions.length} 个。先在每格选择“现有基准”或“派生要求”。</span>`
      : '<strong>槽位已按契约自动建立</strong><span>在每格选择“现有基准”或“派生要求”。</span>';
    slots.appendChild(guide);
    const groups = new Map();
    for (const dimension of dimensions) {
      const groupId = dimension.contentForm || 'default';
      if (!groups.has(groupId)) groups.set(groupId, []);
      groups.get(groupId).push(dimension);
    }
    for (const [contentForm, groupDimensions] of groups) {
      const group = document.createElement('section');
      group.className = 'slot-group';
      group.dataset.contentForm = contentForm;
      group.innerHTML = `<header><strong>${escapeHtml(contentFormLabel(contentForm === 'default' ? '' : contentForm))}</strong><span>${groupDimensions.map((dimension) => sizeLabel(dimension.size)).join(' / ')}</span></header><div class="slot-size-grid"></div>`;
      const grid = group.querySelector('.slot-size-grid');
      groupDimensions.forEach((dimension) => {
        grid.appendChild(slotCard(target, dimension, draftTarget.slots[dimension.key]));
      });
      slots.appendChild(group);
    }
    decisionContent.innerHTML = '';
    decisionContent.appendChild(slots);
  }

  function downloadJson(raw, name) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function bindFileActions() {
    document.querySelector('[data-save-draft]').addEventListener('click', () => {
      const saved = store.save();
      updateDraftStatus(saved ? '草稿已保存' : '浏览器存储不可用；请手动导出草稿');
    });
    document.querySelector('[data-export-draft]').addEventListener('click', () => {
      downloadJson(store.exportDraft(), 'ui-component-library-draft.json');
    });
    document.querySelector('[data-export-decisions]').addEventListener('click', () => {
      try {
        downloadJson(store.exportFormal(), 'phase-2-components.json');
        setStatus('正式决策已导出');
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });
    const input = document.querySelector('[data-import-file]');
    document.querySelector('[data-import-decisions]').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const raw = await file.text();
        if (!window.confirm('导入将替换当前浏览器草稿，是否继续？')) return;
        store.importJson(raw);
        store.save();
        renderDecisionPanel();
        updateDraftStatus('决策文件已导入');
      } catch (error) {
        setStatus(`导入失败：${error.message}`, 'error');
      } finally {
        input.value = '';
      }
    });
  }

  window.addEventListener('message', (event) => {
    if (!protocol.isMessage(event.data)) return;
    const entry = [...frameCandidates.entries()].find(([iframe]) => iframe.contentWindow === event.source);
    if (!entry) return;
    const [iframe, fixture] = entry;
    const { candidate, state } = fixture;
    if (event.data.type === 'sandbox-ready') {
      const context = manifest.contexts?.[candidate.fixture?.contextId] || {};
      iframe.contentWindow?.postMessage(protocol.message('initialise', { candidate, context }), '*');
    } else if (event.data.type === 'fixture-ready') {
      const card = iframe.closest('.candidate-card');
      const badge = card?.querySelector('.trust-badge');
      const error = card?.querySelector('[data-fixture-error]');
      if (badge) {
        badge.dataset.trust = candidate.trust;
        badge.textContent = trustLabel(candidate.trust);
      }
      if (error) error.hidden = true;
      iframe.hidden = false;
      const rootHeight = Number(event.data.diagnostics?.[0]?.height || 0);
      iframe.style.height = `${Math.max(52, Math.min(220, Math.ceil(rootHeight + 16)))}px`;
      postFixtureState(iframe, state);
    } else if (event.data.type === 'reset-complete') {
      postFixtureState(iframe, state);
    } else if (event.data.type === 'fixture-error') {
      const card = iframe.closest('.candidate-card');
      const badge = card?.querySelector('.trust-badge');
      const error = card?.querySelector('[data-fixture-error]');
      if (badge) {
        badge.dataset.trust = 'fixture-failed';
        badge.textContent = trustLabel('fixture-failed');
        badge.title = event.data.message;
      }
      if (error) {
        error.hidden = false;
        error.querySelector('[data-fixture-error-message]').textContent = event.data.message;
      }
      iframe.hidden = true;
    }
  });

  toggle?.addEventListener('click', () => setSidebarOpen(true));
  document.querySelector('[data-sidebar-close]')?.addEventListener('click', () => setSidebarOpen(false));
  backdrop?.addEventListener('click', () => setSidebarOpen(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && sidebar?.classList.contains('is-open')) {
      setSidebarOpen(false);
      toggle?.focus();
    }
  });

  async function boot() {
    try {
      const response = await fetch(MANIFEST_URL, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      manifest = await response.json();
      if (manifest.schemaVersion !== decisionApi.SCHEMA_VERSION) throw new Error('Runtime Manifest Schema 不受支持');
      store = decisionApi.createStore({ manifest, storage: window.localStorage });
      selectedTargetId = manifest.targets['button.primary'] ? 'button.primary' : Object.keys(manifest.targets)[0] || '';
      selectedCategoryId = manifest.targets[selectedTargetId]?.categoryId
        || manifest.categories.find((category) => category.counts.total > 0)?.id
        || manifest.categories[0]?.id
        || '';
      renderCategories();
      renderCandidates();
      renderDecisionPanel();
      bindFileActions();
      updateDraftStatus();
    } catch (error) {
      candidateRegion.innerHTML = `<section class="blocking-state" role="alert"><h2>Manifest 无法加载</h2><p>${escapeHtml(error.message)}。页面不会回退到陈旧内置数据。</p></section>`;
      setStatus('Manifest 无法加载', 'error');
    }
  }

  boot();
})();
