"""Typed application-owned ports for provider modules."""
from __future__ import annotations

import functools
import importlib
import inspect
from collections.abc import Mapping
from contextlib import ExitStack, contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class _LivePortValue:
    namespace: Mapping[str, Any]
    name: str

    def resolve(self) -> Any:
        return self.namespace[self.name]


class _LiveNamespace(Mapping[str, Any]):
    """Keep explicit typed fields while resolving their values at call time."""

    def __init__(self, namespace: Mapping[str, Any]) -> None:
        self._namespace = namespace

    def __getitem__(self, name: str) -> _LivePortValue:
        if name not in self._namespace:
            raise KeyError(name)
        return _LivePortValue(self._namespace, name)

    def __iter__(self):
        return iter(self._namespace)

    def __len__(self) -> int:
        return len(self._namespace)


class DynamicPorts:
    """Resolve one explicit port set from the active application binding."""

    def __init__(self, name: str) -> None:
        self._default: Any = None
        self._current: ContextVar[Any] = ContextVar(
            f"infinite_canvas_provider_ports_{name}", default=None
        )

    def configure(self, ports: Any) -> None:
        self._default = ports

    @contextmanager
    def bind(self, ports: Any):
        token = self._current.set(ports)
        try:
            yield
        finally:
            self._current.reset(token)

    def __getattr__(self, name: str) -> Any:
        ports = self._current.get() or self._default
        if ports is None:
            raise RuntimeError("provider ports are not configured")
        value = getattr(ports, name)
        return value.resolve() if isinstance(value, _LivePortValue) else value


@dataclass(frozen=True)
class HttpPorts:
    AI_API_KEY: Any
    AI_BASE_URL: Any
    AI_REQUEST_TIMEOUT: Any
    APIMART_IMAGE_INITIAL_POLL_DELAY: Any
    APIMART_IMAGE_POLL_INTERVAL: Any
    APIMART_IMAGE_TASK_TIMEOUT: Any
    APIMART_UPLOAD_RETRY_ATTEMPTS: Any
    AVATAR_SUPPORTED_PLATFORMS: Any
    AVATAR_TASK_DONE_STATUSES: Any
    AVATAR_TASK_FAIL_STATUSES: Any
    BASE_DIR: Any
    CHAT_MODEL: Any
    CHAT_RATIO_SIZE_OPTIONS: Any
    CanvasVideoRequest: Any
    FIXED_PROTOCOL_PROVIDER_IDS: Any
    GPT_IMAGE2_MAX_EDGE: Any
    GPT_IMAGE2_MAX_PIXELS: Any
    GPT_IMAGE2_MIN_PIXELS: Any
    IMAGE_BASE64_KEY_HINTS: Any
    IMAGE_CONTAINER_KEY_HINTS: Any
    IMAGE_OUTPUT_KEY_HINTS: Any
    IMAGE_POLL_INTERVAL: Any
    IMAGE_TASK_FAILED_STATUSES: Any
    IMAGE_TASK_SUCCESS_STATUSES: Any
    IMAGE_TASK_TIMEOUT: Any
    MODELSCOPE_CHAT_MODELS: Any
    ONLINE_IMAGE_REFERENCE_MAX: Any
    PER_MODEL_PROTOCOL_OPTIONS: Any
    PUBLIC_BASE_URL: Any
    PUBLIC_MEDIA_BASE_URL: Any
    RESPONSES_POLL_INTERVAL: Any
    RESPONSES_POLL_MAX_SECONDS: Any
    RESPONSES_REJECT_STATUSES: Any
    RUNNINGHUB_DEFAULT_APPS: Any
    RUNNINGHUB_DEFAULT_BASE_URL: Any
    RUNNINGHUB_FILE_HOST_REWRITES: Any
    RUNNINGHUB_LLM_BASE_URL: Any
    RUNNINGHUB_LLM_MODELS_URLS: Any
    RUNNINGHUB_MODEL_REGISTRY_URL: Any
    RUNNINGHUB_THUMBNAIL_EXTS: Any
    RUNNINGHUB_WORKFLOW_LOCK: Any
    RunningHubWorkflowConfig: Any
    STATIC_DIR: Any
    STATIC_RUNNINGHUB_API_PROVIDERS_FILE: Any
    STATIC_RUNNINGHUB_DIR: Any
    STATIC_RUNNINGHUB_MODEL_REGISTRY_FILE: Any
    STATIC_RUNNINGHUB_THUMBNAIL_DIR: Any
    VIDEO_POLL_TIMEOUT: Any
    VIDEO_TASK_FAILURE_STATUSES: Any
    VIDEO_TASK_SUCCESS_STATUSES: Any
    VIDEO_URL_KEYS: Any
    VOLCENGINE_ARK_ASSET_HOST: Any
    VOLCENGINE_ARK_ASSET_REGION: Any
    VOLCENGINE_ARK_ASSET_SERVICE: Any
    VOLCENGINE_ARK_ASSET_VERSION: Any
    VOLCENGINE_MAX_EDGE: Any
    VOLCENGINE_MIN_EDGE: Any
    VOLCENGINE_MIN_PIXELS: Any
    VOLCENGINE_RATIO_CHOICES: Any
    bearer_auth_value: Any
    content_type_for_path: Any
    generation_output_directory: Any
    get_api_provider: Any
    load_api_providers: Any
    locked_recommended_provider_rule: Any
    model_list_from_values: Any
    modelscope_api_key: Any
    modelscope_api_root: Any
    normalize_image_request_mode: Any
    normalize_provider: Any
    now_ms: Any
    output_file_from_url: Any
    output_path_for: Any
    output_url_for: Any
    provider_endpoint_url: Any
    provider_env_key_value: Any
    read_api_env_value: Any
    reference_to_data_url: Any
    save_api_providers: Any
    volcengine_access_key_value: Any
    volcengine_secret_key_value: Any

