# Phase 7 (docs/runs/p7-launch.md, phase7-production.md B2): sets every PRODUCTION Worker secret in one run.
# - Random secrets are made here from the system's cryptographic generator and go straight to Cloudflare on `wrangler secret put`'s standard input:
#   the peppers and sign-in keys (32 bytes, base64, as scripts/dev-vars.mjs makes them locally), ERASURE_HASH_KEY (64 hex, the SAME value on the admin API and
#   jobs), SES_EVENTS_TOKEN and UNSUBSCRIBE_KEY (64 hex, as tools/set-gateway-keys.ps1), and random PLACEHOLDERS for the three gateway webhook secrets (the
#   real values are set on launch day, after the webhooks point at hooks.techaust.com; until then the hooks refuse every event, which is safe).
# - Values only the owner holds are typed or pasted into HIDDEN prompts: the two production Turnstile secrets, the gateway TEST keys, the production SES key
#   pair, the Cloudflare analytics token. An empty answer skips that secret (run again later; already-set names are skipped).
# - A secret already set on a Worker is NEVER replaced (the run reads `wrangler secret list` first), so a second run only fills what is missing.
# Nothing is shown, saved, logged or copied. Only one line comes back: "RESULT: ...". Uses your own `wrangler login`.
# The first `secret put` on a Worker that doesn't exist yet creates it as a draft (no code is served until the first deploy).
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$wrangler = Join-Path $root "apps\jobs\node_modules\wrangler\bin\wrangler.js"
if (-not (Test-Path $wrangler)) { Write-Host "RESULT: FAILED: wrangler not found in apps\jobs; run pnpm install first. Nothing was stored."; exit 1 }

# Production Workers and the secrets each needs (the env.staging `secrets.required` names, mirrored).
$workers = [ordered]@{
  "apps\web\wrangler.jsonc"            = "techaust-platform-web"
  "apps\admin\wrangler.jsonc"          = "techaust-platform-admin"
  "apps\admin\wrangler.api.jsonc"      = "techaust-platform-admin-api"
  "apps\admin\wrangler.finance.jsonc"  = "techaust-platform-admin-finance"
  "apps\portal\wrangler.jsonc"         = "techaust-platform-portal"
  "apps\jobs\wrangler.jsonc"           = "techaust-platform-jobs"
}
foreach ($c in $workers.Keys) { if (-not (Test-Path (Join-Path $root $c))) { Write-Host "RESULT: FAILED: no such config $c. Nothing was stored."; exit 1 } }

function New-Hex { $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); return (-join ($b | ForEach-Object { $_.ToString("x2") })) }
function New-B64 { $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); return [Convert]::ToBase64String($b) }
function Read-Hidden([string]$prompt) {
  $s = Read-Host -Prompt $prompt -AsSecureString
  $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
}
function Invoke-Wrangler([string]$arguments, [string]$stdin) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "node"
  $psi.Arguments = "`"$wrangler`" $arguments"
  $psi.WorkingDirectory = $root
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $outTask = $p.StandardOutput.ReadToEndAsync()
  $errTask = $p.StandardError.ReadToEndAsync()
  if ($null -ne $stdin) { $p.StandardInput.Write($stdin) }
  $p.StandardInput.Close()
  $p.WaitForExit()
  return @{ Code = $p.ExitCode; Std = $outTask.Result; Out = ($outTask.Result + $errTask.Result) }
}

# A BOM-free input encoding for the child processes (the M7.4 lesson: a UTF-8 BOM would reach wrangler before the value).
$prevEncoding = [Console]::InputEncoding
try { [Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
if ([Console]::InputEncoding.GetPreamble().Length -ne 0) {
  try { [Console]::InputEncoding = $prevEncoding } catch { }
  Write-Host "RESULT: FAILED: this PowerShell window would add a byte-order mark to the values. Nothing was stored. Tell the lead."
  exit 1
}

# What is already set (names only).
$existing = @{}
foreach ($c in $workers.Keys) {
  $r = Invoke-Wrangler "secret list --config `"$c`" --env production --format json" $null
  $names = @()
  if ($r.Code -eq 0) {
    # A list we can't read must never be taken as "nothing set" (a re-run would replace keys): stop instead.
    # Standard output only: wrangler writes its warnings (with "[" in them) to standard error.
    try { $names = @(($r.Std.Trim() | ConvertFrom-Json) | ForEach-Object { $_.name }) }
    catch { try { [Console]::InputEncoding = $prevEncoding } catch { }; Write-Host "RESULT: FAILED: couldn't read the secret list of $($workers[$c]). Nothing was stored. Tell the lead."; exit 1 }
  } elseif ($r.Out -notmatch "10007|does not exist|not found|If this is a new Worker") {
    $said = (($r.Out) -replace "\s+", " ").Trim(); if ($said.Length -gt 300) { $said = $said.Substring(0, 300) + " ..." }
    try { [Console]::InputEncoding = $prevEncoding } catch { }
    Write-Host "RESULT: FAILED: couldn't list the secrets of $($workers[$c]) (not signed in to Cloudflare?). Nothing was stored. Wrangler said: $said"
    exit 1
  }
  $existing[$c] = $names
}
function Is-Set([string]$config, [string]$name) { return ($existing[$config] -contains $name) }

