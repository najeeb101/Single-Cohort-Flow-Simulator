"""Enforces the layering in docs/architecture.md: a package may import its own layer or any
layer below it, never one above. Parses every module in src/ (lazy and TYPE_CHECKING imports
included), so a stray upward import fails here instead of becoming a cycle later."""
import ast
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src"

# Lowest layer first. Keep in sync with docs/architecture.md.
LAYERS = ["domain", "validation", "engine", "analysis", "storage", "planner", "api"]
RANK = {name: i for i, name in enumerate(LAYERS)}
# Modules that sit outside the layers: process configuration, importable from anywhere.
UNLAYERED = {"env"}


def _imported_packages(tree: ast.AST):
    """Yield the top-level src sub-package/module each import statement points at."""
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                parts = alias.name.split(".")
                if parts[0] == "src" and len(parts) > 1:
                    yield parts[1]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            parts = node.module.split(".")
            if parts[0] != "src":
                continue
            if len(parts) > 1:
                yield parts[1]
            else:  # `from src.planner import jobs`
                for alias in node.names:
                    yield alias.name


def _layer_of(path: Path) -> str:
    return path.relative_to(SRC).parts[0].removesuffix(".py")


def test_every_module_lives_in_a_known_layer():
    for path in SRC.rglob("*.py"):
        layer = _layer_of(path)
        if layer == "__init__":
            continue
        assert layer in RANK or layer in UNLAYERED, (
            f"{path.relative_to(SRC)} is outside the layers {LAYERS}; see docs/architecture.md"
        )


def test_no_layer_imports_a_layer_above_it():
    violations = []
    for path in sorted(SRC.rglob("*.py")):
        layer = _layer_of(path)
        if layer not in RANK:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for target in set(_imported_packages(tree)):
            if target in RANK and RANK[target] > RANK[layer]:
                violations.append(f"{path.relative_to(SRC)} ({layer}) imports {target}")
    assert not violations, "upward imports:\n" + "\n".join(violations)
