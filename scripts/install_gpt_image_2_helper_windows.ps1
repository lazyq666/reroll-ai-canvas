param(
    [ValidateSet("install", "check", "force")]
    [string]$Mode = "install"
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$HelperVersion = "0.7.3"
$InstallerSha256 = "c4dcc265c19a8734eb78174283e8715754f2fab78fca91d0a3bb893401f689af"
$InstallerUrl = "https://github.com/Wangnov/gpt-image-2-skill/releases/download/v$HelperVersion/gpt-image-2-skill-installer.ps1"

function Write-Failure {
    param([Parameter(Mandatory = $true)][string]$Message)
    [Console]::Error.WriteLine("[ERROR] $Message")
}

function Find-Helper {
    $command = Get-Command "gpt-image-2-skill" -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        if ($command.PSObject.Properties.Name -contains "Path" -and $command.Path) {
            return $command.Path
        }
        if ($command.PSObject.Properties.Name -contains "Source" -and $command.Source) {
            return $command.Source
        }
    }

    $cargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $HOME ".cargo" }
    $candidates = @(
        (Join-Path $cargoHome "bin\gpt-image-2-skill.exe"),
        (Join-Path $env:APPDATA "npm\gpt-image-2-skill.cmd")
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return $candidate
        }
    }
    return $null
}

function Test-Helper {
    param([Parameter(Mandatory = $true)][string]$HelperPath)

    Write-Host ""
    Write-Host "[VERIFY] Executable: $HelperPath"

    try {
        $authText = (& $HelperPath --json auth inspect 2>&1 | Out-String)
        if ($LASTEXITCODE -ne 0) {
            Write-Failure "The helper could not run 'auth inspect'."
            return $false
        }
        $auth = $authText | ConvertFrom-Json
    } catch {
        Write-Failure "The helper returned invalid authentication diagnostics: $($_.Exception.Message)"
        return $false
    }

    $doctor = $null
    try {
        $doctorText = (& $HelperPath --json doctor 2>&1 | Out-String)
        $doctor = $doctorText | ConvertFrom-Json
    } catch {
        Write-Warning "Installation succeeded, but doctor could not complete: $($_.Exception.Message)"
    }

    $reportedVersion = $HelperVersion
    if ($null -ne $doctor -and $doctor.PSObject.Properties.Name -contains "version" -and $doctor.version) {
        $reportedVersion = [string]$doctor.version
    }
    Write-Host "[DONE] gpt-image-2-skill $reportedVersion is installed."

    $credentialReady = $false
    if ($auth.providers.codex.ready -or $auth.providers.openai.ready) {
        $credentialReady = $true
    }
    if ($credentialReady) {
        Write-Host "[AUTH] A usable Codex login or OpenAI API credential was found."
    } else {
        Write-Warning "The helper is installed, but no usable credential was found. Run 'codex login' or configure OPENAI_API_KEY locally."
    }

    if ($null -ne $doctor -and $doctor.ok) {
        Write-Host "[NETWORK] Doctor passed and the service endpoint is reachable."
    } else {
        Write-Warning "Installation succeeded, but doctor did not fully pass. Check the network, proxy, or login state."
    }
    Write-Host "[NEXT] Refresh the Codex connection in Reroll. Restart the service if it still shows the old status."
    return $true
}

if ($env:OS -ne "Windows_NT") {
    Write-Failure "This installer only supports Windows."
    exit 1
}

$existingHelper = Find-Helper
if ($Mode -eq "check") {
    if (-not $existingHelper) {
        Write-Failure "gpt-image-2-skill was not found."
        exit 1
    }
    if (Test-Helper -HelperPath $existingHelper) { exit 0 }
    exit 1
}

if ($existingHelper -and $Mode -ne "force") {
    Write-Host "[EXISTING] GPT Image 2 helper was found; skipping duplicate installation."
    if (Test-Helper -HelperPath $existingHelper) { exit 0 }
    exit 1
}

$installerFile = Join-Path ([IO.Path]::GetTempPath()) ("gpt-image-2-skill-installer-" + [guid]::NewGuid().ToString("N") + ".ps1")
try {
    Write-Host "[DOWNLOAD] Fetching gpt-image-2-skill $HelperVersion..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $InstallerUrl -OutFile $installerFile

    $actualSha256 = (Get-FileHash -LiteralPath $installerFile -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha256 -ne $InstallerSha256) {
        throw "Installer SHA-256 verification failed; execution was refused."
    }
    Write-Host "[SECURITY] Installer SHA-256 verification passed."

    $powerShellExe = (Get-Process -Id $PID).Path
    & $powerShellExe -NoProfile -ExecutionPolicy Bypass -File $installerFile
    if ($LASTEXITCODE -ne 0) {
        throw "The upstream installer exited with code $LASTEXITCODE."
    }
} catch {
    Write-Failure "gpt-image-2-skill installation failed: $($_.Exception.Message)"
    exit 1
} finally {
    Remove-Item -LiteralPath $installerFile -Force -ErrorAction SilentlyContinue
}

$cargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $HOME ".cargo" }
$cargoBin = Join-Path $cargoHome "bin"
if (-not (($env:Path -split ";") -contains $cargoBin)) {
    $env:Path = "$cargoBin;$env:Path"
}

$installedHelper = Find-Helper
if (-not $installedHelper) {
    Write-Failure "The installer finished, but gpt-image-2-skill.exe was not found."
    exit 1
}
if (Test-Helper -HelperPath $installedHelper) { exit 0 }
exit 1
