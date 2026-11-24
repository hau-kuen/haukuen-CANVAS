"""组装无限画布便携版：后端 exe + Next standalone 前端 + 启动脚本 + zip。

前置：web/.next/standalone 已由 `npx next build` 生成（next.config 里 output: "standalone"）。
"""
import os
import shutil
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(r"D:\无限画布-tigerowo")
WEB = ROOT / "web"
NEXT = WEB / ".next"
VERSION = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
NAME = f"InfiniteCanvas-Portable-{VERSION}"
OUT = ROOT / "dist" / NAME


def log(msg):
    print(msg, flush=True)


def copy_tree(src: Path, dst: Path):
    if not src.exists():
        log(f"  跳过（不存在）: {src}")
        return False
    shutil.copytree(src, dst, dirs_exist_ok=True)
    return True


def main():
    standalone = NEXT / "standalone"
    if not standalone.exists():
        raise SystemExit("缺少 .next/standalone，请先构建前端")

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    # 1) 后端 exe
    exe_src = ROOT / "dist" / f"infinite-canvas-{VERSION}-windows-amd64.exe"
    if not exe_src.exists():
        exe_src = ROOT / "infinite-canvas.exe"
    shutil.copy2(exe_src, OUT / "infinite-canvas.exe")
    log(f"[1/5] 后端 exe: {exe_src.name} -> {OUT.name}/infinite-canvas.exe")

    # 2) Next standalone（含 server.js 与依赖）
    app_dir = OUT / "web"
    copy_tree(standalone, app_dir)
    log(f"[2/5] 前端 standalone 复制完成")

    # 3) standalone 缺的两块：静态资源与 public
    copy_tree(NEXT / "static", app_dir / ".next" / "static")
    copy_tree(WEB / "public", app_dir / "public")
    # standalone 有时会把 .next 放在 server 目录下，这里统一兜底
    nested = app_dir / "web"
    if nested.exists() and (nested / "server.js").exists():
        for item in nested.iterdir():
            target = app_dir / item.name
            if target.exists():
                continue
            shutil.move(str(item), str(target))
        nested.rmdir()
        log("  修正了嵌套的 web/ 目录")
    log(f"[3/5] 静态资源与 public 就位")

    # 4) 启动脚本（GBK + CRLF，Windows cmd 才不闪退）
    bat = """@echo off
chcp 936 >nul
title Infinite Canvas %VERSION%
cd /d "%~dp0"

echo [1/3] 启动后端服务 (8080)...
start "" /min "infinite-canvas.exe"

echo [2/3] 等待后端就绪...
:waitapi
timeout /t 1 /nobreak >nul
curl -s -o nul http://127.0.0.1:8080/api/health
if errorlevel 1 goto waitapi
echo       后端已就绪

echo [3/3] 启动前端并打开画布 (3000)...
start "" /min cmd /c "set PORT=3000 && set HOSTNAME=0.0.0.0 && node web\\server.js"
timeout /t 4 /nobreak >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0open-canvas.ps1"

echo.
echo 已启动：画布会在浏览器里自动打开
echo 关闭窗口不会停止服务；要停止请运行 Stop-InfiniteCanvas.bat
timeout /t 5 >nul
""".replace("%VERSION%", VERSION)
    (OUT / "Start-InfiniteCanvas.bat").write_bytes(bat.replace("\n", "\r\n").encode("gbk", errors="replace"))

    # 打开画布的小脚本：取最近画布 + 带上 Agent 连接参数，使用者无需任何配置
    opener = """$ErrorActionPreference = "SilentlyContinue"
$apiPort = 8080
$webPort = 3000
$agentPort = 3210

$agentUrl = "http://127.0.0.1:$agentPort"
$agentToken = ""
$agentCfg = Join-Path $env:USERPROFILE ".infinite-canvas\\codex-agent.json"
if (Test-Path $agentCfg) {
    try {
        $cfg = Get-Content -Path $agentCfg -Raw | ConvertFrom-Json
        if ($cfg.token) { $agentToken = [string]$cfg.token }
        if ($cfg.url) { $agentUrl = [string]$cfg.url }
    } catch { }
}

$canvasId = ""
try {
    $login = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$apiPort/api/auth/auto-login" -ContentType "application/json" -Body "{}" -TimeoutSec 10
    $headers = @{ Authorization = "Bearer " + $login.data.token }
    $projects = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$apiPort/api/v1/canvas/projects" -Headers $headers -TimeoutSec 10
    if ($projects.data -and @($projects.data).Count -gt 0) { $canvasId = [string](@($projects.data)[0].id) }
} catch { }

$hash = ""
$agentUp = (Get-NetTCPConnection -LocalPort $agentPort -State Listen -ErrorAction SilentlyContinue) -ne $null
if ($agentToken -and $agentUp) {
    $hash = "#agentUrl=" + [System.Uri]::EscapeDataString($agentUrl) + "&agentToken=" + $agentToken
}
if ($canvasId) { $target = "http://127.0.0.1:$webPort/canvas/$canvasId$hash" }
else { $target = "http://127.0.0.1:$webPort/canvas$hash" }
Start-Process $target
"""
    (OUT / "open-canvas.ps1").write_bytes(b"\xef\xbb\xbf" + opener.replace("\n", "\r\n").encode("utf-8"))
    log("[4/5] 启动/停止/打开画布脚本已写入（bat GBK+CRLF，ps1 UTF-8 BOM）")

    stop = """@echo off
chcp 936 >nul
echo 停止无限画布服务...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080 " ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
echo 已停止。
timeout /t 2 >nul
"""
    (OUT / "Stop-InfiniteCanvas.bat").write_bytes(stop.replace("\n", "\r\n").encode("gbk", errors="replace"))
    log("[4/5] 启动/停止脚本（GBK+CRLF）已写入")

    # 5) 说明
    readme = f"""无限画布 {VERSION} 便携版
==============================

【怎么用】
双击 Start-InfiniteCanvas.bat
→ 服务自动启动
→ 浏览器自动打开画布，Agent 已自动连好
不需要做任何配置。

停止：双击 Stop-InfiniteCanvas.bat
手动访问：http://127.0.0.1:3000

【前置要求】
本机需要安装 Node.js 20 或更高版本（前端靠它运行）。
如果没装，去 https://nodejs.org 下载 LTS 版，一路下一步即可。

【首次部署（仅管理员做一次）】
1. 打开后进入「设置」
2. 填入 grsai、DeepSeek 等服务商的 API Key
3. 保存

填好之后，日常使用的人只需要双击 Start-InfiniteCanvas.bat。

【目录说明】
- infinite-canvas.exe : Go 后端（API、存储、任务调度）
- web\\               : 前端构建产物
- open-canvas.ps1     : 自动打开画布并带上 Agent 连接参数
- data\\              : 数据库与日志（首次运行自动创建）
"""
    (OUT / "README.txt").write_bytes(readme.replace("\n", "\r\n").encode("utf-8-sig"))
    log("[5/5] README 已写入")

    # zip
    zip_path = ROOT / "dist" / f"{NAME}.zip"
    if zip_path.exists():
        zip_path.unlink()
    count = 0
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in OUT.rglob("*"):
            if path.is_file():
                zf.write(path, path.relative_to(OUT.parent))
                count += 1
    size_mb = zip_path.stat().st_size / 1024 / 1024
    log(f"\n打包完成: {zip_path}")
    log(f"  文件数 {count}，压缩包 {size_mb:.1f} MB")
    log(f"  解压后目录: {OUT}")


if __name__ == "__main__":
    main()
