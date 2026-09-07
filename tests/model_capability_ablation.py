"""Repeat capability-save ablations in isolated processes; never edit user state."""

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SUITES = [
    "tests.test_model_capability_workbench", "tests.test_model_capability_matrix",
    "tests.test_model_capabilities", "tests.test_model_capability_api",
    "tests.test_complete_api_settings_backup",
]


def run_child(code):
    result = subprocess.run(
        [sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True,
        timeout=60,
    )
    if result.returncode:
        raise AssertionError(result.stdout + result.stderr)
    print(result.stdout.strip(), flush=True)


run_child(f"""
import unittest
result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromNames({SUITES!r}))
assert result.wasSuccessful()
print('PASS: simplified save, catalog and backup; %s tests' % result.testsRun)
""")

variants = [
    (
        "bounds validation",
        "tests.test_model_capability_workbench.ModelCapabilityWorkbenchTests.test_draft_rejects_contradictory_capability_bounds",
        """
from tests.test_model_capability_workbench import ModelCapabilityWorkbench
ModelCapabilityWorkbench._validate_bounds = classmethod(lambda cls, value, path='capability': None)
""",
    ),
    (
        "catalog state validation",
        "tests.test_model_capabilities.ModelCapabilityCatalogTests.test_invalid_published_support_state_keeps_last_catalog",
        """
from tests.test_model_capabilities import ModelCapabilityCatalog
import sys
sys.modules[ModelCapabilityCatalog.__module__]._validate_support_states = lambda *args, **kwargs: None
""",
    ),
    (
        "publication rollback",
        "tests.test_model_capability_matrix.ModelCapabilityMatrixTests.test_failed_activation_rolls_back_the_whole_model_edit",
        """
from tests.test_model_capability_matrix import ModelCapabilityWorkbench
import inspect, textwrap
method = ModelCapabilityWorkbench.publish_manual_capabilities
source = textwrap.dedent(inspect.getsource(method))
assert 'self._write(previous_state)' in source
source = source.replace('self._write(previous_state)', 'pass')
namespace = {}
exec(compile(source, '<rollback-ablation>', 'exec'), method.__globals__, namespace)
ModelCapabilityWorkbench.publish_manual_capabilities = namespace[method.__name__]
""",
    ),
    (
        "administrator access",
        "tests.test_model_capability_api.ModelCapabilityApiTests.test_model_capability_workbench_requires_an_administrator",
        """
from tests.test_model_capability_api import main
main._model_capability_workbench_actor = lambda: 'test-admin'
""",
    ),
]

for name, test, mutation in variants:
    run_child(f"""
import unittest
{mutation}
result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName({test!r}))
assert result.testsRun == 1 and len(result.failures) == 1 and not result.errors, 'Ablation did not produce the expected acceptance failure'
print('KEEP: removing ' + {name!r} + ' breaks acceptance')
""")