@dataclass(frozen=True)
class CliPorts:
    BASE_DIR: Any
    CHAT_RATIO_SIZE_OPTIONS: Any
    CODEX_DEFAULT_CHAT_MODELS: Any
    CODEX_DEFAULT_IMAGE_MODELS: Any
    CODEX_DEFAULT_TIMEOUT: Any
    CanvasVideoRequest: Any
    CodexHelpRequest: Any
    GEMINI_CLI_DEFAULT_CHAT_MODELS: Any
    GEMINI_CLI_DEFAULT_IMAGE_MODELS: Any
    GEMINI_CLI_DEFAULT_TIMEOUT: Any
    GPT_IMAGE2_MAX_EDGE: Any
    GPT_IMAGE2_MAX_PIXELS: Any
    GeminiCliHelpRequest: Any
    JIMENG_DEFAULT_IMAGE_MODELS: Any
    JIMENG_DEFAULT_POLL_SECONDS: Any
    JIMENG_DEFAULT_VIDEO_MODELS: Any
    JIMENG_IMAGE2IMAGE_MODELS: Any
    JIMENG_LOGIN_SESSION: Any
    JIMENG_MIN_CLI_VERSION: Any
    JIMENG_RATIO_CHOICES: Any
    JIMENG_TEXT2IMAGE_MODELS: Any
    JIMENG_VIDEO_1080P_MODELS: Any
    JIMENG_WSL_DETECTION: Any
    JimengHelpRequest: Any
    JimengPendingError: Any
    JimengQueryMediaRequest: Any
    MAX_HISTORY_MESSAGES: Any
    ONLINE_IMAGE_REFERENCE_MAX: Any
    content_type_for_path: Any
    generation_output_directory: Any
    model_list_from_values: Any
    output_file_from_url: Any
    output_path_for: Any
    output_url_for: Any
    read_api_env_value: Any

