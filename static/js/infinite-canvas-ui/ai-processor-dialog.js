import { IcDialog } from './dialog.js';
import { ensureAiProcessorDialogStyles } from './ai-processor-dialog/styles.js';
import { LayerAuthoring } from './ai-processor-dialog/layer-authoring.js';

ensureAiProcessorDialogStyles();

const OWNED_ATTRIBUTE = 'data-ic-ai-processor-owned';
const PROCESSORS = new Set(['reverse-prompt', 'outpaint', 'angle-control', 'lighting-reference', 'layer-decomposition']);
const OUTPAINT_LONG_EDGE_LIMIT = 8192;
const OUTPAINT_PIXEL_LIMIT = 64_000_000;
const OUTPAINT_ASPECT_RATIO_PRESETS = Object.freeze(['1:1','2:3','3:2','3:4','4:3','9:16','16:9','21:9','9:21']);
const OUTPAINT_ASPECT_RATIO_VALUES = new Set(['adaptive','source',...OUTPAINT_ASPECT_RATIO_PRESETS]);
const OUTPAINT_RESOLUTION_VALUES = new Set(['auto','1k','2k','4k']);
const ANGLE_ASPECT_RATIO_VALUES = new Set(['source','square','portrait','landscape','portrait43','landscape43','story','wide','ultrawide']);
const ANGLE_RESOLUTION_VALUES = new Set(['auto','1k','2k','4k']);
const ANGLE_PROMPT_SUFFIX = '其他不做修改';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
  })[character]);
}
function normalizeTemplates(value) {
  return (Array.isArray(value) ? value : []).filter(item => item?.id).map(item => ({
    id:String(item.id),
    name:String(item.name || '未命名模板'),
    subtitle:String(item.subtitle || item.scene || ''),
    prompt:String(item.prompt || item.positive || ''),
  }));
}
function normalizeGroups(value) {
  return (Array.isArray(value) ? value : []).filter(item => item?.id).map(item => ({
    id:String(item.id),
    name:String(item.name || item.id),
    templates:normalizeTemplates(item.templates),
  }));
}
function normalizeModels(value) {
  return (Array.isArray(value) ? value : []).filter(item => item?.id).map(item => ({
    id:String(item.id),
    name:String(item.name || item.id),
    providerName:String(item.providerName || ''),
    icon:String(item.icon || ''),
    iconSrc:String(item.iconSrc || ''),
    iconMonochrome:Boolean(item.iconMonochrome),
    resolutionTiers:(Array.isArray(item.resolutionTiers) ? item.resolutionTiers : []).map(String).filter(Boolean),
    defaultResolution:String(item.defaultResolution || ''),
    supportsLayerRegions:Boolean(item.supportsLayerRegions),
  }));
}
function modelOptionAttributes(model) {
  if(model.iconSrc) return ` data-start-icon-src="${escapeHtml(model.iconSrc)}"${model.iconMonochrome ? ' data-start-icon-monochrome' : ''}`;
  return model.icon ? ` data-start-icon="${escapeHtml(model.icon)}"` : '';
}
function selectedModelIcon(model) {
  if(!model) return '';
  if(model.iconSrc) return `<span slot="start" aria-hidden="true"><img src="${escapeHtml(model.iconSrc)}" alt=""${model.iconMonochrome ? ' data-monochrome="true"' : ''}></span>`;
  return model.icon ? `<ic-icon name="${escapeHtml(model.icon)}" slot="start" aria-hidden="true"></ic-icon>` : '';
}
function reverseGroup(group) {
  const name = String(group?.name || '').replace(/[\s_-]+/g, '').toLowerCase();
  return name.includes('反推') || name.includes('reverseprompt');
}
function angleViewportMarkup() {
  return `<div data-angle-viewport class="ai-angle-viewport" role="img" aria-label="视角实时预览"></div>`;
}
function cameraControlsMarkup() {
  return `<div class="ai-angle-controls">
      ${cameraControlRow('水平旋转','−90° — 90°','horizontal','-90','90','1','0')}
      ${cameraControlRow('垂直俯仰','−90° — 90°','vertical','-90','90','1','0')}
      ${cameraControlRow('相机距离','0.1 — 8.0','distance','0.1','8','0.1','4.0')}
  </div>`;
}
function cameraControlRow(label, hint, key, min, max, step, value) {
  const title = key === 'horizontal' ? '重置水平旋转' : key === 'vertical' ? '重置垂直俯仰' : '重置相机距离';
  return `<div class="ai-angle-control-row">
    <div class="ai-angle-control-copy"><span>${label}</span><span>${hint}</span></div>
    <ic-icon-button type="button" size="s" hierarchy="quiet" icon="restore" label="${title}" data-angle-reset-${key}></ic-icon-button>
    <ic-number-input name="ai-angle-${key}" label="${label}" min="${min}" max="${max}" step="${step}" value="${value}" data-angle-${key}-value></ic-number-input>
    <ic-slider label="${label}" min="${min}" max="${max}" step="${step}" value="${value}" data-angle-${key}></ic-slider>
  </div>`;
}
function lightingControlRow(label, hint, key, min, max, step, value) {
  return `<div class="ai-lighting-control-row">
    <div class="ai-lighting-control-copy"><span>${label}</span><span>${hint}</span></div>
    <ic-number-input name="ai-lighting-${key}" label="${label}" size="small" min="${min}" max="${max}" step="${step}" value="${value}" data-lighting-${key}-value></ic-number-input>
    <ic-slider label="${label}" min="${min}" max="${max}" step="${step}" value="${value}" data-lighting-${key}></ic-slider>
  </div>`;
}
function lightingControlsMarkup() {
  return `<div class="ai-lighting-controls">
    <section class="ai-lighting-parameter-group" aria-labelledby="ai-lighting-direction-heading">
      <div class="ai-lighting-section-heading"><div><strong id="ai-lighting-direction-heading">主光方向</strong></div><ic-icon-button type="button" size="s" hierarchy="quiet" icon="restore" label="重置主光方向" data-lighting-reset-direction></ic-icon-button></div>
      ${lightingControlRow('方位角','−180° — 180°','azimuth','-180','180','1','-45')}
      ${lightingControlRow('仰角','−10° — 90°','elevation','-10','90','1','35')}
    </section>
    <section class="ai-lighting-parameter-group" aria-labelledby="ai-lighting-color-heading">
      <div class="ai-lighting-section-heading"><div><strong id="ai-lighting-color-heading">主光颜色</strong></div></div>
      <ic-segmented-control class="ai-lighting-color-mode" size="small" label="颜色模式" value="temperature" data-legal-combination="single-label" data-lighting-color-mode>
        <button type="button" data-value="temperature">色温</button>
        <button type="button" data-value="rgb">RGB</button>
      </ic-segmented-control>
      <div data-lighting-temperature-row>${lightingControlRow('色温','2000K — 10000K','temperature','2000','10000','100','4200')}</div>
      <div data-lighting-rgb-row><ic-color-field name="ai-lighting-rgb" label="RGB 颜色" size="small" value="#ffd7b3" data-lighting-rgb></ic-color-field></div>
    </section>
    <section class="ai-lighting-parameter-group" aria-labelledby="ai-lighting-exposure-heading">
      <div class="ai-lighting-section-heading"><div><strong id="ai-lighting-exposure-heading">曝光与阴影</strong></div></div>
      ${lightingControlRow('主光相对曝光','−6 — +6 EV','key-exposure','-6','6','0.1','0')}
      ${lightingControlRow('环境补光相对曝光','−8 — +4 EV','ambient-exposure','-8','4','0.1','-2')}
      ${lightingControlRow('表观光源尺寸','0.5° — 30°','angular-size','0.5','30','0.5','8')}
      <div class="ai-lighting-switch-row">
        <span id="ai-lighting-casts-shadow-label">开启投影</span>
        <ic-switch label="开启投影" aria-labelledby="ai-lighting-casts-shadow-label" checked data-lighting-casts-shadow></ic-switch>
      </div>
    </section>
    <section class="ai-lighting-parameter-group ai-lighting-prompt-group" aria-labelledby="ai-lighting-prompt-heading">
      <div class="ai-lighting-section-heading"><div><strong id="ai-lighting-prompt-heading">确定性 Prompt</strong></div></div>
      <ic-textarea label="中文 Prompt" size="small" rows="5" resize="vertical" readonly data-lighting-prompt-zh></ic-textarea>
      <ic-textarea label="English Prompt" size="small" rows="6" resize="vertical" readonly data-lighting-prompt-en></ic-textarea>
    </section>
  </div>`;
}

