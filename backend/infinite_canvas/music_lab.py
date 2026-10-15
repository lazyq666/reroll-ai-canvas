"""APIMart Suno contracts and an adapter for the shared Generation Run lifecycle.

Secrets are resolved only at execution. Paid requests are submitted once;
recovery always queries the checkpointed music task. The lab's private history
is a view of owned Runs, not a second history database.
"""
from __future__ import annotations

import hashlib
import ipaddress
import math
import mimetypes
from html.parser import HTMLParser
from pathlib import Path
from collections.abc import Callable, Mapping
from typing import Any, Literal
from urllib.parse import quote, urljoin, urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from .generation_runs import Background, GenerationRunError, WorkflowRun
from .providers.core import Completed, Failed, Pending
from .providers.runtime import ProviderOutput

SUNO_VERSIONS = ("v6", "v6-wild", "v6-mini")
MUSIC_OPERATIONS = frozenset({"generate", "inspo", "cover", "upload", "download"})
FORMATS = ("mp3", "m4a", "wav")


def public_audio_url(value: str) -> str:
    value = value.strip()
    parsed = urlsplit(value)
    host = (parsed.hostname or "").lower()
    if (parsed.scheme not in {"https", "http"} or not host or parsed.username
            or parsed.password or parsed.fragment or host == "localhost"
            or host.endswith((".localhost", ".local", ".internal"))):
        raise ValueError("music.invalidUrl")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        if not address.is_global:
            raise ValueError("music.invalidUrl")
    return value


