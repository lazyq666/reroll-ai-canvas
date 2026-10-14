import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import ValidationError

from infinite_canvas.music_lab import (
    ApimartMusicClient, MusicCover, MusicCoverSubmission, MusicGeneration, MusicInspiration, MusicInspirationSubmission, MusicUpload, MusicGenerationExecutor,
    MusicProviderError, host_music_reference, upload_music_reference_tmpfiles, verify_hosted_music_reference, music_output, music_run_public, create_music_router, SUNO_VERSIONS,
)
from infinite_canvas.generation_effect_dispatcher import GenerationRunStoreExecutor
from infinite_canvas.generation_run_lifecycle import AsyncGenerationRunLifecycleStore
from infinite_canvas.generation_run_store import SqliteGenerationRunStore
from infinite_canvas.generation_runs import (
    GenerationRuns, GenerationOutputPorts, WorkspaceGenerationEffects, WorkflowRun, Inline,
)
from infinite_canvas.generation_publication import SqliteGenerationPublication
from infinite_canvas.providers.core import Pending, Failed

PROVIDER = {'id':'apimart', 'protocol':'apimart', 'base_url':'https://api.apimart.ai/v1', 'api_key':'secret-test'}
RESULT = {'status':'completed', 'credits_cost':.5, 'result':{'music':[
    {'audio_id':'audio-1', 'audio_url':'https://cdn.example.test/song.mp3', 'title':'雨夜', 'duration':10.3, 'lyrics':'Verse'},
    {'audio_id':'audio-2', 'audio_url':'https://cdn.example.test/song2.mp3', 'title':'Another'},
]}}

