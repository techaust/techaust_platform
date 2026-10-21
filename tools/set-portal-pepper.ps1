# Sets the staging secret PORTAL_KEY_PEPPER on techaust-platform-portal-staging (M1.6).
# The value is 32 random bytes made here and sent straight to Cloudflare: it is never shown, saved or copied.
# Uses your own `wrangler login`. Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File "D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\WEBSITE\techaust_platform\tools\set-portal-pepper.ps1"
$ErrorActionPreference = "Stop"
$portal = Join-Path $PSScriptRoot "..\apps\portal"
$wrangler = Join-Path $portal "node_modules\wrangler\bin\wrangler.js"
if (-not (Test-Path $wrangler)) { throw "wrangler not found in apps\portal; run pnpm install first." }

$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$value = [Convert]::ToBase64String($bytes)

Push-Location $portal
try {
  # Send the value on stdin with no trailing newline.
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "node"
  $psi.Arguments = "`"$wrangler`" secret put PORTAL_KEY_PEPPER --env staging"
  $psi.WorkingDirectory = $portal
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $p.StandardInput.Write($value)
  $p.StandardInput.Close()
  $out = $p.StandardOutput.ReadToEnd() + $p.StandardError.ReadToEnd()
  $p.WaitForExit()
} finally {
  Pop-Location
  $value = $null
  [Array]::Clear($bytes, 0, $bytes.Length)
}

if ($p.ExitCode -eq 0 -and $out -match "Success") {
  Write-Host "RESULT: PORTAL_KEY_PEPPER set on techaust-platform-portal-staging"
} else {
  Write-Host "RESULT: FAILED (exit $($p.ExitCode)). Wrangler said:"
  Write-Host ($out -replace "[A-Za-z0-9+/]{43}=", "<hidden>")
}
