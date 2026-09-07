"""Portable snapshots of configured models' effective capability contracts."""

from .api_settings_transfer import ApiSettingsTransferError
from .model_capability_workbench import CAPABILITY_FIELDS, ModelCapabilityWorkbench


MODEL_OPERATIONS = {
    "image_models": ("image.generate", "image.edit", "image.layer_decomposition"),
    "video_models": ("video.generate",),
    "chat_models": ("text.generate",),
}


def model_identities(providers):
    return {(provider["id"], model, operation)
            for provider in providers
            for field, operations in MODEL_OPERATIONS.items()
            for model in provider.get(field, [])
            for operation in operations}


class ModelSettingsBackup:
    def __init__(self, catalog, workbench, context):
        self.catalog = catalog
        self.workbench = workbench
        self.context = context

    def export(self, providers):
        by_id = {p["id"]: p for p in providers}
        records = []
        for provider_id, model_id, operation in sorted(model_identities(providers)):
            resolved = self.catalog.backup_contract(
                provider_id, model_id, operation,
                context=self.context(by_id[provider_id], model_id),
            )
            records.append({
                "provider_id": provider_id, "model_id": model_id, "operation": operation,
                "capability": {key: value for key, value in resolved.items() if key in CAPABILITY_FIELDS},
            })
        return self.validate(records, providers)

    @staticmethod
    def validate(records, providers):
        expected = model_identities(providers)
        if not isinstance(records, list) or len(records) != len(expected):
            raise ApiSettingsTransferError("api.invalidBackup")
        seen = set()
        validated = []
        for record in records:
            if not isinstance(record, dict):
                raise ApiSettingsTransferError("api.invalidBackup")
            identity = tuple(record.get(key) for key in ("provider_id", "model_id", "operation"))
            if not all(isinstance(value, str) for value in identity) or identity not in expected or identity in seen:
                raise ApiSettingsTransferError("api.invalidBackup")
            seen.add(identity)
            try:
                capability = ModelCapabilityWorkbench.validate_capability(record.get("capability"))
            except (RuntimeError, ValueError, TypeError) as error:
                raise ApiSettingsTransferError("api.invalidBackup") from error
            validated.append({"provider_id": identity[0], "model_id": identity[1],
                              "operation": identity[2], "capability": capability})
        return validated

    def restore(self, records):
        if records:
            self.workbench.publish_manual_capabilities(
                records=records, actor_id="api-settings-backup",
                active_catalog_revision=self.catalog.revision, activate=self.catalog.refresh,
            )

    def refresh(self):
        if not self.catalog.refresh().get("ok"):
            raise ApiSettingsTransferError("api.backupActivationFailed")