export class IcAiProcessorDialog extends IcDialog {
  static properties = {
    processor:{reflect:true},
    groups:{attribute:false},
    models:{attribute:false},
    messages:{attribute:false},
    sourceImage:{attribute:'source-image',reflect:true},
    sourceAlt:{attribute:'source-alt',reflect:true},
    sourceWidth:{type:Number,attribute:'source-width'},
    sourceHeight:{type:Number,attribute:'source-height'},
    selectedGroup:{attribute:'selected-group',reflect:true},
    selectedTemplate:{attribute:'selected-template',reflect:true},
    selectedModel:{attribute:'selected-model',reflect:true},
    prompt:{reflect:false},
    fillColor:{attribute:'fill-color',reflect:true},
    outpaintAspectRatio:{attribute:'outpaint-aspect-ratio',reflect:true},
    outpaintResolution:{attribute:'outpaint-resolution',reflect:true},
    angleAspectRatio:{attribute:'angle-aspect-ratio',reflect:true},
    angleResolution:{attribute:'angle-resolution',reflect:true},
    layerResolution:{attribute:'layer-resolution',reflect:true},
    errorMessage:{attribute:'error-message',reflect:true},
    pending:{type:Boolean,reflect:true},
    initialLightingIntent:{attribute:false},
  };

  constructor() {
    super();
    this.processor = 'reverse-prompt';
    this.label = '反推提示词';
    this.groups = [];
    this.models = [];
    this.messages = {};
    this.sourceImage = '';
    this.sourceAlt = '';
    this.sourceWidth = 0;
    this.sourceHeight = 0;
    this.selectedGroup = '';
    this.selectedTemplate = '';
    this.selectedModel = '';
    this.prompt = '';
    this.fillColor = '#ffffff';
    this.customFillColor = '';
    this.outpaintAspectRatio = 'adaptive';
    this.outpaintResolution = 'auto';
    this.angleAspectRatio = 'source';
    this.angleResolution = 'auto';
    this.layerResolution = '';
    this.errorMessage = '';
    this.pending = false;
    this.dismissPolicy = 'explicit';
    this.bodyElement = null;
    this.cancelAction = null;
    this.confirmAction = null;
    this.angleController = null;
    this.lightingController = null;
    this.lightingControllerRoot = null;
    this.lightingChangeHandler = null;
    this.lightingMountToken = 0;
    this.lightingIntent = null;
    this.initialLightingIntent = null;
    this.lightingPrompts = null;
    this.outpaintResizeObserver = null;
    this.angleState = {horizontal:0,vertical:0,distance:4,command:''};
    this.outpaint = {left:0,right:0,top:0,bottom:0,atLimit:false};
    this.drag = null;
    this.openProcessor = '';
    this.initialLayerDraft = null;
    this.layerAuthoring = new LayerAuthoring(this);
  }
  get groups(){ return this._groups || []; }
  set groups(value){ const old=this._groups; this._groups=normalizeGroups(value); this.requestUpdate('groups',old); }
  get models(){ return this._models || []; }
  set models(value){ const old=this._models; this._models=normalizeModels(value); this.requestUpdate('models',old); }
  get messages(){ return this._messages || {}; }
  set messages(value){ const old=this._messages; this._messages=value&&typeof value==='object'?{...value}:{}; this.requestUpdate('messages',old); }
  message(key,fallback=''){ return String(this.messages[key] || fallback); }

