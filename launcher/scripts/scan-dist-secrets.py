#!/usr/bin/env python3
"""扫描打包产物，确认没有把凭证/本机数据带进安装包。

用法:
    python scripts/scan-dist-secrets.py dist/win-unpacked
    python scripts/scan-dist-secrets.py dist/CanvasAgent-Setup-0.1.5.exe

检查项:
    1. 已知 Token 明文（从 ~/.infinite-canvas/codex-agent.json 读，不硬编码）
    2. sk- 形态的 API Key
    3. 不该被打包的文件：.env / *.pem / *.key / *.db / *.log / .ldb / codex-agent.json
退出码 0 = 干净，1 = 有命中。
"""
import os
import re
import sys
import json
from pathlib import Path

RED = "\033[31m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RESET = "\033[0m"

TEXT_EXT = {
    ".js", ".mjs", ".cjs", ".ts", ".json", ".md", ".txt", ".yml", ".yaml",
    ".html", ".css", ".nsh", ".nsi", ".py", ".sh", ".bat", ".toml", ".ini",
    ".cfg", ".conf", "", ".asar",
}

FORBIDDEN_NAMES = re.compile(
    r"(^\.env|\.pem$|\.key$|\.p12$|\.log$|\.ldb$|\.sqlite|\.db$|^codex-agent\.json$|^launcher\.json$)",
    re.IGNORECASE,
)

SK_PATTERN = re.compile(r"\bsk-[A-Za-z0-9_-]{16,}")
HEX64_PATTERN = re.compile(r"\b[a-f0-9]{64}\b", re.IGNORECASE)

# 混淆后的 asar 里可以合法出现 sha256 常量，允许的例外（≤ 8 个）
MAX_HEX64_ALLOWED = 8


def load_known_token():
    path = Path.home() / ".infinite-canvas" / "codex-agent.json"
    if not path.exists():
        return ""
    try:
        return str(json.loads(path.read_text(encoding="utf-8")).get("token") or "")
    except Exception:
        return ""


def iter_files(root: Path):
    if root.is_file():
        yield root
        return
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            yield Path(dirpath) / name


def main():
    if len(sys.argv) < 2:
        print("usage: scan-dist-secrets.py <dir-or-file>")
        return 2

    root = Path(sys.argv[1])
    if not root.exists():
        print(f"not found: {root}")
        return 2

    token = load_known_token()
    hits = []
    forbidden = []
    hex64 = []
    scanned = 0

    for path in iter_files(root):
        rel = str(path.relative_to(root)) if root.is_dir() else path.name
        if FORBIDDEN_NAMES.search(path.name):
            forbidden.append(rel)
        if path.suffix.lower() not in TEXT_EXT:
            continue
        try:
            data = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        scanned += 1
        if token and token in data:
            hits.append((rel, "known token verbatim"))
        for m in SK_PATTERN.finditer(data):
            hits.append((rel, f"sk- key: {m.group(0)[:14]}…"))
        for m in HEX64_PATTERN.finditer(data):
            hex64.append((rel, m.group(0)))

    print(f"scanned files: {scanned}")
    print(f"target: {root}")

    ok = True
    if hits:
        ok = False
        print(f"{RED}FAIL{RESET} credential leaks: {len(hits)}")
        for rel, kind in hits[:20]:
            print(f"  - {rel}: {kind}")
    else:
        print(f"{GREEN}ok{RESET}   no token / api key in payload")

    if forbidden:
        ok = False
        print(f"{RED}FAIL{RESET} forbidden files: {len(forbidden)}")
        for rel in forbidden[:20]:
            print(f"  - {rel}")
    else:
        print(f"{GREEN}ok{RESET}   no .env / db / log / codex-agent.json")

    if len(hex64) > MAX_HEX64_ALLOWED:
        print(f"{YELLOW}warn{RESET} {len(hex64)} x 64-hex strings (expected code hashes)")
    else:
        print(f"{GREEN}ok{RESET}   64-hex occurrences: {len(hex64)}")

    print("RESULT:", f"{GREEN}CLEAN{RESET}" if ok else f"{RED}LEAK{RESET}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
