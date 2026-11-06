# M7.5 L26 (analyst R finding 5: the Part 8 B script was lost in the 2026-11-03 format): stores the SES sending keys as the secrets SES_ACCESS_KEY_ID and
# SES_SECRET_ACCESS_KEY on techaust-platform-jobs-staging (apps/jobs/wrangler.jsonc, --env staging), the only Worker that sends email
# (docs/runbooks/ses-and-turnstile.md; a key rotation, docs/runbooks/incident.md).
# Both values are typed or pasted into HIDDEN prompts, copied from the AWS console's "Create access key" page for the SES sending user. They are never
# shown, saved, logged or copied: each goes straight to Cloudflare on `wrangler secret put`'s standard input. Only one line comes back: "RESULT: ...".
# Uses your own `wrangler login`. Both are checked before either is stored, so a wrong paste stores nothing.
#
# The lead gives you the exact line, for example:
#   powershell -ExecutionPolicy Bypass -File "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\scripts\set-ses-keys.ps1"
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$wrangler = Join-Path $root "apps\jobs\node_modules\wrangler\bin\wrangler.js"
$config = "apps\jobs\wrangler.jsonc"
$worker = "techaust-platform-jobs-staging"
if (-not (Test-Path $wrangler)) { Write-Host "RESULT: FAILED: wrangler not found in apps\jobs; run pnpm install first. Nothing was stored."; exit 1 }
if (-not (Test-Path (Join-Path $root $config))) { Write-Host "RESULT: FAILED: no such config $config. Nothing was stored."; exit 1 }

function Read-Hidden([string]$prompt) {
  $secure = Read-Host -Prompt $prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

$values = [ordered]@{}
$values["SES_ACCESS_KEY_ID"] = Read-Hidden "Paste the SES access key ID (hidden), then press Enter"
$values["SES_SECRET_ACCESS_KEY"] = Read-Hidden "Paste the SES secret access key (hidden), then press Enter"
# An AWS access key ID is AKIA + 16 capitals or digits; its secret is 40 characters of letters, digits, "/" and "+".
if ($values["SES_ACCESS_KEY_ID"] -cnotmatch '^AKIA[A-Z0-9]{16}$') {
  $values = $null
  Write-Host "RESULT: FAILED: the access key ID does not look like one (AKIA and 16 capitals or digits). Nothing was stored."
  exit 1
}
if ($values["SES_SECRET_ACCESS_KEY"] -cnotmatch '^[A-Za-z0-9/+]{40}$') {
  $values = $null
  Write-Host "RESULT: FAILED: the secret access key does not look like one (40 letters, digits, / or +). Nothing was stored."
  exit 1
}

# A BOM-free encoding for the wrangler runs (restored at the end): a byte-order mark would reach Cloudflare before each value.
$prevEncoding = [Console]::InputEncoding
try { [Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
if ([Console]::InputEncoding.GetPreamble().Length -ne 0) {
  $values = $null
  try { [Console]::InputEncoding = $prevEncoding } catch { }
  Write-Host "RESULT: FAILED: this PowerShell window would add a byte-order mark to the keys. Nothing was stored. Tell the lead."
  exit 1
}
$stored = @()
try {
  foreach ($name in $values.Keys) {
    $value = $values[$name]
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "node"
    $psi.Arguments = "`"$wrangler`" secret put $name --config `"$config`" --env staging"
    $psi.WorkingDirectory = $root
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $outTask = $p.StandardOutput.ReadToEndAsync()
    $errTask = $p.StandardError.ReadToEndAsync()
    $p.StandardInput.Write($value)
    $p.StandardInput.Close()
    $p.WaitForExit()
    $out = $outTask.Result + $errTask.Result
    if ($p.ExitCode -ne 0 -or $out -notmatch "Success") {
      $said = $out
      foreach ($v in $values.Values) { if ($v) { $said = $said.Replace($v, "<hidden>") } }
      $said = ($said -replace "\s+", " ").Trim()
      if ($said.Length -gt 400) { $said = $said.Substring(0, 400) + " ..." }
      Write-Host "RESULT: FAILED storing $name on $worker (exit $($p.ExitCode)); stored before it: $($stored -join ', '). Tell the lead before running again. Wrangler said: $said"
      exit 1
    }
    $stored += $name
  }
} finally {
  $values = $null
  $value = $null
  try { [Console]::InputEncoding = $prevEncoding } catch { }
}
Write-Host "RESULT: $($stored -join ' and ') stored on $worker; nothing to paste anywhere"
