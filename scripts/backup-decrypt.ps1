# P7-N (docs/runs/p7-launch.md; docs/runbooks/restore.md "Backups"): opens one nightly production backup on the owner's PC.
#
# Give it the .tar downloaded from the backup bucket and the path of backup-private.pem (the key from the owner's offline folder). It:
#   1. checks the archive holds exactly manifest.json, dump.sql.enc and key.bin.enc;
#   2. unwraps the backup's own key with the private key (openssl pkeyutl -decrypt, RSA-OAEP SHA-256; OpenSSL asks for the key's passphrase itself);
#   3. decrypts the dump (openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256);
#   4. checks its size and SHA-256 against the manifest, and writes the .sql NEXT TO the archive (never over an existing file).
# The unwrapped key lives only in a scratch folder under your Temp folder and is deleted on every exit. Nothing secret is printed. OpenSSL is the one that
# comes with Git for Windows, found automatically. The last line is "RESULT: ...".
#
# The lead gives you the exact line, for example:
#   powershell -ExecutionPolicy Bypass -File "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\scripts\backup-decrypt.ps1"
# It asks for the two paths (a path copied with "Copy as path", quotes included, is fine). Both can also be given: -Archive <tar> -PrivateKey <pem>.
param(
  [string]$Archive,
  [string]$PrivateKey
)
$ErrorActionPreference = "Stop"

$FORMAT = "techaust-d1-backup/1"
$ITER = 200000
$PARTS = @("dump.sql.enc", "key.bin.enc", "manifest.json")

function Fail([string]$message) {
  Write-Host "RESULT: FAILED: $message"
  exit 1
}

function Clean-Path([string]$value) {
  if ($null -eq $value) { return "" }
  return $value.Trim().Trim('"').Trim("'")
}

$onWindows = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT

# OpenSSL: Git for Windows first (next to git.exe, then the usual install folders), then any openssl on the PATH. 1.1.1 or later (pbkdf2, OAEP digests).
function Find-OpenSsl {
  $candidates = @()
  $git = Get-Command git -ErrorAction SilentlyContinue
  if ($null -ne $git) {
    $gitRoot = Split-Path (Split-Path $git.Source -Parent) -Parent
    $candidates += (Join-Path $gitRoot "usr\bin\openssl.exe")
    $candidates += (Join-Path $gitRoot "mingw64\bin\openssl.exe")
  }
  foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
    if ($base) {
      $candidates += (Join-Path $base "Git\usr\bin\openssl.exe")
      $candidates += (Join-Path $base "Git\mingw64\bin\openssl.exe")
      $candidates += (Join-Path $base "Programs\Git\usr\bin\openssl.exe")
    }
  }
  $onPath = Get-Command openssl -ErrorAction SilentlyContinue
  if ($null -ne $onPath) { $candidates += $onPath.Source }
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c -PathType Leaf)) {
      $version = (& $c version)
      if ($LASTEXITCODE -eq 0 -and "$version" -match '^OpenSSL (1\.1\.1|[3-9]\.)') { return $c }
    }
  }
  return $null
}

function Find-Tar {
  if ($onWindows) {
    $system = Join-Path $env:SystemRoot "System32\tar.exe"
    if (Test-Path -LiteralPath $system -PathType Leaf) { return $system }
  }
  $onPath = Get-Command tar -ErrorAction SilentlyContinue
  if ($null -ne $onPath) { return $onPath.Source }
  return $null
}

$openssl = Find-OpenSsl
if ($null -eq $openssl) { Fail "OpenSSL was not found. Install Git for Windows (it brings OpenSSL) and run this again. Nothing was written." }
$tar = Find-Tar
if ($null -eq $tar) { Fail "tar was not found (Windows 10 and 11 have it in System32). Nothing was written." }

$Archive = Clean-Path $Archive
if (-not $Archive) { $Archive = Clean-Path (Read-Host -Prompt "Path of the backup .tar you downloaded") }
if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) { Fail "no such file: $Archive. Nothing was written." }
$Archive = (Resolve-Path -LiteralPath $Archive).Path

$PrivateKey = Clean-Path $PrivateKey
if (-not $PrivateKey) { $PrivateKey = Clean-Path (Read-Host -Prompt "Path of backup-private.pem (from your offline folder)") }
if (-not (Test-Path -LiteralPath $PrivateKey -PathType Leaf)) { Fail "no such file: $PrivateKey. Nothing was written." }
$PrivateKey = (Resolve-Path -LiteralPath $PrivateKey).Path

