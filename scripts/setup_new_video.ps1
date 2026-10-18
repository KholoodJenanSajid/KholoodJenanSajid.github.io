# Regenerate WebP frames after replacing the character video.
# Run from repo root in PowerShell:
#   .\scripts\setup_new_video.ps1

$root = Split-Path -Parent $PSScriptRoot
$src  = Join-Path $root "Woman_tracking_with_eye_movement_20261018112246.mp4"
$dest = Join-Path $root "public\character.mp4"

if (-not (Test-Path -LiteralPath $src)) {
  Write-Error "Source video not found: $src"
  exit 1
}

Copy-Item -LiteralPath $src -Destination $dest -Force
Write-Host "Copied video -> public\character.mp4"

Set-Location $root
python scripts\extract_frames.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Done. Bump meta frame-ver in index.html and hard-refresh the site."
