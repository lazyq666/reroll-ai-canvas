const variants = {
  A: {
    name: '独立确认弹窗',
    description: '删除前使用独立确认弹窗，明确对象与影响。',
  },
  B: {
    name: '锚点确认浮层',
    description: '中性浮层紧贴删除入口，使用组件库按钮明确操作与影响。',
  },
  C: {
    name: '底部确认条',
    description: '在模板库底部打开高可见操作条，不遮挡当前分组和模板。',
  },
  D: {
    name: '删除后撤销',
    description: '点击即移除，并提供 6 秒撤销窗口；适合可延迟提交的删除。',
  },
};

const initialGroups = [
  { id:'portrait', name:'人物摄影', count:3 },
  { id:'product', name:'产品设计', count:4 },
  { id:'environment', name:'场景概念', count:3 },
  { id:'reverse', name:'反推提示词', count:2 },
];

const templates = [
  { name:'电影感人物肖像', group:'人物摄影', color:'#687394', prompt:'电影质感的半身人物肖像，柔和轮廓光与低饱和环境色…' },
  { name:'自然光街拍', group:'人物摄影', color:'#987468', prompt:'午后自然光，街头纪实摄影，松弛姿态与真实肌理…' },
  { name:'极简产品主图', group:'产品设计', color:'#526d74', prompt:'极简棚拍产品主视觉，柔和渐变背景与精确材质高光…' },
  { name:'科技发布会 KV', group:'产品设计', color:'#5b679c', prompt:'深色科技发布会主视觉，透明材质与蓝紫色体积光…' },
  { name:'雾中森林', group:'场景概念', color:'#557367', prompt:'清晨薄雾穿过森林，远近层次清晰，电影概念设计…' },
  { name:'复古室内空间', group:'场景概念', color:'#8e6e5c', prompt:'七十年代复古室内，暖色木饰面与柔软织物质感…' },
];

const groupList = document.querySelector('#groupList');
const templateGrid = document.querySelector('#templateGrid');
const totalCount = document.querySelector('#totalCount');
const layer = document.querySelector('#confirmationLayer');
const bottomConfirm = document.querySelector('#bottomConfirm');
const undoToast = document.querySelector('#undoToast');
const stateBadge = document.querySelector('#stateBadge');
const variantLabel = document.querySelector('#variantLabel');
const variantDescription = document.querySelector('#variantDescription');

let activeVariant = new URL(location.href).searchParams.get('variant')?.toUpperCase() || 'A';
if (!variants[activeVariant]) activeVariant = 'A';
let groups = initialGroups.map(group => ({...group}));
let candidateId = '';
let undoTimer = 0;
let undoDeadline = 0;
let undoRecord = null;

function setState(text, active = false) {
  stateBadge.textContent = `当前状态：${text}`;
  stateBadge.toggleAttribute('data-active', active);
}

function groupRow(group) {
  const row = document.createElement('div');
  row.className = 'group-row';
  row.setAttribute('role', 'button');
  row.tabIndex = 0;
  row.dataset.groupId = group.id;
  row.innerHTML = `<span class="group-icon">#</span><span>${group.name}</span><small>${group.count}</small><span class="group-actions"><ic-icon-button class="delete-icon" type="button" size="s" hierarchy="quiet" icon="delete" label="删除分组 ${group.name}" data-delete-group="${group.id}"></ic-icon-button></span>`;
  return row;
}

function renderGroups() {
  groupList.replaceChildren(...groups.map(groupRow));
  totalCount.textContent = String(groups.reduce((sum, group) => sum + group.count, 0));
}

function renderTemplates() {
  templateGrid.innerHTML = templates.map(item => `<article class="template-card" style="--card-color:${item.color}"><p class="template-prompt">${item.prompt}</p><footer class="template-meta"><strong>${item.name}</strong><span>${item.group}</span></footer></article>`).join('');
}

function clearSurfaces() {
  candidateId = '';
  layer.hidden = true;
  layer.replaceChildren();
  document.querySelector('.confirm-popover')?.remove();
  bottomConfirm.hidden = true;
  bottomConfirm.replaceChildren();
  groupList.querySelectorAll('[data-confirming]').forEach(row => row.removeAttribute('data-confirming'));
  setState('浏览');
}

function candidate() {
  return groups.find(group => group.id === candidateId);
}

function deleteCandidate() {
  const group = candidate();
  if (!group) return;
  moveTemplatesAndDeleteGroup(group.id);
  clearSurfaces();
  renderGroups();
  setState(`已删除分组「${group.name}」`);
}

function actionButtons() {
  const fragment = document.createElement('div');
  fragment.className = 'confirm-actions';
  fragment.innerHTML = '<ic-button type="button" hierarchy="secondary" data-cancel-delete>取消</ic-button><ic-button type="button" hierarchy="primary" tone="danger" data-confirm-delete>删除分组</ic-button>';
  return fragment;
}

function fallbackFor(groupId) {
  return groups.find(group => group.id !== groupId) || null;
}

function migrationText(group) {
  const fallback = fallbackFor(group.id);
  return fallback
    ? `组内 ${group.count} 个提示词会移至“${fallback.name}”，模板本身不会删除。`
    : `组内 ${group.count} 个提示词会转为“未分类”，模板本身不会删除。`;
}

function moveTemplatesAndDeleteGroup(groupId) {
  const group = groups.find(item => item.id === groupId);
  if (!group) return;
  const fallback = fallbackFor(groupId);
  groups = groups.filter(item => item.id !== groupId);
  if (fallback) {
    groups = groups.map(item => item.id === fallback.id ? {...item, count:item.count + group.count} : item);
  }
}

