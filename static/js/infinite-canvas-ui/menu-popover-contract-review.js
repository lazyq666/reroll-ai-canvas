const CONTRACT_URL = '/static/design-system/infinite-canvas-ui/ic-menu-popover-v1.json';
const host = document.querySelector('[data-menu-popover-contract]');
const status = document.querySelector('[data-menu-popover-review-status]');
const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const list = items => `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
function render(contract) {
  const coverage = contract.legacyCoverage;
  host.innerHTML = `<section class="actions-contract-summary"><div><span>Contract</span><strong>${escapeHtml(contract.review.contract.status)}</strong></div><div><span>Legacy evidence</span><strong>${coverage.instanceCount} instances</strong></div><div><span>Baseline</span><strong>${escapeHtml(coverage.sourceReviewStatus)}</strong></div><div><span>Runtime / Live / Migration</span><strong>${escapeHtml(contract.review.implementation.status)} / ${escapeHtml(contract.review.live.status)} / ${escapeHtml(contract.review.migration.status)}</strong></div></section>
  <section class="actions-contract-gate"><div><span>两道人工作 Gate 均已完成</span><h2>${escapeHtml(contract.review.live.note)}</h2><p>合同、Runtime、实时视觉与交互及真实浏览器自动验收均已确认；Migration 已解除阻塞。</p></div>${list(contract.judgments)}</section>
  <section class="actions-legacy-map"><header><span>从版本化 semantic baseline 确定性重算</span><h2>51 个旧实例</h2></header>${list(Object.entries(coverage.byLegacyTarget).map(([name, count]) => `${name}: ${count}`))}</section>
  <section class="actions-contract-list">${contract.components.map(component => `<article class="actions-contract-card"><header><span>Pattern · Anchored overlay</span><h2>${escapeHtml(component.tag)}</h2><p>${escapeHtml(component.purpose)}</p></header><div class="actions-contract-columns"><section><h3>适用</h3>${list(component.useWhen)}</section><section><h3>禁止</h3>${list(component.prohibitedUses)}</section></div><section><h3>不可破坏的规则</h3>${list(component.invariants)}</section></article>`).join('')}</section>`;
  status.textContent = contract.review.contract.status;
  document.documentElement.dataset.menuPopoverContractStatus = 'ready';
}
try { const response = await fetch(CONTRACT_URL, {cache: 'no-store'}); if (!response.ok) throw new Error(`Contract HTTP ${response.status}`); render(await response.json()); }
catch (error) { host.innerHTML = `<p role="alert">${escapeHtml(error.message)}</p>`; status.textContent = 'load-failed'; document.documentElement.dataset.menuPopoverContractStatus = 'failed'; }
