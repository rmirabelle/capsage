<#
.SYNOPSIS
  Set the CapSage version everywhere it is declared.

.EXAMPLE
  .\set-version.ps1 0.2.0
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidatePattern('^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')]
  [string] $Version
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> Setting CapSage version to $Version ..." -ForegroundColor Cyan
npm version $Version --no-git-tag-version --allow-same-version
if ($LASTEXITCODE -ne 0) { throw "npm version failed" }

$cargoPath = "src-tauri/Cargo.toml"
$cargo = Get-Content $cargoPath -Raw
$cargo = [regex]::Replace($cargo, '(?m)^(version\s*=\s*)"[^"]+"', "`$1`"$Version`"", 1)
Set-Content -Path $cargoPath -Value $cargo -NoNewline

$tauriPath = "src-tauri/tauri.conf.json"
$tauri = Get-Content $tauriPath -Raw
$tauri = [regex]::Replace($tauri, '(?m)("version"\s*:\s*)"[^"]+"', "`$1`"$Version`"", 1)
Set-Content -Path $tauriPath -Value $tauri -NoNewline

cargo check --manifest-path src-tauri/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw "cargo check failed" }

Write-Host "==> Version synchronized. Review and commit the changed files before publishing." -ForegroundColor Green
