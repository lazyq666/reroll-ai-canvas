(() => {
  const tr = (key) => window.StudioI18n?.t?.(key) || key;
  const trf = (key, values = {}) => Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    tr(key),
  );
  const token = location.pathname.split('/').filter(Boolean).pop();
  const viewport = document.getElementById('share-viewport');
  const stage = document.getElementById('share-stage');
  const nodesLayer = document.getElementById('share-nodes');
  const linksLayer = document.getElementById('share-links');
  const loading = document.getElementById('share-loading');
  const error = document.getElementById('share-error');
  const errorDetail = document.getElementById('share-error-detail');
  const minimap = document.getElementById('share-minimap');
  const minimapContent = document.getElementById('share-minimap-content');
  const readonlyComposer = document.getElementById('share-composer');
  const readonlyComposerEditor = document.getElementById('promptInput');
  const readonlyComposerCount = document.getElementById('promptCharacterCount');
  let minimapViewport = document.getElementById('share-minimap-viewport');
  let transform = { x: 0, y: 0, scale: 1 };
  let nodeBounds = [];
  let minimapState = null;
  let sharedNodesById = new Map();
  let sharedGeometrySession = null;
  let sharedCanvas = null;
  let sharedNodeRecords = [];
  let selectedNodeId = '';
  let sharedRenderSignature = '';
  const canvasLevelOfDetail = window.SmartCanvasModules?.canvasLevelOfDetail;
  const canvasVirtualization = window.SmartCanvasModules?.canvasVirtualization;
  const canvasFarPresentation = window.SmartCanvasModules?.canvasFarPresentation;
  if (!canvasLevelOfDetail || !canvasVirtualization || !canvasFarPresentation || !window.SmartImageResolution) {
    throw new Error('Canvas read performance modules failed to load');
  }

  const applyTransform = ({ fullSync = false } = {}) => {
    stage.style.transform = `translate(${transform.x}px,${transform.y}px) scale(${transform.scale})`;
    updateMinimapViewport();
    if (sharedCanvas) refreshSharedRenderSet({ fullSync });
  };
  const FRAME_COLORS = new Set(['blue', 'violet', 'amber', 'green', 'slate']);
  const DEFAULT_FRAME_COLOR = 'slate';
  const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  const nodeType = (node) => String(node?.type || node?.kind || '').trim().toLowerCase().replaceAll('_', '-');
  const isPromptNode = (node) => ['prompt', 'smart-prompt'].includes(nodeType(node));
  const isFrameNode = (node) => ['smart-frame', 'smart-section'].includes(nodeType(node));
  const frameColor = (node) => {
    const color = String(node?.frameColor || node?.sectionColor || '').trim().toLowerCase();
    return FRAME_COLORS.has(color) ? color : DEFAULT_FRAME_COLOR;
  };
  const mediaUrl = (item) => typeof item === 'string' ? item : (item?.url || item?.src || item?.path || '');
  const mediaKind = (item, url) => {
    const explicit = String(item?.kind || item?.type || '').toLowerCase();
    if (explicit.includes('video') || /\.(mp4|webm|mov)(\?|$)/i.test(url)) return 'video';
    if (explicit.includes('audio') || /\.(mp3|wav|m4a|ogg)(\?|$)/i.test(url)) return 'audio';
    return 'image';
  };
  const sharedMediaPreviewUrl = (url, size = 512) => {
    const parsed = new URL(String(url || ''), location.origin);
    if (!parsed.pathname.startsWith(`/api/shares/${encodeURIComponent(token)}/media/`)) return String(url || '');
    const width = Math.max(64, Math.min(2048, Math.round(Number(size) || 512)));
    parsed.searchParams.set('w', String(width));
    return `${parsed.pathname}${parsed.search}`;
  };
  const sharedPreviewSize = ({ width = 0, height = 0, currentSize = 0 } = {}) => (
    window.SmartImageResolution.choosePreviewSize({
      width, height, canvasScale:transform.scale,
      devicePixelRatio:window.devicePixelRatio || 1,
      currentSize,
    })
  );
  const fileNameFromUrl = (url) => {
    try {
      const parsed = new URL(String(url || ''), location.origin);
      const sharedName = parsed.searchParams.get('name');
      if (sharedName) return sharedName;
      return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    } catch (_error) {
      return '';
    }
  };
  const mediaName = (item, node, url) => {
    const itemName = typeof item === 'object'
      ? (item?.name || item?.filename || item?.fileName || item?.originalName || item?.original_name)
      : '';
    return String(
      itemName
      || node?.originalName || node?.original_name || node?.filename || node?.fileName || node?.name || node?.title
      || fileNameFromUrl(url)
      || ''
    ).trim();
  };
  const collectMedia = (node) => {
    const candidates = [node.images, node.videos, node.media, node.outputs, node.result, node.url, node.src];
    const seen = new Set();
    return candidates.flatMap((value) => Array.isArray(value) ? value : (value ? [value] : []))
      .map((item) => ({ item, url: mediaUrl(item) }))
      .filter((entry) => entry.url && !seen.has(entry.url) && seen.add(entry.url));
  };
  const textForNode = (node) => node.text || node.content || node.caption || '';
  const smartTextFontSize = (size) => ({ small: 18, medium: 28, large: 42 })[size] || 28;
  const smartTextSize = (node) => {
    const fontSize = smartTextFontSize(node.textSize);
    const lines = String(textForNode(node) || ' ').split('\n');
    const estimatedWidth = Math.max(...lines.map((line) => Math.max(1, [...line].length))) * fontSize * .62;
    return {
      width: Math.max(24, number(node.w ?? node.width, Math.min(480, estimatedWidth))),
      height: Math.max(Math.ceil(fontSize * 1.24), number(node.h ?? node.height, lines.length * fontSize * 1.24)),
    };
  };
  const brushPath = (points) => {
    if (!points.length) return '';
    if (points.length === 1) return `M ${number(points[0]?.[0], 0)} ${number(points[0]?.[1], 0)} l .5 0`;
    let path = `M ${number(points[0]?.[0], 0)} ${number(points[0]?.[1], 0)}`;
    for (let index = 1; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      const midX = (number(current?.[0], 0) + number(next?.[0], 0)) / 2;
      const midY = (number(current?.[1], 0) + number(next?.[1], 0)) / 2;
      path += ` Q ${number(current?.[0], 0)} ${number(current?.[1], 0)} ${midX} ${midY}`;
    }
    const last = points[points.length - 1];
    return `${path} L ${number(last?.[0], 0)} ${number(last?.[1], 0)}`;
  };

  const firstText = (...values) => values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
  const promptContentForNode = (node) => isPromptNode(node)
    ? firstText(node?.llmEnabled ? node?.llmInstruction : '', node?.text, node?.llmInstruction)
    : firstText(node?.promptDraftText, node?.displayPrompt, node?.runPrompt, node?.prompt);
  const publicNodeKind = (node) => {
    const type = nodeType(node);
    if (isPromptNode(node)) return node?.llmEnabled ? 'prompt-generation' : 'prompt';
    if (type === 'smart-splitter') return 'splitter';
    if (type === 'smart-loop') return 'loop';
    if (type === 'smart-group') return 'smart-group';
    if (isFrameNode(node)) return 'frame';
    if (type === 'smart-text') return 'text-annotation';
    if (type === 'smart-brush') return 'brush-stroke';
    if (type === 'smart-image' || !type) return node?.referenceGenerationKind ? 'generation' : 'image';
    return collectMedia(node).length ? 'image' : 'text-annotation';
  };
  const publicNodeTitle = (node, kind) => firstText(node?.title, ({
    image: '媒体节点', generation: '生成节点', prompt: '提示词节点',
    'prompt-generation': '提示词生成节点', splitter: '拆分节点', loop: '批量运行',
    'smart-group': '编组', frame: '画框', 'text-annotation': '文本', 'brush-stroke': '画笔',
  })[kind]) || '节点';
  const mediaSize = (item) => {
    const value = typeof item === 'object' ? item : {};
    const width = number(value.natural_w ?? value.naturalWidth ?? value.width ?? value.w ?? value.layout_w ?? value.preview_w, 0);
    const height = number(value.natural_h ?? value.naturalHeight ?? value.height ?? value.h ?? value.layout_h ?? value.preview_h, 0);
    return width > 0 && height > 0 ? { width, height } : null;
  };
  const mediaAspectRatio = (item) => {
    const size = mediaSize(item);
    return size ? size.width / size.height : 1;
  };
  const imageNameBadgeMarkup = ({ item, url }, node, { outside = false } = {}) => {
    const name = mediaName(item, node, url);
    return name
      ? `<span class="image-name-badge${outside ? ' image-name-badge-outside' : ''}" data-image-name="1" title="${escapeHtml(name)}">${escapeHtml(name)}</span>`
      : '';
  };
  const mediaElementMarkup = ({ item, url }, { single = false, width = 0, height = 0, previewSize = 0, previewOnly = false } = {}) => {
    const kind = mediaKind(item, url);
    const dimensions = single ? ` class="node-img" style="width:${width}px;height:${height}px"` : '';
    if (kind === 'image' || previewOnly) {
      const size = previewSize || sharedPreviewSize({ width, height });
      const preview = sharedMediaPreviewUrl(url, size);
      const previewKind = kind === 'video' ? ' data-preview-kind="video"' : '';
      return `<img${dimensions} src="${escapeHtml(preview)}" data-preview-src="${escapeHtml(preview)}" data-preview-size="${size}" data-original-src="${escapeHtml(url)}"${previewKind} alt="${escapeHtml(mediaName(item, {}, url) || tr('share.canvasImage'))}" draggable="false">`;
    }
    return kind === 'video'
      ? `<video${dimensions} src="${escapeHtml(url)}" controls playsinline draggable="false"></video>`
      : kind === 'audio'
        ? `<audio${dimensions} src="${escapeHtml(url)}" controls></audio>`
        : '';
  };
  const mediaBodyMarkup = (entries, node, layout) => {
    if (entries.length > 1) {
      const visibleRows = Math.max(1, Math.min(3, number(layout.visibleRows ?? layout.rows, 1)));
      const maxHeight = number(layout.gridHeight, visibleRows * number(layout.thumb, 96) + Math.max(0, visibleRows - 1) * 8);
      return `<div class="thumb-grid" data-thumb-scroll="1" style="--thumb-cols:${layout.cols};--thumb-size:${layout.thumb}px;--thumb-max-height:${maxHeight}px">${entries.map((entry, index) => `<div class="thumb-item" data-image-index="${index}" style="--thumb-media-aspect:${mediaAspectRatio(entry.item)}"><div class="thumb-media-frame">${mediaElementMarkup(entry, { width:layout.thumb, height:layout.thumb })}</div>${imageNameBadgeMarkup(entry, node)}</div>`).join('')}</div>`;
    }
    return entries[0]
      ? `<div class="image-wrap has-outside-image-name" style="--node-img-w:${layout.width}px;--node-img-h:${layout.height}px">${mediaElementMarkup(entries[0], { single:true, width:layout.width, height:layout.height })}${imageNameBadgeMarkup(entries[0], node, { outside:true })}</div>`
      : '';
  };
  const groupMedia = (node) => {
    const direct = collectMedia(node);
    const members = (Array.isArray(node?.items) ? node.items : [])
      .map((item) => typeof item === 'object' ? item : sharedNodesById.get(String(item)))
      .filter(Boolean);
    const seen = new Set(direct.map((entry) => entry.url));
    return direct.concat(members.flatMap(collectMedia).filter((entry) => !seen.has(entry.url) && seen.add(entry.url)));
  };
  const smartGroupBodyMarkup = (node) => {
    const entries = groupMedia(node);
    const members = (Array.isArray(node?.items) ? node.items : [])
      .map((item) => typeof item === 'object' ? item : sharedNodesById.get(String(item)))
      .filter(Boolean);
    const counts = members.reduce((result, member) => {
      const type = nodeType(member);
      if (isPromptNode(member)) result.prompt += 1;
      else if (type === 'smart-splitter') result.splitter += 1;
      else if (type === 'smart-loop') result.loop += 1;
      return result;
    }, { prompt:0, splitter:0, loop:0 });
    const summary = [
      counts.prompt ? trf('smart.summaryText', { count:counts.prompt }) : '',
      counts.splitter ? trf('smart.summarySeparators', { count:counts.splitter }) : '',
      entries.length ? trf('smart.summaryImages', { count:entries.length }) : '',
      counts.loop ? trf('smart.summaryLoops', { count:counts.loop }) : '',
    ].filter(Boolean).join(' · ') || tr('smart.groupEmptyDrop');
    const mediaMarkup = entries.length === 1
      ? `<div class="image-wrap smart-group-single-thumb">${mediaElementMarkup(entries[0], { width:96, height:96 })}${imageNameBadgeMarkup(entries[0], node)}</div>`
      : entries.length > 1
        ? `<div class="thumb-grid smart-group-thumb-grid" data-thumb-scroll="1" style="--thumb-cols:${Math.min(4, Math.ceil(Math.sqrt(entries.length)))};--thumb-size:96px;--thumb-max-height:100%">${entries.map((entry, index) => `<div class="thumb-item" data-image-index="${index}" style="--thumb-media-aspect:${mediaAspectRatio(entry.item)}"><div class="thumb-media-frame">${mediaElementMarkup(entry, { width:96, height:96 })}</div>${imageNameBadgeMarkup(entry, node)}</div>`).join('')}</div>`
        : '';
    return `<div class="smart-group-card${entries.length ? ' has-thumbs' : ''}">
      <div class="smart-group-summary"><ic-icon name="group" size="xs" aria-hidden="true"></ic-icon><span>${escapeHtml(summary)}</span></div>
      ${mediaMarkup || `<div class="smart-group-empty"><ic-icon name="add" size="xs" aria-hidden="true"></ic-icon><span>${escapeHtml(tr('smart.groupDropImage'))}</span></div>`}
    </div>`;
  };
  const splitterBodyMarkup = (node) => {
    const separator = String(node?.separator || ';');
    const items = Array.isArray(node?.items)
      ? node.items.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
      : firstText(node?.text, node?.prompt).split(separator).map((item) => item.trim()).filter(Boolean);
    const preview = items.length
      ? `<div class="prompt-node-segments">${items.map((item, index) => `<div class="prompt-node-segment"><span>${index + 1}</span><p>${escapeHtml(item)}</p></div>`).join('')}</div>`
      : `<div class="splitter-node-empty">${escapeHtml(tr('smart.splitterEmpty'))}</div>`;
    return `<div class="splitter-node-card">
      <div class="splitter-node-head"><span class="splitter-node-label">${escapeHtml(tr('smart.separator'))}</span><ic-input class="splitter-node-separator" type="text" size="small" value="${escapeHtml(separator)}" disabled></ic-input><ic-badge class="splitter-node-count" kind="count" tone="neutral">${escapeHtml(trf('smart.segmentCount', { count:items.length }))}</ic-badge></div>
      <div class="splitter-node-preview">${preview}</div>
    </div>`;
  };
  const loopBodyMarkup = (node) => {
    const count = Math.max(1, number(node?.count, 1));
    const mode = node?.mode === 'parallel' ? 'parallel' : 'serial';
    const prompt = firstText(node?.prompt, node?.text, node?.promptDraftText);
    return `<div class="loop-smart-card${node?.showPrompt ? ' has-prompt' : ''}" data-compact-label="${escapeHtml(tr('smart.loop'))}">
      <div class="loop-smart-header"><span class="loop-smart-header-icon" aria-hidden="true"><ic-icon name="loop" size="medium"></ic-icon></span><div class="loop-smart-heading"><div class="loop-smart-title">${escapeHtml(tr('smart.loop'))}</div><div class="loop-smart-subtitle">${escapeHtml(tr('smart.batchRunDescription'))}</div></div></div>
      <div class="loop-smart-section loop-smart-variables"><div class="loop-smart-section-label">${escapeHtml(tr('smart.batchVariables'))}</div><div class="loop-smart-variable-row"><ic-button class="loop-smart-control loop-smart-toggle" type="button" hierarchy="secondary" size="small" disabled>${escapeHtml(tr('smart.batchPromptVariable'))}</ic-button><span class="loop-smart-option-count">${escapeHtml(trf('smart.batchOptionCount', { n:prompt ? 1 : 0 }))}</span></div>${node?.showPrompt ? `<div class="loop-smart-panel prompt-panel"><div class="loop-smart-prompt-list"><div class="loop-smart-prompt-item"><div class="loop-smart-prompt-index">1</div><ic-prompt-composer class="loop-smart-control loop-smart-text" contenteditable="false">${escapeHtml(prompt)}</ic-prompt-composer></div></div></div>` : ''}</div>
      <div class="loop-smart-section loop-smart-execution"><div class="loop-smart-section-label">${escapeHtml(tr('smart.batchExecution'))}</div><div class="loop-smart-setting-row"><span class="loop-smart-setting-label">${escapeHtml(tr('smart.batchExecutionMode'))}</span><ic-segmented-control class="loop-smart-control loop-smart-seg" value="${mode}"><button type="button" data-value="serial" disabled>${escapeHtml(tr('smart.batchSequential'))}</button><button type="button" data-value="parallel" disabled>${escapeHtml(tr('smart.batchConcurrent'))}</button></ic-segmented-control></div><div class="loop-smart-setting-grid"><ic-number-input class="loop-smart-control loop-number-input" label="${escapeHtml(tr('smart.batchTaskCount'))}" value="${count}" min="1" max="100" size="small" disabled></ic-number-input></div></div>
      <div class="loop-smart-footer"><div class="loop-smart-run-summary">${escapeHtml(trf('smart.batchWillRun', { n:count }))}</div><ic-button class="loop-smart-control loop-smart-run" type="button" size="small" hierarchy="primary" disabled><ic-icon slot="start" name="workflow" size="small" aria-hidden="true"></ic-icon>${escapeHtml(trf('smart.loopRunAll', { n:count }))}</ic-button></div>
    </div>`;
  };
  const nodeBodyMarkup = (node, kind, layout, media) => {
    const family = window.InfiniteCanvasUiNodeComponents;
    if (kind === 'prompt' || kind === 'prompt-generation') return family.renderReadOnlyPromptBody({ content:promptContentForNode(node), generation:kind === 'prompt-generation', label:'只读提示词', characterCountUnit:'字符' });
    if (kind === 'splitter') return splitterBodyMarkup(node);
    if (kind === 'loop') return loopBodyMarkup(node);
    if (kind === 'smart-group') return smartGroupBodyMarkup(node);
    if (kind === 'frame') return Array.isArray(node?.items) && node.items.length ? '' : `<div class="smart-frame-empty">${escapeHtml(tr('smart.frameEmpty'))}</div>`;
    if (kind === 'text-annotation') return `<div class="smart-canvas-text" contenteditable="false" style="--smart-text-size:${smartTextFontSize(node.textSize)}px">${escapeHtml(textForNode(node))}</div>`;
    if (kind === 'brush-stroke') {
      const brushSize = Math.max(1, number(node.brushSize, 6));
      const path = brushPath(Array.isArray(node.points) ? node.points : []);
      return `<svg class="smart-brush-mark" viewBox="0 0 ${layout.width} ${layout.height}" preserveAspectRatio="none" aria-label="${escapeHtml(tr('smart.brushMark'))}"><path class="smart-brush-hit" d="${escapeHtml(path)}" stroke-width="${Math.max(14, brushSize + 10)}"></path><path class="smart-brush-stroke" d="${escapeHtml(path)}" stroke="${escapeHtml(node.color || '#111827')}" stroke-width="${brushSize}"></path></svg>`;
    }
    if (media.length) return mediaBodyMarkup(media, node, layout);
    if (node?.generationFailed) return `<div class="reference-generation-target generation-failure-target"><span class="upload-node-main"><ic-icon name="error" size="medium" aria-hidden="true"></ic-icon></span><span class="upload-node-title">${escapeHtml(tr('smart.errRunFailed'))}</span><ic-button type="button" size="small" hierarchy="secondary" disabled>${escapeHtml(tr('smart.viewLogs'))}</ic-button></div>`;
    if (node?.pending) return `<ic-generation-pending kind="image" state="generating" count="${Math.max(1, number(node.pending, 1))}"></ic-generation-pending>`;
    if (kind === 'generation') return `<div class="reference-generation-target" data-reference-generation-target="${escapeHtml(node.referenceGenerationKind || 'image')}"><span class="upload-node-main"><ic-icon name="zap" size="medium" aria-hidden="true"></ic-icon></span><span class="upload-node-title">${escapeHtml(tr('smart.generationNode'))}</span><span class="upload-node-sub">${escapeHtml(tr('smart.generationNodeSub'))}</span></div>`;
    return `<div class="reference-generation-target node-drop-readonly">
      <span class="upload-node-main"><ic-icon name="upload" size="medium" aria-hidden="true"></ic-icon></span>
      <span class="upload-node-title">${escapeHtml(tr('smart.uploadNodeTitle'))}</span>
      <span class="upload-node-sub">${escapeHtml(tr('smart.uploadNodeHint'))}</span>
    </div>`;
  };
  const createNodeRecord = (node, index) => {
    const kind = publicNodeKind(node);
    const type = nodeType(node);
    const media = collectMedia(node);
    const x = number(node.x, (index % 4) * 340);
    const y = number(node.y, Math.floor(index / 4) * 260);
    const measured = ['image', 'generation'].includes(kind)
      ? sharedGeometrySession?.measure(String(node.id || index))
      : null;
    let width = Math.max(24, number(node.w ?? node.width, kind === 'loop' ? 360 : ['prompt','prompt-generation','splitter','smart-group','generation'].includes(kind) ? 300 : 320));
    let height = Math.max(24, number(node.h ?? node.height, kind === 'loop' ? 320 : ['prompt','prompt-generation','splitter','smart-group','generation'].includes(kind) ? 180 : 220));
    if (measured?.supported) ({ width, height } = measured.layout);
    if (kind === 'text-annotation') ({ width, height } = smartTextSize(node));
    if (kind === 'frame') { width = Math.max(240, width); height = Math.max(160, height); }
    const layout = { width, height };
    return {
      id:String(node.id || index), node, index, kind, type, media, x, y, width, height, layout,
      isFrame:kind === 'frame', frameColor:kind === 'frame' ? frameColor(node) : '',
    };
  };
  const farNodeBodyMarkup = (record) => {
    const { node, kind, layout, media } = record;
    const entries = kind === 'smart-group' ? groupMedia(node) : media;
    const first = entries[0];
    const firstKind = first ? mediaKind(first.item, first.url) : '';
    const preview = first && firstKind !== 'audio'
      ? sharedMediaPreviewUrl(first.url, 512)
      : '';
    const canPreview = Boolean(first && (firstKind === 'image' || preview !== first.url));
    const mediaMarkup = canPreview
      ? mediaElementMarkup(first, {
          single:true, width:layout.width, height:layout.height,
          previewSize:512, previewOnly:firstKind === 'video',
        })
      : '';
    const marker = kind === 'splitter'
      ? tr('smart.separator')
      : kind === 'loop'
        ? tr('smart.loop')
        : tr('smart.uploadNodeTitle');
    return canvasFarPresentation.render({
      kind:kind === 'smart-group' ? 'group' : kind,
      layout,
      pending:Boolean(node.pending || node.queued || node.running || node.textGenerationPending || node.jimengPending?.submitId),
      group:{ count:entries.length, columns:Math.min(4, Math.max(1, Math.ceil(Math.sqrt(entries.length)))) },
      media:{
        kind:firstKind,
        markup:mediaMarkup,
        signature:first ? `${firstKind}:${first.url || ''}` : '',
      },
      labels:{
        group:trf('smart.summaryImages', { count:entries.length }),
        pending:tr('smart.generatingShort'),
        prompt:kind === 'prompt-generation' ? tr('smart.promptGenerationNode') : tr('smart.promptNode'),
        marker,
      },
    });
  };
  const bindSharedPreviewFallbacks = (root) => {
    root.querySelectorAll('img[data-preview-src][data-original-src]').forEach((image) => {
      image.addEventListener('error', () => {
        if (image.dataset.previewFailed === '1') return;
        image.dataset.previewFailed = '1';
        image.src = image.dataset.originalSrc || image.src;
      });
    });
  };
  const renderNode = (record, lodMode) => {
    const { node, kind, type, media, x, y, width, height, layout, index } = record;
    const family = window.InfiniteCanvasUiNodeComponents;
    if (!family?.render || !family?.renderReadOnlyPromptBody) throw new Error('Canvas Node Component Family failed to load');
    const far = lodMode === 'far';
    const body = far ? farNodeBodyMarkup(record) : nodeBodyMarkup(node, kind, layout, media);
    const states = { far, detail:!far, selected:selectedNodeId === record.id };
    if (kind === 'image' && !media.length) states.empty = true;
    if (kind === 'image' && media.length > 1) states.mediaGroup = true;
    if (kind === 'generation') states.referenceGeneration = true;
    const title = kind === 'frame' && Array.isArray(node?.items)
      ? `${escapeHtml(publicNodeTitle(node, kind))}<span class="smart-frame-count">${node.items.length}</span>`
      : escapeHtml(publicNodeTitle(node, kind));
    const template = document.createElement('template');
    template.innerHTML = family.render({
      id: String(node.id || index), kind, title, body, layout, position: { x, y }, states, frameColor:frameColor(node), controls: {},
    });
    const element = template.content.firstElementChild;
    if (!element) throw new Error('Canvas Node Component Family returned no node');
    element.setAttribute('role', 'group');
    element.setAttribute('aria-label', publicNodeTitle(node, kind));
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    element.classList.add('share-node');
    if (kind === 'frame') element.classList.add('share-frame-node');
    element.dataset.nodeType = type || kind;
    element.dataset.shareLod = lodMode;
    element.querySelectorAll('button,input,textarea,select,ic-button,ic-icon-button,ic-input,ic-number-input,ic-select,ic-segmented-control,ic-upload-surface')
      .forEach((control) => {
        control.setAttribute('disabled', '');
        control.setAttribute('aria-disabled', 'true');
      });
    bindSharedPreviewFallbacks(element);
    return element;
  };

  const drawLinks = (connections) => {
    linksLayer.replaceChildren();
    const byId = new Map(nodeBounds.map((node) => [node.id, node]));
    const links = (connections || []).map((link) => {
      const fromId = String(link.from || link.source || link.fromNode || link.sourceId || '');
      const toId = String(link.to || link.target || link.toNode || link.targetId || '');
      const from = byId.get(fromId);
      const to = byId.get(toId);
      if (!from || !to) return null;
      if (!canvasVirtualization.connectionVisible({ fromRect:from, toRect:to })) return null;
      return {
        x1: from.x + from.width,
        y1: from.y + from.height / 2,
        x2: to.x,
        y2: to.y + to.height / 2,
      };
    }).filter(Boolean);
    canvasVirtualization.noteConnections(links.length);
    if (!links.length) {
      linksLayer.style.left = '0px';
      linksLayer.style.top = '0px';
      linksLayer.style.width = '1px';
      linksLayer.style.height = '1px';
      return;
    }
    const padding = 120;
    const minX = Math.min(...links.flatMap((link) => [link.x1, link.x2, link.x1 + 80, link.x2 - 80])) - padding;
    const minY = Math.min(...links.flatMap((link) => [link.y1, link.y2])) - padding;
    const maxX = Math.max(...links.flatMap((link) => [link.x1, link.x2, link.x1 + 80, link.x2 - 80])) + padding;
    const maxY = Math.max(...links.flatMap((link) => [link.y1, link.y2])) + padding;
    linksLayer.style.left = `${minX}px`;
    linksLayer.style.top = `${minY}px`;
    linksLayer.style.width = `${Math.max(1, maxX - minX)}px`;
    linksLayer.style.height = `${Math.max(1, maxY - minY)}px`;
    links.forEach(({ x1, y1, x2, y2 }) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.classList.add('share-link');
      path.setAttribute('d', `M${x1 - minX},${y1 - minY} C${x1 + 80 - minX},${y1 - minY} ${x2 - 80 - minX},${y2 - minY} ${x2 - minX},${y2 - minY}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-width', '2');
      linksLayer.appendChild(path);
    });
  };

  const refreshSharedImageResolution = () => {
    const far = canvasLevelOfDetail.diagnostics().mode === 'far';
    nodesLayer.querySelectorAll('img[data-preview-src][data-original-src]').forEach((image) => {
      if (image.dataset.previewFailed === '1') return;
      const currentSize = Number(image.dataset.previewSize) || 0;
      const size = far ? 512 : sharedPreviewSize({
        width:image.offsetWidth || image.clientWidth,
        height:image.offsetHeight || image.clientHeight,
        currentSize,
      });
      const preview = sharedMediaPreviewUrl(image.dataset.originalSrc, size);
      image.dataset.previewSrc = preview;
      image.dataset.previewSize = String(size);
      if (preview && image.getAttribute('src') !== preview) image.src = preview;
    });
  };

  const materializeSharedNodes = (ids, lodMode) => {
    const started = performance.now();
    const renderIds = new Set(ids);
    const mounted = new Map(
      [...nodesLayer.querySelectorAll(':scope > .share-node[data-id]')]
        .map((element) => [element.dataset.id, element]),
    );
    mounted.forEach((element, id) => {
      if (!renderIds.has(id)) {
        element.remove();
        mounted.delete(id);
      }
    });
    const ordered = sharedNodeRecords.filter((record) => renderIds.has(record.id)).map((record) => {
      const existing = mounted.get(record.id);
      if (existing?.dataset.shareLod === lodMode) {
        existing.classList.toggle('selected', selectedNodeId === record.id);
        return existing;
      }
      const fresh = renderNode(record, lodMode);
      existing?.replaceWith(fresh);
      return fresh;
    });
    nodesLayer.append(...ordered);
    drawLinks(sharedCanvas?.connections || []);
    refreshSharedImageResolution();
    canvasVirtualization.noteMaterialization({
      duration:performance.now() - started,
      mountedNodeCount:ordered.length,
      warmNodeCount:0,
      warmMediaCount:0,
    });
    const previewCounts = { 512:0, 1024:0, 2048:0, other:0 };
    nodesLayer.querySelectorAll('img[data-preview-size]').forEach((image) => {
      const size = Number(image.dataset.previewSize) || 0;
      if ([512, 1024, 2048].includes(size)) previewCounts[size] += 1;
      else previewCounts.other += 1;
    });
    canvasLevelOfDetail.noteResources({
      renderSetCount:renderIds.size,
      mountedNodeCount:ordered.length,
      imagePreviewCounts:previewCounts,
      videoElementCount:nodesLayer.querySelectorAll('video').length,
      lastMaterializationDuration:performance.now() - started,
    });
  };

  const refreshSharedRenderSet = ({ fullSync = false } = {}) => {
    const lodState = canvasLevelOfDetail.update(transform.scale);
    document.documentElement.dataset.canvasLod = lodState.mode;
    const virtualizationState = canvasVirtualization.reconcile({ fullSync });
    const renderIds = new Set(virtualizationState.ids);
    const signature = `${lodState.mode}:${sharedNodeRecords
      .filter((record) => renderIds.has(record.id))
      .map((record) => record.id)
      .join('|')}`;
    if (signature !== sharedRenderSignature) {
      sharedRenderSignature = signature;
      materializeSharedNodes(virtualizationState.ids, lodState.mode);
    } else {
      refreshSharedImageResolution();
    }
  };

  const configureSharedVirtualization = () => {
    canvasLevelOfDetail.reset({ enabled:true, scale:transform.scale });
    canvasVirtualization.reset();
    canvasVirtualization.configure({
      getNodes:() => sharedNodeRecords,
      measureNode:(record) => ({ x:record.x, y:record.y, width:record.width, height:record.height }),
      getViewport:() => transform,
      getShellSize:() => ({ width:viewport.clientWidth, height:viewport.clientHeight }),
      getPinnedNodeIds:() => selectedNodeId ? [selectedNodeId] : [],
      onRefresh:() => refreshSharedRenderSet(),
    });
  };

  const worldBounds = () => {
    if (!nodeBounds.length) return { x: -400, y: -300, width: 800, height: 600 };
    const minX = Math.min(...nodeBounds.map((node) => node.x));
    const minY = Math.min(...nodeBounds.map((node) => node.y));
    const maxX = Math.max(...nodeBounds.map((node) => node.x + node.width));
    const maxY = Math.max(...nodeBounds.map((node) => node.y + node.height));
    const padding = Math.max(120, Math.min(360, Math.max(maxX - minX, maxY - minY) * .12));
    return { x: minX - padding, y: minY - padding, width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 };
  };

  const renderMinimap = () => {
    if (!minimapContent) return;
    const bounds = worldBounds();
    const width = minimapContent.clientWidth || 170;
    const height = minimapContent.clientHeight || 108;
    const scale = Math.min(width / bounds.width, height / bounds.height);
    const ox = (width - bounds.width * scale) / 2;
    const oy = (height - bounds.height * scale) / 2;
    minimapState = { bounds, width, height, scale, ox, oy };
    minimapContent.replaceChildren();
    nodeBounds.forEach((node) => {
      const marker = document.createElement('div');
      marker.className = `minimap-node${node.isFrame ? ' minimap-frame' : ''}`;
      if (node.isFrame) marker.dataset.frameColor = node.frameColor;
      marker.style.left = `${ox + (node.x - bounds.x) * scale}px`;
      marker.style.top = `${oy + (node.y - bounds.y) * scale}px`;
      marker.style.width = `${Math.max(3, node.width * scale)}px`;
      marker.style.height = `${Math.max(3, node.height * scale)}px`;
      minimapContent.appendChild(marker);
    });
    if (!nodeBounds.length) {
      const empty = document.createElement('div');
      empty.className = 'minimap-empty';
      empty.textContent = 'EMPTY';
      minimapContent.appendChild(empty);
    }
    minimapViewport = document.createElement('div');
    minimapViewport.id = 'share-minimap-viewport';
    minimapViewport.className = 'minimap-viewport';
    minimapContent.appendChild(minimapViewport);
    updateMinimapViewport();
  };

  function updateMinimapViewport() {
    if (!minimapViewport || !minimapState || !viewport.clientWidth || !viewport.clientHeight) return;
    const { bounds, scale, ox, oy } = minimapState;
    const worldX = -transform.x / transform.scale;
    const worldY = -transform.y / transform.scale;
    const worldWidth = viewport.clientWidth / transform.scale;
    const worldHeight = viewport.clientHeight / transform.scale;
    minimapViewport.style.left = `${ox + (worldX - bounds.x) * scale}px`;
    minimapViewport.style.top = `${oy + (worldY - bounds.y) * scale}px`;
    minimapViewport.style.width = `${Math.max(8, worldWidth * scale)}px`;
    minimapViewport.style.height = `${Math.max(8, worldHeight * scale)}px`;
  }

  const minimapEventToWorld = (event) => {
    if (!minimapState) renderMinimap();
    const rect = minimapContent.getBoundingClientRect();
    const { bounds, scale, ox, oy } = minimapState;
    return {
      x: bounds.x + (event.clientX - rect.left - ox) / scale,
      y: bounds.y + (event.clientY - rect.top - oy) / scale,
    };
  };
  const centerViewportOnWorldPoint = (point) => {
    transform.x = viewport.clientWidth / 2 - point.x * transform.scale;
    transform.y = viewport.clientHeight / 2 - point.y * transform.scale;
    applyTransform();
  };

  const fit = () => {
    if (!nodeBounds.length) return;
    const minX = Math.min(...nodeBounds.map((node) => node.x));
    const minY = Math.min(...nodeBounds.map((node) => node.y));
    const maxX = Math.max(...nodeBounds.map((node) => node.x + node.width));
    const maxY = Math.max(...nodeBounds.map((node) => node.y + node.height));
    const scale = Math.min(.95, Math.max(.08, Math.min((viewport.clientWidth - 80) / (maxX - minX), (viewport.clientHeight - 80) / (maxY - minY))));
    transform = { x: (viewport.clientWidth - (maxX - minX) * scale) / 2 - minX * scale, y: (viewport.clientHeight - (maxY - minY) * scale) / 2 - minY * scale, scale };
    applyTransform({ fullSync:true });
  };

  const clearReadonlySelection = () => {
    if (!readonlyComposer || !readonlyComposerEditor) return;
    selectedNodeId = '';
    nodesLayer.querySelectorAll('.share-node.selected').forEach((candidate) => candidate.classList.remove('selected'));
    readonlyComposerEditor.textContent = '';
    if (readonlyComposerCount) readonlyComposerCount.textContent = '0 字符';
    readonlyComposer.classList.remove('open');
  };

  const openReadonlyComposer = (node, element) => {
    const content = promptContentForNode(node);
    if (!readonlyComposer || !readonlyComposerEditor) return;
    clearReadonlySelection();
    if (!content) {
      return;
    }
    selectedNodeId = String(element?.dataset.id || '');
    element?.classList.add('selected');
    readonlyComposerEditor.textContent = content;
    readonlyComposerEditor.setAttribute('contenteditable', 'false');
    const count = typeof Intl?.Segmenter === 'function'
      ? [...new Intl.Segmenter(undefined, { granularity:'grapheme' }).segment(content)].length
      : [...content].length;
    if (readonlyComposerCount) readonlyComposerCount.textContent = `${count} 字符`;
    readonlyComposer.classList.add('open');
  };

  let drag = null;
  viewport.addEventListener('pointerdown', (event) => { if (event.target.closest?.('#share-composer, .share-node')) return; clearReadonlySelection(); drag = { x: event.clientX, y: event.clientY, tx: transform.x, ty: transform.y }; viewport.setPointerCapture(event.pointerId); viewport.classList.add('is-dragging'); });
  viewport.addEventListener('pointermove', (event) => { if (!drag) return; transform.x = drag.tx + event.clientX - drag.x; transform.y = drag.ty + event.clientY - drag.y; applyTransform(); });
  viewport.addEventListener('pointerup', () => { drag = null; viewport.classList.remove('is-dragging'); });
  viewport.addEventListener('wheel', (event) => { event.preventDefault(); const before = transform.scale; const next = Math.min(3, Math.max(.08, before * Math.exp(-event.deltaY * .001))); const rect = viewport.getBoundingClientRect(); const px = event.clientX - rect.left; const py = event.clientY - rect.top; transform.x = px - (px - transform.x) * next / before; transform.y = py - (py - transform.y) * next / before; transform.scale = next; applyTransform(); }, { passive: false });
  let minimapDrag = false;
  minimap.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    minimapDrag = true;
    minimap.setPointerCapture(event.pointerId);
    centerViewportOnWorldPoint(minimapEventToWorld(event));
  });
  minimap.addEventListener('pointermove', (event) => {
    if (!minimapDrag) return;
    event.stopPropagation();
    centerViewportOnWorldPoint(minimapEventToWorld(event));
  });
  minimap.addEventListener('pointerup', (event) => {
    minimapDrag = false;
    event.stopPropagation();
  });
  minimap.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
  nodesLayer.addEventListener('click', (event) => {
    const element = event.target.closest?.('.share-node[data-id]');
    if (!element) return;
    openReadonlyComposer(sharedNodesById.get(element.dataset.id), element);
  });
  window.addEventListener('resize', () => {
    renderMinimap();
    applyTransform({ fullSync:true });
  });

  fetch(`/api/shares/${encodeURIComponent(token)}`, { credentials: 'omit' })
    .then(async (response) => { const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.detail || tr('share.linkExpired')); return payload.canvas; })
    .then(async (canvas) => {
      await Promise.all([
        customElements.whenDefined('ic-canvas-node'),
        customElements.whenDefined('ic-prompt-composer'),
      ]);
      document.title = `${canvas.title || tr('share.canvasShare')} · Reroll`;
      const canvasTitle = document.getElementById('canvas-title');
      canvasTitle.removeAttribute('data-i18n');
      canvasTitle.textContent = canvas.title || tr('share.untitled');
      sharedCanvas = canvas;
      sharedNodesById = new Map((canvas.nodes || []).map((node, index) => [String(node.id || index), node]));
      sharedGeometrySession = window.SmartCanvasModules?.nodeGeometry?.createSession(canvas);
      if (!sharedGeometrySession) throw new Error('Canvas Node Geometry failed to load');
      sharedNodeRecords = (canvas.nodes || []).map(createNodeRecord);
      nodeBounds = sharedNodeRecords.map((record) => ({
        id:record.id, x:record.x, y:record.y, width:record.width, height:record.height,
        isFrame:record.isFrame, frameColor:record.frameColor,
      }));
      configureSharedVirtualization();
      renderMinimap();
      loading.hidden = true;
      requestAnimationFrame(fit);
    })
    .catch((reason) => { loading.hidden = true; error.hidden = false; errorDetail.textContent = reason.message || tr('share.linkExpired'); });
})();
