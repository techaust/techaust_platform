# M7.4 H1 (run file docs/runs/m7.4-data-protection.md F, L23; docs/runbooks/environments.md "ERASURE_HASH_KEY"): makes the key of the erased-address hash
# and stores the SAME value as the secret ERASURE_HASH_KEY on the two staging Workers that need it:
#   - techaust-platform-admin-api-staging (apps/admin/wrangler.api.jsonc, --env staging): the erase, anonymise, lead erase and "Allow emails again";
#   - techaust-platform-jobs-staging      (apps/jobs/wrangler.jsonc, --env staging):      the email consumer's erased stop, the purge and the hash fill.
# The value is 32 random bytes from the system's cryptographic generator, as 64 hex characters. It is never shown, saved, logged or copied: it goes straight to
# Cloudflare on `wrangler secret put`'s standard input. Only one line comes back: "RESULT: ...". Uses your own `wrangler login`.
#
# RUN IT ONCE. A new key makes every erasure stop already written useless (the stop is the keyed hash of the address under the OLD key): people erased before
# could be emailed again. If the key is ever lost or must change, stop and ask the lead first (runbook, "Losing or changing the key").
#
# The lead gives you the exact line, for example:
#   powershell -ExecutionPolicy Bypass -File "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\scripts\set-erasure-hash-key.ps1"
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$wrangler = Join-Path $root "apps\jobs\node_modules\wrangler\bin\wrangler.js"
if (-not (Test-Path $wrangler)) { Write-Host "RESULT: FAILED: wrangler not found in apps\jobs; run pnpm install first. Nothing was stored."; exit 1 }
$targets = @(
  @{ Config = "apps\admin\wrangler.api.jsonc"; Worker = "techaust-platform-admin-api-staging" },
  @{ Config = "apps\jobs\wrangler.jsonc"; Worker = "techaust-platform-jobs-staging" }
)
foreach ($t in $targets) {
  if (-not (Test-Path (Join-Path $root $t.Config))) { Write-Host "RESULT: FAILED: no such config $($t.Config). Nothing was stored."; exit 1 }
}

Write-Host "This makes ONE new erasure key and puts it on both staging Workers. Run it only once (a second run would replace the key)."
$answer = Read-Host -Prompt "Type YES to continue"
if ($answer -cne "YES") { Write-Host "RESULT: STOPPED: nothing was made or stored."; exit 1 }

$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$value = -join ($bytes | ForEach-Object { $_.ToString("x2") })
if ($value.Length -ne 64) { Write-Host "RESULT: FAILED: the key was not made. Nothing was stored."; exit 1 }

$stored = @()
# Early check 2 fix leg: Windows PowerShell writes a child's standard input in the console's input encoding, and when that is UTF-8 WITH a byte-order mark
# (seen on this PC) the 3 BOM bytes reach wrangler before the key, so Cloudflare would store a 67-byte value. A BOM-free UTF-8 encoding for the two
# `wrangler` runs (restored at the end); if the window refuses it, nothing is stored.
$prevEncoding = [Console]::InputEncoding
try { [Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
if ([Console]::InputEncoding.GetPreamble().Length -ne 0) {
  $value = $null
  [Array]::Clear($bytes, 0, $bytes.Length)
  try { [Console]::InputEncoding = $prevEncoding } catch { }
  Write-Host "RESULT: FAILED: this PowerShell window would add a byte-order mark to the key. Nothing was stored. Tell the lead."
  exit 1
}
try {
  foreach ($t in $targets) {
    # The value on stdin with no trailing newline; never on the command line.
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "node"
    $psi.Arguments = "`"$wrangler`" secret put ERASURE_HASH_KEY --config `"$($t.Config)`" --env staging"
    $psi.WorkingDirectory = $root
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    # Both streams are read at the same time, from the start (early check 2, low 10): reading one to its end while wrangler fills the other's pipe would
    # leave both waiting for ever.
    $outTask = $p.StandardOutput.ReadToEndAsync()
    $errTask = $p.StandardError.ReadToEndAsync()
    $p.StandardInput.Write($value)
    $p.StandardInput.Close()
    $p.WaitForExit()
    $out = $outTask.Result + $errTask.Result
    if ($p.ExitCode -ne 0 -or $out -notmatch "Success") {
      # One line only, the value hidden, wrangler's words folded in (shortened), so the RESULT line is the only thing to copy back.
      $said = (($out.Replace($value, "<hidden>")) -replace "\s+", " ").Trim()
      if ($said.Length -gt 400) { $said = $said.Substring(0, 400) + " ..." }
      Write-Host "RESULT: FAILED at $($t.Worker) (exit $($p.ExitCode)); stored before it: $($stored -join ', '). Tell the lead before running again. Wrangler said: $said"
      exit 1
    }
    $stored += $t.Worker
  }
} finally {
  $value = $null
  [Array]::Clear($bytes, 0, $bytes.Length)
  try { [Console]::InputEncoding = $prevEncoding } catch { }
}
Write-Host "RESULT: ERASURE_HASH_KEY made and stored on $($stored -join ' and ') (the same value on both); nothing to paste anywhere"
