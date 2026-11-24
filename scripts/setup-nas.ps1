# setup-nas.ps1 - mount Synology share, create directory skeleton, measure throughput
# Usage:
#   .\setup-nas.ps1 -NasHost 192.168.1.200 -User canvas -Password '***'
#   .\setup-nas.ps1 -NasHost 192.168.1.200 -User canvas -Password '***' -SkipThroughput
#
# Notes:
#   - Must run in an elevated PowerShell? No. net use + cmdkey work per-user.
#   - Credentials are stored in Windows Credential Manager (cmdkey) so the drive
#     survives reboot as long as the session user is the same.
#   - Keep this file ASCII-only: Windows PowerShell 5.1 misreads non-BOM UTF-8.

param(
    [Parameter(Mandatory = $true)][string]$NasHost,
    [string]$Share = "canvas",
    [string]$Drive = "Z",
    [Parameter(Mandatory = $true)][string]$User,
    [Parameter(Mandatory = $true)][string]$Password,
    [switch]$SkipThroughput
)

$ErrorActionPreference = "Stop"
$unc = "\\$NasHost\$Share"
$driveRoot = "${Drive}:"

function Write-Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "    OK  $text" -ForegroundColor Green }
function Write-Warn2($text) { Write-Host "    !!  $text" -ForegroundColor Yellow }

# ---------- 1. reachability ----------
Write-Step "Checking NAS reachability ($NasHost)"
if (-not (Test-Connection -ComputerName $NasHost -Count 2 -Quiet -ErrorAction SilentlyContinue)) {
    Write-Warn2 "ICMP failed (NAS may block ping); continuing with SMB probe"
}
$smb = Test-NetConnection -ComputerName $NasHost -Port 445 -InformationLevel Quiet -WarningAction SilentlyContinue
if (-not $smb) { throw "SMB port 445 unreachable on $NasHost. Check cable / IP / firewall." }
Write-Ok "SMB 445 reachable"

# ---------- 2. credentials ----------
Write-Step "Storing credentials for $NasHost"
cmdkey /add:$NasHost /user:$User /pass:$Password | Out-Null
Write-Ok "cmdkey entry written (survives reboot)"

# ---------- 3. mount ----------
Write-Step "Mounting $unc to $driveRoot"
if (Test-Path $driveRoot) {
    $existing = (Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$driveRoot'" -ErrorAction SilentlyContinue)
    if ($existing) {
        Write-Warn2 "$driveRoot already in use by '$($existing.VolumeName)'; removing mapping"
        cmd /c "net use $Drive /delete /y" | Out-Null
    }
}
& net use $Drive $unc $Password /user:$User /persistent:yes | Out-Null
if (-not (Test-Path $driveRoot)) { throw "Mount failed. Verify share name '$Share' and that '$User' has access." }
Write-Ok "Mounted $driveRoot -> $unc"

# ---------- 4. directory skeleton ----------
Write-Step "Creating canvas directory skeleton"
$dirs = @(
    "$driveRoot\projects",
    "$driveRoot\uploads",
    "$driveRoot\generated",
    "$driveRoot\trash",
    "$driveRoot\_meta"
)
foreach ($d in $dirs) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
    Write-Ok $d
}

# ---------- 5. throughput ----------
if (-not $SkipThroughput) {
    Write-Step "Measuring SMB throughput"

    # large sequential file: 512 MB
    $sizeMB = 512
    $src = Join-Path $env:TEMP "nas-bench-$sizeMB.bin"
    $dst = "$driveRoot\_meta\nas-bench.bin"
    $buf = New-Object byte[] (8MB)
    (New-Object Random).NextBytes($buf)
    $fs = [System.IO.File]::Create($src)
    for ($i = 0; $i -lt ($sizeMB / 8); $i++) { $fs.Write($buf, 0, $buf.Length) }
    $fs.Close()

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Copy-Item $src $dst -Force
    $sw.Stop()
    $writeMBs = [math]::Round($sizeMB / $sw.Elapsed.TotalSeconds, 1)

    $sw2 = [System.Diagnostics.Stopwatch]::StartNew()
    $null = [System.IO.File]::ReadAllBytes($dst)
    $sw2.Stop()
    $readMBs = [math]::Round($sizeMB / $sw2.Elapsed.TotalSeconds, 1)

    Remove-Item $src -Force -ErrorAction SilentlyContinue
    Remove-Item $dst -Force -ErrorAction SilentlyContinue

    Write-Ok "Sequential write: $writeMBs MB/s"
    Write-Ok "Sequential read : $readMBs MB/s"
    if ($writeMBs -lt 40) {
        Write-Warn2 "Write below 40 MB/s: link likely negotiated at 100 Mbps or cable is faulty (4-wire)."
    }

    # many small files: 200 x 20 KB
    Write-Step "Small-file test (200 x 20KB)"
    $dir = "$driveRoot\_meta\smallfile-test"
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $small = New-Object byte[] (20KB)
    (New-Object Random).NextBytes($small)
    $sw3 = [System.Diagnostics.Stopwatch]::StartNew()
    for ($i = 0; $i -lt 200; $i++) {
        [System.IO.File]::WriteAllBytes((Join-Path $dir "t$i.bin"), $small)
    }
    $sw3.Stop()
    Write-Ok ("Small-file total: {0:N1} s ({1:N0} files/s)" -f $sw3.Elapsed.TotalSeconds, (200 / $sw3.Elapsed.TotalSeconds))
    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}

# ---------- 6. summary ----------
Write-Step "Summary"
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$driveRoot'"
$freeGB = [math]::Round($disk.FreeSpace / 1GB, 1)
$totalGB = [math]::Round($disk.Size / 1GB, 1)
Write-Ok "$driveRoot mapped, ${totalGB} GB total, ${freeGB} GB free"
Write-Host ""
Write-Host "Next: point the backend storage provider at $driveRoot (type=local, rootPath=$driveRoot)" -ForegroundColor Gray
