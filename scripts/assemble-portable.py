"""组装无限画布便携版：后端 exe + Next standalone 前端 + 启动脚本 + zip。

前置：web/.next/standalone 已由 `npx next build` 生成（next.config 里 output: "standalone"）。
"""
import json
import os
import shutil
import sqlite3
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
    log(f"[1/7] 后端 exe: {exe_src.name} -> {OUT.name}/infinite-canvas.exe")

    # 2) Next standalone（含 server.js 与依赖）
    app_dir = OUT / "web"
    copy_tree(standalone, app_dir)
    log(f"[2/7] 前端 standalone 复制完成")

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
    log(f"[3/7] 静态资源与 public 就位")

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
    log("[4/7] 启动/停止/打开画布脚本已写入（bat GBK+CRLF，ps1 UTF-8 BOM）")

    stop = """@echo off
chcp 936 >nul
echo 停止无限画布服务...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080 " ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
echo 已停止。
timeout /t 2 >nul
"""
    (OUT / "Stop-InfiniteCanvas.bat").write_bytes(stop.replace("\n", "\r\n").encode("gbk", errors="replace"))
    # 5) 预置数据库：用 SQLite backup 生成一致性快照（不能直接拷 .db，WAL 还没合并）
    db_src = ROOT / "data" / "infinite-canvas.db"
    if db_src.exists():
        data_dir = OUT / "data"
        data_dir.mkdir(exist_ok=True)
        db_dst = data_dir / "infinite-canvas.db"
        if db_dst.exists():
            db_dst.unlink()
        src = sqlite3.connect(f"file:{db_src}?mode=ro", uri=True)
        dst = sqlite3.connect(str(db_dst))
        src.backup(dst)
        dst.close()
        src.close()
        # 顺手把存储根目录改到便携目录下，换机器也能用
        try:
            conn = sqlite3.connect(str(db_dst))
            row = conn.execute("select key, value from settings where key='private'").fetchone()
            if row:
                cfg = json.loads(row[1])
                storage = cfg.get("storage") or {}
                for provider in storage.get("providers") or []:
                    if provider.get("type") == "local":
                        provider["rootPath"] = ".\\storage"
                conn.execute("update settings set value=? where key='private'", (json.dumps(cfg, ensure_ascii=False),))
                conn.commit()
            conn.close()
        except Exception as exc:
            log(f"  存储路径改写跳过：{exc}")
        # 清空 API Key：包要发给别人，不能带自己的密钥；其余配置（渠道、模型选择、画布）保留
        try:
            conn = sqlite3.connect(str(db_dst))
            row = conn.execute("select user_id, model_config from user_configs").fetchone()
            if row:
                mc = json.loads(row[1])
                cleared = 0
                for ch in mc.get("localChannels") or []:
                    if (ch.get("apiKey") or "").strip():
                        ch["apiKey"] = ""
                        cleared += 1
                mc["apiKey"] = ""
                conn.execute("update user_configs set model_config=? where user_id=?",
                             (json.dumps(mc, ensure_ascii=False), row[0]))
                conn.commit()
                log(f"      已清空 {cleared} 个渠道的 API Key（分发包不带密钥）")
            conn.close()
        except Exception as exc:
            log(f"  清空密钥跳过：{exc}")
        log(f"[5/7] 预置数据库 {db_dst.stat().st_size/1024/1024:.1f} MB（含渠道与画布，无密钥）")
    else:
        log("[5/7] 未找到 data/infinite-canvas.db，跳过预置（首次启动会建空库）")

    # 6) 填密钥工具：双击弹窗粘贴，不必进设置页
    fill_ps1 = r'''$ErrorActionPreference = "Continue"
Add-Type -AssemblyName Microsoft.VisualBasic
$apiPort = 8080

function Tip($msg, $title) {
    [void][Microsoft.VisualBasic.Interaction]::MsgBox($msg, 0, $title)
}
function Ask($msg, $title) {
    return [Microsoft.VisualBasic.Interaction]::InputBox($msg, $title, "")
}

$ready = $false
for ($i = 0; $i -lt 40; $i++) {
    try {
        Invoke-RestMethod -Uri "http://127.0.0.1:$apiPort/api/health" -TimeoutSec 2 | Out-Null
        $ready = $true
        break
    } catch { Start-Sleep -Milliseconds 800 }
}
if (-not $ready) {
    Tip "请先双击 Start-InfiniteCanvas.bat 启动服务，再运行本工具。" "服务未启动"
    exit 1
}

try {
    $login = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$apiPort/api/auth/auto-login" -ContentType "application/json" -Body "{}" -TimeoutSec 15
    $headers = @{ Authorization = "Bearer " + $login.data.token }
    $cfg = (Invoke-RestMethod -Uri "http://127.0.0.1:$apiPort/api/v1/user-config" -Headers $headers -TimeoutSec 20).data.modelConfig
} catch {
    Tip ("读取配置失败：" + $_.Exception.Message) "出错了"
    exit 1
}

$grsaiKey = Ask "第 1 步 / 共 2 步`n`n请粘贴 grsai 的 API Key（以 sk- 开头，用于出图与视频）。`n没有就留空点确定。" "填写密钥 1/2：grsai"
$deepseekKey = Ask "第 2 步 / 共 2 步`n`n请粘贴 DeepSeek 的 API Key（以 sk- 开头，用于画布对话）。`n没有就留空点确定。" "填写密钥 2/2：DeepSeek"

$grsaiKey = "$grsaiKey".Trim()
$deepseekKey = "$deepseekKey".Trim()
if (-not $grsaiKey -and -not $deepseekKey) {
    Tip "没有填写任何密钥，已取消。" "已取消"
    exit 0
}

$changed = 0
foreach ($ch in $cfg.localChannels) {
    if ($ch.id -eq "grsai" -and $grsaiKey) { $ch.apiKey = $grsaiKey; $changed++ }
    elseif ($ch.id -eq "grsai-video" -and $grsaiKey) { $ch.apiKey = $grsaiKey; $changed++ }
    elseif ($ch.id -eq "deepseek" -and $deepseekKey) { $ch.apiKey = $deepseekKey; $changed++ }
}

try {
    $body = @{ config = $cfg } | ConvertTo-Json -Depth 30
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$apiPort/api/v1/user-config/model" -Headers $headers -ContentType "application/json; charset=utf-8" -Body $bytes -TimeoutSec 40 | Out-Null
    Tip ("已保存 " + $changed + " 项密钥。`n`n现在可以回到画布开始生成图片了。") "完成"
} catch {
    Tip ("保存失败：" + $_.Exception.Message) "出错了"
}
'''
    (OUT / "fill-apikey.ps1").write_bytes(b"\xef\xbb\xbf" + fill_ps1.replace("\n", "\r\n").encode("utf-8"))
    fill_bat = """@echo off
chcp 936 >nul
title 填写 API 密钥
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fill-apikey.ps1"
exit
"""
    (OUT / "Fill-ApiKey.bat").write_bytes(fill_bat.replace("\n", "\r\n").encode("gbk", errors="replace"))
    log("[6/7] 填密钥工具已写入（Fill-ApiKey.bat + fill-apikey.ps1）")

    # 7) 说明
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

【第一次使用：填一次密钥（只做一次）】
1. 先双击 Start-InfiniteCanvas.bat（服务启动，画布自动打开）
2. 再双击 Fill-ApiKey.bat
3. 弹出的窗口里粘贴 grsai 的 API Key，点确定
4. 再粘贴 DeepSeek 的 API Key（没有就留空），点确定

看到「已保存 N 项密钥」就好了。
以后每次只需要双击 Start-InfiniteCanvas.bat。

【目录说明】
- infinite-canvas.exe : Go 后端（API、存储、任务调度）
- web\\               : 前端构建产物
- open-canvas.ps1     : 自动打开画布并带上 Agent 连接参数
- Fill-ApiKey.bat     : 双击填 API 密钥（弹窗粘贴，不用进设置页）
- data\\              : 数据库与日志（首次运行自动创建）
"""
    (OUT / "README.txt").write_bytes(readme.replace("\n", "\r\n").encode("utf-8-sig"))
    log("[7/7] README 已写入")

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
