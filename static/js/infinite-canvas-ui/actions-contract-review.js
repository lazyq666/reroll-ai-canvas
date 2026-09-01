const CONTRACT_URL = '/static/design-system/infinite-canvas-ui/ic-actions-v1.json';
const host = document.querySelector('[data-actions-contract]');
const status = document.querySelector('[data-actions-review-status]');

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const list = (items) => `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;

function dimensionRows(dimensions) {
  return Object.entries(dimensions).map(([name, values]) => `
    <div class="actions-dimension">
      <strong>${escapeHtml(name)}</strong>
      <span>${values.map(value => `<code>${escapeHtml(value)}</code>`).join(' ')}</span>
    </div>`).join('');
}

function combinationTable(component) {
  if (!component.legalCombinations) return '';
  return `
    <div class="actions-combinations">
      <h3>合法组合</h3>
      <table>
        <thead><tr><th>用途</th><th>Hierarchy</th><th>Tone</th><th>Behavior</th></tr></thead>
        <tbody>${component.legalCombinations.map(item => `
          <tr>
            <td><code>${escapeHtml(item.id)}</code></td>
            <td>${escapeHtml(item.hierarchy)}</td>
            <td>${escapeHtml(item.tone)}</td>
            <td>${escapeHtml(item.behavior)}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

function componentCard(component) {
  return `
    <article class="actions-contract-card">
      <header><span>Primitive · Actions</span><h2>${escapeHtml(component.tag)}</h2><p>${escapeHtml(component.purpose)}</p></header>
      <div class="actions-contract-columns">
        <section><h3>适用</h3>${list(component.useWhen)}</section>
        <section><h3>禁止</h3>${list(component.prohibitedUses)}</section>
      </div>
      <section><h3>语义维度</h3>${dimensionRows(component.semanticDimensions)}</section>
      ${combinationTable(component)}
      <section><h3>不可破坏的规则</h3>${list(component.invariants)}</section>
    </article>`;
}

function render(contract) {
  const coverage = contract.legacyCoverage;
  const legacyRows = Object.entries(coverage.byLegacyTarget)
    .map(([target, count]) => `<li><code>${escapeHtml(target)}</code><strong>${count}</strong></li>`)
    .join('');
  host.innerHTML = `
    <section class="actions-contract-summary">
      <div><span>Contract status</span><strong>${escapeHtml(contract.review.contract.status)}</strong></div>
      <div><span>Legacy coverage</span><strong>${coverage.instanceCount} instances</strong></div>
      <div><span>Target mapping</span><strong>${coverage.byTarget['ic-button']} Button · ${coverage.byTarget['ic-icon-button']} Icon Button</strong></div>
      <div><span>Live review</span><strong>${escapeHtml(contract.review.live.status)}</strong></div>
    </section>
    <section class="actions-contract-gate">
      <div><span>第一次人工确认已完成</span><h2>${escapeHtml(contract.review.contract.note)}</h2><p>${escapeHtml(contract.review.contract.reviewer)} · ${escapeHtml(contract.review.contract.confirmedOn)}</p></div>
      <ul>
        <li>已确认：Primary / Secondary / Quiet 表达操作层级</li>
        <li>已确认：Danger 只用于破坏性后果</li>
        <li>已确认：Toggle 禁止 Primary 与 Danger</li>
        <li>已确认：Icon Button 必须具名并禁止 Primary</li>
        <li>已确认：Button Group 只关联操作，不承担 Radio / Tab 选择语义</li>
      </ul>
      <p>Implementation 与 Live review 均已确认；Migration 状态为 ${escapeHtml(contract.review.migration.status)}。</p>
    </section>
    <section class="actions-legacy-map">
      <header><span>Legacy 只证明覆盖，不决定目标外观</span><h2>727 个旧实例如何收拢</h2></header>
      <ul>${legacyRows}</ul>
    </section>
    <section class="actions-contract-list">${contract.components.map(componentCard).join('')}</section>`;
  status.textContent = contract.review.contract.status;
  document.documentElement.dataset.actionsContractStatus = 'ready';
}

try {
  const response = await fetch(CONTRACT_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Actions contract HTTP ${response.status}`);
  render(await response.json());
} catch (error) {
  host.innerHTML = `<p role="alert">${escapeHtml(error.message)}</p>`;
  status.textContent = 'load-failed';
  document.documentElement.dataset.actionsContractStatus = 'failed';
}
