"""Run CLI public-interface contracts in the standard deterministic suite."""
import importlib.util
from pathlib import Path
import unittest


def load_tests(loader, tests, pattern):
    path = Path(__file__).resolve().parents[1] / 'tools/reroll-mcp/tests/test_cli.py'
    spec = importlib.util.spec_from_file_location('reroll_cli_contract_tests', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return loader.loadTestsFromModule(module)
