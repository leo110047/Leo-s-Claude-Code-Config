$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Get-Command node -CommandType Application | Select-Object -First 1
if (-not $node) {
    throw "node is required to run install.ps1"
}

& $node.Source (Join-Path $scriptDir "scripts/goldband-windows.mjs") install --platform win32 @args