class MusicGeneration(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    version: Literal["v6", "v6-wild", "v6-mini"] = "v6"
    custom: bool = False
    instrumental: bool = False
    prompt: str = Field(default="", max_length=5000)
    title: str = Field(default="", max_length=80)
    style: str = Field(default="", max_length=1000)
    negative_tags: str = Field(default="", max_length=5000)
    auto_lyrics: bool = False
    persona_id: str = Field(default="", max_length=200)
    vocal_gender: Literal["Male", "Female"] | None = None
    style_weight: float | None = Field(default=None, ge=0, le=1)
    weirdness_constraint: float | None = Field(default=None, ge=0, le=1)
    audio_weight: float | None = Field(default=None, ge=0, le=1)
    variety: Literal["off", "normal", "high", "extra", "max"] | None = None
    audio_format: Literal["mp3", "m4a", "wav"] | None = None
    duration: int | None = Field(default=None, ge=10, le=360, strict=True)
    max_mode: bool = False

    @model_validator(mode="after")
    def validate_mode(self):
        if not self.custom and (not self.prompt.strip() or len(self.prompt) > 3000):
            raise ValueError("music.invalidPrompt")
        if self.custom and not self.instrumental and not self.prompt.strip():
            raise ValueError("music.invalidLyrics")
        if not self.custom and (self.title or self.style or self.negative_tags
                or self.auto_lyrics or self.persona_id or self.duration is not None or self.max_mode):
            raise ValueError("music.customOnly")
        return self

    def upstream(self) -> dict:
        body = self.model_dump(exclude_none=True)
        for key in ("title", "style", "negative_tags", "persona_id"):
            if not body[key]:
                body.pop(key)
        if not self.custom:
            for key in ("auto_lyrics", "max_mode"):
                body.pop(key)
        return {"model": "suno", **body}


class MusicCover(MusicGeneration):
    """Explicit Cover intent, independent of whether the output has vocals."""
    custom: Literal[True] = True
    instrumental: bool = True

    @model_validator(mode="after")
    def validate_description(self):
        if self.instrumental and (self.auto_lyrics or self.vocal_gender is not None):
            raise ValueError("music.customOnly")
        if len(self.cover_tags()) > 1000:
            raise ValueError("music.coverDescriptionTooLong")
        return self

    def cover_tags(self):
        return ", ".join(part.strip() for part in ((self.prompt, self.style) if self.instrumental else (self.style,)) if part.strip())

    def upstream(self):
        body = super().upstream()
        for key in (("prompt", "style", "auto_lyrics", "vocal_gender") if self.instrumental else ("style",)):
            body.pop(key, None)
        if self.cover_tags():
            body["tags"] = self.cover_tags()
        for source, target in (("weirdness_constraint", "weirdness"), ("duration", "duration_s")):
            if source in body:
                body[target] = body.pop(source)
        return body


class MusicSubmission(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider_id: str = Field(min_length=1, max_length=100)
    operation_id: str = Field(min_length=8, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    settings: MusicGeneration


REFERENCE_MAX_BYTES = 50 * 1024 * 1024
REFERENCE_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}


class MusicInspiration(BaseModel):
    """Inspo has its own contract; ordinary generation-only fields are rejected."""
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    version: Literal["v6", "v6-wild", "v6-mini"] = "v6"
    prompt: str = Field(default="", max_length=5000)
    title: str = Field(default="", max_length=80)
    tags: str = Field(default="", max_length=1000)
    negative_tags: str = Field(default="", max_length=5000)
    auto_lyrics: bool = False
    vocal_gender: Literal["Male", "Female"] | None = None
    style_weight: float | None = Field(default=None, ge=0, le=1)
    weirdness: float | None = Field(default=None, ge=0, le=1)
    audio_weight: float | None = Field(default=None, ge=0, le=1)
    variety: Literal["off", "normal", "high", "extra", "max"] | None = None
    audio_format: Literal["mp3", "m4a", "wav"] | None = None
    max_mode: bool = False

    def upstream(self):
        return {"model": "suno", **{key: value for key, value in
            self.model_dump(exclude_none=True).items() if value != ""}}


class MusicReference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    file_index: int | None = Field(default=None, ge=0, le=3, strict=True)
    run_id: str = Field(default="", max_length=100)
    index: int | None = Field(default=None, ge=0, le=3, strict=True)

    @model_validator(mode="after")
    def one_source(self):
        local = self.file_index is not None
        if (local and (self.run_id or self.index is not None)) or (not local and (not self.run_id or self.index is None)):
            raise ValueError("music.invalidReference")
        return self


class MusicInspirationSubmission(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider_id: str = Field(min_length=1, max_length=100)
    operation_id: str = Field(min_length=8, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    settings: MusicInspiration
    references: list[MusicReference] = Field(min_length=1, max_length=4)


class MusicCoverSubmission(MusicSubmission):
    settings: MusicCover
    references: list[MusicReference] = Field(min_length=1, max_length=1)


def reference_duration(url: str):
    from .providers.http_impl import probe_local_audio_duration_seconds
    return probe_local_audio_duration_seconds(url)


def plausible_audio(content: bytes, suffix: str) -> bool:
    # Bound local imports to known audio containers before anything leaves the device.
    return bool({
        ".wav": content[:4] == b"RIFF" and content[8:12] == b"WAVE",
        ".mp3": content[:3] == b"ID3" or (len(content) > 1 and content[0] == 255 and content[1] & 224 == 224),
        ".aac": len(content) > 1 and content[0] == 255 and content[1] & 246 == 240,
        ".m4a": content[4:8] == b"ftyp",
        ".ogg": content[:4] == b"OggS",
        ".flac": content[:4] == b"fLaC",
    }.get(suffix, False))


async def verify_hosted_music_reference(path: str, url: str) -> str:
    """A successful upload can return an HTML landing page, not an audio URL.

    Verify an unauthenticated GET against the exact local bytes before a paid
    submission. Bound reads and redirects; never send provider credentials.
    """
    source = await run_in_threadpool(Path(path).read_bytes)
    if not source or len(source) > REFERENCE_MAX_BYTES:
        raise ValueError("music.hostingFailed")
    expected = hashlib.sha256(source).digest()
    async with httpx.AsyncClient(timeout=60, follow_redirects=False) as client:
        for _ in range(4):
            url = public_audio_url(url)
            client.cookies.clear()
            async with client.stream("GET", url) as response:
                if response.is_redirect:
                    url = urljoin(url, response.headers.get("location", ""))
                    continue
                response.raise_for_status()
                digest, size = hashlib.sha256(), 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > len(source):
                        raise ValueError("music.hostingFailed")
                    digest.update(chunk)
                if size != len(source) or digest.digest() != expected:
                    raise ValueError("music.hostingFailed")
                return url
    raise ValueError("music.hostingFailed")


class _MusicDownloadLink(HTMLParser):
    """Read the host's actual download link; upload URLs are landing pages."""
    def __init__(self):
        super().__init__()
        self.url = ""

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a" and "download" in str(attrs.get("class") or "").split():
            self.url = attrs.get("href", "")


async def upload_music_reference_tmpfiles(path: str, source_url: str) -> dict:
    # The storage lifetime is six hours. Download signatures are shorter-lived,
    # so resolve a fresh link immediately before verification and submission.
    async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=20, write=120), follow_redirects=False) as client:
        with open(path, "rb") as source:
            response = await client.post("https://tmpfiles.org/api/v1/upload",
                data={"expire": "21600"}, files={"file": (
                    Path(path).name, source, mimetypes.guess_type(path)[0] or "application/octet-stream")})
        response.raise_for_status()
        result = response.json()
        if (not isinstance(result, Mapping) or result.get("status") != "success"
                or not isinstance(result.get("data"), Mapping)):
            raise ValueError("music.hostingFailed")
        landing = public_audio_url(str(result["data"].get("url") or ""))
        if urlsplit(landing).netloc != "tmpfiles.org" or urlsplit(landing).scheme != "https":
            raise ValueError("music.hostingFailed")
        client.cookies.clear()
        async with client.stream("GET", landing) as response:
            response.raise_for_status()
            content = bytearray()
            async for chunk in response.aiter_bytes():
                content.extend(chunk)
                if len(content) > 65536:
                    raise ValueError("music.hostingFailed")
        parser = _MusicDownloadLink()
        parser.feed(content.decode("utf-8"))
        direct = public_audio_url(urljoin(landing, parser.url))
        parsed = urlsplit(direct)
        if (parsed.netloc != "tmpfiles.org" or parsed.scheme != "https"
                or not parsed.path.startswith("/dl/")):
            raise ValueError("music.hostingFailed")
        return {"url": direct, "source": source_url, "service": "tmpfiles"}


async def host_music_reference(reference: dict) -> str:
    """Use verified direct audio links; never forward provider credentials."""
    from .providers.http_impl import local_media_path_for_cloud_upload, upload_video_to_litterbox
    try:
        path = local_media_path_for_cloud_upload(reference["url"], allowed_prefixes=("audio/",))
    except HTTPException as exc:
        raise MusicProviderError("music.referenceMissing", 404) from exc
    for upload in (upload_video_to_litterbox, upload_music_reference_tmpfiles):
        try:
            result = await upload(path, reference["url"])
            return await verify_hosted_music_reference(path, result["url"])
        except (HTTPException, ValueError, httpx.HTTPError, OSError):
            continue
    raise MusicProviderError("music.hostingFailed")


class MusicUpload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider_id: str = Field(min_length=1, max_length=100)
    operation_id: str = Field(min_length=8, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    audio_url: str = Field(min_length=1, max_length=4000)

    @model_validator(mode="after")
    def validate_url(self):
        self.audio_url = public_audio_url(self.audio_url)
        return self


class MusicDownload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    audio_index: int = Field(ge=1, le=100, strict=True)
    formats: list[Literal["mp3", "m4a", "wav"]] = Field(min_length=1, max_length=3)


class MusicProviderError(Exception):
    def __init__(self, code: str, status: int = 502):
        self.code, self.status = code, status
        super().__init__(code)


def music_provider(provider: Mapping[str, Any]) -> dict:
    if not provider or not provider.get("enabled", True):
        raise MusicProviderError("music.noProvider", 400)
    root = str(provider.get("base_url") or "").rstrip("/")
    if root.endswith("/v1"):
        root = root[:-3]
    host = (urlsplit(root).hostname or "").lower()
    if provider.get("protocol") != "apimart" and host != "api.apimart.ai":
        raise MusicProviderError("music.noProvider", 400)
    key = str(provider.get("api_key") or "").strip()
    if not key or not root:
        raise MusicProviderError("music.noCredentials", 400)
    return {"id": provider["id"], "root": root, "key": key}


class ApimartMusicClient:
    def __init__(self, provider: Mapping[str, Any], *, transport=None):
        self.provider = music_provider(provider)
        self.transport = transport

    async def request(self, method: str, path: str, body=None) -> dict:
        try:
            async with httpx.AsyncClient(timeout=60, transport=self.transport) as client:
                response = await client.request(method, self.provider["root"] + path,
                    headers={"Authorization": "Bearer " + self.provider["key"]}, json=body)
        except httpx.HTTPError as exc:
            raise MusicProviderError("music.submissionUnknown" if method == "POST" else "music.pollFailed") from exc
        if response.status_code >= 400:
            codes = {401: "music.credentialsRejected", 403: "music.credentialsRejected",
                     402: "music.noBalance", 429: "music.rateLimited", 404: "music.taskMissing"}
            code = codes.get(response.status_code, "music.providerFailed")
            if response.status_code >= 500 or response.status_code == 408:
                code = "music.submissionUnknown" if method == "POST" else "music.pollFailed"
            raise MusicProviderError(code, response.status_code)
        try:
            data = response.json()
            if not isinstance(data, dict) or data.get("code", 200) != 200:
                raise ValueError()
            return data
        except (ValueError, TypeError) as exc:
            raise MusicProviderError("music.submissionUnknown" if method == "POST" else "music.invalidResponse") from exc

    async def submit(self, operation: str, body: dict) -> str:
        path = {"generate": "/v1/music/generations", "upload": "/v1/music/generations/uploadTask",
                "cover": "/v1/music/generations/uploadCover",
                "download": "/v1/music/generations/download", "inspo": "/v1/music/generations/inspo"}[operation]
        data = (await self.request("POST", path, body)).get("data")
        task = data[0] if isinstance(data, list) and data else data
        task_id = task.get("task_id") if isinstance(task, dict) else None
        if not task_id or not isinstance(task_id, str):
            raise MusicProviderError("music.submissionUnknown")
        return task_id

    async def query(self, task_id: str) -> dict:
        data = (await self.request("GET", "/v1/music/tasks/" + quote(task_id, safe=""))).get("data")
        if not isinstance(data, dict):
            raise MusicProviderError("music.invalidResponse")
        return data


def music_output(data: Mapping, operation: str, task_id: str) -> dict:
    result = data.get("result") or {}
    if not isinstance(result, dict):
        raise MusicProviderError("music.invalidResponse")
    items = []
    if operation == "download":
        files = result.get("files") or []
        if not files and result.get("wavUrl"):
            files = [{"format": "wav", "url": result["wavUrl"]}]
        for entry in files:
            if isinstance(entry, dict) and entry.get("format") in FORMATS and entry.get("url"):
                items.append({"kind": "audio", "url": public_audio_url(entry["url"]),
                              "format": entry["format"], "audio_index": len(items) + 1})
    else:
        music = result.get("music") or []
        if not music and operation == "upload" and result.get("audio_id"):
            music = [result]
        for index, entry in enumerate(music, 1):
            if not isinstance(entry, dict):
                continue
            item = {key: entry[key] for key in ("audio_id", "title", "lyrics", "tags", "display_tags",
                    "negative_tags", "duration", "status", "style_weight", "weirdness_constraint", "audio_weight") if key in entry}
            item.update(kind="audio", audio_index=index)
            # Artwork belongs to this music[] entry, never to the task as a whole.
            # Optional malformed artwork must not discard a playable audio result.
            for field in ("image_url", "image_large_url"):
                if isinstance(entry.get(field), str) and entry[field].strip():
                    try:
                        item[field] = public_audio_url(entry[field])
                    except ValueError:
                        pass
            if entry.get("audio_url"):
                item["url"] = public_audio_url(entry["audio_url"])
                suffix = urlsplit(item["url"]).path.rsplit(".", 1)[-1].lower()
                item["format"] = suffix if suffix in FORMATS else "mp3"
            items.append(item)
    if not items or (operation != "upload" and not any(item.get("url") for item in items)):
        raise MusicProviderError("music.invalidResponse")
    return {"kind": "audio", "type": "suno", "operation": operation, "task_id": task_id,
            "items": items, "cost": data.get("cost"), "credits_cost": data.get("credits_cost")}


class MusicGenerationExecutor:
    def __init__(self, *, delegate, provider_lookup: Callable, client_factory=ApimartMusicClient, reference_host=host_music_reference):
        self.delegate, self.provider_lookup, self.client_factory = delegate, provider_lookup, client_factory
        self.reference_host = reference_host

    def requires_child_attempts(self, request):
        return self.delegate.requires_child_attempts(request)

    def is_restart_recoverable(self, request):
        predicate = getattr(self.delegate, "is_restart_recoverable", None)
        return bool(predicate and predicate(request))

    async def execute(self, request, *, checkpoint=None, progress=None):
        if not isinstance(request, WorkflowRun) or not request.operation.startswith("suno-"):
            return await self.delegate.execute(request, checkpoint=checkpoint, progress=progress)
        payload = request.payload
        if not isinstance(payload, Mapping):
            payload = vars(payload)
        operation = payload["operation"]
        task_id = str(payload.get("task_id") or "")
        try:
            client = self.client_factory(self.provider_lookup(request.provider_id))
            if not task_id:
                body = dict(payload["body"])
                if operation == "inspo":
                    body["audio_urls"] = [await self.reference_host(ref) for ref in payload["references"]]
                if operation == "cover":
                    body["audio_url"] = await self.reference_host(payload["references"][0])
                task_id = await client.submit(operation, body)
                pending = Pending(task_id)
                if checkpoint:
                    checkpoint(pending)
                return pending
            data = await client.query(task_id)
            state = str(data.get("status") or "unknown").lower()
            if state == "completed":
                return Completed(ProviderOutput(legacy=music_output(data, operation, task_id),
                                                remote_refs=(task_id,), model="suno"))
            if state in {"failed", "cancelled"}:
                error = data.get("error")
                message = str(error.get("message") or "") if isinstance(error, Mapping) else ""
                if "did not pass content safety review" in message.lower():
                    return Failed("music.contentRejected")
                return Failed("music.providerFailed")
            return Pending(task_id)
        except MusicProviderError as exc:
            # A query outage must never turn into another paid submission.
            if task_id and exc.code in {"music.pollFailed", "music.invalidResponse", "music.rateLimited"}:
                return Pending(task_id)
            return Failed(exc.code)
        except HTTPException:
            return Pending(task_id) if task_id else Failed("music.noProvider")
        except ValueError:
            return Failed("music.invalidResponse")


def music_run_public(run) -> dict:
    meta = run.public_metadata
    return {"id": run.id, "status": run.status, "created_at": run.created_at,
            "updated_at": run.updated_at, "provider_id": run.provider_id,
            "operation": meta.get("operation"), "params": meta.get("params", {}),
            "references": [{"name": ref["name"], "size": ref.get("size", 0), "duration": ref.get("duration"),
                            "url": f"/api/music/runs/{run.id}/references/{index}"}
                           for index, ref in enumerate(meta.get("references", []))],
            "source_run_id": meta.get("source_run_id", ""), "audio_index": meta.get("audio_index"),
            "result": run.result, "error_code": run.error if run.error.startswith("music.") else ("music.failed" if run.error else ""),
            "recoverable": run.recoverable and run.status not in {"succeeded", "failed", "cancelled"}, "remote_task_id": next(iter(run.remote_refs), "")}


def create_music_router(*, runs: Callable, actor: Callable, providers: Callable,
                        provider_lookup: Callable, download_file: Callable, import_reference: Callable | None = None,
                        probe_reference: Callable = reference_duration) -> APIRouter:
    router = APIRouter(prefix="/api/music")

    def owner():
        return str(actor()["id"])

    async def owned(run_id: str):
        try:
            run = await runs().query(run_id, owner=owner())
            if run.public_metadata.get("surface") != "suno":
                raise HTTPException(404, detail={"code": "music.notFound"})
            return run
        except GenerationRunError as exc:
            raise HTTPException(exc.status_code, detail={"code": "music.notFound"}) from exc

    def checked_provider(provider_id):
        try:
            return music_provider(provider_lookup(provider_id))
        except HTTPException as exc:
            raise HTTPException(400, detail={"code": "music.noProvider"}) from exc
        except MusicProviderError as exc:
            raise HTTPException(exc.status, detail={"code": exc.code}) from exc

    async def start(operation, provider_id, body, key, metadata=None):
        user = owner()
        checked_provider(provider_id)
        meta = {"surface": "suno", "operation": operation, "params": body, **(metadata or {})}
        try:
            run = await runs().start(WorkflowRun("suno-" + operation,
                {"operation": operation, "body": body, **({"references": meta["references"]} if operation in {"inspo", "cover"} else {})}, provider_id=provider_id),
                key="suno:" + key, owner=user, delivery=Background(), public_metadata=meta)
            await runs().wait_for_lifecycle_projection(through_current=True)
            return music_run_public(run)
        except GenerationRunError as exc:
            raise HTTPException(exc.status_code, detail={"code": "music.conflict"}) from exc

    @router.get("/config")
    def config():
        owner()
        configured = []
        for provider in providers():
            try:
                music_provider(provider)
            except MusicProviderError:
                continue
            configured.append({"id": provider["id"], "name": provider.get("name") or provider["id"]})
        return {"providers": configured, "versions": list(SUNO_VERSIONS), "formats": list(FORMATS), "reference_max_bytes": REFERENCE_MAX_BYTES}

    @router.post("/generations", status_code=202)
    async def generate(payload: MusicSubmission):
        return await start("generate", payload.provider_id, payload.settings.upstream(), payload.operation_id)

    async def submit_reference(request: Request, contract, operation):
        owner()  # Authenticate before reading multipart bodies or importing files.
        if import_reference is None:
            raise HTTPException(503, detail={"code": "music.referenceMissing"})
        async with request.form(max_files=4, max_fields=1, max_part_size=64000) as form:
            try:
                payload = contract.model_validate_json(form.get("payload", ""))
            except (ValidationError, TypeError) as exc:
                raise HTTPException(422, detail={"code": "music.invalidSettings"}) from exc
            checked_provider(payload.provider_id)
            files = form.getlist("files")
            expected = [ref.file_index for ref in payload.references if ref.file_index is not None]
            if sorted(expected) != list(range(len(files))) or any(not hasattr(file, "read") for file in files):
                raise HTTPException(422, detail={"code": "music.invalidReference"})
            references = []
            # Resolve every reused reference through its owned Run. URLs and local paths
            # are never accepted from the caller, so this cannot become a file proxy.
            for ref in payload.references:
                if ref.file_index is None:
                    source = await owned(ref.run_id)
                    saved = source.public_metadata.get("references", [])
                    if ref.index >= len(saved):
                        raise HTTPException(404, detail={"code": "music.referenceMissing"})
                    references.append(saved[ref.index])
                else:
                    file = files[ref.file_index]
                    name = Path(file.filename or "").name[:255]
                    suffix = Path(name).suffix.lower()
                    if suffix not in REFERENCE_EXTENSIONS:
                        raise HTTPException(422, detail={"code": "music.referenceType"})
                    # UploadFile is spooled by Starlette; the bounded read prevents large
                    # in-memory copies even when a client supplies a false MIME type.
                    content = await file.read(REFERENCE_MAX_BYTES + 1)
                    if len(content) > REFERENCE_MAX_BYTES:
                        raise HTTPException(413, detail={"code": "music.referenceSize"})
                    if not content or not plausible_audio(content, suffix):
                        raise HTTPException(422, detail={"code": "music.referenceType"})
                    try:
                        imported = await run_in_threadpool(import_reference, content, name=name)
                    except (OSError, ValueError) as exc:
                        raise HTTPException(500, detail={"code": "music.referenceSaveFailed"}) from exc
                    references.append({"url": imported["url"], "name": name, "size": len(content)})
            metadata = {"references": references}
            if operation == "cover":
                duration = await run_in_threadpool(probe_reference, references[0]["url"])
                if duration is None or not math.isfinite(duration) or duration <= 0:
                    raise HTTPException(422, detail={"code": "music.referenceDurationUnknown"})
                if duration >= 480:
                    raise HTTPException(422, detail={"code": "music.coverReferenceTooLong"})
                references[0] = {**references[0], "duration": duration}
                # Keep the original description and style separately for exact reuse.
                metadata["params"] = payload.settings.model_dump(exclude_none=True)
            return await start(operation, payload.provider_id, payload.settings.upstream(),
                               payload.operation_id, metadata)

    @router.post("/inspirations", status_code=202)
    async def inspiration(request: Request):
        return await submit_reference(request, MusicInspirationSubmission, "inspo")

    @router.post("/covers", status_code=202)
    async def cover(request: Request):
        return await submit_reference(request, MusicCoverSubmission, "cover")

    @router.get("/runs/{run_id}/references/{index}")
    async def reference_audio(run_id: str, index: int, request: Request):
        run = await owned(run_id)
        references = run.public_metadata.get("references", [])
        if index < 0 or index >= len(references):
            raise HTTPException(404, detail={"code": "music.referenceMissing"})
        reference = references[index]
        return await run_in_threadpool(download_file, request, reference["url"], name=reference["name"], inline=True)

    @router.post("/uploads", status_code=202)
    async def upload(payload: MusicUpload):
        return await start("upload", payload.provider_id, {"audioFilePath": payload.audio_url}, payload.operation_id)

    @router.get("/history")
    async def history(limit: int = 30, cursor: str = ""):
        try:
            page = await runs().list_owned(owner=owner(), surface="suno", limit=max(1, min(limit, 100)), cursor=cursor)
        except ValueError as exc:
            raise HTTPException(400, detail={"code": "music.invalidCursor"}) from exc
        return {"items": [music_run_public(run) for run in page[0]], "next_cursor": page[1]}

    @router.get("/runs/{run_id}")
    async def detail(run_id: str):
        return music_run_public(await owned(run_id))

    @router.post("/runs/{run_id}/resume")
    async def resume(run_id: str):
        run = await owned(run_id)
        if not music_run_public(run)["recoverable"]:
            raise HTTPException(409, detail={"code": "music.cannotResume"})
        try:
            result = await runs().resume(run_id, owner=owner(), delivery=Background())
            return music_run_public(result)
        except GenerationRunError as exc:
            raise HTTPException(exc.status_code, detail={"code": "music.cannotResume"}) from exc

    @router.post("/runs/{run_id}/downloads", status_code=202)
    async def export(run_id: str, payload: MusicDownload):
        run = await owned(run_id)
        if run.status != "succeeded" or run.public_metadata.get("operation") == "download":
            raise HTTPException(409, detail={"code": "music.notReady"})
        items = (run.result or {}).get("items", [])
        if not any(item.get("audio_index") == payload.audio_index and item.get("audio_id") for item in items):
            raise HTTPException(400, detail={"code": "music.invalidAudio"})
        task_id = (run.result or {}).get("task_id")
        if not task_id:
            raise HTTPException(409, detail={"code": "music.notReady"})
        formats = sorted(set(payload.formats))
        # Stable receipt survives reload/restart and makes repeated clicks free.
        return await start("download", run.provider_id,
            {"model": "suno", "task_id": task_id, "audio_index": payload.audio_index, "formats": formats},
            "download:" + run_id + ":" + str(payload.audio_index) + ":" + ",".join(formats),
            {"source_run_id": run_id, "audio_index": payload.audio_index})

    @router.get("/runs/{run_id}/audio/{item_index}")
    async def audio(run_id: str, item_index: int, request: Request, download: bool = False):
        run = await owned(run_id)
        items = (run.result or {}).get("items", []) if run.status == "succeeded" else []
        if item_index < 0 or item_index >= len(items) or not items[item_index].get("url"):
            raise HTTPException(404, detail={"code": "music.notReady"})
        item = items[item_index]
        name = str(item.get("title") or "Suno")[:80] + "." + str(item.get("format") or "mp3")
        return await run_in_threadpool(download_file, request, item["url"], name=name, inline=not download)

    return router
