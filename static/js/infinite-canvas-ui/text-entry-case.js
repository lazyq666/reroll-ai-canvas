import '/static/js/infinite-canvas-ui/core.js?v=ic-ui-a7dd55e61123';

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.uiTheme = theme;
document.documentElement.dataset.uiDensity = params.get('density') || 'medium';
document.documentElement.dataset.uiMotion = params.get('motion') || 'standard';
document.documentElement.classList.toggle('theme-dark', theme === 'dark');
document.documentElement.lang = params.get('locale') || 'zh-CN';
const zh = document.documentElement.lang === 'zh-CN';
const long = params.get('content') === 'long';
const label = long
  ? (zh ? '用于在复杂项目列表中识别当前画布的项目名称' : 'Project name used to identify this canvas in a complex workspace list')
  : (zh ? '项目名称' : 'Project name');
const root = document.querySelector('[data-text-entry-case-root]');
const sizes = [
  { value: 's', label: 'S', suffix: 's' },
  { value: 'm', label: 'M', suffix: '' },
  { value: 'l', label: 'L', suffix: 'l' },
];
const componentName = (base, size) => `${base}${size.suffix ? `-${size.suffix}` : ''}`;
const sizeArticles = render => sizes.map(size => `
  <article data-ui-library-matrix-label="${size.label}" style="background:var(--ui-color-surface)">
    <span data-ui-library-matrix-label>${size.label}</span>
    ${render(size)}
  </article>
`).join('');

