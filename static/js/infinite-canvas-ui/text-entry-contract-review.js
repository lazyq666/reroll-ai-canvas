const CONTRACT_URL = '/static/design-system/infinite-canvas-ui/ic-text-entry-v1.json';
const host = document.querySelector('[data-text-entry-contract]');
const status = document.querySelector('[data-text-entry-review-status]');
const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const list = (items) => `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;

function render(contract) {
  const coverage = contract.legacyCoverage;
  const cards = contract.components.map(component => `<article class="actions-contract-card"><header><span>${escapeHtml(contract.module.layer)}</span><h2>${escapeHtml(component.tag)}</h2><p>${escapeHtml(component.purpose)}</p></header>${component.semanticDimensions ? `<section><h3>受约束的语义维度</h3>${Object.entries(component.semanticDimensions).map(([key, values]) => `<p><strong>${escapeHtml(key)}</strong> · ${values.map(escapeHtml).join(' · ')}</p>`).join('')}</section>` : ''}<section><h3>禁止场景</h3>${list(component.prohibitedUses)}</section></article>`).join('');
  host.innerHTML = `<section class="actions-contract-summary"><div><span>Contract</span><strong>${escapeHtml(contract.review.contract.status)}</strong></div><div><span>Legacy</span><strong>${coverage.instanceCount} instances</strong></div><div><span>Text Entry target</span><strong>${coverage.byDisposition['ic-input'] + coverage.byDisposition['ic-textarea']} instances</strong></div><div><span>Composer</span><strong>${coverage.byDisposition['structured-composer-pattern']} structured instance</strong></div></section><section class="actions-contract-gate"><div><span>第一次人工确认已完成</span><h2>${escapeHtml(contract.review.contract.note)}</h2><p>${escapeHtml(contract.review.contract.reviewer)} · ${escapeHtml(contract.review.contract.confirmedOn)}</p></div><ul><li><strong>单行文本边界：</strong>Input 只承载 text / search / email / password / url / tel；number 与 color 不属于本族。</li><li><strong>多行纯文本与 Composer 边界：</strong>Textarea 保持纯文本；Smart Canvas 的 @ 图片、提示词引用及 Token/Chip 由独立结构化 Composer Pattern 支持，并复用本族基础能力。</li><li><strong>Form Field 统一关联：</strong>Label、Hint、Validation 由 Form Field 组合，placeholder 不能替代 Label。</li><li><strong>Invalid 不只依赖颜色：</strong>必须同时有文字提示与程序化关联。</li><li><strong>不提供通用 Loading 状态：</strong>异步进度属于外围流程，Text Entry 保持可预测。</li></ul><p>Legacy 映射：75 个单行文本 → ic-input；30 个普通多行文本 → ic-textarea；1 个结构化输入 → Composer Pattern；73 个 number / color → future Adjustment family。</p></section><section class="actions-contract-list">${cards}</section>`;
  status.textContent = contract.review.contract.status;
  document.documentElement.dataset.textEntryContractStatus = 'ready';
}

try {
  const response = await fetch(CONTRACT_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Text Entry contract HTTP ${response.status}`);
  render(await response.json());
} catch (error) {
  host.innerHTML = `<p role="alert">${escapeHtml(error.message)}</p>`;
  status.textContent = 'load-failed';
  document.documentElement.dataset.textEntryContractStatus = 'failed';
}
