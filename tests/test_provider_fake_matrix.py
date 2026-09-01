import asyncio
import unittest

from infinite_canvas.providers import (
    Capability,
    Completed,
    Failed,
    Pending,
    ProviderCapabilityError,
)
from infinite_canvas.providers.runtime import (
    ImageExecutors,
    ProviderRuntime,
    RecoveryExecutors,
    WorkflowExecutors,
    build_image_registry,
    build_recovery_registry,
    build_workflow_registry,
)


PROVIDERS = {
    "comfyui": {"id": "comfyui", "protocol": "comfyui"},
    "cli": {"id": "cli", "protocol": "codex"},
    "modelscope": {"id": "modelscope", "protocol": "modelscope"},
    "async-http": {"id": "async-http", "protocol": "openai"},
    "runninghub": {"id": "runninghub", "protocol": "runninghub"},
}


class ProviderFakeContractMatrixTests(unittest.TestCase):
    def test_provider_contract_matrix(self):
        cases = [
            ("comfyui", "success", "workflow", "comfyui", Completed),
            ("comfyui", "failure", "workflow", "comfyui", Failed),
            ("comfyui", "timeout", "workflow", "comfyui", Pending),
            (
                "comfyui",
                "recovery",
                "unsupported-recovery",
                "",
                ProviderCapabilityError,
            ),
            (
                "comfyui",
                "unsupported",
                "unsupported-capability",
                "",
                ProviderCapabilityError,
            ),
            ("cli", "success", "image", "codex", Completed),
            ("cli", "failure", "image", "codex", RuntimeError),
            ("cli", "timeout", "image", "codex", asyncio.TimeoutError),
            (
                "cli",
                "recovery",
                "unsupported-recovery",
                "",
                ProviderCapabilityError,
            ),
            (
                "cli",
                "unsupported",
                "unsupported-capability",
                "",
                ProviderCapabilityError,
            ),
            (
                "modelscope",
                "success",
                "workflow",
                "modelscope",
                Completed,
            ),
            (
                "modelscope",
                "failure",
                "workflow",
                "modelscope",
                Failed,
            ),
            (
                "modelscope",
                "timeout",
                "workflow",
                "modelscope",
                Pending,
            ),
            (
                "modelscope",
                "recovery",
                "workflow",
                "modelscope-angle-recovery",
                Completed,
            ),
            (
                "modelscope",
                "unsupported-recovery",
                "unsupported-recovery",
                "",
                ProviderCapabilityError,
            ),
            (
                "modelscope",
                "unsupported",
                "unsupported-capability",
                "",
                ProviderCapabilityError,
            ),
            ("async-http", "success", "image", "http", Completed),
            ("async-http", "failure", "image", "http", RuntimeError),
            (
                "async-http",
                "timeout",
                "image",
                "http",
                asyncio.TimeoutError,
            ),
            (
                "async-http",
                "recovery",
                "recovery",
                "http",
                Completed,
            ),
            (
                "async-http",
                "unsupported",
                "unsupported-capability",
                "",
                ProviderCapabilityError,
            ),
            (
                "runninghub",
                "success",
                "workflow",
                "runninghub-query",
                Completed,
            ),
            (
                "runninghub",
                "failure",
                "workflow",
                "runninghub-query",
                Failed,
            ),
            (
                "runninghub",
                "timeout",
                "workflow",
                "runninghub-query",
                Pending,
            ),
            (
                "runninghub",
                "recovery",
                "recovery",
                "runninghub",
                Completed,
            ),
            (
                "runninghub",
                "unsupported",
                "unsupported-capability",
                "",
                ProviderCapabilityError,
            ),
        ]

        for category, scenario, path, operation, expected in cases:
            with self.subTest(
                provider=category, scenario=scenario, path=path
            ):
                calls = []
                provider = PROVIDERS[category]

                async def image_executor(name, *_args, **_kwargs):
                    calls.append(name)
                    if scenario == "failure":
                        raise RuntimeError(f"{name} failed")
                    if scenario == "timeout":
                        raise asyncio.TimeoutError(f"{name} timed out")
                    return {"url": f"https://fake/{name}.png"}

                def image(name):
                    async def execute(*args, **kwargs):
                        return await image_executor(
                            name, *args, **kwargs
                        )

                    return execute

                image_registry = build_image_registry(
                    ImageExecutors(
                        http=image("http"),
                        modelscope=image("modelscope"),
                        codex=image("codex"),
                        gemini_cli=image("gemini-cli"),
                        jimeng=image("jimeng"),
                        runninghub=image("runninghub"),
                        gemini_native=image("gemini-native"),
                        volcengine=image("volcengine"),
                    )
                )

                def workflow(name):
                    async def execute(_payload):
                        calls.append(name)
                        if scenario == "failure":
                            return {
                                "status": "failed",
                                "task_id": f"{name}-task",
                                "error": f"{name} failed",
                            }
                        if scenario == "timeout":
                            return {
                                "status": "timeout",
                                "task_id": f"{name}-task",
                            }
                        return {
                            "status": "succeeded",
                            "task_id": f"{name}-task",
                        }

                    return execute

                workflow_registry = build_workflow_registry(
                    WorkflowExecutors(
                        comfyui=workflow("comfyui"),
                        modelscope=workflow("modelscope"),
                        modelscope_cloud=workflow("modelscope-cloud"),
                        modelscope_angle=workflow("modelscope-angle"),
                        modelscope_angle_recovery=workflow(
                            "modelscope-angle-recovery"
                        ),
                        runninghub_submit=workflow("runninghub-submit"),
                        runninghub_query=workflow("runninghub-query"),
                        runninghub_app_submit=workflow(
                            "runninghub-app-submit"
                        ),
                        runninghub_upload_asset=workflow(
                            "runninghub-upload-asset"
                        ),
                    )
                )

                def recovery(name):
                    async def execute(_provider, task_id):
                        calls.append(name)
                        return {
                            "status": "succeeded",
                            "task_id": task_id,
                        }

                    return execute

                recovery_registry = build_recovery_registry(
                    RecoveryExecutors(
                        http=recovery("http"),
                        runninghub=recovery("runninghub"),
                    )
                )
                runtime = ProviderRuntime(
                    provider_lookup=lambda _provider_id: provider,
                    image_registry=image_registry,
                    recovery_registry=recovery_registry,
                    workflow_registry=workflow_registry,
                )

                async def execute_case():
                    if path == "image":
                        return await runtime.execute_image(
                            "prompt",
                            "1024x1024",
                            "",
                            "fake-model",
                            provider_id=category,
                        )
                    if path == "workflow":
                        return await runtime.execute_workflow(
                            operation, {}, category
                        )
                    if path == "recovery":
                        return await runtime.execute_recovery(
                            category, f"{category}-task"
                        )
                    if path == "unsupported-recovery":
                        return await runtime.execute_recovery(
                            category, f"{category}-task"
                        )
                    image_registry.select(provider, Capability.TEXT)
                    raise AssertionError("unsupported capability was selected")

                if isinstance(expected, type) and issubclass(
                    expected, BaseException
                ):
                    with self.assertRaises(expected):
                        asyncio.run(execute_case())
                    self.assertEqual(
                        []
                        if path.startswith("unsupported")
                        else [operation],
                        calls,
                    )
                else:
                    result = asyncio.run(execute_case())
                    self.assertIsInstance(result, expected)
                    self.assertEqual([operation], calls)


if __name__ == "__main__":
    unittest.main()