root.innerHTML = `
  <section>
    <h2>${zh ? '文本输入' : 'Text input'}</h2>
    <div class="text-entry-size-grid">
      ${sizeArticles(size => `
        <span data-ui-library-matrix-label>${zh ? '描边' : 'Outlined'}</span>
        <ic-form-field label="${label}" data-component-name="${componentName('ic-form-field-text', size)}">
          <ic-input slot="control" name="text-${size.value}" type="text" size="${size.value}" value="Example"></ic-input>
        </ic-form-field>
        <span data-ui-library-matrix-label>${zh ? '柔和底色' : 'Subtle'}</span>
        <ic-form-field label="${label}" data-component-name="${componentName('ic-form-field-text-subtle', size)}">
          <ic-input slot="control" name="text-subtle-${size.value}" type="text" appearance="subtle" size="${size.value}" value="Example"></ic-input>
        </ic-form-field>
      `)}
    </div>
  </section>
  <section>
    <h2>${zh ? '搜索输入' : 'Search input'}</h2>
    <div class="text-entry-size-grid">
      ${sizeArticles(size => `
        <span data-ui-library-matrix-label>${zh ? '描边' : 'Outlined'}</span>
        <ic-form-field label="${zh ? '搜索' : 'Search'}" hint="${zh ? '输入关键词筛选内容' : 'Enter keywords to filter content'}" data-component-name="${componentName('ic-form-field-search', size)}">
          <ic-input slot="control" name="search-${size.value}" type="search" size="${size.value}" placeholder="${zh ? '搜索…' : 'Search…'}" value="Canvas" end-action data-search-input>
            <ic-icon slot="start" name="search"></ic-icon>
            <ic-icon-button slot="end" background="ghost" icon="close" size="${size.value}" label="${zh ? '清除搜索' : 'Clear search'}" data-search-clear></ic-icon-button>
          </ic-input>
        </ic-form-field>
        <span data-ui-library-matrix-label>${zh ? '柔和底色' : 'Subtle'}</span>
        <ic-form-field label="${zh ? '搜索' : 'Search'}" hint="${zh ? '输入关键词筛选内容' : 'Enter keywords to filter content'}" data-component-name="${componentName('ic-form-field-search-subtle', size)}">
          <ic-input slot="control" name="search-subtle-${size.value}" type="search" appearance="subtle" size="${size.value}" placeholder="${zh ? '搜索…' : 'Search…'}" value="Canvas" end-action data-search-input>
            <ic-icon slot="start" name="search"></ic-icon>
            <ic-icon-button slot="end" background="ghost" icon="close" size="${size.value}" label="${zh ? '清除搜索' : 'Clear search'}" data-search-clear></ic-icon-button>
          </ic-input>
        </ic-form-field>
      `)}
    </div>
  </section>
  <section>
    <h2>${zh ? '密码、末端动作与多行输入' : 'Password, trailing actions, and multiline entry'}</h2>
    <div class="grid">
      <ic-form-field label="${label} · password" hint="${zh ? '可选说明文字' : 'Optional supporting hint'}">
        <ic-input slot="control" name="password" type="password" value="example-pass"></ic-input>
      </ic-form-field>
      <ic-form-field label="${zh ? '末端图标动作' : 'Trailing icon action'}" hint="${zh ? '图标按钮位于输入框右侧' : 'The icon button stays at the input end'}">
        <ic-input slot="control" name="icon-end-action" value="https://api.example.com" end-action>
          <ic-icon-button slot="end" background="ghost" hierarchy="quiet" tone="neutral" icon="detect" label="${zh ? '验证' : 'Verify'}" data-action-combination="quiet-icon-action"></ic-icon-button>
        </ic-input>
      </ic-form-field>
      <ic-form-field label="${zh ? '末端文字动作' : 'Trailing text action'}" hint="${zh ? '文字按钮位于输入框右侧' : 'The text button stays at the input end'}">
        <ic-input slot="control" name="text-end-action" value="sk-example" end-action>
          <ic-button slot="end" size="s" hierarchy="quiet">${zh ? '验证地址' : 'Verify URL'}</ic-button>
        </ic-input>
      </ic-form-field>
      <ic-form-field label="${zh ? '末端双动作' : 'Two trailing actions'}" hint="${zh ? '图标按钮与文字按钮同时位于输入框右侧' : 'An icon button and text button share the input end'}">
        <ic-input slot="control" name="dual-end-action" value="https://api.example.com" end-action>
          <ic-icon-button slot="end" background="ghost" hierarchy="quiet" icon="detect" label="${zh ? '检测地址' : 'Detect URL'}"></ic-icon-button>
          <ic-button slot="end" size="s" hierarchy="quiet">${zh ? '验证' : 'Verify'}</ic-button>
        </ic-input>
      </ic-form-field>
      <ic-form-field label="${zh ? '多行说明' : 'Multiline notes'}">
        <ic-textarea slot="control" name="vertical" resize="vertical" value="${zh ? '可以垂直调整大小的纯文本内容' : 'Plain text content with vertical resize'}"></ic-textarea>
      </ic-form-field>
      <ic-form-field label="${zh ? '固定高度说明' : 'Fixed notes'}">
        <ic-textarea slot="control" name="none" resize="none" value="${zh ? '不允许调整大小的纯文本内容' : 'Plain text content without resize'}"></ic-textarea>
      </ic-form-field>
    </div>
  </section>
  <section>
    <h2>${zh ? '完整状态' : 'Complete states'}</h2>
    <div class="grid">
      <ic-form-field label="Default"><ic-input slot="control" name="default" value="Default" data-preview-state="default"></ic-input></ic-form-field>
      <ic-form-field label="Hover"><ic-input slot="control" name="hover" value="Hover" data-preview-state="hover"></ic-input></ic-form-field>
      <ic-form-field label="Focus Visible"><ic-input slot="control" name="focus" value="Tab to inspect focus" data-preview-state="focus-visible"></ic-input></ic-form-field>
      <ic-form-field label="Disabled"><ic-input slot="control" name="disabled" value="Disabled" disabled></ic-input></ic-form-field>
      <ic-form-field label="Read-only"><ic-input slot="control" name="readonly" value="Read only" readonly></ic-input></ic-form-field>
      <ic-form-field label="Invalid" validation="${zh ? '请输入有效内容' : 'Enter a valid value'}"><ic-input slot="control" name="invalid" value="Invalid"></ic-input></ic-form-field>
    </div>
  </section>
  <section>
    <h2>${zh ? '结构化 Composer' : 'Structured Composer'}</h2>
    <p class="prompt-composer-guidance">${zh ? '编辑表面本身无背景、边框与圆角；聚焦时仅显示键盘焦点反馈。' : 'The editing surface has no background, border, or radius; only keyboard focus feedback is shown.'}</p>
    <div class="prompt-composer-demo-grid">
      <article class="prompt-composer-demo">
        <span>${zh ? '可编辑 · 素材引用与模板文字' : 'Editable · media reference and template text'}</span>
        <div class="prompt-composer-demo-editor"><ic-prompt-composer data-component-name="ic-prompt-composer" contenteditable="true" aria-label="${zh ? '结构化提示词编辑器示例' : 'Structured prompt composer example'}" data-placeholder="${zh ? '描述你想生成的图片、视频或文本，输入 @ 引用素材，或从提示词库开始…' : 'Describe the image, video, or text to generate; use @ to reference media, or start from the prompt library…'}">${zh ? '生成电影感产品图，参考' : 'Create a cinematic product image using'} <span class="mention-image-token" contenteditable="false"><span class="mention-audio-thumb" aria-hidden="true">图</span><span>${zh ? '参考图 01' : 'Reference 01'}</span></span> ${zh ? '并应用柔光棚拍，可直接修改模板文字。' : 'and apply soft studio light; template text remains directly editable.'}</ic-prompt-composer><ic-icon-button class="prompt-composer-demo-template-action" type="button" size="s" hierarchy="secondary" icon="prompt-library" label="${zh ? '提示词库' : 'Prompt library'}" tooltip-placement="block-start" data-action-combination="secondary-icon-action"></ic-icon-button></div>
      </article>
      <article class="prompt-composer-demo">
        <span>${zh ? '空白 · Placeholder' : 'Empty · Placeholder'}</span>
        <ic-prompt-composer data-component-name="ic-prompt-composer-placeholder" contenteditable="true" aria-label="${zh ? '空白提示词编辑器示例' : 'Empty prompt composer example'}" data-placeholder="${zh ? '描述你想生成的图片、视频或文本，输入 @ 引用素材，或从提示词库开始…' : 'Describe the image, video, or text to generate; use @ to reference media, or start from the prompt library…'}"></ic-prompt-composer>
      </article>
      <article class="prompt-composer-demo">
        <span>${zh ? '只读' : 'Read-only'}</span>
        <ic-prompt-composer data-component-name="ic-prompt-composer-readonly" contenteditable="false" aria-label="${zh ? '只读提示词示例' : 'Read-only prompt example'}">${zh ? '生成结束后可将 Composer 锁定为只读状态。' : 'The Composer can be locked after generation completes.'}</ic-prompt-composer>
      </article>
    </div>
  </section>
`;

