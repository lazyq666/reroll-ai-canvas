import hashlib
import json
import re
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "static/js/smart-canvas.js"
MEDIA_NAMING = ROOT / "static/js/smart-canvas/media-naming.js"
I18N = ROOT / "static/js/i18n/smart-canvas.js"
PAGE = ROOT / "static/smart-canvas.html"


class MediaNamingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = HOST.read_text(encoding="utf-8")
        cls.media_naming = MEDIA_NAMING.read_text(encoding="utf-8")

    def run_node(self, source: str) -> dict:
        result = subprocess.run(
            ["node", "-e", source],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_generation_output_script_reference_matches_its_content(self):
        # A cached pre-rename module can overwrite the server's short name
        # with the provider filename when the browser saves completed output.
        asset = ROOT / "static/js/smart-canvas/generation-output.js"
        expected = "asset-" + hashlib.sha256(asset.read_bytes()).hexdigest()[:12]
        reference = re.search(
            r'/static/js/smart-canvas/generation-output\.js\?v=([^"\']+)',
            PAGE.read_text(encoding="utf-8"),
        )
        self.assertIsNotNone(reference)
        self.assertEqual(reference.group(1), expected)

    def test_download_name_uses_media_name_and_preserves_actual_format(self):
        start = self.source.index("function safeExportFileName")
        end = self.source.index("function downloadPreviewImage", start)
        functions = self.source[start:end]
        payload = self.run_node(
            f"""
const window = {{location:{{href:'http://localhost/'}}}};
{self.media_naming}
const tr = key => key;
const trf = (key, values) => `${{key}}:${{values.extension || ''}}`;
const mediaKindForItem = item => item?.kind || 'image';
const imageNameLabel = item => String(item?.name || fileNameFromUrl(item?.url || '') || 'image').trim();
{functions}
const cases = [
  downloadNameForMediaItem({{url:'/assets/internal-id.png',kind:'image',name:'角色正面'}},'image'),
  downloadNameForMediaItem({{url:'/assets/internal-id.png',kind:'image',name:'角色.v2'}},'image'),
  downloadNameForMediaItem({{url:'/assets/internal-id.png',kind:'image',name:'图片.png.png'}},'image'),
  downloadNameForMediaItem({{url:'/assets/audio.wav',kind:'audio',name:'开场旁白'}},'audio'),
];
const validation = [
  validateMediaNameInput('角色.v2',{{url:'/assets/internal-id.png',kind:'image'}}),
  validateMediaNameInput('图片.png.png',{{url:'/assets/internal-id.png',kind:'image'}}),
  validateMediaNameInput('伪装.mp3',{{url:'/assets/audio.wav',kind:'audio'}}),
  validateMediaNameInput('bad/name',{{url:'/assets/internal-id.png',kind:'image'}}),
];
console.log(JSON.stringify({{cases,validation}}));
"""
        )
        self.assertEqual(
            payload["cases"],
            ["角色正面.png", "角色.v2.png", "图片.png", "开场旁白.wav"],
        )
        self.assertEqual(payload["validation"][0]["name"], "角色.v2.png")
        self.assertEqual(payload["validation"][1]["name"], "图片.png")
        self.assertTrue(payload["validation"][2]["error"].startswith("smart.mediaNameExtensionMismatch"))
        self.assertEqual(payload["validation"][3]["error"], "smart.mediaNameInvalid")

    def test_rename_target_is_relocated_by_stable_identity(self):
        start = self.source.index("function smartMediaRenameLocator")
        end = self.source.index("async function renameSmartNodeImage", start)
        functions = self.source[start:end]
        payload = self.run_node(
            f"""
const mediaKindForItem = item => item?.kind || 'image';
const window = {{}};
{self.media_naming}
{functions}
const generated = {{url:'generated.png',kind:'image',outputId:'output-2'}};
const generatedLocator = smartMediaRenameLocator(generated);
const generatedNode = {{images:[{{url:'first.png',kind:'image',outputId:'output-1'}},generated]}};
generatedNode.images.reverse();
const moved = smartFindMediaRenameTarget(generatedNode,generatedLocator);
const imported = {{url:'imported.png',kind:'image'}};
const importedLocator = smartMediaRenameLocator(imported);
const importedNode = {{images:[{{url:'other.png',kind:'image'}},imported]}};
const referenced = smartFindMediaRenameTarget(importedNode,importedLocator);
const ambiguous = smartFindMediaRenameTarget(
  {{images:[{{url:'imported.png',kind:'image'}},{{url:'imported.png',kind:'image'}}]}},
  importedLocator,
);
console.log(JSON.stringify({{moved:moved?.index,referenced:referenced?.index,ambiguous:ambiguous === null}}));
"""
        )
        self.assertEqual(payload, {"moved": 0, "referenced": 1, "ambiguous": True})

    def test_context_menu_and_localized_copy_cover_media_rename(self):
        self.assertIn(
            "smartContextMenuItem('rename-media', tr('smart.contextRenameMedia'), 'edit')",
            self.source,
        )
        self.assertIn("if(action === 'rename-media')", self.source)
        self.assertIn("title:tr('smart.renameMedia')", self.source)
        self.assertIn("SmartCanvasModules.mediaNaming", self.source)
        self.assertIn(
            '/static/js/smart-canvas/media-naming.js',
            PAGE.read_text(encoding="utf-8"),
        )
        translations = I18N.read_text(encoding="utf-8")
        for key in (
            "smart.contextRenameMedia",
            "smart.renameMedia",
            "smart.mediaName",
            "smart.mediaNameExtensionMismatch",
            "smart.mediaRenameTargetMissing",
        ):
            self.assertIn(f'"{key}"', translations)


if __name__ == "__main__":
    unittest.main()
