# Packaging script for Quiz AI extension.
# Creates:
# - dist\chrome-unpacked
# - dist\firefox-unpacked
# - dist\quiz-ai-chrome.zip
# - dist\quiz-ai-firefox.zip
# - dist\quiz-ai-firefox.xpi   (copy of the Firefox zip; signing is a STUB for now)

$ErrorActionPreference = 'Stop'

function Copy-BuildFiles {
  param(
    [Parameter(Mandatory = $true)][string]$SourceDir,
    [Parameter(Mandatory = $true)][string]$ManifestPath,
    [Parameter(Mandatory = $true)][string]$TargetDir
  )

  if (Test-Path $TargetDir) {
    Remove-Item -Recurse -Force $TargetDir
  }

  New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
  Get-ChildItem -Path $SourceDir | ForEach-Object {
    Copy-Item -Recurse -Force $_.FullName $TargetDir
  }
  Copy-Item -Force $ManifestPath (Join-Path $TargetDir 'manifest.json')
}

function Remove-AuthFile {
  param(
    [Parameter(Mandatory = $true)][string]$TargetDir
  )

  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $TargetDir 'auth.json')
}

function Restore-LocalAuthFile {
  param(
    [Parameter(Mandatory = $true)][string]$SourceDir,
    [Parameter(Mandatory = $true)][string]$TargetDir
  )

  $authPath = Join-Path $SourceDir 'auth.json'
  if (Test-Path $authPath) {
    Copy-Item -Force $authPath (Join-Path $TargetDir 'auth.json')
  }
}

function New-ZipArchive {
  # Compress-Archive in Windows PowerShell 5.1 writes backslashes in entry names (bg\models.js).
  # Browsers then read them as file names instead of folders, so the extension installs but does not run.
  # This builds the zip with forward slashes (bg/models.js) instead.
  param(
    [Parameter(Mandatory = $true)][string]$SourceDir,
    [Parameter(Mandatory = $true)][string]$ZipPath
  )

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem

  if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
  $root = (Resolve-Path $SourceDir).Path.TrimEnd('\', '/')
  $zip = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    Get-ChildItem -Path $root -Recurse -File -Force | ForEach-Object {
      $entryName = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
      [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    }
  }
  finally {
    $zip.Dispose()
  }
}

function Invoke-FirefoxSign {
  # STUB: real signing is not wired up yet.
  # For now it only copies the Firefox zip next to itself as .xpi (UNSIGNED).
  # Later replace the body with a real signing call, for example:
  #   web-ext sign --source-dir $UnpackedDir --artifacts-dir (Split-Path $XpiPath) --channel unlisted --api-key $env:AMO_JWT_ISSUER --api-secret $env:AMO_JWT_SECRET
  # and then copy/rename the signed .xpi that web-ext writes to $XpiPath.
  param(
    [Parameter(Mandatory = $true)][string]$UnpackedDir,
    [Parameter(Mandatory = $true)][string]$ZipPath,
    [Parameter(Mandatory = $true)][string]$XpiPath
  )

  Write-Host 'Signing Firefox build: STUB (not signed, copying zip -> xpi)' -ForegroundColor Yellow
  Copy-Item -Force $ZipPath $XpiPath
}

try {
  $projectDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
  $srcDir = Join-Path $projectDir 'src'
  $distDir = Join-Path $projectDir 'dist'
  $chromeManifest = Join-Path $projectDir 'manifests\chrome\manifest.json'
  $firefoxManifest = Join-Path $projectDir 'manifests\firefox\manifest.json'
  $chromeUnpacked = Join-Path $distDir 'chrome-unpacked'
  $firefoxUnpacked = Join-Path $distDir 'firefox-unpacked'
  $chromeZip = Join-Path $distDir 'quiz-ai-chrome.zip'
  $firefoxZip = Join-Path $distDir 'quiz-ai-firefox.zip'
  $firefoxXpi = Join-Path $distDir 'quiz-ai-firefox.xpi'

  if (-not (Test-Path $srcDir)) { throw "Missing source folder: $srcDir" }
  if (-not (Test-Path $chromeManifest)) { throw "Missing Chrome manifest: $chromeManifest" }
  if (-not (Test-Path $firefoxManifest)) { throw "Missing Firefox manifest: $firefoxManifest" }

  New-Item -ItemType Directory -Force -Path $distDir | Out-Null
  Remove-Item -Force -ErrorAction SilentlyContinue $chromeZip, $firefoxZip, $firefoxXpi

  Write-Host 'Preparing unpacked Chrome extension...'
  Copy-BuildFiles -SourceDir $srcDir -ManifestPath $chromeManifest -TargetDir $chromeUnpacked

  Write-Host 'Preparing unpacked Firefox extension...'
  Copy-BuildFiles -SourceDir $srcDir -ManifestPath $firefoxManifest -TargetDir $firefoxUnpacked

  Write-Host "Creating $chromeZip (with auth.json)"
  New-ZipArchive -SourceDir $chromeUnpacked -ZipPath $chromeZip

  Write-Host "Creating $firefoxZip (with auth.json)"
  New-ZipArchive -SourceDir $firefoxUnpacked -ZipPath $firefoxZip

  Write-Host "Creating $firefoxXpi"
  Invoke-FirefoxSign -UnpackedDir $firefoxUnpacked -ZipPath $firefoxZip -XpiPath $firefoxXpi

  Write-Host 'Packaging complete.' -ForegroundColor Green
  Write-Host "Chrome folder:  $chromeUnpacked"
  Write-Host "Firefox folder: $firefoxUnpacked"
  Write-Host "Chrome zip:     $chromeZip"
  Write-Host "Firefox zip:    $firefoxZip"
  Write-Host "Firefox xpi:    $firefoxXpi (unsigned stub)"
  exit 0
}
catch {
  Write-Host "Packaging failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 2
}