Write-Host "This sets the PRODUCTION secrets. Already-set ones are skipped. Leave a prompt empty to skip that value for now."
$answer = Read-Host -Prompt "Type PRODUCTION to continue"
if ($answer -cne "PRODUCTION") { try { [Console]::InputEncoding = $prevEncoding } catch { }; Write-Host "RESULT: STOPPED: nothing was stored."; exit 1 }

# The plan: config, name, how the value is made. Shared values are made once.
$erasure = $null; $turnstileSignin = $null
$plan = @(
  @{ C = "apps\web\wrangler.jsonc"; N = "FORMS_IP_PEPPER"; Make = "b64" },
  @{ C = "apps\web\wrangler.jsonc"; N = "TURNSTILE_SECRET"; Make = "ask"; Ask = "Turnstile SECRET of the production FORMS widget (techaust-prod-forms)" },
  @{ C = "apps\admin\wrangler.jsonc"; N = "PASSWORD_PEPPER"; Make = "b64" },
  @{ C = "apps\admin\wrangler.jsonc"; N = "SALT_PEPPER"; Make = "b64" },
  @{ C = "apps\admin\wrangler.jsonc"; N = "TOTP_ENC_KEY"; Make = "b64" },
  @{ C = "apps\admin\wrangler.jsonc"; N = "SESSION_HMAC_KEY"; Make = "b64" },
  @{ C = "apps\admin\wrangler.jsonc"; N = "TURNSTILE_SECRET"; Make = "signin" },
  @{ C = "apps\admin\wrangler.api.jsonc"; N = "ERASURE_HASH_KEY"; Make = "erasure" },
  @{ C = "apps\admin\wrangler.finance.jsonc"; N = "RAZORPAY_KEY_ID"; Make = "ask"; Ask = "Razorpay TEST key id (rzp_test_...)" },
  @{ C = "apps\admin\wrangler.finance.jsonc"; N = "RAZORPAY_KEY_SECRET"; Make = "ask"; Ask = "Razorpay TEST key secret" },
  @{ C = "apps\admin\wrangler.finance.jsonc"; N = "STRIPE_SECRET_KEY"; Make = "ask"; Ask = "Stripe RESTRICTED test key (rk_test_...)" },
  @{ C = "apps\admin\wrangler.finance.jsonc"; N = "PAYPAL_CLIENT_ID"; Make = "ask"; Ask = "PayPal SANDBOX client id" },
  @{ C = "apps\admin\wrangler.finance.jsonc"; N = "PAYPAL_CLIENT_SECRET"; Make = "ask"; Ask = "PayPal SANDBOX client secret" },
  @{ C = "apps\portal\wrangler.jsonc"; N = "PORTAL_KEY_PEPPER"; Make = "b64" },
  @{ C = "apps\portal\wrangler.jsonc"; N = "TURNSTILE_SECRET"; Make = "signin" },
  @{ C = "apps\jobs\wrangler.jsonc"; N = "ERASURE_HASH_KEY"; Make = "erasure" },
  @{ C = "apps\jobs\wrangler.jsonc"; N = "SES_ACCESS_KEY_ID"; Make = "ask"; Ask = "SES PRODUCTION sender access key id (IAM user techaust-ses-sender-prod)" },
  @{ C = "apps\jobs\wrangler.jsonc"; N = "SES_SECRET_ACCESS_KEY"; Make = "ask"; Ask = "SES PRODUCTION sender secret access key" },
  @{ C = "apps\jobs\wrangler.jsonc"; N = "SES_EVENTS_TOKEN"; Make = "hex" },
  @{ C = "apps\jobs\wrangler.jsonc"; N = "UNSUBSCRIBE_KEY"; Make = "hex" },
  @{ C = "apps\jobs\wrangler.jsonc"; N = "RAZORPAY_WEBHOOK_SECRET"; Make = "hex" },
  @{ C = "apps\jobs\wrangler.jsonc"; N = "STRIPE_WEBHOOK_SECRET"; Make = "placeholder" },
  @{ C = "apps\jobs\wrangler.jsonc"; N = "PAYPAL_WEBHOOK_ID"; Make = "placeholder" },
  @{ C = "apps\jobs\wrangler.jsonc"; N = "CF_ANALYTICS_TOKEN"; Make = "ask"; Ask = "Cloudflare read-only Account Analytics token (the staging-usage-analytics one is fine)" }
)

