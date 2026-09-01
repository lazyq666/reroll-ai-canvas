const CONTRACT_URL = '/static/design-system/infinite-canvas-ui/ic-file-media-input-v1.json';
const host = document.querySelector('[data-file-media-input-contract]');
const status = document.querySelector('[data-file-media-input-review-status]');
const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const list = items => `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
function render(contract) {
  host.innerHTML = `<section class="actions-contract-summary"><div><span>Contract</span><strong>${escapeHtml(contract.review.contract.status)}</strong></div><div><span>Interface</span><strong>v${escapeHtml(contract.interfaceVersion)}</strong></div><div><span>Runtime / Live / Migration</span><strong>${escapeHtml(contract.review.implementation.status)} / ${escapeHtml(contract.review.live.status)} / ${escapeHtml(contract.review.migration.status)}</strong></div></section>
  <section class="actions-contract-gate"><div><span>Issue #${escapeHtml(contract.ticket)}</span><h2>能力、Surface 与媒体槽位边界</h2><p>picker 不再绘制皮肤；视觉入口由 Upload Surface、ic-button 与媒体槽位承担。</p></div>${list(contract.judgments)}</section>
  <section class="actions-contract-list">${contract.components.map(component => `<article class="actions-contract-card"><header><span>File / Media Input</span><h2>${escapeHtml(component.tag)}</h2><p>${escapeHtml(component.purpose)}</p></header><section><h3>合法组合</h3>${list(component.legalCombinations.map(item => item.id))}</section><section><h3>不可破坏约束</h3>${list(component.invariants)}</section></article>`).join('')}</section>`;
  status.textContent = contract.review.contract.status;
  document.documentElement.dataset.fileMediaInputContractStatus = 'ready';
}
try { const response = await fetch(CONTRACT_URL, {cache: 'no-store'}); if (!response.ok) throw new Error(`Contract HTTP ${response.status}`); render(await response.json()); }
catch (error) { host.innerHTML = `<p role="alert">${escapeHtml(error.message)}</p>`; status.textContent = 'load-failed'; document.documentElement.dataset.fileMediaInputContractStatus = 'failed'; }