# 1. Exactly the three parts, by name (no folders, nothing else).
$listing = @(& $tar -tf $Archive)
if ($LASTEXITCODE -ne 0) { Fail "the file is not a readable tar archive. Nothing was written." }
$names = @($listing | ForEach-Object { "$_".Trim() } | Where-Object { $_ -ne "" } | Sort-Object)
if (($names -join "|") -ne ($PARTS -join "|")) { Fail "the archive does not hold exactly manifest.json, dump.sql.enc and key.bin.enc. Nothing was written." }

$work = Join-Path ([IO.Path]::GetTempPath()) ("techaust-restore-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $work | Out-Null
$outPath = $null
$done = $false
try {
  & $tar -xf $Archive -C $work
  if ($LASTEXITCODE -ne 0) { Fail "the archive could not be unpacked. Nothing was written." }

  $manifest = Get-Content -LiteralPath (Join-Path $work "manifest.json") -Raw | ConvertFrom-Json
  if ($manifest.format -ne $FORMAT) { Fail "this backup's format is '$($manifest.format)'; this script reads $FORMAT. Tell the lead. Nothing was written." }
  if ($manifest.encrypted.cipher -ne "aes-256-cbc" -or $manifest.encrypted.kdf -ne "pbkdf2" -or [int]$manifest.encrypted.iter -ne $ITER -or $manifest.encrypted.md -ne "sha256") {
    Fail "the manifest names an encryption this script does not use. Tell the lead. Nothing was written."
  }
  if ($manifest.key.wrap -ne "rsa-oaep" -or $manifest.key.oaepMd -ne "sha256" -or $manifest.key.mgf1Md -ne "sha256") {
    Fail "the manifest names a key wrapping this script does not use. Tell the lead. Nothing was written."
  }
  $name = "$($manifest.plaintext.file)"
  if ($name -notmatch '^[A-Za-z0-9._-]+\.sql$') { Fail "the manifest's file name is not a plain .sql name. Nothing was written." }
  $expectedSha = "$($manifest.plaintext.sha256)".ToLowerInvariant()
  if ($expectedSha -notmatch '^[0-9a-f]{64}$') { Fail "the manifest has no SHA-256 of the dump. Nothing was written." }
  $expectedBytes = [int64]$manifest.plaintext.bytes

  $outPath = Join-Path (Split-Path $Archive -Parent) $name
  if (Test-Path -LiteralPath $outPath) {
    $existing = $outPath
    $outPath = $null
    Fail "$existing already exists: move or delete it first. Nothing was written."
  }

  # 2. The backup's key (OpenSSL asks for the private key's passphrase on this window if it has one).
  $wrapped = Join-Path $work "key.bin.enc"
  $key = Join-Path $work "key.bin"
  & $openssl pkeyutl -decrypt -inkey $PrivateKey -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -pkeyopt rsa_mgf1_md:sha256 -in $wrapped -out $key
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $key -PathType Leaf)) {
    $outPath = $null
    Fail "the key could not be unwrapped: wrong private key or passphrase (this backup was made for the public key with SHA-256 $($manifest.key.publicKeySha256)). Nothing was written."
  }

  # 3. The dump.
  & $openssl enc -d -aes-256-cbc -pbkdf2 -iter $ITER -md sha256 -in (Join-Path $work "dump.sql.enc") -out $outPath -pass "file:$key"
  if ($LASTEXITCODE -ne 0) { Fail "the dump could not be decrypted. Nothing was kept." }

  # 4. Size and SHA-256 against the manifest.
  $bytes = (Get-Item -LiteralPath $outPath).Length
  $sha = (Get-FileHash -LiteralPath $outPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($bytes -ne $expectedBytes -or $sha -ne $expectedSha) { Fail "the decrypted dump does not match its manifest (size or SHA-256). Nothing was kept. Tell the lead." }
  $done = $true
} finally {
  if ($null -ne $outPath -and -not $done -and (Test-Path -LiteralPath $outPath)) { Remove-Item -LiteralPath $outPath -Force }
  if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}

Write-Host "RESULT: OK: wrote $outPath ($bytes bytes; the SHA-256 matches the manifest). It holds production data: keep this file private, delete it after the drill."
exit 0
