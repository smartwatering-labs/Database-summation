param(
    [string]$PythonPath,
    [switch]$InstallDependencies,
    [switch]$SetupOnly
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$candidates = @()
if ($PythonPath) {
    $candidates += @{ Command = $PythonPath; Arguments = @() }
} else {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        $candidates += @{ Command = 'py'; Arguments = @('-3') }
    }
    foreach ($name in @('python', 'python3')) {
        if (Get-Command $name -ErrorAction SilentlyContinue) {
            $candidates += @{ Command = $name; Arguments = @() }
        }
    }
}

$selectedPython = $null
foreach ($candidate in $candidates) {
    $command = $candidate.Command
    $arguments = $candidate.Arguments
    try {
        $detected = & $command @arguments -c "import sys; p=sys.base_prefix.lower(); sys.exit(1) if sys.version_info < (3,10) or 'codex-runtimes' in p else print(sys.executable)" 2>$null
        if ($LASTEXITCODE -eq 0 -and $detected) {
            $selectedPython = ([string]$detected).Trim()
            break
        }
    } catch { continue }
}
if (-not $selectedPython) {
    throw 'Install Python 3.10+ from https://www.python.org/downloads/windows/ and reopen your terminal, or pass -PythonPath C:\path\to\python.exe. A Codex runtime is not supported.'
}
Write-Host "Python: $selectedPython"

if ($InstallDependencies) {
    & $selectedPython -m pip install -r (Join-Path $PSScriptRoot 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
& $selectedPython -c "import flask, waitress"
if ($LASTEXITCODE -ne 0) {
    throw 'Dependencies missing. Run: .\start.ps1 -InstallDependencies'
}
if ($SetupOnly) { return }
& $selectedPython (Join-Path $PSScriptRoot 'app.py')
exit $LASTEXITCODE
