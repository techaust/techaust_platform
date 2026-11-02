# Stores one payment gateway's TEST keys as staging secrets (M6.2-M6.4; docs/runbooks/payment-gateways.md Part B).
# Keys are read with hidden input, checked to be test keys, tried once against the provider's test API, then sent
# straight to Cloudflare with `wrangler secret put --env staging`. They are never shown, saved or copied.
# Uses your own `wrangler login`. The lead gives you the exact line, for example:
#   powershell -ExecutionPolicy Bypass -File "D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\WEBSITE\techaust_platform\tools\set-gateway-keys.ps1" -Gateway razorpay -Configs "apps\jobs\wrangler.jsonc"
# M6.2: `-Gateway razorpay-webhook` makes the Razorpay WEBHOOK secret instead (32 random bytes as hex), stores it as RAZORPAY_WEBHOOK_SECRET on the named
# configs (the jobs Worker: "apps\jobs\wrangler.jsonc") and puts it on the clipboard, to paste into Razorpay's webhook Secret box at once. It is never shown.
# M6.3: `-Gateway stripe` takes a RESTRICTED rk_test_ key only and probes its permissions (and that Customers is refused); `-Gateway stripe-webhook` stores the
# webhook signing secret Stripe shows (whsec_...) as STRIPE_WEBHOOK_SECRET on the jobs Worker.
param(
  [Parameter(Mandatory = $true)][ValidateSet("razorpay", "razorpay-webhook", "stripe", "stripe-webhook", "paypal")][string]$Gateway,
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
    # M6.3 (L3): a RESTRICTED sandbox key only; an sk_ key can do everything on the shared account and is refused here and in the Worker.
    $key = Read-Hidden "Stripe sandbox RESTRICTED key (starts rk_test_)"
    if ($key -notmatch '^rk_test_[A-Za-z0-9]+$') { Stop-With "the key is not a Stripe RESTRICTED TEST key (rk_test_...); an sk_ key is refused" }
    # Every call sends the version the Worker pins (packages/core/src/stripe.ts STRIPE_API_VERSION).
    $h = @{ Authorization = "Bearer $key"; "Stripe-Version" = "2026-09-30.endive" }
    try { $b = Invoke-RestMethod -Uri "https://api.stripe.com/v1/balance" -Headers $h }
    catch { Stop-With "Stripe refused GET /v1/balance: add `"Balance: Read`" to the key" }
    if ($b.livemode -ne $false) { Stop-With "Stripe says this key is not a sandbox key" }
    $probes = [ordered]@{
      "/v1/checkout/sessions?limit=1"    = "Checkout Sessions: Write"
      "/v1/payment_intents?limit=1"      = "PaymentIntents: Read"
      "/v1/charges?limit=1"              = "Charges: Read"
      "/v1/balance_transactions?limit=1" = "Balance: Read"
    }
    foreach ($p in $probes.Keys) {
      try { Invoke-RestMethod -Uri "https://api.stripe.com$p" -Headers $h | Out-Null }
      catch { Stop-With "Stripe refused GET $p`: add `"$($probes[$p])`" to the key" }
    }
    # The key must be restricted: Customers stays None, so this must be refused (403).
    $customers = $null
    try { Invoke-RestMethod -Uri "https://api.stripe.com/v1/customers?limit=1" -Headers $h | Out-Null; $customers = 200 }
    catch { $customers = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 } }
    # No answer at all (status 0: no network, a proxy, a timeout) proves nothing either way (early check 2, finding 8).
    if ($customers -eq 0) { Stop-With "Stripe didn't answer GET /v1/customers (no response); check the internet connection and run the script again" }
    if ($customers -ne 403) { Stop-With "Stripe let this key read Customers (status $customers): set Customers to None and every other permission not listed to None" }
    # A create-then-expire probe proves "Checkout Sessions: Write" and whatever an inline price_data session needs. Its events carry no techaust marks, so the
    # webhook writes nothing for them. It lives 60 minutes, as the Worker's sessions do (L4); 31 sat too close to Stripe's 30-minute minimum (finding 8).
    $exp = [DateTimeOffset]::UtcNow.AddMinutes(60).ToUnixTimeSeconds()
    $form = "mode=payment&line_items[0][price_data][currency]=usd&line_items[0][price_data][unit_amount]=50&line_items[0][price_data][product_data][name]=Key%20check&line_items[0][quantity]=1&metadata[app]=techaust-keycheck&expires_at=$exp&success_url=https%3A%2F%2Fexample.com%2Fok&allowed_payment_method_types[0]=card"
    try { $s = Invoke-RestMethod -Method Post -Uri "https://api.stripe.com/v1/checkout/sessions" -Headers $h -ContentType "application/x-www-form-urlencoded" -Body $form }
    catch { Stop-With "Stripe refused to create a test Checkout Session: add `"Checkout Sessions: Write`" to the key" }
    if ($s.livemode -ne $false) { Stop-With "Stripe made a live session with this key" }
    # The Worker's own re-fetch (apps/admin/worker/gateway/stripe.ts fetchSession): the session with its payment intent, latest charge and balance transaction
    # expanded. An unpaid session has no payment intent yet, so this proves the request and the version are accepted, not every expansion's permission; the first
    # staging payment proves the rest (run file "Vendor facts", expansion permissions).
    try { Invoke-RestMethod -Uri "https://api.stripe.com/v1/checkout/sessions/$($s.id)?expand%5B%5D=payment_intent.latest_charge.balance_transaction" -Headers $h | Out-Null }
    catch {
      try { Invoke-RestMethod -Method Post -Uri "https://api.stripe.com/v1/checkout/sessions/$($s.id)/expire" -Headers $h | Out-Null } catch { }
      Stop-With "Stripe refused to read the test Checkout Session with its payment expanded: check the key has every permission the runbook lists (Part B, H2)"
    }
    try { Invoke-RestMethod -Method Post -Uri "https://api.stripe.com/v1/checkout/sessions/$($s.id)/expire" -Headers $h | Out-Null }
    catch { Stop-With "Stripe refused to expire the test Checkout Session: add `"Checkout Sessions: Write`" to the key" }
    $secrets["STRIPE_SECRET_KEY"] = $key
  }
  "stripe-webhook" {
    # M6.3 (H3): the signing secret Stripe shows for the sandbox webhook endpoint (Reveal). Not checked with Stripe here: the first test event proves it.
    $whsec = Read-Hidden "Stripe webhook signing secret (starts whsec_)"
    if ($whsec -notmatch '^whsec_[A-Za-z0-9]+$') { Stop-With "the value is not a Stripe webhook signing secret (whsec_...)" }
    $secrets["STRIPE_WEBHOOK_SECRET"] = $whsec
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
  $id = $null; $secret = $null; $key = $null; $whsec = $null
}
if ($Gateway -eq "razorpay-webhook") {
  Write-Host "RESULT: razorpay-webhook secret made and stored on staging: $($stored -join ', '); it is on your clipboard, paste it into Razorpay's webhook Secret box now"
} elseif ($Gateway -eq "stripe-webhook") {
  Write-Host "RESULT: stripe-webhook secret stored on staging: $($stored -join ', '); not checked with Stripe; the first test event proves it"
} else {
  Write-Host "RESULT: $Gateway test keys checked and stored on staging: $($stored -join ', ')"
}
