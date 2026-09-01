const CONTRACT_URL = '/static/design-system/infinite-canvas-ui/ic-navigation-command-v1.json';
const host = document.querySelector('[data-navigation-command-contract]');
const status = document.querySelector('[data-navigation-command-review-status]');
const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const list = items => `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
function render(contract) {
  const coverage = contract.legacyCoverage;
  host.innerHTML = `<section class="actions-contract-summary"><div><span>Contract</span><strong>${escapeHtml(contract.review.contract.status)}</strong></div><div><span>Legacy evidence</span><strong>${coverage.instanceCount} instances</strong></div><div><span>Baseline</span><strong>${escapeHtml(coverage.sourceReviewStatus)}</strong></div><div><span>Runtime / Live / Migration</span><strong>${escapeHtml(contract.review.implementation.status)} / ${escapeHtml(contract.review.live.status)} / ${escapeHtml(contract.review.migration.status)}</strong></div></section>
  <section class="actions-contract-gate"><div><span>第一次人工确认已完成</span><h2>${escapeHtml(contract.review.contract.note)}</h2><p>以下 10 项语义判断与确定性 Legacy 映射已确认；Live 与 Migration 仍等待第二次人工确认。</p></div>${list(contract.judgments)}</section>
  <section class="actions-legacy-map"><header><span>从版本化 semantic baseline 确定性重算</span><h2>${coverage.instanceCount} 个旧实例</h2></header>${list(Object.entries(coverage.byLegacyTarget).map(([name, count]) => `${name}: ${count}`))}<h3>票据明确但零 Legacy 证据</h3>${list(coverage.zeroEvidenceScope)}</section>
  <section class="actions-contract-list">${contract.components.map(component => `<article class="actions-contract-card"><header><span>Navigation / Command</span><h2>${escapeHtml(component.tag)}</h2><p>${escapeHtml(component.purpose)}</p></header><div class="actions-contract-columns"><section><h3>适用</h3>${list(component.useWhen)}</section><section><h3>禁止</h3>${list(component.prohibitedUses)}</section></div><section><h3>合法组合</h3>${list(component.legalCombinations.map(item => item.id))}</section></article>`).join('')}</section>`;
  status.textContent = contract.review.contract.status;
  document.documentElement.dataset.navigationCommandContractStatus = 'ready';
}
try { const response = await fetch(CONTRACT_URL, {cache: 'no-store'}); if (!response.ok) throw new Error(`Contract HTTP ${response.status}`); render(await response.json()); }
catch (error) { host.innerHTML = `<p role="alert">${escapeHtml(error.message)}</p>`; status.textContent = 'load-failed'; document.documentElement.dataset.navigationCommandContractStatus = 'failed'; }
