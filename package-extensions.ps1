# Packaging script for Quiz AI extension.
# Creates:
# - dist\chrome-unpacked
# - dist\firefox-unpacked
# - dist\quiz-ai-chrome.zip
# - dist\quiz-ai-firefox.zip

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
  Copy-Item -Recurse -Force (Join-Path $SourceDir '*') $TargetDir
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

  if (-not (Test-Path $srcDir)) { throw "Missing source folder: $srcDir" }
  if (-not (Test-Path $chromeManifest)) { throw "Missing Chrome manifest: $chromeManifest" }
  if (-not (Test-Path $firefoxManifest)) { throw "Missing Firefox manifest: $firefoxManifest" }

  New-Item -ItemType Directory -Force -Path $distDir | Out-Null
  Remove-Item -Force -ErrorAction SilentlyContinue $chromeZip, $firefoxZip

  Write-Host 'Preparing unpacked Chrome extension...'
  Copy-BuildFiles -SourceDir $srcDir -ManifestPath $chromeManifest -TargetDir $chromeUnpacked

  Write-Host 'Preparing unpacked Firefox extension...'
  Copy-BuildFiles -SourceDir $srcDir -ManifestPath $firefoxManifest -TargetDir $firefoxUnpacked

  Write-Host "Creating $chromeZip"
  Compress-Archive -Force -Path (Join-Path $chromeUnpacked '*') -DestinationPath $chromeZip

  Write-Host "Creating $firefoxZip"
  Compress-Archive -Force -Path (Join-Path $firefoxUnpacked '*') -DestinationPath $firefoxZip

  Remove-AuthFile -TargetDir $chromeUnpacked
  Remove-AuthFile -TargetDir $firefoxUnpacked

  Write-Host 'Packaging complete.' -ForegroundColor Green
  Write-Host "Chrome folder:  $chromeUnpacked"
  Write-Host "Firefox folder: $firefoxUnpacked"
  Write-Host "Chrome zip:     $chromeZip"
  Write-Host "Firefox zip:    $firefoxZip"
  exit 0
}
catch {
  Write-Host "Packaging failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 2
}
