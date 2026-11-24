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

CRLF = "\r\n"
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

    # 防御性补丁：standalone 的 server.js 直接用 process.env.HOSTNAME/PORT，不 trim。
    # 任何一个调用方把 "0.0.0.0 " 带进来，Next 的 getaddrinfo 就会 ENOTFOUND 并静默退出。
    server_js = OUT / "web" / "server.js"
    if server_js.exists():
        code = server_js.read_text(encoding="utf-8")
        patched = code.replace(
            "const currentPort = parseInt(process.env.PORT, 10) || 3000",
            "const currentPort = parseInt((process.env.PORT || '').trim(), 10) || 3000",
        ).replace(
            "const hostname = process.env.HOSTNAME || '0.0.0.0'",
            "const hostname = (process.env.HOSTNAME || '').trim() || '0.0.0.0'",
        )
        if patched != code:
            server_js.write_text(patched, encoding="utf-8")
            log("      server.js 已打 PORT/HOSTNAME trim 补丁")
        else:
            log("      server.js 无需补丁（或已打过）")

    # 4) 启动脚本（GBK + CRLF）
    # 关键：必须用 cmd 的 set "VAR=value" 写法。写成 set VAR=value && ... 会把 && 前的空格写进值，
    # HOSTNAME 变成 "0.0.0.0 " → Next 的 getaddrinfo 解析失败 → 前端静默崩溃（v0.8.5 就是这个坑）。
    bat = """@echo off
chcp 936 >nul
title Infinite Canvas %VERSION%
cd /d "%~dp0"
if not exist "data" mkdir "data"

set "SKIP_BROWSER="
if /i "%~1"=="--no-browser" set "SKIP_BROWSER=1"
rem 用绝对路径，避免 Git Bash 等工具的同名 timeout 抢先（GNU timeout 不认 /t 参数）
set "SLEEP=%SystemRoot%\\System32\\timeout.exe"
set "NS=%SystemRoot%\\System32\\netstat.exe"
set "FS=%SystemRoot%\\System32\\findstr.exe"

rem ---------- 数据与媒体目录（不随程序目录走，换版本不丢） ----------
set "APP_DATA=%LOCALAPPDATA%\\InfiniteCanvas"
if not exist "%APP_DATA%\\data" mkdir "%APP_DATA%\\data"
if not exist "%APP_DATA%\\data\\infinite-canvas.db" (
    if exist "%~dp0data\\infinite-canvas.db" (
        echo       首次运行：初始化数据目录
        copy /Y "%~dp0data\\infinite-canvas.db" "%APP_DATA%\\data\\" >nul
    )
)
set "DATABASE_DSN=%APP_DATA%\\data\\infinite-canvas.db"

if not defined CANVAS_STORAGE_ROOT (
    if exist "D:\\" (
        set "CANVAS_STORAGE_ROOT=D:\\canvas-storage"
    ) else (
        set "CANVAS_STORAGE_ROOT=%APP_DATA%\\storage"
    )
)
if not exist "%CANVAS_STORAGE_ROOT%" mkdir "%CANVAS_STORAGE_ROOT%" 2>nul

rem 每天首次启动时备份一次数据库（保留 7 天）
if exist "%DATABASE_DSN%" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup-db.ps1" -DataDir "%APP_DATA%\\data" -BackupDir "%APP_DATA%\\backup"

echo [1/4] 后端服务 8080
rem 后端必须用默认 8080，先清掉可能存在的 PORT，免得被前端端口污染
set "PORT="
set "HOSTNAME="
%NS% -ano | %FS% /c:":8080 " | %FS% /i LISTENING >nul
if errorlevel 1 (
    start "" /min cmd /c "infinite-canvas.exe >> data\\backend.log 2>&1"
    echo       正在启动...
) else (
    echo       已在运行，复用
)

set /a tries=0
:wait_api
%SLEEP% /t 1 /nobreak >nul
%NS% -ano | %FS% /c:":8080 " | %FS% /i LISTENING >nul
if not errorlevel 1 goto api_ready
set /a tries+=1
if %tries% lss 60 goto wait_api
echo.
echo  [错误] 后端 60 秒内没起来。请把本窗口截图反馈。
echo  数据目录：%APP_DATA%
echo  日志：data\\backend.log、data\\backend.err.log
pause
exit /b 1
:api_ready
echo       后端就绪

rem 只给前端设置端口与监听地址
set "PORT=3000"
set "HOSTNAME=0.0.0.0"

echo [2/4] 前端 3000
%NS% -ano | %FS% /c:":3000 " | %FS% /i LISTENING >nul
if errorlevel 1 (
    start "" /min cmd /c "node web\\server.js >> data\\web.log 2>&1"
    echo       正在启动...
) else (
    echo       已在运行，复用
)

set /a wtries=0
:wait_web
%SLEEP% /t 1 /nobreak >nul
%NS% -ano | %FS% /c:":3000 " | %FS% /i LISTENING >nul
if not errorlevel 1 goto web_ready
set /a wtries+=1
if %wtries% lss 90 goto wait_web
echo.
echo  [错误] 前端没能启动（3000 端口没有监听）
echo  -------- data\\web.log --------
type "data\\web.log" 2>nul
echo  -----------------------------
pause
exit /b 1
:web_ready
echo       前端就绪

echo [3/4] 打开画布
if not defined SKIP_BROWSER powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0open-canvas.ps1"

echo [4/4] 启动完成
echo.
echo   地址：http://127.0.0.1:3000
echo   数据：%APP_DATA%\\data
echo   媒体：%CANVAS_STORAGE_ROOT%
echo   停止：双击 Stop-InfiniteCanvas.bat
%SLEEP% /t 5 >nul
exit /b 0
""".replace("%VERSION%", VERSION)

    (OUT / "Start-InfiniteCanvas.bat").write_bytes(bat.replace("\r\n", "\n").replace("\n", CRLF).encode("gbk", errors="replace"))

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

