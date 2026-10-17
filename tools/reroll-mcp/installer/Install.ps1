$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Host @@START@@
try {
    $agentRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Reroll\agent'
    $env:UV_UNMANAGED_INSTALL = Join-Path $agentRoot 'uv'
    $env:UV_PYTHON_INSTALL_DIR = Join-Path $agentRoot 'python'
    $env:UV_CACHE_DIR = Join-Path $agentRoot 'cache'
    $env:UV_NO_MODIFY_PATH = '1'
    New-Item -ItemType Directory -Force -Path $agentRoot | Out-Null
    $agentUv = Join-Path $env:UV_UNMANAGED_INSTALL 'uv.exe'
    if (!(Test-Path -LiteralPath $agentUv)) {
        $agentDownload = Join-Path $agentRoot ([Guid]::NewGuid().ToString() + '.ps1')
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -UseBasicParsing -Uri 'https://astral.sh/uv/0.11.32/install.ps1' -OutFile $agentDownload
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $agentDownload
            if ($LASTEXITCODE -ne 0) { throw 'uv' }
        } finally { Remove-Item -LiteralPath $agentDownload -ErrorAction SilentlyContinue }
    }
    & $agentUv run --no-project --isolated --managed-python --python 3.12 --with tomlkit==0.13.3 install.py --root $agentRoot --uv $agentUv
    if ($LASTEXITCODE -ne 0) { throw 'install' }
} catch {
    Write-Host @@FAIL@@
    Read-Host @@CLOSE@@
    exit 1
}
Read-Host @@CLOSE@@