@dataclass(frozen=True)
class RunningHubPorts:
    ONLINE_IMAGE_REFERENCE_MAX: Any
    RUNNINGHUB_DEFAULT_BASE_URL: Any
    RUNNINGHUB_DEFAULT_IMAGE_MODELS: Any
    RUNNINGHUB_DEFAULT_VIDEO_MODELS: Any
    RUNNINGHUB_ENTRY_MODEL_RE: Any
    RUNNINGHUB_FALLBACK_CHAT_MODELS: Any
    RUNNINGHUB_MODEL_ENDPOINT_ALIASES: Any
    RUNNINGHUB_WORKFLOW_LOCK: Any
    RunningHubSubmitRequest: Any
    RunningHubUploadAssetRequest: Any
    RunningHubWorkflowSubmitRequest: Any
    SEED_UINT32_MAX: Any
    VIDEO_POLL_TIMEOUT: Any
    api_providers_file: Any
    bearer_auth_value: Any
    content_type_for_path: Any
    generation_input_directory: Any
    generation_output_directory: Any
    get_api_provider_exact: Any
    load_api_providers: Any
    output_file_from_url: Any
    output_path_for: Any
    output_url_for: Any
    provider_env_key_value: Any
    runninghub_wallet_key_value: Any
    runninghub_workflow_file: Any

@dataclass(frozen=True)
class ModelScopePorts:
    AI_REQUEST_TIMEOUT: Any
    CloudGenRequest: Any
    CloudPollRequest: Any
    IMAGE_POLL_INTERVAL: Any
    MsGenerateRequest: Any
    ONLINE_IMAGE_REFERENCE_MAX: Any
    modelscope_api_key: Any
    modelscope_image_api_root: Any
    output_path_for: Any
    output_url_for: Any
    reference_to_data_url: Any
    progress_manager: Any = None

@dataclass(frozen=True)
class ComfyUiPorts:
    Base64UploadRequest: Any
    BACKEND_LOCAL_LOAD: Any
    CLIENT_ID: Any
    COMFYUI_ADDRESS: Any
    COMFYUI_INSTANCES: Any
    COMFYUI_DOWNLOAD_TIMEOUT: Any
    COMFYUI_HISTORY_TIMEOUT: Any
    COMFY_DEBUG_TEXT_CLASS_HINTS: Any
    COMFY_PREVIEW_CLASS_HINTS: Any
    CUSTOM_WORKFLOW_FOLDER: Any
    ComfyInstancesPayload: Any
    GenerateRequest: Any
    HIDDEN_BUILTIN_WORKFLOWS: Any
    LOAD_LOCK: Any
    MEDIA_INPUT_EXT_RE: Any
    MEDIA_INPUT_KEYS: Any
    QUEUE: Any
    QUEUE_LOCK: Any
    RESOURCE_WORKFLOW_DIR: Any
    WORKFLOW_NAME_RE: Any
    WorkflowConfig: Any
    WorkflowRunRequest: Any
    WorkflowUploadRequest: Any
    WorkspaceStorageError: Any
    _local_upload_kind_ext: Any
    check_images_exist: Any
    convert_output_to_jpg: Any
    current_workspace_content: Any
    output_path_for: Any
    output_url_for: Any
    sanitize_export_filename: Any
    update_env_values: Any
    user_workflow_directory: Any

@dataclass(frozen=True)
class InspectorPorts:
    AGNES_DEFAULT_VIDEO_MODELS: Any
    JIMENG_DEFAULT_IMAGE_MODELS: Any
    JIMENG_DEFAULT_VIDEO_MODELS: Any
    RUNNINGHUB_DEFAULT_BASE_URL: Any
    SUPPORTED_PROVIDER_PROTOCOLS: Any
    TestConnectionPayload: Any
    apply_locked_recommended_model_rules: Any
    bearer_auth_value: Any
    get_api_provider_exact: Any
    normalize_image_request_mode: Any
    provider_env_key_value: Any
    runninghub_wallet_key_env: Any
    volcengine_provider_api_key: Any


