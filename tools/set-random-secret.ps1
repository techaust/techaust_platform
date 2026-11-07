# M7.5 L26 (analyst R findings F1, F4): one generic way to store a secret with no copy left anywhere, for any Worker config and environment, or as a GitHub
# Actions repository secret. Two modes:
#   -Mode random  makes the value here: -Bytes random bytes (default 32) from the system's cryptographic generator, as hex (default) or base64. It is never
#                 shown; with -Clipboard it is ALSO put on the clipboard for one paste into the other side (an EventBridge connection, a webhook form), then
#                 the clipboard is yours to clear.
#   -Mode paste   reads the value from a HIDDEN prompt (a key a provider showed you once). -Pattern, when given, must match or nothing is stored.
# Targets (one of):
#   -Config <apps\<app>\wrangler*.jsonc> [-Environment staging]   `wrangler secret put <Name>` on that Worker (staging by default; production only with -Environment production,
#                                                        which the lead asks for at Phase 7 L3, never before);
#   -GitHub                                              `gh secret set <Name>` on this repository (your own `gh auth login`).
# The value goes only to the tool's standard input, BOM-free (a byte-order mark would be stored with it), never on a command line, a file or the screen.
# Only one line comes back: "RESULT: ...". The lead gives you the exact line, for example:
#   powershell -ExecutionPolicy Bypass -File "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\tools\set-random-secret.ps1" -Name UNSUBSCRIBE_KEY -Config "apps\jobs\wrangler.jsonc"
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Z][A-Z0-9_]{1,63}$')][string]$Name,
  [ValidateSet("random", "paste")][string]$Mode = "random",
  [string]$Config,
  [ValidateSet("staging", "production")][string]$Environment = "staging",
  [switch]$GitHub,
  [ValidateRange(16, 64)][int]$Bytes = 32,
  [ValidateSet("hex", "base64")][string]$Encoding = "hex",
  [string]$Pattern,
  [switch]$Clipboard
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
function Stop-With([string]$why) { Write-Host "RESULT: FAILED ($Name): $why. Nothing was stored."; exit 1 }

if ($GitHub.IsPresent -eq [bool]$Config) { Stop-With "give exactly one target: -Config <wrangler config> or -GitHub" }
if ($Config) {
  $wrangler = Join-Path $root "apps\jobs\node_modules\wrangler\bin\wrangler.js"
  if (-not (Test-Path $wrangler)) { Stop-With "wrangler not found in apps\jobs; run pnpm install first" }
  if ($Config -notmatch '^apps\\[a-z]+\\wrangler(\.[a-z]+)?\.jsonc$') { Stop-With "-Config must be an apps\<app>\wrangler*.jsonc file" }
  if (-not (Test-Path (Join-Path $root $Config))) { Stop-With "no such config $Config" }
  if ($Environment -eq "production") {
    $answer = Read-Host -Prompt "This stores $Name on a PRODUCTION Worker. Type PRODUCTION to continue"
    if ($answer -cne "PRODUCTION") { Stop-With "stopped at the production question" }
  }
  $target = "$Config --env $Environment"
} else {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Stop-With "the GitHub CLI (gh) is not installed or not on PATH" }
  $target = "GitHub repository secret"
}

if ($Mode -eq "random") {
  $buf = New-Object byte[] $Bytes
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
  $value = if ($Encoding -eq "hex") { -join ($buf | ForEach-Object { $_.ToString("x2") }) } else { [Convert]::ToBase64String($buf) }
  [Array]::Clear($buf, 0, $buf.Length)
} else {
  $secure = Read-Host -Prompt "Paste the value for $Name (hidden), then press Enter" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  if (-not $value) { Stop-With "the value was empty" }
  if ($Pattern -and ($value -cnotmatch $Pattern)) { $value = $null; Stop-With "the value does not match the expected shape" }
}

$prevEncoding = [Console]::InputEncoding
try { [Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
if ([Console]::InputEncoding.GetPreamble().Length -ne 0) {
  $value = $null
  try { [Console]::InputEncoding = $prevEncoding } catch { }
  Stop-With "this PowerShell window would add a byte-order mark to the value; tell the lead"
}
try {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  if ($Config) {
    $psi.FileName = "node"
    $psi.Arguments = "`"$wrangler`" secret put $Name --config `"$Config`" --env $Environment"
  } else {
    $psi.FileName = (Get-Command gh).Source
    $psi.Arguments = "secret set $Name"
  }
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
  $ok = $p.ExitCode -eq 0 -and ($GitHub -or $out -match "Success")
  if (-not $ok) {
    $said = (($out.Replace($value, "<hidden>")) -replace "\s+", " ").Trim()
    if ($said.Length -gt 400) { $said = $said.Substring(0, 400) + " ..." }
    Write-Host "RESULT: FAILED ($Name) on $target (exit $($p.ExitCode)). Tell the lead before running again. The tool said: $said"
    exit 1
  }
  if ($Clipboard -and $Mode -eq "random") { Set-Clipboard -Value $value }
} finally {
  $value = $null
  try { [Console]::InputEncoding = $prevEncoding } catch { }
}
$note = if ($Clipboard -and $Mode -eq "random") { "; the value is on the clipboard for one paste (clear it afterwards)" } else { "; nothing to paste anywhere" }
Write-Host "RESULT: $Name ($Mode) stored on $target$note"
