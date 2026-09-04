#!/usr/bin/env python3
"""Serve the Smart Canvas manual harness with an editable in-memory backend."""

from __future__ import annotations

import json
import os
import base64
import io
import re
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = int(os.environ.get("SMART_CANVAS_PORT", "8794"))
MOCK_GENERATED_IMAGE = "data:image/svg+xml;base64," + base64.b64encode(
    b'''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#6d5dfc"/><stop offset="1" stop-color="#17b897"/></linearGradient></defs>
    <rect width="1024" height="1024" rx="72" fill="url(#g)"/>
    <circle cx="790" cy="230" r="150" fill="#fff" opacity=".18"/>
    <path d="M110 760 350 480l170 190 120-130 275 300H110Z" fill="#fff" opacity=".72"/>
    <text x="512" y="170" fill="#fff" font-family="system-ui,sans-serif" font-size="58" text-anchor="middle">Mock Generation</text>
    <text x="512" y="230" fill="#fff" opacity=".8" font-family="system-ui,sans-serif" font-size="30" text-anchor="middle">Issue #148 manual test</text>
    </svg>'''
).decode("ascii")

MANUAL_BOOTSTRAP = r"""
<script>
(() => {
  localStorage.removeItem('infiniteCanvasRealtimePending:v1:hit-priority-manual');
  const manualCanvas = {
    id:'hit-priority-manual',
    title:'命中优先级人工验收',
    project:'manual',
    revision:0,
    nodes:[],
    connections:[],
    logs:[],
    settings:{}
  };
  const fixture = new URLSearchParams(location.search).get('fixture');
  if(fixture === 'issue-148-complex') {
    const imageNode = (id, title, x, y, w=220, h=170) => ({
      id, title, type:'smart-image', x, y, w, h, scale:1, images:[], created_at:Date.now()
    });
    const promptNode = (id, title, text, x, y, h=240) => ({
      id, title, text, type:'smart-prompt', x, y, w:316, h,
      llmEnabled:false, created_at:Date.now()
    });
    manualCanvas.id = 'issue-148-complex';
    manualCanvas.title = 'Issue #148 · 复杂乱序整理测试';
    manualCanvas.settings = {generationBatchLayout:'horizontal'};
    manualCanvas.nodes = [
      {id:'frame-research',title:'研究区',type:'smart-frame',x:40,y:40,w:980,h:720,items:['prompt-brief','image-a','image-b','group-mood'],created_at:Date.now()},
      promptNode('prompt-brief','主提示词','一座漂浮在云海上的未来城市，黄昏，电影感',130,120,270),
      imageNode('image-a','构图草案 A',520,105,250,180),
      imageNode('image-b','构图草案 B',455,365,210,220),
      {id:'group-mood',title:'情绪参考组',type:'smart-group',x:705,y:325,w:270,h:350,items:['mood-1','mood-2','mood-3'],created_at:Date.now()},
      imageNode('mood-1','暖色氛围',730,380,180,120),
      imageNode('mood-2','冷色氛围',755,475,180,120),
      imageNode('mood-3','霓虹氛围',715,550,180,120),

      {id:'frame-output',title:'输出区',type:'smart-frame',x:1120,y:110,w:1080,h:760,items:['output-1','output-2','output-3','output-4','output-5','output-6'],created_at:Date.now()},
      imageNode('output-1','第一批 1',1210,190,260,180),
      imageNode('output-2','第一批 2',1505,175,210,230),
      imageNode('output-3','第一批 3',1780,220,300,160),
      imageNode('output-4','第二批 1',1280,505,230,200),
      imageNode('output-5','第二批 2',1510,455,280,180),
      imageNode('output-6','第二批 3',1740,525,220,220),

      promptNode('tree-a','流程 A 根','A：建立世界观',-760,180,220),
      promptNode('tree-b','流程 A 分支','B：设计建筑语言',-390,90,250),
      promptNode('tree-c','流程 A 汇聚','C：统一镜头与光线',-120,315,260),
      promptNode('tree-x','流程 X 根','X：角色设定',-720,640,230),
      promptNode('tree-y','流程 X 结果','Y：角色海报',-300,590,240),

      imageNode('chaos-1','汇聚父节点 A',-900,1040,280,190),
      imageNode('chaos-2','汇聚父节点 B',-850,1370,240,210),
      imageNode('chaos-3','汇聚节点',-480,1190,380,150),
      imageNode('chaos-4','汇聚后继',-20,1110,190,310),
      {id:'splitter-1',title:'提示词拆分',type:'smart-splitter',x:250,y:920,w:316,h:240,separator:';',created_at:Date.now()},
      {id:'loop-1',title:'批量变化',type:'smart-loop',x:720,y:900,w:360,h:406,count:4,mode:'serial',showPrompt:true,imageInput:true,created_at:Date.now()},
      imageNode('orphan','无连接节点',1330,1040,260,180),
      {
        id:'generator-source',title:'Mock 生成源（选中后运行）',type:'smart-image',
        x:1700,y:1030,w:260,h:190,scale:1,images:[],created_at:Date.now(),
        promptDraftText:'霓虹城市与漂浮岛屿，电影感',
        promptDraftHtml:'霓虹城市与漂浮岛屿，电影感',
        runSettings:{
          engine:'api',apiKind:'image',provider_id:'manual-mock',model:'mock-image-1',
          count:4,size:'1024x1024',quality:'auto',resolution:'1k'
        }
      }
    ];
    manualCanvas.connections = [
      {from:'prompt-brief',to:'image-a',kind:'input'},
      {from:'prompt-brief',to:'image-b',kind:'input'},
      {from:'mood-1',to:'image-a',kind:'input'},
      {from:'mood-2',to:'image-a',kind:'input'},
      {from:'mood-3',to:'image-b',kind:'input'},
      {from:'image-a',to:'output-1',kind:'input'},
      {from:'image-a',to:'output-2',kind:'input'},
      {from:'image-a',to:'output-3',kind:'input'},
      {from:'image-b',to:'output-4',kind:'input'},
      {from:'image-b',to:'output-5',kind:'input'},
      {from:'image-b',to:'output-6',kind:'input'},
      {from:'tree-a',to:'tree-b',kind:'input'},
      {from:'tree-a',to:'tree-c',kind:'input'},
      {from:'tree-b',to:'tree-c',kind:'input'},
      {from:'tree-x',to:'tree-y',kind:'input'},
      {from:'chaos-1',to:'chaos-3',kind:'input'},
      {from:'chaos-2',to:'chaos-3',kind:'input'},
      {from:'chaos-3',to:'chaos-4',kind:'input'},
      {from:'splitter-1',to:'loop-1',kind:'input'},
      {from:'loop-1',to:'orphan',kind:'input'}
    ];
  }
  class ManualWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(url) {
      this.url = url;
      this.readyState = ManualWebSocket.CONNECTING;
      this.listeners = new Map();
      this.revision = 0;
      setTimeout(() => {
        this.readyState = ManualWebSocket.OPEN;
        this.emit('open', {});
        setTimeout(() => this.emit('message', {data:JSON.stringify({
          type:'canvas_snapshot',
          revision:this.revision,
          canvas:manualCanvas
        })}), 0);
      }, 0);
    }
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
    removeEventListener(type, listener) {
      this.listeners.set(
        type,
        (this.listeners.get(type) || []).filter(item => item !== listener)
      );
    }
    emit(type, event) {
      this[`on${type}`]?.(event);
      (this.listeners.get(type) || []).forEach(listener => listener(event));
    }
    send(raw) {
      let message = null;
      try { message = JSON.parse(raw); } catch (_error) { return; }
      if(message.type === 'ping') {
        setTimeout(() => this.emit('message', {data:JSON.stringify({
          type:'pong',
          revision:this.revision
        })}), 0);
        return;
      }
      if(message.type !== 'canvas_mutation') return;
      const operation = message.operation || {};
      this.revision += 1;
      setTimeout(() => this.emit('message', {data:JSON.stringify({
        type:'canvas_mutation',
        revision:this.revision,
        operation_id:operation.operation_id || '',
        reverts_operation_id:operation.reverts_operation_id || '',
        changes:operation.changes || {
          node_creates:[], node_updates:[], node_unsets:[], node_deletes:[],
          connection_adds:[], connection_removes:[], canvas_updates:[], canvas_unsets:[]
        }
      })}), 0);
    }
    close(code=1000) {
      if(this.readyState === ManualWebSocket.CLOSED) return;
      this.readyState = ManualWebSocket.CLOSED;
      this.emit('close', {code});
    }
  }
  window.WebSocket = ManualWebSocket;
})();
</script>
"""


