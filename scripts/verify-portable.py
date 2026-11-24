"""便携版发布前自检：模拟真实用户从零启动，验收启动链路。

为什么需要它：
  尾随空格、PORT 被前端污染后端、Git Bash 的 timeout 抢先——这类问题只在
  「真的执行 bat + 真的起进程」时暴露，静态检查看不出来。

用法：
  python scripts/verify-portable.py --force                 # 自动挑 dist 里最新的 zip
  python scripts/verify-portable.py --force --zip dist/xxx.zip
  python scripts/verify-portable.py --force --keep          # 保留临时目录便于排查

注意：--force 是必须的，因为自检会先停掉 3000/8080（否则无法验证"从零启动"），
      跑完不会自动恢复你原来的开发环境，需要自己再起一次。

验收项（对齐问题报告的验收标准）：
  1. 冷机起步，bat 正常退出
  2. 3000 有监听且属主是 node
  3. 8080 有监听、health 返回 ok
  4. 首页 / 画布页返回 200
  5. 重复双击不产生第二个实例
  6. Stop 能回收 3000 / 8080
  7. 造错回归：环境变量带尾随空格时不应崩溃
"""

from __future__ import annotations

import argparse
import glob
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile

RED = "\033[31m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
DIM = "\033[2m"
RESET = "\033[0m"

FAILS: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    mark = f"{GREEN}PASS{RESET}" if ok else f"{RED}FAIL{RESET}"
    print(f"  {mark} {name}" + (f" {DIM}| {detail}{RESET}" if detail else ""))
    if not ok:
        FAILS.append(name)


def listeners(port: int) -> set[str]:
    out = subprocess.run(["netstat", "-ano"], capture_output=True).stdout.decode("gbk", "ignore")
    pids: set[str] = set()
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 5 and parts[1].endswith(f":{port}") and "LISTENING" in line:
            pids.add(parts[-1])
    return pids


def kill_port(port: int) -> None:
    for pid in listeners(port):
        subprocess.run(["taskkill", "/F", "/T", "/PID", pid], capture_output=True)


def http_status(url: str, timeout: float = 6) -> int | str:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return resp.status
    except Exception as exc:  # noqa: BLE001 - 只用于报告
        return f"ERR {type(exc).__name__}"


def process_name(pid: str) -> str:
    out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}"], capture_output=True).stdout.decode("gbk", "ignore")
    for line in out.splitlines():
        if pid in line:
            return line.split()[0]
    return "?"


def pick_zip(explicit: str | None) -> str:
    if explicit:
        return os.path.abspath(explicit)
    candidates = sorted(glob.glob(os.path.join("dist", "InfiniteCanvas-Portable-*.zip")), key=os.path.getmtime)
    if not candidates:
        raise SystemExit("dist/ 下没有找到 InfiniteCanvas-Portable-*.zip，请先打包")
    return os.path.abspath(candidates[-1])


def run_bat(bat: str, root: str, log_path: str, timeout: int = 180) -> tuple[int, str]:
    """执行 bat，输出写文件（后台进程若继承管道会导致读不到 EOF）。"""
    with open(log_path, "wb") as fh:
        rc = subprocess.run(
            ["cmd", "/c", bat, "--no-browser"],
            cwd=root,
            stdin=subprocess.DEVNULL,
            stdout=fh,
            stderr=subprocess.STDOUT,
            timeout=timeout,
            creationflags=0x08000000,  # CREATE_NO_WINDOW
        ).returncode
    return rc, open(log_path, "rb").read().decode("gbk", "ignore")


