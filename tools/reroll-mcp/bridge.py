"""Local filesystem boundary and versioned API client. Never logs credentials."""

import copy
import difflib
import hashlib
import fnmatch
import json
import mimetypes
import os
import re
from pathlib import Path
import time
from urllib.parse import quote, urlsplit
import uuid

import httpx
from credentials import Credentials


class BridgeError(ValueError):
    def __init__(self, code, details=None):
        self.code, self.details = code, details or {}
        super().__init__(code)


class Bridge:
    def __init__(self, url, token="", roots=(), download_directory=None, client=None, *, client_name="MCP Agent", credential_directory=None):
        parsed = urlsplit(url)
        if (
            parsed.scheme not in ("http", "https")
            or not parsed.netloc
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise BridgeError("invalid_server_url")
        self.url = str(httpx.URL(url)).rstrip('/')
        try:
            self.credentials = None if token else Credentials(self.url, client_name, credential_directory)
        except (OSError, ValueError, TypeError, AttributeError):
            raise BridgeError('credential_store_unavailable') from None
        self.token = token or self.credentials.data['token']
        self.client = client or httpx.Client(
            base_url=url.rstrip("/") + "/",
            headers={"Authorization": "Bearer " + self.token},
            timeout=60,
            follow_redirects=False,
            trust_env=False,
        )
        self.client.headers['Authorization'] = 'Bearer ' + self.token
        self.roots = [Path(r).expanduser().resolve(strict=True) for r in roots]
        self.download_directory = (
            Path(download_directory or Path.home() / "Downloads" / "Reroll")
            .expanduser()
            .resolve()
        )
        self.target = None

    def authorize(self):
        if not self.credentials or self.credentials.data.get('approved'):
            return
        data = self.credentials.data
        try:
            # Approval can finish while this process is stopped. The token remains
            # valid after the short-lived pairing record has been cleaned up.
            probe = self.client.get('api/agent/v1/info')
            if probe.is_success:
                data['approved'] = True
                self.credentials.save()
                return
            response = self.client.post('api/agent/pairing/start', json={
                'token_hash': hashlib.sha256(self.token.encode()).hexdigest(),
                'name': self.credentials.name})
            if not response.is_success:
                raise BridgeError(response.json().get('code', 'pairing_failed'))
            pairing = response.json()
            # Return immediately so Codex/Claude can tell the user to approve.
            # The next tool call resumes the same request without another popup.
            if pairing['state'] == 'approved':
                data['approved'] = True
                self.credentials.save()
                return
            if pairing['state'] == 'denied':
                raise BridgeError('authorization_denied', {'url': self.url, 'retry': 'The user denied this request. Wait for this request to expire (10 minutes) before trying again.'})
            raise BridgeError('authorization_required', {
                'url': self.url, 'code': pairing['code'],
                'expires_at': pairing['expires_at'],
                'instruction': 'Open Reroll in your browser, sign in, and approve the matching request. Then retry this tool. No token needs to be copied.'})
        except (httpx.TransportError, httpx.TimeoutException):
            raise BridgeError('server_unreachable') from None
        except OSError:
            raise BridgeError('credential_store_unavailable') from None

    def request(self, method, path, *, body=None, params=None, key=None, files=None, deadline=None, clock=time.monotonic):
        self.authorize()
        headers = (
            {"Idempotency-Key": key or uuid.uuid4().hex} if method != "GET" else {}
        )
        for attempt in range(3):
            try:
                if files:
                    for value in files.values():
                        value[1].seek(0)
                timeout_options = {}
                if deadline is not None:
                    remaining = deadline - clock()
                    if remaining <= 0:
                        raise TimeoutError()
                    timeout_options['timeout'] = min(60, remaining)
                response = self.client.request(
                    method,
                    "api/agent/v1/" + path.lstrip("/"),
                    json=body,
                    params=params,
                    headers=headers,
                    files=files,
                    **timeout_options,
                )
                break
            except (httpx.TransportError, httpx.TimeoutException):
                if deadline is not None and clock() >= deadline:
                    raise TimeoutError() from None
                if attempt == 2:
                    raise BridgeError("server_unreachable") from None
                delay = 0.2 * (attempt + 1)
                if deadline is not None:
                    delay = min(delay, max(0, deadline - clock()))
                time.sleep(delay)
        if not response.is_success:
            try:
                data = response.json()
            except ValueError:
                raise BridgeError(
                    "api_error", {"status": response.status_code}
                ) from None
            if not isinstance(data, dict):
                data = {}
            if data.get('code') == 'unauthorized' and self.credentials:
                try:
                    self.credentials.reset()
                except OSError:
                    raise BridgeError('credential_store_unavailable') from None
                self.target = None
                self.token = self.credentials.data['token']
                self.client.headers['Authorization'] = 'Bearer ' + self.token
                raise BridgeError('authorization_revoked', {'instruction': 'Access was revoked. Retry the tool to request fresh browser approval.'})
            raise BridgeError(data.get("code", "api_error"), data.get("details", {}))
        return response.json()

    def local_path(self, value):
        raw = Path(value).expanduser()
        if ".." in raw.parts:
            raise BridgeError("local_path_forbidden")
        try:
            path = raw.resolve(strict=True)
        except OSError:
            raise BridgeError("local_file_missing") from None
        if (
            not any(path.is_relative_to(root) for root in self.roots)
            or not path.is_file()
        ):
            raise BridgeError("local_path_forbidden")
        return path

    def find(self, pattern="*", kind="", query=""):
        found = []
        visited = set()
        for root in self.roots:
            for directory, dirs, names in os.walk(root, followlinks=False):
                dirs[:] = [
                    d
                    for d in dirs
                    if not d.startswith(".") and not Path(directory, d).is_symlink()
                ]
                for name in names:
                    if name.startswith(".") or not fnmatch.fnmatch(
                        name.casefold(), pattern.casefold()
                    ):
                        continue
                    try:
                        path = self.local_path(str(Path(directory, name)))
                    except BridgeError:
                        continue
                    if path in visited:
                        continue
                    visited.add(path)
                    media_kind = (mimetypes.guess_type(name)[0] or "").split("/")[0]
                    if (
                        media_kind not in ("image", "video", "audio", "text")
                        or kind
                        and kind != media_kind
                    ):
                        continue
                    info = path.stat()
                    found.append(
                        {
                            "path": str(path),
                            "name": name,
                            "kind": media_kind,
                            "size": info.st_size,
                            "modified_at": info.st_mtime,
                            "similarity": (
                                difflib.SequenceMatcher(
                                    None, query.casefold(), path.stem.casefold()
                                ).ratio()
                                if query
                                else 1
                            ),
                        }
                    )
        return {
            "files": sorted(found, key=lambda x: (-x["similarity"], x["name"]))[:200]
        }

    def canvas(self, value=""):
        if value:
            return self.use_canvas(value)["canvas"]["id"]
        if self.target is None:
            self.target = self.request("GET", "context/target")["canvas"]
        return self.target["id"]

    def use_canvas(self, value):
        items = self.request("GET", "canvases")["canvases"]
        matches = [c for c in items if c["id"] == value] or [
            c for c in items if value.casefold() in c["name"].casefold()
        ]
        if len(matches) != 1:
            raise BridgeError("canvas_ambiguous", {"candidates": matches})
        self.target = matches[0]
        return {"canvas": self.target}

    def import_media(self, path):
        source = self.local_path(path)
        # The path is confined locally. Only basename and bytes cross the wire.
        with source.open("rb") as stream:
            return self.request(
                "POST",
                "media",
                files={
                    "file": (
                        source.name,
                        stream,
                        mimetypes.guess_type(source.name)[0]
                        or "application/octet-stream",
                    )
                },
            )

    def recipes(self, tasks, dry_run=False):
        result = copy.deepcopy(tasks)
        uploaded = {}
        for task in result:
            for source in task.get("refs", {}).values():
                if "file" not in source:
                    continue
                path = self.local_path(source.pop("file"))
                if dry_run:
                    source["file"] = {
                        "name": path.name,
                        "kind": (mimetypes.guess_type(path.name)[0] or "").split("/")[
                            0
                        ],
                        "size": path.stat().st_size,
                    }
                else:
                    if path not in uploaded:
                        uploaded[path] = self.import_media(str(path))
                    source["media"] = uploaded[path]["media_id"]
        return result

    def submit(
        self, tasks, canvas="", title="", dry_run=False, kind="generation", key=None
    ):
        canvas_id = self.canvas(canvas)
        recipes = self.recipes(tasks, dry_run=dry_run)
        return self.request(
            "POST",
            f'canvases/{quote(canvas_id,safe="")}/submissions',
            body={"tasks": recipes, "title": title, "dry_run": dry_run, "type": kind},
            key=key,
        )

    @staticmethod
    def valid_download_url(value):
        if not isinstance(value, str):
            return False
        parsed = urlsplit(value)
        if parsed.scheme or parsed.netloc or parsed.fragment:
            return False
        media = re.fullmatch(r'/api/agent/v1/media/[A-Za-z0-9_-]+/content', parsed.path)
        image_run = re.fullmatch(r'/api/agent/v1/image-runs/[A-Za-z0-9_-]+/outputs/[0-9]+', parsed.path)
        return bool(media or image_run and not parsed.query)

    def download(self, tasks):
        self.download_directory.mkdir(parents=True, exist_ok=True)
        saved = []
        for task in tasks:
            for output in task.get("outputs", []):
                url = output.get("download_url", "")
                if not self.valid_download_url(url):
                    raise BridgeError("invalid_download_url")
                name = Path(output.get("name", "output").replace("\\", "/")).name
                if name in ("", ".", ".."):
                    name = "output"
                path = self.download_directory / name
                index = 1
                while True:
                    try:
                        stream = path.open("xb")
                        break
                    except FileExistsError:
                        path = (
                            self.download_directory
                            / f"{Path(name).stem} ({index}){Path(name).suffix}"
                        )
                        index += 1
                try:
                    with stream, self.client.stream("GET", url) as response:
                        if not response.is_success:
                            raise BridgeError("download_failed")
                        for chunk in response.iter_bytes():
                            stream.write(chunk)
                except Exception:
                    path.unlink(missing_ok=True)
                    raise
                saved.append(str(path))
        return {"files": saved}