class MusicContractTests(unittest.TestCase):
    def test_versions_modes_unicode_zero_and_omission(self):
        for version in SUNO_VERSIONS:
            body = MusicGeneration(version=version,prompt='🎹'*3000,style_weight=0,weirdness_constraint=1).upstream()
            self.assertEqual(body['model'],'suno'); self.assertEqual(body['style_weight'],0)
            self.assertNotIn('duration',body); self.assertNotIn('title',body); self.assertNotIn('max_mode',body)
        custom = MusicGeneration(custom=True,instrumental=True,duration=10,max_mode=True,title='x'*80,style='x'*1000)
        self.assertEqual(custom.upstream()['duration'],10)
        self.assertEqual(MusicGeneration(custom=True,prompt='a'*5000).upstream()['prompt'],'a'*5000)

    def test_invalid_options_are_rejected_before_paid_submission(self):
        invalid = [{}, {'prompt':'x'*3001}, {'prompt':'x','version':'v5.5'}, {'custom':True},
            {'prompt':'x','style':'jazz'}, {'prompt':'x','duration':10}, {'custom':True,'instrumental':True,'duration':10.5},
            {'custom':True,'instrumental':True,'duration':9}, {'custom':True,'instrumental':True,'duration':361},
            {'prompt':'x','audio_format':'flac'}, {'prompt':'x','vocal_gender':'male'}, {'prompt':'x','style_weight':-0.1},
            {'prompt':'x','audio_weight':float('nan')}, {'prompt':'x','api_key':'no'}, {'prompt':'x','max_mode':True}]
        for data in invalid:
            with self.subTest(data=str(data)[:90]), self.assertRaises(ValidationError): MusicGeneration(**data)

    def test_inspiration_contract_and_reference_limits(self):
        body = MusicInspiration(tags='ambient', audio_weight=0, weirdness=1).upstream()
        self.assertEqual(body['audio_weight'], 0)
        self.assertEqual(body['tags'], 'ambient')
        self.assertNotIn('prompt', body)
        for key in ['instrumental', 'custom', 'duration', 'persona_id', 'style', 'weirdness_constraint', 'audio_urls']:
            with self.subTest(key=key), self.assertRaises(ValidationError):
                MusicInspiration(**{key: True})
        for count in [0, 5]:
            with self.assertRaises(ValidationError):
                MusicInspirationSubmission(provider_id='apimart', operation_id='reference-test', settings={},
                    references=[{'run_id':'owned', 'index':0}] * count)
        with self.assertRaises(ValidationError):
            MusicInspirationSubmission(provider_id='apimart', operation_id='reference-test', settings={},
                references=[{'file_index':0, 'run_id':'owned', 'index':0}])

    def test_cover_fields_description_boundary_and_instrumental_semantics(self):
        for version in SUNO_VERSIONS:
            body = MusicCover(version=version, prompt='🎹' * 998, style='', duration=10,
                              style_weight=0, weirdness_constraint=0, audio_weight=0).upstream()
            self.assertTrue(body['instrumental']); self.assertTrue(body['custom'])
            self.assertEqual(body['duration_s'], 10); self.assertEqual(body['weirdness'], 0)
            self.assertEqual(body['audio_weight'], 0); self.assertEqual(body['style_weight'], 0)
            self.assertEqual(body['tags'], '🎹' * 998)
            for key in ['prompt', 'style', 'duration', 'weirdness_constraint', 'auto_lyrics', 'vocal_gender']:
                self.assertNotIn(key, body)
        self.assertEqual(MusicCover(prompt='  piano ', style=' calm ').upstream()['tags'], 'piano, calm')
        self.assertNotIn('prompt', MusicCover().upstream())
        self.assertEqual(len(MusicCover(prompt='x'*998, style='').upstream()['tags']), 998)
        MusicCover(prompt='x'*997, style='y')
        for settings in [{'prompt':'x'*998, 'style':'y'}, {'instrumental':False}, {'custom':False},
                         {'vocal_gender':'Male'}, {'auto_lyrics':True}, {'audio_url':'https://example.test/a.wav'}]:
            with self.subTest(settings=str(settings)[:70]), self.assertRaises(ValidationError):
                MusicCover(**settings)
        for count in [0,2,4]:
            with self.assertRaises(ValidationError):
                MusicCoverSubmission(provider_id='apimart', operation_id='cover-test', settings={},
                                     references=[{'run_id':'owned','index':0}]*count)

    def test_vocal_cover_preserves_lyrics_and_maps_only_style_to_tags(self):
        body = MusicCover(instrumental=False, prompt='A melody to sing', style='piano',
                          vocal_gender='Female', auto_lyrics=False, audio_weight=.89).upstream()
        self.assertFalse(body['instrumental'])
        self.assertEqual(body['prompt'], 'A melody to sing')
        self.assertEqual(body['tags'], 'piano')
        self.assertEqual(body['vocal_gender'], 'Female')
        self.assertEqual(body['audio_weight'], .89)
        self.assertNotIn('style', body)

    def test_upload_url_boundary(self):
        base={'provider_id':'apimart','operation_id':'operation1'}
        for url in ['file:///tmp/a.mp3','blob:https://example.test/x','http://localhost/a','http://127.0.0.1/a',
                    'http://192.168.1.2/a','http://[::1]/a','https://user:pass@example.com/a']:
            with self.subTest(url=url), self.assertRaises(ValidationError): MusicUpload(**base,audio_url=url)
        self.assertEqual(MusicUpload(**base,audio_url='https://example.com/audio.mp3?signature=abc').audio_url,'https://example.com/audio.mp3?signature=abc')

    def test_result_index_upload_without_url_and_download_formats(self):
        out=music_output(RESULT,'generate','task-1')
        self.assertEqual([x['audio_index'] for x in out['items']],[1,2]); self.assertEqual(out['items'][0]['format'],'mp3')
        upload=music_output({'result':{'audio_id':'uploaded'}},'upload','task-upload')
        self.assertEqual(upload['items'][0]['audio_id'],'uploaded'); self.assertNotIn('url',upload['items'][0])
        download=music_output({'result':{'files':[{'format':'wav','url':'https://cdn.example.test/a.wav'}, {'format':'m4a','url':'https://cdn.example.test/a.m4a'}]}},'download','task-download')
        self.assertEqual([x['format'] for x in download['items']],['wav','m4a'])
        with self.assertRaises(MusicProviderError): music_output({'result':{}},'generate','bad')

class MusicClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_submit_once_query_uses_music_endpoint_and_secret_is_only_header(self):
        calls=[]
        def handle(request):
            calls.append(request)
            if request.method=='POST': return httpx.Response(200,json={'code':200,'data':[{'task_id':'remote-1','status':'submitted'}]})
            return httpx.Response(200,json={'code':200,'data':RESULT})
        client=ApimartMusicClient(PROVIDER,transport=httpx.MockTransport(handle))
        self.assertEqual(await client.submit('generate',{'model':'suno','version':'v6','prompt':'rain'}),'remote-1')
        self.assertEqual((await client.query('remote-1'))['status'],'completed')
        self.assertEqual(calls[0].url.path,'/v1/music/generations')
        self.assertEqual(calls[1].url.path,'/v1/music/tasks/remote-1')
        self.assertEqual(calls[0].headers['authorization'],'Bearer secret-test')
        self.assertNotIn('secret-test',calls[0].content.decode())

    async def test_cover_submits_single_url_to_upload_cover(self):
        calls = []
        def handle(request):
            calls.append(request)
            return httpx.Response(200,json={'code':200,'data':[{'task_id':'cover-1'}]})
        client = ApimartMusicClient(PROVIDER,transport=httpx.MockTransport(handle))
        body = {**MusicCover().upstream(), 'audio_url':'https://cdn.example.test/input.wav'}
        self.assertEqual(await client.submit('cover',body),'cover-1')
        self.assertEqual(calls[0].url.path,'/v1/music/generations/uploadCover')
        self.assertEqual(json.loads(calls[0].content)['audio_url'], body['audio_url'])
        self.assertNotIn('secret-test',calls[0].content.decode())

    async def test_paid_timeout_is_unknown_and_never_retried(self):
        calls=[]
        def handle(request): calls.append(request); raise httpx.ReadTimeout('sensitive remote error')
        client=ApimartMusicClient(PROVIDER,transport=httpx.MockTransport(handle))
        with self.assertRaises(MusicProviderError) as raised: await client.submit('generate',{})
        self.assertEqual(raised.exception.code,'music.submissionUnknown'); self.assertEqual(len(calls),1)

    async def test_query_503_is_retryable_but_submit_503_is_not_reposted(self):
        client=ApimartMusicClient(PROVIDER,transport=httpx.MockTransport(lambda _:httpx.Response(503)))
        for method,expected in [('GET','music.pollFailed'),('POST','music.submissionUnknown')]:
            with self.assertRaises(MusicProviderError) as raised: await client.request(method,'/test')
            self.assertEqual(raised.exception.code,expected)

    async def test_content_review_failure_is_explained_without_raw_upstream_text(self):
        client=SimpleNamespace(query=mock.AsyncMock(return_value={'status':'failed','error':{
            'message':'Your request did not pass content safety review. private provider diagnostic'}}),
            submit=mock.AsyncMock())
        executor=MusicGenerationExecutor(delegate=None,provider_lookup=lambda _:PROVIDER,client_factory=lambda _:client)
        result=await executor.execute(WorkflowRun('suno-query',{'operation':'cover','task_id':'existing'},provider_id='apimart'))
        self.assertEqual(result.error,'music.contentRejected')
        client.submit.assert_not_awaited()

    async def test_query_transient_failure_preserves_task(self):
        client=SimpleNamespace(query=mock.AsyncMock(side_effect=MusicProviderError('music.pollFailed')))
        executor=MusicGenerationExecutor(delegate=None,provider_lookup=lambda _:PROVIDER,client_factory=lambda _:client)
        result=await executor.execute(WorkflowRun('suno-query',{'operation':'generate','task_id':'existing','body':{}},provider_id='apimart'))
        self.assertIsInstance(result,Pending); self.assertEqual(result.remote_ref,'existing')

class MusicLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name)
        self.store=SqliteGenerationRunStore(self.root/'generation-runs.sqlite3',workspace_id='music-workspace')
        self.worker=GenerationRunStoreExecutor(max_workers=1,max_pending=20)
        self.lifecycle=AsyncGenerationRunLifecycleStore(store=self.store,store_executor=self.worker)
        self.calls=[]
        outer=self
        class Client:
            async def submit(self,operation,body): outer.calls.append(('POST',operation,body)); return 'paid-task-'+str(len(outer.calls))
            async def query(self,task): outer.calls.append(('GET',task)); return RESULT
        self.executor=MusicGenerationExecutor(delegate=None,provider_lookup=lambda _:PROVIDER,client_factory=lambda _:Client())
        self.save=mock.AsyncMock(side_effect=lambda url,**kwargs:'/assets/output/'+kwargs['stable_id']+'.mp3')
        self.effects=WorkspaceGenerationEffects(GenerationOutputPorts(save_image=None,image_meta=None,extract_images=None,save_asset=self.save),
            publication=SqliteGenerationPublication(store=self.store,store_executor=self.worker,notify=None,worker_id='music'))
        self.runs=self.make_runs()

    def make_runs(self): return GenerationRuns(executor=self.executor,effects=self.effects,lifecycle_store=self.lifecycle)

    async def asyncTearDown(self):
        await self.runs.pause_active(); await self.runs.wait_for_lifecycle_projection(through_current=True)
        await self.lifecycle.close(); await self.worker.close(); self.tmp.cleanup()

    async def submit(self,key='first',owner='alice'):
        body={'model':'suno','version':'v6','prompt':'Rain'}
        return await self.runs.start(WorkflowRun('suno-generate',{'operation':'generate','body':body},provider_id='apimart'),
            key=key,owner=owner,delivery=Inline(),public_metadata={'surface':'suno','operation':'generate','params':body})

    async def test_restart_recovers_existing_paid_task_and_history_survives(self):
        submitted=await self.submit(); self.assertEqual(submitted.status,'running')
        await self.runs.wait_for_lifecycle_projection(through_current=True)
        self.runs=self.make_runs(); self.assertEqual(await self.runs.restore_lifecycle_authority(),1)
        completed=await self.runs.resume(submitted.id,owner='alice')
        self.assertEqual(completed.status,'succeeded'); self.assertEqual([x[0] for x in self.calls],['POST','GET'])
        self.assertTrue(all(x['url'].startswith('/assets/') for x in completed.result['items']))
        self.runs=self.make_runs(); await self.runs.restore_lifecycle_authority()
        history,cursor=await self.runs.list_owned(owner='alice',surface='suno')
        self.assertEqual([r.id for r in history],[submitted.id]); self.assertEqual(cursor,'')
        self.assertEqual((await self.runs.list_owned(owner='bob',surface='suno'))[0],[])
        same=await self.submit(); self.assertTrue(same.deduplicated); self.assertEqual(len(self.calls),2)
        self.assertNotIn('secret-test',self.store.load(submitted.id).request_hash)

    async def test_reference_history_and_restart_never_rehosts_or_resubmits(self):
        references = [{'url':'/assets/input/imported/test.wav', 'name':'my song.wav', 'size':80}]
        self.executor.reference_host = mock.AsyncMock(return_value='https://cdn.example.test/input.wav')
        body = MusicInspiration(audio_weight=0, weirdness=0, tags='piano').upstream()
        run = await self.runs.start(WorkflowRun('suno-inspo',
            {'operation':'inspo','body':body,'references':references},provider_id='apimart'),
            key='reference',owner='alice',delivery=Inline(),
            public_metadata={'surface':'suno','operation':'inspo','params':body,'references':references})
        self.assertEqual(self.calls[0][2]['audio_urls'], ['https://cdn.example.test/input.wav'])
        self.assertEqual(self.calls[0][2]['weirdness'], 0)
        self.assertNotIn('audio_urls', music_run_public(run)['params'])
        await self.runs.wait_for_lifecycle_projection(through_current=True)
        self.runs = self.make_runs(); await self.runs.restore_lifecycle_authority()
        completed = await self.runs.resume(run.id,owner='alice')
        self.assertEqual(completed.status, 'succeeded')
        self.executor.reference_host.assert_awaited_once()
        self.assertEqual([c[0] for c in self.calls], ['POST', 'GET'])
        public = music_run_public(completed)
        self.assertEqual(public['references'][0]['name'], 'my song.wav')
        self.assertEqual(public['references'][0]['url'], f'/api/music/runs/{run.id}/references/0')
        same = await self.runs.start(WorkflowRun('suno-inspo',
            {'operation':'inspo','body':body,'references':references},provider_id='apimart'),
            key='reference',owner='alice',delivery=Inline(),
            public_metadata={'surface':'suno','operation':'inspo','params':body,'references':references})
        self.assertTrue(same.deduplicated); self.assertEqual(len(self.calls), 2)

    async def test_cover_restart_only_queries_and_keeps_original_draft(self):
        refs = [{'url':'/assets/input/imported/test.wav','name':'source.wav','size':60,'duration':10}]
        self.executor.reference_host = mock.AsyncMock(return_value='https://cdn.example.test/input.wav')
        settings = MusicCover(prompt='gentle',style='piano',audio_weight=0,duration=10)
        run = await self.runs.start(WorkflowRun('suno-cover',
            {'operation':'cover','body':settings.upstream(),'references':refs},provider_id='apimart'),
            key='cover',owner='alice',delivery=Inline(),public_metadata={
                'surface':'suno','operation':'cover','params':settings.model_dump(),'references':refs})
        self.assertEqual(self.calls[0][1], 'cover')
        self.assertEqual(self.calls[0][2]['audio_url'], 'https://cdn.example.test/input.wav')
        self.assertNotIn('audio_urls', self.calls[0][2])
        await self.runs.wait_for_lifecycle_projection(through_current=True)
        self.runs = self.make_runs(); await self.runs.restore_lifecycle_authority()
        completed = await self.runs.resume(run.id,owner='alice')
        self.assertEqual(completed.status,'succeeded')
        self.assertEqual([c[0] for c in self.calls],['POST','GET'])
        self.executor.reference_host.assert_awaited_once()
        public = music_run_public(completed)
        self.assertEqual(public['params']['prompt'],'gentle')
        self.assertEqual(public['params']['style'],'piano')
        self.assertEqual(public['references'][0]['duration'],10)

    async def test_host_failure_cannot_submit_a_paid_task(self):
        self.executor.reference_host = mock.AsyncMock(side_effect=MusicProviderError('music.hostingFailed'))
        result = await self.executor.execute(WorkflowRun('suno-inspo', {'operation':'inspo',
            'body':{}, 'references':[{'url':'/assets/input/imported/test.wav'}]},provider_id='apimart'))
        self.assertIsInstance(result, Failed)
        self.assertEqual(self.calls, [])

    async def test_cursor_handles_new_records_and_scope_isolation(self):
        for i in range(4): await self.submit(key=str(i))
        first,cursor=await self.runs.list_owned(owner='alice',surface='suno',limit=2)
        await self.submit(key='newer')
        second,_=await self.runs.list_owned(owner='alice',surface='suno',limit=2,cursor=cursor)
        self.assertEqual(len({r.id for r in first+second}),4)
        with self.assertRaises(ValueError): await self.runs.list_owned(owner='alice',surface='suno',cursor='bad')
        self.assertEqual((await self.runs.list_owned(owner='alice',surface='other'))[0],[])

    async def test_local_save_failure_can_resume_without_provider_resubmission(self):
        submitted=await self.submit(); self.save.side_effect=lambda url,**kwargs:url
        with self.assertRaisesRegex(Exception,'music.saveFailed'): await self.runs.resume(submitted.id,owner='alice')
        run=await self.runs.query(submitted.id,owner='alice')
        self.assertEqual(run.status,'running'); self.assertTrue(run.recoverable)
        self.save.side_effect=lambda url,**kwargs:'/assets/output/'+kwargs['stable_id']+'.mp3'
        completed=await self.runs.resume(submitted.id,owner='alice')
        self.assertEqual(completed.status,'succeeded'); self.assertEqual([x[0] for x in self.calls],['POST','GET','GET'])