def main() -> int:
    ap = argparse.ArgumentParser(description="便携版启动链路自检")
    ap.add_argument("--zip", help="要验证的 zip（默认取 dist 里最新的）")
    ap.add_argument("--force", action="store_true", help="确认会停掉本地 3000/8080")
    ap.add_argument("--keep", action="store_true", help="保留临时目录")
    args = ap.parse_args()

    if not args.force:
        print(f"{YELLOW}自检会先停掉本机 3000 / 8080（验证『从零启动』必须如此）。{RESET}")
        print(f"{YELLOW}确认请加 --force 重新执行。{RESET}")
        return 2

    zip_path = pick_zip(args.zip)
    version_dir = os.path.basename(zip_path).replace(".zip", "")
    print(f"\n{'=' * 60}\n便携版自检：{os.path.basename(zip_path)}  ({os.path.getsize(zip_path) / 1024 / 1024:.1f} MB)\n{'=' * 60}")

    tmp = tempfile.mkdtemp(prefix="verify-portable-")
    ok_all = True
    try:
        print("\n[0] 停止本地 3000 / 8080")
        for port in (3000, 8080):
            kill_port(port)
        time.sleep(2)
        check("3000 / 8080 已清空", not listeners(3000) and not listeners(8080))

        print("\n[1] 解压并首次启动")
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(tmp)
        root = os.path.join(tmp, version_dir)
        bat = os.path.join(root, "Start-InfiniteCanvas.bat")
        if not os.path.exists(bat):
            check("包内有启动脚本", False, bat)
            return 1

        t0 = time.time()
        rc, out = run_bat(bat, root, os.path.join(tmp, "bat-first.log"))
        elapsed = time.time() - t0
        check("启动脚本正常退出", rc == 0, f"exit={rc}, {elapsed:.1f}s")
        if rc != 0:
            print(f"{DIM}  --- bat 输出（末 15 行）---")
            for line in out.splitlines()[-15:]:
                print("  " + line)
            web_log = os.path.join(root, "data", "web.log")
            if os.path.exists(web_log):
                print("  --- data/web.log（末 10 行）---")
                for line in open(web_log, "rb").read().decode("utf-8", "replace").splitlines()[-10:]:
                    print("  " + line)
            print(RESET, end="")

        print("\n[2] 端口与响应")
        web_pids, api_pids = listeners(3000), listeners(8080)
        check("3000 有监听", bool(web_pids), ",".join(sorted(web_pids)) or "无")
        if web_pids:
            names = ",".join(sorted({process_name(p) for p in web_pids}))
            check("3000 属主是 node", "node" in names.lower(), names)
        check("8080 有监听", bool(api_pids), ",".join(sorted(api_pids)) or "无")
        check("首页 200", http_status("http://127.0.0.1:3000/") == 200, str(http_status("http://127.0.0.1:3000/")))
        check("画布页 200", http_status("http://127.0.0.1:3000/canvas") == 200, str(http_status("http://127.0.0.1:3000/canvas")))
        try:
            with urllib.request.urlopen("http://127.0.0.1:8080/api/health", timeout=6) as resp:
                body = resp.read(200)
            check("后端 health ok", b"ok" in body.lower(), body[:40].decode("utf-8", "replace"))
        except Exception as exc:  # noqa: BLE001
            check("后端 health ok", False, str(exc))

        print("\n[3] 重复启动（不得起第二份）")
        before = (sorted(listeners(3000)), sorted(listeners(8080)))
        run_bat(bat, root, os.path.join(tmp, "bat-second.log"), timeout=120)
        after = (sorted(listeners(3000)), sorted(listeners(8080)))
        check("实例数不变", before == after,
              f"{len(before[0])}/{len(before[1])} -> {len(after[0])}/{len(after[1])}")

        print("\n[4] 停止脚本")
        stop_bat = os.path.join(root, "Stop-InfiniteCanvas.bat")
        if os.path.exists(stop_bat):
            with open(os.path.join(tmp, "stop.log"), "wb") as fh:
                subprocess.run(["cmd", "/c", stop_bat], cwd=root, stdin=subprocess.DEVNULL,
                               stdout=fh, stderr=subprocess.STDOUT, timeout=120,
                               creationflags=0x08000000)
            time.sleep(3)
            check("Stop 后 3000 已停", not listeners(3000), ",".join(sorted(listeners(3000))) or "已停")
            check("Stop 后 8080 已停", not listeners(8080), ",".join(sorted(listeners(8080))) or "已停")
        else:
            check("包内有停止脚本", False, "Stop-InfiniteCanvas.bat 缺失")

        print("\n[5] 造错回归：环境变量带尾随空格")
        env = dict(os.environ)
        env.update({"PORT": "3000 ", "HOSTNAME": "0.0.0.0 "})
        err_log = os.path.join(tmp, "space-test.log")
        with open(err_log, "wb") as fh:
            proc = subprocess.Popen(
                ["node", os.path.join(root, "web", "server.js")],
                cwd=os.path.join(root, "web"),
                stdin=subprocess.DEVNULL, stdout=fh, stderr=fh, env=env,
                creationflags=0x08000000,
            )
            up = False
            for _ in range(40):
                time.sleep(0.5)
                if listeners(3000):
                    up = True
                    break
            status = http_status("http://127.0.0.1:3000/") if up else "未起来"
            detail = f"3000 起来且首页 {status}" if up else open(err_log, "rb").read().decode("utf-8", "replace")[-160:]
            check("trim 生效，不因空格崩溃", up and status == 200, detail)
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
            kill_port(3000)
    finally:
        for port in (3000, 8080):
            kill_port(port)
        if args.keep:
            print(f"\n{YELLOW}临时目录保留：{tmp}{RESET}")
        else:
            time.sleep(2)
            for _ in range(8):
                shutil.rmtree(tmp, ignore_errors=True)
                if not os.path.exists(tmp):
                    break
                time.sleep(1)
            check("临时目录已清理", not os.path.exists(tmp))

    print(f"\n{'=' * 60}")
    if FAILS:
        print(f"{RED}失败 {len(FAILS)} 项：{', '.join(FAILS)}{RESET}")
        print(f"{YELLOW}提示：本地 3000/8080 已被停掉，需要开发环境请重新运行 launch.ps1{RESET}")
        return 1
    print(f"{GREEN}全部通过{RESET}")
    print(f"{YELLOW}提示：本地 3000/8080 已被停掉，需要开发环境请重新运行 launch.ps1{RESET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
