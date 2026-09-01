"""Provider selection and execution.

The package deliberately exposes the registry seam rather than individual
vendor implementations.  HTTP routes and generation orchestration ask the
registry for a capability; adapters keep transport, authentication, polling,
CLI, and result-normalisation details private.
"""

from .core import (
    Capability,
    Completed,
    ExecutionResult,
    Failed,
    Pending,
    ProviderAdapter,
    ProviderCapabilityError,
    ProviderInspector,
    ProviderInspectorAdapter,
    ProviderInspectorRegistry,
    ProviderRegistry,
    Queued,
)

__all__ = [
    "Capability",
    "Completed",
    "ExecutionResult",
    "Failed",
    "Pending",
    "ProviderAdapter",
    "ProviderCapabilityError",
    "ProviderInspector",
    "ProviderInspectorAdapter",
    "ProviderInspectorRegistry",
    "ProviderRegistry",
    "Queued",
]
