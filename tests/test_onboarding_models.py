import unittest
from infinite_canvas.onboarding_models import recommended_models

class RecommendedModelsTests(unittest.TestCase):
    def test_requested_families_and_version_boundaries(self):
        result = recommended_models({
            'image_models':['gpt-image-1','gpt-image-2','nano-banana','nanobanana-pro','gemini-3-pro-image-preview','flux-2','dall-e-3'],
            'video_models':['seedance1.5pro','doubao-seedance-2-0-fast-260128','seedance2.5','seedance-2.0-global/text-to-video','sora-2'],
            'chat_models':['gpt-5','gpt-5.4','gpt-5.5','gpt-5.10','gpt-6','gpt-5-20250901','gpt-5.5-image','claude-4'],
        })
        self.assertEqual(['gpt-image-1','gpt-image-2','nano-banana','nanobanana-pro','gemini-3-pro-image-preview'],result['image_models'])
        self.assertEqual(['doubao-seedance-2-0-fast-260128','seedance2.5','seedance-2.0-global/text-to-video'],result['video_models'])
        self.assertEqual(['gpt-5.5','gpt-5.10','gpt-6'],result['chat_models'])

    def test_gemini_latest_two_distinct_models_not_snapshots(self):
        result = recommended_models({'chat_models':['gemini-2.5-pro','gemini-3-flash','gemini-3.1-pro-preview','gemini-3.1-pro','gemini-3.1-pro-20260101','gemini-3.1-flash-image','gemini-3-flash-lite']})
        self.assertEqual(['gemini-3.1-pro','gemini-3-flash'],result['chat_models'])

    def test_empty_selection_does_not_fall_back_and_protocols_are_filtered(self):
        self.assertFalse(any(recommended_models({'image_models':['flux-2']}).values()))
        result=recommended_models({'image_models':['gpt-image-2','gpt-image-2',None], 'model_protocols':{'gpt-image-2':'apimart','flux-2':'openai'}})
        self.assertEqual(['gpt-image-2'],result['image_models'])
        self.assertEqual({'gpt-image-2':'apimart'},result['model_protocols'])

    def test_antigravity_auto_is_limited_to_image_and_text(self):
        result = recommended_models({
            'image_models': ['auto', 'auto', 'flux-2'],
            'chat_models': ['auto', 'claude-4'],
            'video_models': ['auto'],
        }, service='gemini-cli')
        self.assertEqual(['auto'], result['image_models'])
        self.assertEqual(['auto'], result['chat_models'])
        self.assertEqual([], result['video_models'])

    def test_auto_exception_does_not_apply_to_other_services(self):
        catalog = {'image_models': ['auto'], 'chat_models': ['auto'], 'protocol': 'gemini-cli'}
        for service in ('', 'apimart', 'modelscope', 'other', 'codex', 'jimeng'):
            with self.subTest(service=service):
                self.assertFalse(any(recommended_models(catalog, service=service).values()))
