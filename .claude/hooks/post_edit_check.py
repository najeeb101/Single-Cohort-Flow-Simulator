"""PostToolUse gate for Edit/Write: py_compile on .py files, ESLint on web/**/*.ts(x)."""
import json
import subprocess
import sys


def main():
    data = json.load(sys.stdin)
    file_path = data.get("tool_input", {}).get("file_path", "")
    if not file_path:
        return 0

    normalized = file_path.replace("\\", "/")

    if normalized.endswith(".py"):
        result = subprocess.run(["py", "-m", "py_compile", file_path])
        return 2 if result.returncode != 0 else 0

    if "/web/" in normalized and normalized.endswith((".ts", ".tsx")):
        web_dir = normalized.split("/web/")[0] + "/web"
        rel_path = normalized.split("/web/", 1)[1]
        result = subprocess.run(f'npx eslint "{rel_path}"', cwd=web_dir, shell=True)
        return 2 if result.returncode != 0 else 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
