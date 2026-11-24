# 无限画布 · 唯一启动器（tigerowo 版）
# 目标：后端 8080 / 前端 3000 / 画布 Agent 3210 各只保留一份，且都是本目录的；
#       已在跑就复用，5xx 或旧目录实例占端口就清掉重启；三件套就绪后才开浏览器。
param([switch]$NoBrowser)

$ErrorActionPreference = "SilentlyContinue"

$root      = $PSScriptRoot
$webDir    = Join-Path $root "web"
$agentDir  = Join-Path $root "canvas-agent"
$dataDir   = Join-Path $root "data"
$webPort   = 3000
$apiPort   = 8080
$agentPort = 3210
$webUrl    = "http://127.0.0.1:$webPort/"
$version   = ""
if (Test-Path (Join-Path $root "VERSION")) { $version = (Get-Content (Join-Path $root "VERSION") -Raw).Trim() }

function Say($msg, $color) { Write-Host $msg -ForegroundColor $color }

function Get-PortPid([int]$port) {
    $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { return [int]$c.OwningProcess } else { return 0 }
}

function Stop-PortTree([int]$port) {
    $target = Get-PortPid $port
    if ($target -le 0) { return }
    $ids = New-Object System.Collections.ArrayList
    [void]$ids.Add($target)
    $cur = $target
    for ($i = 0; $i -lt 5; $i++) {
        $p = Get-CimInstance Win32_Process -Filter "ProcessId=$cur" -ErrorAction SilentlyContinue
        if (-not $p) { break }
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)" -ErrorAction SilentlyContinue
        if (-not $parent) { break }
        if ($parent.Name -match '^(node|cmd|npm|conhost|powershell|pwsh)') {
            [void]$ids.Add([int]$parent.ProcessId)
            $cur = [int]$parent.ProcessId
        } else { break }
    }
    foreach ($one in $ids) { Stop-Process -Id $one -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 900
}

function Test-WebAlive {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri $webUrl -TimeoutSec 4
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

# 判断占着 3000 的进程是不是本目录的 web（路径里的 tigerowo 是 ASCII，不会受中文编码影响）
function Test-PortIsMine([int]$port) {
    $target = Get-PortPid $port
    if ($target -le 0) { return $false }
    $cur = $target
    for ($i = 0; $i -lt 6; $i++) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$cur" -ErrorAction SilentlyContinue
        if (-not $proc) { break }
        $cmd = [string]$proc.CommandLine
        if ($cmd -like "*tigerowo\web*") { return $true }
        if ($cmd -like "*-new\web*") { return $false }
        $cur = [int]$proc.ParentProcessId
        if ($cur -le 0) { break }
    }
    return $false
}

function Test-WebMine {
    if (-not (Test-PortIsMine $webPort)) { return $false }
    return (Test-WebAlive)
}

function Test-ApiOk {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$apiPort/api/health" -TimeoutSec 3
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

function Start-Hidden($argLine, $workDir) {
    Start-Process -FilePath "cmd.exe" -ArgumentList '/c', $argLine -WorkingDirectory $workDir -WindowStyle Hidden
}

function Start-Backend {
    # 中文路径走 cmd 会解析失败，这里用 .NET 原生启动（日志覆盖写，便于只看本次运行）
    Start-Process -FilePath (Join-Path $root "infinite-canvas.exe") `
        -WorkingDirectory $root -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $dataDir "backend.log") `
        -RedirectStandardError (Join-Path $dataDir "backend.err.log")
}

if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }

# ---------- 后端 8080 ----------
Say "[1/3] 后端 API 8080" "Cyan"
if (Test-ApiOk) {
    Say "      已在运行，复用" "DarkGray"
} else {
    if ((Get-PortPid $apiPort) -gt 0) { Say "      端口被占用但接口不通，清掉重启" "Yellow"; Stop-PortTree $apiPort }
    Start-Backend
    for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Milliseconds 700; if (Test-ApiOk) { break } }
    if (Test-ApiOk) { Say "      已启动" "Green" } else { Say "      启动失败，见 data\backend.log / backend.err.log" "Red" }
}

# ---------- 前端 3000 ----------
Say "[2/3] 前端 Web 3000" "Cyan"
if (Test-WebMine) {
    Say "      已在运行，复用" "DarkGray"
} else {
    if ((Get-PortPid $webPort) -gt 0) { Say "      3000 上是别的实例（如 D:\无限画布-new），先清掉" "Yellow"; Stop-PortTree $webPort }
    Start-Hidden "npm run dev >> `"$dataDir\web-dev.log`" 2>&1" $webDir
    for ($i = 0; $i -lt 50; $i++) { Start-Sleep -Milliseconds 700; if (Test-WebMine) { break } }
    if (Test-WebMine) { Say "      已启动" "Green" } else { Say "      启动失败，见 data\web-dev.log" "Red" }
}

# ---------- 清理旧目录残留（D:\无限画布-new 的 agent 用 17371） ----------
if ((Get-PortPid 17371) -gt 0) { Stop-PortTree 17371 }

# ---------- 画布 Agent 3210 ----------
Say "[3/3] 画布 Agent 3210" "Cyan"
if ((Get-PortPid $agentPort) -gt 0) {
    Say "      已在运行，复用" "DarkGray"
} else {
    Start-Hidden "node index.mjs >> `"$dataDir\widget-canvas-agent.log`" 2>&1" $agentDir
    for ($i = 0; $i -lt 20; $i++) { Start-Sleep -Milliseconds 700; if ((Get-PortPid $agentPort) -gt 0) { break } }
    if ((Get-PortPid $agentPort) -gt 0) { Say "      已启动" "Green" } else { Say "      启动失败，见 data\widget-canvas-agent.log" "Red" }
}

# ---------- 直接进画布（连带把 Agent 连接参数带上，使用者无需配置） ----------
function Open-CanvasApp {
    $agentUrl = "http://127.0.0.1:$agentPort"
    $agentToken = ""
    $agentCfg = Join-Path $env:USERPROFILE ".infinite-canvas\codex-agent.json"
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
    if ($agentToken -and ((Get-PortPid $agentPort) -gt 0)) {
        $hash = "#agentUrl=" + [System.Uri]::EscapeDataString($agentUrl) + "&agentToken=" + $agentToken
    }
    if ($canvasId) { $target = "http://127.0.0.1:$webPort/canvas/$canvasId$hash" }
    else { $target = "http://127.0.0.1:$webPort/canvas$hash" }
    Start-Process $target
    Say "已打开画布 $target" "Green"
}

# ---------- 开浏览器 ----------
if (Test-WebMine) {
    if (-not $NoBrowser) { Open-CanvasApp }
    else { Say "已就绪（未打开浏览器）" "Green" }
} else {
    Say "前端没起来，先看 data\web-dev.log" "Red"
    Read-Host "按回车关闭"
}