  connectedCallback(){ this.ensureOwnedStructure(); super.connectedCallback(); }
  disconnectedCallback(){ this.layerAuthoring.dispose(); this.disposeAngleController(); this.disposeLightingController(); this.disposeOutpaintPreview(); super.disconnectedCallback(); }
  ensureOwnedStructure(){
    if(!this.bodyElement){
      this.bodyElement=document.createElement('div');
      this.bodyElement.setAttribute(OWNED_ATTRIBUTE,'body');
      this.append(this.bodyElement);
    }
    if(!this.cancelAction){
      this.cancelAction=document.createElement('ic-button');
      this.cancelAction.slot='footer'; this.cancelAction.hierarchy='secondary';
      this.cancelAction.setAttribute(OWNED_ATTRIBUTE,'cancel');
      this.cancelAction.addEventListener('click',()=>this.cancel()); this.append(this.cancelAction);
    }
    if(!this.confirmAction){
      this.confirmAction=document.createElement('ic-button');
      this.confirmAction.slot='footer'; this.confirmAction.hierarchy='primary';
      this.confirmAction.setAttribute(OWNED_ATTRIBUTE,'confirm');
      this.confirmAction.addEventListener('click',()=>this.confirm()); this.append(this.confirmAction);
    }
  }
  validateContract(){
    const base=super.validateContract();
    if(base) return base;
    if(!PROCESSORS.has(this.processor)) return `Unsupported AI processor: ${this.processor}`;
    if(this.dismissPolicy!=='explicit') return 'AI Processor Dialog only supports explicit dismissal';
    if(!String(this.sourceImage||'').trim()) return 'source-image is required for every ic-ai-processor-dialog';
    if(this.open && this.openProcessor && this.openProcessor!==this.processor) return 'processor cannot change while the dialog is open';
    const authored=[...this.children].find(node=>!node.hasAttribute(OWNED_ATTRIBUTE));
    return authored ? 'AI Processor Dialog owns its body and footer actions' : '';
  }
  currentGroup(){ return this.groups.find(group=>group.id===this.selectedGroup)||null; }
  currentTemplates(){ return this.currentGroup()?.templates || []; }
  currentModel(){ return this.models.find(model=>model.id===this.selectedModel)||null; }
  reconcileLayerResolution(forceDefault=false){
    const model=this.currentModel();
    const values=model?.resolutionTiers||[];
    if(forceDefault||!values.includes(this.layerResolution)){
      this.layerResolution=values.includes(model?.defaultResolution)
        ? model.defaultResolution
        : values.find(value=>value.toLowerCase()==='2k')||values[0]||'';
    }
  }
  submissionReason(){
    if(this.processor!=='lighting-reference'&&!this.models.length) return this.processor==='layer-decomposition'
      ? this.message('noModels')
      : '没有可用模型，请先到模型设置中配置。';
    if(this.processor!=='lighting-reference'&&!this.models.some(model=>model.id===this.selectedModel)) return this.processor==='layer-decomposition'
      ? this.message('selectModel')
      : '请选择模型。';
    if(this.processor==='layer-decomposition'&&!this.currentModel()?.resolutionTiers.includes(this.layerResolution)) return this.message('selectResolution');
    if(this.processor==='layer-decomposition') return this.layerAuthoring.reason();
    if(this.processor==='reverse-prompt'){
      if(!this.selectedGroup) return '未找到“反推”分组，请手动选择一个分组。';
      if(!this.currentTemplates().some(template=>template.id===this.selectedTemplate)) return '请选择一个提示词模板。';
    }
    if(this.processor==='outpaint'){
      const {left,right,top,bottom}=this.outpaint;
      if(!(left||right||top||bottom)) return '拖动画布边框以扩展图像。';
      if(!String(this.prompt||'').trim()) return '请输入扩图提示词。';
    }
    if(this.processor==='angle-control'){
      if(!this.angleState.command) return '请先调整至少一个相机参数。';
      if(!String(this.prompt||'').trim()) return '请输入视角提示词。';
    }
    if(this.processor==='lighting-reference'&&!this.lightingController) return '灯光预览正在加载，请稍候。';
    return '';
  }
  resetForOpen(){
    this.errorMessage=''; this.pending=false; this.selectedModel=this.models[0]?.id||'';
    this.selectedTemplate=''; this.selectedGroup=''; this.fillColor='#ffffff'; this.customFillColor=''; this.outpaintAspectRatio='adaptive'; this.outpaintResolution='auto';
    this.angleAspectRatio='source'; this.angleResolution='auto';
    this.layerResolution='';
    const emptyOutpaint={left:0,right:0,top:0,bottom:0};
    this.outpaint={...emptyOutpaint,atLimit:!this.validOutpaint(emptyOutpaint)};
    this.angleState={horizontal:0,vertical:0,distance:4,command:''};
    this.lightingIntent=this.initialLightingIntent?JSON.parse(JSON.stringify(this.initialLightingIntent)):null; this.lightingPrompts=null;
    if(this.processor==='reverse-prompt'){
      const group=this.groups.find(reverseGroup)||null;
      this.selectedGroup=group?.id||''; this.selectedTemplate=group?.templates?.[0]?.id||'';
      this.prompt='';
    } else if(this.processor==='outpaint') this.prompt='Remove the solid-color area and fill the scene';
    else if(this.processor==='angle-control') this.prompt=ANGLE_PROMPT_SUFFIX;
    else this.prompt='';
    if(this.processor==='layer-decomposition'){
      this.reconcileLayerResolution(true);
      this.layerAuthoring.reset(this.initialLayerDraft);
    }
    this.size=this.processor==='reverse-prompt'?'medium':'large';
    this.label=this.processor==='reverse-prompt'?'反推提示词':this.processor==='outpaint'?'扩图':this.processor==='angle-control'?'视角控制':this.processor==='layer-decomposition'?this.message('title'):'灯光参考';
    this.renderBody(); this.syncActions();
  }
  async show(){ this.openProcessor=this.processor; this.resetForOpen(); await this.updateComplete; return super.show(); }
  get layerDraft(){ return this.layerAuthoring.snapshot(); }