class MusicRouterTests(unittest.IsolatedAsyncioTestCase):
    async def test_owner_authorization_export_receipt_and_validation(self):
        user={'id':'alice'}; records={}; starts=[]; files=[]
        class Runs:
            async def query(self,rid,owner):
                if rid not in records or records[rid].owner != owner:
                    from infinite_canvas.generation_runs import GenerationRunNotFound
                    raise GenerationRunNotFound('missing')
                return records[rid]
            async def start(self,request,**kwargs):
                starts.append((request,kwargs)); return records['source']
            async def wait_for_lifecycle_projection(self,**kwargs): pass
        def actor():
            if user['id'] is None: raise HTTPException(401)
            return user
        source=SimpleNamespace(id='source',owner='alice',status='succeeded',provider_id='apimart',created_at=1,updated_at=2,
            public_metadata={'surface':'suno','operation':'generate','params':{}}, result=music_output(RESULT,'generate','source-task'),
            error='',recoverable=False,remote_refs=('source-task',))
        source.recoverable=True
        self.assertFalse(music_run_public(source)['recoverable'])
        records['source']=source
        app=FastAPI(); app.include_router(create_music_router(runs=lambda:Runs(),actor=actor,providers=lambda:[PROVIDER],provider_lookup=lambda _:PROVIDER,
            download_file=lambda *args,**kw: files.append((args,kw)) or {'ok':True}))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
            self.assertNotIn('secret-test',(await client.get('/api/music/config')).text)
            self.assertEqual((await client.post('/api/music/runs/source/resume')).status_code,409)
            self.assertEqual((await client.post('/api/music/generations',json={'provider_id':'apimart','operation_id':'12345678','settings':{'prompt':''}})).status_code,422)
            payload={'audio_index':2,'formats':['wav','mp3']}
            self.assertEqual((await client.post('/api/music/runs/source/downloads',json=payload)).status_code,202)
            payload['formats']=['mp3','wav','mp3']
            self.assertEqual((await client.post('/api/music/runs/source/downloads',json=payload)).status_code,202)
            self.assertEqual(starts[0][1]['key'],starts[1][1]['key'])
            self.assertEqual(starts[0][0].payload['body']['audio_index'],2)
            user['id']='bob'
            for path in ['/api/music/runs/source','/api/music/runs/source/audio/0']:
                self.assertEqual((await client.get(path)).status_code,404)
            self.assertEqual((await client.post('/api/music/runs/source/downloads',json=payload)).status_code,404)
            user['id']=None
            self.assertEqual((await client.get('/api/music/config')).status_code,401)

