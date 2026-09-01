"""Encrypted transfer packages for non-CLI generation providers."""

from __future__ import annotations

import base64
import json
import os
import re
import uuid
from dataclasses import dataclass
from typing import (
    Any,
    Callable,
    Dict,
    Iterable,
    List,
    MutableMapping,
    Optional,
    Sequence,
)

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt


PACKAGE_FORMAT = "infinite-canvas-api-settings"
PACKAGE_VERSION = 1
PACKAGE_AAD = b"infinite-canvas-api-settings:v1"
MAX_PACKAGE_BYTES = 16 * 1024 * 1024
CLI_PROTOCOLS = frozenset({"jimeng", "codex", "gemini-cli"})
SCRYPT_N = 1 << 15
SCRYPT_R = 8
SCRYPT_P = 1


class ApiSettingsTransferError(ValueError):
    """Raised when an encrypted settings package cannot be used safely."""


@dataclass(frozen=True)
class _FileSnapshot:
    content: Optional[bytes]
    mode: Optional[int]


@dataclass(frozen=True)
class _ApiSettingsStorageAdapter:
    """Internal seam between the transfer module and local settings storage."""

    mutation_lock: Any
    load_providers: Callable[[], List[Dict[str, Any]]]
    available_models: Callable[
        [List[Dict[str, Any]]], Dict[str, List[Dict[str, Any]]]
    ]
    load_runninghub_workflows: Callable[[], Dict[str, Any]]
    provider_api_key: Callable[[str], str]
    runninghub_wallet_key: Callable[[], str]
    volcengine_access_key: Callable[[], str]
    volcengine_secret_key: Callable[[], str]
    current_app_version: Callable[[], str]
    now_ms: Callable[[], int]
    normalize_provider: Optional[
        Callable[[Dict[str, Any]], Dict[str, Any]]
    ] = None
    save_providers: Optional[
        Callable[[List[Dict[str, Any]]], None]
    ] = None
    load_model_order: Optional[
        Callable[[], Dict[str, List[str]]]
    ] = None
    save_model_order: Optional[
        Callable[[Dict[str, List[str]]], Any]
    ] = None
    save_runninghub_workflows: Optional[
        Callable[[Dict[str, Any]], None]
    ] = None
    update_env_values: Optional[Callable[[Dict[str, str]], None]] = None
    reload_env_globals: Optional[Callable[[], None]] = None
    public_providers: Optional[Callable[[], List[Dict[str, Any]]]] = None
    transaction_paths: Optional[Callable[[], Sequence[str]]] = None
    environment: Optional[MutableMapping[str, str]] = None


class ApiSettingsPackage:
    """Deep interface for the two complete settings-package actions."""

    def __init__(self, adapter: _ApiSettingsStorageAdapter):
        self._adapter = adapter

    def export_encrypted(self, password: str) -> bytes:
        return _export_package(self._adapter, password)

    def import_encrypted(
        self,
        package: bytes,
        password: str,
    ) -> Dict[str, Any]:
        return _import_package(
            self._adapter,
            package,
            password,
        )


def _exportable_provider(provider: Dict[str, Any]) -> bool:
    protocol = str((provider or {}).get("protocol") or "").strip().lower()
    provider_id = str((provider or {}).get("id") or "").strip().lower()
    return bool(provider_id) and protocol not in CLI_PROTOCOLS


