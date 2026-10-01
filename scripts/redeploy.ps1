# scripts/redeploy.ps1
# Trigger a fresh deploy on Render and verify /api/dashboard is healthy.
# Usage: .\scripts\redeploy.ps1 -ServiceId svc-xxxxxxxx [-VerifyUrl <url>]
param(
  [Parameter(Mandatory = $true)][string]$ServiceId,
  [string]$VerifyUrl = 'https://executive-dashboard-qbr-2.onrender.com/api/dashboard'
)

if (-not (Get-Command render -ErrorAction SilentlyContinue)) {
  Write-Error "Render CLI not found. Install with: winget install --id Render.cli"
  exit 1
}

Write-Host "Triggering deploy for $ServiceId ..." -ForegroundColor Cyan
render deploys create $ServiceId --wait
if ($LASTEXITCODE -ne 0) { Write-Error "Deploy failed."; exit 1 }

Write-Host "Verifying $VerifyUrl ..." -ForegroundColor Cyan
try {
  $resp = Invoke-RestMethod -Uri $VerifyUrl -TimeoutSec 30
  $exec = $resp.executiveSummary
  "totalIncidents : $($exec.totalIncidents)"
  "totalDevices   : $($exec.totalDevices)"
  "jflSwitchUptime: $($exec.jflSwitchUptime)"
  "reportingPeriod: $($exec.reportingPeriod)"
} catch {
  Write-Error "Verification request failed: $_"
  exit 1
}

Write-Host "Done." -ForegroundColor Green
