const FALLBACK_LIBRARY = {
  active_library_id:'system',
  libraries:[{
    id:'system',
    name:'系统提示词库',
    categories:[{id:'reverse_prompt',name:'反推提示词'}],
    items:[
      {id:'reverse_general',name:'通用生图',category:'reverse_prompt',scene:'完整还原画面信息',positive:'准确描述主体、环境、构图、镜头、光线、色彩、材质、风格与画质。不要解释过程，直接输出完整中文生图提示词。'},
      {id:'reverse_photo',name:'摄影复刻',category:'reverse_prompt',scene:'镜头、机位、光线与后期',positive:'从摄影师视角分析画面，重点描述镜头焦段、机位、景深、布光、曝光、色彩与后期质感。'},
      {id:'reverse_style',name:'视觉风格',category:'reverse_prompt',scene:'提炼可迁移的风格语言',positive:'提炼图片的艺术风格、视觉语言、材质、色彩体系、氛围与美术指导关键词。'},
      {id:'reverse_product',name:'商品拆解',category:'reverse_prompt',scene:'适合电商与广告素材',positive:'围绕商品主体，分析造型、材质、卖点、陈列、场景、商业布光和广告构图。'},
    ],
  }],
};

const modelIcons = {
  'gemini-2.5-pro':{src:'/static/images/gemini.svg',monochrome:true},
  'gpt-5.5':{src:'/static/images/chatgpt.svg',monochrome:true},
  'qwen3-vl-plus':{icon:'sparkles'},
};

const dialog = document.querySelector('#reversePromptDialog');
const templateGrid = document.querySelector('#reversePromptTemplateGrid');
const templateSource = document.querySelector('#templateLibrarySource');
const runButton = document.querySelector('#reversePromptRun');
const modelSelect = document.querySelector('#reversePromptModel');
const selectedModelIcon = document.querySelector('#selectedModelIcon');
const toast = document.querySelector('#prototypeToast');
let selectedTemplate = null;
let toastTimer = 0;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]));
}
function isReversePromptCategory(category) {
  const name = String(category?.name || '').trim().toLowerCase();
  const id = String(category?.id || '').trim().toLowerCase().replace(/[-\s]+/g,'_');
  return name === '反推提示词' || name === 'reverse prompt' || id === 'reverse_prompt' || id === 'reverseprompt';
}
function findReversePromptGroup(libraryData) {
  const libraries = Array.isArray(libraryData?.libraries) ? libraryData.libraries : [];
  const activeId = String(libraryData?.active_library_id || '');
  const ordered = [...libraries].sort((a,b) => Number(b?.id === activeId) - Number(a?.id === activeId));
  for (const library of ordered) {
    const category = (library.categories || []).find(isReversePromptCategory);
    if (!category) continue;
    const items = (library.items || []).filter(item => item?.id && item?.positive && item.category === category.id);
    return {library,category,items};
  }
  return null;
}
async function readPromptLibrary() {
  try {
    const response = await fetch('/api/prompt-libraries');
    if (!response.ok) throw new Error('Prompt library API unavailable in static preview');
    const payload = await response.json();
    return payload?.library || payload;
  } catch (_) {
    return FALLBACK_LIBRARY;
  }
}
function renderTemplates(group) {
  if (!group) {
    templateSource.textContent = '未找到“反推提示词”分组';
    templateGrid.innerHTML = '<div class="template-empty">请先在提示词模板库中创建“反推提示词”分组</div>';
    runButton.disabled = true;
    return;
  }
  templateSource.textContent = `${group.library.name} / ${group.category.name}`;
  if (!group.items.length) {
    templateGrid.innerHTML = '<div class="template-empty">“反推提示词”分组中暂无模板</div>';
    runButton.disabled = true;
    return;
  }
  selectedTemplate = group.items[0];
  templateGrid.innerHTML = `
    <div id="reversePromptTemplateGroup" class="template-choice-list" role="group" aria-label="反推提示词模板">
      ${group.items.map((item,index) => `
        <ic-checkbox
          class="template-choice"
          name="reverse-prompt-template-${index}"
          label="${escapeHtml(item.name)}"
          aria-label="${escapeHtml(item.name)}"
          appearance="checkmark-end"
          data-legal-combination="checkmark-end-label"
          data-component-variant="list"
          data-component-name="ic-checkbox-list"
          data-template-id="${escapeHtml(item.id)}"
          ${index === 0 ? 'checked' : ''}
        ><ic-heading level="3" subtitle="${escapeHtml(item.scene || '')}" data-legal-combination="h3-with-subtitle">${escapeHtml(item.name)}</ic-heading></ic-checkbox>`).join('')}
    </div>`;
  const templateGroup = templateGrid.querySelector('#reversePromptTemplateGroup');
  templateGroup.querySelectorAll('.template-choice').forEach(choice => {
    choice.addEventListener('change', () => {
      templateGroup.querySelectorAll('.template-choice').forEach(item => {
        const active = item === choice;
        item.checked = active;
        item.toggleAttribute('checked',active);
      });
      selectedTemplate = group.items.find(item => item.id === choice.dataset.templateId) || group.items[0];
    });
  });
  runButton.disabled = false;
}
function syncSelectedModelIcon() {
  const icon = modelIcons[modelSelect.value] || modelIcons['gemini-2.5-pro'];
  selectedModelIcon.replaceChildren();
  if (icon.src) {
    const image = document.createElement('img');
    image.src = icon.src;
    image.alt = '';
    if (icon.monochrome) image.dataset.monochrome = 'true';
    selectedModelIcon.append(image);
  } else {
    const glyph = document.createElement('ic-icon');
    glyph.setAttribute('name',icon.icon || 'sparkles');
    selectedModelIcon.append(glyph);
  }
}
function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; },2200);
}

document.querySelector('#prototypeReversePromptButton').addEventListener('click', () => dialog.show());
dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.hide('cancel'));
modelSelect.addEventListener('change',syncSelectedModelIcon);
runButton.addEventListener('click', async () => {
  if (!selectedTemplate) return;
  document.querySelector('#prototypeOutputText').textContent = `${selectedTemplate.name} · ${modelSelect.value} · 正在生成…`;
  document.querySelector('#prototypeOutputNode').hidden = false;
  await dialog.hide('confirm');
  showToast(`已读取“反推提示词 / ${selectedTemplate.name}”，并使用 ${modelSelect.value} 创建反推节点`);
});

await Promise.all(['ic-dialog','ic-select','ic-button','ic-heading','ic-divider','ic-checkbox'].map(tag => customElements.whenDefined(tag)));
syncSelectedModelIcon();
renderTemplates(findReversePromptGroup(await readPromptLibrary()));
await dialog.show();