class ManualHandler(SimpleHTTPRequestHandler):
    image_tasks: dict[str, dict[str, object]] = {}
    image_task_sequence = 0

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def send_json(self, value: object, status: int = 200) -> None:
        payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def read_json(self) -> dict[str, object]:
        length = int(self.headers.get("Content-Length", "0") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return {}

    def read_uploaded_file(self) -> tuple[str, bytes]:
        """Read the single FormData file used by the Node Package manual flow."""
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length) if length else b""
        content_type = self.headers.get("Content-Type", "")
        boundary_match = re.search(r"boundary=(?:\"([^\"]+)\"|([^;]+))", content_type)
        if not boundary_match:
            return "", b""
        boundary = (boundary_match.group(1) or boundary_match.group(2) or "").encode()
        for part in body.split(b"--" + boundary):
            header, separator, payload = part.partition(b"\r\n\r\n")
            if not separator or b'name="file"' not in header:
                continue
            filename_match = re.search(br'filename="([^"]*)"', header)
            filename = filename_match.group(1).decode("utf-8", "replace") if filename_match else ""
            return filename, payload.removesuffix(b"\r\n")
        return "", b""

    def node_package_payload(self, filename: str, raw: bytes) -> dict[str, object]:
        if filename.lower().endswith(".zip") or raw[:2] == b"PK":
            with zipfile.ZipFile(io.BytesIO(raw), "r") as archive:
                workflow_name = next(
                    (name for name in archive.namelist() if name.lower().endswith("workflow.json")),
                    "",
                )
                if not workflow_name:
                    raise ValueError("压缩包中没有 workflow.json")
                return json.loads(archive.read(workflow_name).decode("utf-8-sig"))
        return json.loads(raw.decode("utf-8-sig"))

    def manual_canvas(self, canvas_id: str) -> dict[str, object]:
        return {
            "id": canvas_id,
            "title": "命中优先级人工验收",
            "project": "manual",
            "revision": 0,
            "nodes": [],
            "connections": [],
            "logs": [],
            "settings": {},
        }

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path == "/static/smart-canvas.html" and query.get("manual") == ["1"]:
            html = (ROOT / "static" / "smart-canvas.html").read_text(encoding="utf-8")
            payload = html.replace("<head>", f"<head>{MANUAL_BOOTSTRAP}", 1).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)
            return
        if parsed.path == "/api/config":
            self.send_json({
                "image_models": ["mock-image-1"],
                "api_providers": [{
                    "id": "manual-mock",
                    "name": "手动测试生成",
                    "enabled": True,
                    "image_models": ["mock-image-1"],
                }],
                "available_models": {
                    "image": [{
                        "id": "manual-mock-image-1",
                        "provider_id": "manual-mock",
                        "provider_name": "手动测试生成",
                        "model": "mock-image-1",
                        "name": "Mock Image 1",
                    }],
                    "video": [],
                    "text": [],
                },
                "comfy_instances": [],
            })
            return
        if parsed.path == "/api/model-capabilities":
            operation = (query.get("operation") or ["image.generate"])[0]
            is_text = operation == "text.generate"
            self.send_json({
                "provider_id": (query.get("provider_id") or ["manual-mock"])[0],
                "model_id": (query.get("model") or ["mock-image-1"])[0],
                "operation": operation,
                "capability_schema_version": 1,
                "catalog_revision": "manual-catalog-revision-1",
                "support_state": "supported",
                "source": "manual-test",
                "inputs": ({
                    "text": {"minimum": 1, "maximum": 1},
                    "image": {"minimum": 0, "maximum": 8},
                    "video": {"minimum": 0, "maximum": 3},
                } if is_text else {
                    "text": {"minimum": 1, "maximum": 1},
                    "image": {
                        "minimum": 1 if operation == "image.edit" else 0,
                        "maximum": 20 if operation == "image.edit" else 0,
                    },
                }),
                "output": ({"kind": "text"} if is_text else {
                    "kind": "image", "count": {"minimum": 1, "maximum": 4}
                }),
                "parameters": ({
                    "history": {"type": "array", "minimum": 0, "maximum": 30},
                    "system_prompt": {"type": "string", "minimum": 0, "maximum": 20000},
                } if is_text else {
                    "aspect_ratio": {"type": "enum", "values": ["1:1", "16:9"]},
                    "resolution_tier": {"type": "enum", "values": ["1K", "2K", "4K"]},
                    "quality": {"type": "enum", "values": ["auto", "low", "medium", "high"]},
                    "count": {"type": "integer", "minimum": 1, "maximum": 4},
                }),
                "media_contract": ({} if is_text else {
                    "aspect_ratios": ["1:1", "16:9"],
                    "resolution_tiers": ["1K", "2K", "4K"],
                    "default_resolution_tier": "1K",
                    "known": True,
                    "supports_transparent_png": False,
                }),
            })
            return
        if parsed.path == "/api/workflows":
            self.send_json({"workflows": []})
            return
        if parsed.path == "/api/prompt-libraries":
            self.send_json({"library": {"libraries": []}})
            return
        if parsed.path == "/api/smart-canvas/prompt-templates":
            self.send_json({"templates": []})
            return
        if parsed.path == "/api/canvas-workflows/limits":
            self.send_json({
                "max_archive_bytes": 384 * 1024 * 1024,
                "max_extracted_bytes": 500 * 1024 * 1024,
                "max_entries": 500,
            })
            return
        if parsed.path.startswith("/api/smart-canvas/") and parsed.path.endswith("/view-state"):
            self.send_json({"view_state": None})
            return
        if parsed.path.startswith("/api/canvas-image-tasks/"):
            task_id = parsed.path.rsplit("/", 1)[-1]
            task = type(self).image_tasks.get(task_id)
            self.send_json(task or {"detail": "Mock task not found"}, 200 if task else 404)
            return
        if parsed.path.startswith("/api/canvases/"):
            canvas_id = parsed.path.rsplit("/", 1)[-1]
            self.send_json({"canvas": self.manual_canvas(canvas_id)})
            return
        super().do_GET()

    def do_PUT(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/smart-canvas/") and parsed.path.endswith("/view-state"):
            self.send_json({"ok": True})
            return
        self.send_json({})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path in {"/api/canvas-workflows/inspect", "/api/canvas-workflows/import"}:
            try:
                filename, raw = self.read_uploaded_file()
                workflow = self.node_package_payload(filename, raw)
                if isinstance(workflow, list):
                    workflow = {"nodes": workflow, "connections": [], "resources": []}
                if not isinstance(workflow, dict):
                    raise ValueError("节点包格式不正确")
                nested = workflow.get("workflow") if isinstance(workflow.get("workflow"), dict) else workflow
                nodes = nested.get("nodes")
                if not isinstance(nodes, list) or not nodes:
                    raise ValueError("节点包中没有可导入的节点")
                connections = nested.get("connections") if isinstance(nested.get("connections"), list) else []
                resources = workflow.get("resources") if isinstance(workflow.get("resources"), list) else []
            except (ValueError, UnicodeDecodeError, json.JSONDecodeError, zipfile.BadZipFile) as error:
                self.send_json({"detail": str(error) or "无法读取节点包"}, 400)
                return
            if parsed.path.endswith("/inspect"):
                self.send_json({
                    "node_count": len(nodes),
                    "connection_count": len(connections),
                    "resource_count": len(resources),
                    "resource_bytes": sum(
                        max(0, int(item.get("size") or 0))
                        for item in resources
                        if isinstance(item, dict)
                    ),
                    "package_type": "zip" if filename.lower().endswith(".zip") else "json",
                    "warning": "",
                })
                return
            self.send_json({"workflow": workflow, "nodes": nodes, "connections": connections, "resource_map": {}})
            return
        if parsed.path == "/api/canvas-image-tasks":
            payload = self.read_json()
            type(self).image_task_sequence += 1
            task_id = f"manual-image-{type(self).image_task_sequence}"
            output_count = max(1, int(payload.get("n") or 1))
            type(self).image_tasks[task_id] = {
                "task_id": task_id,
                "status": "succeeded",
                "provider_id": payload.get("provider_id", "manual-mock"),
                "result": {
                    "images": [
                        {
                            "url": f"{MOCK_GENERATED_IMAGE}#output-{index + 1}",
                            "name": f"{task_id}-{index + 1}.svg",
                            "kind": "image",
                        }
                        for index in range(output_count)
                    ]
                },
            }
            self.send_json({"task_id": task_id, "actor_id": "manual-test"})
            return
        self.send_json({})


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), ManualHandler)
    print(f"Smart Canvas manual server: http://{HOST}:{PORT}/tests/smart_canvas_hit_priority_manual.html", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
