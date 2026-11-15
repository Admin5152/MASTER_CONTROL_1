# Sentinel launcher. Usage:
#   powershell -ExecutionPolicy Bypass -File run.ps1          HTTPS on 0.0.0.0:8443 (laptop + tablet)
#   powershell -ExecutionPolicy Bypass -File run.ps1 -Http    plain HTTP on 127.0.0.1:8000 (laptop only)
#   add -NoBrowser to skip opening Chrome, -SkipSpeaker to skip the optional speaker-ID install
param([switch]$Http, [switch]$NoBrowser, [switch]$SkipSpeaker)
$ErrorActionPreference = "Continue"
Set-Location -Path $PSScriptRoot

# 1. Python environment
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Host "Creating .venv ..."
    $sys = (Get-Command python -ErrorAction SilentlyContinue)
    if (-not $sys) { Write-Host "Python 3.10+ is required: winget install Python.Python.3.12" -ForegroundColor Red; exit 1 }
    & python -m venv .venv
}
& $py -c "import fastapi, uvicorn, httpx, dotenv, numpy, cryptography, multipart" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing backend packages ..."
    & $py -m pip install -r requirements.txt
}
# 1b. Optional offline voice (local Whisper + Kokoro). Failure is fine: the browser voice takes over.
& $py -c "import faster_whisper, kokoro_onnx" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing the offline voice packages (requirements-voice.txt) ..."
    & $py -m pip install -r requirements-voice.txt
}
if (-not (Test-Path (Join-Path $PSScriptRoot "models\tts\kokoro-v1.0.onnx"))) { Write-Host "Kokoro model missing: see README > Models (the fallback voice will be the browser's)." -ForegroundColor Yellow }
if (-not (Test-Path (Join-Path $PSScriptRoot "models\whisper\base.en\model.bin"))) { Write-Host "Local Whisper model missing: see README > Models (speech needs Groq or the browser then)." -ForegroundColor Yellow }

# 2. Optional speaker ID (Resemblyzer). Plain `pip install resemblyzer` fails on Windows (webrtcvad needs a
#    C++ compiler), so install in this order. Failure here is fine: the app uses the manual crew selector.
if (-not $SkipSpeaker) {
    & $py -c "import resemblyzer" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Installing optional speaker ID (Resemblyzer, CPU torch). This can take a few minutes ..."
        try {
            & $py -m pip install torch --index-url https://download.pytorch.org/whl/cpu
            & $py -m pip install webrtcvad-wheels
            & $py -m pip install resemblyzer --no-deps
            & $py -m pip install librosa scipy soundfile
        } catch { Write-Host "Speaker ID not installed; continuing without it." -ForegroundColor Yellow }
    }
}

# 3. One server per port: stop whatever is still listening there (a stale server from yesterday serves old
#    code and was the cause of "no voice reply"), then start fresh.
function Stop-Port([int]$port) {
    $pids = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($p in $pids) {
        if ($p -and $p -ne $PID) {
            $name = (Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName
            Write-Host "  Port $port was in use by $name (PID $p): stopping it." -ForegroundColor Yellow
            Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        }
    }
    if ($pids.Count) { Start-Sleep -Milliseconds 800; Write-Host "  Server restarted on port $port with the current code." -ForegroundColor Green }
}
$servePort = if ($Http) { 8000 } else { 8443 }
Stop-Port $servePort

# Twi voice (Khaya AI): a small Node service on port 3001 that Sentinel calls through /api/twi. Optional: without
# Node, Sentinel runs in English only.
if (Get-Command node -ErrorAction SilentlyContinue) {
    if (-not (Test-Path (Join-Path $PSScriptRoot "node_modules\express"))) { Write-Host "Installing the Twi voice service..."; & npm ci --no-audit --no-fund | Out-Null }
    Stop-Port 3001
    Start-Process node -ArgumentList "server/server.js" -WorkingDirectory $PSScriptRoot -WindowStyle Minimized
    Write-Host "  Twi voice service started on port 3001." -ForegroundColor Green
} else { Write-Host "  Node.js not found: Twi voice is off (English works)." -ForegroundColor Yellow }

# 4. Serve
if ($Http) {
    $url = "http://localhost:8000/app/"
    $env:SENTINEL_TABLET_URL = "(tablet needs HTTPS: run without -Http)"
    Write-Host ""
    Write-Host "  Sentinel (laptop only): $url" -ForegroundColor Cyan
    if (-not $NoBrowser) { Start-Job -ScriptBlock { param($u) Start-Sleep 3; Start-Process $u } -ArgumentList $url | Out-Null }
    & $py -m uvicorn server:app --host 127.0.0.1 --port 8000
    exit $LASTEXITCODE
}

$certOut = & $py tools\make_cert.py
$ip = ($certOut | Select-Object -Last 1).Trim()
$tablet = "https://${ip}:8443/app/"
$env:SENTINEL_TABLET_URL = $tablet
Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host "    LAPTOP:  https://localhost:8443/app/" -ForegroundColor Cyan
Write-Host "    TABLET:  $tablet" -ForegroundColor Green
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host "  Tablet: same network (phone hotspot is safest), open the TABLET URL in Chrome,"
Write-Host "  tap Advanced > Proceed on the certificate warning, then tap Start Sentinel."
Write-Host "  First run: allow Python through Windows Firewall (Private networks)."
Write-Host ""
if (-not $NoBrowser) {
    $chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LocalAppData\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
    Start-Job -ScriptBlock { param($c) Start-Sleep 3; if ($c) { Start-Process $c "https://localhost:8443/app/" } else { Start-Process "https://localhost:8443/app/" } } -ArgumentList $chrome | Out-Null
}
& $py -m uvicorn server:app --host 0.0.0.0 --port 8443 --ssl-keyfile certs\key.pem --ssl-certfile certs\cert.pem
