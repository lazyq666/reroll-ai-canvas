"""Disposable real Canvas/Agent server and visible native-input test controls.

All state belongs to AgentApiTests' temporary directory. No Provider is installed.
"""
import asyncio
import json
from pathlib import Path
import socket
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tests import agent_canvas_fixture as base
from fastapi import Request
from fastapi.responses import HTMLResponse
import uvicorn

app, fixture = base.app, base.fixture
fixture.sync._workspace_id = lambda: 'reference-workspace'
ROOT = Path(__file__).resolve().parents[1]
control = {'delay':0}
original_receive = fixture.sync.receive_realtime
async def receive(session, actor, message, **kwargs):
    if message.get('type') == 'canvas_mutation' and control['delay']:
        await asyncio.sleep(control['delay'])
    return await original_receive(session, actor, message, **kwargs)
fixture.sync.receive_realtime = receive

# Use the actual Mutation engine; no fixture-only document writer.
changes = {
    'node_updates':[
        {'id':f'source-{i}', 'path':[key], 'value':value}
        for i in range(3) for key,value in {'x':420+i*350,'y':70,'scale':1,'w':280,'h':220}.items()
    ],
    'node_creates': [fixture.api.creation(n) for n in [
        {'id':'text', 'type':'smart-prompt', 'title':'Reference text', 'x':60,'y':70,'w':280,'h':220,'text':'完整中文提示词\n第二行：保留文末。'},
        {'id':'draft','type':'smart-image','title':'Draft task','x':60,'y':440,'w':280,'h':220,'scale':1,
         'images':[], 'referenceGenerationKind':'video','promptDraftText':'完整任务提示词\n文末约束。',
         'runSettings':{'engine':'api','apiKind':'video','videoProvider':'fixture','videoModel':'video','videoDuration':5,'videoAspect':'16:9'}},
        {'id':'group','type':'smart-group','title':'Reference group','x':430,'y':440,'w':320,'h':240,'items':['member'],'images':[]},
        {'id':'member','type':'smart-prompt','title':'Group member','x':450,'y':480,'w':200,'h':120,'text':'成员不自动成为引用目标'},
        {'id':'frame','type':'smart-frame','title':'Reference frame','x':820,'y':440,'w':340,'h':270,'items':['inside']},
        {'id':'inside','type':'smart-prompt','title':'Frame child','x':850,'y':490,'w':240,'h':140,'text':'分区内部内容'}
    ]]
}
changes['node_updates'] += [{'id':'source-1','path':['images'],'value':[{'url':'/assets/input/1.png','name':'Output A','kind':'image','outputId':'output-a'},{'url':'/assets/input/2.png','name':'Output B','kind':'image','outputId':'output-b'}]}]
asyncio.run(fixture.sync.commit_staged_operation('canvas-test',fixture.admin,
    {'operation_id':'fixture:reference','base_revision':fixture.sync.read('canvas-test',fixture.admin)['revision'],'changes':changes}))
# Another Canvas is used to prove exact reference reads do not change the MCP lock.
asyncio.run(fixture.sync.create_agent_canvas(fixture.admin,'canvas-other','Other canvas'))

@app.get('/fixture/canvas')
async def canvas_page(request:Request):
    source = (ROOT/'static/smart-canvas.html').read_text()
    controls = '''<aside id="fixture-controls" style="position:fixed;right:12px;top:10px;z-index:99999;background:#fff;color:#111;border:1px solid #aaa;padding:8px;font:12px sans-serif;width:330px">
    <b>LAZ-90 disposable fixture</b>
    <button onclick="StudioI18n.set('zh')">ZH</button><button onclick="StudioI18n.set('en')">EN</button>
    <button onclick="StudioTheme.set('light')">Light</button><button onclick="StudioTheme.set('dark')">Dark</button>
    <label>Paste copied reference<textarea id="fixture-paste" aria-label="Paste copied reference" style="display:block;width:100%;height:48px"></textarea></label>
    <output id="fixture-key" style="display:block">No key yet</output>
    <button onclick="fetch('/fixture/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({delay:3})}).then(()=>this.textContent='Delay 3s on')">Delay save 3s</button>
    <button onclick="fetch('/fixture/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({delay:0})}).then(()=>this.textContent='Normal save on')">Normal save</button>
    <button onclick="window.fixtureDialog=document.createElement('ic-dialog');fixtureDialog.label='Fixture dialog';fixtureDialog.textContent='Modal boundary';document.body.appendChild(fixtureDialog);fixtureDialog.updateComplete.then(()=>fixtureDialog.show())">Open dialog</button>
    </aside><script>
    let fixtureKeyCount=0;document.addEventListener('keydown', e => {const text=[++fixtureKeyCount,e.key,'meta='+e.metaKey,'ctrl='+e.ctrlKey,'shift='+e.shiftKey,'alt='+e.altKey,'trusted='+e.isTrusted];setTimeout(()=>document.getElementById('fixture-key').textContent=text.join(' ')+' prevented='+e.defaultPrevented);},true);
    document.documentElement.dataset.fixtureBrowser=navigator.userAgent;
    const fixtureStatus=document.createElement('output');fixtureStatus.id='fixture-status';document.getElementById('fixture-controls').appendChild(fixtureStatus);setInterval(()=>{fixtureStatus.textContent=JSON.stringify({selected:window.SmartCanvasModules.viewportSelection.selection.ids(),sync:window.SmartCanvasModules.canvasPersistence.status(),feedback:smartReferenceFeedback?.key});},500);
    </script>'''
    return HTMLResponse(source.replace('</body>',controls+'</body>'), headers={'Permissions-Policy':'clipboard-write=()'} if request.query_params.get('deny_clipboard') else {})

@app.post('/fixture/control')
async def controls(request:Request):
    control.update(await request.json())
    return control

@app.get('/api/config')
async def config():
    return {'api_providers':[], 'available_models':{'video':[{'id':'fixture|video','provider_id':'fixture','provider_name':'Fixture','model':'video','name':'Video'}]},'comfy_instances':[]}

@app.get('/api/local-generation-submissions')
async def local_generation():
    return {'enabled':False, 'workspace_id':'reference-workspace','actor_id':fixture.admin['id']}

@app.get('/api/smart-canvas/{canvas_id}/view-state')
async def view_state(canvas_id:str):
    return {'view_state':{'center_x':600,'center_y':350,'scale':0.65}}

@app.put('/api/smart-canvas/{canvas_id}/view-state')
async def save_view_state(canvas_id:str):
    return {'ok':True}

@app.get('/api/{path:path}')
async def ancillary(path:str):
    return {'workflows':[],'templates':[],'library':{'libraries':[]},'items':[],'canvases':[],'projects':[]}

if __name__ == '__main__':
    sock=socket.socket();sock.bind(('127.0.0.1',0));sock.listen(128)
    info={'port':sock.getsockname()[1],'token':fixture.token['token'],'cookie':fixture.auth.create_session(fixture.admin['id']),'user':fixture.admin}
    info_path=Path(sys.argv[1]) if len(sys.argv)>1 else None
    if info_path:
        info_path.write_text(json.dumps(info)); info_path.chmod(0o600)
        print(json.dumps({'port':info['port']}),flush=True)
    else:
        print(json.dumps(info),flush=True)
    try:
        uvicorn.Server(uvicorn.Config(app,log_level='warning')).run(sockets=[sock])
    finally:
        fixture.doCleanups()
