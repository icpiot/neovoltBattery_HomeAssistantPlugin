param(
    [Parameter(Mandatory = $true)]
    [string]$Destination
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repoRoot "frontend\bytewatt-card"

if (-not (Test-Path -LiteralPath $source)) {
    throw "Frontend package source not found: $source"
}

if (-not (Test-Path -LiteralPath $Destination)) {
    New-Item -ItemType Directory -Path $Destination | Out-Null
}

$files = @(
    "bytewatt-card-suite.js",
    "bytewatt-policy-card.js",
    "bytewatt-report-card.js",
    "README.md",
    "hacs.json",
    "VERSION.txt",
    "SPLIT_CHECKLIST.md"
)

foreach ($file in $files) {
    $src = Join-Path $source $file
    $dst = Join-Path $Destination $file
    if (-not (Test-Path -LiteralPath $src)) {
        throw "Missing required frontend package file: $src"
    }
    Copy-Item -LiteralPath $src -Destination $dst -Force
}

Write-Host "Exported frontend package to $Destination"
