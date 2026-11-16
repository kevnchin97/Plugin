# Installs Pulse FX into DaVinci Resolve's user template folder.
#
#   install.bat             install the bundle (dist\PulseFX.drfx)
#   install.bat loose       install the same templates as loose files (for debugging)
#   install.bat uninstall   remove both
#
# Quit Resolve first: it only reads the template folder when it starts.

param(
    [ValidateSet('bundle', 'loose', 'uninstall')]
    [string]$Mode = 'bundle'
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$templates = Join-Path $env:APPDATA 'Blackmagic Design\DaVinci Resolve\Support\Fusion\Templates'
$bundleSource = Join-Path $here 'dist\PulseFX.drfx'
$looseSource = Join-Path $here 'dist\loose\Edit'
$bundleTarget = Join-Path $templates 'PulseFX.drfx'
$looseTargets = @(
    'Edit\Effects\Pulse FX',
    'Edit\Effects\Pulse FX Cuts',
    'Edit\Transitions\Pulse FX'
) | ForEach-Object { Join-Path $templates $_ }

if (Get-Process -Name 'Resolve' -ErrorAction SilentlyContinue) {
    Write-Warning 'DaVinci Resolve is running. Quit and restart it afterwards or the pack will not appear.'
}

# Remove any earlier install first, so the bundle and loose copies never both show up.
if (Test-Path -LiteralPath $bundleTarget) {
    Remove-Item -LiteralPath $bundleTarget -Force
    Write-Host "Removed $bundleTarget"
}
foreach ($folder in $looseTargets) {
    if (Test-Path -LiteralPath $folder) {
        Remove-Item -LiteralPath $folder -Recurse -Force
        Write-Host "Removed $folder"
    }
}

if ($Mode -eq 'uninstall') {
    Write-Host 'Pulse FX uninstalled.'
    exit 0
}

New-Item -ItemType Directory -Path $templates -Force | Out-Null

if ($Mode -eq 'bundle') {
    if (-not (Test-Path -LiteralPath $bundleSource)) {
        throw "Cannot find $bundleSource. Run 'python build.py' first."
    }
    Copy-Item -LiteralPath $bundleSource -Destination $bundleTarget -Force
    Write-Host "Installed bundle: $bundleTarget"
}
else {
    if (-not (Test-Path -LiteralPath $looseSource)) {
        throw "Cannot find $looseSource. Run 'python build.py' first."
    }
    $editTarget = Join-Path $templates 'Edit'
    New-Item -ItemType Directory -Path $editTarget -Force | Out-Null
    Copy-Item -Path (Join-Path $looseSource '*') -Destination $editTarget -Recurse -Force
    Write-Host "Installed loose templates under: $editTarget"
}

Write-Host ''
Write-Host 'Start DaVinci Resolve, open the Edit page and look in the Effects Library:'
Write-Host '  Toolbox > Effects > Fusion Effects > Pulse FX and Pulse FX Cuts'
Write-Host '  Toolbox > Video Transitions > Fusion Transitions > Pulse FX'
