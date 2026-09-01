const CONTRACT_URL = '/static/design-system/infinite-canvas-ui/ic-containers-data-v1.json';
const host = document.querySelector('[data-containers-data-contract]');
const status = document.querySelector('[data-containers-data-review-status]');
const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const list = items => `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
function render(contract) {
  const coverage = contract.legacyCoverage;
  host.innerHTML = `<section class="actions-contract-summary"><div><span>Contract</span><strong>${escapeHtml(contract.review.contract.status)}</strong></div><div><span>Generic container evidence</span><strong>${coverage.genericInstanceCount} instances</strong></div><div><span>Reserved domain evidence</span><strong>${coverage.evidenceInstanceCount - coverage.genericInstanceCount} instances</strong></div><div><span>Runtime / Live / Migration</span><strong>${escapeHtml(contract.review.implementation.status)} / ${escapeHtml(contract.review.live.status)} / ${escapeHtml(contract.review.migration.status)}</strong></div></section>
  <section class="actions-contract-gate"><div><span>两道人工作 Gate 均已完成</span><h2>${escapeHtml(contract.review.live.note)}</h2><p>Semantic baseline 仍为 ${escapeHtml(coverage.sourceReviewStatus)}；它是可重算证据，不是假定已确认的设计。Containers/Data 组件族已可用于后续页面迁移。</p></div>${list(contract.judgments)}</section>
  <section class="actions-legacy-map"><header><span>从版本化 semantic baseline 确定性重算</span><h2>${coverage.evidenceInstanceCount} 个相关旧实例</h2></header>${list(Object.entries(coverage.byLegacyTarget).map(([name, count]) => `${name}: ${count}`))}<h3>零直接证据</h3>${list(coverage.zeroEvidenceScope)}<h3>保留给领域组件</h3>${list(Object.entries(coverage.reservedDomainEvidence).map(([name, count]) => `${name}: ${count}`))}</section>
  <section class="actions-contract-list">${contract.components.map(component => `<article class="actions-contract-card"><header><span>Containers / Data</span><h2>${escapeHtml(component.tag)}</h2><p>${escapeHtml(component.purpose)}</p></header><div class="actions-contract-columns"><section><h3>适用</h3>${list(component.useWhen)}</section><section><h3>禁止</h3>${list(component.prohibitedUses)}</section></div><section><h3>合法组合</h3>${list(component.legalCombinations.map(item => item.id))}</section></article>`).join('')}</section>`;
  status.textContent = contract.review.contract.status;
  document.documentElement.dataset.containersDataContractStatus = 'ready';
}
try { const response = await fetch(CONTRACT_URL, {cache: 'no-store'}); if (!response.ok) throw new Error(`Contract HTTP ${response.status}`); render(await response.json()); }
catch (error) { host.innerHTML = `<p role="alert">${escapeHtml(error.message)}</p>`; status.textContent = 'load-failed'; document.documentElement.dataset.containersDataContractStatus = 'failed'; }