class MusicReferenceRouterTests(unittest.IsolatedAsyncioTestCase):
    async def test_multipart_bounds_owned_reuse_and_playback(self):
        import hashlib
        user = {'id':'alice'}; saved = {}; starts = []
        source = SimpleNamespace(id='source', owner='alice', status='succeeded', provider_id='apimart',
            created_at=1, updated_at=2, result={}, error='', recoverable=False, remote_refs=(),
            public_metadata={'surface':'suno','operation':'inspo','params':{},'references':[
                {'name':'old.wav','url':'/assets/input/imported/old.wav','size':60}]})
        class Runs:
            async def query(self,rid,owner):
                if rid != 'source' or owner != source.owner:
                    from infinite_canvas.generation_runs import GenerationRunNotFound
                    raise GenerationRunNotFound('missing')
                return source
            async def start(self,request,**kwargs): starts.append((request,kwargs)); return source
            async def wait_for_lifecycle_projection(self,**kwargs): pass
        def importer(content, *, name):
            url = '/assets/input/imported/' + hashlib.sha256(content).hexdigest() + '.wav'
            saved[url] = content; return {'url':url}
        app = FastAPI(); app.include_router(create_music_router(runs=lambda:Runs(), actor=lambda:user,
            providers=lambda:[PROVIDER], provider_lookup=lambda _:PROVIDER, import_reference=importer,
            download_file=lambda request,url,**kw:{'source':url}))
        payload = {'provider_id':'apimart','operation_id':'references-multipart','settings':{'audio_weight':0},
                   'references':[{'run_id':'source','index':0},{'file_index':0}]}
        wave = b'RIFF' + bytes(4) + b'WAVE' + bytes(40)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
            async def send(content=wave, name='new.wav'):
                return await client.post('/api/music/inspirations',data={'payload':json.dumps(payload)},files=[('files',(name,content,'audio/wav'))])
            response = await send(); self.assertEqual(response.status_code,202,response.text)
            request, meta = starts[0]
            self.assertEqual([ref['name'] for ref in request.payload['references']], ['old.wav','new.wav'])
            self.assertEqual(meta['public_metadata']['references'],request.payload['references'])
            self.assertNotIn('audio_urls',request.payload['body'])
            self.assertEqual((await client.get('/api/music/runs/source/references/0')).json()['source'],'/assets/input/imported/old.wav')
            self.assertEqual((await send(b'<html>no</html>')).status_code,422)
            self.assertEqual((await send(wave,'bad.exe')).status_code,422)
            with mock.patch('infinite_canvas.music_lab.REFERENCE_MAX_BYTES', 10):
                self.assertEqual((await send()).status_code,413)
            user['id']='bob'
            self.assertEqual((await send()).status_code,404)
            self.assertEqual((await client.get('/api/music/runs/source/references/0')).status_code,404)
            self.assertEqual(len(starts),1)
            user['id']='alice';payload['references']=[{'file_index':0}]*5
            self.assertEqual((await send()).status_code,422)

    async def test_cover_checks_owned_duration_and_count_before_paid_submission(self):
        user = {'id':'alice'}; starts=[]; imported=[]
        source = SimpleNamespace(id='source',owner='alice',status='succeeded',provider_id='apimart',
            created_at=1,updated_at=2,result={},error='',recoverable=False,remote_refs=(),
            public_metadata={'surface':'suno','operation':'inspo','params':{},'references':[
                {'name':'old.wav','url':'/assets/input/imported/old.wav','duration':1}]})
        class Runs:
            async def query(self,rid,owner):
                if rid != 'source' or owner != source.owner:
                    from infinite_canvas.generation_runs import GenerationRunNotFound
                    raise GenerationRunNotFound('missing')
                return source
            async def start(self,request,**kwargs): starts.append((request,kwargs)); return source
            async def wait_for_lifecycle_projection(self,**kwargs): pass
        def importer(content,**kwargs):
            imported.append(content); return {'url':'/assets/input/imported/new.wav'}
        probe = mock.Mock(return_value=479.99)
        app=FastAPI();app.include_router(create_music_router(runs=lambda:Runs(),actor=lambda:user,
            providers=lambda:[PROVIDER],provider_lookup=lambda _:PROVIDER,download_file=lambda *a,**k:None,
            import_reference=importer,probe_reference=probe))
        payload={'provider_id':'apimart','operation_id':'cover-owned-test',
                 'settings':{'prompt':'calm','style':'piano','duration':30,'audio_weight':0},
                 'references':[{'run_id':'source','index':0}]}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
            async def send(files=None):
                return await client.post('/api/music/covers',data={'payload':json.dumps(payload)},files=files)
            self.assertEqual((await send()).status_code,202)
            request,meta=starts[0];self.assertEqual(request.operation,'suno-cover')
            self.assertEqual(request.payload['body']['tags'],'calm, piano')
            self.assertEqual(meta['public_metadata']['params']['prompt'],'calm')
            self.assertEqual(meta['public_metadata']['params']['style'],'piano')
            self.assertEqual(meta['public_metadata']['references'][0]['duration'],479.99)
            for duration,code in [(480,'music.coverReferenceTooLong'),(600,'music.coverReferenceTooLong'),
                                  (None,'music.referenceDurationUnknown'),(float('nan'),'music.referenceDurationUnknown')]:
                probe.return_value=duration
                response=await send();self.assertEqual(response.status_code,422)
                self.assertEqual(response.json()['detail']['code'],code)
            probe.return_value=10
            payload['references']*=2;self.assertEqual((await send()).status_code,422)
            payload['references']=[{'file_index':0}]
            wave=b'RIFF'+bytes(4)+b'WAVE'+bytes(40)
            self.assertEqual((await send([('files',('test.wav',wave,'audio/wav'))])).status_code,202)
            self.assertEqual(len(imported),1);self.assertEqual(probe.call_args.args[0],'/assets/input/imported/new.wav')
            payload['references']=[{'run_id':'source','index':0}];user['id']='bob'
            self.assertEqual((await send()).status_code,404)
            self.assertEqual(len(starts),2)

