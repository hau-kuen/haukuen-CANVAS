#!/usr/bin/env python3
"""扫描器自检：证明 scan-dist-secrets.py 真的抓得到泄漏。

扫描器如果抓不到泄漏，用它放行安装包等于没检查。
    python scripts/scan-selfcheck.py
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCANNER = HERE / "scan-dist-secrets.py"
DIST = HERE.parent / "dist" / "win-unpacked"

pass_n = 0
fail_n = 0


def ok(name, cond, detail=""):
    global pass_n, fail_n
    if cond:
        pass_n += 1
        print(f"PASS {name}")
    else:
        fail_n += 1
        print(f"FAIL {name}  << {detail}")


def run(target):
    r = subprocess.run(
        [sys.executable, str(SCANNER), str(target)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    return r.returncode, r.stdout + r.stderr


def scratch(prefix):
    return Path(tempfile.mkdtemp(prefix="hermes-verify-" + prefix + "-"))


def load_token():
    p = Path.home() / ".infinite-canvas" / "codex-agent.json"
    if not p.exists():
        return ""
    try:
        return str(json.loads(p.read_text(encoding="utf-8")).get("token") or "")
    except Exception:
        return ""


# 1) 干净目录必须放行
clean = scratch("clean")
(clean / "index.mjs").write_text("console.log('ok');\n", encoding="utf-8")
rc, out = run(clean)
ok("干净目录 exit 0", rc == 0, out[-300:])
ok("干净目录判定 CLEAN", "CLEAN" in out, out[-200:])
shutil.rmtree(clean, ignore_errors=True)

# 2) 真实 token 必须被抓，且扫描器自己不能打印明文
token = load_token()
if token:
    leak = scratch("leak")
    (leak / "config.json").write_text(json.dumps({"token": token}), encoding="utf-8")
    rc, out = run(leak)
    ok("token 泄漏 exit 1", rc == 1, out[-300:])
    ok("token 泄漏判定 LEAK", "LEAK" in out, out[-200:])
    ok("扫描器不回显明文 token", token not in out, "把明文打出来了")
    shutil.rmtree(leak, ignore_errors=True)
else:
    print("SKIP token 泄漏用例（本机无 codex-agent.json）")

# 3) 敏感文件名必须被点名
bad = scratch("bad")
(bad / ".env").write_text("KEY=1\n", encoding="utf-8")
(bad / "agent.log").write_text("x\n", encoding="utf-8")
(bad / "codex-agent.json").write_text("{}\n", encoding="utf-8")
rc, out = run(bad)
ok("敏感文件 exit 1", rc == 1, out[-300:])
ok("敏感文件被点名", ".env" in out and "codex-agent.json" in out, out[-300:])
shutil.rmtree(bad, ignore_errors=True)

# 4) sk- 形态 key 必须被抓
sk = scratch("sk")
(sk / "a.js").write_text('const k = "sk-proj-ABCDEFGHIJKLMNOPQRSTUV";\n', encoding="utf-8")
rc, _ = run(sk)
ok("sk- key exit 1", rc == 1)
shutil.rmtree(sk, ignore_errors=True)

# 5) 真实产物必须干净
if DIST.exists():
    rc, out = run(DIST)
    ok("真实产物 exit 0", rc == 0, out[-400:])
    ok("真实产物判定 CLEAN", "CLEAN" in out, out[-200:])
    ok("真实产物无 token", "known token" not in out, out[-300:])
else:
    print(f"SKIP 真实产物检查（{DIST} 不存在，先 npm run dist:win）")

print(f"\nRESULT: PASS {pass_n} / FAIL {fail_n}")
sys.exit(0 if fail_n == 0 else 1)
