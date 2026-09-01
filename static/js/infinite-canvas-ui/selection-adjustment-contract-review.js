const CONTRACT_URL = '/static/design-system/infinite-canvas-ui/ic-selection-adjustment-v1.json';
const host = document.querySelector('[data-selection-adjustment-contract]');
const status = document.querySelector('[data-selection-adjustment-review-status]');
const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function render(contract) {
  const coverage = contract.legacyCoverage;
  const cards = contract.components.map(component => `<article class="actions-contract-card"><header><span>Selection / Adjustment</span><h2>${escapeHtml(component.tag)}</h2><p>${escapeHtml(component.purpose)}</p></header><section><h3>禁止场景</h3><ul>${component.prohibitedUses.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section></article>`).join('');
  host.innerHTML = `<section class="actions-contract-summary"><div><span>Contract</span><strong>${escapeHtml(contract.review.contract.status)}</strong></div><div><span>Live</span><strong>${escapeHtml(contract.review.live.status)}</strong></div><div><span>Migration</span><strong>${escapeHtml(contract.review.migration.status)}</strong></div><div><span>Legacy</span><strong>${coverage.instanceCount} instances</strong></div></section><section class="actions-contract-gate"><div><span>两次人工确认已完成</span><h2>${escapeHtml(contract.review.live.note)}</h2><p>${escapeHtml(contract.review.live.reviewer)} · ${escapeHtml(contract.review.live.confirmedOn)}</p></div><ul><li>Checkbox：独立或多选，可稍后统一提交。</li><li>Radio Group：互斥单选与统一键盘范围。</li><li>Switch：只用于立即生效的设置。</li><li>Select：有限具名选项；Slider：有界连续或步进调整。</li><li><code>ic-number-input</code>：71 个精确数值输入。</li><li><code>ic-color-field</code>：2 个 UI Color Field，不吞并领域渲染色。</li></ul><p>Dependency satisfied: Text Entry/Form Field live confirmed and migration ready. Implementation status: ${escapeHtml(contract.review.implementation.status)}。</p></section><section class="actions-contract-list">${cards}</section>`;
  status.textContent = contract.review.contract.status;
  document.documentElement.dataset.selectionAdjustmentContractStatus = 'ready';
}

try {
  const response = await fetch(CONTRACT_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Selection / Adjustment contract HTTP ${response.status}`);
  render(await response.json());
} catch (error) {
  host.innerHTML = `<p role="alert">${escapeHtml(error.message)}</p>`;
  status.textContent = 'load-failed';
  document.documentElement.dataset.selectionAdjustmentContractStatus = 'failed';
}
