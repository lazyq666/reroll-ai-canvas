const params = new URLSearchParams(window.location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const viewport = params.get('viewport') === 'narrow' ? 'narrow' : 'desktop';
const contentMode = ['zh', 'en', 'long'].includes(params.get('content'))
  ? params.get('content')
  : 'en';
const componentMode = ['button', 'input', 'dialog'].includes(params.get('component'))
  ? params.get('component')
  : 'button';
const caseId = params.get('case') || `${componentMode}-${theme}-${viewport}-${contentMode}`;

const copy = {
  zh: {
    lang: 'zh-CN', eyebrow: 'Target 合同', title: 'Reroll UI',
    description: '项目自有组件的真实运行样例。', save: '保存画布', disabled: '不可用', loading: '正在保存',
    project: '项目名称', required: '必填项目名称', readonly: '只读项目名称', locked: '锁定项目名称',
    value: '草稿', reference: '参考画布', lockedValue: '已锁定', validate: '检查必填项',
    open: '打开删除确认', dialog: '删除节点', dialogCopy: '这会删除当前选中的节点。', confirm: '确认删除',
  },
  en: {
    lang: 'en', eyebrow: 'Target contract', title: 'Reroll UI',
    description: 'Live examples of project-owned components.', save: 'Save canvas', disabled: 'Disabled', loading: 'Saving',
    project: 'Project name', required: 'Required project name', readonly: 'Readonly project name', locked: 'Disabled project name',
    value: 'Draft', reference: 'Reference canvas', lockedValue: 'Locked', validate: 'Check required field',
    open: 'Open delete dialog', dialog: 'Delete node', dialogCopy: 'This removes the selected node.', confirm: 'Confirm deletion',
  },
  long: {
    lang: 'zh-CN', eyebrow: '长内容 Target 合同', title: 'Reroll UI 长内容与压缩布局验证',
    description: '验证较长的中英文混合说明在专业桌面创作工具的受限空间中仍然可读和可操作。',
    save: '保存当前画布并继续编辑', disabled: '当前操作暂时不可使用', loading: '正在保存所有画布修改',
    project: '包含较长描述的项目名称', required: '必须填写的长项目名称', readonly: '只读的参考项目名称', locked: '已禁用的项目名称',
    value: 'Reroll 组件迁移与交互验收草稿', reference: '只读参考：现有画布组件迁移记录', lockedValue: '锁定：等待上游依赖完成',
    validate: '检查这个必填字段是否已经完成', open: '打开包含较长说明的删除确认', dialog: '删除当前节点及其临时预览',
    dialogCopy: '这会删除当前选中的节点以及尚未保存的临时预览内容；已完成的 Generation Output 不会被改变。', confirm: '确认删除当前节点',
  },
}[contentMode];

document.documentElement.lang = copy.lang;
document.documentElement.classList.toggle('theme-dark', theme === 'dark');
document.documentElement.classList.toggle('studio-theme-dark', theme === 'dark');
document.documentElement.dataset.uiTheme = theme;
document.body.dataset.viewport = viewport;
document.body.dataset.content = contentMode;
document.body.dataset.component = componentMode;

document.querySelectorAll('[data-component-group]').forEach((group) => {
  group.hidden = group.dataset.componentGroup !== componentMode;
});
document.querySelector('[data-primary-action]').textContent = copy.save;
document.querySelector('[data-disabled-action]').textContent = copy.disabled;
document.querySelector('[data-loading-action]').textContent = copy.loading;

const filled = document.querySelector('[data-filled-input]');
const input = document.querySelector('[data-required-input]');
const readonly = document.querySelector('[data-readonly-input]');
const disabled = document.querySelector('[data-disabled-input]');
document.querySelector('[data-validate-input]').textContent = copy.validate;
const trigger = document.querySelector('[data-dialog-trigger]');
const dialog = document.querySelector('[data-target-dialog]');
trigger.textContent = copy.open;
document.querySelector('[data-dialog-copy]').textContent = copy.dialogCopy;
document.querySelector('[data-dialog-confirm]').textContent = copy.confirm;

await Promise.all([
  customElements.whenDefined('ic-button'),
  customElements.whenDefined('ic-input'),
  customElements.whenDefined('ic-dialog'),
]);

filled.label = copy.project;
filled.value = copy.value;
input.label = copy.required;
readonly.label = copy.readonly;
readonly.value = copy.reference;
disabled.label = copy.locked;
disabled.value = copy.lockedValue;
dialog.label = copy.dialog;

const status = document.querySelector('[data-case-status]');
trigger.addEventListener('click', () => {
  dialog.open = true;
});
document.querySelector('[data-validate-input]').addEventListener('click', () => {
  input.reportValidity();
});
document.querySelector('[data-dialog-confirm]').addEventListener('click', () => {
  dialog.open = false;
});
dialog.addEventListener('ic-after-hide', () => {
  status.textContent = `${copy.dialog} 已关闭，焦点应返回触发按钮。`;
});

await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
document.documentElement.dataset.icTracerStatus = 'ready';
status.textContent = `${copy.title} · ic-* ready`;
window.parent.postMessage({
  type: 'ic-target-tracer-ready',
  caseId,
  component: componentMode,
  theme,
  viewport,
  content: contentMode,
}, '*');
