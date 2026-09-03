"""Media identity labels describe delivered content, not the next Composer run."""
import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class MediaIdentityBadgeTests(unittest.TestCase):
    def test_actual_media_origin_kind_and_filename(self):
        script = (ROOT / 'static/js/smart-canvas.js').read_text()
        start = script.index('function imageNameLabel(')
        end = script.index('function thumbDisplaySize(', start)
        code = r'''
const assert = require('node:assert/strict');
let dictionary = {};
let language = 'zh';
const window = {StudioI18n:{register:entries => Object.assign(dictionary, entries)}};
const tr = key => dictionary[key]?.[language] || key;
const mediaKindForItem = item => item?.kind || 'image';
const fileNameFromUrl = url => url.split('/').pop();
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const escapeAttr = escapeHtml;
''' + (ROOT / 'static/js/i18n/smart-canvas.js').read_text() + script[start:end] + r'''
const pairs = [
 ['image', false, 'image', '已导入', 'Imported'],
 ['video', false, 'video', '已导入', 'Imported'],
 ['audio', false, 'audio-lines', '已导入', 'Imported'],
 ['image', true, 'image', 'AI 生成', 'AI generated'],
 ['video', true, 'video', 'AI 生成', 'AI generated'],
 ['audio', true, 'audio-lines', 'AI 生成', 'AI generated'],
];
for(const [kind,generated,icon,zh,en] of pairs){
 const item = {url:'/media/opaque-id',kind,name:'custom name',generatedResult:generated};
 // A subsequent Composer mode change must never relabel an existing result.
 const node = {generationOutputNode:true,runSettings:{apiKind:kind === 'video' ? 'image' : 'video'}};
 language='zh';
 assert.match(imageNameBadgeHtml(item,{node}),new RegExp(`title="${zh} · custom name"`));
 assert.match(imageNameBadgeHtml(item,{node}),new RegExp(`name="${icon}"`));
 language='en';
 assert.match(imageNameBadgeHtml(item,{node}),new RegExp(`title="${en} · custom name"`));
}
language='zh';
const legacyItem = {url:'/media/legacy',kind:'image',name:'legacy.png'};
assert.match(imageNameBadgeHtml(legacyItem),/title="已导入 · legacy.png"/);
assert.match(imageNameBadgeHtml(legacyItem,{node:{runSettings:{apiKind:'video'}}}),/title="已导入 · legacy.png"/);
for(const node of [{generationOutputNode:true},{generationOperationId:'operation-1'},{generationBatchId:'batch-1'}]){
 assert.match(imageNameBadgeHtml(legacyItem,{node}),/title="AI 生成 · legacy.png"/);
 assert.match(imageNameBadgeHtml({...legacyItem,generatedResult:false},{node}),/title="已导入 · legacy.png"/);
}
// A mixed node must keep the per-item generation marker authoritative.
const mixedNode = {generationOutputNode:true,uploadedAttachment:true};
assert.match(imageNameBadgeHtml({...legacyItem,generatedResult:true},{node:mixedNode}),/title="AI 生成 · legacy.png"/);
assert.match(imageNameBadgeHtml(legacyItem,{node:mixedNode}),/title="已导入 · legacy.png"/);
const rawName='"cat" <draft>.png';
const item={...legacyItem,name:rawName};
const markup=imageNameBadgeHtml(item,{outside:true});
assert.match(markup,/已导入/);
assert.match(markup,/image-name-badge-outside/);
assert.match(markup,/data-image-name="1"/);
assert.match(markup,/name="image" size="x-small" aria-hidden="true"/);
assert.match(markup,/&quot;cat&quot; &lt;draft&gt;.png/);
assert.equal(item.name,rawName);
assert.equal(imageNameBadgeHtml({}), '');
assert.equal(imageNameBadgeHtml({url:'/note.txt',kind:'text',name:'note.txt'}).includes('已导入'),false);
console.log(JSON.stringify({cases:pairs.length,legacy:true,mixed:true,filename:true,languageSwitch:true}));
'''
        result = subprocess.run(['node', '-e', code], cwd=ROOT, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)['cases'], 6)


if __name__ == '__main__':
    unittest.main()