class MusicApplicationTests(unittest.TestCase):
    def test_actual_application_auth_provider_secret_and_private_history(self):
        import importlib
        import os
        from fastapi.testclient import TestClient
        from tests.runtime_env import configure_test_workspace, unload_main
        previous={key:os.environ.get(key) for key in ['INFINITE_CANVAS_STATE_DIR','INFINITE_CANVAS_CACHE_DIR']}
        try:
            with tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary);configure_test_workspace(root/'workspace',root/'state')
                os.environ['INFINITE_CANVAS_STATE_DIR']=str(root/'state');unload_main()
                main=importlib.import_module('main')
                main.AUTH_SYSTEM.create_user(username='admin',password='music-test-password',role='admin')
                main.AUTH_SYSTEM.create_user(username='designer',password='music-test-password',role='designer')
                main.AUTH_SYSTEM.create_user(username='guest',password='music-test-password',role='guest')
                main.save_api_providers([{k:v for k,v in PROVIDER.items() if k!='api_key'}])
                Path(main.API_ENV_FILE).write_text('API_PROVIDER_APIMART_KEY=secret-test\n')
                with TestClient(main.app) as client:
                    self.assertEqual(client.get('/api/music/config').status_code,401)
                    for username in ['admin','designer']:
                        self.assertEqual(client.post('/api/auth/login',json={'username':username,'password':'music-test-password'}).status_code,200)
                        response=client.get('/api/music/config');self.assertEqual(response.status_code,200,response.text)
                        self.assertEqual(response.json()['providers'][0]['id'],'apimart');self.assertNotIn('secret-test',response.text)
                        self.assertEqual(client.get('/api/music/history').json()['items'],[])
                        self.assertEqual(client.get('/static/lab.html').status_code,200)
                        client.post('/api/auth/logout')
                    client.post('/api/auth/login',json={'username':'guest','password':'music-test-password'})
                    self.assertEqual(client.get('/api/music/config').status_code,403)
                unload_main()
        finally:
            unload_main()
            for key,value in previous.items():
                if value is None: os.environ.pop(key,None)
                else: os.environ[key]=value