# 等前端真正响应再开浏览器，避免白屏
$webReady = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$webPort/" -UseBasicParsing -TimeoutSec 2
        if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) { $webReady = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 1000
}
if (-not $webReady) { Write-Output "前端还没就绪，仍尝试打开浏览器" }

$hash = ""
$agentUp = (Get-NetTCPConnection -LocalPort $agentPort -State Listen -ErrorAction SilentlyContinue) -ne $null
if ($agentToken -and $agentUp) {
    $hash = "#agentUrl=" + [System.Uri]::EscapeDataString($agentUrl) + "&agentToken=" + $agentToken
}
if ($canvasId) { $target = "http://127.0.0.1:$webPort/canvas/$canvasId$hash" }
else { $target = "http://127.0.0.1:$webPort/canvas$hash" }
Start-Process $target
"""
    (OUT / "open-canvas.ps1").write_bytes(b"\xef\xbb\xbf" + opener.replace("\r\n", "\n").replace("\n", CRLF).encode("utf-8"))
    log("[4/7] 启动/停止/打开画布脚本已写入（bat GBK+CRLF，ps1 UTF-8 BOM）")

    stop = """@echo off
chcp 936 >nul
title 停止无限画布
echo 正在停止无限画布服务...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports = 3000,8080,3210; foreach ($p in $ports) { Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"
echo 已停止（3000 / 8080 / 3210）。
"%SystemRoot%\\System32\\timeout.exe" /t 2 >nul
"""

    (OUT / "Stop-InfiniteCanvas.bat").write_bytes(stop.replace("\r\n", "\n").replace("\n", CRLF).encode("gbk", errors="replace"))
    backup_ps1 = r'''param(
    [Parameter(Mandatory=$true)][string]$DataDir,
    [Parameter(Mandatory=$true)][string]$BackupDir
)
$ErrorActionPreference = "SilentlyContinue"
$today = Get-Date -Format "yyyyMMdd"
$target = Join-Path $BackupDir $today
if (Test-Path (Join-Path $target "infinite-canvas.db")) { exit 0 }
New-Item -ItemType Directory -Force -Path $target | Out-Null
# 连 -wal / -shm 一起复制，单独一个 .db 可能落后于最新写入
Copy-Item (Join-Path $DataDir "infinite-canvas.db*") -Destination $target -Force
Get-ChildItem $BackupDir -Directory | Sort-Object Name -Descending | Select-Object -Skip 7 | Remove-Item -Recurse -Force
exit 0
'''
    (OUT / "backup-db.ps1").write_bytes(b"\xef\xbb\xbf" + backup_ps1.replace("\r\n", "\n").replace("\n", CRLF).encode("utf-8"))

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
                # 本地存储根目录由启动脚本的 CANVAS_STORAGE_ROOT 决定，这里不动 DB 配置
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
    (OUT / "fill-apikey.ps1").write_bytes(b"\xef\xbb\xbf" + fill_ps1.replace("\r\n", "\n").replace("\n", CRLF).encode("utf-8"))
    fill_bat = """@echo off
chcp 936 >nul
title 填写 API 密钥
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fill-apikey.ps1"
exit
"""
    (OUT / "Fill-ApiKey.bat").write_bytes(fill_bat.replace("\r\n", "\n").replace("\n", CRLF).encode("gbk", errors="replace"))
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

【数据保存位置（重要）】
程序和数据是分开的，换版本、重新解压都不会丢数据：

  数据库：%LOCALAPPDATA%\InfiniteCanvas\data\infinite-canvas.db
  备份：  %LOCALAPPDATA%\InfiniteCanvas\backup\yyyyMMdd（每天一份，留 7 天）
  图片：  D:\canvas-storage（没有 D 盘时是 %LOCALAPPDATA%\InfiniteCanvas\storage）

升级方法：直接用新版本的压缩包覆盖程序目录即可，
不要删除上面这三个位置，工程和图片都还在。

想换图片存放位置：设置系统环境变量 CANVAS_STORAGE_ROOT 指向新目录，
把旧的 storage 目录整个复制过去即可（数据库只存相对路径，不用改配置）。

【目录说明】
- infinite-canvas.exe : Go 后端（API、存储、任务调度）
- web\               : 前端构建产物
- open-canvas.ps1     : 自动打开画布并带上 Agent 连接参数
- backup-db.ps1       : 每日数据库备份（启动时自动调用，不用手动跑）
- Fill-ApiKey.bat     : 双击填 API 密钥（弹窗粘贴，不用进设置页）
- data\              : 首次运行用的种子数据，迁移到用户目录后不再使用
"""
    (OUT / "README.txt").write_bytes(readme.replace("\r\n", "\n").replace("\n", CRLF).encode("utf-8-sig"))
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