function openDialog(group) {
  const dialog = document.createElement('section');
  dialog.className = 'confirm-dialog';
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.innerHTML = `<div class="warning-icon">!</div><h2>删除“${group.name}”分组？</h2><p>这个操作无法撤销。请确认你要删除的是这个分组。</p><div class="impact-box"><span>!</span><span>${migrationText(group)}</span></div>`;
  dialog.append(actionButtons());
  layer.replaceChildren(dialog);
  layer.hidden = false;
  dialog.querySelector('[data-confirm-delete]').focus();
}

function openPopover(group, trigger) {
  const popover = document.createElement('section');
  popover.className = 'confirm-popover';
  popover.setAttribute('role', 'alertdialog');
  popover.innerHTML = `<h2>删除“${group.name}”分组？</h2><p>${migrationText(group)}</p>`;
  popover.append(actionButtons());
  document.body.append(popover);
  const rect = trigger.getBoundingClientRect();
  const left = Math.min(window.innerWidth - 336, Math.max(12, rect.left - 18));
  popover.style.left = `${left}px`;
  popover.style.top = `${Math.min(window.innerHeight - popover.offsetHeight - 12, rect.bottom + 8)}px`;
  trigger.closest('.group-row')?.setAttribute('data-confirming', '');
  popover.querySelector('[data-confirm-delete]').focus();
}

function openBottomBar(group) {
  bottomConfirm.innerHTML = `<div class="bottom-confirm-copy"><strong>即将删除“${group.name}”分组</strong><span>${migrationText(group)}</span></div>`;
  bottomConfirm.append(actionButtons());
  bottomConfirm.hidden = false;
  bottomConfirm.querySelector('[data-confirm-delete]').focus();
}

function updateUndoToast() {
  if (!undoRecord) return;
  const seconds = Math.max(0, Math.ceil((undoDeadline - Date.now()) / 1000));
  undoToast.innerHTML = `<span class="countdown">${seconds}</span><div><strong>已删除“${undoRecord.group.name}”</strong><span>${seconds ? `${seconds} 秒后正式提交` : '删除已正式提交'}</span></div>${seconds ? '<button type="button" data-undo-delete>撤销</button>' : ''}`;
  if (!seconds) {
    clearInterval(undoTimer);
    undoTimer = setTimeout(() => {
      undoToast.hidden = true;
      undoRecord = null;
      setState('浏览');
    }, 1200);
  }
}

function optimisticDelete(group) {
  const index = groups.findIndex(item => item.id === group.id);
  undoRecord = { group:{...group}, index, groups:groups.map(item => ({...item})) };
  moveTemplatesAndDeleteGroup(group.id);
  renderGroups();
  undoDeadline = Date.now() + 6000;
  undoToast.hidden = false;
  setState('等待撤销', true);
  updateUndoToast();
  clearInterval(undoTimer);
  undoTimer = setInterval(updateUndoToast, 250);
}

function undoDelete() {
  if (!undoRecord) return;
  groups = undoRecord.groups.map(item => ({...item}));
  renderGroups();
  clearInterval(undoTimer);
  undoRecord = null;
  undoToast.hidden = true;
  setState('已撤销删除');
}

function requestDelete(groupId, trigger) {
  clearSurfaces();
  candidateId = groupId;
  const group = candidate();
  if (!group) return;
  if (activeVariant === 'D') {
    optimisticDelete(group);
    candidateId = '';
    return;
  }
  setState('等待确认', true);
  if (activeVariant === 'A') openDialog(group);
  if (activeVariant === 'B') openPopover(group, trigger);
  if (activeVariant === 'C') openBottomBar(group);
}

function resetDemo() {
  clearInterval(undoTimer);
  clearTimeout(undoTimer);
  undoRecord = null;
  undoToast.hidden = true;
  groups = initialGroups.map(group => ({...group}));
  clearSurfaces();
  renderGroups();
}

function setVariant(next) {
  if (!variants[next]) return;
  activeVariant = next;
  const url = new URL(location.href);
  url.searchParams.set('variant', activeVariant);
  history.replaceState({}, '', url);
  variantLabel.textContent = `${activeVariant} · ${variants[activeVariant].name}`;
  variantDescription.textContent = variants[activeVariant].description;
  resetDemo();
}

function cycleVariant(direction) {
  const keys = Object.keys(variants);
  const index = keys.indexOf(activeVariant);
  setVariant(keys[(index + direction + keys.length) % keys.length]);
}

document.addEventListener('click', event => {
  const deleteButton = event.target.closest('[data-delete-group]');
  if (deleteButton) {
    event.preventDefault();
    event.stopPropagation();
    requestDelete(deleteButton.dataset.deleteGroup, deleteButton);
    return;
  }
  if (event.target.closest('[data-cancel-delete]')) clearSurfaces();
  if (event.target.closest('[data-confirm-delete]')) deleteCandidate();
  if (event.target.closest('[data-undo-delete]')) undoDelete();
});

window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && candidateId) {
    clearSurfaces();
    return;
  }
  if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
  if (event.target.matches('input,textarea,select,[contenteditable="true"]')) return;
  event.preventDefault();
  cycleVariant(event.key === 'ArrowRight' ? 1 : -1);
});

document.querySelector('#previousVariant').addEventListener('click', () => cycleVariant(-1));
document.querySelector('#nextVariant').addEventListener('click', () => cycleVariant(1));
document.querySelector('#resetButton').addEventListener('click', resetDemo);

renderTemplates();
setVariant(activeVariant);
document.documentElement.dataset.ready = 'true';