class ReferenceHostingIntegrityTests(unittest.IsolatedAsyncioTestCase):
    async def test_html_landing_page_is_rejected_before_using_fallback(self):
        await self.check_hosts(b'<html>Click here to download</html>', succeeds=True)

    async def test_same_size_corruption_is_rejected(self):
        await self.check_hosts(b'ID3different-data', succeeds=True)

    async def test_all_invalid_hosts_fail_before_generation(self):
        await self.check_hosts(b'<html>not audio</html>', succeeds=False)

    async def check_hosts(self, bad_bytes, *, succeeds):
        original = b'ID3original-audio'
        requests = []
        def handle(request):
            requests.append(request)
            self.assertNotIn('authorization', request.headers)
            self.assertNotIn('cookie', request.headers)
            data = original if request.url.host == 'fallback.example.test' and succeeds else bad_bytes
            return httpx.Response(200, content=data)
        real_client = httpx.AsyncClient
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'reference.mp3'; path.write_bytes(original)
            with mock.patch('infinite_canvas.providers.http_impl.local_media_path_for_cloud_upload', return_value=str(path)), \
                 mock.patch('infinite_canvas.providers.http_impl.upload_video_to_litterbox', new=mock.AsyncMock(return_value={'url':'https://first.example.test/file.mp3'})), \
                 mock.patch('infinite_canvas.music_lab.upload_music_reference_tmpfiles', new=mock.AsyncMock(return_value={'url':'https://fallback.example.test/file.mp3'})), \
                 mock.patch('infinite_canvas.music_lab.httpx.AsyncClient', side_effect=lambda **kw: real_client(transport=httpx.MockTransport(handle), **kw)):
                if succeeds:
                    url = await host_music_reference({'url':'/assets/input/reference.mp3'})
                    self.assertEqual(url, 'https://fallback.example.test/file.mp3')
                else:
                    with self.assertRaises(MusicProviderError) as error:
                        await host_music_reference({'url':'/assets/input/reference.mp3'})
                    self.assertEqual(error.exception.code, 'music.hostingFailed')
                self.assertEqual(len(requests), 2)


class TmpfilesReferenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_resolves_actual_signed_download_link_without_credentials(self):
        requests = []
        def handle(request):
            requests.append(request)
            self.assertNotIn('authorization', request.headers)
            self.assertNotIn('cookie', request.headers)
            if request.method == 'POST':
                self.assertIn(b'21600', request.content)
                self.assertIn(b'ID3reference', request.content)
                return httpx.Response(200, json={'status':'success','data':{'url':'https://tmpfiles.org/id/reference.mp3'}})
            return httpx.Response(200, text='<a class="download" href="https://tmpfiles.org/dl/expiry.signature/id/reference.mp3">Download</a>')
        real_client = httpx.AsyncClient
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'reference.mp3'; path.write_bytes(b'ID3reference')
            with mock.patch('infinite_canvas.music_lab.httpx.AsyncClient', side_effect=lambda **kw: real_client(transport=httpx.MockTransport(handle), **kw)):
                result = await upload_music_reference_tmpfiles(str(path), '/assets/reference.mp3')
        self.assertEqual(result['url'],'https://tmpfiles.org/dl/expiry.signature/id/reference.mp3')
        self.assertEqual([r.method for r in requests], ['POST', 'GET'])

    async def test_download_link_to_unexpected_host_is_rejected(self):
        def handle(request):
            if request.method == 'POST':
                return httpx.Response(200,json={'status':'success','data':{'url':'https://tmpfiles.org/id/ref.mp3'}})
            return httpx.Response(200,text='<a class="download" href="https://unexpected.test/dl/ref.mp3">Download</a>')
        real_client=httpx.AsyncClient
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'ref.mp3';path.write_bytes(b'ID3ref')
            with mock.patch('infinite_canvas.music_lab.httpx.AsyncClient',side_effect=lambda **kw:real_client(transport=httpx.MockTransport(handle),**kw)):
                with self.assertRaises(ValueError):
                    await upload_music_reference_tmpfiles(str(path),'/assets/ref.mp3')

    async def test_audio_redirect_to_local_network_is_never_fetched(self):
        requests=[]
        def handle(request):
            requests.append(request)
            return httpx.Response(302,headers={'location':'http://127.0.0.1/private'})
        real_client=httpx.AsyncClient
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'ref.mp3';path.write_bytes(b'ID3ref')
            with mock.patch('infinite_canvas.music_lab.httpx.AsyncClient',side_effect=lambda **kw:real_client(transport=httpx.MockTransport(handle),**kw)):
                with self.assertRaises(ValueError):
                    await verify_hosted_music_reference(str(path),'https://tmpfiles.org/dl/ref.mp3')
        self.assertEqual(len(requests),1)