@dataclass(frozen=True)
class ProviderPorts:
    http_impl: HttpPorts
    cli_impl: CliPorts
    runninghub_impl: RunningHubPorts
    modelscope_impl: ModelScopePorts
    comfyui_impl: ComfyUiPorts
    inspection_impl: InspectorPorts

    @classmethod
    def from_namespace(cls, namespace: Mapping[str, Any]) -> "ProviderPorts":
        namespace = _LiveNamespace(namespace)
        return cls(
            http_impl=HttpPorts(AI_API_KEY=namespace['AI_API_KEY'], AI_BASE_URL=namespace['AI_BASE_URL'], AI_REQUEST_TIMEOUT=namespace['AI_REQUEST_TIMEOUT'], APIMART_IMAGE_INITIAL_POLL_DELAY=namespace['APIMART_IMAGE_INITIAL_POLL_DELAY'], APIMART_IMAGE_POLL_INTERVAL=namespace['APIMART_IMAGE_POLL_INTERVAL'], APIMART_IMAGE_TASK_TIMEOUT=namespace['APIMART_IMAGE_TASK_TIMEOUT'], APIMART_UPLOAD_RETRY_ATTEMPTS=namespace['APIMART_UPLOAD_RETRY_ATTEMPTS'], AVATAR_SUPPORTED_PLATFORMS=namespace['AVATAR_SUPPORTED_PLATFORMS'], AVATAR_TASK_DONE_STATUSES=namespace['AVATAR_TASK_DONE_STATUSES'], AVATAR_TASK_FAIL_STATUSES=namespace['AVATAR_TASK_FAIL_STATUSES'], BASE_DIR=namespace['BASE_DIR'], CHAT_MODEL=namespace['CHAT_MODEL'], CHAT_RATIO_SIZE_OPTIONS=namespace['CHAT_RATIO_SIZE_OPTIONS'], CanvasVideoRequest=namespace['CanvasVideoRequest'], FIXED_PROTOCOL_PROVIDER_IDS=namespace['FIXED_PROTOCOL_PROVIDER_IDS'], GPT_IMAGE2_MAX_EDGE=namespace['GPT_IMAGE2_MAX_EDGE'], GPT_IMAGE2_MAX_PIXELS=namespace['GPT_IMAGE2_MAX_PIXELS'], GPT_IMAGE2_MIN_PIXELS=namespace['GPT_IMAGE2_MIN_PIXELS'], IMAGE_BASE64_KEY_HINTS=namespace['IMAGE_BASE64_KEY_HINTS'], IMAGE_CONTAINER_KEY_HINTS=namespace['IMAGE_CONTAINER_KEY_HINTS'], IMAGE_OUTPUT_KEY_HINTS=namespace['IMAGE_OUTPUT_KEY_HINTS'], IMAGE_POLL_INTERVAL=namespace['IMAGE_POLL_INTERVAL'], IMAGE_TASK_FAILED_STATUSES=namespace['IMAGE_TASK_FAILED_STATUSES'], IMAGE_TASK_SUCCESS_STATUSES=namespace['IMAGE_TASK_SUCCESS_STATUSES'], IMAGE_TASK_TIMEOUT=namespace['IMAGE_TASK_TIMEOUT'], MODELSCOPE_CHAT_MODELS=namespace['MODELSCOPE_CHAT_MODELS'], ONLINE_IMAGE_REFERENCE_MAX=namespace['ONLINE_IMAGE_REFERENCE_MAX'], PER_MODEL_PROTOCOL_OPTIONS=namespace['PER_MODEL_PROTOCOL_OPTIONS'], PUBLIC_BASE_URL=namespace['PUBLIC_BASE_URL'], PUBLIC_MEDIA_BASE_URL=namespace['PUBLIC_MEDIA_BASE_URL'], RESPONSES_POLL_INTERVAL=namespace['RESPONSES_POLL_INTERVAL'], RESPONSES_POLL_MAX_SECONDS=namespace['RESPONSES_POLL_MAX_SECONDS'], RESPONSES_REJECT_STATUSES=namespace['RESPONSES_REJECT_STATUSES'], RUNNINGHUB_DEFAULT_APPS=namespace['RUNNINGHUB_DEFAULT_APPS'], RUNNINGHUB_DEFAULT_BASE_URL=namespace['RUNNINGHUB_DEFAULT_BASE_URL'], RUNNINGHUB_FILE_HOST_REWRITES=namespace['RUNNINGHUB_FILE_HOST_REWRITES'], RUNNINGHUB_LLM_BASE_URL=namespace['RUNNINGHUB_LLM_BASE_URL'], RUNNINGHUB_LLM_MODELS_URLS=namespace['RUNNINGHUB_LLM_MODELS_URLS'], RUNNINGHUB_MODEL_REGISTRY_URL=namespace['RUNNINGHUB_MODEL_REGISTRY_URL'], RUNNINGHUB_THUMBNAIL_EXTS=namespace['RUNNINGHUB_THUMBNAIL_EXTS'], RUNNINGHUB_WORKFLOW_LOCK=namespace['RUNNINGHUB_WORKFLOW_LOCK'], RunningHubWorkflowConfig=namespace['RunningHubWorkflowConfig'], STATIC_DIR=namespace['STATIC_DIR'], STATIC_RUNNINGHUB_API_PROVIDERS_FILE=namespace['STATIC_RUNNINGHUB_API_PROVIDERS_FILE'], STATIC_RUNNINGHUB_DIR=namespace['STATIC_RUNNINGHUB_DIR'], STATIC_RUNNINGHUB_MODEL_REGISTRY_FILE=namespace['STATIC_RUNNINGHUB_MODEL_REGISTRY_FILE'], STATIC_RUNNINGHUB_THUMBNAIL_DIR=namespace['STATIC_RUNNINGHUB_THUMBNAIL_DIR'], VIDEO_POLL_TIMEOUT=namespace['VIDEO_POLL_TIMEOUT'], VIDEO_TASK_FAILURE_STATUSES=namespace['VIDEO_TASK_FAILURE_STATUSES'], VIDEO_TASK_SUCCESS_STATUSES=namespace['VIDEO_TASK_SUCCESS_STATUSES'], VIDEO_URL_KEYS=namespace['VIDEO_URL_KEYS'], VOLCENGINE_ARK_ASSET_HOST=namespace['VOLCENGINE_ARK_ASSET_HOST'], VOLCENGINE_ARK_ASSET_REGION=namespace['VOLCENGINE_ARK_ASSET_REGION'], VOLCENGINE_ARK_ASSET_SERVICE=namespace['VOLCENGINE_ARK_ASSET_SERVICE'], VOLCENGINE_ARK_ASSET_VERSION=namespace['VOLCENGINE_ARK_ASSET_VERSION'], VOLCENGINE_MAX_EDGE=namespace['VOLCENGINE_MAX_EDGE'], VOLCENGINE_MIN_EDGE=namespace['VOLCENGINE_MIN_EDGE'], VOLCENGINE_MIN_PIXELS=namespace['VOLCENGINE_MIN_PIXELS'], VOLCENGINE_RATIO_CHOICES=namespace['VOLCENGINE_RATIO_CHOICES'], bearer_auth_value=namespace['bearer_auth_value'], content_type_for_path=namespace['content_type_for_path'], generation_output_directory=namespace['generation_output_directory'], get_api_provider=namespace['get_api_provider'], load_api_providers=namespace['load_api_providers'], locked_recommended_provider_rule=namespace['locked_recommended_provider_rule'], model_list_from_values=namespace['model_list_from_values'], modelscope_api_key=namespace['modelscope_api_key'], modelscope_api_root=namespace['modelscope_api_root'], normalize_image_request_mode=namespace['normalize_image_request_mode'], normalize_provider=namespace['normalize_provider'], now_ms=namespace['now_ms'], output_file_from_url=namespace['output_file_from_url'], output_path_for=namespace['output_path_for'], output_url_for=namespace['output_url_for'], provider_endpoint_url=namespace['provider_endpoint_url'], provider_env_key_value=namespace['provider_env_key_value'], read_api_env_value=namespace['read_api_env_value'], reference_to_data_url=namespace['reference_to_data_url'], save_api_providers=namespace['save_api_providers'], volcengine_access_key_value=namespace['volcengine_access_key_value'], volcengine_secret_key_value=namespace['volcengine_secret_key_value']),
            cli_impl=CliPorts(BASE_DIR=namespace['BASE_DIR'], CHAT_RATIO_SIZE_OPTIONS=namespace['CHAT_RATIO_SIZE_OPTIONS'], CODEX_DEFAULT_CHAT_MODELS=namespace['CODEX_DEFAULT_CHAT_MODELS'], CODEX_DEFAULT_IMAGE_MODELS=namespace['CODEX_DEFAULT_IMAGE_MODELS'], CODEX_DEFAULT_TIMEOUT=namespace['CODEX_DEFAULT_TIMEOUT'], CanvasVideoRequest=namespace['CanvasVideoRequest'], CodexHelpRequest=namespace['CodexHelpRequest'], GEMINI_CLI_DEFAULT_CHAT_MODELS=namespace['GEMINI_CLI_DEFAULT_CHAT_MODELS'], GEMINI_CLI_DEFAULT_IMAGE_MODELS=namespace['GEMINI_CLI_DEFAULT_IMAGE_MODELS'], GEMINI_CLI_DEFAULT_TIMEOUT=namespace['GEMINI_CLI_DEFAULT_TIMEOUT'], GPT_IMAGE2_MAX_EDGE=namespace['GPT_IMAGE2_MAX_EDGE'], GPT_IMAGE2_MAX_PIXELS=namespace['GPT_IMAGE2_MAX_PIXELS'], GeminiCliHelpRequest=namespace['GeminiCliHelpRequest'], JIMENG_DEFAULT_IMAGE_MODELS=namespace['JIMENG_DEFAULT_IMAGE_MODELS'], JIMENG_DEFAULT_POLL_SECONDS=namespace['JIMENG_DEFAULT_POLL_SECONDS'], JIMENG_DEFAULT_VIDEO_MODELS=namespace['JIMENG_DEFAULT_VIDEO_MODELS'], JIMENG_IMAGE2IMAGE_MODELS=namespace['JIMENG_IMAGE2IMAGE_MODELS'], JIMENG_LOGIN_SESSION=namespace['JIMENG_LOGIN_SESSION'], JIMENG_MIN_CLI_VERSION=namespace['JIMENG_MIN_CLI_VERSION'], JIMENG_RATIO_CHOICES=namespace['JIMENG_RATIO_CHOICES'], JIMENG_TEXT2IMAGE_MODELS=namespace['JIMENG_TEXT2IMAGE_MODELS'], JIMENG_VIDEO_1080P_MODELS=namespace['JIMENG_VIDEO_1080P_MODELS'], JIMENG_WSL_DETECTION=namespace['JIMENG_WSL_DETECTION'], JimengHelpRequest=namespace['JimengHelpRequest'], JimengPendingError=namespace['JimengPendingError'], JimengQueryMediaRequest=namespace['JimengQueryMediaRequest'], MAX_HISTORY_MESSAGES=namespace['MAX_HISTORY_MESSAGES'], ONLINE_IMAGE_REFERENCE_MAX=namespace['ONLINE_IMAGE_REFERENCE_MAX'], content_type_for_path=namespace['content_type_for_path'], generation_output_directory=namespace['generation_output_directory'], model_list_from_values=namespace['model_list_from_values'], output_file_from_url=namespace['output_file_from_url'], output_path_for=namespace['output_path_for'], output_url_for=namespace['output_url_for'], read_api_env_value=namespace['read_api_env_value']),
            runninghub_impl=RunningHubPorts(ONLINE_IMAGE_REFERENCE_MAX=namespace['ONLINE_IMAGE_REFERENCE_MAX'], RUNNINGHUB_DEFAULT_BASE_URL=namespace['RUNNINGHUB_DEFAULT_BASE_URL'], RUNNINGHUB_DEFAULT_IMAGE_MODELS=namespace['RUNNINGHUB_DEFAULT_IMAGE_MODELS'], RUNNINGHUB_DEFAULT_VIDEO_MODELS=namespace['RUNNINGHUB_DEFAULT_VIDEO_MODELS'], RUNNINGHUB_ENTRY_MODEL_RE=namespace['RUNNINGHUB_ENTRY_MODEL_RE'], RUNNINGHUB_FALLBACK_CHAT_MODELS=namespace['RUNNINGHUB_FALLBACK_CHAT_MODELS'], RUNNINGHUB_MODEL_ENDPOINT_ALIASES=namespace['RUNNINGHUB_MODEL_ENDPOINT_ALIASES'], RUNNINGHUB_WORKFLOW_LOCK=namespace['RUNNINGHUB_WORKFLOW_LOCK'], RunningHubSubmitRequest=namespace['RunningHubSubmitRequest'], RunningHubUploadAssetRequest=namespace['RunningHubUploadAssetRequest'], RunningHubWorkflowSubmitRequest=namespace['RunningHubWorkflowSubmitRequest'], SEED_UINT32_MAX=namespace['SEED_UINT32_MAX'], VIDEO_POLL_TIMEOUT=namespace['VIDEO_POLL_TIMEOUT'], api_providers_file=namespace['api_providers_file'], bearer_auth_value=namespace['bearer_auth_value'], content_type_for_path=namespace['content_type_for_path'], generation_input_directory=namespace['generation_input_directory'], generation_output_directory=namespace['generation_output_directory'], get_api_provider_exact=namespace['get_api_provider_exact'], load_api_providers=namespace['load_api_providers'], output_file_from_url=namespace['output_file_from_url'], output_path_for=namespace['output_path_for'], output_url_for=namespace['output_url_for'], provider_env_key_value=namespace['provider_env_key_value'], runninghub_wallet_key_value=namespace['runninghub_wallet_key_value'], runninghub_workflow_file=namespace['runninghub_workflow_file']),
            modelscope_impl=ModelScopePorts(AI_REQUEST_TIMEOUT=namespace['AI_REQUEST_TIMEOUT'], CloudGenRequest=namespace['CloudGenRequest'], CloudPollRequest=namespace['CloudPollRequest'], IMAGE_POLL_INTERVAL=namespace['IMAGE_POLL_INTERVAL'], MsGenerateRequest=namespace['MsGenerateRequest'], ONLINE_IMAGE_REFERENCE_MAX=namespace['ONLINE_IMAGE_REFERENCE_MAX'], modelscope_api_key=namespace['modelscope_api_key'], modelscope_image_api_root=namespace['modelscope_image_api_root'], output_path_for=namespace['output_path_for'], output_url_for=namespace['output_url_for'], reference_to_data_url=namespace['reference_to_data_url'], progress_manager=namespace['manager']),
            comfyui_impl=ComfyUiPorts(Base64UploadRequest=namespace['Base64UploadRequest'], BACKEND_LOCAL_LOAD=namespace['BACKEND_LOCAL_LOAD'], CLIENT_ID=namespace['CLIENT_ID'], COMFYUI_ADDRESS=namespace['COMFYUI_ADDRESS'], COMFYUI_INSTANCES=namespace['COMFYUI_INSTANCES'], COMFYUI_DOWNLOAD_TIMEOUT=namespace['COMFYUI_DOWNLOAD_TIMEOUT'], COMFYUI_HISTORY_TIMEOUT=namespace['COMFYUI_HISTORY_TIMEOUT'], COMFY_DEBUG_TEXT_CLASS_HINTS=namespace['COMFY_DEBUG_TEXT_CLASS_HINTS'], COMFY_PREVIEW_CLASS_HINTS=namespace['COMFY_PREVIEW_CLASS_HINTS'], CUSTOM_WORKFLOW_FOLDER=namespace['CUSTOM_WORKFLOW_FOLDER'], ComfyInstancesPayload=namespace['ComfyInstancesPayload'], GenerateRequest=namespace['GenerateRequest'], HIDDEN_BUILTIN_WORKFLOWS=namespace['HIDDEN_BUILTIN_WORKFLOWS'], LOAD_LOCK=namespace['LOAD_LOCK'], MEDIA_INPUT_EXT_RE=namespace['MEDIA_INPUT_EXT_RE'], MEDIA_INPUT_KEYS=namespace['MEDIA_INPUT_KEYS'], QUEUE=namespace['QUEUE'], QUEUE_LOCK=namespace['QUEUE_LOCK'], RESOURCE_WORKFLOW_DIR=namespace['RESOURCE_WORKFLOW_DIR'], WORKFLOW_NAME_RE=namespace['WORKFLOW_NAME_RE'], WorkflowConfig=namespace['WorkflowConfig'], WorkflowRunRequest=namespace['WorkflowRunRequest'], WorkflowUploadRequest=namespace['WorkflowUploadRequest'], WorkspaceStorageError=namespace['WorkspaceStorageError'], _local_upload_kind_ext=namespace['_local_upload_kind_ext'], check_images_exist=namespace['check_images_exist'], convert_output_to_jpg=namespace['convert_output_to_jpg'], current_workspace_content=namespace['current_workspace_content'], output_path_for=namespace['output_path_for'], output_url_for=namespace['output_url_for'], sanitize_export_filename=namespace['sanitize_export_filename'], update_env_values=namespace['update_env_values'], user_workflow_directory=namespace['user_workflow_directory']),
            inspection_impl=InspectorPorts(AGNES_DEFAULT_VIDEO_MODELS=namespace['AGNES_DEFAULT_VIDEO_MODELS'], JIMENG_DEFAULT_IMAGE_MODELS=namespace['JIMENG_DEFAULT_IMAGE_MODELS'], JIMENG_DEFAULT_VIDEO_MODELS=namespace['JIMENG_DEFAULT_VIDEO_MODELS'], RUNNINGHUB_DEFAULT_BASE_URL=namespace['RUNNINGHUB_DEFAULT_BASE_URL'], SUPPORTED_PROVIDER_PROTOCOLS=namespace['SUPPORTED_PROVIDER_PROTOCOLS'], TestConnectionPayload=namespace['TestConnectionPayload'], apply_locked_recommended_model_rules=namespace['apply_locked_recommended_model_rules'], bearer_auth_value=namespace['bearer_auth_value'], get_api_provider_exact=namespace['get_api_provider_exact'], normalize_image_request_mode=namespace['normalize_image_request_mode'], provider_env_key_value=namespace['provider_env_key_value'], runninghub_wallet_key_env=namespace['runninghub_wallet_key_env'], volcengine_provider_api_key=namespace['volcengine_provider_api_key']),
        )