# ERASURE_HASH_KEY must be the same on both Workers: if one already has it and the other doesn't, stop (a new key would differ from the stored one).
$eApi = Is-Set "apps\admin\wrangler.api.jsonc" "ERASURE_HASH_KEY"; $eJobs = Is-Set "apps\jobs\wrangler.jsonc" "ERASURE_HASH_KEY"
if ($eApi -ne $eJobs) { try { [Console]::InputEncoding = $prevEncoding } catch { }; Write-Host "RESULT: FAILED: ERASURE_HASH_KEY is set on only one of the admin API and jobs. Nothing was stored. Tell the lead."; exit 1 }

$stored = @(); $skipped = @(); $missing = @()
try {
  foreach ($s in $plan) {
    $label = "$($workers[$s.C]):$($s.N)"
    if (Is-Set $s.C $s.N) { $skipped += $label; continue }
    $value = $null
    switch ($s.Make) {
      "b64" { $value = New-B64 }
      "hex" { $value = New-Hex }
      "placeholder" { $value = "placeholder-" + (New-Hex) }
      "erasure" { if ($null -eq $erasure) { $erasure = New-Hex }; $value = $erasure }
      "signin" { if ($null -eq $turnstileSignin) { $turnstileSignin = Read-Hidden "Turnstile SECRET of the production SIGN-IN widget (techaust-prod-signin)" }; $value = $turnstileSignin }
      "ask" { $value = Read-Hidden $s.Ask }
    }
    if ([string]::IsNullOrWhiteSpace($value)) { $missing += $label; continue }
    if ($value -match '\s') { $missing += "$label (contained spaces: not stored)"; continue }
    $r = Invoke-Wrangler "secret put $($s.N) --config `"$($s.C)`" --env production" $value
    if ($r.Code -ne 0 -or $r.Out -notmatch "Success") {
      $said = (($r.Out.Replace($value, "<hidden>")) -replace "\s+", " ").Trim()
      if ($said.Length -gt 300) { $said = $said.Substring(0, 300) + " ..." }
      Write-Host "RESULT: FAILED at $label; stored before it: $($stored.Count) secret(s). Run again after fixing (stored ones are skipped). Wrangler said: $said"
      exit 1
    }
    $stored += $label
    $existing[$s.C] = @($existing[$s.C]) + $s.N
  }
} finally {
  $erasure = $null; $turnstileSignin = $null
  try { [Console]::InputEncoding = $prevEncoding } catch { }
}
$m = if ($missing.Count) { " Still missing (run again with these values): " + ($missing -join ", ") + "." } else { " Nothing is missing." }
Write-Host "RESULT: stored $($stored.Count), already set $($skipped.Count).$m"
