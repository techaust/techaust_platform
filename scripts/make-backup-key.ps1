# P7-N (docs/runs/p7-launch.md): makes the owner's backup key pair ONCE and stores only the PUBLIC key as the repo variable BACKUP_PUBLIC_KEY_PEM.
# - Uses the OpenSSL that comes with Git for Windows (nothing is installed).
# - The PRIVATE key is written to D:\Business\1. Parent Project\TecHaust Technologies\Backup-Keys\backup-private.pem (outside the repository) and is
#   never printed, copied or sent. Only it can open the nightly backups: copy it to an offline place (a USB stick or your password manager) as well.
# - Never makes a second key: if the private key already exists, it is checked and reused (the public key is derived from it and stored again).
# OpenSSL writes progress dots to standard error; Windows PowerShell 5.1 would treat those as errors under "Stop", so native calls run under
# "Continue" with their output discarded, and success is judged by the exit code and the files.
# Only one line comes back: "RESULT: ...".
$ErrorActionPreference = "Stop"
$dir = "D:\Business\1. Parent Project\TecHaust Technologies\Backup-Keys"
$priv = Join-Path $dir "backup-private.pem"
$pub = Join-Path $dir "backup-public.pem"
$openssl = @("C:\Program Files\Git\usr\bin\openssl.exe", "C:\Program Files\Git\mingw64\bin\openssl.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $openssl) { Write-Host "RESULT: FAILED: OpenSSL from Git for Windows was not found. Nothing was made."; exit 1 }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Write-Host "RESULT: FAILED: the GitHub CLI (gh) was not found. Nothing was made."; exit 1 }
New-Item -ItemType Directory -Force -Path $dir | Out-Null

function Invoke-Native([string[]]$argv) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { & $openssl @argv 2>&1 | Out-Null; return $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
}

$made = $false
if (Test-Path $priv) {
  # Reuse: the existing private key must be a valid one (checked without printing it).
  if ((Invoke-Native @("pkey", "-in", $priv, "-noout")) -ne 0) { Write-Host "RESULT: FAILED: $priv exists but is not a valid key. Nothing was changed. Tell the lead (don't delete it)."; exit 1 }
} else {
  if ((Invoke-Native @("genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:4096", "-out", $priv)) -ne 0 -or -not (Test-Path $priv)) {
    Write-Host "RESULT: FAILED: the key pair was not made. Nothing was stored."; exit 1
  }
  $made = $true
}
if ((Invoke-Native @("pkey", "-in", $priv, "-pubout", "-out", $pub)) -ne 0 -or -not (Test-Path $pub)) { Write-Host "RESULT: FAILED: the public key was not written. The private key is in $dir; tell the lead."; exit 1 }
$pem = Get-Content -Raw $pub
if ($pem -notmatch "BEGIN PUBLIC KEY") { Write-Host "RESULT: FAILED: the public key looks wrong. Tell the lead."; exit 1 }

$prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
$pem | gh variable set BACKUP_PUBLIC_KEY_PEM --repo techaust/techaust_platform 2>&1 | Out-Null
$code = $LASTEXITCODE; $ErrorActionPreference = $prev
if ($code -ne 0) { Write-Host "RESULT: FAILED: GitHub refused the variable (is gh signed in as techaust?). The key pair is in $dir; run again after fixing (the key is reused)."; exit 1 }
$how = if ($made) { "made" } else { "already there, checked and reused" }
Write-Host "RESULT: backup private key $how; the public key is stored as BACKUP_PUBLIC_KEY_PEM; the private key is in $dir (copy backup-private.pem to an offline place too)"