def install_provider_ports(ports: ProviderPorts) -> None:
    importlib.import_module('.http_impl', __package__).configure_ports(ports.http_impl)
    importlib.import_module('.cli_impl', __package__).configure_ports(ports.cli_impl)
    importlib.import_module('.runninghub_impl', __package__).configure_ports(ports.runninghub_impl)
    importlib.import_module('.modelscope_impl', __package__).configure_ports(ports.modelscope_impl)
    importlib.import_module('.comfyui_impl', __package__).configure_ports(ports.comfyui_impl)
    importlib.import_module('.inspection_impl', __package__).configure_ports(ports.inspection_impl)


class _BoundProviderImplementation:
    """Per-application facade over shared implementation modules."""

    def __init__(self, implementation: Any, ports: ProviderPorts) -> None:
        self._implementation = implementation
        self._ports = ports
        self._cache: dict[str, Any] = {}

    @contextmanager
    def _scope(self):
        bindings = (
            ("http_impl", self._ports.http_impl),
            ("cli_impl", self._ports.cli_impl),
            ("runninghub_impl", self._ports.runninghub_impl),
            ("modelscope_impl", self._ports.modelscope_impl),
            ("comfyui_impl", self._ports.comfyui_impl),
            ("inspection_impl", self._ports.inspection_impl),
        )
        with ExitStack() as stack:
            for module_name, ports in bindings:
                module = importlib.import_module(f".{module_name}", __package__)
                stack.enter_context(module.bind_ports(ports))
            yield

    def __getattr__(self, name: str) -> Any:
        target = getattr(self._implementation, name)
        if not callable(target):
            return target
        cached = self._cache.get(name)
        if cached is not None:
            return cached

        def call(*args, **kwargs):
            with self._scope():
                result = target(*args, **kwargs)
            if inspect.isawaitable(result):
                async def await_result():
                    with self._scope():
                        return await result

                return await_result()
            if inspect.isasyncgen(result):
                async def iterate_async():
                    with self._scope():
                        async for item in result:
                            yield item

                return iterate_async()
            if inspect.isgenerator(result):
                def iterate():
                    with self._scope():
                        yield from result

                return iterate()
            return result

        signature_target = target
        category_exports = getattr(
            self._implementation, "_CATEGORY_EXPORTS", {}
        )
        module_name = (
            category_exports.get(name)
            if isinstance(category_exports, Mapping)
            else None
        )
        if module_name:
            module = importlib.import_module(
                f".{module_name}", __package__
            )
            concrete_target = getattr(module, name, None)
            if callable(concrete_target):
                signature_target = concrete_target
        functools.update_wrapper(call, signature_target)
        self._cache[name] = call
        return call


def bind_provider_implementation(
    implementation: Any, ports: ProviderPorts
) -> Any:
    return _BoundProviderImplementation(implementation, ports)
