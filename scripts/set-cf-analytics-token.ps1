# M7.5 D1 (owner's Q4 A; run file docs/runs/m7.5-hardening.md, B2 report): stores the read-only Cloudflare analytics token as the secret CF_ANALYTICS_TOKEN
# on techaust-platform-jobs-staging (apps/jobs/wrangler.jsonc, --env staging), for the daily Free-plan usage job (`usage.daily`).
# First create the token in the Cloudflare dashboard (the lead gives the clicks): permission "Account > Account Analytics > Read" on the TecHaust account
# only, nothing else. Copy it from the page that shows it once.
# The token is typed or pasted into a HIDDEN prompt. It is never shown, saved, logged or copied: it goes straight to Cloudflare on `wrangler secret put`'s
# standard input. Only one line comes back: "RESULT: ...". Uses your own `wrangler login`.
#
# The lead gives you the exact line, for example:
#   powershell -ExecutionPolicy Bypass -File "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\scripts\set-cf-analytics-token.ps1"
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$wrangler = Join-Path $root "apps\jobs\node_modules\wrangler\bin\wrangler.js"
$config = "apps\jobs\wrangler.jsonc"
$worker = "techaust-platform-jobs-staging"
if (-not (Test-Path $wrangler)) { Write-Host "RESULT: FAILED: wrangler not found in apps\jobs; run pnpm install first. Nothing was stored."; exit 1 }
if (-not (Test-Path (Join-Path $root $config))) { Write-Host "RESULT: FAILED: no such config $config. Nothing was stored."; exit 1 }

$secure = Read-Host -Prompt "Paste the Cloudflare analytics token (hidden), then press Enter" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
# A Cloudflare API token is letters, digits, "-" and "_". The ones seen so far are 40 characters, but Cloudflare fixes no length and newer token formats
# are longer, so 40 to 200 are accepted (review 1, L53: the old exact 40 could refuse a real token). Spaces, quotes or a line break mean a wrong paste.
# This range was written before the owner's real token existed: the RESULT line says the format check passed, so the first real run confirms it.
if ($value -notmatch '^[A-Za-z0-9_-]{40,200}$') {
  $value = $null
  Write-Host "RESULT: FAILED: that does not look like a Cloudflare API token (40 to 200 letters, digits, - or _). Nothing was stored. If you pasted the whole token, tell the lead."
  exit 1
}

# Windows PowerShell may write a child's standard input as UTF-8 WITH a byte-order mark; the 3 BOM bytes would reach wrangler before the token. A BOM-free
# encoding for the run (restored at the end); if the window refuses it, nothing is stored.
$prevEncoding = [Console]::InputEncoding
try { [Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
if ([Console]::InputEncoding.GetPreamble().Length -ne 0) {
  $value = $null
  try { [Console]::InputEncoding = $prevEncoding } catch { }
  Write-Host "RESULT: FAILED: this PowerShell window would add a byte-order mark to the token. Nothing was stored. Tell the lead."
  exit 1
}
try {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "node"
  $psi.Arguments = "`"$wrangler`" secret put CF_ANALYTICS_TOKEN --config `"$config`" --env staging"
  $psi.WorkingDirectory = $root
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  # Both streams read at once from the start, so neither pipe can fill and stall the other.
  $outTask = $p.StandardOutput.ReadToEndAsync()
  $errTask = $p.StandardError.ReadToEndAsync()
  $p.StandardInput.Write($value)
  $p.StandardInput.Close()
  $p.WaitForExit()
  $out = $outTask.Result + $errTask.Result
  if ($p.ExitCode -ne 0 -or $out -notmatch "Success") {
    $said = (($out.Replace($value, "<hidden>")) -replace "\s+", " ").Trim()
    if ($said.Length -gt 400) { $said = $said.Substring(0, 400) + " ..." }
    Write-Host "RESULT: FAILED at $worker (exit $($p.ExitCode)). Tell the lead before running again. Wrangler said: $said"
    exit 1
  }
} finally {
  $value = $null
  try { [Console]::InputEncoding = $prevEncoding } catch { }
}
Write-Host "RESULT: CF_ANALYTICS_TOKEN stored on $worker (the token passed the format check); nothing to paste anywhere"
