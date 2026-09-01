(() => {
  const documentStates = new WeakMap();
  const MATRIX_CONTAINER_SELECTORS = [
    '[data-heading-combinations]',
    '.heading-combination-grid',
    '.grid',
    '.text-entry-size-grid',
    '.prompt-composer-demo-grid',
    '.selection-combination-grid',
    '.selection-size-grid',
    '[data-selection-states]',
    '.examples',
    '.status-grid',
    '.image-frame-grid',
    '.image-frame-size-grid',
    '.media-pattern',
    '.launchers',
    '.row',
    '.stack',
    '.node-runtime-grid',
    '.generation-pending-grid',
    '.generation-recovery-grid',
    '.menu-popover-family-grid',
  ];
  const IGNORED_CELL_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE']);

  function normaliseLabel(value, fallback) {
    const label = String(value || '').replace(/\s+/g, ' ').trim();
    return label || fallback;
  }

  function directChildLabel(node, index) {
    const directLabel = node.querySelector?.(
      ':scope > [data-ui-library-matrix-label], :scope > span, :scope > strong, :scope > h3, :scope > h2',
    );
    const component = node.localName?.startsWith('ic-')
      ? node
      : node.querySelector?.('[data-component-name], [data-legal-combination], ic-form-field, ic-input, ic-textarea, ic-checkbox, ic-radio-group, ic-switch, ic-select, ic-slider, ic-number-input, ic-color-field, ic-button, ic-icon-button, ic-card, ic-list, ic-table, ic-media-container, ic-file-input, ic-image-frame, ic-dialog, ic-menu, ic-popover, ic-confirm-popover, ic-tooltip');
    const explicit = node.dataset?.uiLibraryMatrixLabel
      || node.dataset?.state
      || node.dataset?.legalCombination
      || node.dataset?.componentName
      || component?.dataset?.uiLibraryMatrixLabel
      || component?.dataset?.state
      || component?.dataset?.legalCombination
      || component?.dataset?.componentName
      || component?.getAttribute?.('label')
      || component?.getAttribute?.('aria-label')
      || directLabel?.textContent;
    return normaliseLabel(explicit, `变体 ${index + 1}`);
  }

  function matrixTitle(container, index, document) {
    if (container.matches('.selection-size-grid, .text-entry-size-grid')) return '尺寸';
    if (container.matches('main')) return normaliseLabel(document.title, `状态矩阵 ${index + 1}`);
    const section = container.closest('section, article, [data-component-group]');
    return normaliseLabel(
      section?.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > header h1, :scope > header h2, :scope > header h3')?.textContent,
      `状态矩阵 ${index + 1}`,
    );
  }

  function eligibleChildren(container) {
    return [...container.children].filter(child => (
      !IGNORED_CELL_TAGS.has(child.tagName) && !child.matches('[hidden], [data-ui-library-matrix-generated]')
    ));
  }

  function candidateContainers(document) {
    const candidates = [...document.querySelectorAll(MATRIX_CONTAINER_SELECTORS.join(','))]
      .filter(container => !container.hidden && eligibleChildren(container).length > 1);
    const topLevelSections = [...document.querySelectorAll('body > main > section[data-legal-combination]')];
    if (topLevelSections.length > 1) {
      const main = topLevelSections[0].parentElement;
      if (main && !candidates.includes(main)) candidates.unshift(main);
    }
    return candidates.filter(candidate => !candidates.some(other => (
      other !== candidate && other.contains(candidate)
    )));
  }

  function buildMatrix(document, container, index) {
    const children = eligibleChildren(container);
    if (children.length < 2) return null;

    const scroll = document.createElement('div');
    scroll.className = 'ui-library-state-matrix-scroll';
    scroll.dataset.uiLibraryMatrixGenerated = 'true';
    const table = document.createElement('table');
    table.className = 'ui-library-state-matrix';
    const caption = document.createElement('caption');
    caption.textContent = matrixTitle(container, index, document);
    const section = container.closest('section, article, [data-component-group]');
    const visibleHeading = section?.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > header h1, :scope > header h2, :scope > header h3');
    if (normaliseLabel(visibleHeading?.textContent, '') === caption.textContent) {
      caption.classList.add('ui-library-state-matrix-caption-redundant');
    }
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    const axisHeader = document.createElement('th');
    axisHeader.scope = 'col';
    axisHeader.textContent = '类型';
    headRow.append(axisHeader);
    children.forEach((child, childIndex) => {
      const columnHeader = document.createElement('th');
      columnHeader.scope = 'col';
      columnHeader.textContent = directChildLabel(child, childIndex);
      headRow.append(columnHeader);
    });
    head.append(headRow);

    const body = document.createElement('tbody');
    const bodyRow = document.createElement('tr');
    const rowHeader = document.createElement('th');
    rowHeader.scope = 'row';
    rowHeader.textContent = '组件';
    bodyRow.append(rowHeader);
    children.forEach(child => {
      const cell = document.createElement('td');
      cell.append(child);
      bodyRow.append(cell);
    });
    body.append(bodyRow);
    table.append(caption, head, body);
    scroll.append(table);
    container.after(scroll);
    scroll.scrollLeft = 0;
    document.defaultView?.requestAnimationFrame(() => {
      scroll.scrollLeft = 0;
    });
    container.hidden = true;
    return true;
  }

  function apply(document) {
    if (!document?.documentElement) {
      return { matrices: 0 };
    }
    const existing = documentStates.get(document);
    if (existing?.summary.matrices > 0) {
      return existing.summary;
    }
    document.documentElement.dataset.uiLibraryPresentation = 'matrix';

    const matrixRecords = candidateContainers(document)
      .map((container, index) => buildMatrix(document, container, index))
      .filter(Boolean);
    const matrices = matrixRecords.length;
    const summary = { matrices };
    documentStates.set(document, { summary });
    return summary;
  }

  window.InfiniteCanvasUiMatrixPresentation = Object.freeze({ apply });
})();
