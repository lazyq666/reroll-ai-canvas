const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {test} = require('node:test');
const source = fs.readFileSync('static/js/comfyui-settings.js','utf8');
const snippet = (start,end) => source.slice(source.indexOf(start), source.indexOf(end,source.indexOf(start)));
function setup(){
  const messages={};let lang='zh';
  const previewDescription={dataset:{i18n:'comfy.previewDesc'},textContent:'这里展示画布中的实际选项。填写后可点击“测试运行”。'};
  const sandbox = {window:{StudioI18n:{register:values=>Object.assign(messages,values)}},
    currentCapability:{adapter:'h3',output_kind:'video'},selectedName:'custom/H3.json',currentConfig:{fields:[{id:'prompt',type:'textarea'}]},
    document:{querySelector:()=>previewDescription},previewDescription,
    previewCard:{innerHTML:''},escapeHtml:String,escapeAttr:String,runResult:null,
    tr:key=>messages[key]?.[lang] || key,setStatus:()=>{},fetch:()=>{throw new Error('H3 settings preview must not start a legacy run');},
    renderPreviewField:()=>'<ic-textarea></ic-textarea>'};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('static/js/i18n/comfyui-settings.js','utf8'),sandbox);
  vm.runInContext(snippet('function workflowUsesComposer(', 'function renderPreviewField('),sandbox);
  vm.runInContext(snippet('function renderMiniCanvasPreview(', 'function miniLineBetween('),sandbox);
  vm.runInContext(snippet('async function onRun(', 'function fieldsFromMiniCanvas('),sandbox);
  return {sandbox,setLanguage:value=>lang=value};
}
test('H3 replaces both preview run surfaces with localized canvas guidance',async()=>{
  const {sandbox,setLanguage}=setup();
  sandbox.renderPreview();assert.match(sandbox.previewCard.innerHTML,/画布的视频模型菜单/);assert.doesNotMatch(sandbox.previewCard.innerHTML,/runBtn|onRun|textarea/);
  const mini={};sandbox.renderMiniCanvasPreview(mini,true);assert.equal(mini.innerHTML,sandbox.previewCard.innerHTML);
  setLanguage('en');sandbox.renderPreview();assert.match(sandbox.previewCard.innerHTML,/video model menu/);
  await sandbox.onRun();
});
test('generic workflows keep the existing editable test preview',()=>{
  const {sandbox}=setup();sandbox.currentCapability=null;
  sandbox.renderPreview();assert.match(sandbox.previewCard.innerHTML,/runBtn/);assert.match(sandbox.previewCard.innerHTML,/ic-textarea/);
});


test('the preview introduction changes with H3 selection and language',()=>{
  const {sandbox,setLanguage}=setup();
  sandbox.renderPreview();
  assert.equal(sandbox.previewDescription.dataset.i18n,'comfy.h3PreviewDesc');
  assert.doesNotMatch(sandbox.previewDescription.textContent,/测试运行/);
  assert.match(sandbox.previewDescription.textContent,/画布/);
  setLanguage('en');sandbox.renderPreview();
  assert.match(sandbox.previewDescription.textContent,/canvas/);
  sandbox.currentCapability=null;sandbox.renderPreview();
  assert.equal(sandbox.previewDescription.dataset.i18n,'comfy.previewDesc');
  assert.match(sandbox.previewDescription.textContent,/Test run/);
});
