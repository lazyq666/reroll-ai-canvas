from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Literal, Protocol, TypeAlias


class Capability(str, Enum):
    IMAGE = "image"
    IMAGE_RECOVERY = "image_recovery"
    VIDEO = "video"
    TEXT = "text"
    TEXT_STREAM = "text_stream"
    WORKFLOW = "workflow"


class ProviderCapabilityError(LookupError):
    """Raised when no configured adapter can perform a requested capability."""


Matcher = Callable[[dict[str, Any], dict[str, Any]], bool]


@dataclass(frozen=True)
class Completed:
    output: Any
    raw: Any = None
    status: Literal["succeeded"] = "succeeded"


@dataclass(frozen=True)
class Pending:
    remote_ref: str
    raw: Any = None
    status: str = "running"

    def __post_init__(self) -> None:
        if not str(self.remote_ref or "").strip():
            raise ValueError("pending provider result requires a remote_ref")
        if self.status not in {"queued", "pending", "running", "in_progress"}:
            raise ValueError(f"invalid pending provider status: {self.status}")


@dataclass(frozen=True)
class Queued:
    queue_ref: str
    raw: Any = None
    status: str = "queued"

    def __post_init__(self) -> None:
        if not str(self.queue_ref or "").strip():
            raise ValueError("queued provider result requires a queue_ref")
        if self.status not in {"queued", "jimeng_pending"}:
            raise ValueError(f"invalid queued provider status: {self.status}")


@dataclass(frozen=True)
class Failed:
    error: str
    raw: Any = None
    status: Literal["failed", "cancelled"] = "failed"

    def __post_init__(self) -> None:
        if not str(self.error or "").strip():
            raise ValueError("failed provider result requires an error")


ExecutionResult: TypeAlias = Completed | Pending | Queued | Failed
Executor = Callable[..., Awaitable[ExecutionResult]]


@dataclass(frozen=True)
class ProviderAdapter:
    """A capability-shaped adapter.

    Adapters only publish capabilities they genuinely implement.  In
    particular, there is no synthetic submit/poll/cancel/fetch lifecycle:
    adapters may complete inline, return an existing pending payload, or hide
    a real remote lifecycle inside their implementation.
    """

    name: str
    matches: Matcher
    capabilities: dict[Capability, Executor]
    priority: int = 0
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def supports(self, capability: Capability) -> bool:
        return capability in self.capabilities

    async def execute(
        self, capability: Capability, /, **request: Any
    ) -> ExecutionResult:
        try:
            executor = self.capabilities[capability]
        except KeyError as exc:
            raise ProviderCapabilityError(
                f"{self.name} does not support {capability.value}"
            ) from exc
        return await executor(**request)


@dataclass
class ProviderRegistry:
    """Select one adapter from provider configuration and requested capability."""

    _adapters: list[ProviderAdapter] = field(default_factory=list)

    def register(self, adapter: ProviderAdapter) -> None:
        self._adapters.append(adapter)
        self._adapters.sort(key=lambda item: item.priority, reverse=True)

    def extend(self, adapters: Iterable[ProviderAdapter]) -> None:
        for adapter in adapters:
            self.register(adapter)

    def select(
        self,
        provider: dict[str, Any],
        capability: Capability,
        request: dict[str, Any] | None = None,
    ) -> ProviderAdapter:
        request = request or {}
        for adapter in self._adapters:
            if adapter.supports(capability) and adapter.matches(provider, request):
                return adapter
        provider_name = (
            str(provider.get("name") or provider.get("id") or "").strip()
            or "(unknown)"
        )
        raise ProviderCapabilityError(
            f"{provider_name} does not support {capability.value}"
        )

    async def execute(
        self,
        provider: dict[str, Any],
        capability: Capability,
        /,
        **request: Any,
    ) -> ExecutionResult:
        return await self.select(provider, capability, request).execute(
            capability, provider=provider, **request
        )


class ProviderInspector(Protocol):
    """One settings-page implementation, separate from generation."""

    async def status(self, provider: dict[str, Any]) -> dict[str, Any]: ...

    async def test_connection(
        self, provider: dict[str, Any], **request: Any
    ) -> dict[str, Any]: ...

    async def model_catalog(
        self, provider: dict[str, Any], **request: Any
    ) -> dict[str, Any]: ...


@dataclass(frozen=True)
class ProviderInspectorAdapter:
    name: str
    matches: Matcher
    inspector: ProviderInspector
    priority: int = 0


@dataclass
class ProviderInspectorRegistry:
    """Own selection for status, connection tests, and model discovery."""

    _adapters: list[ProviderInspectorAdapter] = field(default_factory=list)

    def register(self, adapter: ProviderInspectorAdapter) -> None:
        self._adapters.append(adapter)
        self._adapters.sort(key=lambda item: item.priority, reverse=True)

    def select(self, provider: dict[str, Any]) -> ProviderInspector:
        for adapter in self._adapters:
            if adapter.matches(provider, {}):
                return adapter.inspector
        provider_name = (
            str(provider.get("name") or provider.get("id") or "").strip()
            or "(unknown)"
        )
        raise ProviderCapabilityError(
            f"{provider_name} does not support provider inspection"
        )
