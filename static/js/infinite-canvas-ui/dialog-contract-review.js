const CONTRACT_URL = '/static/design-system/infinite-canvas-ui/ic-dialog-v1.json';
const host = document.querySelector('[data-dialog-contract]');
const status = document.querySelector('[data-dialog-review-status]');

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const list = (items) => `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
const sizeMeasurement = value => value.inlineSize && value.blockSize
  ? `${value.inlineSize} × ${value.blockSize}`
  : `≤ ${value.recommendedMaximum}`;

function componentCard(component) {
  const dimensions = Object.entries(component.semanticDimensions)
    .map(([name, values]) => `<li><strong>${escapeHtml(name)}</strong>: ${values.map(escapeHtml).join(' · ')}</li>`).join('');
  return `<article class="actions-contract-card">
    <header><span>Pattern · Dialogs</span><h2>${escapeHtml(component.tag)}</h2><p>${escapeHtml(component.purpose)}</p></header>
    <div class="actions-contract-columns"><section><h3>适用</h3>${list(component.useWhen)}</section><section><h3>禁止</h3>${list(component.prohibitedUses)}</section></div>
    <section><h3>语义维度</h3><ul>${dimensions}</ul></section>
    <section><h3>不可破坏的规则</h3>${list(component.invariants)}</section>
  </article>`;
}

function render(contract) {
  const coverage = contract.legacyCoverage;
  const legacyRows = Object.entries(coverage.byLegacyTarget)
    .map(([target, count]) => `<li><code>${escapeHtml(target)}</code><strong>${count}</strong></li>`).join('');
  host.innerHTML = `
    <section class="actions-contract-summary">
      <div><span>Contract</span><strong>${escapeHtml(contract.review.contract.status)}</strong></div>
      <div><span>Legacy coverage</span><strong>${coverage.instanceCount} instances</strong></div>
      <div><span>Targets</span><strong>${coverage.byTarget['ic-dialog']} Dialog · ${coverage.byTarget['ic-confirmation-dialog']} Confirmation</strong></div>
      <div><span>Runtime / Live / Migration</span><strong>${escapeHtml(contract.review.implementation.status)} / ${escapeHtml(contract.review.live.status)} / ${escapeHtml(contract.review.migration.status)}</strong></div>
    </section>
    <section class="actions-contract-gate">
      <div><span>两道人工作 Gate 均已完成</span><h2>${escapeHtml(contract.review.live.note)}</h2><p>Runtime、实时视觉与交互验收已确认；组件族现已具备迁移资格。</p></div>
      ${list(contract.judgments)}
    </section>
    <section class="actions-legacy-map"><header><span>Legacy 只证明覆盖，不决定目标外观</span><h2>32 个旧实例确定性映射</h2></header><ul>${legacyRows}</ul></section>
    <section class="actions-contract-card"><header><span>Shared behavior</span><h2>尺寸、结构、关闭与焦点</h2></header>
      <div class="actions-contract-columns"><section><h3>尺寸</h3>${list(Object.entries(contract.sizes).filter(([, value]) => typeof value === 'object').map(([name, value]) => `${name}: ${value.purpose} (${sizeMeasurement(value)})`))}</section>
      <section><h3>初始焦点顺序</h3>${list(contract.focusManagement.initialFocusOrder)}</section></div>
      <section><h3>关闭规则</h3><p>Explicit: ${escapeHtml(contract.dismissal.explicit.allowedTriggers.join(' · '))}</p><p>Light 仅限：${escapeHtml(contract.dismissal.light.allowedWhen.join(' · '))}</p></section>
    </section>
    <section class="actions-contract-list">${contract.components.map(componentCard).join('')}</section>`;
  status.textContent = contract.review.contract.status;
  document.documentElement.dataset.dialogContractStatus = 'ready';
}

try {
  const response = await fetch(CONTRACT_URL, {cache: 'no-store'});
  if (!response.ok) throw new Error(`Dialog contract HTTP ${response.status}`);
  render(await response.json());
} catch (error) {
  host.innerHTML = `<p role="alert">${escapeHtml(error.message)}</p>`;
  status.textContent = 'load-failed';
  document.documentElement.dataset.dialogContractStatus = 'failed';
}