def _exportable_providers(
    providers: Iterable[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    return [
        dict(provider)
        for provider in providers or []
        if isinstance(provider, dict) and _exportable_provider(provider)
    ]


def _model_order_for_export(
    adapter: _ApiSettingsStorageAdapter,
    providers: List[Dict[str, Any]],
) -> Dict[str, List[Dict[str, str]]]:
    provider_ids = {
        str(provider.get("id") or "")
        for provider in providers
        if provider.get("id")
    }
    inventory = adapter.available_models(providers)
    result = {}
    for kind, entries in inventory.items():
        result[kind] = [
            {
                "provider_id": entry["provider_id"],
                "model": entry["model"],
            }
            for entry in entries
            if entry.get("provider_id") in provider_ids
        ]
    return result


def _secrets_for_export(
    adapter: _ApiSettingsStorageAdapter,
    providers: List[Dict[str, Any]],
) -> Dict[str, Dict[str, str]]:
    secrets = {}
    for provider in providers:
        provider_id = str(provider.get("id") or "").strip().lower()
        if not provider_id:
            continue
        item = {}
        api_key = adapter.provider_api_key(provider_id)
        if api_key:
            item["api_key"] = api_key
        if provider_id == "runninghub":
            wallet_key = adapter.runninghub_wallet_key()
            if wallet_key:
                item["wallet_api_key"] = wallet_key
        if provider_id == "volcengine":
            access_key = adapter.volcengine_access_key()
            secret_key = adapter.volcengine_secret_key()
            if access_key:
                item["access_key_id"] = access_key
            if secret_key:
                item["secret_access_key"] = secret_key
        if item:
            secrets[provider_id] = item
    return secrets


def _export_package(
    adapter: _ApiSettingsStorageAdapter,
    password: str,
) -> bytes:
    """Collect and encrypt one complete, internally consistent settings package."""

    with adapter.mutation_lock:
        providers = _exportable_providers(adapter.load_providers())
        provider_ids = {provider["id"] for provider in providers}
        payload = {
            "schema": "infinite-canvas.api-settings",
            "version": 1,
            "app_version": adapter.current_app_version(),
            "exported_at": adapter.now_ms(),
            "providers": providers,
            "model_order": _model_order_for_export(adapter, providers),
            "runninghub_workflows": (
                adapter.load_runninghub_workflows()
                if "runninghub" in provider_ids
                else {}
            ),
            "secrets": _secrets_for_export(adapter, providers),
        }
    return _encrypt_payload(payload, password)


def _required_adapter_dependency(
    value: Optional[Callable[..., Any]],
    name: str,
) -> Callable[..., Any]:
    if value is None:
        raise RuntimeError(f"API settings adapter is missing {name}")
    return value


def _normalize_imported_settings(
    adapter: _ApiSettingsStorageAdapter,
    payload: Dict[str, Any],
) -> List[Dict[str, Any]]:
    try:
        supported_version = int((payload or {}).get("version") or 0) == 1
    except (AttributeError, TypeError, ValueError):
        supported_version = False
    if (
        not isinstance(payload, dict)
        or payload.get("schema") != "infinite-canvas.api-settings"
        or not supported_version
    ):
        raise ApiSettingsTransferError("不支持的 API 设置内容版本")
    raw_providers = payload.get("providers") or []
    if not isinstance(raw_providers, list) or len(raw_providers) > 100:
        raise ApiSettingsTransferError("API 平台列表格式不正确")
    normalize_provider = _required_adapter_dependency(
        adapter.normalize_provider,
        "normalize_provider",
    )
    providers = []
    seen = set()
    for raw in raw_providers:
        if not isinstance(raw, dict) or not _exportable_provider(raw):
            continue
        provider = normalize_provider(raw)
        if not _exportable_provider(provider):
            continue
        if provider["id"] in seen:
            raise ApiSettingsTransferError(
                f"API 设置包内平台 ID 重复：{provider['id']}"
            )
        seen.add(provider["id"])
        providers.append(provider)
    if not providers:
        raise ApiSettingsTransferError(
            "API 设置包中没有可导入的非 CLI 平台"
        )
    return providers


def _merge_imported_providers(
    current: List[Dict[str, Any]],
    imported: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    current = [dict(item) for item in current]
    imported = [dict(item) for item in imported]
    cli_primary_exists = any(
        item.get("primary") and not _exportable_provider(item)
        for item in current
    )
    if cli_primary_exists:
        for item in imported:
            item["primary"] = False
    imported_by_id = {item["id"]: item for item in imported}
    merged = [
        (
            item
            if not _exportable_provider(item)
            else imported_by_id.get(str(item.get("id") or ""), item)
        )
        for item in current
    ]
    existing_ids = {
        str(item.get("id") or "")
        for item in current
        if isinstance(item, dict)
    }
    merged.extend(
        item for item in imported if item["id"] not in existing_ids
    )
    imported_primary = next(
        (item["id"] for item in reversed(imported) if item.get("primary")),
        "",
    )
    if imported_primary:
        for item in merged:
            if _exportable_provider(item):
                item["primary"] = item.get("id") == imported_primary
    return merged


def _without_local_cli_collisions(
    current: List[Dict[str, Any]],
    imported: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    protected_ids = {
        str(item.get("id") or "")
        for item in current
        if isinstance(item, dict) and not _exportable_provider(item)
    }
    return [
        item for item in imported if item.get("id") not in protected_ids
    ]


def _provider_key_env(provider_id: str) -> str:
    if provider_id == "comfly":
        return "COMFLY_API_KEY"
    if provider_id == "modelscope":
        return "MODELSCOPE_API_KEY"
    if provider_id == "runninghub":
        return "RUNNINGHUB_API_KEY"
    if provider_id == "volcengine":
        return "ARK_API_KEY"
    normalized = re.sub(r"[^A-Za-z0-9]", "_", provider_id).upper()
    return f"API_PROVIDER_{normalized}_KEY"


def _imported_env_updates(
    providers: List[Dict[str, Any]],
    secrets: object,
) -> Dict[str, str]:
    def imported_secret(value: object, label: str) -> str:
        text = str(value or "").strip()
        if len(text) > 8192 or any(ord(char) < 32 for char in text):
            raise ApiSettingsTransferError(f"{label}格式不正确")
        return text

    provider_ids = {provider["id"] for provider in providers}
    updates = {}
    if not isinstance(secrets, dict):
        return updates
    for provider_id, raw in secrets.items():
        provider_id = str(provider_id or "").strip().lower()
        if provider_id not in provider_ids or not isinstance(raw, dict):
            continue
        api_key = imported_secret(
            raw.get("api_key"),
            f"{provider_id} API Key",
        )
        if api_key:
            updates[_provider_key_env(provider_id)] = api_key
        if provider_id == "runninghub":
            wallet = imported_secret(
                raw.get("wallet_api_key"),
                "RunningHub 钱包 API Key",
            )
            if wallet:
                updates["RUNNINGHUB_WALLET_API_KEY"] = wallet
        if provider_id == "volcengine":
            access_key = imported_secret(
                raw.get("access_key_id"),
                "火山引擎 Access Key",
            )
            secret_key = imported_secret(
                raw.get("secret_access_key"),
                "火山引擎 Secret Key",
            )
            if access_key:
                updates["VOLCENGINE_ACCESS_KEY_ID"] = access_key
            if secret_key:
                updates["VOLCENGINE_SECRET_ACCESS_KEY"] = secret_key
    return updates


def _imported_model_order(
    adapter: _ApiSettingsStorageAdapter,
    payload: Dict[str, Any],
    providers: List[Dict[str, Any]],
) -> Dict[str, List[str]]:
    raw_order = payload.get("model_order") or {}
    imported_ids = {provider["id"] for provider in providers}
    load_model_order = _required_adapter_dependency(
        adapter.load_model_order,
        "load_model_order",
    )
    current_order = load_model_order()
    inventory = adapter.available_models(None)
    lookup = {
        (entry["provider_id"], entry["model"]): entry["id"]
        for entries in inventory.values()
        for entry in entries
    }
    imported_inventory_ids = {
        entry["id"]
        for entries in inventory.values()
        for entry in entries
        if entry["provider_id"] in imported_ids
    }
    result = {}
    for kind in ("image", "video", "text"):
        values = raw_order.get(kind) if isinstance(raw_order, dict) else []
        selected = []
        for value in values if isinstance(values, list) else []:
            if not isinstance(value, dict):
                continue
            key = (
                str(value.get("provider_id") or "").strip(),
                str(value.get("model") or "").strip(),
            )
            model_id = lookup.get(key)
            if (
                key[0] in imported_ids
                and model_id
                and model_id not in selected
            ):
                selected.append(model_id)
        selected.extend(
            model_id
            for model_id in current_order.get(kind, [])
            if model_id not in imported_inventory_ids
            and model_id not in selected
        )
        result[kind] = selected
    return result


def _read_file_snapshot(path: str) -> _FileSnapshot:
    try:
        with open(path, "rb") as source:
            return _FileSnapshot(
                content=source.read(),
                mode=os.stat(path).st_mode & 0o777,
            )
    except FileNotFoundError:
        return _FileSnapshot(content=None, mode=None)


def _write_file_snapshot(path: str, snapshot: _FileSnapshot) -> None:
    if snapshot.content is None:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temporary = (
        f"{path}.api-import-rollback-{uuid.uuid4().hex}.tmp"
    )
    try:
        with open(temporary, "wb") as output:
            output.write(snapshot.content)
            output.flush()
            os.fsync(output.fileno())
        if snapshot.mode is not None:
            try:
                os.chmod(temporary, snapshot.mode)
            except OSError:
                pass
        os.replace(temporary, path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def _import_api_settings_payload(
    adapter: _ApiSettingsStorageAdapter,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    imported = _normalize_imported_settings(adapter, payload)
    current = adapter.load_providers()
    imported = _without_local_cli_collisions(current, imported)
    if not imported:
        raise ApiSettingsTransferError(
            "API 设置包中的平台与本机 CLI 平台 ID 冲突，未导入任何内容"
        )
    current_ids = {
        str(item.get("id") or "")
        for item in current
        if isinstance(item, dict)
    }
    added = [
        {"id": item["id"], "name": item["name"]}
        for item in imported
        if item["id"] not in current_ids
    ]
    updated = [
        {"id": item["id"], "name": item["name"]}
        for item in imported
        if item["id"] in current_ids
    ]
    merged = _merge_imported_providers(current, imported)
    env_updates = _imported_env_updates(
        imported,
        payload.get("secrets"),
    )
    environment = adapter.environment if adapter.environment is not None else os.environ
    env_before = {key: environment.get(key) for key in env_updates}
    transaction_paths = _required_adapter_dependency(
        adapter.transaction_paths,
        "transaction_paths",
    )
    snapshots = {
        path: _read_file_snapshot(path)
        for path in transaction_paths()
    }
    save_providers = _required_adapter_dependency(
        adapter.save_providers,
        "save_providers",
    )
    update_env_values = _required_adapter_dependency(
        adapter.update_env_values,
        "update_env_values",
    )
    reload_env_globals = _required_adapter_dependency(
        adapter.reload_env_globals,
        "reload_env_globals",
    )
    save_workflows = _required_adapter_dependency(
        adapter.save_runninghub_workflows,
        "save_runninghub_workflows",
    )
    save_model_order = _required_adapter_dependency(
        adapter.save_model_order,
        "save_model_order",
    )
    public_providers = _required_adapter_dependency(
        adapter.public_providers,
        "public_providers",
    )
    try:
        save_providers(merged)
        if env_updates:
            update_env_values(env_updates)
            reload_env_globals()
        workflow_store = payload.get("runninghub_workflows")
        if (
            any(item["id"] == "runninghub" for item in imported)
            and isinstance(workflow_store, dict)
        ):
            save_workflows(workflow_store)
        save_model_order(
            _imported_model_order(adapter, payload, imported)
        )
        providers = public_providers()
    except Exception as import_error:
        rollback_errors = []
        for path, snapshot in snapshots.items():
            try:
                _write_file_snapshot(path, snapshot)
            except Exception as exc:
                rollback_errors.append(exc)
        for key, value in env_before.items():
            try:
                if value is None:
                    environment.pop(key, None)
                else:
                    environment[key] = value
            except Exception as exc:
                rollback_errors.append(exc)
        try:
            reload_env_globals()
        except Exception as exc:
            rollback_errors.append(exc)
        if rollback_errors:
            raise RuntimeError(
                "导入 API 设置失败，且无法完整恢复原设置"
            ) from import_error
        raise
    return {
        "imported": [
            {"id": item["id"], "name": item["name"]}
            for item in imported
        ],
        "added": added,
        "updated": updated,
        "providers": providers,
    }


def _import_package(
    adapter: _ApiSettingsStorageAdapter,
    package: bytes,
    password: str,
) -> Dict[str, Any]:
    """Decrypt, validate, merge, and persist one complete settings package."""

    payload = _decrypt_payload(package, password)
    with adapter.mutation_lock:
        return _import_api_settings_payload(adapter, payload)


def _password_bytes(password: str) -> bytes:
    value = str(password or "")
    if len(value) < 8:
        raise ApiSettingsTransferError("加密密码至少需要 8 个字符")
    if len(value) > 256:
        raise ApiSettingsTransferError("加密密码不能超过 256 个字符")
    return value.encode("utf-8")


def _derive_key(password: str, salt: bytes) -> bytes:
    password_bytes = _password_bytes(password)
    try:
        return Scrypt(
            salt=salt,
            length=32,
            n=SCRYPT_N,
            r=SCRYPT_R,
            p=SCRYPT_P,
        ).derive(password_bytes)
    except (ValueError, TypeError) as exc:
        raise ApiSettingsTransferError("当前设备无法完成安全密钥派生") from exc


def _encrypt_payload(
    payload: Dict[str, Any], password: str
) -> bytes:
    if not isinstance(payload, dict):
        raise ApiSettingsTransferError("导出内容格式不正确")
    plaintext = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    salt = os.urandom(16)
    nonce = os.urandom(12)
    key = _derive_key(password, salt)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, PACKAGE_AAD)
    envelope = {
        "format": PACKAGE_FORMAT,
        "version": PACKAGE_VERSION,
        "kdf": {
            "name": "scrypt",
            "n": SCRYPT_N,
            "r": SCRYPT_R,
            "p": SCRYPT_P,
            "salt": base64.b64encode(salt).decode("ascii"),
        },
        "cipher": {
            "name": "AES-256-GCM",
            "nonce": base64.b64encode(nonce).decode("ascii"),
        },
        "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
    }
    encoded = json.dumps(
        envelope,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    if len(encoded) > MAX_PACKAGE_BYTES:
        raise ApiSettingsTransferError("API 设置包过大，无法安全导出")
    return encoded


def _decode_b64(value: object, label: str) -> bytes:
    try:
        return base64.b64decode(str(value or ""), validate=True)
    except (ValueError, TypeError) as exc:
        raise ApiSettingsTransferError(f"{label}格式损坏") from exc


def _supported_integer(value: object, expected: int) -> bool:
    try:
        return int(value or 0) == expected
    except (TypeError, ValueError):
        return False


def _decrypt_payload(
    package: bytes, password: str
) -> Dict[str, Any]:
    if not package or len(package) > MAX_PACKAGE_BYTES:
        raise ApiSettingsTransferError("API 设置包为空或超过大小限制")
    try:
        envelope = json.loads(package.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, TypeError) as exc:
        raise ApiSettingsTransferError("不是有效的 .icapi 加密包") from exc
    if (
        not isinstance(envelope, dict)
        or envelope.get("format") != PACKAGE_FORMAT
        or not _supported_integer(
            envelope.get("version"), PACKAGE_VERSION
        )
    ):
        raise ApiSettingsTransferError("不支持的 API 设置包格式或版本")
    kdf = envelope.get("kdf") or {}
    cipher = envelope.get("cipher") or {}
    if (
        not isinstance(kdf, dict)
        or not isinstance(cipher, dict)
        or kdf.get("name") != "scrypt"
        or not _supported_integer(kdf.get("n"), SCRYPT_N)
        or not _supported_integer(kdf.get("r"), SCRYPT_R)
        or not _supported_integer(kdf.get("p"), SCRYPT_P)
        or cipher.get("name") != "AES-256-GCM"
    ):
        raise ApiSettingsTransferError("API 设置包使用了不支持的加密参数")
    salt = _decode_b64(kdf.get("salt"), "Salt")
    nonce = _decode_b64(cipher.get("nonce"), "Nonce")
    ciphertext = _decode_b64(envelope.get("ciphertext"), "密文")
    if len(salt) != 16 or len(nonce) != 12:
        raise ApiSettingsTransferError("API 设置包加密参数损坏")
    try:
        plaintext = AESGCM(_derive_key(password, salt)).decrypt(
            nonce, ciphertext, PACKAGE_AAD
        )
    except InvalidTag as exc:
        raise ApiSettingsTransferError("密码错误，或 API 设置包已损坏") from exc
    try:
        payload = json.loads(plaintext.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, TypeError) as exc:
        raise ApiSettingsTransferError("API 设置包内容损坏") from exc
    if not isinstance(payload, dict):
        raise ApiSettingsTransferError("API 设置包内容格式不正确")
    return payload


__all__ = [
    "ApiSettingsTransferError",
    "ApiSettingsPackage",
    "MAX_PACKAGE_BYTES",
]
