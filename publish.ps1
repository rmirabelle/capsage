<#
.SYNOPSIS
  Build and publish a versioned CapSage release to GitHub.

.DESCRIPTION
  Validates the synchronized version and clean Git state, builds the NSIS
  installer, pushes the current commit and version tag, then creates a public
  GitHub release containing the installer consumed by CapSage's updater.
  After the new release is confirmed live, all older releases and their tags
  are deleted; CapSage intentionally retains only the current binary release.

  Run .\set-version.ps1 VERSION and commit those changes before this script.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Read-Version {
  param([string] $Path, [string] $Pattern)
  $match = [regex]::Match((Get-Content $Path -Raw), $Pattern)
  if (-not $match.Success) { throw "Could not read version from $Path" }
  return $match.Groups[1].Value
}

$cargoVersion = Read-Version "src-tauri/Cargo.toml" '(?m)^version\s*=\s*"([^"]+)"'
$packageVersion = Read-Version "package.json" '(?m)"version"\s*:\s*"([^"]+)"'
$tauriVersion = Read-Version "src-tauri/tauri.conf.json" '(?m)"version"\s*:\s*"([^"]+)"'
if ($cargoVersion -ne $packageVersion -or $cargoVersion -ne $tauriVersion) {
  throw "Version mismatch: Cargo=$cargoVersion, package=$packageVersion, Tauri=$tauriVersion. Run .\set-version.ps1 VERSION."
}

$version = $cargoVersion
$tag = "v$version"
$assetName = "CapSage_${version}_x64-setup.exe"
$assetPath = "dist/$assetName"

git rev-parse --is-inside-work-tree 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw "CapSage is not a Git repository." }
if (git status --porcelain) { throw "The working tree must be clean before publishing." }

$origin = git remote get-url origin
if ($LASTEXITCODE -ne 0 -or $origin -notmatch 'github\.com[/:]rmirabelle/capsage(?:\.git)?$') {
  throw "The origin remote must be the public rmirabelle/capsage GitHub repository."
}

gh auth status | Out-Null
if ($LASTEXITCODE -ne 0) { throw "GitHub CLI is not authenticated. Run: gh auth login -h github.com" }

gh release view $tag *> $null
if ($LASTEXITCODE -eq 0) { throw "Release $tag already exists." }

Write-Host "==> Building CapSage $tag ..." -ForegroundColor Cyan
npm run tauri build
if ($LASTEXITCODE -ne 0) { throw "Tauri build failed" }

$bundleDir = "src-tauri/target/release/bundle/nsis"
$installer = Get-ChildItem $bundleDir -Filter "*_${version}_x64-setup.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $installer) { throw "Expected NSIS installer not found in $bundleDir for version $version" }
New-Item -ItemType Directory -Force -Path "dist" | Out-Null
Copy-Item $installer.FullName $assetPath -Force

Write-Host "==> Pushing source and tag $tag ..." -ForegroundColor Cyan
git push origin HEAD
if ($LASTEXITCODE -ne 0) { throw "Could not push the release commit" }
git tag -a $tag -m "CapSage $tag"
if ($LASTEXITCODE -ne 0) { throw "Could not create tag $tag" }
git push origin $tag
if ($LASTEXITCODE -ne 0) { throw "Could not push tag $tag" }

Write-Host "==> Publishing GitHub release $tag ..." -ForegroundColor Cyan
gh release create $tag $assetPath --verify-tag --title "CapSage $tag" --generate-notes
if ($LASTEXITCODE -ne 0) { throw "Could not create GitHub release $tag" }

Write-Host "==> Removing superseded releases ..." -ForegroundColor Cyan
$priorReleases = @(gh release list --limit 100 --json tagName -q '.[].tagName')
if ($LASTEXITCODE -ne 0) { throw "Could not list existing GitHub releases" }
foreach ($priorTag in $priorReleases) {
  if ($priorTag -and $priorTag -ne $tag) {
    Write-Host "    - deleting $priorTag"
    gh release delete $priorTag --yes --cleanup-tag
    if ($LASTEXITCODE -ne 0) { throw "Could not delete superseded release $priorTag" }
  }
}

Write-Host "==> Published https://github.com/rmirabelle/capsage/releases/tag/$tag" -ForegroundColor Green
