from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from .core import ProviderInspectorAdapter, ProviderInspectorRegistry


AsyncCall = Callable[..., Awaitable[dict[str, Any]]]


@dataclass(frozen=True)
class InspectorFunctions:
    http_test: AsyncCall
    codex_status: AsyncCall
    codex_models: Callable[..., dict[str, Any]]
    gemini_cli_status: AsyncCall
    gemini_cli_models: Callable[..., dict[str, Any]]
    jimeng_status: AsyncCall
    jimeng_models: AsyncCall
    runninghub_models: AsyncCall
    fetch_models: AsyncCall
    jimeng_image_models: tuple[str, ...]
    jimeng_video_models: tuple[str, ...]
    runninghub_default_base_url: str


class _Inspector:
    def __init__(
        self,
        *,
        status: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]],
        test: Callable[[Any], Awaitable[dict[str, Any]]],
        catalog: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]],
    ):
        self._status = status
        self._test = test
        self._catalog = catalog

    async def status(self, provider):
        return await self._status(provider)

    async def test_connection(self, provider, **request):
        return await self._test(request["payload"])

    async def model_catalog(self, provider, **request):
        return await self._catalog(provider)


@dataclass
class ProviderInspectorRuntime:
    registry: ProviderInspectorRegistry

    def select(self, protocol: str):
        return self.registry.select({"id": protocol, "protocol": protocol})

    async def status(self, protocol: str):
        provider = {"id": protocol, "protocol": protocol}
        return await self.registry.select(provider).status(provider)

    async def test_connection(self, payload: Any):
        protocol = str(
            getattr(payload, "protocol", "") or getattr(payload, "provider_id", "")
        ).strip().lower() or "openai"
        provider = {"id": protocol, "protocol": protocol}
        return await self.registry.select(provider).test_connection(
            provider, payload=payload
        )


def build_inspector_runtime(
    functions: InspectorFunctions,
) -> ProviderInspectorRuntime:
    async def unsupported_status(provider):
        return {"installed": False, "message": f"{provider['id']} 使用远端连接"}

    async def http_catalog(provider):
        return await functions.fetch_models(provider["id"])

    async def codex_test(_payload):
        status = await functions.codex_status()
        result = functions.codex_models(raw={"status": status})
        result.update(
            {
                "ok": bool(status.get("installed")),
                "status": 200 if status.get("installed") else 0,
                "message": status.get("message")
                or (
                    "OpenAI Codex CLI 可用"
                    if status.get("installed")
                    else "未找到 OpenAI Codex CLI"
                ),
            }
        )
        return result

    async def gemini_cli_test(_payload):
        status = await functions.gemini_cli_status()
        result = functions.gemini_cli_models(raw={"status": status})
        result.update(
            {
                "ok": bool(status.get("installed")),
                "status": 200 if status.get("installed") else 0,
                "message": status.get("message")
                or (
                    "Antigravity CLI 可用"
                    if status.get("installed")
                    else "未找到 Antigravity CLI"
                ),
            }
        )
        return result

    async def jimeng_test(_payload):
        status = await functions.jimeng_status()
        models = await functions.jimeng_models()
        models.update({
            "ok": bool(status.get("installed") and status.get("logged_in")),
            "status": 200 if status.get("logged_in") else 0,
            "message": status.get("message") or models.get("message") or "即梦 CLI 已登录",
            "raw": {**(models.get("raw") or {}), "status": status.get("raw")},
        })
        return models

    async def runninghub_test(payload):
        provider = {
            "id": "runninghub",
            "name": "RunningHub",
            "base_url": (
                getattr(payload, "base_url", "")
                or functions.runninghub_default_base_url
            ).strip().rstrip("/"),
            "protocol": "runninghub",
        }
        models = await functions.runninghub_models(provider)
        return {
            "ok": True,
            "status": 200,
            "message": "RunningHub OpenAPI 可用，已拉取官方直连模型注册表。",
            "model_count": models["total"],
            "image_models": models["image_models"],
            "chat_models": models["chat_models"],
            "video_models": models["video_models"],
            "all": models["all"],
            "protocol": "runninghub",
            "raw": models.get("raw"),
        }

    def adapter(protocol, status, test):
        async def catalog(provider):
            return await functions.fetch_models(provider["id"])

        return ProviderInspectorAdapter(
            protocol,
            lambda provider, _request: provider.get("protocol") == protocol,
            _Inspector(status=status, test=test, catalog=catalog),
            priority=100,
        )

    registry = ProviderInspectorRegistry()
    registry.register(
        adapter(
            "codex",
            lambda _provider: functions.codex_status(),
            codex_test,
        )
    )
    registry.register(
        adapter(
            "gemini-cli",
            lambda _provider: functions.gemini_cli_status(),
            gemini_cli_test,
        )
    )
    registry.register(
        adapter(
            "jimeng",
            lambda _provider: functions.jimeng_status(),
            jimeng_test,
        )
    )
    registry.register(
        adapter("runninghub", unsupported_status, runninghub_test)
    )
    registry.register(
        ProviderInspectorAdapter(
            "http",
            lambda _provider, _request: True,
            _Inspector(
                status=unsupported_status,
                test=functions.http_test,
                catalog=http_catalog,
            ),
        )
    )
    return ProviderInspectorRuntime(registry)