function formFieldComponentName(field) {
  const control = field.querySelector(':scope > ic-input, :scope > ic-textarea');
  if (!control) return 'ic-form-field';

  const controlVariant = control.localName === 'ic-textarea'
    ? (control.getAttribute('resize') === 'none' ? 'textarea-fixed' : 'textarea')
    : control.getAttribute('type') || 'text';
  const variants = [controlVariant];

  if (control.getAttribute('appearance') === 'subtle') variants.push('subtle');

  if (controlVariant !== 'search' && control.hasAttribute('end-action')) {
    const actions = [...control.querySelectorAll(':scope > [slot="end"]')];
    if (actions.length === 2) variants.push('end-dual');
    else variants.push(actions[0]?.localName === 'ic-icon-button' ? 'end-icon' : 'end-button');
  }

  const previewState = control.dataset.previewState;
  if (previewState && previewState !== 'default') variants.push(previewState);
  else if (control.hasAttribute('disabled')) variants.push('disabled');
  else if (control.hasAttribute('readonly')) variants.push('readonly');
  if (field.hasAttribute('validation')) variants.push('invalid');
  const controlSize = control.getAttribute('size') || document.documentElement.dataset.uiDensity || 'medium';
  if (['s', 'small'].includes(controlSize)) variants.push('s');
  if (['l', 'large'].includes(controlSize)) variants.push('l');

  return `ic-form-field-${variants.join('-')}`;
}

for (const field of root.querySelectorAll('ic-form-field')) {
  field.dataset.componentName = formFieldComponentName(field);
}
for (const clearButton of root.querySelectorAll('[data-search-clear]')) {
  clearButton.addEventListener('click', () => {
    const input = clearButton.closest('ic-input[data-search-input]');
    if (!input) return;
    input.value = '';
    input.focus();
    input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  });
}
if (document.documentElement.dataset.uiDensity === 'small') {
  for (const composer of root.querySelectorAll('ic-prompt-composer[data-component-name]')) {
    composer.dataset.componentName = `${composer.dataset.componentName}-s`;
  }
}
await import('./component-name-tag.js');
