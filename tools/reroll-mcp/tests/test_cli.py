"""Public CLI results, filesystem delivery and HTTP requests with a local fixture."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import httpx
from PIL import Image

PACKAGE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE))
from bridge import Bridge


class CliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name).resolve()
        stream = io.BytesIO()
        Image.new('RGB', (30, 40), '#ff0000').save(stream, 'PNG')
        self.png = stream.getvalue()
        self.image = self.directory / 'character.png'
        self.image.write_bytes(self.png)
        self.calls = []
        self.submissions = []
        self.status = 'succeeded'
        self.download_status = 200
        self.transport_failure = False
        self.capability = {
            'support_state':'supported',
            'inputs': {'image': {'minimum': 1, 'maximum': 2}},
            'parameters': {
                'aspect_ratio': {'values': ['1:1', '3:4'], 'default': '1:1', 'required': True},
                'resolution_tier': {'values': ['1K', '2K'], 'default': '2K', 'required': True}},
        }
        self.client = httpx.Client(base_url='http://test/', transport=httpx.MockTransport(self.handle))
        self.addCleanup(self.client.close)

    def run_cli(self, args, **kwargs):
        from reroll_cli import main
        out, err = io.StringIO(), io.StringIO()
        def factory(url, **options):
            options['token'] = 'fixture-secret'
            return Bridge(url, client=self.client, **options)
        with patch.dict(os.environ, {'REROLL_URL': 'http://test', 'REROLL_LANGUAGE': 'en'}), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = main(args, bridge_factory=factory, **kwargs)
        return code, json.loads(out.getvalue()), err.getvalue()

    def handle(self, request):
        self.calls.append(request)
        path = request.url.path
        if path == '/api/agent/v1/models':
            return httpx.Response(200, json={'models': [{'provider_id':'fixture','model':'native','kind':'image'}], 'media_upload': {'maximum_bytes': 1024 * 1024, 'extensions':['.png','.jpg']}})
        if path.startswith('/api/agent/v1/models/'):
            return httpx.Response(200, json=self.capability)
        if path == '/api/agent/v1/media':
            return httpx.Response(200, json={'media_id':'same-image'})
        if path.startswith('/api/agent/v1/image-runs/by-request/'):
            return httpx.Response(404,json={'code':'run_not_found'})
        if path == '/api/agent/v1/image-runs':
            body = json.loads(request.content)
            self.submissions.append(body)
            if self.transport_failure:
                raise httpx.ReadError('secret transport details must not escape')
            return httpx.Response(200, json=self.run_payload(body))
        if path == '/api/agent/v1/image-runs/run-one':
            return httpx.Response(200, json=self.run_payload())
        if path == '/api/agent/v1/image-runs/run-one/outputs/0':
            return httpx.Response(self.download_status, content=self.png)
        raise AssertionError(path)

    def run_payload(self, body=None):
        body = body or {'request_id':'original','provider_id':'fixture','model':'native','images':[]}
        return {'status':self.status,'request_id':body['request_id'],'run_id':'run-one','provider_id':'fixture','model':'native',
            'operation':'image.edit' if body['images'] else 'image.generate',
            'settings':{'requested_ratio':body.get('ratio'),'ratio':body.get('ratio','1:1'),'requested_resolution':body.get('resolution'),'resolution':body.get('resolution','2K')},
            'inputs':[{'index':i+1, **item} for i,item in enumerate(body['images'])],
            'outputs':[{'name':'../../output.wrong','download_url':'/api/agent/v1/image-runs/run-one/outputs/0','width':99,'height':99}] if self.status == 'succeeded' else [],'error':None}

    def test_generate_preserves_prompt_downloads_actual_format_and_never_overwrites(self):
        args = ['generate','line one\nline two','--provider','fixture','--model','native','--ratio','3:4','--resolution','2k','--output',str(self.directory),'--json']
        first = self.run_cli(args)
        second = self.run_cli(args)
        self.assertEqual(0, first[0])
        result = first[1]
        self.assertEqual('line one\nline two', self.submissions[0]['prompt'])
        self.assertEqual('2k', self.submissions[0]['resolution'])
        self.assertNotEqual(self.submissions[0]['request_id'],self.submissions[1]['request_id'])
        self.assertEqual((30,40),(result['outputs'][0]['width'],result['outputs'][0]['height']))
        path = Path(result['outputs'][0]['path'])
        self.assertEqual('.png',path.suffix)
        self.assertEqual(self.directory,path.parent)
        self.assertEqual(self.png,path.read_bytes())
        self.assertNotEqual(str(path),second[1]['outputs'][0]['path'])

    def test_process_rejects_exact_pixel_flags_with_one_json_object(self):
        process = subprocess.run([sys.executable,str(PACKAGE/'reroll_cli.py'),'generate','hi','--provider','fixture','--model','native','--size','1024x1024','--json'],capture_output=True,text=True)
        self.assertEqual(2,process.returncode)
        self.assertEqual('usage_error',json.loads(process.stdout)['error']['code'])


    def generate_args(self, *extra):
        return ['generate','preserve me','--provider','fixture','--model','native','--output',str(self.directory),'--json',*extra]

    def test_ordered_duplicate_images_use_bytes_only_and_keep_both_instances(self):
        code, result, _ = self.run_cli(self.generate_args('--image',str(self.image),'--image',str(self.image),'--ratio','3:4'))
        self.assertEqual(0,code)
        body = self.submissions[0]
        self.assertEqual([{'media_id':'same-image','name':'character.png'}]*2,body['images'])
        self.assertEqual('image.edit',result['operation'])
        self.assertEqual([1,2],[item['index'] for item in result['inputs']])
        uploads = [request for request in self.calls if request.url.path == '/api/agent/v1/media']
        self.assertEqual(2,len(uploads))
        self.assertTrue(all(str(self.directory).encode() not in request.content for request in uploads))

    def test_all_images_validate_before_any_upload(self):
        invalid = self.directory/'bad.png'
        invalid.write_bytes(b'not an image')
        code,result,_ = self.run_cli(self.generate_args('--image',str(self.image),'--image',str(invalid),'--ratio','3:4'))
        self.assertEqual(1,code)
        self.assertEqual('invalid_image',result['error']['code'])
        self.assertFalse(any(request.method == 'POST' for request in self.calls))

    def test_invalid_model_parameters_and_reference_limits_never_submit(self):
        cases = [(['--ratio','7:8'],'invalid_ratio'),(['--resolution','8K'],'invalid_resolution'),
            (['--ratio','auto'],'invalid_auto_ratio'),
            (['--image',str(self.image),'--image',str(self.image)],'explicit_ratio_required'),
            (['--image',str(self.image),'--image',str(self.image),'--image',str(self.image),'--ratio','1:1'],'invalid_reference_count')]
        for flags,expected in cases:
            with self.subTest(expected=expected):
                self.calls.clear()
                code,result,_ = self.run_cli(self.generate_args(*flags))
                self.assertEqual(1,code)
                self.assertEqual(expected,result['error']['code'])
                self.assertFalse(any(request.method == 'POST' for request in self.calls))

    def test_omitted_unsupported_resolution_is_not_sent_and_no_default_requires_value(self):
        self.capability['parameters'].pop('resolution_tier')
        code,result,_ = self.run_cli(self.generate_args())
        self.assertEqual(0,code)
        self.assertNotIn('resolution',self.submissions[0])
        self.capability['parameters']['aspect_ratio'].pop('default')
        code,result,_ = self.run_cli(self.generate_args())
        self.assertEqual(1,code)
        self.assertEqual('ratio_required',result['error']['code'])
        self.assertEqual(1,len(self.submissions))

    def test_unknown_submission_reuses_request_identity_for_transport_retries(self):
        self.transport_failure = True
        code,result,_ = self.run_cli(self.generate_args('--request-id','retry-one'))
        self.assertEqual(4,code)
        self.assertEqual('unknown',result['status'])
        self.assertIsNone(result['run_id'])
        self.assertEqual('retry-one',result['request_id'])
        self.assertEqual(['retry-one']*3,[item['request_id'] for item in self.submissions])
        self.assertEqual({'retry-one'},{request.headers['Idempotency-Key'] for request in self.calls if request.url.path == '/api/agent/v1/image-runs'})
        self.assertNotIn('secret transport',json.dumps(result))

    def test_pending_and_failed_download_preserve_original_run_for_result(self):
        self.status='running'
        ticks=iter([0,0,901])
        code,result,_=self.run_cli(self.generate_args(),clock=lambda:next(ticks))
        self.assertEqual(3,code)
        self.assertEqual('pending',result['status'])
        self.assertEqual('run-one',result['run_id'])
        self.assertFalse(any('cancel' in request.url.path for request in self.calls))
        self.status='succeeded'
        self.download_status=500
        code,result,_=self.run_cli(['result','run-one','--output',str(self.directory),'--json'])
        self.assertEqual(1,code)
        self.assertEqual('download_failed',result['error']['code'])
        self.assertEqual('run-one',result['run_id'])
        self.assertFalse(list(self.directory.glob('.reroll-download-*')))
        self.download_status=200
        code,result,_=self.run_cli(['result','run-one','--output',str(self.directory),'--json'])
        self.assertEqual(0,code)
        self.assertEqual(1,len(self.submissions))

    def test_models_exposes_both_operation_capabilities(self):
        code,result,_=self.run_cli(['models','--json'])
        self.assertEqual(0,code)
        self.assertEqual({'image.generate','image.edit'},set(result['models'][0]['operations']))
        self.assertEqual(['1K','2K'],result['models'][0]['operations']['image.edit']['parameters']['resolution_tier']['values'])


    def test_existing_request_reconciles_before_current_model_and_upload_checks(self):
        import hashlib
        existing = {'request_id':'accepted','prompt':'preserve me','provider_id':'fixture','model':'native',
                    'images':[{'media_id':hashlib.sha256(self.png).hexdigest(),'name':'character.png'}],
                    'ratio':'3:4','resolution':'2k'}
        original_handle = self.handle
        def handle(request):
            if request.url.path == '/api/agent/v1/image-runs/by-request/accepted':
                self.calls.append(request)
                return httpx.Response(200,json=self.run_payload(existing))
            if request.url.path == '/api/agent/v1/image-runs':
                self.calls.append(request)
                payload=json.loads(request.content)
                self.submissions.append(payload)
                return httpx.Response(200,json=self.run_payload(existing)) if payload == existing else httpx.Response(409,json={'code':'request_conflict'})
            if request.url.path in ('/api/agent/v1/models','/api/agent/v1/media'):
                self.fail('Accepted requests must not depend on current model or upload limits')
            return original_handle(request)
        self.client._transport=httpx.MockTransport(handle)
        args=self.generate_args('--request-id','accepted','--image',str(self.image),'--ratio','3:4','--resolution','2k')
        code,result,_=self.run_cli(args)
        self.assertEqual(0,code)
        self.assertEqual(existing,self.submissions[0])
        self.assertEqual('run-one',result['run_id'])
        changed=list(args)
        changed[1]='a different prompt'
        code,result,_=self.run_cli(changed)
        self.assertEqual(1,code)
        self.assertEqual('request_conflict',result['error']['code'])

    def test_empty_enum_is_not_an_applicable_required_parameter(self):
        self.capability['parameters']['resolution_tier']={'required':True,'values':[]}
        code,result,_=self.run_cli(self.generate_args())
        self.assertEqual(0,code)
        self.assertNotIn('resolution',self.submissions[0])

    def test_server_error_details_redact_credentials_and_do_not_echo_messages(self):
        original_handle=self.handle
        def handle(request):
            if request.url.path == '/api/agent/v1/image-runs':
                return httpx.Response(403,json={'code':'confirmation_required',
                    'message':'leaked fixture-secret',
                    'details':{'api_key':'secret','hint':'fixture-secret and reroll_agent_verysecret','allowed':['1K','2K']}})
            return original_handle(request)
        self.client._transport=httpx.MockTransport(handle)
        code,result,_=self.run_cli(self.generate_args())
        self.assertEqual(1,code)
        self.assertEqual('confirmation_required',result['error']['code'])
        text=json.dumps(result)
        self.assertNotIn('fixture-secret',text)
        self.assertNotIn('verysecret',text)
        self.assertNotIn('api_key',text)
        self.assertEqual(['1K','2K'],result['error']['details']['allowed'])

    def test_interruption_preserves_request_identity_and_does_not_cancel(self):
        original_handle=self.handle
        def handle(request):
            if request.url.path == '/api/agent/v1/image-runs':
                raise KeyboardInterrupt()
            return original_handle(request)
        self.client._transport=httpx.MockTransport(handle)
        code,result,_=self.run_cli(self.generate_args('--request-id','interrupted-request'))
        self.assertEqual(130,code)
        self.assertEqual('interrupted-request',result['request_id'])
        self.assertEqual('unknown',result['status'])
        self.assertFalse(any('cancel' in request.url.path for request in self.calls))

    def test_transport_timeouts_use_remaining_wait_budget(self):
        self.status='running'
        ticks=iter([0,0,899,899,899,900])
        code,result,_=self.run_cli(self.generate_args(),clock=lambda:next(ticks),sleep=lambda _:None)
        self.assertEqual(3,code)
        run_calls=[request for request in self.calls if request.url.path.startswith('/api/agent/v1/image-runs')]
        self.assertEqual([60,1],[request.extensions['timeout']['read'] for request in run_calls])


    def test_reference_directory_is_rejected_before_upload(self):
        code,result,_=self.run_cli(self.generate_args('--image',str(self.directory)))
        self.assertEqual(1,code)
        self.assertEqual('invalid_image',result['error']['code'])
        self.assertFalse(any(request.method == 'POST' for request in self.calls))

    def test_unconfirmed_capabilities_preserve_configured_model_compatibility(self):
        self.capability['support_state']='unknown'
        code,result,_=self.run_cli(self.generate_args('--image',str(self.image)))
        self.assertEqual(0,code)
        self.assertEqual('succeeded',result['status'])
        self.assertEqual('native',result['model'])
        self.assertEqual('image.edit',result['operation'])
        self.assertEqual(1,len(self.submissions))


if __name__ == '__main__':
    unittest.main()