  groupSelectMarkup(optional=false,showLabel=true){
    const label=optional?'提示词模板（可选）':'提示词分组';
    return `<div class="ai-processor-field"><ic-select name="ai-processor-group"${showLabel?` label="${label}"`:''} aria-label="${label}" hierarchy="quiet" value="${escapeHtml(this.selectedGroup)}">
        <option value="">${optional?'不使用模板':'请选择分组'}</option>
        ${this.groups.map(group=>`<option value="${escapeHtml(group.id)}"${group.id===this.selectedGroup?' selected':''}>${escapeHtml(group.name)}</option>`).join('')}
      </ic-select></div>`;
  }
  templatesMarkup(){
    const templates=this.currentTemplates();
    if(this.processor==='outpaint'&&!this.selectedGroup) return '';
    if(!this.selectedGroup) return `<ic-empty-state data-ai-processor-empty title="请选择提示词分组" label="请选择提示词分组"></ic-empty-state>`;
    if(!templates.length) return `<ic-empty-state data-ai-processor-empty title="该分组暂无模板" label="该分组暂无模板"></ic-empty-state>`;
    return `<div data-ai-processor-template-list role="group" aria-label="提示词模板">${templates.map((item,index)=>`
      <ic-checkbox name="ai-template-${index}" label="${escapeHtml(item.name)}" appearance="checkmark-end" data-component-variant="list" data-template-id="${escapeHtml(item.id)}" ${item.id===this.selectedTemplate?'checked':''}>
        <ic-heading level="3" subtitle="${escapeHtml(item.subtitle)}">${escapeHtml(item.name)}</ic-heading>
      </ic-checkbox>`).join('')}</div>`;
  }
  modelMarkup(label){
    const selected=this.models.find(model=>model.id===this.selectedModel)||this.models[0];
    if(!this.models.length) return `<ic-empty-state data-ai-processor-empty title="${escapeHtml(this.processor==='layer-decomposition'?this.message('noModels'):'暂无可用模型')}" label="${escapeHtml(this.processor==='layer-decomposition'?this.message('noModelsHint'):'请前往模型设置添加可用模型')}"></ic-empty-state>`;
    return `<div class="ai-processor-field"><ic-select name="ai-processor-model" label="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" hierarchy="quiet" placement="top" value="${escapeHtml(this.selectedModel)}" data-component-variant="model-picker">
      ${this.models.map(model=>`<option value="${escapeHtml(model.id)}"${modelOptionAttributes(model)}${model.id===this.selectedModel?' selected':''}>${escapeHtml(model.providerName?`${model.name} · ${model.providerName}`:model.name)}</option>`).join('')}
      ${selectedModelIcon(selected)}<ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
    </ic-select></div>`;
  }
  reverseMarkup(){
    return `<div data-ai-processor-layout="reverse-prompt"><img data-ai-processor-source src="${escapeHtml(this.sourceImage)}" alt="${escapeHtml(this.sourceAlt)}"><section data-ai-processor-panel>
      ${this.groupSelectMarkup(false)}${this.templatesMarkup()}<ic-divider></ic-divider>${this.modelMarkup('分析模型')}
    </section></div>`;
  }
  outpaintMarkup(){
    const size=this.outpaintSize();
    return `<div data-ai-processor-layout="outpaint"><section data-outpaint-canvas-column>
      <div data-outpaint-stage style="--outpaint-fill:${escapeHtml(this.fillColor)}"><div data-outpaint-frame>
        <img data-outpaint-source src="${escapeHtml(this.sourceImage)}" alt="${escapeHtml(this.sourceAlt)}">
        ${['top','right','bottom','left','nw','ne','se','sw'].map(handle=>`<span data-outpaint-handle="${handle}" aria-hidden="true"></span>`).join('')}
      </div></div>
      <p data-outpaint-guidance>拖动边缘或角点扩展画布</p>
    </section><section data-ai-processor-panel>
      <div class="ai-processor-resolution"><span class="ai-processor-option-title">目标分辨率</span><strong data-outpaint-resolution>${size.width} × ${size.height}</strong><small data-outpaint-limit${this.outpaint.atLimit?'':' hidden'}>已达本地处理上限</small></div>
      <fieldset class="ai-processor-option-group"><legend>填充颜色</legend><div data-outpaint-color-options>
        <button type="button" data-fill-color="#ffffff" aria-label="白色" aria-pressed="${this.fillColor==='#ffffff'}"><span style="background:#ffffff"></span></button>
        <button type="button" data-fill-color="#000000" aria-label="黑色" aria-pressed="${this.fillColor==='#000000'}"><span style="background:#000000"></span></button>
        <span data-custom-color-option data-has-custom-color="${String(Boolean(this.customFillColor))}" data-selected="${String(Boolean(this.customFillColor)&&this.fillColor===this.customFillColor)}">
          <ic-color-field name="outpaint-custom-color" label="自定义颜色" value="${escapeHtml(this.customFillColor||this.fillColor)}" size="small"></ic-color-field>
          <span data-custom-color-hint aria-hidden="true"></span>
        </span>
      </div></fieldset>
      <div class="ai-processor-output-settings">
        ${this.modelMarkup('图像模型')}
        <div class="ai-processor-field ai-processor-generation-settings"><span class="ai-processor-option-title">画幅与分辨率</span><ic-generation-settings-picker name="outpaint-generation-settings" label="画幅与分辨率" ratio="${escapeHtml(this.outpaintAspectRatio)}" ratio-presets="adaptive,source,1:1,2:3,3:2,3:4,4:3,9:16,16:9,21:9,9:21" resolution="${escapeHtml(this.outpaintResolution)}" resolutions="auto,1k,2k,4k" ratio-label="画幅" resolution-label="分辨率" adaptive-label="自由" source-label="原图" resolution-auto-label="自动" ratio-variant="outpaint" hide-quality></ic-generation-settings-picker></div>
      </div>
      <div data-outpaint-prompt>
        <div data-outpaint-prompt-heading><span class="ai-processor-option-title">提示词</span>${this.groupSelectMarkup(true,false)}</div>
        ${this.templatesMarkup()}
        <ic-form-field aria-label="提示词" orientation="vertical" data-legal-combination="textarea-vertical" data-component-name="ic-form-field-textarea"><ic-textarea name="outpaint-prompt" aria-label="提示词" rows="3" resize="vertical" value="${escapeHtml(this.prompt)}"></ic-textarea></ic-form-field>
      </div>
    </section></div>`;
  }
  angleMarkup(){
    return `<div data-ai-processor-layout="angle-control" data-angle-controller><section data-angle-controller-column>${angleViewportMarkup()}</section><section data-ai-processor-panel>
      ${cameraControlsMarkup()}
      <div class="ai-processor-output-settings">
        ${this.modelMarkup('图像模型')}
        <div class="ai-processor-field ai-processor-generation-settings"><span class="ai-processor-option-title">画幅与分辨率</span><ic-generation-settings-picker name="angle-generation-settings" label="画幅与分辨率" ratio="${escapeHtml(this.angleAspectRatio)}" ratio-presets="source,square,portrait,landscape,portrait43,landscape43,story,wide,ultrawide" resolution="${escapeHtml(this.angleResolution)}" resolutions="auto,1k,2k,4k" ratio-label="画幅" resolution-label="分辨率" source-label="原图" resolution-auto-label="自动" ratio-variant="outpaint" hide-quality></ic-generation-settings-picker></div>
      </div>
      <ic-form-field label="生成提示词" orientation="vertical" data-legal-combination="textarea-vertical" data-component-name="ic-form-field-textarea"><ic-textarea data-angle-prompt name="angle-prompt" label="生成提示词" rows="8" resize="vertical" value="${escapeHtml(this.prompt)}"></ic-textarea></ic-form-field>
    </section></div>`;
  }
  lightingReferenceMarkup(){
    return `<div data-ai-processor-layout="lighting-reference" data-lighting-controller data-lighting-color-mode="temperature"><section data-lighting-controller-column>
      <div class="ai-lighting-stage"><div data-lighting-viewport role="img" aria-label="可拖拽的标准灯光球实时预览"></div><span data-lighting-drag-hint>拖拽调整主光方向</span>
        <figure data-lighting-source-context><img src="${escapeHtml(this.sourceImage)}" alt="${escapeHtml(this.sourceAlt)}"></figure>
      </div>
    </section><section data-ai-processor-panel>${lightingControlsMarkup()}</section></div>`;
  }
  layerDecompositionMarkup(){
    const model=this.currentModel();
    const resolutions=model?.resolutionTiers||[];
    const label=this.message('resolution');
    return `<div data-ai-processor-layout="layer-decomposition"><section data-layer-source-column>
      ${this.layerAuthoring.sourceMarkup()}
    </section><section data-ai-processor-panel>
      ${this.layerAuthoring.modeMarkup()}
      ${this.modelMarkup(this.message('model'))}
      ${model?`<div class="ai-processor-field ai-processor-layer-resolution"><span class="ai-processor-option-title">${escapeHtml(label)}</span><ic-segmented-control name="layer-resolution" label="${escapeHtml(label)}" value="${escapeHtml(this.layerResolution)}" size="small" data-legal-combination="single-label" data-layer-resolution-options>
        ${resolutions.map(value=>`<button type="button" data-value="${escapeHtml(value)}">${escapeHtml(value.toLowerCase()==='auto'?this.message('automatic'):value)}</button>`).join('')}
      </ic-segmented-control></div>`:''}
      ${this.layerAuthoring.controlsMarkup()}
      <ic-button data-layer-discard hidden hierarchy="quiet" size="small">${escapeHtml(this.layerAuthoring.t('discardUnsaved'))}</ic-button>
      <div data-layer-price><span>${escapeHtml(this.message('price'))}</span><strong>${escapeHtml(this.message('priceRange'))}</strong></div>
    </section></div>`;
  }
  renderBody(){
    if(!this.bodyElement) return;
    this.layerAuthoring.dispose();
    this.disposeAngleController();
    this.disposeLightingController();
    this.disposeOutpaintPreview();
    this.bodyElement.innerHTML=`${this.processor==='reverse-prompt'?this.reverseMarkup():this.processor==='outpaint'?this.outpaintMarkup():this.processor==='angle-control'?this.angleMarkup():this.processor==='layer-decomposition'?this.layerDecompositionMarkup():this.lightingReferenceMarkup()}<ic-alert data-ai-processor-error tone="danger"${this.errorMessage?'':' hidden'}>${escapeHtml(this.errorMessage)}</ic-alert>`;
    this.bindCommonControls();
    if(this.processor==='layer-decomposition') this.layerAuthoring.mount();
    if(this.processor==='outpaint'){ this.bindOutpaint(); this.syncOutpaintVisual(); }
    if(this.processor==='angle-control') this.mountAngleController();
    if(this.processor==='lighting-reference') this.mountLightingController();
  }
  bindCommonControls(){
    const group=this.bodyElement.querySelector('ic-select[name="ai-processor-group"]');
    group?.addEventListener('change',()=>this.selectGroup(group.value));
    this.bodyElement.querySelectorAll('[data-template-id]').forEach(choice=>choice.addEventListener('change',()=>this.selectTemplate(choice.dataset.templateId)));
    const model=this.bodyElement.querySelector('ic-select[name="ai-processor-model"]');
    model?.addEventListener('change',()=>{
      this.selectedModel=model.value;
      if(this.processor==='layer-decomposition'){
        this.reconcileLayerResolution(true);
        this.renderBody();
      }
      this.syncActions();
    });
    const textarea=this.bodyElement.querySelector('ic-textarea');
    if(this.processor!=='layer-decomposition') textarea?.addEventListener('input',()=>{ this.prompt=textarea.value; this.syncActions(); });
    const angleSettings=this.bodyElement.querySelector('ic-generation-settings-picker[name="angle-generation-settings"]');
    angleSettings?.addEventListener('ic-change',event=>{
      if(event.detail?.field==='ratio'&&ANGLE_ASPECT_RATIO_VALUES.has(event.detail.value)){
        this.angleAspectRatio=event.detail.value; angleSettings.ratio=this.angleAspectRatio;
      }
      if(event.detail?.field==='resolution'&&ANGLE_RESOLUTION_VALUES.has(event.detail.value)){
        this.angleResolution=event.detail.value; angleSettings.resolution=this.angleResolution;
      }
      this.syncActions();
    });
    const layerSettings=this.bodyElement.querySelector('ic-segmented-control[name="layer-resolution"]');
    layerSettings?.addEventListener('ic-change',event=>{
      if(this.currentModel()?.resolutionTiers.includes(event.detail.value)){
        this.layerResolution=event.detail.value;
      }
      this.syncActions();
    });
  }
  selectGroup(groupId){
    this.selectedGroup=this.groups.some(group=>group.id===groupId)?groupId:'';
    const templates=this.currentTemplates(); this.selectedTemplate='';
    if(this.processor==='reverse-prompt') this.selectedTemplate=templates[0]?.id||'';
    this.renderBody(); this.syncActions();
  }
  selectTemplate(templateId){
    const template=this.currentTemplates().find(item=>item.id===templateId);
    if(!template) return;
    this.selectedTemplate=templateId;
    this.bodyElement.querySelectorAll('[data-template-id]').forEach(choice=>{
      choice.checked=choice.dataset.templateId===templateId;
      choice.toggleAttribute('checked',choice.checked);
    });
    if(this.processor==='outpaint'){
      this.prompt=template.prompt;
      const textarea=this.bodyElement.querySelector('ic-textarea');
      if(textarea) textarea.value=this.prompt;
    }
    this.syncActions();
  }
  sourceSize(){ return {width:Math.max(1,Math.round(Number(this.sourceWidth)||1)),height:Math.max(1,Math.round(Number(this.sourceHeight)||1))}; }
  outpaintSize(){ const source=this.sourceSize(); return {width:source.width+this.outpaint.left+this.outpaint.right,height:source.height+this.outpaint.top+this.outpaint.bottom}; }
  validOutpaint(next){ const source=this.sourceSize(); const width=source.width+next.left+next.right; const height=source.height+next.top+next.bottom; return Math.max(width,height)<=OUTPAINT_LONG_EDGE_LIMIT && width*height<=OUTPAINT_PIXEL_LIMIT; }
  limitedOutpaint(start, proposed){
    const clean=Object.fromEntries(['left','right','top','bottom'].map(key=>[key,Math.max(0,Math.round(Number(proposed[key])||0))]));
    if(this.validOutpaint(clean)) return {...clean,atLimit:false};
    let low=0,high=1,best={...start};
    for(let index=0;index<24;index++){
      const amount=(low+high)/2;
      const candidate=Object.fromEntries(['left','right','top','bottom'].map(key=>[key,Math.max(0,Math.round(start[key]+(clean[key]-start[key])*amount))]));
      if(this.validOutpaint(candidate)){best=candidate;low=amount;}else high=amount;
    }
    return {...best,atLimit:true};
  }
  bindOutpaint(){
    this.bodyElement.querySelectorAll('[data-fill-color]').forEach(button=>button.addEventListener('click',()=>this.setFillColor(button.dataset.fillColor)));
    const custom=this.bodyElement.querySelector('ic-color-field');
    const applyCustomColor=()=>{ this.customFillColor=String(custom?.value||'').toLowerCase(); this.setFillColor(this.customFillColor); };
    custom?.addEventListener('input',applyCustomColor);
    custom?.addEventListener('change',applyCustomColor);
    const settings=this.bodyElement.querySelector('ic-generation-settings-picker[name="outpaint-generation-settings"]');
    settings?.addEventListener('ic-change',event=>{
      if(event.detail?.field==='ratio'&&OUTPAINT_ASPECT_RATIO_VALUES.has(event.detail.value)){
        this.applyOutpaintAspectRatio(event.detail.value); settings.ratio=this.outpaintAspectRatio;
      }
      if(event.detail?.field==='resolution'&&OUTPAINT_RESOLUTION_VALUES.has(event.detail.value)){
        this.outpaintResolution=event.detail.value; settings.resolution=this.outpaintResolution;
      }
      this.syncActions();
    });
    this.bodyElement.querySelectorAll('[data-outpaint-handle]').forEach(handle=>handle.addEventListener('pointerdown',event=>this.startOutpaintDrag(event,handle.dataset.outpaintHandle)));
    const stage=this.bodyElement.querySelector('[data-outpaint-stage]');
    if(stage&&typeof ResizeObserver==='function'){
      this.outpaintResizeObserver=new ResizeObserver(()=>this.fitOutpaintFrame());
      this.outpaintResizeObserver.observe(stage);
    }
    requestAnimationFrame(()=>this.fitOutpaintFrame());
  }
  disposeOutpaintPreview(){ this.outpaintResizeObserver?.disconnect?.(); this.outpaintResizeObserver=null; }
  setFillColor(color){
    if(!/^#[0-9a-f]{6}$/i.test(String(color||''))) return;
    this.fillColor=String(color).toLowerCase();
    this.bodyElement.querySelector('[data-outpaint-stage]')?.style.setProperty('--outpaint-fill',this.fillColor);
    this.bodyElement.querySelectorAll('[data-fill-color]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.fillColor===this.fillColor)));
    const customOption=this.bodyElement.querySelector('[data-custom-color-option]');
    if(customOption){
      customOption.dataset.hasCustomColor=String(Boolean(this.customFillColor));
      customOption.dataset.selected=String(Boolean(this.customFillColor)&&this.fillColor===this.customFillColor);
    }
  }
  startOutpaintDrag(event,handle){
    if(!this.validOutpaint({left:0,right:0,top:0,bottom:0})) return;
    event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId);
    this.drag={handle,pointerId:event.pointerId,x:event.clientX,y:event.clientY,start:{...this.outpaint}};
    const move=moveEvent=>this.moveOutpaintDrag(moveEvent);
    const end=()=>{ window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',end); this.drag=null; };
    window.addEventListener('pointermove',move); window.addEventListener('pointerup',end,{once:true});
  }
  moveOutpaintDrag(event){
    if(!this.drag) return;
    const frame=this.bodyElement.querySelector('[data-outpaint-frame]');
    const size=this.outpaintSize(); const rect=frame?.getBoundingClientRect();
    const scale=Math.max(0.0001,Math.min((rect?.width||1)/size.width,(rect?.height||1)/size.height));
    const dx=(event.clientX-this.drag.x)/scale,dy=(event.clientY-this.drag.y)/scale;
    const next={...this.drag.start}; const handle=this.drag.handle;
    if(handle==='left'||handle.includes('w')) next.left=this.drag.start.left-dx;
    if(handle==='right'||handle.includes('e')) next.right=this.drag.start.right+dx;
    if(handle==='top'||handle.includes('n')) next.top=this.drag.start.top-dy;
    if(handle==='bottom'||handle.includes('s')) next.bottom=this.drag.start.bottom+dy;
    const proposed=this.outpaintAspectRatio==='adaptive'?next:this.lockedOutpaint(next,handle);
    this.outpaint=this.limitedOutpaint(this.drag.start,proposed); this.syncOutpaintVisual(); this.syncActions();
  }
  lockedRatio(){
    const value=this.outpaintAspectRatio==='source'?this.automaticOutpaintPlan().value:this.outpaintAspectRatio;
    const [width,height]=String(value||'').split(':').map(Number);
    return width>0&&height>0?width/height:0;
  }
  lockedOutpaint(proposed,handle){
    const ratio=this.lockedRatio();
    if(!ratio) return proposed;
    const source=this.sourceSize(),start=this.drag?.start||this.outpaint;
    const clean=Object.fromEntries(['left','right','top','bottom'].map(key=>[key,Math.max(0,Number(proposed[key])||0)]));
    const proposedWidth=source.width+clean.left+clean.right;
    const proposedHeight=source.height+clean.top+clean.bottom;
    const startWidth=source.width+start.left+start.right;
    const startHeight=source.height+start.top+start.bottom;
    const west=handle==='left'||handle.includes('w');
    const east=handle==='right'||handle.includes('e');
    const north=handle==='top'||handle.includes('n');
    const south=handle==='bottom'||handle.includes('s');
    const horizontal=west||east,vertical=north||south;
    const widthChange=Math.abs(proposedWidth-startWidth)/Math.max(1,startWidth);
    const heightChange=Math.abs(proposedHeight-startHeight)/Math.max(1,startHeight);
    const driveWidth=horizontal&&!vertical||(horizontal&&vertical&&widthChange>=heightChange);
    let width,height;
    if(driveWidth){
      width=Math.max(source.width,Math.round(proposedWidth));
      height=Math.ceil(width/ratio);
      if(height<source.height){height=source.height;width=Math.ceil(height*ratio);}
    }else{
      height=Math.max(source.height,Math.round(proposedHeight));
      width=Math.ceil(height*ratio);
      if(width<source.width){width=source.width;height=Math.ceil(width/ratio);}
    }
    const horizontalSpace=Math.max(0,width-source.width);
    const verticalSpace=Math.max(0,height-source.height);
    const split=(total,negativeSide,positiveSide,negativeStart,positiveStart)=>{
      if(negativeSide&&!positiveSide){const positive=Math.min(total,Math.max(0,Math.round(positiveStart)));return [total-positive,positive];}
      if(positiveSide&&!negativeSide){const negative=Math.min(total,Math.max(0,Math.round(negativeStart)));return [negative,total-negative];}
      return [Math.floor(total/2),Math.ceil(total/2)];
    };
    const [left,right]=split(horizontalSpace,west,east,start.left,start.right);
    const [top,bottom]=split(verticalSpace,north,south,start.top,start.bottom);
    return {left,right,top,bottom};
  }
  ratioOutpaint(ratio){
    const source=this.sourceSize();
    const targetRatio=Math.max(0.0001,Number(ratio)||source.width/source.height);
    let width=source.width,height=source.height;
    if(source.width/source.height<targetRatio) width=Math.ceil(source.height*targetRatio);
    else height=Math.ceil(source.width/targetRatio);
    const horizontal=Math.max(0,width-source.width),vertical=Math.max(0,height-source.height);
    return {left:Math.floor(horizontal/2),right:Math.ceil(horizontal/2),top:Math.floor(vertical/2),bottom:Math.ceil(vertical/2)};
  }
  automaticOutpaintPlan(){
    const source=this.sourceSize();
    return OUTPAINT_ASPECT_RATIO_PRESETS.map(value=>{
      const [width,height]=value.split(':').map(Number);
      const outpaint=this.ratioOutpaint(width/height);
      const targetWidth=source.width+outpaint.left+outpaint.right;
      const targetHeight=source.height+outpaint.top+outpaint.bottom;
      return {value,outpaint,added:targetWidth*targetHeight-source.width*source.height,difference:Math.abs(width/height-source.width/source.height)};
    }).sort((a,b)=>a.added-b.added||a.difference-b.difference)[0]||{value:'',outpaint:{left:0,right:0,top:0,bottom:0}};
  }
  automaticOutpaint(){ return this.automaticOutpaintPlan().outpaint; }
  applyOutpaintAspectRatio(value){
    const next=OUTPAINT_ASPECT_RATIO_VALUES.has(value)?value:'adaptive';
    this.outpaintAspectRatio=next;
    if(next!=='adaptive'){
      const proposed=next==='source'?this.automaticOutpaint():this.ratioOutpaint((()=>{const [width,height]=next.split(':').map(Number);return width/height;})());
      this.outpaint=this.limitedOutpaint({left:0,right:0,top:0,bottom:0},proposed);
    }
    this.syncOutpaintVisual(); this.syncActions();
  }
  fitOutpaintFrame(){
    const stage=this.bodyElement?.querySelector('[data-outpaint-stage]');
    const frame=this.bodyElement?.querySelector('[data-outpaint-frame]');
    if(!stage||!frame||!stage.clientWidth||!stage.clientHeight) return;
    const style=getComputedStyle(stage);
    const availableWidth=Math.max(1,stage.clientWidth-parseFloat(style.paddingLeft||0)-parseFloat(style.paddingRight||0));
    const availableHeight=Math.max(1,stage.clientHeight-parseFloat(style.paddingTop||0)-parseFloat(style.paddingBottom||0));
    const target=this.outpaintSize();
    const scale=Math.min(availableWidth/target.width,availableHeight/target.height);
    frame.style.inlineSize=`${Math.max(1,target.width*scale)}px`;
    frame.style.blockSize=`${Math.max(1,target.height*scale)}px`;
  }
  syncOutpaintVisual(){
    if(this.processor!=='outpaint') return;
    const source=this.sourceSize(),target=this.outpaintSize();
    const frame=this.bodyElement.querySelector('[data-outpaint-frame]');
    if(frame) frame.style.aspectRatio=`${target.width} / ${target.height}`;
    const image=this.bodyElement.querySelector('[data-outpaint-source]');
    if(image){ image.style.left=`${this.outpaint.left/target.width*100}%`; image.style.top=`${this.outpaint.top/target.height*100}%`; image.style.width=`${source.width/target.width*100}%`; image.style.height=`${source.height/target.height*100}%`; }
    const resolution=this.bodyElement.querySelector('[data-outpaint-resolution]'); if(resolution) resolution.textContent=`${target.width} × ${target.height}`;
    const limit=this.bodyElement.querySelector('[data-outpaint-limit]'); if(limit) limit.hidden=!this.outpaint.atLimit;
    this.fitOutpaintFrame();
  }
  async mountAngleController(){
    const root=this.bodyElement.querySelector('[data-angle-controller]');
    if(!root) return;
    const module=await import('../angle-3d.js?v=2026.08.17.2');
    if(!root.isConnected||this.processor!=='angle-control') return;
    this.angleController=module.createAngleCameraController(root,{sourceImage:this.sourceImage,promptInput:this.bodyElement.querySelector('[data-angle-prompt]'),promptSuffix:ANGLE_PROMPT_SUFFIX});
    root.addEventListener('angle-controller-change',event=>{
      this.angleState={horizontal:event.detail.horizontal,vertical:event.detail.vertical,distance:event.detail.distance,command:event.detail.command};
      this.prompt=event.detail.prompt; this.syncActions();
    });
  }
  disposeAngleController(){ this.angleController?.dispose?.(); this.angleController=null; }
  async mountLightingController(){
    const mountToken=++this.lightingMountToken;
    const root=this.bodyElement.querySelector('[data-lighting-controller]');
    if(!root) return;
    const {createLightingReferenceController}=await import('/static/js/smart-canvas/lighting-reference-controller.js?v=2026.08.30.i18n-audit.1');
    if(mountToken!==this.lightingMountToken||!root.isConnected||this.processor!=='lighting-reference') return;
    this.lightingController=createLightingReferenceController(root,{intent:this.lightingIntent});
    this.lightingControllerRoot=root;
    this.lightingChangeHandler=event=>{
      this.lightingIntent=event.detail.intent;
      this.lightingPrompts=event.detail.prompts;
      this.syncActions();
    };
    root.addEventListener('lighting-controller-change',this.lightingChangeHandler);
    this.lightingIntent=this.lightingController?.state?.()||null;
    if(this.lightingIntent) this.lightingPrompts=globalThis.InfiniteCanvasLightingIntent?.compileLightingPrompts?.(this.lightingIntent)||null;
    this.syncActions();
  }
  disposeLightingController(){
    this.lightingMountToken+=1;
    this.lightingControllerRoot?.removeEventListener?.('lighting-controller-change',this.lightingChangeHandler);
    this.lightingController?.dispose?.();
    this.lightingController=null;
    this.lightingControllerRoot=null;
    this.lightingChangeHandler=null;
  }
  syncActions(){
    if(!this.cancelAction||!this.confirmAction) return;
    this.cancelAction.textContent=this.processor==='layer-decomposition'?this.message('cancel'):'取消'; this.cancelAction.disabled=this.pending;
    this.confirmAction.textContent=this.processor==='reverse-prompt'?'开始反推':this.processor==='outpaint'?'开始扩图':this.processor==='angle-control'?'生成新视角':this.processor==='layer-decomposition'?this.message('submit'):'创建灯光参考';
    this.confirmAction.loading=this.pending; this.confirmAction.disabled=this.pending||Boolean(this.validateContract())||Boolean(this.submissionReason());
    const error=this.bodyElement?.querySelector('[data-ai-processor-error]');
    if(error){ error.textContent=this.errorMessage; error.hidden=!this.errorMessage; }
  }
  setError(message=''){ this.errorMessage=String(message||''); this.syncActions(); }
  detail(){
    const template=this.currentTemplates().find(item=>item.id===this.selectedTemplate)||null;
    if(this.processor==='layer-decomposition') this.prompt=this.layerAuthoring.prompt();
    return {processor:this.processor,groupId:this.selectedGroup,templateId:this.selectedTemplate,template,modelId:this.selectedModel,prompt:String(this.prompt||''),fillColor:this.fillColor,outpaintAspectRatio:this.outpaintAspectRatio,outpaintResolution:this.outpaintResolution,outpaint:{...this.outpaint,...this.outpaintSize()},angleAspectRatio:this.angleAspectRatio,angleResolution:this.angleResolution,angle:{...this.angleState},layerResolution:this.layerResolution,lightingIntent:this.lightingIntent?JSON.parse(JSON.stringify(this.lightingIntent)):null,lightingPrompts:this.lightingPrompts?{...this.lightingPrompts}:null};
  }
  async cancel(){ if(this.pending)return; const event=new CustomEvent('ic-cancel',{bubbles:true,composed:true,cancelable:true}); if(this.dispatchEvent(event)) await this.hide('cancel'); }
  confirm(){
    if(this.pending||this.validateContract()) return;
    const reason=this.submissionReason(); if(reason){this.setError(reason);return;}
    this.setError(''); this.dispatchEvent(new CustomEvent('ic-confirm',{bubbles:true,composed:true,cancelable:true,detail:this.detail()}));
  }
  async requestClose(source){
    if(this.pending) return;
    await super.requestClose(source);
    if(!this.open){
      this.layerAuthoring.dispose();
      this.disposeAngleController();
      this.disposeLightingController();
      this.openProcessor=''; this.drag=null;
    }
  }
  firstInvalidOrTaskControl(){ return this.bodyElement?.querySelector('ic-number-input,ic-select,ic-segmented-control,ic-generation-settings-picker,ic-aspect-ratio-picker,ic-checkbox,ic-textarea,[data-outpaint-handle]')||this.cancelAction||super.firstInvalidOrTaskControl(); }
  updated(changed){
    this.ensureOwnedStructure();
    if(this.processor==='layer-decomposition'&&changed.has('messages')) this.label=this.message('title');
    const structural=['processor','groups','models','messages','sourceImage','sourceAlt','sourceWidth','sourceHeight','selectedGroup'];
    if(structural.some(key=>changed.has(key))) this.renderBody();
    this.syncActions(); super.updated(changed);
  }
}
