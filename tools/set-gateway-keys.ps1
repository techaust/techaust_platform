# Stores one payment gateway's TEST keys as staging secrets (M6.2-M6.4; docs/runbooks/payment-gateways.md Part B).
# Keys are read with hidden input, checked to be test keys, tried once against the provider's test API, then sent
# straight to Cloudflare with `wrangler secret put --env staging`. They are never shown, saved or copied.
# Uses your own `wrangler login`. The lead gives you the exact line, for example:
#   powershell -ExecutionPolicy Bypass -File "D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\WEBSITE\techaust_platform\tools\set-gateway-keys.ps1" -Gateway razorpay -Configs "apps\jobs\wrangler.jsonc"
# M6.2: `-Gateway razorpay-webhook` makes the Razorpay WEBHOOK secret instead (32 random bytes as hex), stores it as RAZORPAY_WEBHOOK_SECRET on the named
# configs (the jobs Worker: "apps\jobs\wrangler.jsonc") and puts it on the clipboard, to paste into Razorpay's webhook Secret box at once. It is never shown.
param(
  [Parameter(Mandatory = $true)][ValidateSet("razorpay", "razorpay-webhook", "stripe", "paypal")][string]$Gateway,
  # Wrangler config files (relative to the repository) of the staging Workers that need these keys.
  [Parameter(Mandatory = $true)][string[]]$Configs
)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$wrangler = Join-Path $root "apps\jobs\node_modules\wrangler\bin\wrangler.js"
if (-not (Test-Path $wrangler)) { throw "wrangler not found in apps\jobs; run pnpm install first." }
foreach ($c in $Configs) { if (-not (Test-Path (Join-Path $root $c))) { throw "No such config: $c" } }

function Read-Hidden([string]$prompt) {
  $secure = Read-Host -Prompt $prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function Basic([string]$user, [string]$pass) {
  return "Basic " + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${user}:${pass}"))
}
function Stop-With([string]$why) { Write-Host "RESULT: FAILED ($Gateway): $why. Nothing was stored."; exit 1 }

# name -> value, in the order they are stored.
$secrets = [ordered]@{}
switch ($Gateway) {
  "razorpay" {
    $id = Read-Hidden "Razorpay Key Id (starts rzp_test_)"
    if ($id -notmatch '^rzp_test_[A-Za-z0-9]+$') { Stop-With "the Key Id is not a Razorpay TEST key (rzp_test_...)" }
    $secret = Read-Hidden "Razorpay Key Secret"
    if ($secret.Length -lt 10) { Stop-With "the Key Secret looks empty or cut short" }
    try { Invoke-RestMethod -Uri "https://api.razorpay.com/v1/payments?count=1" -Headers @{ Authorization = (Basic $id $secret) } | Out-Null }
    catch { Stop-With "Razorpay refused this key pair (check you copied both from Test Mode)" }
    $secrets["RAZORPAY_KEY_ID"] = $id
    $secrets["RAZORPAY_KEY_SECRET"] = $secret
  }
  "razorpay-webhook" {
    # 32 random bytes from the system's cryptographic generator, as 64 hex characters.
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secrets["RAZORPAY_WEBHOOK_SECRET"] = -join ($bytes | ForEach-Object { $_.ToString("x2") })
  }
  "stripe" {
    $key = Read-Hidden "Stripe sandbox secret key (starts sk_test_ or rk_test_)"
    if ($key -notmatch '^(sk|rk)_test_[A-Za-z0-9]+$') { Stop-With "the key is not a Stripe TEST secret key (sk_test_... or rk_test_...)" }
    try { $b = Invoke-RestMethod -Uri "https://api.stripe.com/v1/balance" -Headers @{ Authorization = "Bearer $key" } }
    catch { Stop-With "Stripe refused this key" }
    if ($b.livemode -ne $false) { Stop-With "Stripe says this key is not a sandbox key" }
    $secrets["STRIPE_SECRET_KEY"] = $key
  }
  "paypal" {
    $id = Read-Hidden "PayPal sandbox Client ID"
    $secret = Read-Hidden "PayPal sandbox Secret"
    if ($id.Length -lt 20 -or $secret.Length -lt 20) { Stop-With "the Client ID or Secret looks empty or cut short" }
    # Live credentials are refused by the sandbox address, so a token here proves these are sandbox credentials.
    try {
      Invoke-RestMethod -Method Post -Uri "https://api-m.sandbox.paypal.com/v1/oauth2/token" -Headers @{ Authorization = (Basic $id $secret) } `
        -ContentType "application/x-www-form-urlencoded" -Body "grant_type=client_credentials" | Out-Null
    } catch { Stop-With "PayPal's sandbox refused this pair (copy both from Apps & Credentials with Sandbox selected)" }
    $secrets["PAYPAL_CLIENT_ID"] = $id
    $secrets["PAYPAL_CLIENT_SECRET"] = $secret
  }
}

$stored = @()
try {
  foreach ($c in $Configs) {
    foreach ($name in $secrets.Keys) {
      # Send the value on stdin with no trailing newline.
      $psi = New-Object System.Diagnostics.ProcessStartInfo
      $psi.FileName = "node"
      $psi.Arguments = "`"$wrangler`" secret put $name --config `"$c`" --env staging"
      $psi.WorkingDirectory = $root
      $psi.UseShellExecute = $false
      $psi.RedirectStandardInput = $true
      $psi.RedirectStandardOutput = $true
      $psi.RedirectStandardError = $true
      $p = [System.Diagnostics.Process]::Start($psi)
      $p.StandardInput.Write($secrets[$name])
      $p.StandardInput.Close()
      $out = $p.StandardOutput.ReadToEnd() + $p.StandardError.ReadToEnd()
      $p.WaitForExit()
      if ($p.ExitCode -ne 0 -or $out -notmatch "Success") {
        foreach ($v in $secrets.Values) { $out = $out.Replace($v, "<hidden>") }
        Write-Host "RESULT: FAILED ($Gateway) at $name on $c (exit $($p.ExitCode)); stored before it: $($stored -join ', '). Wrangler said:"
        Write-Host $out
        exit 1
      }
      $stored += "$name@$c"
    }
  }
  if ($Gateway -eq "razorpay-webhook") { Set-Clipboard -Value $secrets["RAZORPAY_WEBHOOK_SECRET"] }
} finally {
  foreach ($k in @($secrets.Keys)) { $secrets[$k] = $null }
  $id = $null; $secret = $null; $key = $null
}
if ($Gateway -eq "razorpay-webhook") {
  Write-Host "RESULT: razorpay-webhook secret made and stored on staging: $($stored -join ', '); it is on your clipboard, paste it into Razorpay's webhook Secret box now"
} else {
  Write-Host "RESULT: $Gateway test keys checked and stored on staging: $($stored -join ', ')"
}
